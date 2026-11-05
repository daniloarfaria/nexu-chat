export type V = [number, number, number]

/** "2.3000.1053174903-alpha" → [2, 3000, 1053174903] */
export function parseWaVersion(s: unknown): V | null {
  if (typeof s !== 'string') return null
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s.trim())
  if (!m) return null
  const v = [Number(m[1]), Number(m[2]), Number(m[3])] as V
  return v.every((n) => Number.isSafeInteger(n) && n >= 0) && v[0] === 2 ? v : null
}
