import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

// A IA de verdade não é chamada: o teste olha o que iria no pedido
const calls: Array<{ task: string; system: string; prompt: string }> = []
vi.mock('../src/main/ai/router', async (orig) => ({
  ...(await orig<typeof import('../src/main/ai/router')>()),
  complete: vi.fn(async (req: { task: string; system: string; prompt: string }) => {
    calls.push(req)
    if (req.task === 'preencher_contexto')
      return {
        text: '```json\n{"about":"Ótica de bairro","products":["Lente simples R$ 120","Armação a partir de R$ 199"],"hours":"","x":"y"}\n```',
        provider: 'teste',
        model: 'm'
      }
    return { text: 'Oi! Temos sim.\n---\nOlá! Chegou novidade.', provider: 'teste', model: 'm' }
  })
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import {
  businessContext,
  CONTEXT_FIELDS,
  FIELD_MAX_CHARS,
  formatBusinessContext,
  getBusinessContext,
  parseContextJson,
  saveBusinessContext
} from '../src/main/ai/context'
import { campaignVariations, fillBusinessContext, suggestReply } from '../src/main/ai/assistant'
import * as store from '../src/main/wa/store'
import type { BusinessContext } from '../src/shared/types'

const ACC = '77777777-7777-4777-8777-777777777777'
const OTHER = '88888888-8888-4888-8888-888888888888'

const empty: BusinessContext = {
  about: '',
  products: '',
  hours: '',
  payment: '',
  policies: '',
  faq: '',
  tone: '',
  forbidden: '',
  updatedAt: null
}

beforeEach(() => {
  calls.length = 0
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-ctx-')), 'db.sqlite'))
  const ins = getDb().prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
  ins.run(ACC, 'Ótica Centro', '#000000', '{}', Date.now())
  ins.run(OTHER, 'Outra Loja', '#000000', '{}', Date.now())
})

describe('businessContext', () => {
  test('sem nada preenchido, vai só o nome da loja', () => {
    expect(businessContext(ACC)).toBe('Loja: Ótica Centro')
    expect(formatBusinessContext('', empty)).toBe('Loja: Loja')
  })

  test('campos vazios ficam de fora e a ordem segue a prioridade', () => {
    saveBusinessContext(ACC, { faq: 'P: Faz exame? R: Sim', forbidden: 'Não prometer desconto', tone: '   ' })
    const t = businessContext(ACC)
    expect(t).toContain('O que a IA NÃO pode falar:\nNão prometer desconto')
    expect(t).toContain('Perguntas frequentes:\nP: Faz exame? R: Sim')
    expect(t).not.toContain('Tom de voz')
    expect(t).not.toContain('Formas de pagamento')
    expect(t.indexOf('NÃO pode falar')).toBeLessThan(t.indexOf('Perguntas frequentes'))
  })

  test('passa do limite: corta primeiro os campos de menor prioridade', () => {
    const ctx: BusinessContext = {
      ...empty,
      forbidden: 'Não falar de concorrentes.',
      about: 'Ótica de bairro para famílias.',
      products: Array.from({ length: 60 }, (_, i) => `Produto ${i}: R$ ${100 + i}, pronto em 7 dias`).join('\n'),
      faq: 'P: Aceita receita antiga? R: Até 1 ano.'
    }
    const t = formatBusinessContext('Ótica Centro', ctx, 800)
    expect(t.length).toBeLessThanOrEqual(800)
    expect(t).toContain('Não falar de concorrentes.') // prioridade máxima, inteiro
    expect(t).toContain('Ótica de bairro para famílias.')
    expect(t).toContain('Produto 0: R$ 100') // começo do campo cortado
    expect(t).toMatch(/…$/) // marca do corte
    expect(t).not.toContain('Produto 59')
    expect(t).not.toContain('Perguntas frequentes') // menor prioridade: fora
  })

  test('sobra pouco espaço: o campo inteiro sai em vez de um pedaço inútil', () => {
    const ctx = { ...empty, forbidden: 'x'.repeat(170), faq: 'y'.repeat(500) }
    const t = formatBusinessContext('Loja', ctx, 250)
    expect(t).toContain('x'.repeat(170))
    expect(t).not.toContain('y')
    expect(t.length).toBeLessThanOrEqual(250)
  })

  test('salvar limpa, limita cada campo e é separado por número de WhatsApp', () => {
    const saved = saveBusinessContext(ACC, {
      about: '  Ótica\r\nde bairro  ',
      products: 'p'.repeat(FIELD_MAX_CHARS + 50),
      ...({ hacker: 'x' } as object)
    })
    expect(saved.about).toBe('Ótica\nde bairro')
    expect(saved.products.length).toBe(FIELD_MAX_CHARS)
    expect(saved.updatedAt).toBeGreaterThan(0)
    expect(getBusinessContext(ACC)).not.toHaveProperty('hacker')
    expect(getBusinessContext(OTHER).about).toBe('')
    // Salvar só um campo mantém os outros
    saveBusinessContext(ACC, { tone: 'Descontraído' })
    expect(getBusinessContext(ACC).about).toBe('Ótica\nde bairro')
    expect(CONTEXT_FIELDS).toHaveLength(8)
  })

  test('lê o JSON da IA, mesmo dentro de bloco de código, e ignora chaves estranhas', () => {
    const r = parseContextJson('Aqui está:\n```json\n{"about":"Ótica","products":["A","B"],"faq":"","zzz":1}\n```')
    expect(r).toEqual({ about: 'Ótica', products: 'A\nB' })
    expect(() => parseContextJson('não sei')).toThrow(/não devolveu/)
  })
})

describe('contexto nos pedidos à IA', () => {
  test('variações de campanha levam o contexto da loja', async () => {
    saveBusinessContext(ACC, { products: 'Lente multifocal R$ 890, pronta em 10 dias', forbidden: 'Não dar desconto' })
    const v = await campaignVariations(ACC, 'Promoção de lentes', 2)
    expect(v).toHaveLength(2)
    const sys = calls[0].system
    expect(sys).toContain('Loja: Ótica Centro')
    expect(sys).toContain('Lente multifocal R$ 890, pronta em 10 dias')
    expect(sys).toContain('Não dar desconto')
  })

  test('sugestão de resposta leva o contexto da loja (e não o de outra conta)', async () => {
    saveBusinessContext(ACC, { hours: 'Seg a sex, 9h às 18h' })
    saveBusinessContext(OTHER, { hours: 'Domingo 24h' })
    store.saveMessages(
      ACC,
      [
        {
          key: { remoteJid: '5511987650001@s.whatsapp.net', fromMe: false, id: 'M1' },
          messageTimestamp: 1_790_000_000,
          message: { conversation: 'Vocês abrem sábado?' }
        } as never
      ],
      { live: false }
    )
    await suggestReply(ACC, '5511987650001@s.whatsapp.net')
    expect(calls[0].system).toContain('Seg a sex, 9h às 18h')
    expect(calls[0].system).not.toContain('Domingo 24h')
  })

  test('preencher com a IA devolve os campos organizados, sem salvar', async () => {
    const r = await fillBusinessContext('Somos a Ótica Centro, lentes e armações com preço justo desde 1990.')
    expect(r).toEqual({ about: 'Ótica de bairro', products: 'Lente simples R$ 120\nArmação a partir de R$ 199' })
    expect(calls[0].task).toBe('preencher_contexto')
    expect(getBusinessContext(ACC).about).toBe('')
    await expect(fillBusinessContext('curto')).rejects.toThrow(/texto maior/)
  })
})
