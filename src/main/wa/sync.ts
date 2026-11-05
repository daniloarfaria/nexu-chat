import { isJidGroup, jidNormalizedUser, type WASocket } from 'baileys'
import type { MessageItem } from '@shared/types'
import {
  canonJid,
  deleteChats,
  saveChats,
  saveContacts,
  saveLidMappings,
  saveMessages,
  setGroupName,
  storeEvents,
  syncProgress,
  updateStatus
} from './store'
import { ensureMedia, shouldAutoDownload } from './media'
import { log } from '../log'

/** Liga os eventos do Baileys ao banco local. */
export function attachStore(accountId: string, sock: WASocket): void {
  const ev = sock.ev
  const own = (): string | null => (sock.user?.id ? jidNormalizedUser(sock.user.id) : null)

  ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings, progress }) => {
    try {
      if (lidPnMappings?.length) saveLidMappings(accountId, lidPnMappings)
      saveContacts(accountId, contacts)
      saveChats(accountId, chats)
      saveMessages(accountId, messages, { live: false, ownJid: own() })
      syncProgress(accountId, progress, { messages: messages.length, chats: chats.length })
    } catch (e) {
      log.error('Falha ao gravar histórico', e)
    }
  })

  ev.on('lid-mapping.update', (m) => saveLidMappings(accountId, [m]))
  ev.on('contacts.upsert', (c) => saveContacts(accountId, c))
  ev.on('contacts.update', (c) => saveContacts(accountId, c))
  ev.on('chats.upsert', (c) => saveChats(accountId, c))
  ev.on('chats.update', (c) => saveChats(accountId, c, true))
  ev.on('chats.delete', (jids) => deleteChats(accountId, jids))

  ev.on('groups.upsert', (groups) => {
    for (const g of groups) if (g.id && g.subject) setGroupName(accountId, g.id, g.subject)
  })
  ev.on('groups.update', (groups) => {
    for (const g of groups) if (g.id && g.subject) setGroupName(accountId, g.id, g.subject)
  })

  ev.on('messages.upsert', ({ messages, type }) => {
    try {
      const fresh = saveMessages(accountId, messages, { live: type === 'notify', ownJid: own() })
      for (const m of fresh) {
        storeEvents.emit('incoming', { accountId, message: m })
        if (shouldAutoDownload(m.type, m.media)) {
          ensureMedia(sock, accountId, m.chatJid, m.id).catch(() => undefined)
        }
      }
    } catch (e) {
      log.error('Falha ao gravar mensagem', e)
    }
  })

  ev.on('messages.update', (updates) => {
    for (const u of updates) {
      if (!u.key.id || !u.key.remoteJid) continue
      if (u.update.status != null) updateStatus(accountId, u.key.remoteJid, u.key.id, u.update.status)
      if (u.update.message || u.update.messageStubType) {
        saveMessages(accountId, [{ key: u.key, ...u.update } as never], { live: false, ownJid: own() })
      }
    }
  })

  ev.on('message-receipt.update', (rs) => {
    for (const r of rs) {
      if (!r.key.id || !r.key.remoteJid) continue
      const st = r.receipt.playedTimestamp ? 5 : r.receipt.readTimestamp ? 4 : r.receipt.receiptTimestamp ? 3 : null
      if (st) updateStatus(accountId, r.key.remoteJid, r.key.id, st)
    }
  })

  // Reações chegam também como messages.upsert (reactionMessage) e são tratadas lá.

  ev.on('messages.delete', (d) => {
    if ('all' in d) deleteChats(accountId, [d.jid])
  })
}

/** Texto da notificação do sistema. */
export function notificationText(m: MessageItem, chatName: string): { title: string; body: string } {
  const isGroup = isJidGroup(m.chatJid)
  const body =
    m.text ??
    (
      {
        image: 'Foto',
        video: 'Vídeo',
        voice: 'Mensagem de voz',
        audio: 'Áudio',
        document: 'Documento',
        sticker: 'Figurinha',
        location: 'Localização',
        contact: 'Contato',
        poll: 'Enquete'
      } as Record<string, string>
    )[m.type] ??
    'Nova mensagem'
  return {
    title: chatName,
    body: isGroup && m.senderName ? `${m.senderName}: ${body}` : body
  }
}

export { canonJid }
