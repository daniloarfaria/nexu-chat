import { expect, test } from 'vitest'
import { bucketLabel, fillBuckets, periodRange } from '../src/renderer/src/lib/painel'

const at = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12).getTime()

test('fillBuckets completa os dias sem venda', () => {
  const out = fillBuckets(
    [{ key: '2026-11-03', label: '', revenueCents: 500, won: 1 }],
    'day',
    at(2026, 11, 1),
    at(2026, 11, 5)
  )
  expect(out.map((r) => r.key)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
  expect(out[2].revenueCents).toBe(500)
  expect(out[0].revenueCents).toBe(0)
})

test('fillBuckets agrupa por semana (segunda-feira) e por mês', () => {
  const w = fillBuckets([], 'week', at(2026, 11, 5), at(2026, 11, 20)) // 5/11/2026 é quinta
  expect(w.map((r) => r.key)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
  const m = fillBuckets([], 'month', at(2026, 9, 10), at(2026, 11, 2))
  expect(m.map((r) => r.key)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
})

test('fillBuckets devolve os dados originais quando passa de 400 períodos', () => {
  const data = [{ key: '2020-01-01', label: '', revenueCents: 1, won: 1 }]
  expect(fillBuckets(data, 'day', at(2020, 1, 1), at(2022, 1, 1))).toBe(data)
  // exatamente 400 ainda preenche
  expect(fillBuckets([], 'day', at(2026, 1, 1), at(2026, 1, 1) + 399 * 86_400_000 + 1)).toHaveLength(400)
})

test('bucketLabel mostra o ano e "Semana de"', () => {
  expect(bucketLabel('2026-11-03', 'day')).toBe('03/11/2026')
  expect(bucketLabel('2026-11-03', 'week')).toBe('Semana de 03/11/2026')
  expect(bucketLabel('2026-11-01', 'month')).toBe('nov/2026')
  expect(bucketLabel('2026-11-03', 'day', true)).toBe('03/11')
})

test('periodRange recalcula quando o dia muda', () => {
  const a = periodRange('30', new Date(2026, 10, 10, 9))
  const b = periodRange('30', new Date(2026, 10, 11, 9))
  expect(b.from).toBeGreaterThan(a.from)
  expect(periodRange('month', new Date(2026, 10, 10)).from).toBe(new Date(2026, 10, 1).getTime())
})
