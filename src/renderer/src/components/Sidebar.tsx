import {
  Bot,
  CalendarClock,
  ChevronsUpDown,
  Contact,
  House,
  Megaphone,
  MessagesSquare,
  Moon,
  Plus,
  Settings,
  Smartphone,
  Sun,
  SunMoon,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Modules } from '@shared/types'
import { useActiveAccount, useApp, type PageId, type Theme } from '../lib/store'
import { cn } from '../lib/cn'
import { StatusDot } from './StatusPill'

interface NavItem {
  id: PageId
  label: string
  icon: LucideIcon
  module?: (m: Modules) => boolean
}

const NAV: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      { id: 'inicio', label: 'Início', icon: House },
      { id: 'conversas', label: 'Conversas', icon: MessagesSquare, module: (m) => m.conversas },
      { id: 'contatos', label: 'Contatos', icon: Contact }
    ]
  },
  {
    title: 'Marketing',
    items: [
      { id: 'campanhas', label: 'Campanhas', icon: Megaphone, module: (m) => m.campanhas },
      { id: 'lembretes', label: 'Lembretes', icon: CalendarClock, module: (m) => m.lembretes },
      {
        id: 'grupos',
        label: 'Grupos',
        icon: Users,
        module: (m) => m.gruposEnvio || m.gruposExtrair || m.gruposCriar || m.gruposModeracao
      },
      { id: 'automacoes', label: 'Respostas automáticas', icon: Zap, module: (m) => m.respostasAuto }
    ]
  },
  {
    title: 'Vendas',
    items: [
      { id: 'vendas', label: 'Vendas', icon: TrendingUp, module: (m) => m.vendas },
      { id: 'ia', label: 'Assistente de IA', icon: Bot, module: (m) => m.ia }
    ]
  }
]

function AccountSwitcher(): React.JSX.Element {
  const { accounts, states, setActive, go } = useApp()
  const active = useActiveAccount()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (!active) {
    return (
      <button
        onClick={() => go('contas')}
        className="no-drag flex h-11 w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-3 text-[13.5px] text-ink-2 hover:border-accent hover:text-ink"
      >
        <Plus className="size-4" /> Adicionar conta
      </button>
    )
  }

  return (
    <div ref={ref} className="no-drag relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 w-full items-center gap-2.5 rounded-lg border border-line bg-panel px-2.5 text-left shadow-card hover:border-line-strong"
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md text-[12px] font-semibold text-white"
          style={{ background: active.color }}
          aria-hidden
        >
          {active.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{active.name}</span>
        </span>
        <StatusDot status={states[active.id]?.status ?? 'disconnected'} />
        <ChevronsUpDown className="size-3.5 text-ink-3" aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-12 right-0 left-0 z-30 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-pop"
        >
          {accounts.map((a) => (
            <button
              key={a.id}
              role="option"
              aria-selected={a.id === active.id}
              onClick={() => {
                setActive(a.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13.5px] hover:bg-sunken',
                a.id === active.id && 'bg-sunken'
              )}
            >
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: a.color }} aria-hidden />
              <span className="flex-1 truncate">{a.name}</span>
              <StatusDot status={states[a.id]?.status ?? 'disconnected'} />
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            onClick={() => {
              go('contas')
              setOpen(false)
            }}
            className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13.5px] text-ink-2 hover:bg-sunken hover:text-ink"
          >
            <Smartphone className="size-4" /> Gerenciar contas
          </button>
        </div>
      )}
    </div>
  )
}

const THEMES: Array<{ id: Theme; icon: LucideIcon; label: string }> = [
  { id: 'light', icon: Sun, label: 'Claro' },
  { id: 'dark', icon: Moon, label: 'Escuro' },
  { id: 'system', icon: SunMoon, label: 'Automático' }
]

export function Sidebar(): React.JSX.Element {
  const { page, go, theme, setTheme, waVersion } = useApp()
  const active = useActiveAccount()
  const isMac = navigator.userAgent.includes('Mac')

  return (
    <aside className="drag flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-side">
      <div className={cn('flex items-center gap-2 px-4', isMac ? 'h-[52px] pl-[84px]' : 'h-12')}>
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Disparador</span>
      </div>

      <div className="px-3 pb-3">
        <AccountSwitcher />
      </div>

      <nav className="no-drag flex-1 overflow-y-auto px-3 pb-3" aria-label="Principal">
        {NAV.map((group, gi) => {
          const items = group.items.filter((it) => !it.module || !active || it.module(active.modules))
          if (!items.length) return null
          return (
            <div key={gi} className={cn(gi > 0 && 'mt-5')}>
              {group.title && <div className="px-2.5 pb-1.5 text-[12px] font-medium text-ink-3">{group.title}</div>}
              <ul className="flex flex-col gap-0.5">
                {items.map((it) => {
                  const Icon = it.icon
                  const current = page === it.id
                  return (
                    <li key={it.id}>
                      <button
                        onClick={() => go(it.id)}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors duration-150',
                          current
                            ? 'bg-panel font-medium text-ink shadow-card'
                            : 'text-ink-2 hover:bg-panel/60 hover:text-ink'
                        )}
                      >
                        <Icon className={cn('size-[17px]', current ? 'text-accent' : 'text-ink-3')} strokeWidth={1.9} />
                        {it.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="no-drag border-t border-line px-3 py-3">
        <button
          onClick={() => go('configuracoes')}
          aria-current={page === 'configuracoes' ? 'page' : undefined}
          className={cn(
            'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors',
            page === 'configuracoes'
              ? 'bg-panel font-medium text-ink shadow-card'
              : 'text-ink-2 hover:bg-panel/60 hover:text-ink'
          )}
        >
          <Settings className="size-[17px] text-ink-3" strokeWidth={1.9} />
          Configurações
        </button>
        <div className="mt-2 flex items-center justify-between px-2.5">
          <span className="tabular truncate text-[11px] text-ink-3" title="Versão do WhatsApp Web em uso">
            WA {waVersion ? waVersion.version.join('.') : '…'}
          </span>
          <div className="flex rounded-md border border-line bg-panel p-0.5" role="radiogroup" aria-label="Tema">
            {THEMES.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={theme === t.id}
                  aria-label={t.label}
                  title={t.label}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    'grid size-6 place-items-center rounded-[5px] text-ink-3 hover:text-ink',
                    theme === t.id && 'bg-sunken text-ink'
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}
