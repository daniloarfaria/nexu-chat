import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock,
  Filter,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SquareKanban,
  Trophy,
  UserPlus,
  X,
  XCircle
} from 'lucide-react'
import type { Pipeline, PipelineBoard, PipelineCard, PipelineStage } from '@shared/types'
import { cn } from '../lib/cn'
import { formatPhone, timeAgo } from '../lib/format'
import { useActiveAccount, useApp } from '../lib/store'
import { useChats } from '../lib/chatStore'
import { money, useAction, useLoad } from '../lib/useAsync'
import { Button, Empty, Input, Notice } from '../components/ui'
import { Avatar } from '../components/chat/Avatar'
import { ColorDot, TagChip, TagToggles } from '../components/tags'
import { TAG_HEX, useTagDefs } from '../lib/tagColors'
import { AddPeopleDrawer, CardWindow, NewPipelineDrawer, PipelineEditor } from './funis/drawers'

const DAY = 86_400_000

function remember(accountId: string, id: number): void {
  try {
    localStorage.setItem(`funil:${accountId}`, String(id))
  } catch {
    /* ignora */
  }
}
function recall(accountId: string): number | null {
  try {
    const v = Number(localStorage.getItem(`funil:${accountId}`))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export function Funis(): React.JSX.Element {
  const active = useActiveAccount()
  const accountId = active?.id ?? ''
  const pipelines = useLoad(
    () => (accountId ? window.api.invoke('pipelines:list', { accountId }) : Promise.resolve([] as Pipeline[])),
    [accountId]
  )
  // Funil pedido por outra tela (ex.: "Abrir o funil" na conversa) tem prioridade
  const [selected, setSelected] = useState<number | null>(() => {
    const o = useApp.getState().openPipelineId
    if (o) useApp.setState({ openPipelineId: null })
    return o
  })
  const [creating, setCreating] = useState(false)

  // Avatares e nomes das conversas usam a conta da tela de conversas
  useEffect(() => {
    if (accountId) void useChats.getState().setAccount(accountId)
  }, [accountId])

  const list = pipelines.data ?? []
  const want = selected ?? (accountId ? recall(accountId) : null)
  const currentId = list.find((p) => p.id === want)?.id ?? list[0]?.id ?? null

  if (!active) return <Empty icon={<SquareKanban className="size-9" />} title="Crie uma conta primeiro" />
  if (!active.modules.funil)
    return (
      <div className="p-8">
        <Notice tone="warn">O módulo Funis está desligado nesta conta. Ative em Configurações → Módulos.</Notice>
      </div>
    )

  const current = list.find((p) => p.id === currentId) ?? null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-5">
        <h1 className="mr-2 text-[17px] font-semibold tracking-[-0.01em]">Funis</h1>
        <nav aria-label="Funis" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {list.map((p) => (
            <button
              key={p.id}
              aria-current={p.id === currentId ? 'page' : undefined}
              onClick={() => (setSelected(p.id), remember(accountId, p.id))}
              className={cn(
                'flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[13.5px] transition-colors',
                p.id === currentId ? 'bg-sunken font-medium text-ink' : 'text-ink-2 hover:bg-sunken/60 hover:text-ink'
              )}
            >
              <ColorDot color={p.color} />
              {p.name}
              <span className="tabular text-[12px] text-ink-3">{p.stages.reduce((n, s) => n + s.count, 0)}</span>
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)} className="shrink-0">
            <Plus className="size-4" /> Novo funil
          </Button>
        </nav>
      </header>

      {pipelines.data && list.length === 0 ? (
        <div className="overflow-y-auto p-8">
          <FirstRun accountId={accountId} onCreated={(p) => (void pipelines.reload(), setSelected(p.id))} />
        </div>
      ) : current ? (
        <Board
          key={current.id}
          accountId={accountId}
          pipeline={current}
          onPipelinesChanged={() => void pipelines.reload()}
          onDeleted={() => (setSelected(null), void pipelines.reload())}
        />
      ) : (
        <div className="m-6 h-40 animate-pulse rounded-xl bg-sunken" />
      )}

      {creating && (
        <NewPipelineDrawer
          accountId={accountId}
          onClose={(p) => {
            setCreating(false)
            if (p) {
              void pipelines.reload()
              setSelected(p.id)
              remember(accountId, p.id)
            }
          }}
        />
      )}
    </div>
  )
}

function FirstRun({
  accountId,
  onCreated
}: {
  accountId: string
  onCreated: (p: Pipeline) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Empty
        icon={<SquareKanban className="size-9" strokeWidth={1.5} />}
        title="Organize seus clientes em etapas"
        action={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Criar primeiro funil
          </Button>
        }
      >
        Crie quantos funis quiser (vendas, pedidos, pós-venda), personalize as colunas e arraste os clientes entre elas.
        Cada coluna pode colocar uma etiqueta automática e receber um disparo de campanha.
      </Empty>
      {open && <NewPipelineDrawer accountId={accountId} onClose={(p) => (setOpen(false), p && onCreated(p))} />}
    </>
  )
}

// ---------- Quadro ----------

type Drop = { stageId: number; index: number } | null

function Board({
  accountId,
  pipeline,
  onPipelinesChanged,
  onDeleted
}: {
  accountId: string
  pipeline: Pipeline
  onPipelinesChanged: () => void
  onDeleted: () => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [showFilter, setShowFilter] = useState(false)
  const tagDefs = useTagDefs(accountId)
  const board = useLoad<PipelineBoard>(
    () =>
      window.api.invoke('pipelines:board', {
        accountId,
        pipelineId: pipeline.id,
        search: q || undefined,
        tags: filterTags.length ? filterTags : undefined
      }),
    [accountId, pipeline.id, q, filterTags.join('\u0001')]
  )
  // Movimentos ainda não confirmados pelo banco (a tela muda na hora)
  const [moves, setMoves] = useState<Map<number, Pick<PipelineCard, 'stageId' | 'position' | 'movedAt'>>>(
    () => new Map()
  )
  const cards = useMemo(() => (board.data?.cards ?? []).map((c) => ({ ...c, ...moves.get(c.id) })), [board.data, moves])
  const [now, setNow] = useState(() => Date.now())
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<Drop>(null)
  const [openCard, setOpenCard] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)
  const { error, run, setError } = useAction()
  const draftCampaign = useApp((s) => s.draftCampaign)
  const stages = board.data?.pipeline.stages ?? pipeline.stages

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Busca com pequena espera para não recarregar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 220)
    return () => clearTimeout(t)
  }, [search])

  const byStage = useMemo(() => {
    const m = new Map<number, PipelineCard[]>()
    for (const s of stages) m.set(s.id, [])
    for (const c of cards) m.get(c.stageId)?.push(c)
    for (const l of m.values()) l.sort((a, b) => a.position - b.position || a.id - b.id)
    return m
  }, [cards, stages])

  async function reload(): Promise<void> {
    await board.reload()
    onPipelinesChanged()
  }

  async function move(cardId: number, stageId: number, index: number): Promise<void> {
    // Atualiza a tela na hora; o banco confirma em seguida
    const card = cards.find((c) => c.id === cardId)
    if (!card) return
    const dest = cards.filter((c) => c.stageId === stageId && c.id !== cardId).sort((a, b) => a.position - b.position)
    const before = dest[index - 1]?.position
    const after = dest[index]?.position
    const position =
      before == null && after == null
        ? 1
        : before == null
          ? after! - 1
          : after == null
            ? before + 1
            : (before + after) / 2
    setMoves((m) =>
      new Map(m).set(cardId, { stageId, position, movedAt: card.stageId === stageId ? card.movedAt : Date.now() })
    )
    await run('move', () => window.api.invoke('pipelines:move-card', { accountId, cardId, stageId, index }))
    await board.reload()
    setMoves((m) => {
      const n = new Map(m)
      n.delete(cardId)
      return n
    })
    onPipelinesChanged()
  }

  function dispatch(stage: PipelineStage): void {
    draftCampaign({
      name: `${pipeline.name} · ${stage.name}`,
      audience: {
        type: 'stages',
        stageIds: [stage.id],
        tags: filterTags.length ? filterTags : undefined,
        tagMode: 'all'
      }
    })
  }

  const totals = useMemo(() => {
    const won = stages.filter((s) => s.kind === 'won').map((s) => s.id)
    const open = stages.filter((s) => s.kind === 'open').map((s) => s.id)
    return {
      openValue: cards.filter((c) => open.includes(c.stageId)).reduce((n, c) => n + c.valueCents, 0),
      wonValue: cards.filter((c) => won.includes(c.stageId)).reduce((n, c) => n + c.valueCents, 0),
      total: cards.length
    }
  }, [cards, stages])

  const card = cards.find((c) => c.id === openCard) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sunken">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-5 py-2.5">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, telefone ou nota"
            aria-label="Buscar no funil"
            className="h-8 pl-8 text-[13.5px]"
          />
        </div>
        <div className="relative">
          <Button
            size="sm"
            variant={filterTags.length ? 'primary' : 'secondary'}
            onClick={() => setShowFilter((v) => !v)}
          >
            <Filter className="size-3.5" /> Etiquetas{filterTags.length ? ` (${filterTags.length})` : ''}
          </Button>
          {showFilter && (
            <div className="absolute top-full left-0 z-30 mt-1.5 w-[min(460px,80vw)] rounded-xl border border-line bg-panel p-3 shadow-pop">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-ink-2">Mostrar quem tem todas as etiquetas</span>
                <button
                  className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink"
                  aria-label="Fechar filtro"
                  onClick={() => setShowFilter(false)}
                >
                  <X className="size-4" />
                </button>
              </div>
              <TagToggles defs={tagDefs.defs} value={filterTags} onChange={setFilterTags} />
              {filterTags.length > 0 && (
                <button className="mt-2 text-[12.5px] text-accent hover:underline" onClick={() => setFilterTags([])}>
                  Limpar filtro
                </button>
              )}
            </div>
          )}
        </div>
        {filterTags.map((t) => (
          <TagChip
            key={t}
            name={t}
            color={tagDefs.colorOf(t)}
            onRemove={() => setFilterTags(filterTags.filter((x) => x !== t))}
          />
        ))}
        <div className="tabular ml-auto flex items-center gap-4 text-[12.5px] text-ink-2">
          <span>
            <b className="text-ink">{totals.total}</b> {totals.total === 1 ? 'cartão' : 'cartões'}
          </span>
          {totals.openValue > 0 && (
            <span>
              Em aberto <b className="text-ink">{money(totals.openValue)}</b>
            </span>
          )}
          {totals.wonValue > 0 && (
            <span>
              Ganho <b className="text-ok">{money(totals.wonValue)}</b>
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => setAdding(stages.find((s) => s.kind === 'open')?.id ?? stages[0]?.id ?? null)}>
          <UserPlus className="size-3.5" /> Adicionar contatos
        </Button>
        <Button size="sm" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" /> Editar funil
        </Button>
      </div>

      {error && (
        <div className="px-5 pt-3">
          <Notice tone="bad">
            {error}{' '}
            <button className="underline" onClick={() => setError(null)}>
              Ok
            </button>
          </Notice>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
        role="list"
        aria-label={`Colunas do funil ${pipeline.name}`}
      >
        <div className="flex h-full items-stretch gap-3 px-5 py-4">
          {stages.map((s) => (
            <Column
              key={s.id}
              stage={s}
              cards={byStage.get(s.id) ?? []}
              loading={board.loading && !board.data}
              dragId={dragId}
              drop={drop?.stageId === s.id ? drop.index : null}
              colorOf={tagDefs.colorOf}
              now={now}
              onDragStart={setDragId}
              onDragEnd={() => (setDragId(null), setDrop(null))}
              onDragOver={(index) => setDrop({ stageId: s.id, index })}
              onDrop={(index) => {
                const id = dragId
                setDragId(null)
                setDrop(null)
                if (id != null) void move(id, s.id, index)
              }}
              onOpen={setOpenCard}
              onAdd={() => setAdding(s.id)}
              onDispatch={() => dispatch(s)}
              onEdit={() => setEditing(true)}
            />
          ))}
          <button
            onClick={() => setEditing(true)}
            className="flex h-12 w-56 shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-[13.5px] text-ink-2 hover:bg-panel hover:text-ink"
          >
            <Plus className="size-4" /> Coluna
          </button>
        </div>
      </div>

      {card && (
        <CardWindow
          key={card.id}
          accountId={accountId}
          card={card}
          stages={stages}
          tagDefs={tagDefs}
          onMove={(stageId) => void move(card.id, stageId, (byStage.get(stageId) ?? []).length)}
          onChanged={() => void reload()}
          onClose={() => {
            setOpenCard(null)
            void board.reload() // atualiza não lidas e última mensagem do cartão
          }}
        />
      )}
      {editing && (
        <PipelineEditor
          accountId={accountId}
          pipeline={board.data?.pipeline ?? pipeline}
          tagDefs={tagDefs.defs}
          onClose={(changed) => {
            setEditing(false)
            if (changed === 'deleted') onDeleted()
            else if (changed) void reload()
          }}
        />
      )}
      {adding != null && (
        <AddPeopleDrawer
          accountId={accountId}
          stages={stages}
          initialStage={adding}
          tagDefs={tagDefs.defs}
          onClose={(changed) => {
            setAdding(null)
            if (changed) void reload()
          }}
        />
      )}
    </div>
  )
}

// ---------- Coluna ----------

function Column({
  stage,
  cards,
  loading,
  dragId,
  drop,
  colorOf,
  now,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onOpen,
  onAdd,
  onDispatch,
  onEdit
}: {
  stage: PipelineStage
  cards: PipelineCard[]
  loading: boolean
  dragId: number | null
  drop: number | null
  colorOf: (n: string) => string
  now: number
  onDragStart: (id: number) => void
  onDragEnd: () => void
  onDragOver: (index: number) => void
  onDrop: (index: number) => void
  onOpen: (id: number) => void
  onAdd: () => void
  onDispatch: () => void
  onEdit: () => void
}): React.JSX.Element {
  const body = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  const value = cards.reduce((n, c) => n + c.valueCents, 0)
  const hex = TAG_HEX[stage.color]

  function indexAt(y: number): number {
    const els = Array.from(body.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []).filter(
      (el) => Number(el.dataset.card) !== dragId
    )
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect()
      if (y < r.top + r.height / 2) return i
    }
    return els.length
  }

  const visible = cards.filter((c) => c.id !== dragId || drop == null)

  return (
    <section
      role="listitem"
      aria-label={`${stage.name}, ${cards.length} cartões`}
      className="flex w-[288px] shrink-0 flex-col rounded-xl border border-line bg-panel shadow-card"
    >
      <header className="relative shrink-0 border-b border-line px-3 pt-2.5 pb-2">
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] rounded-t-xl" style={{ background: hex }} />
        <div className="flex items-center gap-2">
          {stage.kind === 'won' ? (
            <Trophy className="size-3.5 shrink-0" style={{ color: hex }} />
          ) : stage.kind === 'lost' ? (
            <XCircle className="size-3.5 shrink-0" style={{ color: hex }} />
          ) : (
            <ColorDot color={stage.color} />
          )}
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={stage.description ?? stage.name}>
            {stage.name}
          </h2>
          <span className="tabular rounded-full bg-sunken px-2 text-[12px] leading-5 text-ink-2">{cards.length}</span>
          <div className="relative">
            <button
              aria-label={`Ações da coluna ${stage.name}`}
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
              onBlur={() => setTimeout(() => setMenu(false), 150)}
              className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {menu && (
              <div
                role="menu"
                className="absolute top-full right-0 z-30 mt-1 w-60 rounded-lg border border-line bg-panel py-1 shadow-pop"
              >
                <MenuItem icon={<Megaphone className="size-4" />} onClick={onDispatch} disabled={!cards.length}>
                  Disparar campanha para a coluna
                </MenuItem>
                <MenuItem icon={<UserPlus className="size-4" />} onClick={onAdd}>
                  Adicionar contatos aqui
                </MenuItem>
                <MenuItem icon={<Pencil className="size-4" />} onClick={onEdit}>
                  Editar colunas
                </MenuItem>
              </div>
            )}
          </div>
        </div>
        <div className="tabular mt-1 flex items-center gap-2 pl-[18px] text-[12px] text-ink-3">
          {value > 0 ? <span>{money(value)}</span> : <span>&nbsp;</span>}
          {stage.autoTag && (
            <span className="truncate" title="Etiqueta automática ao entrar">
              · etiqueta <b className="font-medium text-ink-2">{stage.autoTag}</b>
            </span>
          )}
        </div>
      </header>

      <div
        ref={body}
        className={cn('min-h-0 flex-1 space-y-2 overflow-y-auto p-2', drop != null && 'bg-accent-soft/40')}
        onDragOver={(e) => {
          if (dragId == null) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const i = indexAt(e.clientY)
          if (i !== drop) onDragOver(i)
        }}
        onDrop={(e) => {
          e.preventDefault()
          onDrop(indexAt(e.clientY))
        }}
      >
        {loading && [0, 1, 2].map((i) => <div key={i} className="h-[74px] animate-pulse rounded-lg bg-sunken" />)}
        {visible.map((c, i) => (
          <div key={c.id}>
            {drop === i && <DropLine />}
            <Card
              card={c}
              stage={stage}
              dragging={c.id === dragId}
              colorOf={colorOf}
              now={now}
              onDragStart={() => onDragStart(c.id)}
              onDragEnd={onDragEnd}
              onOpen={() => onOpen(c.id)}
            />
          </div>
        ))}
        {drop != null && drop >= visible.length && <DropLine />}
        {!loading && !cards.length && drop == null && (
          <button
            onClick={onAdd}
            className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line text-[12.5px] text-ink-3 hover:border-line-strong hover:text-ink-2"
          >
            <Plus className="size-4" />
            Arraste um cartão ou adicione contatos
          </button>
        )}
      </div>
    </section>
  )
}

function DropLine(): React.JSX.Element {
  return <div aria-hidden className="my-1 h-1 rounded-full bg-accent" />
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-ink hover:bg-sunken disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <span className="text-ink-2">{icon}</span>
      {children}
    </button>
  )
}

// ---------- Cartão ----------

function Card({
  card,
  stage,
  dragging,
  colorOf,
  now,
  onDragStart,
  onDragEnd,
  onOpen
}: {
  card: PipelineCard
  stage: PipelineStage
  dragging: boolean
  colorOf: (n: string) => string
  now: number
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}): React.JSX.Element {
  const name = card.name || formatPhone(card.phone)
  const days = Math.max(0, Math.floor((now - card.movedAt) / DAY))
  const late = stage.kind === 'open' && stage.slaDays != null && days > stage.slaDays
  const jid = card.jid ?? `${card.phone}@s.whatsapp.net`
  return (
    <button
      data-card={card.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(card.id))
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      aria-label={`${name}, ${days} dia(s) nesta coluna. Abrir cartão`}
      className={cn(
        'block w-full cursor-grab rounded-lg border border-line bg-panel p-2.5 text-left shadow-card transition-[box-shadow,opacity,border-color] hover:border-line-strong hover:shadow-pop active:cursor-grabbing',
        dragging && 'opacity-40',
        late && 'border-warn/60'
      )}
    >
      <div className="flex items-start gap-2.5">
        <Avatar id={jid} name={name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold">{name}</span>
            {card.unread > 0 && (
              <span className="tabular ml-auto rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-on-accent">
                {card.unread}
              </span>
            )}
          </div>
          {card.lastPreview ? (
            <p className="mt-0.5 truncate text-[12.5px] text-ink-2">
              <MessageCircle className="mr-1 inline size-3 -translate-y-px text-ink-3" />
              {card.lastPreview}
            </p>
          ) : card.note ? (
            <p className="mt-0.5 truncate text-[12.5px] text-ink-2">{card.note}</p>
          ) : (
            <p className="tabular mt-0.5 truncate text-[12px] text-ink-3">{formatPhone(card.phone)}</p>
          )}
        </div>
      </div>
      {card.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.slice(0, 3).map((t) => (
            <TagChip key={t} name={t} color={colorOf(t)} size="sm" />
          ))}
          {card.tags.length > 3 && <span className="text-[11.5px] leading-5 text-ink-3">+{card.tags.length - 3}</span>}
        </div>
      )}
      <div className="tabular mt-2 flex items-center gap-2 text-[11.5px] text-ink-3">
        {card.valueCents > 0 && <span className="font-medium text-ink">{money(card.valueCents)}</span>}
        <span
          className={cn('ml-auto flex items-center gap-1', late && 'font-medium text-warn')}
          title="Tempo nesta coluna"
        >
          {late && <AlarmClock className="size-3" />}
          {days === 0 ? 'hoje' : `${days} d`}
        </span>
        {card.lastMessageAt && <span title="Última mensagem">· {timeAgo(card.lastMessageAt)}</span>}
        {card.optOut && <span className="text-bad">· não recebe</span>}
      </div>
    </button>
  )
}
