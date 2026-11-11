import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({
  order: [] as string[],
  release: null as null | (() => void)
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))
vi.mock('../src/main/ai/router', () => ({
  complete: vi.fn(),
  getAiSettings: () => ({ privacy: 'anonimizar', paidMonthlyLimit: 300 })
}))
vi.mock('../src/main/outbox', () => ({ enqueueSend: () => true }))
vi.mock('../src/main/wa/manager', () => ({
  wa: { getSocket: () => ({}), on: () => undefined }
}))
vi.mock('../src/main/wa/send', () => ({
  sendAndStore: async () => undefined,
  wasSentByApp: () => false,
  // upload demorado: só termina quando o teste libera
  sendFile: () =>
    new Promise<void>((resolve) => {
      h.order.push('envio-comecou')
      h.release = resolve
    }),
  sendText: async () => {
    h.order.push('envio-texto')
  },
  sendLocation: async () => undefined,
  sendContactCard: async () => undefined,
  sendPoll: async () => undefined
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import { updateAccount } from '../src/main/accounts'
import { saveLidMappings } from '../src/main/wa/store'
import { registerChatIpc } from '../src/main/ipc-chat'
import * as R from '../src/main/iaAtendimento'

const ACC = '99999999-9999-4999-8999-999999999999'
const PN = '5511987650001@s.whatsapp.net'
const LID = '777@lid'

beforeEach(() => {
  h.order.length = 0
  R.resetRobotTimers()
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-onda5r-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica', '#000000', '{}', Date.now())
  updateAccount(ACC, { modules: { ia: true, iaAtendimento: true } })
  R.saveRobotSettings(ACC, { enabled: true })
})
afterEach(() => vi.clearAllMocks())

const put = (jid: string, mode: string, extra: string | null = null, reason: string | null = null): void => {
  getDb()
    .prepare(
      'INSERT INTO chat_ai_mode (account_id, chat_jid, mode, reason, extra, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(ACC, jid, mode, reason, extra, Date.now())
}
const modeOf = (jid: string): Record<string, unknown> | undefined =>
  getDb().prepare('SELECT * FROM chat_ai_mode WHERE account_id = ? AND chat_jid = ?').get(ACC, jid) as
    Record<string, unknown> | undefined

describe('item 3: fusão LID com número reconcilia o modo do robô', () => {
  test('humano no LID vence ia no número, e a instrução extra é preservada', () => {
    put(LID, 'humano', 'ofereça a armação X', 'atendente')
    put(PN, 'ia')
    saveLidMappings(ACC, [{ lid: LID, pn: PN }])
    expect(modeOf(LID)).toBeUndefined()
    expect(modeOf(PN)?.mode).toBe('humano')
    expect(modeOf(PN)?.extra).toBe('ofereça a armação X')
  })
  test('espera no LID vence ia; extra do destino tem prioridade', () => {
    put(LID, 'espera', 'do lid', 'pediu_humano')
    put(PN, 'ia', 'do numero')
    saveLidMappings(ACC, [{ lid: LID, pn: PN }])
    expect(modeOf(PN)?.mode).toBe('espera')
    expect(modeOf(PN)?.extra).toBe('do numero')
  })
  test('só o LID existe: o registro passa para o número', () => {
    put(LID, 'humano', null, 'atendente')
    saveLidMappings(ACC, [{ lid: LID, pn: PN }])
    expect(modeOf(PN)?.mode).toBe('humano')
  })
})

describe('item 4: quem envia pelo app assume antes do envio', () => {
  test('arquivo demorado: o robô já está em humano enquanto o upload acontece', async () => {
    const handlers = new Map<string, (a: Record<string, unknown>) => unknown>()
    registerChatIpc(
      ((ch: string, _schema: unknown, fn: (a: Record<string, unknown>) => unknown) => {
        handlers.set(ch, fn)
      }) as never,
      () => null
    )
    put(PN, 'ia')
    const p = handlers.get('messages:send-file')!({
      accountId: ACC,
      jid: PN,
      file: { name: 'a.pdf', mime: 'application/pdf', data: new Uint8Array(1) }
    }) as Promise<void>
    await vi.waitFor(() => expect(h.order).toContain('envio-comecou'))
    expect(modeOf(PN)?.mode).toBe('humano') // antes de o envio terminar
    h.release?.()
    await p
  })
})
