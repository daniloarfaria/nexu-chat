import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as L from '../src/main/leadsPlanilha'
import * as people from '../src/main/people'
import * as pipes from '../src/main/pipelines'
import { saveDeal } from '../src/main/deals'
import { MODULE_KEYS, PLANS } from '../src/shared/types'

const ACC = '44444444-4444-4444-8444-444444444444'
const URL_OK = 'https://script.google.com/macros/s/AKfycbxTESTE/exec'
const T0 = Date.now() - 5 * 86_400_000
const S = Math.floor(T0 / 1000) // chats.last_ts fica em segundos

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-leads-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica Centro', '#000000', '{}', Date.now())
})
afterEach(() => vi.unstubAllGlobals())

const lead = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  aba: 'Leads WhatsApp',
  ts: T0,
  nome: 'Ana Souza',
  telefone: '(11) 98765-0001',
  interesse: 'Óculos de grau',
  utm_source: 'google',
  utm_campaign: 'verao',
  utm_content: 'anuncio-a',
  pagina: '/',
  ...o
})

function stubFetch(leads: unknown[]): ReturnType<typeof vi.fn> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const f = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ ok: true, leads })))
  vi.stubGlobal('fetch', f)
  return f
}

const funil = (stages: string[]): ReturnType<typeof pipes.savePipeline> =>
  pipes.savePipeline(ACC, {
    name: 'Leads',
    color: 'blue',
    stages: stages.map((name) => ({ name, color: 'blue' as const, kind: 'open' as const }))
  })

describe('módulo e plano', () => {
  test('leadsPlanilha existe e é do plano Marketing', () => {
    expect(MODULE_KEYS).toContain('leadsPlanilha')
    expect(PLANS.marketing.modulos).toContain('leadsPlanilha')
    expect(PLANS.basico.modulos).not.toContain('leadsPlanilha')
  })
})

describe('configuração', () => {
  test('guarda a senha selada e nunca a devolve', () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 'segredo123' })
    const raw = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(`leadsPlanilha:${ACC}`) as {
      value: string
    }
    expect(raw.value).not.toContain('segredo123')
    const c = L.getConfig(ACC)
    expect(c).toMatchObject({ url: URL_OK, hasSecret: true })
    expect(JSON.stringify(c)).not.toContain('segredo123')
  })
  test('senha vazia ao salvar mantém a anterior', () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 'segredo123' })
    L.saveConfig(ACC, { url: URL_OK, secret: '', createContacts: true })
    expect(L.getConfig(ACC).hasSecret).toBe(true)
  })
  test('só aceita endereço do Apps Script em https', () => {
    expect(() => L.saveConfig(ACC, { url: 'http://script.google.com/macros/s/x/exec', secret: 'a' })).toThrow()
    expect(() => L.saveConfig(ACC, { url: 'https://evil.example.com/x', secret: 'a' })).toThrow()
    expect(() => L.saveConfig(ACC, { url: 'http://localhost:8080', secret: 'a' })).toThrow()
  })
})

describe('sincronização', () => {
  test('importa e não duplica a mesma linha', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const f = stubFetch([lead(), lead({ ts: T0 + 1000, nome: 'Bruno', telefone: '11 98765-0002' })])
    const r1 = await L.syncLeads(ACC)
    expect(r1).toMatchObject({ ok: true, added: 2 })
    const r2 = await L.syncLeads(ACC)
    expect(r2).toMatchObject({ ok: true, added: 0 })
    expect(L.listLeads(ACC, {}).total).toBe(2)
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toMatchObject({ segredo: 's' })
    expect(String(f.mock.calls[0][0])).not.toContain('segredo')
    expect(JSON.parse(String(f.mock.calls[1][1]?.body)).desde).toBeGreaterThan(0)
  })
  test('falha de rede devolve erro e não lança', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('sem internet')
      })
    )
    const r = await L.syncLeads(ACC)
    expect(r.ok).toBe(false)
    expect(L.getConfig(ACC).lastError).toBeTruthy()
  })
  test('resposta estranha ou senha errada é recusada', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>login</html>'))
    )
    expect((await L.syncLeads(ACC)).ok).toBe(false)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, erro: 'Senha inválida' })))
    )
    expect((await L.syncLeads(ACC)).ok).toBe(false)
  })
  test('sem configuração não chama a rede', async () => {
    const f = stubFetch([])
    expect((await L.syncLeads(ACC)).ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
  test('lead sem telefone válido é guardado, mas não casa', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    stubFetch([lead({ telefone: 'abc', aba: 'Orçamentos', email: 'a@b.com' })])
    await L.syncLeads(ACC)
    const it = L.listLeads(ACC, {}).items[0]
    expect(it.phone).toBeNull()
    expect(it.chat).toBe(false)
  })
})

describe('casamento pelo telefone', () => {
  test('mostra conversa, contato, etapa e venda com valor', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    stubFetch([
      lead(),
      lead({ ts: T0 + 1, nome: 'Bruno', telefone: '11987650002' }),
      lead({ ts: T0 + 2, nome: 'Carla', telefone: '11987650003' })
    ])
    await L.syncLeads(ACC)
    const db = getDb()
    db.prepare('INSERT INTO chats (account_id, jid, name, last_ts) VALUES (?, ?, ?, ?)').run(
      ACC,
      '5511987650001@s.whatsapp.net',
      'Ana',
      S + 5
    )
    const p = people.savePerson(ACC, { name: 'Ana', phone: '11987650001' })
    const pl = funil(['Novo', 'Fechado'])
    pipes.addPeople(ACC, pl.stages[0].id, [p.id])
    saveDeal(ACC, { chatJid: '5511987650001@s.whatsapp.net', status: 'won', amountCents: 45000 })
    db.prepare('INSERT INTO lid_map (account_id, lid, pn) VALUES (?, ?, ?)').run(
      ACC,
      '999@lid',
      '5511987650002@s.whatsapp.net'
    )
    db.prepare('INSERT INTO chats (account_id, jid, name, last_ts) VALUES (?, ?, ?, ?)').run(
      ACC,
      '999@lid',
      'Bruno',
      S + 5
    )

    const items = L.listLeads(ACC, {}).items
    const by = (n: string): (typeof items)[number] => items.find((i) => i.name === n)!
    expect(by('Ana Souza')).toMatchObject({
      chat: true,
      personId: p.id,
      stage: 'Novo',
      pipeline: 'Leads',
      won: true,
      valueCents: 45000
    })
    const bruno = items.find((i) => i.phone === '5511987650002')!
    expect(bruno).toMatchObject({ chat: true, personId: null, won: false, valueCents: 0 })
    const carla = items.find((i) => i.phone === '5511987650003')!
    expect(carla).toMatchObject({ chat: false, personId: null, stage: null, won: false })
  })
})

describe('relatório por UTM', () => {
  test('agrupa, conta conversaram/compraram/faturamento e taxa; filtra período', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    stubFetch([
      lead({ ts: T0, telefone: '11987650001' }),
      lead({ ts: T0 + 1, nome: 'B', telefone: '11987650002' }),
      lead({
        ts: T0 + 2,
        nome: 'C',
        telefone: '11987650003',
        utm_source: 'instagram',
        utm_campaign: '',
        utm_content: ''
      }),
      lead({ ts: T0 - 90 * 86400000, nome: 'Velho', telefone: '11987650004' })
    ])
    await L.syncLeads(ACC)
    const db = getDb()
    for (const n of ['1', '2'])
      db.prepare('INSERT INTO chats (account_id, jid, last_ts) VALUES (?, ?, ?)').run(
        ACC,
        `551198765000${n}@s.whatsapp.net`,
        S + 5
      )
    saveDeal(ACC, { chatJid: '5511987650001@s.whatsapp.net', status: 'won', amountCents: 30000 })
    saveDeal(ACC, { chatJid: '5511987650001@s.whatsapp.net', status: 'won', amountCents: 10000 })
    const rep = L.leadsReport(ACC, { from: T0 - 1000, to: T0 + 10_000 })
    expect(rep.total).toMatchObject({ leads: 3, talked: 2, bought: 1, revenueCents: 40000 })
    const g = rep.bySource.find((r) => r.key === 'google')!
    expect(g).toMatchObject({ leads: 2, talked: 2, bought: 1, revenueCents: 40000 })
    expect(g.rate).toBeCloseTo(0.5)
    expect(rep.bySource.find((r) => r.key === 'instagram')).toMatchObject({ leads: 1, talked: 0, bought: 0 })
    expect(rep.byCampaign.find((r) => r.key === '(sem campanha)')?.leads).toBe(1)
    expect(rep.byContent.find((r) => r.key === 'anuncio-a')?.leads).toBe(2)
    expect(L.leadsReport(ACC, {}).total.leads).toBe(4)
  })
  test('CSV tem cabeçalho em português e protege fórmulas', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    stubFetch([lead({ utm_source: '=cmd|x' })])
    await L.syncLeads(ACC)
    const csv = L.reportCsv(ACC, 'source', {})
    expect(csv).toContain('Origem')
    expect(csv).toContain("'=cmd|x")
    expect(csv).toContain('Faturamento')
  })
})

describe('lead novo vira contato', () => {
  test('cria contato com etiqueta Lead site e cartão na primeira coluna do funil', async () => {
    const pl = funil(['Entrou', 'Falando'])
    L.saveConfig(ACC, { url: URL_OK, secret: 's', createContacts: true, pipelineId: pl.id })
    stubFetch([lead()])
    const r = await L.syncLeads(ACC)
    expect(r).toMatchObject({ added: 1, contacts: 1 })
    const p = people.findPersonByJid(ACC, '5511987650001@s.whatsapp.net')!
    expect(p.tags).toContain('Lead site')
    expect(pipes.placementsOfPerson(ACC, p.id)[0]).toMatchObject({ stageName: 'Entrou' })
    await L.syncLeads(ACC)
    expect(people.listPeople({ accountId: ACC, limit: 10, offset: 0 }).total).toBe(1)
  })
  test('desligado por padrão', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    stubFetch([lead()])
    expect(await L.syncLeads(ACC)).toMatchObject({ added: 1, contacts: 0 })
    expect(people.listPeople({ accountId: ACC, limit: 10, offset: 0 }).total).toBe(0)
  })
})

describe('recuperação dos contatos e orientação de privacidade', () => {
  test('contato existente recebe etiqueta e cartão sem perder dados', async () => {
    const p = people.savePerson(ACC, { name: 'Nome mantido', phone: '11987650001', tags: ['Cliente'] })
    const pl = funil(['Entrou'])
    L.saveConfig(ACC, { url: URL_OK, secret: 's', createContacts: true, pipelineId: pl.id })
    stubFetch([lead()])
    await L.syncLeads(ACC)
    expect(people.getPerson(ACC, p.id)).toMatchObject({ name: 'Nome mantido', tags: ['Cliente', 'Lead site'] })
    expect(pipes.placementsOfPerson(ACC, p.id)[0]?.stageName).toBe('Entrou')
  })
  test('retoma cartão pendente após falha, mesmo sem receber novamente o lead', async () => {
    const pl = funil(['Entrou'])
    L.saveConfig(ACC, { url: URL_OK, secret: 's', createContacts: true, pipelineId: pl.id })
    const spy = vi.spyOn(pipes, 'addPeople').mockImplementationOnce(() => {
      throw new Error('falha simulada')
    })
    stubFetch([lead()])
    await L.syncLeads(ACC)
    spy.mockRestore()
    stubFetch([])
    await L.syncLeads(ACC)
    const p = people.findPersonByJid(ACC, '5511987650001@s.whatsapp.net')!
    expect(pipes.placementsOfPerson(ACC, p.id)[0]?.stageName).toBe('Entrou')
    expect(L.listLeads(ACC, {}).total).toBe(1)
  })
  test('orienta conferir consentimento e informa ausência de retenção automática', () => {
    const ui = readFileSync('src/renderer/src/components/LeadsPlanilhaConfig.tsx', 'utf8')
    expect(ui.toLowerCase()).toContain('confira que o formulário do site tem o aviso de consentimento')
    expect(readFileSync('docs/MANUAL.md', 'utf8')).toContain('não há rotina de retenção dos leads')
  })
})

describe('script de referência', () => {
  test('POST e GET usam segredo exclusivo, erro único e contador de falhas', () => {
    const cache = new Map<string, string>()
    const context = {
      CacheService: {
        getScriptCache: () => ({ get: (k: string) => cache.get(k), put: (k: string, v: string) => cache.set(k, v) })
      },
      LockService: { getScriptLock: () => ({ waitLock: vi.fn(), releaseLock: vi.fn() }) },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k: string) => (k === 'SEGREDO_INTEGRACAO_LEADS' ? 'exclusivo' : 'formulario')
        })
      },
      ContentService: {
        MimeType: { JSON: 'json' },
        createTextOutput: (body: string) => ({
          body,
          setMimeType() {
            return this
          }
        })
      },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
      ABAS: {},
      doPost: undefined as unknown as (e: unknown) => { body: string },
      doGet: undefined as unknown as (e: unknown) => { body: string }
    }
    runInNewContext(readFileSync('docs/apps-script-leads-doget.gs', 'utf8'), context)
    for (const segredo of ['', 'errada', 'formulario']) {
      expect(JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ segredo }) } }).body)).toEqual({
        ok: false,
        erro: 'Não autorizado'
      })
    }
    expect(cache.get('leads:falhas')).toBe('3')
    expect(
      JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ segredo: 'exclusivo' }) } }).body)
    ).toEqual({ ok: true, leads: [] })
    expect(JSON.parse(context.doGet({ parameter: { segredo: 'exclusivo' } }).body)).toEqual({ ok: true, leads: [] })
    cache.set('leads:falhas', '20')
    expect(JSON.parse(context.doGet({ parameter: { segredo: 'exclusivo' } }).body).erro).toBe('Não autorizado')
  })
})
