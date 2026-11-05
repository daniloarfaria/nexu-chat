import { describe, expect, test } from 'vitest'
import {
  DEFAULT_ANTIBAN,
  effectiveDailyLimit,
  firstName,
  hasLink,
  isOptOut,
  normalizeDate,
  normalizePhone,
  renderTemplate,
  sendWindow
} from '../src/shared/rules'

describe('telefone', () => {
  test.each([
    ['(11) 98765-4321', '5511987654321'],
    ['11987654321', '5511987654321'],
    ['011 98765-4321', '5511987654321'],
    ['0 15 11 98765 4321', '5511987654321'],
    ['5511987654321', '5511987654321'],
    ['+55 (21) 3333-4444', '552133334444'],
    ['1133334444', '551133334444'],
    ['5.511987654321E12', '5511987654321'],
    ['+1 415 555 0100', '14155550100']
  ])('%s → %s', (raw, out) => expect(normalizePhone(raw)).toBe(out))

  test.each(['', 'abc', '12345', '0000000000', '5500987654321', null])('inválido: %s', (raw) =>
    expect(normalizePhone(raw)).toBeNull()
  )
})

describe('datas', () => {
  test.each([
    ['31/12/1990', '1990-12-31'],
    ['5/3/85', '1985-03-05'],
    ['05/03', '--03-05'],
    ['--03-05', '--03-05'],
    ['1990-12-31', '1990-12-31'],
    ['33024', '1990-05-31'],
    ['31/13/1990', null],
    ['', null]
  ])('%s → %s', (raw, out) => expect(normalizeDate(raw)).toBe(out))
})

describe('modelos', () => {
  const vars = { nome: 'MARIA DA SILVA', primeiro_nome: 'Maria', loja: 'Ótica Centro', Cidade: 'Campinas' }
  test('variáveis, inclusive campos com acento e maiúsculas', () => {
    expect(renderTemplate('Oi {primeiro_nome}, aqui é da {loja} em {cidade}!', vars)).toBe(
      'Oi Maria, aqui é da Ótica Centro em Campinas!'
    )
  })
  test('variável ausente some sem sujar o texto', () => {
    expect(renderTemplate('Oi {primeiro_nome} {sobrenome}, tudo bem?', vars)).toBe('Oi Maria, tudo bem?')
  })
  test('spintax escolhe uma opção, inclusive aninhada', () => {
    expect(renderTemplate('{Oi|Olá} {primeiro_nome}', vars, () => 0)).toBe('Oi Maria')
    expect(renderTemplate('{Oi|Olá} {primeiro_nome}', vars, () => 0.99)).toBe('Olá Maria')
    expect(renderTemplate('{Bom {dia|ano}|Boa tarde}!', vars, () => 0)).toBe('Bom dia!')
  })
  test('primeiro nome', () => {
    expect(firstName('MARIA DA SILVA')).toBe('Maria')
    expect(firstName('')).toBe('')
  })
  test('detecta link', () => {
    expect(hasLink('veja em www.loja.com.br')).toBe(true)
    expect(hasLink('acesse https://x.co')).toBe(true)
    expect(hasLink('10% off. Venha!')).toBe(false)
  })
})

describe('opt-out', () => {
  test.each(['SAIR', 'sair', 'Sair.', 'parar', 'Não quero mais', 'nao quero', 'me tira da lista', 'STOP'])(
    'sim: %s',
    (t) => expect(isOptOut(t)).toBe(true)
  )
  test.each(['quero sair amanhã para buscar o óculos', 'que horas vocês saem?', 'obrigado', null])('não: %s', (t) =>
    expect(isOptOut(t)).toBe(false)
  )
})

describe('anti-bloqueio', () => {
  test('aquecimento: 20 no primeiro dia, +15 por dia, até o limite', () => {
    const start = Date.UTC(2026, 10, 1)
    const s = { ...DEFAULT_ANTIBAN, warmup: true, warmupStartedAt: start, dailyLimit: 200 }
    expect(effectiveDailyLimit(s, start + 3600_000)).toBe(20)
    expect(effectiveDailyLimit(s, start + 2 * 86_400_000)).toBe(50)
    expect(effectiveDailyLimit(s, start + 60 * 86_400_000)).toBe(200)
    expect(effectiveDailyLimit({ ...s, warmup: false }, start)).toBe(200)
  })
  test('janela de envio: segunda 10h aberta; domingo fechada abre segunda 9h', () => {
    const s = DEFAULT_ANTIBAN
    expect(sendWindow(s, new Date(2026, 10, 2, 10, 0)).open).toBe(true) // segunda
    const sunday = sendWindow(s, new Date(2026, 10, 8, 10, 0))
    expect(sunday.open).toBe(false)
    expect(new Date(sunday.opensAt!).getDay()).toBe(1)
    expect(new Date(sunday.opensAt!).getHours()).toBe(9)
    const late = sendWindow(s, new Date(2026, 10, 2, 20, 0))
    expect(new Date(late.opensAt!).getDate()).toBe(3)
  })
})
