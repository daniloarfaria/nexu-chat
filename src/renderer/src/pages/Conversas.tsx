import { useEffect, useState } from 'react'
import { ArrowRight, MessagesSquare, Search, Smartphone, X } from 'lucide-react'
import type { MessageItem } from '@shared/types'
import { useActiveAccount, useApp } from '../lib/store'
import { useChatStore } from '../lib/chatStore'
import { ChatList } from '../components/chat/ChatList'
import { ChatView } from '../components/chat/ChatView'
import { chatTime } from '../components/chat/time'
import { Button, Input } from '../components/ui'

function MessageSearch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { accountId, select } = useChatStore()
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

export function Conversas(): React.JSX.Element {
  const active = useActiveAccount()
  const go = useApp((s) => s.go)
  const { setAccount, selected } = useChatStore()
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    void setAccount(active?.id ?? null)
  }, [active?.id, setAccount])

  // O estado principal só vale como "na tela" enquanto Conversas está aberta
  const setActiveView = useChatStore((s) => s.setActive)
  useEffect(() => {
    setActiveView(true)
    return () => setActiveView(false)
  }, [setActiveView])

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-sunken px-8 text-center">
        <Smartphone className="size-10 text-accent" strokeWidth={1.4} />
        <h2 className="text-[18px] font-semibold">Conecte seu WhatsApp</h2>
        <p className="max-w-[44ch] text-[14px] text-ink-2">
          Para ver e responder as conversas da loja, crie a conta e leia o QR Code com o celular. Leva menos de um
          minuto.
        </p>
        <Button variant="primary" onClick={() => go('contas')}>
          Conectar número <ArrowRight className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <ChatList />
      {selected ? (
        <ChatView key={selected} jid={selected} />
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
