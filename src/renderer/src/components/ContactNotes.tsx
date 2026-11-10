import { useState } from 'react'
import { Pencil, Pin, PinOff, Plus, Sparkles, Trash2 } from 'lucide-react'
import { NOTE_KINDS, NOTE_KIND_LABEL, type ContactNote, type NoteKind } from '@shared/types'
import { birthdayInfo, untilLabel } from '@shared/dates'
import { isSensitive } from '@shared/sensitive'
import { cn } from '../lib/cn'
import { useApp } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import { Badge, Button, Field, Input, Notice, Select, Textarea } from './ui'

/** Contato (pelo id) ou conversa (o contato é achado ou criado pelo número). */
export type NotesTarget = { personId: number } | { chatJid: string }

type Draft = { id?: number; kind: NoteKind; title: string; body: string }
const EMPTY: Draft = { kind: 'geral', title: '', body: '' }

const dateLabel = (d: string): string => birthdayInfo(d)?.label ?? d

/**
 * Bloco de notas do cliente: várias notas, fixar, editar e apagar, o botão "Mapear perfil" (IA)
 * e a sugestão de aniversário (só salva depois do clique). Usado na ficha, na faixa da conversa e na janela do funil.
 */
export function ContactNotes({
  accountId,
  target,
  onChanged,
  onBirthdaySaved
}: {
  accountId: string
  target: NotesTarget
  onChanged?: () => void
  /** Chamado depois que o aniversário sugerido foi salvo (a ficha atualiza o campo). */
  onBirthdaySaved?: (date: string) => void
}): React.JSX.Element {
  const perfilIa = useApp((s) => !!s.accounts.find((a) => a.id === accountId)?.modules.perfilIa)
  const key = 'personId' in target ? `p${target.personId}` : target.chatJid
  const list = useLoad(() => window.api.invoke('notes:list', { accountId, ...target }), [accountId, key])
  const dates = useLoad(() => window.api.invoke('dates:info', { accountId, ...target }), [accountId, key])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const { busy, error, setError, run } = useAction()

  const notes = list.data?.notes ?? []
  const suggestion = dates.data?.suggestion ?? null
  const personId = list.data?.personId ?? dates.data?.personId ?? null

  async function reload(): Promise<void> {
    await Promise.all([list.reload(), dates.reload()])
    onChanged?.()
  }

  async function save(): Promise<void> {
    if (!draft) return
    const r = await run('save', () =>
      window.api.invoke('notes:save', {
        accountId,
        ...target,
        note: { id: draft.id, kind: draft.kind, title: draft.title, body: draft.body }
      })
    )
    if (r) {
      setDraft(null)
      await reload()
    }
  }

  async function pin(n: ContactNote): Promise<void> {
    const ok = await run('pin' + n.id, () => window.api.invoke('notes:pin', { accountId, id: n.id, pinned: !n.pinned }))
    if (ok !== undefined) await reload()
  }

  async function remove(n: ContactNote): Promise<void> {
    if (!confirm(`Apagar a nota "${n.title}"?`)) return
    const ok = await run('del' + n.id, () => window.api.invoke('notes:delete', { accountId, id: n.id }))
    if (ok !== undefined) await reload()
  }

  async function map(): Promise<void> {
    setInfo(null)
    const r = await run('map', () => window.api.invoke('notes:map', { accountId, ...target }))
    if (r) {
      setInfo(
        r.added.length
          ? `A IA adicionou ${r.added.length} ${r.added.length === 1 ? 'nota' : 'notas'}. Confira e edite se precisar.`
          : 'A IA não achou nada novo para anotar nesta conversa.'
      )
      await reload()
    }
  }

  async function acceptBirthday(): Promise<void> {
    if (!suggestion || personId == null) return
    const r = await run('bday', () =>
      window.api.invoke('dates:birthday-set', { accountId, personId, birthday: suggestion.date })
    )
    if (r) {
      onBirthdaySaved?.(r)
      await reload()
    }
  }

  async function dismissBirthday(): Promise<void> {
    if (personId == null) return
    const r = await run('bday-no', () => window.api.invoke('dates:suggestion-dismiss', { accountId, personId }))
    if (r !== undefined) await reload()
  }

  return (
    <section aria-label="Notas do cliente" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13.5px] font-semibold">Notas do cliente</h3>
        <div className="ml-auto flex items-center gap-1.5">
          {perfilIa && (
            <Button
              size="sm"
              loading={busy === 'map'}
              onClick={() => void map()}
              title="A IA lê a conversa e anota o que ainda não está nas notas (sem dado de saúde)"
            >
              <Sparkles className="size-3.5" /> Mapear perfil
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setError(null)
              setDraft({ ...EMPTY })
            }}
          >
            <Plus className="size-3.5" /> Nova nota
          </Button>
        </div>
      </div>

      {suggestion && personId != null && (
        <Notice tone="info">
          <div className="font-medium">Salvar {dateLabel(suggestion.date)} como aniversário?</div>
          <div className="mt-0.5 text-[12.5px] text-ink-2">“{suggestion.quote}”</div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" loading={busy === 'bday'} onClick={() => void acceptBirthday()}>
              Salvar aniversário
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'bday-no'} onClick={() => void dismissBirthday()}>
              Agora não
            </Button>
          </div>
        </Notice>
      )}

      {info && <Notice tone="ok">{info}</Notice>}
      {(error || list.error) && <Notice tone="bad">{error ?? list.error}</Notice>}

      {draft && (
        <form
          className="flex flex-col gap-2.5 rounded-lg border border-line bg-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="flex gap-2">
            <Field label="Tipo" htmlFor="note-kind">
              <Select
                id="note-kind"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as NoteKind })}
              >
                {NOTE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {NOTE_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="min-w-0 flex-1">
              <Field label="Título (opcional)" htmlFor="note-title">
                <Input
                  id="note-title"
                  value={draft.title}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <Field label="Nota" htmlFor="note-body" hint="Não anote grau de óculos nem dados de saúde.">
            <Textarea
              id="note-body"
              rows={3}
              autoFocus
              value={draft.body}
              maxLength={2000}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="Ex.: prefere armação leve, comprou para a filha"
            />
          </Field>
          {isSensitive(`${draft.title} ${draft.body}`) && (
            <Notice tone="warn">Evite anotar dado de saúde: ele pode ir para a IA na nuvem.</Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={busy === 'save'} disabled={!draft.body.trim()}>
              Salvar nota
            </Button>
          </div>
        </form>
      )}

      {!list.loading && notes.length === 0 && !draft && (
        <p className="text-[13px] text-ink-3">
          Ainda não há notas. Anote o que ajuda no próximo atendimento: gostos, objeções, família.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li
            key={n.id}
            className={cn('rounded-lg border bg-panel p-3', n.pinned ? 'border-accent/50' : 'border-line')}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge>{NOTE_KIND_LABEL[n.kind]}</Badge>
              {n.author === 'ia' && <Badge tone="accent">IA</Badge>}
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{n.title}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={n.pinned ? 'Desafixar nota' : 'Fixar nota'}
                title={n.pinned ? 'Desafixar' : 'Fixar no topo'}
                loading={busy === 'pin' + n.id}
                onClick={() => void pin(n)}
              >
                {n.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Editar nota"
                title="Editar"
                onClick={() => {
                  setError(null)
                  setDraft({ id: n.id, kind: n.kind, title: n.title, body: n.body })
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Apagar nota"
                title="Apagar"
                loading={busy === 'del' + n.id}
                onClick={() => void remove(n)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1 text-[13.5px] whitespace-pre-wrap text-ink-2">{n.body}</p>
            <div className="mt-1 text-[12px] text-ink-3">
              {n.author === 'ia' ? 'Escrita pela IA' : 'Escrita por você'} em{' '}
              {new Date(n.updatedAt).toLocaleDateString('pt-BR')}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Idade e dias que faltam para o aniversário (abaixo do campo de aniversário). */
export function BirthdayLine({ date }: { date: string | null }): React.JSX.Element | null {
  const i = birthdayInfo(date)
  if (!i) return null
  return (
    <p className="mt-1 text-[12.5px] text-ink-3">
      {i.age != null ? `${i.age} anos · ` : ''}
      {i.daysUntil === 0
        ? 'faz aniversário hoje'
        : i.daysUntil === 1
          ? 'aniversário amanhã'
          : `faltam ${i.daysUntil} dias para o aniversário`}
    </p>
  )
}

/** Quando a data personalizada (retirada, revisão...) volta: "faltam 21 dias". Vazio se o valor não é uma data. */
export function DateHint({ value }: { value: string }): React.JSX.Element | null {
  // só datas escritas com barra, ponto ou traço (um número solto como 2024 não é data)
  if (!/^\s*\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\s*$/.test(value)) return null
  const i = birthdayInfo(value)
  if (!i) return null
  return <span className="text-[12px] text-ink-3">{untilLabel(i.daysUntil)}</span>
}

/** Lembretes de datas que este contato já recebeu (aniversário, revisão anual...), um por envio. */
export function DateHistory({
  accountId,
  personId
}: {
  accountId: string
  personId: number
}): React.JSX.Element | null {
  const info = useLoad(() => window.api.invoke('dates:info', { accountId, personId }), [accountId, personId])
  const items = info.data?.history ?? []
  if (!items.length) return null
  return (
    <section aria-label="Lembretes enviados" className="flex flex-col gap-1.5">
      <h3 className="text-[13.5px] font-semibold">Lembretes enviados</h3>
      <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
        {items.map((h, i) => (
          <li key={`${h.at}-${i}`}>{h.label}</li>
        ))}
      </ul>
    </section>
  )
}
