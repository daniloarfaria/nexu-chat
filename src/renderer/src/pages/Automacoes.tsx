import { useState } from 'react'
import { Clock, MessageSquareReply, Plus, Sparkle, Trash2, Zap } from 'lucide-react'
import type { AutoRule } from '@shared/types'
import { useActiveAccount } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import {
  Badge,
  Button,
  Drawer,
  Empty,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Switch,
  Tabs,
  Textarea
} from '../components/ui'
import { RecuperarVendas } from '../components/RecuperarVendas'
import { cn } from '../lib/cn'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const KIND = {
  keyword: {
    label: 'Palavra-chave',
    icon: MessageSquareReply,
    hint: 'Responde quando a mensagem do cliente contém uma das palavras.'
  },
  away: { label: 'Fora do horário', icon: Clock, hint: 'Responde quem escreve fora do horário de atendimento.' },
  welcome: {
    label: 'Primeira mensagem',
    icon: Sparkle,
    hint: 'Boas-vindas para quem fala com a loja pela primeira vez.'
  }
} as const

type Draft = Omit<AutoRule, 'id'> & { id?: number }

function RuleForm({
  accountId,
  rule,
  onDone
}: {
  accountId: string
  rule: Draft
  onDone: () => void
}): React.JSX.Element {
  const [r, setR] = useState<Draft>(rule)
  const [kw, setKw] = useState(rule.keywords.join(', '))
  const { busy, error, run } = useAction()
  const sch = r.schedule ?? { hourStart: 8, hourEnd: 18, days: [1, 2, 3, 4, 5, 6] }
  return (
    <Drawer
      title={rule.id ? 'Editar resposta automática' : 'Nova resposta automática'}
      onClose={onDone}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy === 's'}
            onClick={async () => {
              const ok = await run('s', () =>
                window.api.invoke('rules:save', {
                  accountId,
                  rule: {
                    ...r,
                    keywords: kw
                      .split(',')
                      .map((k) => k.trim())
                      .filter(Boolean),
                    schedule: r.kind === 'away' ? sch : undefined
                  }
                })
              )
              if (ok) onDone()
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <Field label="Tipo">
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(KIND) as Array<keyof typeof KIND>).map((k) => {
              const Icon = KIND[k].icon
              return (
                <button
                  key={k}
                  aria-pressed={r.kind === k}
                  onClick={() => setR({ ...r, kind: k, name: r.name || KIND[k].label })}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-[13px]',
                    r.kind === k ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
                  )}
                >
                  <Icon className="size-4 text-accent" />
                  <span className="font-medium">{KIND[k].label}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[12.5px] text-ink-3">{KIND[r.kind].hint}</p>
        </Field>
        <Field label="Nome" htmlFor="r-name">
          <Input id="r-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
        </Field>
        {r.kind === 'keyword' && (
          <>
            <Field label="Palavras-chave" htmlFor="r-kw" hint="Separe por vírgula. Acentos e maiúsculas não importam.">
              <Input
                id="r-kw"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="horário, endereço, onde fica"
              />
            </Field>
            <Field label="Quando" htmlFor="r-mode">
              <Select
                id="r-mode"
                value={r.matchMode}
                onChange={(e) => setR({ ...r, matchMode: e.target.value as Draft['matchMode'] })}
              >
                <option value="contains">A mensagem contém a palavra</option>
                <option value="starts">A mensagem começa com a palavra</option>
                <option value="exact">A mensagem é exatamente a palavra</option>
              </Select>
            </Field>
          </>
        )}
        {r.kind === 'away' && (
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Atendimento das" htmlFor="r-h1">
              <Input
                id="r-h1"
                type="number"
                min={0}
                max={23}
                className="w-20"
                value={sch.hourStart}
                onChange={(e) => setR({ ...r, schedule: { ...sch, hourStart: Number(e.target.value) } })}
              />
            </Field>
            <Field label="até" htmlFor="r-h2">
              <Input
                id="r-h2"
                type="number"
                min={1}
                max={24}
                className="w-20"
                value={sch.hourEnd}
                onChange={(e) => setR({ ...r, schedule: { ...sch, hourEnd: Number(e.target.value) } })}
              />
            </Field>
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  aria-pressed={sch.days.includes(i)}
                  onClick={() =>
                    setR({
                      ...r,
                      schedule: {
                        ...sch,
                        days: sch.days.includes(i) ? sch.days.filter((x) => x !== i) : [...sch.days, i].sort()
                      }
                    })
                  }
                  className={cn(
                    'h-9 w-11 rounded-lg border text-[13px]',
                    sch.days.includes(i)
                      ? 'border-accent bg-accent-soft text-accent-ink'
                      : 'border-line-strong text-ink-2'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Resposta" htmlFor="r-reply" hint="Pode usar {primeiro_nome}, {nome} e {loja}.">
          <Textarea id="r-reply" rows={5} value={r.reply} onChange={(e) => setR({ ...r, reply: e.target.value })} />
        </Field>
        <Field label="Não repetir para a mesma pessoa por" htmlFor="r-cd">
          <div className="flex items-center gap-2">
            <Input
              id="r-cd"
              type="number"
              min={1}
              className="w-24"
              value={r.cooldownMin}
              onChange={(e) => setR({ ...r, cooldownMin: Math.max(1, Number(e.target.value)) })}
            />
            <span className="text-[13px] text-ink-2">minutos</span>
          </div>
        </Field>
      </div>
    </Drawer>
  )
}

function RespostasAuto(): React.JSX.Element {
  const account = useActiveAccount()
  const accountId = account?.id ?? ''
  const [editing, setEditing] = useState<Draft | null>(null)
  const list = useLoad(
    () => (accountId ? window.api.invoke('rules:list', { accountId }) : Promise.resolve([])),
    [accountId]
  )
  const { run } = useAction()
  if (!account) return <Empty icon={<Zap className="size-9" />} title="Crie uma conta primeiro" />
  const blank: Draft = {
    name: 'Palavra-chave',
    kind: 'keyword',
    enabled: true,
    keywords: [],
    matchMode: 'contains',
    reply: '',
    cooldownMin: 60
  }

  return (
    <div>
      <PageHeader
        title="Respostas automáticas"
        description="Respondem sozinhas em conversas individuais (nunca em grupos). Quem responde SAIR é removido das campanhas e recebe uma confirmação, mesmo com este módulo desligado."
        actions={
          <Button variant="primary" onClick={() => setEditing(blank)}>
            <Plus className="size-4" /> Nova resposta
          </Button>
        }
      />
      <Notice tone="info">
        Para evitar bloqueio e conversas em círculo, o app responde no máximo 30 vezes por hora e nunca repete a mesma
        resposta para a mesma pessoa dentro do intervalo escolhido.
      </Notice>
      <div className="mt-4">
        {(list.data ?? []).length === 0 && !list.loading ? (
          <Empty
            icon={<Zap className="size-9" strokeWidth={1.5} />}
            title="Nenhuma resposta automática"
            action={
              <Button variant="primary" onClick={() => setEditing(blank)}>
                <Plus className="size-4" /> Criar
              </Button>
            }
          >
            Exemplos: horário de funcionamento, endereço, “seu óculos está pronto?”, mensagem fora do expediente.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {(list.data ?? []).map((r) => {
              const Icon = KIND[r.kind].icon
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-4 rounded-xl border border-line bg-panel px-5 py-3.5 shadow-card"
                >
                  <Icon className="size-5 shrink-0 text-accent" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r)}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.name}</span>
                      <Badge>{KIND[r.kind].label}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-ink-2">
                      {r.kind === 'keyword' && <span className="text-ink">{r.keywords.join(', ')} → </span>}
                      {r.reply}
                    </p>
                  </button>
                  <Switch
                    label={`Ativar ${r.name}`}
                    checked={r.enabled}
                    onChange={(v) =>
                      void run('t', () =>
                        window.api.invoke('rules:save', { accountId, rule: { ...r, enabled: v } })
                      ).then(() => list.reload())
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Excluir"
                    onClick={() =>
                      confirm('Excluir esta resposta?') &&
                      void run('d', () => window.api.invoke('rules:delete', { accountId, id: r.id })).then(() =>
                        list.reload()
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {editing && (
        <RuleForm accountId={accountId} rule={editing} onDone={() => (setEditing(null), void list.reload())} />
      )}
    </div>
  )
}

export function Automacoes(): React.JSX.Element {
  const account = useActiveAccount()
  const [tab, setTab] = useState<'respostas' | 'recuperar'>('respostas')
  // Sem o módulo de recuperação, a tela é a de sempre
  if (!account?.modules.recuperacao) return <RespostasAuto />
  return (
    <div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'respostas', label: 'Respostas automáticas' },
          { id: 'recuperar', label: 'Recuperar vendas' }
        ]}
      />
      {tab === 'respostas' ? (
        <RespostasAuto />
      ) : (
        <>
          <PageHeader
            title="Recuperar vendas"
            description="A IA chama de volta quem pediu orçamento e sumiu, com até 3 mensagens e um desconto que só você define."
          />
          <RecuperarVendas />
        </>
      )}
    </div>
  )
}
