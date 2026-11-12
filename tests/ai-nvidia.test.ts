import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = mkdtempSync(join(tmpdir(), 'dsp-nvidia-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import {
  PRESETS,
  candidates,
  complete,
  listProviders,
  saveProvider,
  testProvider,
  validateBaseUrl
} from '../src/main/ai/router'

const fetchMock = vi.fn()

beforeEach(() => {
  closeDb()
  userData = mkdtempSync(join(tmpdir(), 'dsp-nvidia-'))
  openDb(join(userData, 'db.sqlite'))
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

const ok = (text = 'funcionando'): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { total_tokens: 5 } }), {
    status: 200
  })

describe('provedor NVIDIA', () => {
  test('pré-configurado com base, modelo padrão e link da chave', () => {
    const n = PRESETS.nvidia
    expect(n.name).toBe('NVIDIA')
    expect(n.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    expect(n.fast).toBe('nvidia/nemotron-3.5-lightning-30b-a3b')
    expect(n.smart).toBe('nvidia/nemotron-3.5-lightning-30b-a3b')
    expect(n.paid).toBe(false)
    expect(n.keyUrl).toContain('build.nvidia.com')
    expect(validateBaseUrl(n.baseUrl)).toBe(n.baseUrl)
  })

  test('chave só guardada selada e modelo pode ser trocado', () => {
    const p = saveProvider({ preset: 'nvidia', apiKey: 'nvapi-segredo-123', modelFast: 'meta/outro-modelo' })
    expect(p.hasKey).toBe(true)
    expect(p.modelFast).toBe('meta/outro-modelo')
    expect(p.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    const row = getDb().prepare('SELECT api_key FROM ai_providers WHERE id = ?').get(p.id) as { api_key: string }
    expect(row.api_key).not.toContain('nvapi-segredo-123')
    expect(JSON.stringify(listProviders())).not.toContain('nvapi-segredo-123')
  })

  test('complete usa o endereço e o modelo da NVIDIA com a chave do usuário', async () => {
    saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abc' })
    fetchMock.mockResolvedValueOnce(ok('oi'))
    const r = await complete({ task: 't', tier: 'fast', system: 's', prompt: 'p', customerData: false })
    expect(r.provider).toBe('NVIDIA')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer nvapi-abc')
    expect(JSON.parse(init.body).model).toBe('nvidia/nemotron-3.5-lightning-30b-a3b')
  })

  test('limite (429) pausa a NVIDIA e cai para o próximo provedor', async () => {
    saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abc', priority: 1 })
    saveProvider({ preset: 'groq', apiKey: 'gsk-abc', priority: 2 })
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '30' } }))
      .mockResolvedValueOnce(ok('do groq'))
    const r = await complete({ task: 't', tier: 'smart', system: 's', prompt: 'p', customerData: false })
    expect(r.provider).toBe('Groq')
    const nv = listProviders().find((p) => p.preset === 'nvidia')!
    expect(nv.cooldownUntil).toBeGreaterThan(Date.now())
    expect(nv.errorsToday).toBe(1)
    expect(
      candidates(listProviders(), { customerData: false }, { privacy: 'anonimizar', paidMonthlyLimit: 300 }).map(
        (p) => p.preset
      )
    ).toEqual(['groq'])
  })

  test('modo estrito com dados de cliente pula a NVIDIA (pode treinar com os dados)', () => {
    saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abc' })
    const l = candidates(listProviders(), { customerData: true }, { privacy: 'estrita', paidMonthlyLimit: 300 })
    expect(l).toEqual([])
  })

  test('teste de conexão: chave inválida dá mensagem clara em português', async () => {
    const p = saveProvider({ preset: 'nvidia', apiKey: 'nvapi-ruim' })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(testProvider(p.id)).rejects.toThrow(/chave/i)
  })

  test('teste de conexão: sem internet ou tempo esgotado dá mensagem clara', async () => {
    const p = saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abc' })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'TimeoutError' }))
    await expect(testProvider(p.id)).rejects.toThrow(/demorou demais/i)
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(testProvider(p.id)).rejects.toThrow(/conectar/i)
  })

  test('teste de conexão usa timeout', async () => {
    const p = saveProvider({ preset: 'nvidia', apiKey: 'nvapi-abc' })
    fetchMock.mockResolvedValueOnce(ok())
    await testProvider(p.id)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})

describe('provedor DeepSeek', () => {
  test('pré-configurado, cobrado por uso, com link da chave', () => {
    const d = PRESETS.deepseek
    expect(d.baseUrl).toBe('https://api.deepseek.com')
    expect(d.paid).toBe(true)
    expect(d.keyUrl).toContain('platform.deepseek.com')
    expect(validateBaseUrl(d.baseUrl)).toBe(d.baseUrl)
  })

  test('chama /chat/completions com a chave do usuário e aceita trocar o modelo', async () => {
    saveProvider({ preset: 'deepseek', apiKey: 'sk-ds-1', modelFast: 'deepseek-v4-pro' })
    fetchMock.mockResolvedValueOnce(ok('oi'))
    const r = await complete({ task: 't', tier: 'fast', system: 's', prompt: 'p', customerData: false })
    expect(r.provider).toBe('DeepSeek')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.headers.authorization).toBe('Bearer sk-ds-1')
    expect(JSON.parse(init.body).model).toBe('deepseek-v4-pro')
  })

  test('sem "usar em conversas de clientes" só faz tarefas sem dado de cliente (é o padrão)', () => {
    const p = saveProvider({ preset: 'deepseek', apiKey: 'sk-ds-1' })
    expect(p.noCustomerData).toBe(true)
    const s = { privacy: 'livre' as const, paidMonthlyLimit: 300 }
    expect(candidates(listProviders(), { customerData: true }, s)).toEqual([])
    expect(candidates(listProviders(), { customerData: false }, s).map((x) => x.preset)).toEqual(['deepseek'])
    // o dono liga depois, de propósito
    saveProvider({ id: p.id, preset: 'deepseek', noCustomerData: false })
    expect(candidates(listProviders(), { customerData: true }, s)).toHaveLength(1)
  })

  test('chave recusada (401) no teste dá mensagem clara', async () => {
    const p = saveProvider({ preset: 'deepseek', apiKey: 'sk-ruim' })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(testProvider(p.id)).rejects.toThrow(/chave foi recusada/i)
  })
})
