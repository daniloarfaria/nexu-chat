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

import { closeDb, getDb, openDb } from '../src/main/db'
import { panel } from '../src/main/painel'

const A = '55555555-5555-4555-8555-555555555551'
const B = '55555555-5555-4555-8555-555555555552'
const DAY = 86_400_000
const NOW = Date.now()
const FROM = NOW - 30 * DAY
const TO = NOW + 1000

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-painel-')), 'db.sqlite'))
  const ins = getDb().prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
  ins.run(A, 'Loja A', '#000000', '{}', NOW)
  ins.run(B, 'Loja B', '#000000', '{}', NOW)
})
afterEach(() => vi.restoreAllMocks())

function deal(
  acc: string,
  jid: string,
  status: 'won' | 'lost',
  cents: number,
  src: string,
  at: number,
  reason?: string
): void {
  getDb()
    .prepare(
      `INSERT INTO deals (account_id, chat_jid, status, amount_cents, reason, source_type, created_at) VALUES (?,?,?,?,?,?,?)`
    )
    .run(acc, jid, status, cents, reason ?? null, src, at)
}
let seq = 0
function msg(acc: string, jid: string, tsMs: number, fromMe = 0): void {
  getDb()
    .prepare(`INSERT INTO messages (account_id, chat_jid, id, from_me, ts, type) VALUES (?,?,?,?,?,'text')`)
    .run(acc, jid, 'm' + ++seq, fromMe, Math.floor(tsMs / 1000))
}
const q = (over = {}): Parameters<typeof panel>[0] => ({
  accountIds: [A],
  from: FROM,
  to: TO,
  bucket: 'day',
  ...over
})

test('P1: totais de vendas, perdas e ticket médio, só do período e do número escolhido', () => {
  deal(A, '5511900000001@s.whatsapp.net', 'won', 10000, 'organic', NOW - DAY)
  deal(A, '5511900000002@s.whatsapp.net', 'won', 30000, 'campaign', NOW - 2 * DAY)
  deal(A, '5511900000003@s.whatsapp.net', 'lost', 0, 'organic', NOW - DAY, 'Preço')
  deal(A, '5511900000004@s.whatsapp.net', 'won', 99999, 'organic', NOW - 60 * DAY) // fora do período
  deal(B, '5511900000005@s.whatsapp.net', 'won', 5000, 'organic', NOW - DAY) // outro número
  const r = panel(q())
  expect(r.totals).toMatchObject({ revenueCents: 40000, won: 2, lost: 1, avgTicketCents: 20000 })
  expect(r.lostReasons).toEqual([{ reason: 'Preço', count: 1 }])
  expect(panel(q({ accountIds: [A, B] })).totals.revenueCents).toBe(45000)
})

test('P2: origens separam campanha, anúncio, recuperação, UTM da planilha e espontâneo', () => {
  deal(A, '5511911110001@s.whatsapp.net', 'won', 1000, 'campaign', NOW - DAY)
  deal(A, '5511911110002@s.whatsapp.net', 'won', 2000, 'ad', NOW - DAY)
  deal(A, '5511911110003@s.whatsapp.net', 'won', 4000, 'recovery', NOW - DAY)
  deal(A, '5511911110004@s.whatsapp.net', 'won', 8000, 'organic', NOW - DAY) // tem lead com UTM
  deal(A, '5511911110005@s.whatsapp.net', 'lost', 0, 'organic', NOW - DAY, 'Preço')
  getDb()
    .prepare(
      `INSERT INTO leads (account_id, dedupe_key, tab, created_at, phone, utm_source, imported_at) VALUES (?, 'k', 'Leads', ?, ?, 'google', ?)`
    )
    .run(A, NOW - 3 * DAY, '5511911110004', NOW)
  const r = panel(q())
  const by = Object.fromEntries(r.origins.map((o) => [o.kind, o]))
  expect(by.campaign).toMatchObject({ won: 1, revenueCents: 1000 })
  expect(by.ad).toMatchObject({ won: 1, revenueCents: 2000 })
  expect(by.recovery).toMatchObject({ won: 1, revenueCents: 4000 })
  expect(by.utm).toMatchObject({ won: 1, revenueCents: 8000 })
  expect(by.organic).toMatchObject({ won: 0, lost: 1 })
  expect(r.totals).toMatchObject({ recovered: 1, recoveredCents: 4000 })
  expect(r.coverage).toMatchObject({ hasLeadData: true, hasRecovery: true })
})

test('P3: conversa nova é a primeira mensagem recebida cair no período; conversão olha quem virou venda', () => {
  const novo = '5511922220001@s.whatsapp.net'
  msg(A, novo, NOW - 5 * DAY)
  msg(A, novo, NOW - 4 * DAY)
  msg(A, '5511922220002@s.whatsapp.net', NOW - 3 * DAY)
  msg(A, '5511922220003@s.whatsapp.net', NOW - 90 * DAY)
  msg(A, '5511922220003@s.whatsapp.net', NOW - 2 * DAY) // mensagem nova, mas a conversa é antiga
  msg(A, '120363@g.us', NOW - DAY) // grupo não conta
  msg(A, '5511922220009@s.whatsapp.net', NOW - DAY, 1) // só enviada por você: não é conversa nova
  deal(A, novo, 'won', 7000, 'organic', NOW - DAY)
  const r = panel(q())
  expect(r.totals.newChats).toBe(2)
  expect(r.totals.newChatsSold).toBe(1)
})

test('P4: faturamento por dia, semana e mês', () => {
  deal(A, '5511933330001@s.whatsapp.net', 'won', 1000, 'organic', NOW - DAY)
  deal(A, '5511933330002@s.whatsapp.net', 'won', 2000, 'organic', NOW - DAY)
  const d = panel(q()).revenue
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ revenueCents: 3000, won: 2 })
  expect(panel(q({ bucket: 'week' })).revenue[0].revenueCents).toBe(3000)
  expect(panel(q({ bucket: 'month' })).revenue[0].revenueCents).toBe(3000)
})

test('P5: funil mostra cartões por coluna, o que chegou até lá e o tempo parado', () => {
  const db = getDb()
  const pid = Number(
    db.prepare("INSERT INTO pipelines (account_id, name, created_at) VALUES (?, 'Vendas', ?)").run(A, NOW)
      .lastInsertRowid
  )
  const st = (name: string, kind: string, pos: number): number =>
    Number(
      db
        .prepare('INSERT INTO pipeline_stages (pipeline_id, name, kind, position) VALUES (?,?,?,?)')
        .run(pid, name, kind, pos).lastInsertRowid
    )
  const s1 = st('Novo', 'open', 0)
  const s2 = st('Orçamento', 'open', 1)
  const s3 = st('Fechou', 'won', 2)
  const s4 = st('Perdido', 'lost', 3)
  let n = 0
  const card = (stage: number, idle: number): void => {
    const p = Number(
      db
        .prepare('INSERT INTO people (account_id, name, phone, created_at, updated_at) VALUES (?,?,?,?,?)')
        .run(A, 'P' + n, '5511900' + String(++n).padStart(6, '0'), NOW, NOW).lastInsertRowid
    )
    db.prepare(
      'INSERT INTO pipeline_cards (pipeline_id, stage_id, person_id, position, created_at, moved_at) VALUES (?,?,?,?,?,?)'
    ).run(pid, stage, p, n, NOW - 20 * DAY, NOW - idle * DAY)
  }
  card(s1, 10)
  card(s1, 20)
  card(s1, 30)
  card(s1, 40)
  card(s2, 4)
  card(s2, 6)
  card(s3, 1)
  card(s4, 3)
  const r = panel(q({ pipelineId: pid }))
  expect(r.pipelines.map((p) => p.id)).toContain(pid)
  const f = r.funnel!.stages
  expect(f.map((s) => s.count)).toEqual([4, 2, 1, 1])
  expect(f.map((s) => s.reached)).toEqual([7, 3, 1, 0])
  expect(f[1].rateFromPrev).toBeCloseTo(3 / 7)
  expect(f[2].rateFromPrev).toBeCloseTo(1 / 3)
  expect(f[3].rateFromPrev).toBeNull()
  expect(f[0].avgIdleDays).toBeCloseTo(25, 0)
  // funil de outro número não aparece
  expect(panel(q({ accountIds: [B], pipelineId: pid })).funnel).toBeNull()
})

test('P6: consultas usam índice (sem varredura da tabela inteira)', () => {
  const db = getDb()
  const plan = (sql: string, ...args: Array<string | number>): string =>
    (db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join(' | ')
  const dealsPlan = plan(
    `SELECT source_type, status, SUM(amount_cents) FROM deals WHERE account_id IN (?) AND created_at >= ? AND created_at < ? GROUP BY source_type, status`,
    A,
    0,
    1
  )
  expect(dealsPlan).toMatch(/USING (COVERING )?INDEX deals_/)
  expect(dealsPlan).not.toMatch(/SCAN deals(?! USING)/)
  const newPlan = plan(
    `SELECT account_id, chat_jid, MIN(ts) FROM messages WHERE account_id IN (?) AND from_me = 0 GROUP BY account_id, chat_jid`,
    A
  )
  expect(newPlan).toMatch(/INDEX messages_in/)
  expect(plan('SELECT stage_id, COUNT(*) FROM pipeline_cards WHERE pipeline_id = ? GROUP BY stage_id', 1)).toMatch(
    /INDEX/
  )
  expect(plan('SELECT phone FROM leads WHERE account_id IN (?) AND phone IS NOT NULL', A)).toMatch(/INDEX leads_/)
})
