import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, MessagesSquare, Search, X } from 'lucide-react'
import type { MessageItem } from '@shared/types'
import { useActiveAccount, useApp } from '../lib/store'
import { useChats } from '../lib/chatStore'
import { ChatList } from '../components/chat/ChatList'
import { Message } from '../components/chat/Message'
import { Composer } from '../components/chat/Composer'
import { Avatar } from '../components/chat/Avatar'
import { dayKey, dayLabel, chatTime } from '../components/chat/time'
import { formatPhone } from '../lib/format'
import { Button, Input } from '../components/ui'
import { DealBar } from '../components/chat/DealBar'
import { useActiveAccount as useAcc } from '../lib/store'

function MessageSearch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { accountId, select } = useChats()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<MessageItem & { chatName: string }>>([])
  useEffect(() => {
    if (!accountId || q.trim().length < 2) return
    const t = setTimeout(() => {
      void window.api.invoke('messages:search', { accountId, query: q }).then(setResults)
    }, 200)
    return () => clearTimeout(t)
  }, [q, accountId])

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Input
          autoFocus
          placeholder="Buscar nas mensagens"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar nas mensagens"
        />
        <Button variant="ghost" aria-label="Fechar busca" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <ul className="flex-1 overflow-y-auto">
        {(q.trim().length >= 2 ? results : []).map((r) => (
          <li key={r.chatJid + r.id}>
            <button
              onClick={async () => {
                await select(r.chatJid)
                setTimeout(() => document.getElementById(`msg-${r.id}`)?.scrollIntoView({ block: 'center' }), 150)
              }}
              className="w-full border-b border-line px-4 py-2.5 text-left hover:bg-sunken"
            >
              <div className="flex justify-between text-[12.5px] text-ink-2">
                <span className="truncate font-medium text-ink">{r.chatName}</span>
                <span className="tabular shrink-0">{chatTime(r.ts)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{r.text}</p>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && results.length === 0 && (
          <li className="px-4 py-8 text-center text-[13px] text-ink-3">Nada encontrado.</li>
        )}
      </ul>
    </div>
  )
}

function ChatView({ jid }: { jid: string }): React.JSX.Element {
  const { messages, chats, loadOlder, hasOlder } = useChats()
  const account = useAcc()
  const state = useApp((s) => (s.activeAccountId ? s.states[s.activeAccountId] : undefined))
  const chat = chats.find((c) => c.jid === jid)
  const list = messages[jid]
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const [showJump, setShowJump] = useState(false)

  // Mantém no fim ao abrir e ao chegar mensagem (se já estava no fim)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (prevHeight.current != null) {
      el.scrollTop = el.scrollHeight - prevHeight.current
      prevHeight.current = null
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [list])

  useEffect(() => {
    atBottom.current = true
  }, [jid])

  const onScroll = useCallback(async () => {
    const el = scroller.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setShowJump(!atBottom.current)
    if (el.scrollTop < 200 && hasOlder[jid] !== false && prevHeight.current == null) {
      prevHeight.current = el.scrollHeight
      const got = await loadOlder(jid)
      if (!got) prevHeight.current = null
    }
  }, [jid, hasOlder, loadOlder])

  const jump = (id: string): void => {
    const el = document.getElementById(`msg-${id}`)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.animate([{ background: 'var(--color-accent-soft)' }, { background: 'transparent' }], { duration: 1200 })
    }
  }

  const disabled =
    state?.status !== 'connected'
      ? 'Conecte o WhatsApp desta conta para enviar mensagens.'
      : chat?.readOnly
        ? 'Só administradores podem enviar mensagens neste grupo.'
        : null

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel pr-16 pl-4">
        <Avatar id={jid} name={chat?.name ?? ''} group={chat?.isGroup} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{chat?.name ?? formatPhone(jid.split('@')[0])}</div>
          <div className="tabular truncate text-[12.5px] text-ink-2">
            {chat?.isGroup ? 'Grupo' : chat?.phone ? formatPhone(chat.phone) : ''}
          </div>
        </div>
        {account?.modules.vendas && !chat?.isGroup && <DealBar key={jid} accountId={account.id} jid={jid} />}
      </header>

      <div className="relative min-h-0 flex-1 bg-sunken">
        <div ref={scroller} onScroll={() => void onScroll()} className="absolute inset-0 overflow-y-auto py-3">
          {list == null ? (
            <div className="flex flex-col gap-3 px-[6%] pt-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-10 w-1/3 animate-pulse rounded-xl bg-panel ${i % 2 ? 'self-end' : ''}`} />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="mt-16 text-center text-[13.5px] text-ink-2">Nenhuma mensagem salva nesta conversa ainda.</p>
          ) : (
            list.map((m, i) => {
              const prev = list[i - 1]
              const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts)
              const showSender =
                newDay || !prev || prev.sender !== m.sender || prev.fromMe !== m.fromMe || prev.type === 'system'
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="sticky top-1 z-10 my-3 flex justify-center">
                      <span className="rounded-md bg-panel px-3 py-1 text-[12px] font-medium text-ink-2 shadow-card first-letter:uppercase">
                        {dayLabel(m.ts)}
                      </span>
                    </div>
                  )}
                  <Message m={m} showSender={showSender} isGroup={!!chat?.isGroup} onJump={jump} />
                </div>
              )
            })
          )}
        </div>
        {showJump && (
          <button
            aria-label="Ir para a última mensagem"
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
            className="absolute right-5 bottom-4 grid size-10 place-items-center rounded-full border border-line bg-panel text-ink-2 shadow-pop hover:text-ink"
          >
            <ArrowDown className="size-4" />
          </button>
        )}
      </div>

      <Composer jid={jid} disabled={disabled} />
    </div>
  )
}

export function Conversas(): React.JSX.Element {
  const active = useActiveAccount()
  const { setAccount, selected } = useChats()
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    void setAccount(active?.id ?? null)
  }, [active?.id, setAccount])

  useEffect(() => () => window.ui.setFocusedChat(null), [])

  if (!active) {
    return (
      <div className="grid h-full place-items-center text-[14px] text-ink-2">Crie uma conta para ver as conversas.</div>
    )
  }

  return (
    <div className="flex h-full">
      <ChatList />
      {selected ? (
        <ChatView jid={selected} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-sunken text-center">
          <MessagesSquare className="size-10 text-ink-3" strokeWidth={1.4} />
          <p className="max-w-[40ch] text-[14px] text-ink-2">
            Escolha uma conversa à esquerda. As mensagens ficam salvas neste computador.
          </p>
          <Button variant="secondary" onClick={() => setSearching(true)}>
            <Search className="size-4" /> Buscar nas mensagens
          </Button>
        </div>
      )}
      {searching && <MessageSearch onClose={() => setSearching(false)} />}
      {selected && !searching && (
        <button
          aria-label="Buscar nas mensagens"
          title="Buscar nas mensagens"
          onClick={() => setSearching(true)}
          className="fixed top-[22px] right-5 z-20 grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink"
        >
          <Search className="size-[18px]" />
        </button>
      )}
    </div>
  )
}
