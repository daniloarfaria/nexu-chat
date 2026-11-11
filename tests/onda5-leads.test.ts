import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, getSetting, setSetting, openDb } from '../src/main/db'
import * as L from '../src/main/leadsPlanilha'

const ACC = '12121212-1212-4212-8212-121212121212'
const URL_A = 'https://script.google.com/macros/s/AAA/exec'
const URL_B = 'https://script.google.com/macros/s/BBB/exec'
const T0 = Date.now() - 5 * 86_400_000

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-onda5l-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica', '#000000', '{}', Date.now())
})
afterEach(() => vi.unstubAllGlobals())

const lead = (i: number): Record<string, unknown> => ({
  aba: 'Leads',
  ts: T0 + i * 1000,
  nome: `Cliente ${i}`,
  telefone: `1198765${String(1000 + i).slice(-4)}`
})

const respond = (leads: unknown[]): Response => new Response(JSON.stringify({ ok: true, leads }))

describe('item 10: trocar a URL limpa a paginação e descarta resultado antigo', () => {
  test('pendingSince e pendingOffset somem ao trocar a URL', () => {
    L.saveConfig(ACC, { url: URL_A, secret: 'segredo123' })
    const k = `leadsPlanilha:${ACC}`
    setSetting(k, { ...getSetting<Record<string, unknown>>(k, {}), cursor: 123, pendingSince: 5, pendingOffset: 2000 })
    L.saveConfig(ACC, { url: URL_B, secret: '' })
    const s = getSetting<Record<string, unknown>>(k, {})
    expect(s.cursor).toBeNull()
    expect(s.pendingSince).toBeUndefined()
    expect(s.pendingOffset).toBeUndefined()
  })

  test('sincronização em andamento quando a URL muda não grava o resultado da configuração antiga', async () => {
    L.saveConfig(ACC, { url: URL_A, secret: 'segredo123' })
    let release: (r: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
    )
    const run = L.syncLeads(ACC)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    L.saveConfig(ACC, { url: URL_B, secret: '' }) // o dono trocou o link no meio da atualização
    release(respond([lead(1), lead(2)]))
    const r = await run
    expect(r.ok).toBe(false)
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM leads').get() as { n: number }).n).toBe(0)
    expect(getSetting<Record<string, unknown>>(`leadsPlanilha:${ACC}`, {}).cursor).toBeNull()
  })
})

describe('item 12: criação de contatos não regrava a fila inteira a cada lead', () => {
  test('300 leads novos geram poucas gravações da fila e todos viram contato', async () => {
    L.saveConfig(ACC, { url: URL_A, secret: 'segredo123', createContacts: true })
    const db = getDb()
    db.exec('CREATE TABLE writes (n INTEGER)')
    db.exec(
      `CREATE TRIGGER cnt AFTER UPDATE ON settings WHEN NEW.key LIKE 'leadsContactsPending%' BEGIN INSERT INTO writes VALUES (1); END`
    )
    const leads = Array.from({ length: 300 }, (_, i) => ({ ...lead(i), telefone: `11${String(900000000 + i)}` }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(leads))
    )
    const r = await L.syncLeads(ACC)
    expect(r).toMatchObject({ ok: true, added: 300, contacts: 300 })
    const writes = (db.prepare('SELECT COUNT(*) AS n FROM writes').get() as { n: number }).n
    expect(writes).toBeLessThan(30)
    expect((db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n).toBe(300)
  })
})
