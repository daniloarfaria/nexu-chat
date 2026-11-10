import { useEffect, useState } from 'react'
import { Bot, Hand } from 'lucide-react'
import type { ChatAiState } from '@shared/types'
import { robotLabel } from '../../lib/robot'
import { useAction } from '../../lib/useAsync'
import { Badge, Button, Textarea } from '../ui'

/**
 * Faixa no topo da conversa: quem está atendendo (IA ou pessoa), o botão de assumir ou devolver
 * e o contexto extra que o atendente escreve para a IA (só vale para esta conversa).
 */
export function RobotBar({ accountId, jid }: { accountId: string; jid: string }): React.JSX.Element {
  const [state, setState] = useState<ChatAiState | null>(null)
  const [open, setOpen] = useState(false)
  const [extra, setExtra] = useState('')
  const [robotOn, setRobotOn] = useState<boolean | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.api
        .invoke('robot:chat-get', { accountId, jid })
        .then((s) => {
          if (!alive) return
          setState(s)
          setLoadError(null)
          setExtra((cur) => (cur === '' || cur === s?.extra ? (s?.extra ?? '') : cur))
        })
        .catch((e: Error) => alive && setLoadError(e.message))
      window.api
        .invoke('robot:settings-get', { accountId })
        .then((c) => alive && setRobotOn(c.enabled))
        .catch(() => undefined)
    }
    load()
    const off = window.api.on('robot:changed', (p) => {
      if (p.accountId === accountId && p.jid === jid) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [accountId, jid])

  const label = robotLabel(state)
  const ia = state?.mode === 'ia'

  async function toggle(): Promise<void> {
    const r = await run('toggle', () =>
      window.api.invoke(ia ? 'robot:chat-assume' : 'robot:chat-give-back', { accountId, jid })
    )
    if (r) setState(r)
  }

  async function saveExtra(): Promise<void> {
    const r = await run('extra', () => window.api.invoke('robot:chat-extra', { accountId, jid, extra }))
    if (r) {
      setState(r)
      setOpen(false)
    }
  }

  return (
    <div className="border-b border-line bg-panel px-4 py-2" aria-label="Robô de atendimento">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-ink-3" aria-hidden />
        {robotOn === false ? (
          <Badge tone="warn">Robô desligado</Badge>
        ) : label ? (
          <Badge tone={label.tone}>{label.text}</Badge>
        ) : (
          <Badge>Sem robô nesta conversa</Badge>
        )}
        {label?.hint && <span className="text-[12.5px] text-ink-2">{label.hint}</span>}
        {state?.mode === 'espera' && state.agent && (
          <span className="text-[12.5px] text-ink-2">Atendente indicado: {state.agent}</span>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {state?.extra ? 'Contexto extra (preenchido)' : 'Contexto extra'}
        </Button>
        <Button
          size="sm"
          variant={ia ? 'secondary' : 'primary'}
          loading={busy === 'toggle'}
          disabled={robotOn === false && !ia}
          title={robotOn === false && !ia ? 'Ligue o robô em Configurações → Robô de atendimento' : undefined}
          onClick={() => void toggle()}
        >
          {ia ? (
            <>
              <Hand className="size-3.5" aria-hidden /> Assumir atendimento
            </>
          ) : (
            <>
              <Bot className="size-3.5" aria-hidden /> Devolver para a IA
            </>
          )}
        </Button>
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="text-[12.5px] text-ink-2" htmlFor={`robot-extra-${jid}`}>
            Instrução para a IA só nesta conversa (por exemplo: ofereça a armação X). Ela vai junto de cada resposta.
          </label>
          <Textarea
            id={`robot-extra-${jid}`}
            rows={3}
            maxLength={1000}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button size="sm" variant="primary" loading={busy === 'extra'} onClick={() => void saveExtra()}>
              Salvar
            </Button>
          </div>
        </div>
      )}
      {(error || loadError) && (
        <p role="alert" className="mt-1 text-[12.5px] text-bad">
          {error ?? loadError}
        </p>
      )}
    </div>
  )
}
