import { useMemo } from 'react'
import type { TagColor, TagDef } from '@shared/types'
import { useLoad } from './useAsync'

/** Tom de cada cor de etiqueta (o fundo e o texto são misturados com o tema). */
export const TAG_HEX: Record<TagColor, string> = {
  slate: '#64748b',
  red: '#dc2626',
  orange: '#ea580c',
  amber: '#d97706',
  lime: '#65a30d',
  green: '#16a34a',
  teal: '#0d9488',
  sky: '#0284c7',
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  pink: '#db2777'
}

export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  slate: 'Cinza',
  red: 'Vermelho',
  orange: 'Laranja',
  amber: 'Âmbar',
  lime: 'Lima',
  green: 'Verde',
  teal: 'Turquesa',
  sky: 'Céu',
  blue: 'Azul',
  indigo: 'Índigo',
  violet: 'Violeta',
  pink: 'Rosa'
}

export function tagStyle(color: TagColor | string | undefined): React.CSSProperties {
  const hex = TAG_HEX[(color as TagColor) ?? 'slate'] ?? TAG_HEX.slate
  return {
    background: `color-mix(in oklab, ${hex} 15%, var(--color-panel))`,
    color: `color-mix(in oklab, ${hex} 72%, var(--color-ink))`,
    borderColor: `color-mix(in oklab, ${hex} 32%, var(--color-panel))`
  }
}

/** Etiquetas da conta com cor, recarregáveis. */
export function useTagDefs(accountId: string | null | undefined): {
  defs: TagDef[]
  colorOf: (name: string) => TagColor
  reload: () => Promise<void>
} {
  const q = useLoad(
    () => (accountId ? window.api.invoke('tags:list', { accountId }) : Promise.resolve([] as TagDef[])),
    [accountId]
  )
  const defs = useMemo(() => q.data ?? [], [q.data])
  const map = useMemo(() => new Map(defs.map((d) => [d.name.toLowerCase(), d.color])), [defs])
  return { defs, colorOf: (n) => map.get(n.toLowerCase()) ?? 'slate', reload: q.reload }
}
