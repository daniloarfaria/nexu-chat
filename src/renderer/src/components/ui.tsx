import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' }
>(function Button({ variant = 'secondary', loading, size = 'md', className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-55',
        size === 'md' ? 'h-9 px-3.5 text-[14px]' : 'h-8 px-2.5 text-[13px]',
        variant === 'primary' && 'bg-accent text-on-accent shadow-card hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line-strong bg-panel text-ink shadow-card hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken hover:text-ink',
        variant === 'danger' && 'border border-line-strong bg-panel text-bad hover:border-bad hover:bg-bad-soft',
        className
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-line-strong bg-panel px-3 text-[14px] text-ink placeholder:text-ink-3 transition-colors duration-150 focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-3 focus:ring-accent/20 disabled:opacity-60',
        className
      )}
      {...rest}
    />
  )
})

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  htmlFor?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[13px] text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-line-strong'
      )}
    >
      <span
        className={cn(
          'inline-block size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-out',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        )}
      />
    </button>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
  className
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('rounded-xl border border-line bg-panel shadow-card', className)}>
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink text-balance">{title}</h1>
        {description && <p className="mt-1 max-w-[68ch] text-[14px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Notice({
  tone = 'info',
  children,
  icon
}: {
  tone?: 'info' | 'warn' | 'bad' | 'ok'
  children: ReactNode
  icon?: ReactNode
}): React.JSX.Element {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-[13.5px]',
        tone === 'info' && 'bg-info-soft text-ink',
        tone === 'warn' && 'bg-warn-soft text-ink',
        tone === 'bad' && 'bg-bad-soft text-ink',
        tone === 'ok' && 'bg-ok-soft text-ink'
      )}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div>{children}</div>
    </div>
  )
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[14px] leading-[1.5] text-ink placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none focus-visible:outline-none',
        className
      )}
      {...rest}
    />
  )
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-line-strong bg-panel px-2.5 text-[14px] text-ink focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Badge({
  tone = 'neutral',
  children,
  className
}: {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info'
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[12px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-sunken text-ink-2',
        tone === 'accent' && 'bg-accent-soft text-accent-ink',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'bad' && 'bg-bad-soft text-bad',
        tone === 'info' && 'bg-info-soft text-info',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Empty({
  icon,
  title,
  children,
  action
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <span className="text-ink-3">{icon}</span>
      <h2 className="mt-3 text-[16px] font-semibold">{title}</h2>
      {children && <p className="mt-1 max-w-[52ch] text-[14px] text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Painel lateral para editar algo sem sair da página. */
export function Drawer({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Fechar" className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div
        className={cn(
          'relative flex h-full flex-col border-l border-line bg-panel shadow-pop',
          wide ? 'w-[min(760px,92vw)]' : 'w-[min(520px,92vw)]'
        )}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[13px] text-ink-2 hover:bg-sunken hover:text-ink"
          >
            Fechar
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Janela flutuante no meio da tela. Esc ou clique fora fecha; o Tab fica preso dentro dela
 * e, ao fechar, o foco volta para onde estava (ex.: o cartão que abriu a janela).
 */
export function Modal({
  label,
  onClose,
  children,
  className
}: {
  /** Nome lido pelo leitor de tela. */
  label: string
  onClose: () => void
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  // Guardado já na primeira renderização: os filhos (ex.: a caixa de mensagem) pegam o foco antes dos efeitos daqui
  const [before] = useState(() => document.activeElement as HTMLElement | null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  useEffect(() => {
    const el = box.current
    // Algum filho (ex.: a caixa de mensagem) já pode ter pegado o foco; se não, foca a janela
    if (el && !el.contains(document.activeElement)) el.focus()
    if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
      el.animate(
        [
          { opacity: 0, transform: 'translateY(8px) scale(0.985)' },
          { opacity: 1, transform: 'none' }
        ],
        {
          duration: 180,
          easing: ease
        }
      )
      backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: ease })
    }
    return () => {
      if (before?.isConnected) before.focus()
    }
  }, [before])

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close.current()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
    if (!items.length) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const at = document.activeElement
    if (e.shiftKey && (at === first || at === box.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && at === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4">
      <div ref={backdrop} aria-hidden className="absolute inset-0 bg-black/40" onClick={() => close.current()} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          'relative flex max-h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop focus:outline-none',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items
}: {
  value: T
  onChange: (v: T) => void
  items: Array<{ id: T; label: string; count?: number }>
}): React.JSX.Element {
  return (
    <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex h-10 items-center gap-1.5 border-b-2 px-3 text-[14px] transition-colors',
            value === t.id ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink'
          )}
        >
          {t.label}
          {t.count != null && <span className="tabular text-[12px] text-ink-3">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  indeterminate?: boolean
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-pointer accent-[var(--color-accent)]"
    />
  )
}
