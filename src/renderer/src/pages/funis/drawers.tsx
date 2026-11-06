import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  MessageCircle,
  Plus,
  Settings2,
  Trash2,
  Trophy,
  X,
  XCircle
} from 'lucide-react'
import {
  PIPELINE_TEMPLATES,
  type Pipeline,
  type PipelineCard,
  type PipelineStage,
  type PipelineStageInput,
  type StageKind,
  type TagColor,
  type TagDef
} from '@shared/types'
import { cn } from '../../lib/cn'
import { formatPhone } from '../../lib/format'
import { openChat, resolveChatJid } from '../../lib/openChat'
import { ChatStoreProvider, useWindowChatStore } from '../../lib/chatStore'
import { money, useAction, useLoad } from '../../lib/useAsync'
import { Button, Checkbox, Drawer, Field, Input, Modal, Notice, Select, Tabs, Textarea } from '../../components/ui'
import { ChatView } from '../../components/chat/ChatView'
import { Avatar } from '../../components/chat/Avatar'
import { ColorDot, ColorPicker, TagPicker, TagToggles } from '../../components/tags'

const KIND_LABEL: Record<StageKind, string> = { open: 'Em andamento', won: 'Ganho', lost: 'Perdido' }

function parseMoney(v: string): number {
  const n = Number(
    v
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
  )
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

function moneyInput(cents: number): string {
  return cents ? (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''
}

// ---------- Cartão ----------

type CardProps = {
  accountId: string
  card: PipelineCard
  stages: PipelineStage[]
  tagDefs: { defs: TagDef[]; reload: () => Promise<void> }
  onMove: (stageId: number) => void
  onChanged: () => void
  onClose: () => void
}

/**
 * Janela do cartão: a conversa completa à esquerda e os dados do cartão à direita.
 * A conversa usa um estado próprio, então não troca a conversa aberta na tela Conversas.
 */
export function CardWindow(props: CardProps & { notes?: ReactNode }): React.JSX.Element {
  const { accountId, card, onClose } = props
  const name = card.name || formatPhone(card.phone)
  const [jid, setJid] = useState<string | null>(card.jid)
  const store = useWindowChatStore(accountId, jid)

  // Contato sem conversa ainda: cria pelo número, como o botão "Abrir conversa" fazia
  useEffect(() => {
    if (card.jid) return
    let alive = true
    void resolveChatJid(accountId, null, card.phone).then((j) => alive && setJid(j))
    return () => {
      alive = false
    }
  }, [accountId, card.jid, card.phone])

  return (
    <Modal label={`Cartão de ${name}`} onClose={onClose} className="h-[85vh] w-[90vw] max-w-[1400px] flex-row">
      <ChatStoreProvider store={store}>
        <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col">
          {jid ? (
            <ChatView key={jid} jid={jid} embedded fallbackName={card.name || undefined} />
          ) : (
            <div className="grid flex-1 place-items-center bg-sunken text-[13.5px] text-ink-2">Abrindo a conversa…</div>
          )}
        </section>
        <CardPanel {...props} />
      </ChatStoreProvider>
    </Modal>
  )
}

/** Dados do cartão (coluna, etiquetas, valor, nota) na coluna direita da janela. */
function CardPanel({
  accountId,
  card,
  stages,
  tagDefs,
  onMove,
  onChanged,
  onClose,
  notes
}: CardProps & { notes?: ReactNode }): React.JSX.Element {
  const [value, setValue] = useState(moneyInput(card.valueCents))
  const [note, setNote] = useState(card.note ?? '')
  const [tags, setTags] = useState(card.tags)
  const { busy, error, run } = useAction()
  const places = useLoad(
    () => window.api.invoke('pipelines:person', { accountId, personId: card.personId }),
    [accountId, card.personId, card.stageId]
  )
  const name = card.name || formatPhone(card.phone)
  const dirty = parseMoney(value) !== card.valueCents || (note.trim() || null) !== (card.note ?? null)

  async function changeTags(next: string[]): Promise<void> {
    const add = next.filter((t) => !tags.includes(t))
    const del = tags.filter((t) => !next.includes(t))
    setTags(next)
    await run('tags', async () => {
      for (const t of add) await window.api.invoke('people:tag', { accountId, ids: [card.personId], tag: t, add: true })
      for (const t of del)
        await window.api.invoke('people:tag', { accountId, ids: [card.personId], tag: t, add: false })
    })
    void tagDefs.reload()
    onChanged()
  }

  async function save(): Promise<void> {
    const ok = await run('save', () =>
      window.api.invoke('pipelines:update-card', {
        accountId,
        cardId: card.id,
        valueCents: parseMoney(value),
        note: note.trim() || null
      })
    )
    if (ok !== undefined) onChanged()
  }

  async function remove(): Promise<void> {
    if (!confirm(`Tirar ${name} deste funil? O contato continua na sua base.`)) return
    const ok = await run('rm', () => window.api.invoke('pipelines:remove-cards', { accountId, cardIds: [card.id] }))
    if (ok !== undefined) {
      onChanged()
      onClose()
    }
  }

  const others = (places.data ?? []).filter((p) => p.cardId !== card.id)

  return (
    <aside aria-label="Dados do cartão" className="flex w-[min(380px,40%)] shrink-0 flex-col border-l border-line">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <Avatar id={card.jid ?? `${card.phone}@s.whatsapp.net`} name={name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{name}</div>
          <div className="tabular text-[12.5px] text-ink-2">{formatPhone(card.phone)}</div>
        </div>
        <Button variant="ghost" size="sm" aria-label="Fechar (Esc)" title="Fechar (Esc)" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {card.optOut && (
          <div className="mb-5">
            <Notice tone="warn">Este contato pediu para não receber mensagens. Ele é pulado nos disparos.</Notice>
          </div>
        )}

        <div className="flex flex-col gap-5">
          <Field label="Coluna" htmlFor="card-stage">
            <Select
              id="card-stage"
              value={card.stageId}
              onChange={(e) => onMove(Number(e.target.value))}
              className="w-full"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.kind !== 'open' ? ` (${KIND_LABEL[s.kind].toLowerCase()})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Etiquetas" hint="Digite para buscar ou criar. Elas valem para o contato em todo o app.">
            <TagPicker defs={tagDefs.defs} value={tags} onChange={(t) => void changeTags(t)} />
          </Field>
          <Field label="Valor do negócio (R$)" htmlFor="card-val">
            <Input
              id="card-val"
              inputMode="decimal"
              className="tabular w-40"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Nota" htmlFor="card-note">
            <Textarea
              id="card-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="O que foi combinado, próximo passo, preferências…"
            />
          </Field>
          {others.length > 0 && (
            <Field label="Também está em">
              <ul className="flex flex-col gap-1.5">
                {others.map((p) => (
                  <li key={p.cardId} className="flex items-center gap-2 text-[13.5px]">
                    <ColorDot color={p.stageColor} />
                    <span className="font-medium">{p.pipelineName}</span>
                    <span className="text-ink-3">→ {p.stageName}</span>
                    {p.valueCents > 0 && <span className="tabular ml-auto text-ink-2">{money(p.valueCents)}</span>}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          <p className="tabular text-[12.5px] text-ink-3">
            No funil desde {new Date(card.createdAt).toLocaleDateString('pt-BR')} · nesta coluna desde{' '}
            {new Date(card.movedAt).toLocaleDateString('pt-BR')}
          </p>
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
        {/* Ponto de extensão: o bloco de notas do cliente (função 5) entra aqui */}
        {notes}
        <button
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => void openChat(accountId, card.jid, card.phone)}
        >
          <MessageCircle className="size-3.5" /> Abrir na tela Conversas
        </button>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">
        <Button variant="danger" className="mr-auto" loading={busy === 'rm'} onClick={() => void remove()}>
          <Trash2 className="size-4" /> Tirar do funil
        </Button>
        <Button variant="primary" disabled={!dirty} loading={busy === 'save'} onClick={() => void save()}>
          Salvar
        </Button>
      </footer>
    </aside>
  )
}

// ---------- Editor do funil ----------

type DraftStage = PipelineStageInput & { key: string; count: number }

let seq = 0
const newKey = (): string => `n${++seq}`

export function PipelineEditor({
  accountId,
  pipeline,
  tagDefs,
  onClose
}: {
  accountId: string
  pipeline: Pipeline
  tagDefs: TagDef[]
  onClose: (changed?: boolean | 'deleted') => void
}): React.JSX.Element {
  const [name, setName] = useState(pipeline.name)
  const [color, setColor] = useState<TagColor>(pipeline.color)
  const [stages, setStages] = useState<DraftStage[]>(
    pipeline.stages.map((s) => ({
      key: `s${s.id}`,
      id: s.id,
      name: s.name,
      color: s.color,
      kind: s.kind,
      autoTag: s.autoTag,
      removeTagOnLeave: s.removeTagOnLeave,
      slaDays: s.slaDays,
      description: s.description,
      count: s.count
    }))
  )
  const [open, setOpen] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  const patch = (key: string, p: Partial<DraftStage>): void =>
    setStages((l) => l.map((s) => (s.key === key ? { ...s, ...p } : s)))
  const moveBy = (i: number, d: number): void =>
    setStages((l) => {
      const j = i + d
      if (j < 0 || j >= l.length) return l
      const n = [...l]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  async function save(): Promise<void> {
    const ok = await run('save', () =>
      window.api.invoke('pipelines:save', {
        accountId,
        id: pipeline.id,
        name: name.trim(),
        color,
        stages: stages.map((s) => ({
          id: s.id,
          color: s.color,
          kind: s.kind,
          removeTagOnLeave: s.removeTagOnLeave,
          name: s.name.trim(),
          autoTag: s.autoTag?.trim() || null,
          slaDays: s.slaDays || null,
          description: s.description?.trim() || null
        }))
      })
    )
    if (ok) onClose(true)
  }

  async function remove(): Promise<void> {
    const total = pipeline.stages.reduce((n, s) => n + s.count, 0)
    if (
      !confirm(
        `Excluir o funil "${pipeline.name}"?${total ? ` Os ${total} cartões saem do funil, mas os contatos continuam na base.` : ''}`
      )
    )
      return
    const ok = await run('del', () => window.api.invoke('pipelines:delete', { accountId, id: pipeline.id }))
    if (ok !== undefined) onClose('deleted')
  }

  const removed = (pipeline.stages ?? []).filter((s) => !stages.some((d) => d.id === s.id) && s.count > 0)

  return (
    <Drawer
      title="Editar funil"
      wide
      onClose={() => onClose()}
      footer={
        <>
          <Button variant="danger" className="mr-auto" loading={busy === 'del'} onClick={() => void remove()}>
            <Trash2 className="size-4" /> Excluir funil
          </Button>
          <Button variant="ghost" onClick={() => onClose()}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy === 'save'}
            disabled={!name.trim() || !stages.length || stages.some((s) => !s.name.trim())}
            onClick={() => void save()}
          >
            Salvar funil
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_auto] items-end gap-5">
        <Field label="Nome do funil" htmlFor="pipe-name">
          <Input id="pipe-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Cor">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
      </div>

      <h3 className="mt-7 mb-1 text-[14px] font-semibold">Colunas</h3>
      <p className="mb-3 text-[13px] text-ink-2">
        Arraste a ordem com as setas. Em <b>⚙︎</b> você define etiqueta automática, prazo de alerta e descrição.
      </p>
      <ol className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <li key={s.key} className="rounded-xl border border-line bg-panel">
            <div className="flex items-center gap-2 p-2">
              <div className="flex flex-col">
                <button
                  aria-label={`Subir ${s.name}`}
                  disabled={i === 0}
                  onClick={() => moveBy(i, -1)}
                  className="grid h-4 w-6 place-items-center rounded text-ink-3 hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  aria-label={`Descer ${s.name}`}
                  disabled={i === stages.length - 1}
                  onClick={() => moveBy(i, 1)}
                  className="grid h-4 w-6 place-items-center rounded text-ink-3 hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
              <ColorDot color={s.color} className="size-3" />
              <Input
                aria-label="Nome da coluna"
                value={s.name}
                maxLength={40}
                onChange={(e) => patch(s.key, { name: e.target.value })}
                className="h-8 flex-1"
              />
              <Select
                aria-label="Tipo da coluna"
                value={s.kind}
                onChange={(e) => patch(s.key, { kind: e.target.value as StageKind })}
                className="h-8 w-36 text-[13px]"
              >
                {(Object.keys(KIND_LABEL) as StageKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
              {s.kind === 'won' && <Trophy className="size-4 text-ok" aria-hidden />}
              {s.kind === 'lost' && <XCircle className="size-4 text-ink-3" aria-hidden />}
              {s.count > 0 && <span className="tabular w-10 text-right text-[12px] text-ink-3">{s.count}</span>}
              <button
                aria-label={`Configurar ${s.name}`}
                aria-expanded={open === s.key}
                onClick={() => setOpen(open === s.key ? null : s.key)}
                className={cn(
                  'grid size-8 place-items-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink',
                  (s.autoTag || s.slaDays) && 'text-accent'
                )}
              >
                {open === s.key ? <ChevronDown className="size-4" /> : <Settings2 className="size-4" />}
              </button>
              <button
                aria-label={`Remover coluna ${s.name}`}
                disabled={stages.length === 1}
                onClick={() => setStages((l) => l.filter((x) => x.key !== s.key))}
                className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-bad-soft hover:text-bad disabled:opacity-30"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            {open === s.key && (
              <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2">
                <Field label="Cor da coluna">
                  <ColorPicker value={s.color} onChange={(c) => patch(s.key, { color: c })} />
                </Field>
                <Field
                  label="Alerta de cartão parado"
                  htmlFor={`sla-${s.key}`}
                  hint="O cartão fica amarelo depois de tantos dias nesta coluna."
                >
                  <div className="flex items-center gap-2">
                    <Input
                      id={`sla-${s.key}`}
                      type="number"
                      min={1}
                      max={365}
                      className="tabular w-24"
                      value={s.slaDays ?? ''}
                      onChange={(e) => patch(s.key, { slaDays: e.target.value ? Number(e.target.value) : null })}
                    />
                    <span className="text-[13px] text-ink-2">dias</span>
                  </div>
                </Field>
                <Field label="Etiqueta automática" hint="Colocada no contato quando o cartão entra nesta coluna.">
                  <TagPicker
                    defs={tagDefs}
                    value={s.autoTag ? [s.autoTag] : []}
                    onChange={(v) => patch(s.key, { autoTag: v[v.length - 1] ?? null })}
                    placeholder="Nenhuma"
                  />
                  {s.autoTag && (
                    <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                      <Checkbox
                        label="Tirar ao sair"
                        checked={!!s.removeTagOnLeave}
                        onChange={(v) => patch(s.key, { removeTagOnLeave: v })}
                      />
                      Tirar a etiqueta quando o cartão sair da coluna
                    </label>
                  )}
                </Field>
                <Field label="Descrição" htmlFor={`desc-${s.key}`}>
                  <Input
                    id={`desc-${s.key}`}
                    value={s.description ?? ''}
                    maxLength={200}
                    onChange={(e) => patch(s.key, { description: e.target.value })}
                    placeholder="Quando um cliente entra aqui?"
                  />
                </Field>
              </div>
            )}
          </li>
        ))}
      </ol>
      <Button
        className="mt-3"
        onClick={() => {
          const key = newKey()
          setStages((l) =>
            l.length >= 20 ? l : [...l, { key, name: `Coluna ${l.length + 1}`, color: 'slate', kind: 'open', count: 0 }]
          )
          setOpen(key)
        }}
        disabled={stages.length >= 20}
      >
        <Plus className="size-4" /> Adicionar coluna
      </Button>
      {removed.length > 0 && (
        <div className="mt-4">
          <Notice tone="warn">
            {removed.map((s) => `"${s.name}" (${s.count})`).join(', ')}: os cartões dessas colunas vão para a coluna
            anterior ao salvar.
          </Notice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Drawer>
  )
}

// ---------- Novo funil ----------

export function NewPipelineDrawer({
  accountId,
  onClose
}: {
  accountId: string
  onClose: (created?: Pipeline) => void
}): React.JSX.Element {
  const [tpl, setTpl] = useState(PIPELINE_TEMPLATES[0].id)
  const [name, setName] = useState('')
  const { busy, error, run } = useAction()

  async function create(): Promise<void> {
    const p = await run('c', () =>
      window.api.invoke('pipelines:create-template', { accountId, templateId: tpl, name: name.trim() || undefined })
    )
    if (p) onClose(p)
  }

  return (
    <Drawer
      title="Novo funil"
      onClose={() => onClose()}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose()}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy === 'c'} onClick={() => void create()}>
            Criar funil
          </Button>
        </>
      }
    >
      <Field label="Comece de um modelo" hint="Depois você renomeia, reordena e cria colunas à vontade.">
        <div role="radiogroup" aria-label="Modelo" className="flex flex-col gap-2">
          {PIPELINE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={tpl === t.id}
              onClick={() => setTpl(t.id)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors',
                tpl === t.id
                  ? 'border-accent bg-accent-soft/50 ring-3 ring-accent/15'
                  : 'border-line hover:bg-sunken/60'
              )}
            >
              <div className="text-[14px] font-semibold">{t.name}</div>
              <div className="text-[12.5px] text-ink-2">{t.description}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {t.stages.map((s, i) => (
                  <span key={s.name} className="flex items-center gap-1 text-[12px] text-ink-2">
                    {i > 0 && <span className="text-ink-3">›</span>}
                    <ColorDot color={s.color} className="size-2" />
                    {s.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </Field>
      <div className="mt-5">
        <Field label="Nome (opcional)" htmlFor="np-name">
          <Input
            id="np-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={PIPELINE_TEMPLATES.find((t) => t.id === tpl)?.name}
          />
        </Field>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Drawer>
  )
}

// ---------- Adicionar contatos ----------

export function AddPeopleDrawer({
  accountId,
  stages,
  initialStage,
  tagDefs,
  onClose
}: {
  accountId: string
  stages: PipelineStage[]
  initialStage: number
  tagDefs: TagDef[]
  onClose: (changed?: boolean) => void
}): React.JSX.Element {
  const [stageId, setStageId] = useState(initialStage)
  const [mode, setMode] = useState<'contatos' | 'etiquetas'>('contatos')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [tags, setTags] = useState<string[]>([])
  const [move, setMove] = useState(false)
  const [changed, setChanged] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  const people = useLoad(
    () => window.api.invoke('people:list', { accountId, search: q || undefined, limit: 100, offset: 0 }),
    [accountId, q]
  )
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 200)
    return () => clearTimeout(t)
  }, [search])

  const stageName = stages.find((s) => s.id === stageId)?.name ?? ''

  function say(r: { added: number; moved: number; already: number }): void {
    const parts = [`${r.added} adicionado(s) em "${stageName}"`]
    if (r.moved) parts.push(`${r.moved} movido(s)`)
    if (r.already) parts.push(`${r.already} já estava(m) no funil`)
    setResult(parts.join(' · '))
    setChanged(true)
  }

  async function add(): Promise<void> {
    setResult(null)
    const r =
      mode === 'contatos'
        ? await run('add', () =>
            window.api.invoke('pipelines:add-people', { accountId, stageId, personIds: [...picked], move })
          )
        : await run('add', () => window.api.invoke('pipelines:add-by-tags', { accountId, stageId, tags }))
    if (r) {
      say(r)
      setPicked(new Set())
    }
  }

  const items = people.data?.items ?? []
  const allOn = items.length > 0 && items.every((p) => picked.has(p.id))

  return (
    <Drawer
      title="Adicionar contatos ao funil"
      onClose={() => onClose(changed)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(changed)}>
            Fechar
          </Button>
          <Button
            variant="primary"
            loading={busy === 'add'}
            disabled={mode === 'contatos' ? picked.size === 0 : tags.length === 0}
            onClick={() => void add()}
          >
            {mode === 'contatos' ? `Adicionar ${picked.size || ''}`.trim() : 'Adicionar quem tem as etiquetas'}
          </Button>
        </>
      }
    >
      <Field label="Coluna de entrada" htmlFor="add-stage">
        <Select id="add-stage" value={stageId} onChange={(e) => setStageId(Number(e.target.value))} className="w-full">
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="mt-5">
        <Tabs
          value={mode}
          onChange={setMode}
          items={[
            { id: 'contatos', label: 'Escolher contatos' },
            { id: 'etiquetas', label: 'Por etiqueta' }
          ]}
        />
      </div>
      {mode === 'contatos' ? (
        <>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            aria-label="Buscar contatos"
          />
          <div className="mt-2 flex items-center justify-between text-[12.5px] text-ink-2">
            <label className="flex items-center gap-2">
              <Checkbox
                label="Marcar todos da lista"
                checked={allOn}
                onChange={(v) =>
                  setPicked((s) => {
                    const n = new Set(s)
                    for (const p of items) {
                      if (v) n.add(p.id)
                      else n.delete(p.id)
                    }
                    return n
                  })
                }
              />
              Marcar os {items.length} da lista
            </label>
            <span className="tabular">{people.data?.total ?? 0} contatos</span>
          </div>
          <ul className="mt-2 max-h-[46vh] overflow-y-auto rounded-lg border border-line">
            {items.map((p) => (
              <li key={p.id} className="border-b border-line last:border-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-sunken/50">
                  <Checkbox
                    label={p.name ?? p.phone}
                    checked={picked.has(p.id)}
                    onChange={(v) =>
                      setPicked((s) => {
                        const n = new Set(s)
                        if (v) n.add(p.id)
                        else n.delete(p.id)
                        return n
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{p.name || formatPhone(p.phone)}</span>
                    <span className="tabular block text-[12px] text-ink-3">{formatPhone(p.phone)}</span>
                  </span>
                  {p.tags.length > 0 && (
                    <span className="truncate text-[12px] text-ink-3">{p.tags.slice(0, 2).join(', ')}</span>
                  )}
                </label>
              </li>
            ))}
            {!people.loading && items.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-ink-3">Nenhum contato encontrado.</li>
            )}
          </ul>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
            <Checkbox label="Mover quem já está no funil" checked={move} onChange={setMove} />
            Se já estiver neste funil, mover para “{stageName}”
          </label>
        </>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-ink-2">
            Todos os contatos com <b>qualquer uma</b> das etiquetas entram na coluna. Quem já está no funil continua
            onde está.
          </p>
          <TagToggles
            defs={tagDefs}
            value={tags}
            onChange={setTags}
            empty="Nenhuma etiqueta ainda. Crie em Contatos."
          />
        </>
      )}
      {result && (
        <div className="mt-4">
          <Notice tone="ok">{result}</Notice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Drawer>
  )
}
