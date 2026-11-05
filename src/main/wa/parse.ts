import { normalizeMessageContent, type proto, type WAMessage } from 'baileys'
import type { MediaInfo, MessageExtra, MessageType } from '@shared/types'

export interface Parsed {
  type: MessageType
  text: string | null
  media: MediaInfo | null
  extra: MessageExtra | null
  quotedId: string | null
}

/** Mensagens que não viram balão: alteram outra (reação, edição, apagar) ou são de controle. */
export type Mutation =
  | { kind: 'reaction'; targetId: string; emoji: string }
  | { kind: 'revoke'; targetId: string }
  | { kind: 'edit'; targetId: string; text: string }
  | { kind: 'ignore' }

const thumb = (b?: Uint8Array | null): string | undefined =>
  b && b.length ? `data:image/jpeg;base64,${Buffer.from(b).toString('base64')}` : undefined

const num = (v: unknown): number | undefined =>
  v == null ? undefined : typeof v === 'number' ? v : Number(v as number) || undefined

function vcardPhones(vcard?: string | null): string[] {
  if (!vcard) return []
  vcard = vcard.slice(0, 8000) // vCard real é pequeno; limita entrada maliciosa
  return [...vcard.matchAll(/waid=(\d+)|TEL[^:]*:([+\d\s()-]+)/g)]
    .map((m) => (m[1] ?? m[2] ?? '').replace(/\D/g, ''))
    .filter(Boolean)
}

function contextOf(m: proto.IMessage): proto.IContextInfo | null | undefined {
  for (const v of Object.values(m)) {
    if (v && typeof v === 'object' && 'contextInfo' in v) return (v as { contextInfo?: proto.IContextInfo }).contextInfo
  }
  return null
}

export function previewOf(type: MessageType, text: string | null, media: MediaInfo | null): string {
  const label: Partial<Record<MessageType, string>> = {
    image: 'Foto',
    video: 'Vídeo',
    gif: 'GIF',
    audio: 'Áudio',
    voice: 'Mensagem de voz',
    document: 'Documento: ' + (media?.fileName ?? 'arquivo'),
    sticker: 'Figurinha',
    location: 'Localização',
    contact: 'Contato',
    poll: 'Enquete',
    event: 'Evento',
    call: 'Chamada'
  }
  if (text && type !== 'document') return (label[type] && type !== 'text' ? label[type] + ': ' : '') + text
  return label[type] ?? text ?? ''
}

/** Identifica mensagens que modificam outras. Retorna null se for uma mensagem normal. */
export function mutationOf(msg: WAMessage): Mutation | null {
  const m = normalizeMessageContent(msg.message)
  if (!m) return { kind: 'ignore' }
  if (m.reactionMessage?.key?.id) {
    return { kind: 'reaction', targetId: m.reactionMessage.key.id, emoji: m.reactionMessage.text ?? '' }
  }
  const p = m.protocolMessage
  if (p) {
    if (p.type === 0 && p.key?.id) return { kind: 'revoke', targetId: p.key.id } // REVOKE
    if (p.type === 14 && p.key?.id) {
      const e = normalizeMessageContent(p.editedMessage)
      const text =
        e?.conversation ?? e?.extendedTextMessage?.text ?? e?.imageMessage?.caption ?? e?.videoMessage?.caption
      if (text != null) return { kind: 'edit', targetId: p.key.id, text }
    }
    return { kind: 'ignore' }
  }
  if (m.editedMessage?.message) {
    const inner = m.editedMessage.message.protocolMessage
    if (inner?.key?.id) {
      const e = normalizeMessageContent(inner.editedMessage)
      const text = e?.conversation ?? e?.extendedTextMessage?.text
      if (text != null) return { kind: 'edit', targetId: inner.key.id, text }
    }
  }
  if (m.senderKeyDistributionMessage && Object.keys(m).length <= 2) return { kind: 'ignore' }
  if (m.pollUpdateMessage || m.keepInChatMessage || m.pinInChatMessage || m.encReactionMessage)
    return { kind: 'ignore' }
  // Cabeçalho de álbum (as fotos chegam como mensagens próprias) e aviso de histórico não viram balão
  if (m.albumMessage || m.messageHistoryNotice) return { kind: 'ignore' }
  return null
}

export function parseMessage(msg: WAMessage): Parsed {
  if (msg.messageStubType) {
    return { type: 'system', text: null, media: null, extra: { label: stubLabel(msg) }, quotedId: null }
  }
  const raw = msg.message
  const viewOnce = !!(raw?.viewOnceMessage || raw?.viewOnceMessageV2 || raw?.viewOnceMessageV2Extension)
  const m = normalizeMessageContent(raw)
  const out: Parsed = { type: 'unsupported', text: null, media: null, extra: null, quotedId: null }
  if (!m) return out

  const ctx = contextOf(m)
  if (ctx?.stanzaId) {
    out.quotedId = ctx.stanzaId
    const q = ctx.quotedMessage ? parseContent(normalizeMessageContent(ctx.quotedMessage)) : null
    out.extra = {
      quoted: {
        id: ctx.stanzaId,
        text: q ? previewOf(q.type, q.text, q.media) : '',
        type: q?.type ?? 'text',
        fromMe: false
      }
    }
    if (ctx.participant) out.extra.quoted!.senderName = ctx.participant
  }
  if (ctx?.isForwarded) out.extra = { ...(out.extra ?? {}), forwarded: true }

  const c = parseContent(m)
  out.type = c.type
  out.text = c.text
  out.media = c.media ? { ...c.media, ...(viewOnce ? { viewOnce: true } : {}) } : null
  if (c.extra) out.extra = { ...(out.extra ?? {}), ...c.extra }
  return out
}

function parseContent(m: proto.IMessage | undefined): Omit<Parsed, 'quotedId'> {
  const r: Omit<Parsed, 'quotedId'> = { type: 'unsupported', text: null, media: null, extra: null }
  if (!m) return r

  if (m.conversation != null) return { ...r, type: 'text', text: m.conversation }
  if (m.extendedTextMessage) return { ...r, type: 'text', text: m.extendedTextMessage.text ?? '' }

  if (m.imageMessage) {
    const i = m.imageMessage
    return {
      ...r,
      type: 'image',
      text: i.caption ?? null,
      media: {
        mimetype: i.mimetype ?? 'image/jpeg',
        size: num(i.fileLength),
        width: i.width ?? undefined,
        height: i.height ?? undefined,
        thumb: thumb(i.jpegThumbnail)
      }
    }
  }
  if (m.videoMessage) {
    const v = m.videoMessage
    return {
      ...r,
      type: v.gifPlayback ? 'gif' : 'video',
      text: v.caption ?? null,
      media: {
        mimetype: v.mimetype ?? 'video/mp4',
        size: num(v.fileLength),
        seconds: v.seconds ?? undefined,
        width: v.width ?? undefined,
        height: v.height ?? undefined,
        thumb: thumb(v.jpegThumbnail)
      }
    }
  }
  if (m.ptvMessage) {
    const v = m.ptvMessage
    return {
      ...r,
      type: 'video',
      media: {
        mimetype: v.mimetype ?? 'video/mp4',
        size: num(v.fileLength),
        seconds: v.seconds ?? undefined,
        thumb: thumb(v.jpegThumbnail)
      }
    }
  }
  if (m.audioMessage) {
    const a = m.audioMessage
    return {
      ...r,
      type: a.ptt ? 'voice' : 'audio',
      media: { mimetype: a.mimetype ?? 'audio/ogg', size: num(a.fileLength), seconds: a.seconds ?? undefined }
    }
  }
  const doc = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage
  if (doc) {
    return {
      ...r,
      type: 'document',
      text: doc.caption ?? null,
      media: {
        mimetype: doc.mimetype ?? 'application/octet-stream',
        fileName: doc.fileName ?? doc.title ?? 'arquivo',
        size: num(doc.fileLength),
        thumb: thumb(doc.jpegThumbnail)
      }
    }
  }
  if (m.stickerMessage) {
    const s = m.stickerMessage
    return {
      ...r,
      type: 'sticker',
      media: {
        mimetype: s.mimetype ?? 'image/webp',
        size: num(s.fileLength),
        width: s.width ?? undefined,
        height: s.height ?? undefined,
        animated: !!s.isAnimated
      }
    }
  }
  if (m.locationMessage || m.liveLocationMessage) {
    const l = m.locationMessage ?? m.liveLocationMessage!
    const lm = m.locationMessage
    return {
      ...r,
      type: 'location',
      text: m.liveLocationMessage?.caption ?? m.locationMessage?.comment ?? null,
      extra: {
        location: {
          lat: l.degreesLatitude ?? 0,
          lng: l.degreesLongitude ?? 0,
          name: lm?.name ?? undefined,
          address: lm?.address ?? undefined,
          live: !!m.liveLocationMessage
        }
      }
    }
  }
  if (m.contactMessage) {
    const ct = m.contactMessage
    return {
      ...r,
      type: 'contact',
      extra: { contacts: [{ name: ct.displayName ?? 'Contato', vcard: ct.vcard ?? '', phones: vcardPhones(ct.vcard) }] }
    }
  }
  if (m.contactsArrayMessage) {
    const list = (m.contactsArrayMessage.contacts ?? []).map((ct) => ({
      name: ct.displayName ?? 'Contato',
      vcard: ct.vcard ?? '',
      phones: vcardPhones(ct.vcard)
    }))
    return { ...r, type: 'contact', extra: { contacts: list } }
  }
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3 ?? m.pollCreationMessageV5
  if (poll) {
    return {
      ...r,
      type: 'poll',
      text: poll.name ?? null,
      extra: {
        poll: {
          name: poll.name ?? '',
          options: (poll.options ?? []).map((o) => o.optionName ?? ''),
          selectable: poll.selectableOptionsCount ?? 1
        }
      }
    }
  }
  if (m.eventMessage)
    return {
      ...r,
      type: 'event',
      text: m.eventMessage.name ?? null,
      extra: { label: m.eventMessage.description ?? undefined }
    }
  if (m.call) return { ...r, type: 'call', text: null }
  if (m.buttonsMessage) return { ...r, type: 'text', text: m.buttonsMessage.contentText ?? '' }
  if (m.templateMessage) {
    const t = m.templateMessage
    const text =
      t.hydratedTemplate?.hydratedContentText ??
      t.hydratedFourRowTemplate?.hydratedContentText ??
      t.interactiveMessageTemplate?.body?.text ??
      ''
    if (text) return { ...r, type: 'text', text }
  }
  if (m.listMessage)
    return { ...r, type: 'text', text: [m.listMessage.title, m.listMessage.description].filter(Boolean).join('\n') }
  if (m.buttonsResponseMessage) return { ...r, type: 'text', text: m.buttonsResponseMessage.selectedDisplayText ?? '' }
  if (m.listResponseMessage) return { ...r, type: 'text', text: m.listResponseMessage.title ?? '' }
  if (m.templateButtonReplyMessage)
    return { ...r, type: 'text', text: m.templateButtonReplyMessage.selectedDisplayText ?? '' }
  if (m.interactiveMessage?.body?.text) return { ...r, type: 'text', text: m.interactiveMessage.body.text }
  if (m.groupInviteMessage)
    return { ...r, type: 'text', text: `Convite para o grupo ${m.groupInviteMessage.groupName ?? ''}`.trim() }
  if (m.productMessage) return { ...r, type: 'text', text: m.productMessage.product?.title ?? 'Produto' }
  if (m.orderMessage) return { ...r, type: 'text', text: m.orderMessage.message ?? 'Pedido' }

  const keys = Object.keys(m).filter((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage')
  return { ...r, extra: { label: keys[0] ?? 'mensagem' } }
}

function stubLabel(msg: WAMessage): string {
  const p = msg.messageStubParameters ?? []
  switch (msg.messageStubType) {
    case 1:
      return 'Mensagem apagada'
    case 20:
      return 'Grupo criado'
    case 21:
      return `Nome do grupo alterado para "${p[0] ?? ''}"`
    case 27:
    case 31:
      return 'Participante adicionado'
    case 28:
      return 'Participante removido'
    case 32:
      return 'Participante saiu'
    case 29:
      return 'Promovido a admin'
    case 30:
      return 'Removido de admin'
    case 40:
    case 41:
    case 45:
    case 46:
      return 'Chamada perdida'
    case 2:
      return 'Mensagem não pôde ser lida neste aparelho (abra no celular)'
    default:
      return 'Atualização do grupo'
  }
}
