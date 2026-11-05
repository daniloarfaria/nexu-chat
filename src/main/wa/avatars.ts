import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { WASocket } from 'baileys'
import { getDb } from '../db'
import { mediaUrl } from './media'
import { log } from '../log'

/**
 * Fotos de perfil de contatos e grupos.
 * - Só busca o que a tela pede, em fila lenta (1 por vez, com intervalo), para não parecer automação.
 * - Guarda o arquivo no computador e reaproveita por 24 h (sem foto/privado: tenta de novo em 24 h).
 */

export const avatarEvents = new EventEmitter()

const TTL = 24 * 3600_000
const GAP_MS = 400
const MAX_QUEUE = 300

type Getter = (accountId: string) => WASocket | null
let getSocket: Getter = () => null
export function setAvatarSocketGetter(fn: Getter): void {
  getSocket = fn
}

const queue: Array<{ accountId: string; jid: string }> = []
const queued = new Set<string>()
let running = false

function dir(accountId: string): string {
  return join(app.getPath('userData'), 'media', accountId, 'avatars')
}

function fileName(jid: string): string {
  return `${createHash('sha256').update(jid).digest('hex').slice(0, 24)}.jpg`
}

function urlFor(accountId: string, file: string | null): string | null {
  return file ? mediaUrl(accountId, `avatars/${file}`) : null
}

/** Devolve as fotos já conhecidas e põe na fila as que faltam ou estão velhas. */
export function getAvatars(accountId: string, jids: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  if (!jids.length) return out
  const rows = getDb()
    .prepare(
      'SELECT jid, file, checked_at FROM avatars WHERE account_id = ? AND jid IN (SELECT value FROM json_each(?))'
    )
    .all(accountId, JSON.stringify(jids)) as Array<{ jid: string; file: string | null; checked_at: number }>
  const known = new Map(rows.map((r) => [r.jid, r]))
  for (const jid of jids) {
    const r = known.get(jid)
    if (r) out[jid] = urlFor(accountId, r.file)
    if (!r || Date.now() - r.checked_at > TTL) enqueue(accountId, jid)
  }
  return out
}

/** O contato trocou a foto: busca de novo na próxima vez. */
export function invalidateAvatar(accountId: string, jid: string): void {
  getDb().prepare('UPDATE avatars SET checked_at = 0 WHERE account_id = ? AND jid = ?').run(accountId, jid)
}

function enqueue(accountId: string, jid: string): void {
  const k = `${accountId}|${jid}`
  if (queued.has(k) || queue.length >= MAX_QUEUE) return
  queued.add(k)
  queue.push({ accountId, jid })
  if (!running) void drain()
}

async function drain(): Promise<void> {
  running = true
  const changed = new Map<string, Record<string, string | null>>()
  let lastEmit = Date.now()
  const flush = (): void => {
    for (const [accountId, map] of changed) avatarEvents.emit('changed', { accountId, avatars: map })
    changed.clear()
    lastEmit = Date.now()
  }
  try {
    while (queue.length) {
      const { accountId, jid } = queue.shift()!
      queued.delete(`${accountId}|${jid}`)
      const sock = getSocket(accountId)
      if (!sock) continue // sem conexão: tenta quando a tela pedir de novo
      let file: string | null = null
      try {
        const url = await sock.profilePictureUrl(jid, 'preview', 8000)
        if (url && /^https:\/\/[\w.-]+\.whatsapp\.net\//.test(url)) {
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
          const buf = Buffer.from(await res.arrayBuffer())
          if (
            res.ok &&
            buf.length > 0 &&
            buf.length < 2_000_000 &&
            /^image\//.test(res.headers.get('content-type') ?? 'image/jpeg')
          ) {
            mkdirSync(dir(accountId), { recursive: true })
            file = fileName(jid)
            writeFileSync(join(dir(accountId), file), buf)
          }
        }
      } catch (e) {
        // 401/404 = sem foto ou privada; outros erros só registram
        const msg = (e as Error).message ?? ''
        if (!/not-authorized|item-not-found|404|401/i.test(msg))
          log.warn('Falha ao buscar foto de perfil', { erro: msg })
      }
      if (!file) rmSync(join(dir(accountId), fileName(jid)), { force: true })
      getDb()
        .prepare(
          'INSERT INTO avatars (account_id, jid, file, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET file = excluded.file, checked_at = excluded.checked_at'
        )
        .run(accountId, jid, file, Date.now())
      const m = changed.get(accountId) ?? {}
      m[jid] = file ? `${urlFor(accountId, file)}?v=${Date.now()}` : null
      changed.set(accountId, m)
      if (Date.now() - lastEmit > 800) flush()
      await new Promise((r) => setTimeout(r, GAP_MS))
    }
  } finally {
    flush()
    running = false
  }
}
