import { useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import type { Reminder } from '@shared/types'
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
  Textarea
} from '../components/ui'

type Draft = Omit<Reminder, 'id' | 'lastRunDay'> & { id?: number }

const TEMPLATES: Array<{ label: string; draft: Draft }> = [
  {
    label: 'Aniversário',
    draft: {
      name: 'Aniversário',
      kind: 'birthday',
      field: null,
      offsetDays: 0,
      sendHour: 10,
      template:
        '{Parabéns|Feliz aniversário}, {primeiro_nome}! 🎉 A equipe da {loja} deseja um dia muito especial. Passe na loja este mês e ganhe um presente!',
      tags: [],
      enabled: true
    }
  },
  {
    label: 'Pós-venda (7 dias)',
    draft: {
      name: 'Pós-venda',
      kind: 'days_after',
      field: 'data_compra',
      offsetDays: 7,
      sendHour: 11,
      template:
        'Oi {primeiro_nome}, tudo bem? Aqui é da {loja}. Como está se adaptando com a compra? Se precisar de qualquer ajuste, é só chamar!',
      tags: [],
      enabled: true
    }
  },
  {
    label: 'Revisão anual de grau',
    draft: {
      name: 'Revisão anual',
      kind: 'yearly',
      field: 'data_compra',
      offsetDays: 0,
      sendHour: 10,
      template:
        'Oi {primeiro_nome}! Já faz um ano desde seus óculos na {loja}. Que tal agendar sua revisão de grau? Responda aqui que separamos um horário.',
      tags: [],
      enabled: true
    }
  }
]

const KIND_LABEL = { birthday: 'Aniversário', days_after: 'Dias depois de uma data', yearly: 'Todo ano na data' }

function Form({
  accountId,
  draft,
  onDone
}: {
  accountId: string
  draft: Draft
  onDone: () => void
}): React.JSX.Element {
  const [r, setR] = useState(draft)
  const [tags, setTags] = useState(draft.tags.join(', '))
  const fields = useLoad(() => window.api.invoke('people:fields', { accountId }), [accountId])
  const { busy, error, run } = useAction()
  return (
    <Drawer
      title={draft.id ? 'Editar lembrete' : 'Novo lembrete'}
      onClose={onDone}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy === 's'}
            onClick={async () =>
              (await run('s', () =>
                window.api.invoke('reminders:save', {
                  accountId,
                  reminder: {
                    ...r,
                    tags: tags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  }
                })
              )) && onDone()
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <Field label="Nome" htmlFor="l-name">
          <Input id="l-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
        </Field>
        <Field label="Quando enviar" htmlFor="l-kind">
          <Select id="l-kind" value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value as Draft['kind'] })}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {r.kind !== 'birthday' && (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Campo de data do contato"
              htmlFor="l-field"
              hint="Vem da planilha importada (ex.: data_compra)."
            >
              <Select
                id="l-field"
                value={r.field ?? ''}
                onChange={(e) => setR({ ...r, field: e.target.value || null })}
              >
                <option value="">Escolha…</option>
                {(fields.data ?? []).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={r.kind === 'days_after' ? 'Quantos dias depois' : 'Dias de antecedência (negativo) ou atraso'}
              htmlFor="l-off"
            >
              <Input
                id="l-off"
                type="number"
                value={r.offsetDays}
                onChange={(e) => setR({ ...r, offsetDays: Number(e.target.value) })}
              />
            </Field>
          </div>
        )}
        <Field
          label="Horário"
          htmlFor="l-hour"
          hint="O envio respeita a Proteção anti-bloqueio (horário e limite diário)."
        >
          <div className="flex items-center gap-2">
            <Input
              id="l-hour"
              type="number"
              min={0}
              max={23}
              className="w-20"
              value={r.sendHour}
              onChange={(e) => setR({ ...r, sendHour: Number(e.target.value) })}
            />
            <span className="text-[13px] text-ink-2">h</span>
          </div>
        </Field>
        <Field label="Só para quem tem as etiquetas (opcional)" htmlFor="l-tags">
          <Input id="l-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: VIP" />
        </Field>
        <Field
          label="Mensagem"
          htmlFor="l-tpl"
          hint="Use {primeiro_nome}, {loja}, campos do contato e {Oi|Olá} para variar."
        >
          <Textarea id="l-tpl" rows={6} value={r.template} onChange={(e) => setR({ ...r, template: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  )
}

export function Lembretes(): React.JSX.Element {
  const account = useActiveAccount()
  const accountId = account?.id ?? ''
  const [editing, setEditing] = useState<Draft | null>(null)
  const list = useLoad(
    () => (accountId ? window.api.invoke('reminders:list', { accountId }) : Promise.resolve([])),
    [accountId]
  )
  const counts = useLoad(async () => {
    const out: Record<number, number> = {}
    for (const r of list.data ?? [])
      out[r.id] = await window.api.invoke('reminders:preview', { accountId, id: r.id }).catch(() => 0)
    return out
  }, [list.data])
  const { run } = useAction()
  if (!account) return <Empty icon={<CalendarClock className="size-9" />} title="Crie uma conta primeiro" />

  return (
    <div>
      <PageHeader
        title="Lembretes"
        description="Mensagens automáticas em datas importantes de cada cliente, enviadas uma vez por pessoa e por período."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <Button key={t.label} onClick={() => setEditing(t.draft)}>
            <Plus className="size-4" /> {t.label}
          </Button>
        ))}
      </div>
      {(list.data ?? []).length === 0 && !list.loading ? (
        <Empty icon={<CalendarClock className="size-9" strokeWidth={1.5} />} title="Nenhum lembrete">
          Comece pelo aniversário (usa a coluna de nascimento da planilha) ou pelo pós-venda (usa um campo de data, como
          data_compra).
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {(list.data ?? []).map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-4 rounded-xl border border-line bg-panel px-5 py-3.5 shadow-card"
            >
              <CalendarClock className="size-5 shrink-0 text-accent" />
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r)}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.name}</span>
                  <Badge>
                    {KIND_LABEL[r.kind]}
                    {r.kind !== 'birthday' && ` · ${r.field} ${r.offsetDays ? `+${r.offsetDays}d` : ''}`}
                  </Badge>
                  {r.tags.map((t) => (
                    <Badge key={t} tone="accent">
                      {t}
                    </Badge>
                  ))}
                </div>
                <p className="mt-0.5 truncate text-[13px] text-ink-2">{r.template}</p>
              </button>
              <span className="tabular text-right text-[12.5px] text-ink-2">
                {counts.data?.[r.id] ?? '…'} hoje
                <span className="block text-ink-3">às {r.sendHour}h</span>
              </span>
              <Switch
                label={`Ativar ${r.name}`}
                checked={r.enabled}
                onChange={(v) =>
                  void run('t', () =>
                    window.api.invoke('reminders:save', { accountId, reminder: { ...r, enabled: v } })
                  ).then(() => list.reload())
                }
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Excluir"
                onClick={() =>
                  confirm('Excluir este lembrete?') &&
                  void run('d', () => window.api.invoke('reminders:delete', { accountId, id: r.id })).then(() =>
                    list.reload()
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <Form accountId={accountId} draft={editing} onDone={() => (setEditing(null), void list.reload())} />}
    </div>
  )
}
