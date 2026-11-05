import type { ConnectionStatus } from '@shared/types'
import { cn } from '../lib/cn'

const MAP: Record<ConnectionStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  connected: { label: 'Conectado', cls: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  connecting: { label: 'Conectando', cls: 'bg-info-soft text-info', dot: 'bg-info', pulse: true },
  qr: { label: 'Aguardando leitura', cls: 'bg-warn-soft text-warn', dot: 'bg-warn', pulse: true },
  disconnected: { label: 'Desconectado', cls: 'bg-sunken text-ink-2', dot: 'bg-ink-3' },
  logged_out: { label: 'Sem sessão', cls: 'bg-bad-soft text-bad', dot: 'bg-bad' }
}

export function StatusPill({ status, className }: { status: ConnectionStatus; className?: string }): React.JSX.Element {
  const m = MAP[status]
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap',
        m.cls,
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', m.dot, m.pulse && 'animate-pulse')} aria-hidden />
      {m.label}
    </span>
  )
}

export function StatusDot({ status }: { status: ConnectionStatus }): React.JSX.Element {
  const m = MAP[status]
  return (
    <span
      className={cn('size-2 rounded-full', m.dot, m.pulse && 'animate-pulse')}
      title={m.label}
      aria-label={m.label}
    />
  )
}
