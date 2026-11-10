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
import { ensureMedia, markDownloaded, safeFileName } from './wa/media'
import { getAvatars } from './wa/avatars'
import { setTranscribeSettings, transcribe, transcribeStatus } from './wa/transcribe'
import type { Handle } from './ipc'
import { noteHumanMessage } from './iaAtendimento'

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
        filter: z.enum(['all', 'unread', 'groups', 'archived', 'waiting']),
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
  handle('chats:get', z.object({ accountId, jids: z.array(jid).max(200) }).strict(), (a) => {
    account(a.accountId)
    return store.getChats(a.accountId, a.jids)
  })
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
        beforeRid: z.number().int().positive().nullable().optional(),
        limit: z.number().int().min(1).max(300)
      })
      .strict(),
    (a) => {
      account(a.accountId)
      return store.listMessages(a.accountId, a.jid, a.before, a.limit, a.beforeRid)
    }
  )
  handle('messages:search', z.object({ accountId, query: z.string().min(2).max(100) }).strict(), (a) =>
    store.searchMessages(a.accountId, a.query)
  )
  handle(
    'messages:send-text',
    z.object({ accountId, jid, text: z.string().min(1).max(65_000), quotedId: msgId.nullable().optional() }).strict(),
    async (a) => {
      await send.sendText(sock(a.accountId), a.accountId, a.jid, a.text, a.quotedId)
      noteHumanMessage(a.accountId, a.jid) // quem digita no app assume a conversa
    }
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
    async (a) => {
      await send.sendFile(sock(a.accountId), a.accountId, a.jid, a.file, a)
      noteHumanMessage(a.accountId, a.jid)
    }
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
    // Nome vem do remetente: nada de pastas, caracteres de controle ou truques de direção do texto
    const opts = { defaultPath: join(app.getPath('downloads'), safeFileName(m.fileName, m.file)) }
    const r = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts))
    if (!r.canceled && r.filePath) {
      copyFileSync(src, r.filePath)
      markDownloaded(r.filePath) // mantém os avisos do sistema ao abrir arquivos vindos da internet
    }
  })

  handle('sync:state', z.object({ accountId }).strict(), (a) => store.getSyncState(a.accountId))
  handle('transcribe:message', z.object({ accountId, jid, id: msgId }).strict(), (a) => {
    account(a.accountId)
    return transcribe(wa.getSocket(a.accountId), a.accountId, a.jid, a.id)
  })
  handle('transcribe:status', null, () => transcribeStatus())
  handle(
    'transcribe:save',
    z
      .object({
        mode: z.enum(['off', 'manual', 'auto']).optional(),
        engine: z.enum(['auto', 'local', 'groq']).optional()
      })
      .strict(),
    (a) => {
      setTranscribeSettings(a)
      return transcribeStatus()
    }
  )
  handle('transcribe:pick', z.object({ what: z.enum(['whisper', 'model', 'ffmpeg']) }).strict(), async (a) => {
    const win = getWindow()
    const opts = {
      title:
        a.what === 'model'
          ? 'Escolha o modelo do Whisper (ggml-*.bin)'
          : a.what === 'whisper'
            ? 'Escolha o whisper-cli'
            : 'Escolha o ffmpeg',
      properties: ['openFile' as const],
      ...(a.what === 'model' ? { filters: [{ name: 'Modelo Whisper', extensions: ['bin'] }] } : {})
    }
    const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    if (!r.canceled && r.filePaths[0]) {
      setTranscribeSettings(
        a.what === 'model'
          ? { modelPath: r.filePaths[0] }
          : a.what === 'whisper'
            ? { whisperPath: r.filePaths[0] }
            : { ffmpegPath: r.filePaths[0] }
      )
    }
    return transcribeStatus()
  })
  handle('avatars:get', z.object({ accountId, jids: z.array(jid).max(200) }).strict(), (a) => {
    account(a.accountId)
    return getAvatars(a.accountId, a.jids)
  })
}
