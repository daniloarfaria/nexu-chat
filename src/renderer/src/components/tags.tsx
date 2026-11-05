import { useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { TAG_COLORS, type TagColor, type TagDef } from '@shared/types'
import { cn } from '../lib/cn'
import { TAG_COLOR_LABEL, TAG_HEX, tagStyle } from '../lib/tagColors'

export function TagChip({
  name,
  color,
  onRemove,
  size = 'md',
  className
}: {
  name: string
  color?: TagColor | string
  onRemove?: () => void
  size?: 'sm' | 'md'
  className?: string
}): React.JSX.Element {
  return (
    <span
      style={tagStyle(color)}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-[11.5px]' : 'h-6 px-2 text-[12.5px]',
        className
      )}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Tirar etiqueta ${name}`}
          onClick={onRemove}
          className="-mr-0.5 grid size-4 place-items-center rounded-full opacity-70 hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

export function ColorDot({ color, className }: { color: TagColor | string; className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: TAG_HEX[color as TagColor] ?? TAG_HEX.slate }}
    />
  )
}

export function ColorPicker({
  value,
  onChange,
  label = 'Cor'
}: {
  value: TagColor
  onChange: (c: TagColor) => void
  label?: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={TAG_COLOR_LABEL[c]}
          title={TAG_COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn(
            'grid size-6 place-items-center rounded-full ring-offset-2 ring-offset-panel transition-shadow',
            value === c ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-line-strong'
          )}
          style={{ background: TAG_HEX[c] }}
        >
          {value === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}

/**
 * Escolha de etiquetas com busca; digitar um nome novo e apertar Enter cria a etiqueta.
 * Mostra as escolhidas como chips coloridos.
 */
export function TagPicker({
  defs,
  value,
  onChange,
  allowCreate = true,
  placeholder = 'Adicionar etiqueta…',
  autoFocus
}: {
  defs: TagDef[]
  value: string[]
  onChange: (tags: string[]) => void
  allowCreate?: boolean
  placeholder?: string
  autoFocus?: boolean
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const colorOf = (n: string): TagColor => defs.find((d) => d.name.toLowerCase() === n.toLowerCase())?.color ?? 'slate'
  const chosen = new Set(value.map((v) => v.toLowerCase()))
  const term = q.trim()
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const options = defs.filter((d) => !chosen.has(d.name.toLowerCase()) && fold(d.name).includes(fold(term)))
  const exact = defs.some((d) => d.name.toLowerCase() === term.toLowerCase()) || chosen.has(term.toLowerCase())
  const canCreate = allowCreate && term.length > 0 && term.length <= 40 && !exact
  const total = options.length + (canCreate ? 1 : 0)

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(name: string): void {
    onChange([...value, name])
    setQ('')
    setHi(0)
  }

  return (
    <div ref={box} className="relative">
      <div
        className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-panel px-2 py-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20"
        onClick={() => setOpen(true)}
      >
        {value.map((t) => (
          <TagChip key={t} name={t} color={colorOf(t)} onRemove={() => onChange(value.filter((x) => x !== t))} />
        ))}
        <input
          value={q}
          autoFocus={autoFocus}
          aria-label={placeholder}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          onFocus={() => setOpen(true)}
          onChange={(e) => (setQ(e.target.value), setOpen(true), setHi(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHi((h) => Math.min(h + 1, total - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHi((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (hi < options.length && options[hi]) pick(options[hi].name)
              else if (canCreate) pick(term)
            } else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1))
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={value.length ? '' : placeholder}
          className="h-6 min-w-24 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </div>
      {open && total > 0 && (
        <ul
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-pop"
        >
          {options.slice(0, 50).map((d, i) => (
            <li key={d.name} role="option" aria-selected={hi === i}>
              <button
                type="button"
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(d.name)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13.5px]',
                  hi === i && 'bg-sunken'
                )}
              >
                <ColorDot color={d.color} />
                <span className="flex-1 truncate">{d.name}</span>
                <span className="tabular text-[12px] text-ink-3">{d.count}</span>
              </button>
            </li>
          ))}
          {canCreate && (
            <li role="option" aria-selected={hi === options.length}>
              <button
                type="button"
                onMouseEnter={() => setHi(options.length)}
                onClick={() => pick(term)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13.5px] text-accent',
                  hi === options.length && 'bg-sunken'
                )}
              >
                <Plus className="size-3.5" /> Criar etiqueta “{term}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Lista de etiquetas para ligar/desligar (filtros e público de campanha). */
export function TagToggles({
  defs,
  value,
  onChange,
  tone = 'on',
  empty = 'Nenhuma etiqueta ainda.'
}: {
  defs: TagDef[]
  value: string[]
  onChange: (tags: string[]) => void
  tone?: 'on' | 'exclude'
  empty?: string
}): React.JSX.Element {
  if (!defs.length) return <p className="text-[13px] text-ink-3">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {defs.map((d) => {
        const on = value.includes(d.name)
        return (
          <button
            key={d.name}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d.name) : [...value, d.name])}
            style={on && tone === 'on' ? tagStyle(d.color) : undefined}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors',
              on
                ? tone === 'on'
                  ? 'font-medium'
                  : 'border-bad bg-bad-soft text-bad'
                : 'border-line-strong text-ink-2 hover:text-ink'
            )}
          >
            {on && tone === 'on' ? <Check className="size-3.5" /> : <ColorDot color={d.color} />}
            {d.name}
            <span className="tabular text-[12px] opacity-60">{d.count}</span>
          </button>
        )
      })}
    </div>
  )
}
