import { useState } from 'react'
import { Save } from 'lucide-react'
import type { Account, RobotSettings, RobotWhen } from '@shared/types'
import { useActiveAccount } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import { Button, Field, Input, Notice, Section, Select, Switch, Textarea } from './ui'

const WHEN: Array<{ id: RobotWhen; label: string }> = [
  { id: 'new', label: 'Só conversas novas' },
  { id: 'away', label: 'Só fora do horário de atendimento' },
  { id: 'always', label: 'Sempre (inclusive conversas antigas)' }
]

type NumKey = 'resumeMin' | 'perHour' | 'perChat'
/** Faixas aceitas (as mesmas do processo principal). */
const RANGE: Record<NumKey, { min: number; max: number; label: string }> = {
  resumeMin: { min: 5, max: 1440, label: 'Minutos até a IA retomar' },
  perHour: { min: 1, max: 60, label: 'Respostas por hora' },
  perChat: { min: 1, max: 30, label: 'Respostas por conversa' }
}

/** Configurações → Robô de atendimento. Cada número de WhatsApp tem a sua tela (a chave zera o rascunho). */
export function RobotConfig(): React.JSX.Element {
  const account = useActiveAccount()
  if (!account) return <Notice>Crie uma conta para configurar o robô de atendimento.</Notice>
  return <RobotConfigForm key={account.id} account={account} />
}

function RobotConfigForm({ account }: { account: Account }): React.JSX.Element {
  const accountId = account.id
  const enabledModule = !!account.modules.iaAtendimento
  const cfg = useLoad(
    () => (enabledModule ? window.api.invoke('robot:settings-get', { accountId }) : Promise.resolve(null)),
    [accountId, enabledModule]
  )
  // O que a pessoa mudou na tela; o resto vem do que está salvo. Os números ficam como texto até salvar.
  const [edit, setEdit] = useState<Partial<Omit<RobotSettings, NumKey>>>({})
  const [nums, setNums] = useState<Partial<Record<NumKey, string>>>({})
  const [info, setInfo] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  if (!enabledModule)
    return (
      <Notice>
        O módulo <b>Robô de atendimento com IA</b> está desligado, fora do seu plano ou falta ligar o Assistente de IA.
        Ligue em Configurações → Módulos.
      </Notice>
    )
  if (!cfg.data) return <p className="text-[14px] text-ink-2">Carregando…</p>
  const saved = cfg.data
  const draft: RobotSettings = { ...saved, ...edit }
  const numText = (k: NumKey): string => nums[k] ?? String(saved[k])

  const set = (patch: Partial<Omit<RobotSettings, NumKey>>): void => {
    setInfo(null)
    setEdit((e) => ({ ...e, ...patch }))
  }
  const setNum = (k: NumKey, v: string): void => {
    setInfo(null)
    setProblem(null)
    setNums((n) => ({ ...n, [k]: v.replace(/\D/g, '') }))
  }

  async function save(): Promise<void> {
    const out: Partial<RobotSettings> = { ...edit }
    for (const k of Object.keys(RANGE) as NumKey[]) {
      const text = nums[k]
      if (text === undefined) continue
      const n = Number(text)
      const r = RANGE[k]
      if (text === '' || !Number.isInteger(n) || n < r.min || n > r.max) {
        setProblem(`${r.label}: use um número de ${r.min} a ${r.max}.`)
        return
      }
      out[k] = n
    }
    setProblem(null)
    const r = await run('save', () => window.api.invoke('robot:settings-save', { accountId, patch: out }))
    if (r) {
      setEdit({})
      setNums({})
      setInfo('Salvo.')
      await cfg.reload()
    }
  }

  const numField = (k: NumKey, id: string, hint: string): React.JSX.Element => (
    <Field label={RANGE[k].label} htmlFor={id} hint={`${hint} De ${RANGE[k].min} a ${RANGE[k].max}.`}>
      <Input
        id={id}
        inputMode="numeric"
        className="tabular"
        value={numText(k)}
        onChange={(e) => setNum(k, e.target.value)}
      />
    </Field>
  )

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Section
        title="Robô de atendimento"
        description={`Número: ${account.name}. A IA responde os clientes por este número, usando o contexto do seu negócio.`}
        actions={<Switch label="Robô ligado" checked={draft.enabled} onChange={(v) => set({ enabled: v })} />}
      >
        <div className="flex flex-col gap-4">
          <Notice tone="info">
            A cada resposta, trechos anonimizados da conversa vão para a IA que você configurou. Nunca vai telefone,
            CPF, e-mail ou endereço. A IA não responde em grupos, não escreve para quem pediu SAIR e passa para uma
            pessoa quando não sabe, quando o cliente pede ou quando reclama. Se a IA ficar fora do ar, ela para e a
            conversa vai para &quot;Esperando atendente&quot;, sem mandar texto nenhum ao cliente.
          </Notice>
          <Field label="Quando a IA atende" htmlFor="robot-when">
            <Select id="robot-when" value={draft.when} onChange={(e) => set({ when: e.target.value as RobotWhen })}>
              {WHEN.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            {numField(
              'resumeMin',
              'robot-resume',
              'Se o atendente assumiu e o cliente esperou esse tempo, a IA volta.'
            )}
            {numField('perHour', 'robot-hour', 'Somando todas as conversas deste número.')}
            {numField('perChat', 'robot-chat', 'Em 24 horas, em cada conversa.')}
          </div>
          <div className="flex items-center gap-3 text-[14px]">
            <Switch
              label="Passar para um atendente quando o cliente estiver pronto para fechar a compra"
              checked={draft.handoffOnClose}
              onChange={(v) => set({ handoffOnClose: v })}
            />
            <span aria-hidden>Passar para um atendente quando o cliente estiver pronto para fechar a compra</span>
          </div>
        </div>
      </Section>

      <Section
        title="Atendentes e assuntos"
        description="Quando a IA passa uma conversa para uma pessoa, ela escolhe o atendente pelo assunto. O app não tem login por atendente: isso é um aviso e um filtro, não uma permissão."
      >
        <Field
          label="Uma pessoa por linha"
          htmlFor="robot-agents"
          hint="Exemplo: Ana: lentes de contato, financeiro. Sem lista, a conversa vai para qualquer atendente."
        >
          <Textarea
            id="robot-agents"
            rows={5}
            maxLength={3000}
            placeholder={'Ana: lentes de contato, financeiro\nCarlos: armações, consertos'}
            value={draft.agentsText}
            onChange={(e) => set({ agentsText: e.target.value })}
          />
        </Field>
      </Section>

      {(problem || error) && (
        <p role="alert" className="text-[13px] text-bad">
          {problem ?? error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
          <Save className="size-4" aria-hidden /> Salvar
        </Button>
        {info && (
          <span role="status" className="text-[13px] text-ok">
            {info}
          </span>
        )}
      </div>
    </div>
  )
}
