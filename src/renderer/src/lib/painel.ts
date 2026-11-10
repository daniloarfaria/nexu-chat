import type { PanelBucket, PanelData } from '@shared/types'

export type Period = 'month' | 'last_month' | '30' | '90' | 'year'

/** Intervalo do período escolhido, calculado a partir de `now` (passe a data de hoje ao reabrir a tela). */
export function periodRange(p: Period, now = new Date()): { from: number; to: number; label: string } {
  const to = now.getTime() + 1
  if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to, label: 'este mês' }
  if (p === 'last_month')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      to: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      label: 'mês passado'
    }
  if (p === 'year') return { from: new Date(now.getFullYear(), 0, 1).getTime(), to, label: 'este ano' }
  const d = Number(p)
  return { from: now.getTime() - d * 86_400_000, to, label: `últimos ${d} dias` }
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Rótulo de um período do gráfico: completo (com ano) por padrão, curto (sem ano) para o eixo. */
export function bucketLabel(key: string, bucket: PanelBucket, short = false): string {
  const [y, m, d] = key.split('-')
  if (bucket === 'month') return short ? `${m}/${y.slice(2)}` : `${MONTHS[Number(m) - 1]}/${y}`
  const day = short ? `${d}/${m}` : `${d}/${m}/${y}`
  return bucket === 'week' && !short ? `Semana de ${day}` : day
}

const MAX_BUCKETS = 400

/** Completa com zero os períodos sem venda, para o eixo do tempo e a tabela mostrarem os mesmos dados. */
export function fillBuckets(
  data: PanelData['revenue'],
  bucket: PanelBucket,
  from: number,
  to: number
): PanelData['revenue'] {
  const byKey = new Map(data.map((r) => [r.key, r]))
  const out: PanelData['revenue'] = []
  const cur = new Date(from)
  cur.setHours(0, 0, 0, 0)
  if (bucket === 'week') cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7))
  if (bucket === 'month') cur.setDate(1)
  const key = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  while (cur.getTime() < to && out.length <= MAX_BUCKETS) {
    const k = key(cur)
    out.push(byKey.get(k) ?? { key: k, label: k, revenueCents: 0, won: 0 })
    if (bucket === 'month') cur.setMonth(cur.getMonth() + 1)
    else cur.setDate(cur.getDate() + (bucket === 'week' ? 7 : 1))
  }
  return out.length > MAX_BUCKETS ? data : out
}
