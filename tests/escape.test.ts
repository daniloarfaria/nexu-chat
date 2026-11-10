import { describe, expect, it, vi } from 'vitest'
import { escapeInner, guardedClose } from '../src/renderer/src/lib/escape'

const ev = (key: string): { key: string; stopPropagation: () => void } => ({ key, stopPropagation: vi.fn() })

describe('Esc dentro de algo aberto na janela', () => {
  it('fecha só o que está aberto e não deixa o Esc chegar à janela', () => {
    const e = ev('Escape')
    const close = vi.fn()
    expect(escapeInner(e, true, close)).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(e.stopPropagation).toHaveBeenCalledOnce()
  })

  it('nada aberto: o Esc segue para a janela', () => {
    const e = ev('Escape')
    const close = vi.fn()
    expect(escapeInner(e, false, close)).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(e.stopPropagation).not.toHaveBeenCalled()
  })

  it('outra tecla é ignorada', () => {
    const e = ev('a')
    expect(escapeInner(e, true, vi.fn())).toBe(false)
    expect(e.stopPropagation).not.toHaveBeenCalled()
  })
})

describe('fechar a janela com alteração não salva', () => {
  it('sem alteração: fecha direto', () => {
    const close = vi.fn()
    const ask = vi.fn(() => true)
    guardedClose(() => false, ask, close)
    expect(ask).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('com alteração: pergunta e só fecha se a pessoa confirmar', () => {
    const close = vi.fn()
    guardedClose(() => true, () => false, close)
    expect(close).not.toHaveBeenCalled()
    guardedClose(() => true, () => true, close)
    expect(close).toHaveBeenCalledOnce()
  })
})
