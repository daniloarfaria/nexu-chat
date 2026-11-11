import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as C from '../src/main/campaigns'
import { lockChat } from '../src/main/outbox'

const ACC = '66666666-6666-4666-8666-666666666666'

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-onda5e-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica', '#000000', '{}', Date.now())
})

describe('item 5: limite diário e exclusão por conversa compartilhados', () => {
  test('a reserva do limite diário é atômica e nunca passa do limite', () => {
    expect(C.reserveDailySend(ACC, 2)).toBe(true)
    expect(C.reserveDailySend(ACC, 2)).toBe(true)
    expect(C.reserveDailySend(ACC, 2)).toBe(false)
    expect(C.sentToday(ACC)).toBe(2)
    C.releaseDailySend(ACC)
    expect(C.sentToday(ACC)).toBe(1)
    expect(C.reserveDailySend(ACC, 2)).toBe(true)
    C.releaseDailySend(ACC)
    C.releaseDailySend(ACC)
    C.releaseDailySend(ACC) // nunca fica negativo
    expect(C.sentToday(ACC)).toBe(0)
  })

  test('a mesma conversa não é usada por dois envios ao mesmo tempo', () => {
    const jid = '5511987650001@s.whatsapp.net'
    const a = lockChat(ACC, jid)
    expect(a).not.toBeNull()
    expect(lockChat(ACC, jid)).toBeNull()
    expect(lockChat(ACC, '5511987650002@s.whatsapp.net')).not.toBeNull()
    a?.()
    expect(lockChat(ACC, jid)).not.toBeNull()
  })
})
