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

import { closeDb, getDb, openDb } from '../src/main/db'
import * as L from '../src/main/leadsPlanilha'
import { log } from '../src/main/log'

const ACC = '44444444-4444-4444-8444-444444444444'
const URL_OK = 'https://script.google.com/macros/s/AKfycbxTESTE/exec'
const T0 = Date.now() - 5 * 86_400_000

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
  const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, leads })))
  vi.stubGlobal('fetch', f)
  return f
}

describe('transporte seguro', () => {
  test('envia segredo só no corpo POST', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const f = stubFetch([])
    expect((await L.syncLeads(ACC)).ok).toBe(true)
    expect(String(f.mock.calls[0][0])).not.toContain('segredo')
    expect(f.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      body: JSON.stringify({ operacao: 'leads', segredo: 's', desde: 0, offset: 0 })
    })
  })
  test.each(['https://u:p@script.google.com/x', 'https://script.google.com:444/x', 'https://script.google.com:443/x'])(
    'recusa credenciais ou porta %s',
    (url) => {
      expect(() => L.saveConfig(ACC, { url, secret: 's' })).toThrow()
    }
  )
  test('limpa controles e bidi e descarta email inválido', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    stubFetch([lead({ nome: 'A\u0000\u202eB', email: 'invalido', utm_source: 'g\u2066oogle' })])
    await L.syncLeads(ACC)
    expect(L.listLeads(ACC, {}).items[0]).toMatchObject({ name: 'AB', email: null, utmSource: 'google' })
  })
  test('descarta timestamp além de amanhã', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    stubFetch([lead({ ts: Date.now() + 2 * 86400000 })])
    expect(await L.syncLeads(ACC)).toMatchObject({ ok: true, added: 0 })
  })
  test('bloqueia redirect externo sem enviar outro pedido', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }))
    vi.stubGlobal('fetch', f)
    expect((await L.syncLeads(ACC)).ok).toBe(false)
    expect(f).toHaveBeenCalledTimes(1)
  })
  test('redirect permitido vira GET sem segredo', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/x' } })
      )
      .mockResolvedValueOnce(new Response('{"ok":true,"leads":[]}'))
    vi.stubGlobal('fetch', f)
    expect((await L.syncLeads(ACC)).ok).toBe(true)
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'GET', redirect: 'manual' })
    expect(f.mock.calls[1][1].body).toBeUndefined()
  })
  test('recusa tamanho declarado e excesso de linhas', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers: { 'content-length': '9000000' } }))
    )
    expect((await L.syncLeads(ACC)).ok).toBe(false)
    stubFetch(Array.from({ length: 2001 }, () => lead()))
    expect((await L.syncLeads(ACC)).ok).toBe(false)
  })
  test('continua lote cheio com offset sem perder timestamp igual', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, leads: Array.from({ length: 2000 }, (_, i) => lead({ nome: String(i) })) })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, leads: [lead({ nome: 'ultimo' })] })))
    vi.stubGlobal('fetch', f)
    expect(await L.syncLeads(ACC)).toMatchObject({ ok: true, added: 2001 })
    expect(JSON.parse(f.mock.calls[1][1].body)).toMatchObject({ desde: 0, offset: 2000 })
  })
  test('aborta stream acima do limite de bytes, mesmo sem content-length', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const cancel = vi.fn()
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body))
    )
    expect((await L.syncLeads(ACC)).ok).toBe(false)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  test('interrompe após dois saltos', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const f = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/x' } })
    )
    vi.stubGlobal('fetch', f)
    expect((await L.syncLeads(ACC)).ok).toBe(false)
    expect(f).toHaveBeenCalledTimes(3)
  })
  test('registra só a quantidade de linhas inválidas', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const warn = vi.spyOn(log, 'warn')
    stubFetch([lead({ ts: 'invalido', nome: 'Dado pessoal' }), lead({ ts: -1 })])
    await L.syncLeads(ACC)
    expect(warn).toHaveBeenCalledWith('Linhas inválidas descartadas da planilha de leads', { quantidade: 2 })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Dado pessoal')
    warn.mockRestore()
  })
  test('limita a dez lotes e retoma o offset pendente na próxima sincronização', async () => {
    L.saveConfig(ACC, { url: URL_OK, secret: 's' })
    const body = JSON.stringify({ ok: true, leads: Array.from({ length: 2000 }, () => lead()) })
    const f = vi.fn(async () => new Response(body))
    vi.stubGlobal('fetch', f)
    expect((await L.syncLeads(ACC)).ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(10)
    f.mockImplementation(async () => new Response('{"ok":true,"leads":[]}'))
    await L.syncLeads(ACC)
    expect(JSON.parse((f.mock.calls[10] as unknown as [string, { body: string }])[1].body)).toMatchObject({
      desde: 0,
      offset: 20000
    })
  })
})
