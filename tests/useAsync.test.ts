import { describe, expect, it } from 'vitest'
import { settle } from '../src/renderer/src/lib/useAsync'

describe('settle (item 15): sucesso e erro de chamadas que não devolvem nada', () => {
  it('IPC void: sucesso tem ok verdadeiro mesmo com valor undefined', async () => {
    const r = await settle(async () => undefined)
    expect(r).toEqual({ ok: true, value: undefined })
  })
  it('erro vira ok falso com a mensagem', async () => {
    const r = await settle(async () => {
      throw new Error('Nota não encontrada')
    })
    expect(r).toEqual({ ok: false, error: 'Nota não encontrada' })
  })
})
