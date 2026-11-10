import { z } from 'zod'
import type { Handle } from './ipc'
import { getAccount } from './accounts'
import {
  assumeChat,
  getChatAi,
  getRobotSettings,
  giveBackToAi,
  saveChatExtra,
  saveRobotSettings
} from './iaAtendimento'

const accountId = z.string().uuid()
const jid = z
  .string()
  .max(120)
  .regex(/^[\w.:-]+@(s\.whatsapp\.net|lid)$/, 'Conversa inválida')

function need(id: string): void {
  const a = getAccount(id)
  if (!a) throw new Error('Conta não encontrada')
  if (!a.modules.iaAtendimento)
    throw new Error('O robô de atendimento está desligado. Ative em Configurações → Módulos.')
}

export function registerRobotIpc(handle: Handle): void {
  handle('robot:settings-get', z.object({ accountId }).strict(), (a) => {
    need(a.accountId)
    return getRobotSettings(a.accountId)
  })
  handle(
    'robot:settings-save',
    z
      .object({
        accountId,
        patch: z
          .object({
            enabled: z.boolean(),
            when: z.enum(['new', 'always', 'away']),
            resumeMin: z.number().int().min(5).max(1440),
            perHour: z.number().int().min(1).max(60),
            perChat: z.number().int().min(1).max(30),
            handoffOnClose: z.boolean(),
            agentsText: z.string().max(3000)
          })
          .partial()
          .strict()
      })
      .strict(),
    (a) => {
      need(a.accountId)
      return saveRobotSettings(a.accountId, a.patch)
    }
  )
  handle('robot:chat-get', z.object({ accountId, jid }).strict(), (a) => {
    need(a.accountId)
    return getChatAi(a.accountId, a.jid)
  })
  handle('robot:chat-assume', z.object({ accountId, jid }).strict(), (a) => {
    need(a.accountId)
    return assumeChat(a.accountId, a.jid)
  })
  handle('robot:chat-give-back', z.object({ accountId, jid }).strict(), (a) => {
    need(a.accountId)
    return giveBackToAi(a.accountId, a.jid)
  })
  handle('robot:chat-extra', z.object({ accountId, jid, extra: z.string().max(1000) }).strict(), (a) => {
    need(a.accountId)
    return saveChatExtra(a.accountId, a.jid, a.extra)
  })
}
