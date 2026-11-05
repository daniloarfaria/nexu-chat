import { app, net, protocol } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { downloadMediaMessage, normalizeMessageContent, type WAMessage, type WASocket } from 'baileys'
import type { MediaInfo } from '@shared/types'
import { getRawMessage, setMediaUrl, storeEvents } from './store'
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
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const root = mediaRoot()
    const file = normalize(join(root, url.hostname, rel))
    if (!file.startsWith(root + sep) || !existsSync(file)) return new Response('não encontrado', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
    // Defesa extra: o conteúdo servido nunca executa script e só imagem/áudio/vídeo abrem embutidos
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox")
    headers.set('X-Content-Type-Options', 'nosniff')
    if (!/^(image|audio|video)\//.test(headers.get('content-type') ?? ''))
      headers.set('Content-Disposition', 'attachment')
    return new Response(res.body, { status: res.status, headers })
  })
}

export function mediaUrl(accountId: string, file: string): string {
  return `${MEDIA_SCHEME}://${accountId}/${encodeURIComponent(file)}`
}

// Extensões aceitas para o arquivo guardado na pasta do app (nada que o navegador execute, como .html/.svg)
const SAFE_EXT = new Set([
  ...Object.values(EXT),
  'jpeg',
  'mov',
  'm4v',
  'opus',
  'wav',
  'amr',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'zip',
  'rar',
  'odt',
  'ods'
])

function extFor(media: MediaInfo): string {
  const mime = (media.mimetype ?? '').split(';')[0].trim()
  const fromName = media.fileName?.split('.').pop()?.toLowerCase()
  if (fromName && SAFE_EXT.has(fromName)) return fromName
  if (EXT[mime]) return EXT[mime]
  return 'bin'
}

const inflight = new Map<string, Promise<MediaInfo>>()
const MAX_MEDIA_BYTES = 120 * 1024 * 1024

/**
 * A mensagem diz de onde baixar a mídia. Só aceitamos servidores do WhatsApp:
 * evita que um remetente faça o app buscar endereços da rede local (SSRF).
 */
export function assertSafeMediaSource(msg: WAMessage): void {
  const m = normalizeMessageContent(msg.message)
  const c = m
    ? (Object.values(m).find((v) => v && typeof v === 'object' && ('directPath' in v || 'url' in v)) as
        { url?: string | null; directPath?: string | null } | undefined)
    : undefined
  if (!c) throw new Error('Mensagem sem mídia')
  if (c.url) {
    let host: string
    try {
      const u = new URL(c.url)
      if (u.protocol !== 'https:') throw new Error()
      host = u.hostname
    } catch {
      throw new Error('Endereço de mídia inválido')
    }
    if (!/(^|\.)(whatsapp\.net|whatsapp\.com)$/i.test(host))
      throw new Error('Mídia hospedada fora do WhatsApp foi bloqueada')
  }
  if (c.directPath && !/^\/[\w\-./=?&%]+$/.test(c.directPath)) throw new Error('Caminho de mídia inválido')
  if (!c.url && !c.directPath) throw new Error('Mídia sem endereço')
}

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

    assertSafeMediaSource(msg)
    // Baixa em fluxo com teto de tamanho (não confia no tamanho declarado pelo remetente)
    const stream = await downloadMediaMessage(
      msg,
      'stream',
      {},
      { logger: log.baileys(), reuploadRequest: (m) => sock.updateMediaMessage(m) }
    )
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.length
      if (total > MAX_MEDIA_BYTES) {
        ;(stream as unknown as { destroy(): void }).destroy()
        throw new Error('Arquivo grande demais para baixar pelo app (limite de 120 MB)')
      }
      chunks.push(chunk)
    }
    const buf = Buffer.concat(chunks)
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

/** Nome seguro para sugerir ao salvar um arquivo recebido. */
export function safeFileName(name: string | undefined, fallback: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? ''
  const clean = base
    // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return clean || fallback
}

/** Marca o arquivo como baixado da internet (Windows: Zone.Identifier; Mac: quarentena). */
export function markDownloaded(path: string): void {
  try {
    if (process.platform === 'win32') {
      writeFileSync(path + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\n')
    } else if (process.platform === 'darwin') {
      const ts = Math.floor(Date.now() / 1000).toString(16)
      execFile('xattr', ['-w', 'com.apple.quarantine', `0081;${ts};Disparador;`, path], () => undefined)
    }
  } catch {
    /* sem a marca o arquivo ainda é salvo */
  }
}

export function deleteMediaFiles(accountId: string, files: string[]): void {
  const dir = join(mediaRoot(), accountId)
  for (const f of files) {
    if (!/^[\w.-]+$/.test(f)) continue
    rmSync(join(dir, f), { force: true })
  }
}

// Mensagem apagada para todos: some também o arquivo
storeEvents.on('purge-media', ({ accountId, file }: { accountId: string; file: string }) =>
  deleteMediaFiles(accountId, [file])
)
