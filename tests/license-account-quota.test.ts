import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const h = vi.hoisted(() => ({ max: 3 }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))
vi.mock('../src/main/license', async () => {
  const { MODULE_KEYS } = await import('../src/shared/types')
  return { licenseStatus: () => ({ maxAccounts: h.max, modules: [...MODULE_KEYS] }) }
})
import { closeDb, getDb, openDb } from '../src/main/db'
import { createAccount, getAccount, listAccounts } from '../src/main/accounts'
import { wa } from '../src/main/wa/manager'
let root = ''
beforeEach(() => {
  h.max = 3
  root = mkdtempSync(join(tmpdir(), 'nexu-quota-'))
  openDb(join(root, 'dados.sqlite'))
})
afterEach(() => {
  wa.shutdown()
  closeDb()
  rmSync(root, { recursive: true, force: true })
})
test('reduzir quota bloqueia excedentes sem apagar contas ou autenticação', async () => {
  for (let i = 1; i <= 3; i++) {
    const account = createAccount(`Loja ${i}`, '#000000')
    getDb().prepare('UPDATE accounts SET created_at = ? WHERE id = ?').run(i, account.id)
  }
  const ids = listAccounts().map((a) => a.id)
  getDb()
    .prepare("INSERT INTO wa_auth(account_id,category,key_id,value) VALUES (?, 'creds', 'test', X'01')")
    .run(ids[2])
  h.max = 1
  const accounts = listAccounts()
  expect(accounts).toHaveLength(3)
  expect(accounts[0].licenseBlocked).toBe(false)
  expect(accounts[1].licenseBlocked).toBe(true)
  expect(accounts[2].autoConnect).toBe(false)
  expect(Object.values(accounts[2].modules).some(Boolean)).toBe(false)
  await expect(wa.connect(ids[2])).rejects.toThrow(/licença/)
  expect(wa.getSocket(ids[2])).toBeNull()
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM wa_auth').get()).toEqual({ n: 1 })
  h.max = 3
  expect(getAccount(ids[2])?.licenseBlocked).toBe(false)
})
test('quota de dez permite criar dez números e recusa o décimo primeiro', () => {
  h.max = 10
  for (let i = 0; i < 10; i++) createAccount(`Conta ${i}`, '#000000')
  expect(() => createAccount('Excesso', '#000000')).toThrow(/10 número/)
})
