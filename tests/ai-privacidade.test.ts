import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = mkdtempSync(join(tmpdir(), 'dsp-priv-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import type { AiProvider, AiSettings } from '../src/shared/types'
import { dayKey, isLoopbackUrl } from '../src/shared/rules'
import { closeDb, getDb, openDb } from '../src/main/db'
import { candidates, complete, listProviders, saveProvider, setAiSettings, testProvider } from '../src/main/ai/router'

const fetchMock = vi.fn()
let dbFile = ''

beforeEach(() => {
  closeDb()
  userData = mkdtempSync(join(tmpdir(), 'dsp-priv-'))
  dbFile = join(userData, 'db.sqlite')
  openDb(dbFile)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

const ok = (text = 'funcionando'): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens: 5 } }), {
    status: 200
  })

const S: AiSettings = { privacy: 'anonimizar', paidMonthlyLimit: 300 }

const fake = (over: Partial<AiProvider>): AiProvider => ({
  id: 1,
  preset: 'groq',
  name: 'x',
  baseUrl: 'https://api.groq.com/openai/v1',
  hasKey: true,
  modelFast: 'm',
  modelSmart: 'm',
  trainsOnData: false,
  rpm: null,
  rpd: null,
  paid: false,
  enabled: true,
  priority: 100,
  usedToday: 0,
  errorsToday: 0,
  cooldownUntil: 0,
  ...over
})

function useMonth(providerId: number, requests: number): void {
  getDb()
    .prepare('INSERT INTO ai_usage (provider_id, day, requests, tokens, errors) VALUES (?, ?, ?, 0, 0)')
    .run(providerId, dayKey(), requests)
}

describe('padrão de privacidade dos provedores novos', () => {
  test('NVIDIA e DeepSeek entram sem conversas de clientes; os outros não mudam', () => {
    expect(saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abcdefghij' }).noCustomerData).toBe(true)
    expect(saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij' }).noCustomerData).toBe(true)
    expect(saveProvider({ preset: 'groq', apiKey: 'gsk-abcdefghij' }).noCustomerData).toBe(false)
  })

  test('o dono pode ligar o uso com clientes de propósito, na criação ou depois', () => {
    const n = saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abcdefghij', noCustomerData: false })
    expect(n.noCustomerData).toBe(false)
    const d = saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij' })
    expect(saveProvider({ id: d.id, preset: 'deepseek', noCustomerData: false }).noCustomerData).toBe(false)
  })

  test('salvar de novo sem dizer nada não religa o uso com clientes', () => {
    const d = saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij' })
    expect(saveProvider({ id: d.id, preset: 'deepseek', apiKey: 'sk-outra-chave' }).noCustomerData).toBe(true)
  })

  test('migração: NVIDIA e DeepSeek já cadastrados passam a não receber conversas de clientes', () => {
    const db = getDb()
    const ins = db.prepare(
      `INSERT INTO ai_providers (preset, name, base_url, trains_on_data, no_customer_data, paid, enabled, priority, created_at)
       VALUES (?, ?, 'https://x.example', 1, 0, 0, 1, 100, 0)`
    )
    ins.run('nvidia', 'NVIDIA')
    ins.run('deepseek', 'DeepSeek')
    ins.run('gemini', 'Gemini')
    const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    db.exec('ALTER TABLE ai_providers DROP COLUMN monthly_limit')
    db.exec(`PRAGMA user_version = ${v - 1}`)
    closeDb()
    openDb(dbFile)
    const by = Object.fromEntries(listProviders().map((p) => [p.preset, p.noCustomerData]))
    expect(by).toEqual({ nvidia: true, deepseek: true, gemini: false })
  })
})

describe('limite mensal próprio de cada provedor pago', () => {
  test('esgotar o DeepSeek não tira o Claude (e o contrário)', () => {
    const ds = fake({ id: 1, preset: 'deepseek', name: 'DeepSeek', paid: true, usedMonth: 50, monthlyLimit: 50 })
    const cl = fake({ id: 2, preset: 'claude', name: 'Claude', paid: true, usedMonth: 3, monthlyLimit: 300 })
    expect(candidates([ds, cl], { customerData: false }, S).map((p) => p.name)).toEqual(['Claude'])
    expect(
      candidates(
        [
          { ...ds, usedMonth: 0 },
          { ...cl, usedMonth: 300 }
        ],
        { customerData: false },
        S
      ).map((p) => p.name)
    ).toEqual(['DeepSeek'])
  })

  test('sem limite próprio, vale o limite padrão das configurações, contado por provedor', () => {
    const ds = fake({ id: 1, preset: 'deepseek', name: 'DeepSeek', paid: true, usedMonth: 10 })
    const cl = fake({ id: 2, preset: 'claude', name: 'Claude', paid: true, usedMonth: 9 })
    const r = candidates([ds, cl], { customerData: false }, { privacy: 'anonimizar', paidMonthlyLimit: 10 })
    expect(r.map((p) => p.name)).toEqual(['Claude'])
  })

  test('contador e limite vêm do banco, por provedor, e o limite é configurável', () => {
    const ds = saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij', monthlyLimit: 5 })
    const cl = saveProvider({ preset: 'claude', apiKey: 'sk-ant-abcdefghij' })
    useMonth(ds.id, 5)
    useMonth(cl.id, 2)
    const list = listProviders()
    const d = list.find((p) => p.preset === 'deepseek')!
    const c = list.find((p) => p.preset === 'claude')!
    expect([d.usedMonth, d.monthlyLimit]).toEqual([5, 5])
    expect([c.usedMonth, c.monthlyLimit]).toEqual([2, 300])
    expect(candidates(list, { customerData: false }, S).map((p) => p.preset)).toEqual(['claude'])
    // aumentar o limite do DeepSeek devolve ele à fila
    saveProvider({ id: ds.id, preset: 'deepseek', monthlyLimit: 20 })
    expect(candidates(listProviders(), { customerData: false }, S).map((p) => p.preset)).toContain('deepseek')
  })

  test('pedidos de meses anteriores não contam', () => {
    const ds = saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij', monthlyLimit: 5 })
    getDb()
      .prepare('INSERT INTO ai_usage (provider_id, day, requests, tokens, errors) VALUES (?, ?, 99, 0, 0)')
      .run(ds.id, '2020-01-15')
    expect(listProviders()[0].usedMonth).toBe(0)
  })
})

describe('caminho premium (pagos primeiro) respeita a privacidade', () => {
  const groq = fake({ id: 1, name: 'Groq' })
  const ds = fake({ id: 2, preset: 'deepseek', name: 'DeepSeek', paid: true, trainsOnData: true })
  const cl = fake({ id: 3, preset: 'claude', name: 'Claude', paid: true })

  test('provedor marcado sem conversas de clientes nunca recebe dado de cliente', () => {
    const list = [groq, { ...ds, noCustomerData: true }, cl]
    for (const privacy of ['livre', 'anonimizar', 'estrita'] as const) {
      const r = candidates(list, { customerData: true, premium: true }, { privacy, paidMonthlyLimit: 300 })
      expect(r.map((p) => p.name)).not.toContain('DeepSeek')
      expect(r[0].name).toBe('Claude')
    }
    // sem dado de cliente ele pode ir primeiro
    const livre = candidates(list, { customerData: false, premium: true }, S).map((p) => p.name)
    expect(livre.slice(0, 2).sort()).toEqual(['Claude', 'DeepSeek'])
  })

  test('modo estrito: pago que pode treinar não recebe dado de cliente, nem no premium', () => {
    const r = candidates([groq, ds, cl], { customerData: true, premium: true }, { ...S, privacy: 'estrita' })
    expect(r.map((p) => p.name)).toEqual(['Claude', 'Groq'])
  })

  test('complete premium com dado de cliente não chama o DeepSeek recém-cadastrado', async () => {
    saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij' })
    saveProvider({ preset: 'groq', apiKey: 'gsk-abcdefghij' })
    fetchMock.mockResolvedValue(ok('oi'))
    const r = await complete({
      task: 't',
      tier: 'smart',
      system: 's',
      prompt: 'p',
      customerData: true,
      premium: true
    })
    expect(r.provider).toBe('Groq')
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['https://api.groq.com/openai/v1/chat/completions'])
  })
})

describe('endereço de provedor "no computador"', () => {
  test('isLoopbackUrl só aceita localhost, 127.0.0.1 e [::1]', () => {
    expect(isLoopbackUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1:8080')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLoopbackUrl('https://localhost.atacante.com/v1')).toBe(false)
    expect(isLoopbackUrl('https://ollama.exemplo.com/v1')).toBe(false)
    expect(isLoopbackUrl('nada')).toBe(false)
  })

  test('Ollama não aceita endereço remoto, nem ao criar nem ao editar', () => {
    expect(() => saveProvider({ preset: 'ollama', baseUrl: 'https://remoto.exemplo.com/v1' })).toThrow(/computador/)
    const o = saveProvider({ preset: 'ollama' })
    expect(() => saveProvider({ id: o.id, preset: 'ollama', baseUrl: 'https://remoto.exemplo.com/v1' })).toThrow(
      /computador/
    )
    // dizer outro preset no pedido não muda o preset gravado
    expect(() => saveProvider({ id: o.id, preset: 'custom', baseUrl: 'https://remoto.exemplo.com/v1' })).toThrow(
      /computador/
    )
    expect(saveProvider({ id: o.id, preset: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' }).baseUrl).toBe(
      'http://127.0.0.1:11434/v1'
    )
  })

  test('cadastro antigo de Ollama apontando para fora não é usado', () => {
    const legado = fake({ preset: 'ollama', name: 'Ollama', hasKey: false, baseUrl: 'https://remoto.exemplo.com/v1' })
    expect(candidates([legado], { customerData: false }, S)).toEqual([])
    expect(candidates([{ ...legado, hasKey: true }], { customerData: true }, S)).toEqual([])
    expect(candidates([{ ...legado, baseUrl: 'http://localhost:11434/v1' }], { customerData: true }, S)).toHaveLength(1)
  })
})

describe('chamadas e erros', () => {
  test('a chamada de IA não segue redirecionamento', async () => {
    saveProvider({ preset: 'groq', apiKey: 'gsk-abcdefghij' })
    fetchMock.mockResolvedValueOnce(ok('oi'))
    await complete({ task: 't', tier: 'fast', system: 's', prompt: 'p', customerData: false })
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error')
  })

  test('erro inesperado vira mensagem genérica em português, sem o texto cru', async () => {
    saveProvider({ preset: 'groq', apiKey: 'gsk-abcdefghij' })
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET segredo-interno /Users/alguem/arquivo'))
    const err = await complete({ task: 't', tier: 'fast', system: 's', prompt: 'p', customerData: false }).catch(
      (e: Error) => e
    )
    expect((err as Error).message).toMatch(/falha de conexão/)
    expect((err as Error).message).not.toMatch(/segredo-interno|ECONNRESET|Users/)
  })

  test('tempo esgotado é dito em português', async () => {
    saveProvider({ preset: 'groq', apiKey: 'gsk-abcdefghij' })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }))
    await expect(complete({ task: 't', tier: 'fast', system: 's', prompt: 'p', customerData: false })).rejects.toThrow(
      /tempo esgotado/
    )
  })

  test('salvar por id atualiza o limite por minuto', () => {
    const n = saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abcdefghij' })
    expect(n.rpm).toBe(40)
    expect(saveProvider({ id: n.id, preset: 'nvidia', rpm: 5 }).rpm).toBe(5)
    expect(saveProvider({ id: n.id, preset: 'nvidia', modelFast: 'outro' }).rpm).toBe(5)
    expect(saveProvider({ id: n.id, preset: 'nvidia', rpm: null }).rpm).toBeNull()
  })

  test('NVIDIA e DeepSeek ficam sempre como "pode treinar", mesmo se o pedido disser o contrário', () => {
    const n = saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abcdefghij', trainsOnData: false })
    expect(n.trainsOnData).toBe(true)
    const d = saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij' })
    expect(saveProvider({ id: d.id, preset: 'deepseek', trainsOnData: false }).trainsOnData).toBe(true)
    // os outros continuam podendo ajustar
    expect(saveProvider({ preset: 'mistral', apiKey: 'chave-abcdefghij', trainsOnData: false }).trainsOnData).toBe(
      false
    )
  })

  test('teste de conexão: modelo não encontrado avisa que o nome pode ter mudado', async () => {
    const p = saveProvider({ preset: 'deepseek', apiKey: 'sk-abcdefghij' })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(testProvider(p.id)).rejects.toThrow(/nome do modelo pode ter mudado; edite o modelo/i)
  })

  test('configurações antigas continuam valendo', () => {
    expect(setAiSettings({ paidMonthlyLimit: 7 }).paidMonthlyLimit).toBe(7)
  })
})

describe('regressão: toda chamada de IA passa por complete()', () => {
  const root = join(__dirname, '../src/main')
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const full = join(dir, f)
      return statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(f) ? [full] : []
    })
  const router = join(root, 'ai/router.ts')

  test('nenhum módulo de src/main chama o provedor por fora do roteador', () => {
    const fora = files(root)
      .filter((f) => f !== router)
      .filter((f) =>
        /callOpenAiCompatible|callClaude|chat\/completions|@anthropic-ai\/sdk/.test(readFileSync(f, 'utf8'))
      )
    expect(
      fora,
      'use complete() de ai/router.ts (com customerData correto) em vez de chamar o provedor direto'
    ).toEqual([])
  })

  test('as funções de chamada direta não são exportadas pelo roteador', () => {
    const src = readFileSync(router, 'utf8')
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(callOpenAiCompatible|callClaude|callLocal)\b/)
    expect(src).not.toMatch(/export\s*\{[^}]*\b(callOpenAiCompatible|callClaude|callLocal)\b/)
  })

  test('dentro do roteador, só complete(), o teste de conexão e a IA local chamam o provedor', () => {
    const src = readFileSync(router, 'utf8')
    // divide o arquivo em funções de topo e vê em quais aparece uma chamada
    const partes = src.split(/\n(?=(?:export\s+)?(?:async\s+)?function\s+\w+)/)
    const chamam = partes
      .filter((p) => /\b(callOpenAiCompatible|callClaude)\(/.test(p.replace(/^.*function\s+\w+\(/, '')))
      .map((p) => /function\s+(\w+)/.exec(p)?.[1])
    expect(chamam.sort()).toEqual(['callLocal', 'complete', 'testProvider'])
  })
})
