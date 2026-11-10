import { useEffect, useRef, useState } from 'react'
import { Archive, BellOff, CheckCheck, Loader2, MessageSquarePlus, Pin, Search, X } from 'lucide-react'
import type { ChatFilter } from '@shared/types'
import { useChatStore } from '../../lib/chatStore'
import { cn } from '../../lib/cn'
import { Avatar } from './Avatar'
import { chatTime } from './time'
import { Badge, Button, Input } from '../ui'
import { useActiveAccount } from '../../lib/store'

const FILTERS: Array<{ id: ChatFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'unread', label: 'Não lidas' },
  { id: 'groups', label: 'Grupos' },
  { id: 'archived', label: 'Arquivadas' }
]

function NewChat({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { accountId, select, loadChats } = useChatStore()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function go(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!accountId) return
    setBusy(true)
    setError(null)
    try {
      const jid = await window.api.invoke('chats:new', { accountId, phone })
      await loadChats(true)
      await select(jid)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={go} className="border-b border-line bg-sunken px-3 py-3">
      <div className="flex gap-2">
        <Input
          autoFocus
          inputMode="tel"
          placeholder="DDD + número"
          aria-label="Número para nova conversa"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button type="submit" variant="primary" loading={busy} disabled={phone.replace(/\D/g, '').length < 10}>
          Abrir
        </Button>
      </div>
      {error && <p className="mt-1.5 text-[12.5px] text-bad">{error}</p>}
    </form>
  )
}

export function ChatList(): React.JSX.Element {
  const { chats, filter, search, setFilter, setSearch, selected, select, loadChats, hasMore, loadingChats, sync } =
    useChatStore()
  const adsOn = !!useActiveAccount()?.modules.metaConversoes
  const sentinel = useRef<HTMLDivElement>(null)
  const [newChat, setNewChat] = useState(false)

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && hasMore && !loadingChats) void loadChats()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadingChats, loadChats])

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            value={search}
            onChange={(e) => void setSearch(e.target.value)}
            placeholder="Buscar conversa"
            aria-label="Buscar conversa"
            className="pr-8 pl-8"
          />
          {search && (
            <button
              aria-label="Limpar busca"
              onClick={() => void setSearch('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-3 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button
          size="md"
          variant="ghost"
          aria-label="Nova conversa"
          title="Nova conversa"
          onClick={() => setNewChat((v) => !v)}
        >
          <MessageSquarePlus className="size-[18px]" />
        </Button>
      </div>
      <div className="flex gap-1 px-3 pb-2" role="tablist" aria-label="Filtro de conversas">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => void setFilter(f.id)}
            className={cn(
              'h-7 rounded-full px-3 text-[12.5px] transition-colors',
              filter === f.id ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:bg-sunken'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {newChat && <NewChat onClose={() => setNewChat(false)} />}
      {sync?.running && (
        <div
          className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-[12.5px]"
          role="status"
        >
          <Loader2 className="size-3.5 animate-spin text-info" />
          <span className="flex-1">
            Sincronizando histórico… <span className="tabular">{sync.messages.toLocaleString('pt-BR')}</span> mensagens
          </span>
          {sync.progress != null && <span className="tabular text-ink-2">{sync.progress}%</span>}
        </div>
      )}

      <ul className="flex-1 overflow-y-auto" role="listbox" aria-label="Conversas">
        {chats.map((c) => {
          const active = c.jid === selected
          return (
            <li key={c.jid} role="option" aria-selected={active}>
              <button
                onClick={() => void select(c.jid)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                  active ? 'bg-sunken' : 'hover:bg-sunken/60'
                )}
              >
                <Avatar id={c.jid} name={c.name} group={c.isGroup} size={44} />
                <div className="min-w-0 flex-1 border-b border-line/0">
                  <div className="flex items-baseline gap-2">
                    <span className={cn('flex-1 truncate text-[14.5px]', c.unread ? 'font-semibold' : 'font-medium')}>
                      {c.name}
                    </span>
                    <span
                      className={cn(
                        'tabular shrink-0 text-[11.5px]',
                        c.unread ? 'font-medium text-accent' : 'text-ink-3'
                      )}
                    >
                      {chatTime(c.lastTs)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {c.lastFromMe && (
                      <CheckCheck className="size-3.5 shrink-0 text-ink-3" aria-label="Enviada por você" />
                    )}
                    <span className={cn('flex-1 truncate text-[13px]', c.unread ? 'text-ink' : 'text-ink-2')}>
                      {c.lastPreview ?? ''}
                    </span>
                    {adsOn && c.fromAd && <Badge tone="info">Veio de anúncio</Badge>}
                    {c.muted && <BellOff className="size-3.5 shrink-0 text-ink-3" aria-label="Silenciada" />}
                    {c.pinned && <Pin className="size-3.5 shrink-0 text-ink-3" aria-label="Fixada" />}
                    {c.archived && <Archive className="size-3.5 shrink-0 text-ink-3" aria-label="Arquivada" />}
                    {c.unread > 0 && (
                      <span className="tabular grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-on-accent">
                        {c.unread > 99 ? '99+' : c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
        <div ref={sentinel} className="h-6" />
        {!loadingChats && chats.length === 0 && (
          <li className="px-6 py-10 text-center text-[13.5px] text-ink-2">
            {search
              ? 'Nenhuma conversa encontrada.'
              : sync?.running
                ? 'As conversas aparecem aqui conforme o histórico chega.'
                : 'Nenhuma conversa ainda.'}
          </li>
        )}
      </ul>
    </div>
  )
}
