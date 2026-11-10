import { z } from 'zod'
import { NOTE_KINDS } from '@shared/types'
import type { Handle } from './ipc'
import { getAccount } from './accounts'
import * as N from './notes'
import { mapProfile } from './ai/profile'

const accountId = z.string().uuid()
const id = z.number().int().positive()
const jid = z
  .string()
  .max(120)
  .regex(/^[\w.:-]+@(s\.whatsapp\.net|lid|g\.us)$/)

/** Alvo: o contato, ou a conversa dele. */
const target = { personId: id.optional(), chatJid: jid.optional() }

const note = z
  .object({
    id: id.optional(),
    kind: z.enum(NOTE_KINDS),
    title: z.string().max(200),
    body: z.string().max(10_000),
    pinned: z.boolean().optional()
  })
  .strict()

function need(acc: string, mod: 'conversas' | 'perfilIa'): void {
  const a = getAccount(acc)
  if (!a) throw new Error('Conta não encontrada')
  if (!a.modules[mod]) throw new Error('Este módulo está desligado. Ative em Configurações → Módulos.')
}

export function registerNotesIpc(handle: Handle): void {
  handle('notes:list', z.object({ accountId, ...target }).strict(), (a) => {
    need(a.accountId, 'conversas')
    const personId = N.resolveTarget(a.accountId, a, false)
    return { personId, notes: personId == null ? [] : N.listNotes(a.accountId, personId) }
  })
  handle('notes:save', z.object({ accountId, ...target, note }).strict(), (a) => {
    need(a.accountId, 'conversas')
    return N.saveNote(a.accountId, N.resolveTarget(a.accountId, a, true)!, a.note)
  })
  handle('notes:pin', z.object({ accountId, id, pinned: z.boolean() }).strict(), (a) => {
    need(a.accountId, 'conversas')
    N.pinNote(a.accountId, a.id, a.pinned)
  })
  handle('notes:delete', z.object({ accountId, id }).strict(), (a) => {
    need(a.accountId, 'conversas')
    N.deleteNote(a.accountId, a.id)
  })
  handle('notes:map', z.object({ accountId, ...target }).strict(), (a) => {
    need(a.accountId, 'conversas')
    need(a.accountId, 'perfilIa')
    return mapProfile(a.accountId, a)
  })
  handle('dates:info', z.object({ accountId, ...target }).strict(), (a) => {
    need(a.accountId, 'conversas')
    const personId = N.resolveTarget(a.accountId, a, false)
    if (personId == null) return { personId: null, history: [], suggestion: null }
    return {
      personId,
      history: N.dateHistory(a.accountId, personId),
      suggestion: N.birthdaySuggestion(a.accountId, personId)
    }
  })
  handle('dates:birthday-set', z.object({ accountId, personId: id, birthday: z.string().max(20) }).strict(), (a) => {
    need(a.accountId, 'conversas')
    return N.setBirthday(a.accountId, a.personId, a.birthday)
  })
  handle('dates:suggestion-dismiss', z.object({ accountId, personId: id }).strict(), (a) => {
    need(a.accountId, 'conversas')
    N.dismissBirthdaySuggestion(a.accountId, a.personId)
  })
}
