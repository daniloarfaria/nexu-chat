import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb, transaction } from '../src/main/db'
import * as L from '../src/main/leadsPlanilha'
import { savePerson } from '../src/main/people'
import { saveDeal } from '../src/main/deals'

const ACC = '44444444-4444-4444-8444-444444444444'
const T0 = Date.now() - 5 * 86_400_000
const S = Math.floor(T0 / 1000) // chats.last_ts fica em segundos
beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-report-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Conta', '#000000', '{}', Date.now())
})
afterEach(() => vi.restoreAllMocks())
function insert(id: number, phone: string | null, source: string | null = 'google', at = T0): void {
  getDb()
    .prepare(
      `INSERT INTO leads (account_id, dedupe_key, tab, created_at, phone, utm_source, imported_at)
    VALUES (?, ?, 'Leads', ?, ?, ?, ?)`
    )
    .run(ACC, String(id), at, phone, source, T0)
}

test('L1: casa JIDs e contato sem nono dígito com lead que tem nono dígito', () => {
  insert(1, '5511987650001')
  const p = savePerson(ACC, { name: 'Contato', phone: '551187650001' })
  getDb()
    .prepare('INSERT INTO chats (account_id, jid, last_ts) VALUES (?, ?, ?)')
    .run(ACC, '551187650001@s.whatsapp.net', S + 5)
  saveDeal(ACC, { chatJid: '551187650001@s.whatsapp.net', status: 'won', amountCents: 1234 })
  expect(L.listLeads(ACC, {}).items[0]).toMatchObject({ personId: p.id, chat: true, won: true, valueCents: 1234 })
})

test('L3: ignora conversa anterior e conta telefones distintos, incluindo variantes', () => {
  insert(1, '5511987650001')
  insert(2, '551187650001', 'google', T0 + 1)
  insert(3, '5511987650002')
  getDb()
    .prepare('INSERT INTO chats (account_id, jid, last_ts) VALUES (?, ?, ?)')
    .run(ACC, '551187650001@s.whatsapp.net', S + 5)
  getDb()
    .prepare('INSERT INTO chats (account_id, jid, last_ts) VALUES (?, ?, ?)')
    .run(ACC, '5511987650002@s.whatsapp.net', S - 5)
  expect(L.leadsReport(ACC, {}).total).toMatchObject({ leads: 3, talked: 1 })
  expect(L.listLeads(ACC, {}).items.find((p) => p.phone === '5511987650002')?.chat).toBe(false)
})

test('L2: relatório usa consultas por lote sem buscar posicionamentos por contato', () => {
  transaction(getDb(), () => {
    for (let id = 0; id < 100; id++) insert(id, `551198765${String(id).padStart(4, '0')}`)
  })
  const prepare = vi.spyOn(getDb(), 'prepare')
  expect(L.leadsReport(ACC, {}).total.leads).toBe(100)
  expect(prepare.mock.calls.length).toBeLessThan(12)
  expect(prepare.mock.calls.some(([sql]) => /pipeline_people|person_stages|placements/i.test(String(sql)))).toBe(false)
})

test('L2: pagina relatório além do antigo teto de 100000 leads', () => {
  const db = getDb()
  const stmt = db.prepare(`INSERT INTO leads (account_id, dedupe_key, tab, created_at, imported_at)
    VALUES (?, ?, 'Leads', ?, ?)`)
  transaction(db, () => {
    for (let id = 0; id < 100001; id++) stmt.run(ACC, String(id), T0, T0)
  })
  expect(L.leadsReport(ACC, {}).total.leads).toBe(100001)
})

test('L6: origem ausente não colide com valor real igual ao rótulo', () => {
  insert(1, null, null)
  insert(2, null, '(sem origem)')
  const rows = L.leadsReport(ACC, {}).bySource
  expect(rows).toHaveLength(2)
  expect(rows.map((r) => r.key)).toContain('(sem origem)')
  expect(new Set(rows.map((r) => r.key)).size).toBe(2)
})

test('S5: CSV protege origem que começa com quebra de linha e fórmula', () => {
  insert(1, null, '\n=cmd|x')
  expect(L.reportCsv(ACC, 'source', {})).toContain("'=cmd|x")
})
