import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { TagColor, TagDef } from '@shared/types'
import { useAction } from '../lib/useAsync'
import { Button, Drawer, Field, Input, Notice } from './ui'
import { ColorPicker, TagChip } from './tags'
import { useTagDefs } from '../lib/tagColors'

/** Gerenciar etiquetas: criar, cor, descrição, renomear (ou juntar com outra) e apagar. */
export function TagManager({
  accountId,
  onClose
}: {
  accountId: string
  onClose: (changed: boolean) => void
}): React.JSX.Element {
  const tags = useTagDefs(accountId)
  const [editing, setEditing] = useState<TagDef | 'new' | null>(null)
  const [changed, setChanged] = useState(false)

  return (
    <Drawer
      title="Etiquetas"
      onClose={() => onClose(changed)}
      footer={
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> Nova etiqueta
        </Button>
      }
    >
      <p className="mb-4 text-[13.5px] text-ink-2">
        Etiquetas organizam a base e escolhem quem recebe cada campanha. Renomear para o nome de outra etiqueta junta as
        duas.
      </p>
      {editing === 'new' && (
        <TagForm
          accountId={accountId}
          onDone={(ok) => {
            setEditing(null)
            if (ok) {
              setChanged(true)
              void tags.reload()
            }
          }}
        />
      )}
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {tags.defs.map((t) =>
          editing !== 'new' && editing?.name === t.name ? (
            <li key={t.name} className="p-3">
              <TagForm
                accountId={accountId}
                tag={t}
                onDone={(ok) => {
                  setEditing(null)
                  if (ok) {
                    setChanged(true)
                    void tags.reload()
                  }
                }}
              />
            </li>
          ) : (
            <li key={t.name} className="flex items-center gap-3 px-3 py-2.5">
              <TagChip name={t.name} color={t.color} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{t.description}</span>
              <span className="tabular text-[12.5px] text-ink-2">
                {t.count} {t.count === 1 ? 'contato' : 'contatos'}
              </span>
              <Button size="sm" variant="ghost" aria-label={`Editar ${t.name}`} onClick={() => setEditing(t)}>
                <Pencil className="size-4" />
              </Button>
            </li>
          )
        )}
        {tags.defs.length === 0 && (
          <li className="px-3 py-8 text-center text-[13.5px] text-ink-3">Nenhuma etiqueta ainda.</li>
        )}
      </ul>
    </Drawer>
  )
}

function TagForm({
  accountId,
  tag,
  onDone
}: {
  accountId: string
  tag?: TagDef
  onDone: (changed: boolean) => void
}): React.JSX.Element {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState<TagColor>(tag?.color ?? 'blue')
  const [description, setDescription] = useState(tag?.description ?? '')
  const { busy, error, run } = useAction()

  async function save(): Promise<void> {
    const ok = await run('s', () =>
      window.api.invoke('tags:save', {
        accountId,
        name: name.trim(),
        color,
        description: description.trim() || null,
        previousName: tag?.name ?? null
      })
    )
    if (ok) onDone(true)
  }

  async function remove(): Promise<void> {
    if (!tag) return
    if (
      !confirm(
        `Apagar a etiqueta "${tag.name}"? Ela sai de ${tag.count} contato(s), das colunas de funil e das campanhas não enviadas. Os contatos continuam.`
      )
    )
      return
    const ok = await run('d', () => window.api.invoke('tags:delete', { accountId, name: tag.name }))
    if (ok !== undefined) onDone(true)
  }

  return (
    <form
      className="mb-3 flex flex-col gap-3 rounded-xl border border-line bg-sunken/40 p-3"
      onSubmit={(e) => (e.preventDefault(), void save())}
    >
      <div className="flex items-end gap-3">
        <Field label="Nome" htmlFor="tag-name">
          <Input id="tag-name" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {name.trim() && <TagChip name={name.trim()} color={color} className="mb-1.5" />}
      </div>
      <Field label="Cor">
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <Field label="Descrição (opcional)" htmlFor="tag-desc">
        <Input
          id="tag-desc"
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Quem recebe esta etiqueta?"
        />
      </Field>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex items-center gap-2">
        {tag && (
          <Button type="button" variant="danger" size="sm" loading={busy === 'd'} onClick={() => void remove()}>
            <Trash2 className="size-3.5" /> Apagar
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => onDone(false)}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={busy === 's'} disabled={!name.trim()}>
          Salvar
        </Button>
      </div>
    </form>
  )
}
