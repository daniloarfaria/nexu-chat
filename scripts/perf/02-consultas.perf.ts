// Complementa a medição 01. Lê somente o banco sintético gerado por ela.
import { afterAll, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('electron', () => ({
  app: { getPath: () => process.env['NEXU_PERF_DIR'] ?? '/tmp', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))
// Impede que a avaliação dos lembretes alcance qualquer motor/envio real.
vi.mock('../../src/main/engine', () => ({ engine: {} }))

import { openDb, closeDb, getDb } from '../../src/main/db'
import { panel } from '../../src/main/painel'
import { dueToday, listReminders } from '../../src/main/reminders'
import { listChats, listMessages } from '../../src/main/wa/store'
import { ACCOUNTS, BIG_DB, META, benchAuto, explain, recordSql, save } from './lib'
import type { Meta } from './dados'

const out: Record<string, unknown> = {}
const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta
const account = ACCOUNTS[0].id
const mb = (): Record<string, number> =>
  Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round((v / 2 ** 20) * 10) / 10]))
const before = mb()
openDb(BIG_DB)
const opened = mb()

afterAll(() => {
  closeDb()
  save('02-consultas', out)
})

test('consultas paginadas reais: conversas e mensagens', () => {
  const operations = {
    conversasPrimeiraPagina: () => listChats(account, { filter: 'all', limit: 80, offset: 0 }),
    conversasPagina100: () => listChats(account, { filter: 'all', limit: 80, offset: 8000 }),
    conversasBusca: () => listChats(account, { filter: 'all', search: 'Maria', limit: 80, offset: 0 }),
    mensagensPrimeiraPagina: () => listMessages(account, meta.samples[account].bigChat, null, 60)
  }
  out.paginas = Object.fromEntries(
    Object.entries(operations).map(([name, fn]) => {
      const { result, uses } = recordSql(fn)
      return [
        name,
        { ...benchAuto(fn), linhas: result.length, sql: uses.map((u) => ({ ...u, explain: explain(getDb(), u.sql) })) }
      ]
    })
  )
  expect(operations.conversasPrimeiraPagina()).toHaveLength(80)
  expect(operations.mensagensPrimeiraPagina()).toHaveLength(60)
})

test('painel real de 30 dias e planos SQL', () => {
  const query = {
    accountIds: ACCOUNTS.map((a) => a.id),
    from: meta.now - 30 * 86_400_000,
    to: meta.now + 1,
    bucket: 'day' as const,
    pipelineId: meta.samples[account].pipelineId
  }
  const { result, uses } = recordSql(() => panel(query))
  out.painel = {
    ...benchAuto(() => panel(query)),
    totais: result.totals,
    sql: uses.map((u) => ({ ...u, explain: explain(getDb(), u.sql) }))
  }
  expect(result.totals.won).toBeGreaterThan(0)
})

test('lembretes reais sem disparar: seleção dos destinatários', () => {
  const reminders = listReminders(account)
  expect(reminders.length).toBeGreaterThan(0)
  const fn = (): number[][] => reminders.map((r) => dueToday(account, r, new Date(meta.now)))
  const { result, uses } = recordSql(fn)
  out.lembretes = {
    ...benchAuto(fn),
    regras: reminders.length,
    destinatariosPorRegra: result.map((r) => r.length),
    sql: uses.map((u) => ({ ...u, explain: explain(getDb(), u.sql) }))
  }
})

test('snapshots de memória do processo de medição com objetos de conversas retidos', () => {
  const beforeList = mb()
  const chats = listChats(account, { filter: 'all', limit: 20000, offset: 0 })
  const afterList = mb()
  const messages = listMessages(account, meta.samples[account].bigChat, null, 10000)
  const afterMessages = mb()
  // São snapshots RSS/heap do Node/Vitest, sem GC forçado; não são memória do Electron/DOM.
  out.memoriaMB = {
    antesDeAbrir: before,
    bancoAberto: opened,
    antesDaLista: beforeList,
    conversasRetidas: chats.length,
    aposLista: afterList,
    mensagensRetidas: messages.length,
    aposMensagens: afterMessages
  }
  expect(chats.length).toBeGreaterThan(10000)
})
