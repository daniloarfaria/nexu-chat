import { app } from 'electron'
import { NEXU_SITE } from '@shared/site'
import { getSetting, setSetting } from './db'

export interface NovidadeResumo {
  versao: string
  data: string
  titulo: string
  resumo: string
  destaques: string[]
  url: string
}

function cmp(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** Novidades das versões importantes que o usuário ainda não viu (até a versão instalada). */
export async function pendingNovidades(): Promise<NovidadeResumo[]> {
  const current = app.getVersion()
  const seen = getSetting<string | null>('novidades_vistas', null)
  if (seen && cmp(seen, current) >= 0) return []
  try {
    const res = await fetch(`${NEXU_SITE}/api/novidades?desde=${encodeURIComponent(seen ?? '0.0.0')}`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return []
    const data = (await res.json()) as { novidades?: NovidadeResumo[] }
    return (data.novidades ?? [])
      .filter((n) => /^\d+\.\d+\.\d+$/.test(n.versao) && cmp(n.versao, current) <= 0)
      .filter((n) => n.url.startsWith(`${NEXU_SITE}/novidades/`))
      .slice(0, 3)
  } catch {
    return []
  }
}

export function markNovidadesSeen(): void {
  setSetting('novidades_vistas', app.getVersion())
}
