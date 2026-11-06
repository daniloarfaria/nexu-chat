import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { jidNormalizedUser, type AnyMessageContent, type WASocket } from 'baileys'
import type {
  StatusAudience,
  StatusKind,
  StatusMedia,
  StatusPost,
  StatusPostState,
  StatusSettings
} from '@shared/types'
import { getDb, getSetting, setSetting } from './db'
import { getAccount, listAccounts } from './accounts'
import { wa } from './wa/manager'
import { log } from './log'

/**
 * Status do WhatsApp: postar texto (com cor de fundo), foto ou vídeo para os contatos.
 * O WhatsApp exige a lista de quem vê junto com a postagem (statusJidList). O app ignora
 * o status@broadcast na leitura (wa/store.ts), então nada disto aparece em Conversas.
 */

export const STATUS_JID = 'status@broadcast'
/** Padrão de postagens por dia por conta (a loja pode mudar). Protege o número de parecer robô. */
export const STATUS_DAILY_LIMIT_DEFAULT = 10
export const STATUS_DAILY_LIMIT_MAX = 50
/**
 * Acima deste número de pessoas, a tela avisa que a postagem fica pesada: o WhatsApp precisa
 * criptografar a postagem para cada aparelho de cada contato da lista. Ainda deixa postar.
 * O valor é um ponto de partida; o teste real com contas grandes define o teto certo.
 */
export const STATUS_LARGE_AUDIENCE = 1000
/** Vídeo de status: o WhatsApp corta em 90 segundos; o app recusa vídeos mais longos. */
export const STATUS_VIDEO_MAX_SECONDS = 90
/** Tamanho máximo do arquivo de foto ou vídeo para status (limite usado pelo WhatsApp para status). */
export const STATUS_MEDIA_MAX_BYTES = 16 * 1024 * 1024
export const STATUS_TEXT_MAX = 700
export const STATUS_CAPTION_MAX = 1024
/** Agendado que ficou mais de 24 h sem conseguir postar (app fechado, sem conexão) não sai mais. */
const MAX_LATE_MS = 24 * 3600_000
/** Arquivos de mídia de postagens antigas são apagados depois deste prazo. */
const MEDIA_KEEP_MS = 7 * 86_400_000

export const statusEvents = new EventEmitter()

// ---------- Configurações ----------

export function getStatusSettings(accountId: string): StatusSettings {
  const s = getSetting<Partial<StatusSettings>>(`status:${accountId}`, {})
  return { dailyLimit: s.dailyLimit ?? STATUS_DAILY_LIMIT_DEFAULT }
}

export function setStatusSettings(accountId: string, patch: Partial<StatusSettings>): StatusSettings {
  const next = { ...getStatusSettings(accountId), ...patch }
  next.dailyLimit = Math.max(1, Math.min(STATUS_DAILY_LIMIT_MAX, Math.round(next.dailyLimit)))
  setSetting(`status:${accountId}`, next)
  return next
}

// ---------- Quem vê ----------

// Pediu para não receber: marcado no contato ou na lista de supressão (número ou JID)
const OPTED_SQL = `(p.opt_out = 1 OR EXISTS (SELECT 1 FROM suppression s WHERE s.account_id = p.account_id AND (s.key = p.phone OR s.key = p.jid)))`

function audienceWhere(accountId: string, a: StatusAudience): { sql: string; args: string[] } {
  const where = ['p.account_id = ?']
  const args = [accountId]
  const tags = a.tags.filter(Boolean)
  const tagSql = `EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag IN (${tags.map(() => '?').join(',')}))`
  if (a.modo === 'etiqueta') {
    if (!tags.length) where.push('0')
    else {
      where.push(tagSql)
      args.push(...tags)
    }
  } else if (a.modo === 'todos_menos' && tags.length) {
    where.push(`NOT ${tagSql}`)
    args.push(...tags)
  }
  return { sql: where.join(' AND '), args }
}

/** Lista de JIDs que vão ver o status: contatos com WhatsApp confirmado, sem quem pediu para não receber. */
export function statusAudienceJids(accountId: string, a: StatusAudience): string[] {
  const { sql, args } = audienceWhere(accountId, a)
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT p.jid FROM people p WHERE ${sql} AND p.has_wa = 1 AND p.jid IS NOT NULL AND p.jid != ''
       AND NOT ${OPTED_SQL} ORDER BY p.id`
    )
    .all(...args) as Array<{ jid: string }>
  return rows.map((r) => r.jid).filter((j) => /@(s\.whatsapp\.net|lid)$/.test(j))
}

/** Números para mostrar antes de postar. */
export function countStatusAudience(
  accountId: string,
  a: StatusAudience
): { total: number; semWhatsapp: number; optedOut: number; large: boolean; limit: number } {
  const { sql, args } = audienceWhere(accountId, a)
  const r = getDb()
    .prepare(
      `SELECT SUM(${OPTED_SQL}) AS optedOut,
        SUM(NOT ${OPTED_SQL} AND NOT (p.has_wa = 1 AND p.jid IS NOT NULL AND p.jid != '')) AS semWhatsapp
       FROM people p WHERE ${sql}`
    )
    .get(...args) as { optedOut: number | null; semWhatsapp: number | null }
  const total = statusAudienceJids(accountId, a).length
  return {
    total,
    semWhatsapp: r.semWhatsapp ?? 0,
    optedOut: r.optedOut ?? 0,
    large: total > STATUS_LARGE_AUDIENCE,
    limit: STATUS_LARGE_AUDIENCE
  }
}

// ---------- Postagens ----------

interface Row {
  id: number
  account_id: string
  kind: StatusKind
  text: string | null
  media: string | null
  background: string | null
  font: number | null
  audience: string
  scheduled_at: number
  status: StatusPostState
  error: string | null
  sent_at: number | null
  recipients_count: number | null
  message_id: string | null
  created_at: number
}

const toPost = (r: Row): StatusPost => ({
  id: r.id,
  accountId: r.account_id,
  kind: r.kind,
  text: r.text,
  media: r.media ? (JSON.parse(r.media) as StatusMedia) : null,
  background: r.background,
  font: r.font,
  audience: JSON.parse(r.audience) as StatusAudience,
  scheduledAt: r.scheduled_at,
  status: r.status,
  error: r.error,
  sentAt: r.sent_at,
  recipientsCount: r.recipients_count,
  createdAt: r.created_at
})

export function getStatusPost(id: number): StatusPost | null {
  const r = getDb().prepare('SELECT * FROM status_posts WHERE id = ?').get(id) as Row | undefined
  return r ? toPost(r) : null
}

export function listStatusPosts(accountId: string): StatusPost[] {
  return (
    getDb()
      .prepare('SELECT * FROM status_posts WHERE account_id = ? ORDER BY scheduled_at DESC, id DESC LIMIT 300')
      .all(accountId) as unknown as Row[]
  ).map(toPost)
}

function dayRange(ts: number): [number, number] {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  const start = d.getTime()
  d.setDate(d.getDate() + 1)
  return [start, d.getTime()]
}

/**
 * Postagens que contam no limite do dia: já enviadas naquele dia e, ao criar uma nova,
 * também as que ainda estão marcadas para ele.
 */
export function postsOnDay(accountId: string, ts = Date.now(), withScheduled = true): number {
  const [a, b] = dayRange(ts)
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM status_posts WHERE account_id = ? AND (
        (status IN ('enviado','enviando') AND sent_at >= ? AND sent_at < ?)
        OR (? AND status = 'agendado' AND scheduled_at >= ? AND scheduled_at < ?))`
    )
    .get(accountId, a, b, withScheduled ? 1 : 0, a, b) as { n: number }
  return r.n
}

function mediaDir(): string {
  return join(app.getPath('userData'), 'status-media')
}

export function statusMediaPath(m: StatusMedia): string {
  return join(mediaDir(), m.file)
}

function removeMedia(m: StatusMedia | null): void {
  if (m) rmSync(statusMediaPath(m), { force: true })
}

export interface StatusInput {
  accountId: string
  kind: StatusKind
  text: string
  background?: string | null
  font?: number | null
  audience: StatusAudience
  /** null = postar agora */
  scheduledAt: number | null
  media?: { name: string; mime: string; data: Uint8Array } | null
}

export function createStatusPost(input: StatusInput): StatusPost {
  const acc = getAccount(input.accountId)
  if (!acc) throw new Error('Conta não encontrada')
  const text = input.text.trim()
  const now = Date.now()
  const when = input.scheduledAt ?? now
  if (input.scheduledAt != null && input.scheduledAt < now - 60_000)
    throw new Error('A data agendada já passou. Escolha um horário no futuro.')
  if (input.scheduledAt == null && !wa.getSocket(input.accountId))
    throw new Error('O WhatsApp desta conta não está conectado. Conecte ou agende para depois.')

  let background: string | null = null
  let font: number | null = null
  if (input.kind === 'texto') {
    if (!text) throw new Error('Escreva o texto do status')
    if (text.length > STATUS_TEXT_MAX) throw new Error(`O texto do status tem no máximo ${STATUS_TEXT_MAX} letras`)
    background = input.background && /^#[0-9a-fA-F]{6}$/.test(input.background) ? input.background : '#128C7E'
    font = input.font != null && Number.isInteger(input.font) && input.font >= 0 && input.font <= 10 ? input.font : 0
  } else {
    if (text.length > STATUS_CAPTION_MAX) throw new Error(`A legenda tem no máximo ${STATUS_CAPTION_MAX} letras`)
    const f = input.media
    if (!f) throw new Error(input.kind === 'imagem' ? 'Escolha a foto' : 'Escolha o vídeo')
    if (f.data.length > STATUS_MEDIA_MAX_BYTES) throw new Error('Arquivo maior que 16 MB. Reduza antes de postar.')
    if (input.kind === 'imagem' && !/^image\/(jpeg|png|webp)$/.test(f.mime))
      throw new Error('Use foto em JPG, PNG ou WEBP')
    if (input.kind === 'video' && f.mime !== 'video/mp4') throw new Error('Use vídeo em MP4')
  }

  if (input.audience.modo !== 'todos' && !input.audience.tags.filter(Boolean).length)
    throw new Error('Escolha a etiqueta')
  if (!statusAudienceJids(input.accountId, input.audience).length)
    throw new Error('Ninguém no público escolhido tem WhatsApp confirmado')

  const limit = getStatusSettings(input.accountId).dailyLimit
  if (postsOnDay(input.accountId, when) >= limit)
    throw new Error(`Limite de ${limit} postagens de status por dia atingido. Agende para outro dia.`)

  let media: StatusMedia | null = null
  if (input.kind !== 'texto' && input.media) {
    const f = input.media
    mkdirSync(mediaDir(), { recursive: true })
    const ext = input.kind === 'video' ? 'mp4' : f.mime.split('/')[1].replace('jpeg', 'jpg')
    media = { name: f.name.slice(0, 200), mime: f.mime, file: `${randomUUID()}.${ext}`, size: f.data.length }
    writeFileSync(statusMediaPath(media), f.data)
  }

  const id = Number(
    getDb()
      .prepare(
        `INSERT INTO status_posts (account_id, kind, text, media, background, font, audience, scheduled_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agendado', ?)`
      )
      .run(
        input.accountId,
        input.kind,
        text || null,
        media ? JSON.stringify(media) : null,
        background,
        font,
        JSON.stringify({ modo: input.audience.modo, tags: input.audience.tags.filter(Boolean) }),
        when,
        now
      ).lastInsertRowid
  )
  return getStatusPost(id)!
}

export function cancelStatusPost(accountId: string, id: number): StatusPost {
  const p = getStatusPost(id)
  if (!p || p.accountId !== accountId) throw new Error('Postagem não encontrada')
  if (p.status !== 'agendado') throw new Error('Só dá para cancelar postagens que ainda não saíram')
  getDb().prepare("UPDATE status_posts SET status = 'cancelado' WHERE id = ? AND status = 'agendado'").run(id)
  removeMedia(p.media)
  return getStatusPost(id)!
}

function finish(id: number, status: StatusPostState, extra: { error?: string; recipients?: number; messageId?: string } = {}): void {
  getDb()
    .prepare(
      'UPDATE status_posts SET status = ?, error = ?, sent_at = ?, recipients_count = COALESCE(?, recipients_count), message_id = COALESCE(?, message_id) WHERE id = ?'
    )
    .run(
      status,
      extra.error ?? null,
      status === 'enviado' ? Date.now() : null,
      extra.recipients ?? null,
      extra.messageId ?? null,
      id
    )
}

function contentOf(p: StatusPost): AnyMessageContent {
  if (p.kind === 'texto') return { text: p.text ?? '' }
  const data = readFileSync(statusMediaPath(p.media!))
  const caption = p.text ?? undefined
  if (p.kind === 'imagem') return { image: data, caption, mimetype: p.media!.mime }
  return { video: data, caption, mimetype: 'video/mp4' }
}

/** Posta uma postagem agendada já vencida. Devolve o estado final, ou 'agendado' se ficou para depois. */
export async function postStatus(p: StatusPost, sock: WASocket): Promise<StatusPostState> {
  const limit = getStatusSettings(p.accountId).dailyLimit
  if (postsOnDay(p.accountId, Date.now(), false) >= limit) {
    finish(p.id, 'falhou', { error: `Limite de ${limit} postagens de status por dia atingido` })
    return 'falhou'
  }
  const jids = statusAudienceJids(p.accountId, p.audience)
  if (!jids.length) {
    finish(p.id, 'falhou', { error: 'Ninguém no público escolhido tem WhatsApp confirmado' })
    return 'falhou'
  }
  // Marca antes de enviar: se o app fechar no meio, não posta em dobro ao reabrir
  const claimed = getDb()
    .prepare("UPDATE status_posts SET status = 'enviando', sent_at = ? WHERE id = ? AND status = 'agendado'")
    .run(Date.now(), p.id)
  if (!claimed.changes) return getStatusPost(p.id)?.status ?? 'cancelado'
  if (jids.length > STATUS_LARGE_AUDIENCE)
    log.warn('Status para lista grande', { postagem: p.id, pessoas: jids.length, teto: STATUS_LARGE_AUDIENCE })
  // O próprio número entra na lista para o status aparecer também no celular da loja
  const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null
  const statusJidList = me && !jids.includes(me) ? [...jids, me] : jids
  try {
    const opts: { statusJidList: string[]; backgroundColor?: string; font?: number } = { statusJidList }
    if (p.kind === 'texto') {
      if (p.background) opts.backgroundColor = p.background
      if (p.font) opts.font = p.font
    }
    const sent = await sock.sendMessage(STATUS_JID, contentOf(p), opts)
    finish(p.id, 'enviado', { recipients: jids.length, messageId: sent?.key.id ?? undefined })
    log.info('Status postado', { postagem: p.id, pessoas: jids.length })
    return 'enviado'
  } catch (e) {
    const msg = ((e as Error).message ?? String(e)).slice(0, 300)
    finish(p.id, 'falhou', { error: msg, recipients: jids.length })
    log.warn('Falha ao postar status', { postagem: p.id, erro: msg })
    return 'falhou'
  }
}

// ---------- Agendador ----------

const busy = new Set<string>()

/** Verifica as postagens vencidas de uma conta e posta as que puder. */
export async function runDueStatus(accountId: string, now = Date.now()): Promise<void> {
  if (busy.has(accountId)) return
  busy.add(accountId)
  let changed = false
  try {
    if (!getAccount(accountId)?.modules.status) return // módulo desligado: espera, não perde a postagem
    const due = (
      getDb()
        .prepare(
          "SELECT * FROM status_posts WHERE account_id = ? AND status = 'agendado' AND scheduled_at <= ? ORDER BY scheduled_at, id"
        )
        .all(accountId, now) as unknown as Row[]
    ).map(toPost)
    for (const p of due) {
      if (now - p.scheduledAt > MAX_LATE_MS) {
        finish(p.id, 'falhou', { error: 'Passou mais de 24 horas da hora marcada sem o WhatsApp conectado' })
        changed = true
        continue
      }
      const sock = wa.getSocket(accountId)
      if (!sock) break // desconectada: tenta de novo quando conectar
      await postStatus(p, sock)
      changed = true
    }
  } catch (e) {
    log.error('Erro no agendador de status', e)
  } finally {
    busy.delete(accountId)
    if (changed) statusEvents.emit('changed', { accountId })
  }
}

/** Postagem que ficou "enviando" (app fechou no meio) vira falha: não dá para saber se saiu. */
export function recoverInterrupted(): number {
  return Number(
    getDb()
      .prepare(
        "UPDATE status_posts SET status = 'falhou', error = 'O app fechou durante a postagem. Confira no celular se o status saiu.' WHERE status = 'enviando'"
      )
      .run().changes
  )
}

/** Apaga arquivos de mídia de postagens antigas (o status some do WhatsApp em 24 h). */
export function cleanupStatusMedia(now = Date.now()): void {
  const rows = getDb()
    .prepare(
      `SELECT id, media FROM status_posts WHERE media IS NOT NULL AND json_extract(media, '$.file') != ''
       AND status IN ('enviado','falhou','cancelado') AND COALESCE(sent_at, scheduled_at) < ?`
    )
    .all(now - MEDIA_KEEP_MS) as Array<{ id: number; media: string }>
  for (const r of rows) {
    removeMedia(JSON.parse(r.media) as StatusMedia)
    getDb()
      .prepare(`UPDATE status_posts SET media = json_set(media, '$.file', '') WHERE id = ?`)
      .run(r.id)
  }
}

export function kickStatus(accountId: string): void {
  void runDueStatus(accountId)
}

export function startStatus(): void {
  try {
    recoverInterrupted()
    cleanupStatusMedia()
  } catch (e) {
    log.error('Falha ao preparar o agendador de status', e)
  }
  const all = (): void => {
    for (const a of listAccounts()) void runDueStatus(a.id)
  }
  setTimeout(all, 5_000)
  setInterval(all, 30_000)
  // Ao conectar, posta o que ficou esperando a conexão
  wa.on('state', (s: { accountId: string; status: string }) => s.status === 'connected' && kickStatus(s.accountId))
}
