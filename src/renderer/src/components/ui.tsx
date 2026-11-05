import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
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
