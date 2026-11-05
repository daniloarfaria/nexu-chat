import { app, net, protocol } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { downloadMediaMessage, type WASocket } from 'baileys'
import type { MediaInfo } from '@shared/types'
import { getRawMessage, setMediaUrl } from './store'
import { getDb } from '../db'
import { log } from '../log'

export const MEDIA_SCHEME = 'dspmedia'

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'application/pdf': 'pdf'
}

function mediaRoot(): string {
  return join(app.getPath('userData'), 'media')
}

/** Registrar antes do app ficar pronto. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

/** Serve só arquivos de dentro da pasta de mídia (sem ../). */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const root = mediaRoot()
    const file = normalize(join(root, url.hostname, rel))
    if (!file.startsWith(root + sep) || !existsSync(file)) return new Response('não encontrado', { status: 404 })
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
  })
}

export function mediaUrl(accountId: string, file: string): string {
  return `${MEDIA_SCHEME}://${accountId}/${encodeURIComponent(file)}`
}

function extFor(media: MediaInfo): string {
  const mime = (media.mimetype ?? '').split(';')[0].trim()
  if (media.fileName && /\.[a-z0-9]{1,6}$/i.test(media.fileName)) return media.fileName.split('.').pop()!.toLowerCase()
  return (
    EXT[mime] ??
    mime
      .split('/')[1]
      ?.replace(/[^a-z0-9]/gi, '')
      .slice(0, 6) ??
    'bin'
  )
}

const inflight = new Map<string, Promise<MediaInfo>>()

/** Baixa (se preciso) e devolve a mídia com a URL local. */
export function ensureMedia(sock: WASocket | null, accountId: string, chatJid: string, id: string): Promise<MediaInfo> {
  const key = `${accountId}|${chatJid}|${id}`
  const running = inflight.get(key)
  if (running) return running
  const p = (async () => {
    const row = getDb()
      .prepare('SELECT media FROM messages WHERE account_id = ? AND chat_jid = ? AND id = ?')
      .get(accountId, chatJid, id) as { media: string | null } | undefined
    if (!row?.media) throw new Error('Mensagem sem mídia')
    const media = JSON.parse(row.media) as MediaInfo & { file?: string }
    if (media.file && existsSync(join(mediaRoot(), accountId, media.file))) return media
    if (!sock) throw new Error('Conecte o WhatsApp para baixar esta mídia')
    const msg = getRawMessage(accountId, chatJid, id)
    if (!msg) throw new Error('Mensagem não encontrada')

    const buf = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: log.baileys(), reuploadRequest: (m) => sock.updateMediaMessage(m) }
    )
    const dir = join(mediaRoot(), accountId)
    mkdirSync(dir, { recursive: true })
    const file = `${createHash('sha256')
      .update(chatJid + id)
      .digest('hex')
      .slice(0, 32)}.${extFor(media)}`
    writeFileSync(join(dir, file), buf)
    const next = { ...media, file, url: mediaUrl(accountId, file), size: media.size ?? buf.length }
    setMediaUrl(accountId, chatJid, id, next)
    return next
  })()
  inflight.set(key, p)
  p.finally(() => inflight.delete(key)).catch(() => undefined)
  return p
}

/** Grava a mídia que nós mesmos enviamos, para não precisar baixar de volta. */
export function storeOwnMedia(
  accountId: string,
  chatJid: string,
  id: string,
  data: Uint8Array,
  media: MediaInfo
): MediaInfo {
  const dir = join(mediaRoot(), accountId)
  mkdirSync(dir, { recursive: true })
  const file = `${createHash('sha256')
    .update(chatJid + id)
    .digest('hex')
    .slice(0, 32)}.${extFor(media)}`
  writeFileSync(join(dir, file), data)
  return { ...media, file, url: mediaUrl(accountId, file) } as MediaInfo
}

export function deleteAccountMedia(accountId: string): void {
  rmSync(join(mediaRoot(), accountId), { recursive: true, force: true })
}

/** Download automático de mídias leves que chegam em tempo real. */
export function shouldAutoDownload(type: string, media: MediaInfo | null): boolean {
  if (!media || media.viewOnce) return false
  const size = media.size ?? 0
  if (type === 'sticker' || type === 'voice') return size < 2_000_000
  if (type === 'image' || type === 'audio') return size < 5_000_000
  return false
}
