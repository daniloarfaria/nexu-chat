import { useState } from 'react'
import { Save } from 'lucide-react'
import type { RobotSettings, RobotWhen } from '@shared/types'
import { useActiveAccount } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import { Button, Field, Input, Notice, Section, Select, Switch, Textarea } from './ui'

const WHEN: Array<{ id: RobotWhen; label: string }> = [
  { id: 'new', label: 'Só conversas novas' },
  { id: 'away', label: 'Só fora do horário de atendimento' },
  { id: 'always', label: 'Sempre (inclusive conversas antigas)' }
]

/** Configurações → Robô de atendimento */
export function RobotConfig(): React.JSX.Element {
  const account = useActiveAccount()
  const accountId = account?.id ?? ''
  const enabledModule = !!account?.modules.iaAtendimento
  const cfg = useLoad(
    () => (accountId && enabledModule ? window.api.invoke('robot:settings-get', { accountId }) : Promise.resolve(null)),
    [accountId, enabledModule]
  )
  // O que a pessoa mudou na tela; o resto vem do que está salvo
  const [edit, setEdit] = useState<Partial<RobotSettings>>({})
  const draft: RobotSettings | null = cfg.data ? { ...cfg.data, ...edit } : null
  const [info, setInfo] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  if (!account) return <Notice>Crie uma conta para configurar o robô de atendimento.</Notice>
  if (!enabledModule)
    return (
      <Notice>
        O módulo <b>Robô de atendimento com IA</b> está desligado, fora do seu plano ou falta ligar o Assistente de IA.
        Ligue em Configurações → Módulos.
      </Notice>
    )
  if (!draft) return <p className="text-[14px] text-ink-2">Carregando…</p>

  const set = (patch: Partial<RobotSettings>): void => {
    setInfo(null)
    setEdit((e) => ({ ...e, ...patch }))
  }
  const num = (v: string): number => Number(v.replace(/\D/g, '')) || 0

  async function save(): Promise<void> {
    if (!draft) return
    const r = await run('save', () => window.api.invoke('robot:settings-save', { accountId, patch: draft }))
    if (r) {
      setEdit({})
      setInfo('Salvo.')
      await cfg.reload()
    }
  }

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
            <Field
              label="Minutos até a IA retomar"
              htmlFor="robot-resume"
              hint="Se o atendente assumiu e o cliente ficou esperando por esse tempo, a IA volta."
            >
              <Input
                id="robot-resume"
                inputMode="numeric"
                className="tabular"
                value={draft.resumeMin}
                onChange={(e) => set({ resumeMin: num(e.target.value) })}
              />
            </Field>
            <Field label="Respostas por hora" htmlFor="robot-hour" hint="Somando todas as conversas deste número.">
              <Input
                id="robot-hour"
                inputMode="numeric"
                className="tabular"
                value={draft.perHour}
                onChange={(e) => set({ perHour: num(e.target.value) })}
              />
            </Field>
            <Field label="Respostas por conversa" htmlFor="robot-chat" hint="Em 24 horas, em cada conversa.">
              <Input
                id="robot-chat"
                inputMode="numeric"
                className="tabular"
                value={draft.perChat}
                onChange={(e) => set({ perChat: num(e.target.value) })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-[14px]">
            <Switch
              label="Passar para um atendente na hora de fechar a venda"
              checked={draft.handoffOnClose}
              onChange={(v) => set({ handoffOnClose: v })}
            />
            Passar para um atendente quando o cliente estiver pronto para fechar a compra
          </label>
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

      {error && (
        <p role="alert" className="text-[13px] text-bad">
          {error}
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
