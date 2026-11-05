import { dialog, type BrowserWindow } from 'electron'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import type { WASocket } from 'baileys'
import { getAccount } from './accounts'
import { wa } from './wa/manager'
import * as store from './wa/store'
import * as send from './wa/send'
import { ensureMedia } from './wa/media'
import type { Handle } from './ipc'

const accountId = z.string().uuid()
// JIDs aceitos: usuário, LID ou grupo
const jid = z
  .string()
  .max(120)
  .regex(/^[\w.:-]+@(s\.whatsapp\.net|lid|g\.us)$/, 'Conversa inválida')
const msgId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/)

function account(id: string): void {
  if (!getAccount(id)) throw new Error('Conta não encontrada')
}

function sock(id: string): WASocket {
  account(id)
  const s = wa.getSocket(id)
  if (!s) throw new Error('O WhatsApp desta conta não está conectado')
  return s
}

export function registerChatIpc(handle: Handle, getWindow: () => BrowserWindow | null): void {
  handle(
    'chats:list',
    z
      .object({
        accountId,
        filter: z.enum(['all', 'unread', 'groups', 'archived']),
        search: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(500),
        offset: z.number().int().min(0)
      })
      .strict(),
    (a) => {
      account(a.accountId)
      return store.listChats(a.accountId, a)
    }
  )
  handle('chats:get', z.object({ accountId, jids: z.array(jid).max(200) }).strict(), (a) =>
    store.getChats(a.accountId, a.jids)
  )
  handle('chats:read', z.object({ accountId, jid }).strict(), async (a) => {
    account(a.accountId)
    await send.readChat(wa.getSocket(a.accountId), a.accountId, a.jid)
  })
  handle('chats:unread-total', z.object({ accountId }).strict(), (a) => store.unreadTotal(a.accountId))
  handle('chats:new', z.object({ accountId, phone: z.string().max(25) }).strict(), async (a) => {
    const s = sock(a.accountId)
    let digits = a.phone.replace(/\D/g, '')
    if (digits.length === 10 || digits.length === 11) digits = '55' + digits
    if (digits.length < 12) throw new Error('Número inválido. Use DDD + número.')
    const [r] = (await s.onWhatsApp(digits)) ?? []
    if (!r?.exists) throw new Error('Este número não tem WhatsApp')
    return store.canonJid(a.accountId, r.jid)
  })

  handle(
    'messages:list',
    z
      .object({
        accountId,
        jid,
        before: z.number().int().positive().nullable(),
        limit: z.number().int().min(1).max(300)
      })
      .strict(),
    (a) => {
      account(a.accountId)
      return store.listMessages(a.accountId, a.jid, a.before, a.limit)
    }
  )
  handle('messages:search', z.object({ accountId, query: z.string().min(2).max(100) }).strict(), (a) =>
    store.searchMessages(a.accountId, a.query)
  )
  handle(
    'messages:send-text',
    z.object({ accountId, jid, text: z.string().min(1).max(65_000), quotedId: msgId.nullable().optional() }).strict(),
    (a) => send.sendText(sock(a.accountId), a.accountId, a.jid, a.text, a.quotedId)
  )
  handle(
    'messages:send-file',
    z
      .object({
        accountId,
        jid,
        file: z.object({
          name: z.string().max(255),
          mime: z.string().max(120),
          data: z.instanceof(Uint8Array)
        }),
        caption: z.string().max(4096).optional(),
        asDocument: z.boolean().optional(),
        voice: z.boolean().optional(),
        quotedId: msgId.nullable().optional()
      })
      .strict(),
    (a) => send.sendFile(sock(a.accountId), a.accountId, a.jid, a.file, a)
  )
  handle(
    'messages:send-location',
    z
      .object({
        accountId,
        jid,
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        name: z.string().max(200).optional(),
        address: z.string().max(300).optional()
      })
      .strict(),
    (a) => send.sendLocation(sock(a.accountId), a.accountId, a.jid, a)
  )
  handle(
    'messages:send-contact',
    z.object({ accountId, jid, name: z.string().min(1).max(100), phone: z.string().min(8).max(25) }).strict(),
    (a) => send.sendContactCard(sock(a.accountId), a.accountId, a.jid, a)
  )
  handle(
    'messages:send-poll',
    z
      .object({
        accountId,
        jid,
        name: z.string().min(1).max(255),
        options: z.array(z.string().min(1).max(100)).min(2).max(12),
        multiple: z.boolean()
      })
      .strict(),
    (a) => send.sendPoll(sock(a.accountId), a.accountId, a.jid, a)
  )
  handle('messages:react', z.object({ accountId, jid, id: msgId, emoji: z.string().max(16) }).strict(), (a) =>
    send.react(sock(a.accountId), a.accountId, a.jid, a.id, a.emoji)
  )
  handle('messages:delete', z.object({ accountId, jid, id: msgId }).strict(), (a) =>
    send.deleteForEveryone(sock(a.accountId), a.accountId, a.jid, a.id)
  )
  handle('messages:edit', z.object({ accountId, jid, id: msgId, text: z.string().min(1).max(65_000) }).strict(), (a) =>
    send.editText(sock(a.accountId), a.accountId, a.jid, a.id, a.text)
  )

  handle('media:get', z.object({ accountId, jid, id: msgId }).strict(), (a) => {
    account(a.accountId)
    return ensureMedia(wa.getSocket(a.accountId), a.accountId, a.jid, a.id)
  })
  handle('media:save-as', z.object({ accountId, jid, id: msgId }).strict(), async (a) => {
    account(a.accountId)
    const m = (await ensureMedia(wa.getSocket(a.accountId), a.accountId, a.jid, a.id)) as {
      file?: string
      fileName?: string
    }
    if (!m.file) throw new Error('Mídia indisponível')
    const src = join(app.getPath('userData'), 'media', a.accountId, m.file)
    if (!existsSync(src)) throw new Error('Arquivo não encontrado')
    const win = getWindow()
    const opts = { defaultPath: join(app.getPath('downloads'), m.fileName ?? m.file) }
    const r = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts))
    if (!r.canceled && r.filePath) copyFileSync(src, r.filePath)
  })

  handle('sync:state', z.object({ accountId }).strict(), (a) => store.getSyncState(a.accountId))
}
