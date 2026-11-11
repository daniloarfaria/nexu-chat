import { z } from 'zod'
import type { Handle } from './ipc'
import { getAccount } from './accounts'
import {
  approveAttempt,
  discardAttemptById,
  getRecoverySettings,
  listFollowups,
  listQueue,
  recoveryStats,
  saveRecoverySettings,
  stopFollowupById
} from './recuperacao'

const accountId = z.string().uuid()
const id = z.number().int().positive()

function need(accId: string): void {
  const a = getAccount(accId)
  if (!a) throw new Error('Conta não encontrada')
  if (!a.modules.recuperacao)
    throw new Error('A recuperação de vendas está desligada. Ative em Configurações → Módulos.')
}

export function registerRecoveryIpc(handle: Handle): void {
  handle('recovery:settings-get', z.object({ accountId }).strict(), (a) => {
    need(a.accountId)
    return getRecoverySettings(a.accountId)
  })
  handle(
    'recovery:settings-save',
    z
      .object({
        accountId,
        patch: z
          .object({
            enabled: z.boolean(),
            mode: z.enum(['approve', 'auto']),
            idleHours: z.number().int().min(1).max(336),
            attempts: z.number().int().min(1).max(3),
            gapDays: z.tuple([z.number().int().min(1).max(30), z.number().int().min(1).max(30)]),
            stageIds: z.array(z.number().int().positive()).max(60),
            tags: z.array(z.string().min(1).max(40)).max(60),
            byInterest: z.boolean(),
            discountPct: z.number().int().min(0).max(50),
            discountFrom: z.number().int().min(1).max(3),
            discountValidDays: z.number().int().min(1).max(60),
            discountCapReais: z.number().min(0).max(100_000).nullable(),
            discountCondition: z.string().max(80),
            perDay: z.number().int().min(1).max(100)
          })
          .partial()
          .strict()
      })
      .strict(),
    (a) => {
      need(a.accountId)
      return saveRecoverySettings(a.accountId, a.patch)
    }
  )
  handle('recovery:queue', z.object({ accountId }).strict(), (a) => {
    need(a.accountId)
    return listQueue(a.accountId)
  })
  handle('recovery:approve', z.object({ accountId, id, text: z.string().max(1500).optional() }).strict(), (a) => {
    need(a.accountId)
    approveAttempt(a.accountId, a.id, a.text)
  })
  handle('recovery:discard', z.object({ accountId, id }).strict(), (a) => {
    need(a.accountId)
    discardAttemptById(a.accountId, a.id)
  })
  handle('recovery:followups', z.object({ accountId }).strict(), (a) => {
    need(a.accountId)
    return listFollowups(a.accountId)
  })
  handle('recovery:stop', z.object({ accountId, id }).strict(), (a) => {
    need(a.accountId)
    stopFollowupById(a.accountId, a.id)
  })
  handle('recovery:stats', z.object({ accountId, days: z.number().int().min(1).max(3650) }).strict(), (a) => {
    need(a.accountId)
    return recoveryStats(a.accountId, Date.now() - a.days * 86_400_000)
  })
}
