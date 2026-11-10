import { generateMessageIDV2, proto, type AnyMessageContent, type WAMessage, type WASocket } from 'baileys'
import type { MediaInfo, OutgoingFile } from '@shared/types'
import { getRawMessage, markChatRead, saveMessages, setMediaUrl } from './store'
import { storeOwnMedia } from './media'
import { webmToOgg } from './ogg'
import { getDb } from '../db'

/** Envio de mensagens de todos os tipos, já gravando no banco local. */

const MAX_FILE = 100 * 1024 * 1024

/**
 * Ids das mensagens que o próprio app enviou (por conta). O WhatsApp devolve cada envio como evento
 * "fromMe"; com isso dá para saber que uma mensagem sua foi digitada no celular (id desconhecido).
 */
const ownIds = new Map<string, number>()
const OWN_ID_TTL = 5 * 60_000
export function wasSentByApp(accountId: string, id: string): boolean {
  const t = ownIds.get(`${accountId}:${id}`)
  return t != null && Date.now() - t < OWN_ID_TTL
}
function rememberOwnId(accountId: string, id: string): void {
  const now = Date.now()
  if (ownIds.size > 500) for (const [k, t] of ownIds) if (now - t > OWN_ID_TTL) ownIds.delete(k)
  ownIds.set(`${accountId}:${id}`, now)
}

export async function sendAndStore(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  content: AnyMessageContent,
  quotedId?: string | null
): Promise<WAMessage | undefined> {
  const quoted = quotedId ? getRawMessage(accountId, chatJid, quotedId) : null
  const messageId = generateMessageIDV2(sock.user?.id)
  rememberOwnId(accountId, messageId)
  const sent = await sock.sendMessage(chatJid, content, { messageId, ...(quoted ? { quoted } : {}) })
  if (sent) saveMessages(accountId, [sent], { live: false, ownJid: sock.user?.id ?? null })
  return sent
}

export async function sendText(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  text: string,
  quotedId?: string | null
): Promise<void> {
  await sendAndStore(sock, accountId, chatJid, { text }, quotedId)
}

export function kindForMime(mime: string, asDocument: boolean): 'image' | 'video' | 'audio' | 'document' | 'sticker' {
  if (asDocument) return 'document'
  if (mime === 'image/webp') return 'sticker'
  if (/^image\/(jpeg|png|gif)$/.test(mime)) return 'image'
  if (/^video\/(mp4|3gpp|quicktime)$/.test(mime)) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

export async function sendFile(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  file: OutgoingFile,
  opts: { caption?: string; asDocument?: boolean; voice?: boolean; quotedId?: string | null }
): Promise<void> {
  let data = Buffer.from(file.data)
  let seconds: number | undefined
  if (!data.length) throw new Error('Arquivo vazio')
  if (opts.voice && /webm/.test(file.mime)) {
    // gravação do app (WebM) → Ogg/Opus, formato de mensagem de voz do WhatsApp
    const r = webmToOgg(data)
    data = Buffer.from(r.ogg)
    seconds = r.seconds
  }
  if (data.length > MAX_FILE) throw new Error('Arquivo maior que 100 MB')
  const mime = file.mime || 'application/octet-stream'
  const kind = opts.voice ? 'audio' : kindForMime(mime, !!opts.asDocument)
  const caption = opts.caption?.trim() || undefined
  let content: AnyMessageContent
  switch (kind) {
    case 'image':
      content = { image: data, caption, mimetype: mime }
      break
    case 'video':
      content = { video: data, caption, mimetype: mime === 'video/quicktime' ? 'video/mp4' : mime }
      break
    case 'sticker':
      content = { sticker: data }
      break
    case 'audio':
      content = { audio: data, mimetype: opts.voice ? 'audio/ogg; codecs=opus' : mime, ptt: !!opts.voice, seconds }
      break
    default:
      content = { document: data, mimetype: mime, fileName: file.name || 'arquivo', caption }
  }
  const sent = await sendAndStore(sock, accountId, chatJid, content, opts.quotedId)
  if (sent?.key.id) {
    const row = getDb()
      .prepare('SELECT chat_jid, media FROM messages WHERE account_id = ? AND id = ? LIMIT 1')
      .get(accountId, sent.key.id) as { chat_jid: string; media: string | null } | undefined
    if (row?.media) {
      const media = storeOwnMedia(accountId, row.chat_jid, sent.key.id, data, JSON.parse(row.media) as MediaInfo)
      setMediaUrl(accountId, row.chat_jid, sent.key.id, media)
    }
  }
}

export async function sendLocation(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  loc: { lat: number; lng: number; name?: string; address?: string }
): Promise<void> {
  await sendAndStore(sock, accountId, chatJid, {
    location: { degreesLatitude: loc.lat, degreesLongitude: loc.lng, name: loc.name, address: loc.address }
  })
}

export async function sendContactCard(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  contact: { name: string; phone: string }
): Promise<void> {
  const digits = contact.phone.replace(/\D/g, '')
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${contact.name.replace(/[\r\n;]/g, ' ')}`,
    `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`,
    'END:VCARD'
  ].join('\n')
  await sendAndStore(sock, accountId, chatJid, { contacts: { displayName: contact.name, contacts: [{ vcard }] } })
}

export async function sendPoll(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  poll: { name: string; options: string[]; multiple: boolean }
): Promise<void> {
  await sendAndStore(sock, accountId, chatJid, {
    poll: { name: poll.name, values: poll.options, selectableCount: poll.multiple ? poll.options.length : 1 }
  })
}

export async function react(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  id: string,
  emoji: string
): Promise<void> {
  const msg = getRawMessage(accountId, chatJid, id)
  if (!msg) throw new Error('Mensagem não encontrada')
  await sendAndStore(sock, accountId, chatJid, { react: { text: emoji, key: msg.key } })
}

export async function deleteForEveryone(sock: WASocket, accountId: string, chatJid: string, id: string): Promise<void> {
  const msg = getRawMessage(accountId, chatJid, id)
  if (!msg?.key.fromMe) throw new Error('Só é possível apagar mensagens enviadas por você')
  await sendAndStore(sock, accountId, chatJid, { delete: msg.key })
}

export async function editText(
  sock: WASocket,
  accountId: string,
  chatJid: string,
  id: string,
  text: string
): Promise<void> {
  const msg = getRawMessage(accountId, chatJid, id)
  if (!msg?.key.fromMe) throw new Error('Só é possível editar mensagens enviadas por você')
  const age = Date.now() / 1000 - Number(msg.messageTimestamp ?? 0)
  if (age > 15 * 60) throw new Error('O WhatsApp só permite editar até 15 minutos depois do envio')
  await sendAndStore(sock, accountId, chatJid, { text, edit: msg.key })
}

/** Marca a conversa como lida no WhatsApp (envia confirmação de leitura). */
export async function readChat(sock: WASocket | null, accountId: string, chatJid: string): Promise<void> {
  markChatRead(accountId, chatJid)
  if (!sock) return
  const rows = getDb()
    .prepare(
      'SELECT raw FROM messages WHERE account_id = ? AND chat_jid = ? AND from_me = 0 AND status < 4 ORDER BY ts DESC LIMIT 30'
    )
    .all(accountId, chatJid) as Array<{ raw: Uint8Array | null }>
  const keys = rows
    .map((r) => (r.raw ? getRawFromBlob(r.raw).key : null))
    .filter((k): k is NonNullable<typeof k> => !!k?.id)
  if (keys.length) {
    await sock.readMessages(keys).catch(() => undefined)
    getDb()
      .prepare('UPDATE messages SET status = 4 WHERE account_id = ? AND chat_jid = ? AND from_me = 0 AND status < 4')
      .run(accountId, chatJid)
  }
}

function getRawFromBlob(b: Uint8Array): WAMessage {
  return proto.WebMessageInfo.decode(b) as WAMessage
}
