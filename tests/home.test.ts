import { describe, expect, it } from 'vitest'
import { homePage } from '../src/renderer/src/lib/home'
import type { Modules } from '../src/shared/types'

describe('tela inicial', () => {
  it('é Conversas por padrão e sem número cadastrado', () => {
    expect(homePage(null)).toBe('conversas')
    expect(homePage(undefined)).toBe('conversas')
    expect(homePage({ conversas: true } as Modules)).toBe('conversas')
  })
  it('cai em Contatos quando o módulo Conversas está desligado', () => {
    expect(homePage({ conversas: false } as Modules)).toBe('contatos')
  })
})
