import { describe, expect, test, vi } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/tmp' } }))

import { evaluate, parseLicense } from '../src/main/license'
import { issue } from '../scripts/licenca.mjs'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUB = publicKey.export({ type: 'spki', format: 'pem' }) as string
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

describe('licença', () => {
  test('emite e confere a assinatura', () => {
    const { key, payload } = issue(PRIV, {
      cliente: 'Ótica Centro',
      plano: 'marketing',
      contas: 2,
      validade: '2026-12-31'
    })
    const p = parseLicense(key, PUB)
    expect(p).toEqual(payload)
    expect(p.modulos).toContain('campanhas')
    expect(p.modulos).not.toContain('ia')
  })

  test('chave editada ou de outra agência é recusada', () => {
    const { key } = issue(PRIV, { cliente: 'Ótica', plano: 'basico', validade: null })
    const [h, body, sig] = key.split('.')
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString())
    forged.plano = 'completo'
    forged.modulos = ['conversas', 'campanhas', 'ia']
    const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`
    expect(() => parseLicense(tampered, PUB)).toThrow(/assinatura/)
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    expect(() => parseLicense(issue(other, { cliente: 'X', plano: 'completo' }).key, PUB)).toThrow(/assinatura/)
    expect(() => parseLicense('qualquer coisa', PUB)).toThrow()
  })

  test('situação: ativa, avisando, tolerância de 7 dias, vencida e sem licença', () => {
    const p = parseLicense(issue(PRIV, { cliente: 'X', plano: 'completo', contas: 3, validade: '2026-11-30' }).key, PUB)
    expect(evaluate(p, new Date(2026, 10, 1))).toMatchObject({ state: 'active', maxAccounts: 3 })
    expect(evaluate(p, new Date(2026, 10, 25)).message).toMatch(/vence em 5/)
    const grace = evaluate(p, new Date(2026, 11, 3))
    expect(grace.state).toBe('grace')
    expect(grace.modules).toContain('ia')
    const expired = evaluate(p, new Date(2026, 11, 10))
    expect(expired.state).toBe('expired')
    expect(expired.modules).toEqual(['conversas'])
    expect(evaluate(null)).toMatchObject({ state: 'none', modules: ['conversas'], maxAccounts: 1 })
    const forever = parseLicense(issue(PRIV, { cliente: 'Y', plano: 'basico', validade: null }).key, PUB)
    expect(evaluate(forever, new Date(2040, 0, 1)).state).toBe('active')
  })
})

describe('licença antiga', () => {
  test('módulo novo do plano é liberado sem emitir outra chave', () => {
    // Chave emitida antes do Funil existir: a lista assinada não tem 'funil'
    const payload = {
      v: 1,
      id: 'LIC-ANTIGA1',
      cliente: 'Antiga',
      plano: 'completo',
      contas: 1,
      modulos: ['conversas', 'campanhas', 'vendas', 'ia'],
      emitida: '2026-11-01',
      validade: null
    }
    const b64 = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const head = `DSP1.${b64(Buffer.from(JSON.stringify(payload)))}`
    const sig = sign(null, Buffer.from(head), createPrivateKey(PRIV))
    const p = parseLicense(`${head}.${b64(sig)}`, PUB)
    expect(p.modulos).toContain('funil')
    expect(p.modulos).toContain('ia')
  })
})

describe('licença online (site)', () => {
  const base = {
    v: 1 as const,
    id: 'LIC-ONLINE01',
    cliente: 'Loja',
    plano: 'completo' as const,
    contas: 1,
    modulos: ['conversas' as const, 'campanhas' as const],
    emitida: '2026-11-05',
    online: true,
    email: 'loja@ex.com',
    dispositivo: 'a'.repeat(64)
  }
  const now = new Date(2026, 10, 10)

  test('chave de outro computador não libera nada', () => {
    const st = evaluate({ ...base, validade: '2026-11-20', fim: '2026-12-31' }, now, false, 'b'.repeat(64))
    expect(st.state).toBe('invalid')
    expect(st.modules).toEqual(['conversas'])
  })

  test('mesmo computador: ativa e mostra o fim real', () => {
    const st = evaluate({ ...base, validade: '2026-11-20', fim: '2026-12-31' }, now, false, 'a'.repeat(64))
    expect(st.state).toBe('active')
    expect(st.message).toContain('31/12/2026')
  })

  test('teste que acabou não ganha tolerância offline', () => {
    const p = { ...base, teste: true, validade: '2026-11-08', fim: '2026-11-08' }
    const st = evaluate(p, now, false, 'a'.repeat(64))
    expect(st.state).toBe('expired')
    expect(st.message).toMatch(/teste grátis terminou/)
  })

  test('sem internet, janela vencida ainda tem tolerância se o fim real é depois', () => {
    const p = { ...base, validade: '2026-11-08', fim: '2026-12-31' }
    const st = evaluate(p, now, false, 'a'.repeat(64))
    expect(st.state).toBe('grace')
    expect(st.message).toMatch(/internet/)
  })
})
