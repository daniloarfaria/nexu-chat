import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ZodType } from 'zod'
const h = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => h.root, on: () => undefined },
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))
vi.mock('../src/main/wa/manager', () => ({ wa: { getSocket: () => null, on: () => undefined } }))
import { closeDb, getDb, openDb } from '../src/main/db'
import * as people from '../src/main/people'
import { registerBusinessIpc } from '../src/main/ipc-business'
const ACC = '99999999-9999-4999-8999-999999999999'
const OTHER = '88888888-8888-4888-8888-888888888888'
const handlers = new Map<string, (a: unknown) => unknown>()
beforeEach(() => {
  h.root = mkdtempSync(join(tmpdir(), 'people-fields-'))
  openDb(join(h.root, 'db.sqlite'))
  for (const acc of [ACC, OTHER])
    getDb()
      .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(acc, 'Loja', '#000000', '{}', Date.now())
  registerBusinessIpc(
    ((channel: string, schema: ZodType, fn: (a: unknown) => unknown) => {
      handlers.set(channel, (a) => fn(schema.parse(a)))
    }) as never,
    () => null
  )
})
afterEach(() => {
  closeDb()
  rmSync(h.root, { recursive: true, force: true })
})
const invoke = (channel: string, args: unknown): unknown => {
  const fn = handlers.get(channel)
  expect(fn).toBeDefined()
  return fn!(args)
}
test('define campos por conta e une variáveis ao legado sem apagar valores na remoção', () => {
  const p = people.savePerson(ACC, { name: 'Ana', phone: '11987654321', fields: { cidade: 'Santos' } })
  invoke('people:set-field-definitions', { accountId: ACC, names: [' data_compra ', 'modelo'] })
  expect(invoke('people:field-definitions', { accountId: ACC })).toEqual(['data_compra', 'modelo'])
  expect(invoke('people:fields', { accountId: ACC })).toEqual(['cidade', 'data_compra', 'modelo'])
  expect(invoke('people:fields', { accountId: OTHER })).toEqual([])
  invoke('people:set-field-definitions', { accountId: ACC, names: [] })
  expect(people.getPerson(ACC, p.id)?.fields).toEqual({ cidade: 'Santos' })
  expect(people.customFieldNames(ACC)).toEqual(['cidade'])
})
test.each(
  [
    [''],
    ['x'.repeat(41)],
    ['cidade', ' CIDADE '],
    ['data compra', 'data_compra'],
    ['__proto__'],
    ['constructor'],
    ['prototype'],
    ['nome'],
    ['PRIMEIRO NOME'],
    ['loja'],
    Array.from({ length: 51 }, (_, i) => `campo${i}`)
  ].map((names) => ({ names }))
)('IPC rejeita definições inválidas $names', ({ names }) => {
  expect(() => invoke('people:set-field-definitions', { accountId: ACC, names })).toThrow()
})
test('IPC rejeita chaves perigosas nos valores do contato', () => {
  expect(() =>
    invoke('people:save', {
      accountId: ACC,
      name: 'Ana',
      phone: '11987654321',
      fields: JSON.parse('{"__proto__":"x"}')
    })
  ).toThrow()
})

test('registro persiste ao reabrir o banco e descoberta inclui contatos além dos primeiros 2000', () => {
  invoke('people:set-field-definitions', { accountId: ACC, names: ['modelo'] })
  closeDb()
  openDb(join(h.root, 'db.sqlite'))
  expect(invoke('people:field-definitions', { accountId: ACC })).toEqual(['modelo'])
  const insert = getDb().prepare(
    'INSERT INTO people (account_id, phone, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  getDb().exec('BEGIN')
  for (let i = 0; i < 2001; i++)
    insert.run(
      ACC,
      `55119876${String(i).padStart(4, '0')}`,
      JSON.stringify(i === 2000 ? { ultima_compra: '10/11/2026' } : { cidade: 'Santos' }),
      1,
      1
    )
  getDb().exec('COMMIT')
  expect(people.customFieldNames(ACC)).toEqual(['cidade', 'modelo', 'ultima_compra'])
})
