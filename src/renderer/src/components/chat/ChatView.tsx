import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { useActiveAccount, useApp } from '../../lib/store'
import { useChatStore } from '../../lib/chatStore'
import { formatPhone } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Message } from './Message'
import { Composer } from './Composer'
import { Avatar } from './Avatar'
import { ContactStrip } from './ContactStrip'
import { DealBar } from './DealBar'
import { dayKey, dayLabel } from './time'

/**
 * Uma conversa aberta: cabeçalho, mensagens (com as antigas sob demanda) e caixa de envio.
 * Lê o estado do contexto, então serve tanto para a tela Conversas quanto para a janela do funil.
 * `embedded`: dentro de outra janela (sem a faixa de etiquetas e funis, que a janela já mostra).
 */
export function ChatView({
  jid,
  embedded,
  fallbackName
}: {
  jid: string
  embedded?: boolean
  /** Nome a mostrar quando a conversa ainda não existe (ex.: contato do funil que nunca conversou). */
  fallbackName?: string
}): React.JSX.Element {
  const { messages, chats, loadOlder, hasOlder } = useChatStore()
  const account = useActiveAccount()
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
      <header
        className={cn(
          'relative flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel pl-4',
          embedded ? 'pr-4' : 'pr-16'
        )}
      >
        <Avatar id={jid} name={chat?.name ?? fallbackName ?? ''} group={chat?.isGroup} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">
            {chat?.name ?? fallbackName ?? formatPhone(jid.split('@')[0])}
          </div>
          <div className="tabular truncate text-[12.5px] text-ink-2">
            {chat?.isGroup
              ? 'Grupo'
              : chat?.phone
                ? formatPhone(chat.phone)
                : fallbackName
                  ? formatPhone(jid.split('@')[0])
                  : ''}
          </div>
        </div>
        {account?.modules.vendas && !chat?.isGroup && <DealBar key={jid} accountId={account.id} jid={jid} />}
      </header>
      {account && !embedded && !jid.endsWith('@g.us') && (
        <ContactStrip key={jid} accountId={account.id} jid={jid} funil={!!account.modules.funil} />
      )}

      <div className="relative min-h-0 flex-1 bg-sunken">
        <div ref={scroller} onScroll={() => void onScroll()} className="absolute inset-0 overflow-y-auto py-3">
          {list == null ? (
            <div className="flex flex-col gap-3 px-[6%] pt-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-10 w-1/3 animate-pulse rounded-xl bg-panel ${i % 2 ? 'self-end' : ''}`} />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="mt-16 px-6 text-center text-[13.5px] text-ink-2">
              Nenhuma mensagem salva nesta conversa ainda.
              {!disabled && ' Escreva abaixo para começar.'}
            </p>
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
