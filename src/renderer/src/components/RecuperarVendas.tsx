import { useEffect, useState } from 'react'
import { Check, Pencil, Save, X } from 'lucide-react'
import type { Account, RecoveryFollowupItem, RecoveryQueueItem, RecoverySettings } from '@shared/types'
import { useActiveAccount } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import { Badge, Button, Empty, Field, Input, Notice, Section, Select, Switch, Tabs, Textarea } from './ui'

const money = (cents: number): string => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const REASON = { orcamento: 'Orçamento', funil: 'Cartão no funil', interesse: 'Interesse de compra' } as const
const STOP: Record<string, string> = {
  respondeu: 'O cliente respondeu',
  venda: 'Venda marcada',
  venda_removida: 'Venda apagada',
  sair: 'Pediu para não receber',
  atendente: 'Um atendente assumiu',
  manual: 'Parado por você',
  nao_se_aplica: 'Deixou de ter orçamento ou funil',
  esperando_atendente: 'Esperando atendente (robô)',
  ia_fora: 'A IA ficou fora do ar',
  sem_interesse: 'A IA viu que não faz sentido insistir',
  desligado: 'Regra desligada'
}
const STATUS: Record<RecoveryFollowupItem['status'], string> = {
  ativo: 'Em andamento',
  recuperada: 'Venda recuperada',
  parado: 'Parado',
  concluido: 'Concluído'
}

type Tab = 'aprovar' | 'regra' | 'andamento'

/** Automações → Recuperar vendas. Cada número de WhatsApp tem a sua regra (a chave zera o rascunho). */
export function RecuperarVendas(): React.JSX.Element {
  const account = useActiveAccount()
  if (!account) return <Notice>Crie uma conta para configurar a recuperação de vendas.</Notice>
  return <Inner key={account.id} account={account} />
}

function Inner({ account }: { account: Account }): React.JSX.Element {
  const accountId = account.id
  const on = !!account.modules.recuperacao
  const [tab, setTab] = useState<Tab>('aprovar')
  const queue = useLoad(
    () => (on ? window.api.invoke('recovery:queue', { accountId }) : Promise.resolve([])),
    [accountId, on]
  )
  const stats = useLoad(
    () => (on ? window.api.invoke('recovery:stats', { accountId, days: 30 }) : Promise.resolve(null)),
    [accountId, on]
  )
  const cfg = useLoad(
    () => (on ? window.api.invoke('recovery:settings-get', { accountId }) : Promise.resolve(null)),
    [accountId, on]
  )
  const follow = useLoad(
    () => (on ? window.api.invoke('recovery:followups', { accountId }) : Promise.resolve([])),
    [accountId, on]
  )

  useEffect(() => {
    return window.api.on('recovery:changed', (p) => {
      if (p.accountId !== accountId) return
      void queue.reload()
      void stats.reload()
      void follow.reload()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  if (!on)
    return (
      <Notice>
        O módulo <b>Recuperação de vendas</b> está desligado, fora do seu plano ou falta ligar o Assistente de IA. Ligue
        em Configurações → Módulos.
      </Notice>
    )

  const st = stats.data
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {cfg.data && !cfg.data.enabled && (
        <Notice tone="warn">A regra está desligada. Nada é escrito nem enviado. Ligue na aba &quot;Regra&quot;.</Notice>
      )}
      {st && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card sm:grid-cols-4">
          {(
            [
              ['Mensagens enviadas', String(st.sent), 'nos últimos 30 dias'],
              ['Clientes que responderam', String(st.replied), 'depois de uma mensagem'],
              ['Quanto voltou', money(st.recoveredCents), `${st.recovered} venda(s) recuperada(s)`],
              ['Custou em desconto', money(st.discountCents), 'estimativa, veja o manual']
            ] as Array<[string, string, string]>
          ).map(([l, v, sub]) => (
            <div key={l} className="bg-panel px-4 py-3.5">
              <dt className="text-[13px] text-ink-2">{l}</dt>
              <dd className="tabular mt-1 text-[20px] font-semibold">{v}</dd>
              <dd className="mt-0.5 text-[12px] text-ink-2">{sub}</dd>
            </div>
          ))}
        </dl>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'aprovar', label: 'Para aprovar', count: (queue.data ?? []).length },
          { id: 'andamento', label: 'Acompanhamentos', count: st?.active },
          { id: 'regra', label: 'Regra' }
        ]}
      />
      {tab === 'aprovar' && <Queue accountId={accountId} items={queue.data ?? []} reload={() => void queue.reload()} />}
      {tab === 'andamento' && (
        <Followups accountId={accountId} items={follow.data ?? []} reload={() => void follow.reload()} />
      )}
      {tab === 'regra' && cfg.data && (
        <RuleForm
          key={JSON.stringify(cfg.data)}
          accountId={accountId}
          saved={cfg.data}
          onSaved={() => void cfg.reload()}
        />
      )}
    </div>
  )
}

function Queue({
  accountId,
  items,
  reload
}: {
  accountId: string
  items: RecoveryQueueItem[]
  reload: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<number | null>(null)
  const [text, setText] = useState('')
  const { busy, error, run } = useAction()
  if (!items.length)
    return (
      <Empty icon={<Check className="size-9" strokeWidth={1.5} />} title="Nada para aprovar">
        Quando um cliente sumir depois de um orçamento, a IA escreve a mensagem e ela aparece aqui.
      </Empty>
    )
  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="bad">{error}</Notice>}
      <ul className="flex flex-col gap-3">
        {items.map((q) => (
          <li key={q.id} className="rounded-xl border border-line bg-panel p-4 shadow-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{q.chatName}</span>
              <Badge>
                Tentativa {q.n} de {q.of}
              </Badge>
              <Badge tone="info">{REASON[q.reasonIn]}</Badge>
              {q.offer ? <Badge tone="warn">Com desconto de {q.discountPct}%</Badge> : <Badge>Sem desconto</Badge>}
              {q.status === 'aprovada' && (
                <Badge tone="ok">Aprovada{q.waiting ? `, aguardando: ${q.waiting}` : ', saindo'}</Badge>
              )}
            </div>
            {editing === q.id && q.status === 'pendente' ? (
              <div className="mt-3 flex flex-col gap-2">
                <Field
                  label="Texto da mensagem"
                  htmlFor={`rec-${q.id}`}
                  hint="O desconto só pode ser o da regra. Preço e prazo só os do contexto da loja."
                >
                  <Textarea id={`rec-${q.id}`} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    loading={busy === `a${q.id}`}
                    onClick={async () => {
                      // Se o texto for recusado, o erro aparece e a edição continua aberta
                      await run(`a${q.id}`, () => window.api.invoke('recovery:approve', { accountId, id: q.id, text }))
                      reload()
                    }}
                  >
                    <Check className="size-4" /> Enviar com a edição
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-sunken px-3 py-2.5 text-[14px]">{q.text}</p>
                {q.status === 'pendente' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      loading={busy === `a${q.id}`}
                      onClick={async () => {
                        await run(`a${q.id}`, () => window.api.invoke('recovery:approve', { accountId, id: q.id }))
                        reload()
                      }}
                    >
                      <Check className="size-4" /> Aprovar e enviar
                    </Button>
                    <Button
                      onClick={() => {
                        setText(q.text)
                        setEditing(q.id)
                      }}
                    >
                      <Pencil className="size-4" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        await run(`d${q.id}`, () => window.api.invoke('recovery:discard', { accountId, id: q.id }))
                        reload()
                      }}
                    >
                      <X className="size-4" /> Não enviar esta
                    </Button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Followups({
  accountId,
  items,
  reload
}: {
  accountId: string
  items: RecoveryFollowupItem[]
  reload: () => void
}): React.JSX.Element {
  const { run } = useAction()
  if (!items.length)
    return (
      <Empty icon={<Check className="size-9" strokeWidth={1.5} />} title="Nenhum acompanhamento ainda">
        Aparecem aqui os clientes que entraram na recuperação.
      </Empty>
    )
  return (
    <ul className="flex flex-col gap-2">
      {items.map((f) => (
        <li
          key={f.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 shadow-card"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{f.chatName}</span>
              <Badge tone={f.status === 'recuperada' ? 'ok' : f.status === 'ativo' ? 'accent' : 'neutral'}>
                {STATUS[f.status]}
              </Badge>
              <Badge>{REASON[f.reasonIn]}</Badge>
            </div>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {f.attemptsSent} mensagem(ns) enviada(s)
              {f.stopReason && f.status !== 'recuperada' ? `. ${STOP[f.stopReason] ?? f.stopReason}` : ''}
              {f.status === 'recuperada'
                ? `. Voltou ${money(f.recoveredCents)}, desconto estimado ${money(f.discountCents)}`
                : ''}
            </p>
          </div>
          {f.status === 'ativo' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await run(`s${f.id}`, () => window.api.invoke('recovery:stop', { accountId, id: f.id }))
                reload()
              }}
            >
              Parar de acompanhar
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

type NumKey = 'idleHours' | 'gap1' | 'gap2' | 'discountPct' | 'discountValidDays' | 'perDay' | 'cap'

function RuleForm({
  accountId,
  saved,
  onSaved
}: {
  accountId: string
  saved: RecoverySettings
  onSaved: () => void
}): React.JSX.Element {
  const [d, setD] = useState<RecoverySettings>(saved)
  const [nums, setNums] = useState<Record<NumKey, string>>({
    idleHours: String(saved.idleHours),
    gap1: String(saved.gapDays[0]),
    gap2: String(saved.gapDays[1]),
    discountPct: String(saved.discountPct),
    discountValidDays: String(saved.discountValidDays),
    perDay: String(saved.perDay),
    cap: saved.discountCapReais == null ? '' : String(saved.discountCapReais).replace('.', ',')
  })
  const [problem, setProblem] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  const set = (p: Partial<RecoverySettings>): void => {
    setInfo(null)
    setD((x) => ({ ...x, ...p }))
  }
  const num = (k: NumKey, v: string): void => {
    setInfo(null)
    setProblem(null)
    setNums((n) => ({ ...n, [k]: k === 'cap' ? v.replace(/[^\d,]/g, '') : v.replace(/\D/g, '') }))
  }
  const field = (k: NumKey, id: string, label: string, hint: string): React.JSX.Element => (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} inputMode="numeric" className="tabular" value={nums[k]} onChange={(e) => num(k, e.target.value)} />
    </Field>
  )

  async function save(): Promise<void> {
    const int = (k: NumKey, min: number, max: number, label: string): number | null => {
      const n = Number(nums[k])
      if (nums[k] === '' || !Number.isInteger(n) || n < min || n > max) {
        setProblem(`${label}: use um número de ${min} a ${max}.`)
        return null
      }
      return n
    }
    const idle = int('idleHours', 1, 336, 'Horas sem resposta')
    const g1 = int('gap1', 1, 30, 'Dias até a 2ª tentativa')
    const g2 = int('gap2', 1, 30, 'Dias até a 3ª tentativa')
    const pct = int('discountPct', 0, 50, 'Desconto')
    const valid = int('discountValidDays', 1, 60, 'Validade do desconto')
    const perDay = int('perDay', 1, 100, 'Mensagens por dia')
    if ([idle, g1, g2, pct, valid, perDay].some((x) => x == null)) return
    const capNum = nums.cap === '' ? null : Number(nums.cap.replace(',', '.'))
    if (capNum != null && (!Number.isFinite(capNum) || capNum < 0 || capNum > 100000)) {
      setProblem('Teto do desconto: use um valor em reais, por exemplo 100.')
      return
    }
    setProblem(null)
    const r = await run('save', () =>
      window.api.invoke('recovery:settings-save', {
        accountId,
        patch: {
          enabled: d.enabled,
          mode: d.mode,
          idleHours: idle!,
          attempts: d.attempts,
          gapDays: [g1!, g2!],
          byQuote: d.byQuote,
          byFunnel: d.byFunnel,
          byInterest: d.byInterest,
          discountPct: pct!,
          discountFrom: Math.min(d.discountFrom, d.attempts),
          discountValidDays: valid!,
          discountCapReais: capNum && capNum > 0 ? capNum : null,
          discountCondition: d.discountCondition,
          perDay: perDay!
        }
      })
    )
    if (r) {
      setInfo('Salvo.')
      onSaved()
    }
  }

  const check = (label: string, v: boolean, on: (x: boolean) => void): React.JSX.Element => (
    <div className="flex items-center gap-3 text-[14px]">
      <Switch label={label} checked={v} onChange={on} />
      <span aria-hidden>{label}</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Recuperar vendas"
        description="A IA chama de volta o cliente que sumiu depois de receber a resposta da loja."
        actions={<Switch label="Recuperação ligada" checked={d.enabled} onChange={(v) => set({ enabled: v })} />}
      >
        <div className="flex flex-col gap-4">
          <Notice tone="info">
            A cada mensagem, trechos anonimizados da conversa vão para a IA que você configurou. Nunca vai telefone,
            CPF, e-mail ou endereço. O desconto é sempre o que você escrever aqui: a IA nunca escolhe nem negocia o
            número. A recuperação para sozinha quando o cliente responde, quando a venda é marcada, quando o cliente
            pede para não receber (SAIR) ou quando um atendente escreve na conversa. Se o robô de atendimento estiver
            ligado, ele sempre vem primeiro.
          </Notice>
          <Field label="Como as mensagens saem" htmlFor="rec-mode">
            <Select
              id="rec-mode"
              value={d.mode}
              onChange={(e) => set({ mode: e.target.value as RecoverySettings['mode'] })}
            >
              <option value="approve">Aprovar antes (recomendado): você vê o texto e envia com um clique</option>
              <option value="auto">Automático: a IA envia sozinha, dentro do horário e dos limites</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            {field('idleHours', 'rec-idle', 'Horas sem resposta', 'Depois da resposta da loja. Padrão: 24.')}
            <Field label="Número de tentativas" htmlFor="rec-att" hint="No máximo 3.">
              <Select
                id="rec-att"
                value={String(d.attempts)}
                onChange={(e) => set({ attempts: Number(e.target.value) })}
              >
                <option value="1">1 tentativa</option>
                <option value="2">2 tentativas</option>
                <option value="3">3 tentativas</option>
              </Select>
            </Field>
            {field('perDay', 'rec-day', 'Mensagens por dia', 'Soma de todas as conversas deste número.')}
          </div>
          {d.attempts > 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {field('gap1', 'rec-g1', 'Dias até a 2ª tentativa', 'Contados depois da 1ª. 2 dias dá a 2ª no dia 3.')}
              {d.attempts > 2 &&
                field('gap2', 'rec-g2', 'Dias até a 3ª tentativa', 'Contados depois da 2ª. 4 dias dá a 3ª no dia 7.')}
            </div>
          )}
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1 text-[13px] font-medium">Quem entra na recuperação</legend>
            {check('Conversa de cliente com a etiqueta ou a etapa "Orçamento"', d.byQuote, (v) => set({ byQuote: v }))}
            {check('Cartão em um funil que não está em ganho nem em perdido', d.byFunnel, (v) => set({ byFunnel: v }))}
            {check(
              'Conversa em que a IA percebe interesse de compra (usa a IA para ler a conversa)',
              d.byInterest,
              (v) => set({ byInterest: v })
            )}
          </fieldset>
        </div>
      </Section>
      <Section
        title="Desconto"
        description='Zero em "Desconto" significa sem desconto. O texto sai exatamente como você configurar aqui.'
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {field('discountPct', 'rec-pct', 'Desconto (%)', 'De 0 a 50.')}
          <Field label="A partir de qual tentativa" htmlFor="rec-from" hint="Padrão: só na última.">
            <Select
              id="rec-from"
              value={String(Math.min(d.discountFrom, d.attempts))}
              onChange={(e) => set({ discountFrom: Number(e.target.value) })}
            >
              {[1, 2, 3]
                .filter((n) => n <= d.attempts)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}ª tentativa
                  </option>
                ))}
            </Select>
          </Field>
          {field('discountValidDays', 'rec-valid', 'Validade (dias)', 'Conta a partir do envio.')}
          {field('cap', 'rec-cap', 'Teto do desconto em reais (opcional)', 'Em branco, sem teto. Exemplo: 100.')}
          <div className="sm:col-span-2">
            <Field
              label="Condição"
              htmlFor="rec-cond"
              hint='Exemplo: "na compra à vista". Vai junto do desconto na mensagem.'
            >
              <Input
                id="rec-cond"
                maxLength={80}
                value={d.discountCondition}
                onChange={(e) => set({ discountCondition: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Section>
      {(problem || error) && <Notice tone="bad">{problem ?? error}</Notice>}
      <div className="flex items-center gap-3">
        <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
          <Save className="size-4" /> Salvar
        </Button>
        {info && <span className="text-[13px] text-ok">{info}</span>}
      </div>
    </div>
  )
}
