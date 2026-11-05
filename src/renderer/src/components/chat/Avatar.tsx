import { Users } from 'lucide-react'
import { cn } from '../../lib/cn'

const PALETTE = [
  '#C2410C',
  '#0F766E',
  '#1D4ED8',
  '#7E22CE',
  '#BE185D',
  '#4D7C0F',
  '#B45309',
  '#0E7490',
  '#9F1239',
  '#4338CA'
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function initials(name: string): string {
  const clean = name.replace(/^\+/, '').trim()
  if (/^\d/.test(clean)) return clean.slice(-2)
  const parts = clean.split(/\s+/).filter((p) => /\p{L}/u.test(p))
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export function Avatar({
  id,
  name,
  group,
  size = 40,
  className
}: {
  id: string
  name: string
  group?: boolean
  size?: number
  className?: string
}): React.JSX.Element {
  const color = PALETTE[hash(id) % PALETTE.length]
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white select-none', className)}
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.36) }}
    >
      {group ? <Users style={{ width: size * 0.45, height: size * 0.45 }} strokeWidth={2} /> : initials(name)}
    </span>
  )
}
