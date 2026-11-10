import { z } from 'zod'
import type { Handle } from './ipc'
import { getAccount } from './accounts'
import * as S from './status'

const accountId = z.string().uuid()
const tag = z.string().trim().min(1).max(40)
const audience = z.object({ modo: z.enum(['todos', 'etiqueta', 'todos_menos']), tags: z.array(tag).max(20) }).strict()

function need(acc: string): void {
  const a = getAccount(acc)
  if (!a) throw new Error('Conta não encontrada')
  if (!a.modules.status) throw new Error('Este módulo está desligado. Ative em Configurações → Módulos.')
}

export function registerStatusIpc(handle: Handle): void {
  handle('status:list', z.object({ accountId }).strict(), (a) => S.listStatusPosts(a.accountId))
  handle(
    'status:create',
    z
      .object({
        accountId,
        kind: z.enum(['texto', 'imagem', 'video']),
        text: z.string().max(S.STATUS_CAPTION_MAX + 100),
        background: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable()
          .optional(),
        font: z.number().int().min(0).max(10).nullable().optional(),
        audience,
        scheduledAt: z.number().int().positive().nullable(),
        media: z
          .object({
            name: z.string().max(255),
            mime: z.string().max(120),
            data: z.instanceof(Uint8Array)
          })
          .strict()
          .nullable()
          .optional()
      })
      .strict(),
    (a) => {
      need(a.accountId)
      const p = S.createStatusPost(a)
      S.kickStatus(a.accountId)
      return p
    }
  )
  handle('status:cancel', z.object({ accountId, id: z.number().int().positive() }).strict(), (a) => {
    need(a.accountId)
    return S.cancelStatusPost(a.accountId, a.id)
  })
  handle('status:audience-count', z.object({ accountId, audience }).strict(), (a) =>
    S.countStatusAudience(a.accountId, a.audience)
  )
  handle('status:settings', z.object({ accountId }).strict(), (a) => ({
    ...S.getStatusSettings(a.accountId),
    postedToday: S.postsOnDay(a.accountId, Date.now(), false)
  }))
  handle(
    'status:settings-save',
    z.object({ accountId, dailyLimit: z.number().int().min(1).max(S.STATUS_DAILY_LIMIT_MAX) }).strict(),
    (a) => {
      need(a.accountId)
      return S.setStatusSettings(a.accountId, { dailyLimit: a.dailyLimit })
    }
  )
}
