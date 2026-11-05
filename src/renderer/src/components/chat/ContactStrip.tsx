import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, SquareKanban, Tag } from 'lucide-react'
import type { CardPlacement, Pipeline } from '@shared/types'
import { useApp } from '../../lib/store'
import { useAction, useLoad } from '../../lib/useAsync'
import { Button, Notice } from '../ui'
import { TagChip, TagPicker } from '../tags'
import { TAG_HEX, tagStyle, useTagDefs } from '../../lib/tagColors'
import { StagePicker } from '../StagePicker'

type Open = 'tags' | 'add' | number | null

/** Faixa abaixo do cabeçalho da conversa: etiquetas do contato e em que coluna de cada funil ele está. */
export function ContactStrip({
  accountId,
  jid,
  funil
}: {
  accountId: string
  jid: string
  funil: boolean
}): React.JSX.Element | null {
  const profile = useLoad(
    () => window.api.invoke('pipelines:chat-profile', { accountId, chatJid: jid }),
    [accountId, jid]
  )
  const pipelines = useLoad(
    () => (funil ? window.api.invoke('pipelines:list', { accountId }) : Promise.resolve([] as Pipeline[])),
    [accountId, funil]
  )
  const tagDefs = useTagDefs(accountId)
  const [open, setOpen] = useState<Open>(null)
  const [stage, setStage] = useState<number | null>(null)
  const { busy, error, run } = useAction()
  const box = useRef<HTMLDivElement>(null)
  const openPipeline = useApp((s) => s.openPipeline)

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const tags = profile.data?.tags ?? []
  const places = profile.data?.placements ?? []

  async function saveTags(next: string[]): Promise<void> {
    const r = await run('tags', () => window.api.invoke('pipelines:chat-tags', { accountId, chatJid: jid, tags: next }))
    if (r) {
      await profile.reload()
      void tagDefs.reload()
    }
  }

  async function moveTo(p: CardPlacement, stageId: number): Promise<void> {
    const ok = await run('move', () =>
      window.api.invoke('pipelines:move-card', { accountId, cardId: p.cardId, stageId, index: 100_000 })
    )
    if (ok !== undefined) {
      await profile.reload()
      setOpen(null)
    }
  }

  async function add(): Promise<void> {
    if (!stage) return
    const r = await run('add', () =>
      window.api.invoke('pipelines:add-chat', { accountId, stageId: stage, chatJid: jid })
    )
    if (r) {
      await profile.reload()
      setOpen(null)
    }
  }

  return (
    <div
      ref={box}
      className="relative flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-4 py-1.5"
    >
      <Tag className="size-3.5 text-ink-3" aria-hidden />
      {tags.map((t) => (
        <TagChip key={t} name={t} color={tagDefs.colorOf(t)} size="sm" />
      ))}
      <button
        aria-expanded={open === 'tags'}
        onClick={() => setOpen(open === 'tags' ? null : 'tags')}
        className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[12px] text-ink-3 hover:bg-sunken hover:text-ink"
      >
        {tags.length ? (
          'editar'
        ) : (
          <>
            <Plus className="size-3" /> etiqueta
          </>
        )}
      </button>

      {funil && (
        <>
          <span aria-hidden className="mx-1.5 h-4 w-px bg-line" />
          <SquareKanban className="size-3.5 text-ink-3" aria-hidden />
          {places.map((p) => (
            <button
              key={p.cardId}
              aria-expanded={open === p.cardId}
              onClick={() => setOpen(open === p.cardId ? null : p.cardId)}
              style={tagStyle(p.stageColor)}
              className="inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11.5px] font-medium"
              title="Mudar de coluna"
            >
              <span className="opacity-70">{p.pipelineName} ›</span> {p.stageName}
              <ChevronDown className="size-3 opacity-70" />
            </button>
          ))}
          {pipelines.data && pipelines.data.length > 0 && (
            <button
              aria-expanded={open === 'add'}
              onClick={() => setOpen(open === 'add' ? null : 'add')}
              className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[12px] text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <Plus className="size-3" /> funil
            </button>
          )}
        </>
      )}

      {open != null && (
        <div className="absolute top-full left-3 z-30 mt-1 w-[min(440px,90%)] rounded-xl border border-line bg-panel p-3 shadow-pop">
          {open === 'tags' && (
            <>
              <div className="mb-2 text-[12.5px] font-medium text-ink-2">Etiquetas do contato</div>
              <TagPicker defs={tagDefs.defs} value={tags} onChange={(t) => void saveTags(t)} autoFocus />
              <p className="mt-2 text-[12px] text-ink-3">
                Se a conversa ainda não é um contato da base, ele é criado com o nome e o número dela.
              </p>
            </>
          )}
          {open === 'add' && (
            <>
              <div className="mb-3 text-[12.5px] font-medium text-ink-2">Colocar esta conversa num funil</div>
              <StagePicker accountId={accountId} value={stage} onChange={(id) => setStage(id)} idPrefix="cs" />
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === 'add'}
                  disabled={!stage}
                  onClick={() => void add()}
                >
                  Adicionar
                </Button>
              </div>
            </>
          )}
          {typeof open === 'number' &&
            (() => {
              const p = places.find((x) => x.cardId === open)
              const pipe = pipelines.data?.find((x) => x.id === p?.pipelineId)
              if (!p || !pipe) return null
              return (
                <>
                  <div className="mb-2 text-[12.5px] font-medium text-ink-2">{pipe.name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {pipe.stages.map((s) => (
                      <button
                        key={s.id}
                        aria-pressed={s.id === p.stageId}
                        disabled={busy === 'move'}
                        onClick={() => s.id !== p.stageId && void moveTo(p, s.id)}
                        style={s.id === p.stageId ? tagStyle(s.color) : undefined}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-[12.5px] hover:bg-sunken"
                      >
                        <span className="size-2 rounded-full" style={{ background: TAG_HEX[s.color] }} />
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => openPipeline(pipe.id)}>
                      Abrir o funil
                    </Button>
                  </div>
                </>
              )
            })()}
          {error && (
            <div className="mt-3">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
