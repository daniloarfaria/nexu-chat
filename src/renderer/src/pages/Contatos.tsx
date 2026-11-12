import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  SquareKanban,
  Tag,
  Tags,
  Trash2,
  Upload,
  Users
} from 'lucide-react'
import type { ImportMapping, ImportPreview, ImportResult, Person, TagDef } from '@shared/types'
import { useActiveAccount, useApp } from '../lib/store'
import { fileBytes, useAction, useLoad } from '../lib/useAsync'
import { formatPhone } from '../lib/format'
import { Badge, Button, Checkbox, Drawer, Empty, Field, Input, Notice, PageHeader, Select } from '../components/ui'
import { cn } from '../lib/cn'
import { ColorDot, TagChip, TagPicker } from '../components/tags'
import { useTagDefs } from '../lib/tagColors'
import { TagManager } from '../components/TagManager'
import { StagePicker } from '../components/StagePicker'
import { BirthdayLine, ContactNotes, DateHint, DateHistory } from '../components/ContactNotes'

const PAGE = 100

function birthdayLabel(b: string | null): string {
  if (!b) return ''
  const m = /(\d{4}|-)-?(\d{2})-(\d{2})$/.exec(b)
  return m ? `${m[3]}/${m[2]}${m[1] !== '-' ? '/' + m[1] : ''}` : b
}

function PersonForm({
  accountId,
  person,
  tagDefs,
  fieldNames,
  funil,
  onDone
}: {
  accountId: string
  person: Person | null
  tagDefs: TagDef[]
  fieldNames: string[]
  funil: boolean
  onDone: () => void
}): React.JSX.Element {
  const [name, setName] = useState(person?.name ?? '')
  const [phone, setPhone] = useState(person ? formatPhone(person.phone) : '')
  const [birthday, setBirthday] = useState(birthdayLabel(person?.birthday ?? null))
  const [tags, setTags] = useState<string[]>(person?.tags ?? [])
  const places = useLoad(
    () =>
      person && funil ? window.api.invoke('pipelines:person', { accountId, personId: person.id }) : Promise.resolve([]),
    [accountId, person?.id, funil]
  )
  const openPipeline = useApp((s) => s.openPipeline)
  const [fields, setFields] = useState<Array<[string, string]>>(() =>
    [...new Set([...fieldNames, ...Object.keys(person?.fields ?? {})])].map((name) => [
      name,
      person?.fields[name] ?? ''
    ])
  )
  const { busy, error, run } = useAction()

  async function save(): Promise<void> {
    const ok = await run('save', () =>
      window.api.invoke('people:save', {
        accountId,
        id: person?.id,
        name,
        phone,
        birthday: birthday || null,
        tags,
        fields: Object.fromEntries(fields.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]))
      })
    )
    if (ok) onDone()
  }

  return (
    <Drawer
      title={person ? 'Editar contato' : 'Novo contato'}
      onClose={onDone}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="bad">{error}</Notice>}
        <Field label="Nome" htmlFor="p-name">
          <Input id="p-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefone (com DDD)" htmlFor="p-phone">
          <Input
            id="p-phone"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 98765-4321"
          />
        </Field>
        <Field label="Aniversário" htmlFor="p-bday" hint="Dia/mês ou dia/mês/ano">
          <Input id="p-bday" value={birthday} onChange={(e) => setBirthday(e.target.value)} placeholder="25/12" />
          <BirthdayLine date={birthday} />
        </Field>
        <Field label="Etiquetas" hint="Digite para buscar; Enter cria uma etiqueta nova.">
          <TagPicker defs={tagDefs} value={tags} onChange={setTags} />
        </Field>
        {(places.data ?? []).length > 0 && (
          <Field label="Nos funis">
            <ul className="flex flex-col gap-1.5">
              {(places.data ?? []).map((p) => (
                <li key={p.cardId}>
                  <button
                    className="flex items-center gap-2 text-[13.5px] hover:text-accent"
                    onClick={() => openPipeline(p.pipelineId)}
                  >
                    <ColorDot color={p.stageColor} />
                    <span className="font-medium">{p.pipelineName}</span>
                    <span className="text-ink-3">→ {p.stageName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Field>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Campos do negócio</legend>
          {fields.map(([k, v], i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                <Input
                  aria-label="Nome do campo"
                  placeholder="Ex.: data_compra"
                  maxLength={40}
                  readOnly={fieldNames.includes(k)}
                  value={k}
                  onChange={(e) => setFields(fields.map((f, j) => (j === i ? [e.target.value, f[1]] : f)))}
                />
                <Input
                  aria-label={`Valor de ${k || 'novo campo'}`}
                  maxLength={500}
                  value={v}
                  onChange={(e) => setFields(fields.map((f, j) => (j === i ? [f[0], e.target.value] : f)))}
                />
                <Button
                  variant="ghost"
                  aria-label={fieldNames.includes(k) ? `Limpar ${k}` : `Remover ${k || 'campo'}`}
                  title={fieldNames.includes(k) ? 'Limpar valor' : 'Remover campo deste contato'}
                  onClick={() =>
                    setFields(
                      fieldNames.includes(k)
                        ? fields.map((f, j) => (j === i ? [f[0], ''] : f))
                        : fields.filter((_, j) => j !== i)
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <DateHint value={v} />
            </div>
          ))}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setFields([...fields, ['', '']])}>
            <Plus className="size-4" /> Adicionar campo
          </Button>
          <p className="text-[12.5px] text-ink-3">
            Campos viram variáveis nas mensagens: {'{data_compra}'}, {'{cidade}'}…
          </p>
        </fieldset>
        {person && (
          <>
            <DateHistory accountId={accountId} personId={person.id} />
            <ContactNotes
              accountId={accountId}
              target={{ personId: person.id }}
              onBirthdaySaved={(d) => setBirthday(birthdayLabel(d))}
            />
          </>
        )}
      </div>
    </Drawer>
  )
}

function BusinessFields({
  accountId,
  names,
  onDone
}: {
  accountId: string
  names: string[]
  onDone: (changed: boolean) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(names)
  const [name, setName] = useState('')
  const { busy, error, run } = useAction()
  return (
    <Drawer
      title="Campos do negócio"
      onClose={() => onDone(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy === 'save'}
            onClick={async () => {
              const saved = await run('save', () =>
                window.api.invoke('people:set-field-definitions', { accountId, names: draft })
              )
              if (saved) onDone(true)
            }}
          >
            Salvar campos
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13.5px] text-ink-2">
          Crie informações para preencher em todos os contatos desta conta, como data_compra ou modelo. Use o nome entre
          chaves nas campanhas: {'{modelo}'}.
        </p>
        <p className="text-[12.5px] text-ink-3">
          Remover um campo desta lista mantém os valores já salvos nos contatos.
        </p>
        {error && <Notice tone="bad">{error}</Notice>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && draft.length < 50) {
              setDraft([...draft, name.trim()])
              setName('')
            }
          }}
        >
          <Field
            label="Nome do campo"
            htmlFor="business-field-name"
            hint="Até 50 campos. Use letras, números, espaços ou sublinhado."
          >
            <Input
              id="business-field-name"
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: data_compra"
            />
          </Field>
          <Button type="submit" disabled={!name.trim() || draft.length >= 50}>
            <Plus className="size-4" /> Adicionar
          </Button>
        </form>
        <ul className="divide-y divide-line">
          {draft.map((field, i) => (
            <li key={`${field}-${i}`} className="flex items-center justify-between gap-3 py-2">
              <span className="break-words text-[13.5px]">{field}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remover ${field}`}
                onClick={() => setDraft(draft.filter((_, j) => i !== j))}
              >
                <Trash2 className="size-4" /> Remover
              </Button>
            </li>
          ))}
        </ul>
        {!draft.length && <p className="text-[13px] text-ink-3">Nenhum campo cadastrado. Adicione o primeiro acima.</p>}
      </div>
    </Drawer>
  )
}

function ImportWizard({
  accountId,
  onDone
}: {
  accountId: string
  onDone: (changed: boolean) => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ImportMapping | null>(null)
  const [tags, setTags] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const { busy, error, run } = useAction()

  async function load(f: File, sheet?: string): Promise<void> {
    setFile(f)
    const p = await run('read', async () =>
      window.api.invoke('people:import-preview', { data: (await fileBytes(f)).data, sheet })
    )
    if (p) {
      setPreview(p)
      setMapping(p.suggested)
    }
  }

  const colSelect = (value: number | null, onChange: (v: number | null) => void, label: string): React.JSX.Element => (
    <Select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="w-full"
    >
      <option value="">— não importar —</option>
      {preview?.headers.map((h, i) => (
        <option key={i} value={i}>
          {h}
        </option>
      ))}
    </Select>
  )

  return (
    <Drawer
      wide
      title="Importar planilha"
      onClose={() => onDone(!!result)}
      footer={
        result ? (
          <Button variant="primary" onClick={() => onDone(true)}>
            Concluir
          </Button>
        ) : (
          preview &&
          mapping && (
            <Button
              variant="primary"
              loading={busy === 'import'}
              disabled={mapping.phone == null}
              onClick={async () => {
                const r = await run('import', () =>
                  window.api.invoke('people:import', {
                    accountId,
                    token: preview.token,
                    mapping,
                    tags: tags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  })
                )
                if (r) setResult(r)
              }}
            >
              Importar {preview.total.toLocaleString('pt-BR')} linhas
            </Button>
          )
        )
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Notice tone="bad">{error}</Notice>}
        {result ? (
          <Notice tone="ok">
            <b>{result.imported}</b> contatos novos, <b>{result.updated}</b> atualizados
            {result.duplicates > 0 && <>, {result.duplicates} repetidos ignorados</>}
            {result.invalid > 0 && (
              <>
                , {result.invalid} com telefone inválido (ex.: {result.invalidSamples.join(', ')})
              </>
            )}
            .
          </Notice>
        ) : !preview ? (
          <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center hover:border-accent">
            <FileSpreadsheet className="size-9 text-ink-3" strokeWidth={1.5} />
            <span className="mt-3 text-[15px] font-semibold">
              {busy === 'read' ? 'Lendo planilha…' : 'Escolha a planilha de clientes'}
            </span>
            <span className="mt-1 text-[13.5px] text-ink-2">
              Excel (.xlsx, .xls), CSV ou planilha do LibreOffice (.ods)
            </span>
            <input
              type="file"
              hidden
              accept=".xlsx,.xls,.csv,.ods,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void load(f)
              }}
            />
          </label>
        ) : (
          mapping && (
            <>
              {preview.sheets.length > 1 && (
                <Field label="Aba da planilha" htmlFor="imp-sheet">
                  <Select
                    id="imp-sheet"
                    value={preview.sheet}
                    onChange={(e) => file && void load(file, e.target.value)}
                  >
                    {preview.sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="grid grid-cols-3 gap-3">
                <Field label="Coluna do telefone *">
                  {colSelect(mapping.phone, (v) => setMapping({ ...mapping, phone: v }), 'Coluna do telefone')}
                </Field>
                <Field label="Coluna do nome">
                  {colSelect(mapping.name, (v) => setMapping({ ...mapping, name: v }), 'Coluna do nome')}
                </Field>
                <Field label="Coluna do aniversário">
                  {colSelect(mapping.birthday, (v) => setMapping({ ...mapping, birthday: v }), 'Coluna do aniversário')}
                </Field>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Outras colunas para guardar</legend>
                <div className="flex flex-wrap gap-1.5">
                  {preview.headers.map((h, i) => {
                    if (i === mapping.phone || i === mapping.name || i === mapping.birthday) return null
                    const on = mapping.extra.some((e) => e.column === i)
                    return (
                      <button
                        key={i}
                        aria-pressed={on}
                        onClick={() =>
                          setMapping({
                            ...mapping,
                            extra: on
                              ? mapping.extra.filter((e) => e.column !== i)
                              : [
                                  ...mapping.extra,
                                  {
                                    column: i,
                                    field:
                                      h
                                        .toLowerCase()
                                        .normalize('NFD')
                                        .replace(/\p{M}/gu, '')
                                        .replace(/[^\w]+/g, '_')
                                        .replace(/^_|_$/g, '') || `campo_${i + 1}`
                                  }
                                ]
                          })
                        }
                        className={cn(
                          'h-8 rounded-full border px-3 text-[13px]',
                          on
                            ? 'border-accent bg-accent-soft text-accent-ink'
                            : 'border-line-strong text-ink-2 hover:text-ink'
                        )}
                      >
                        {h}
                      </button>
                    )
                  })}
                </div>
                {mapping.extra.length > 0 && (
                  <p className="mt-2 text-[12.5px] text-ink-3">
                    Viram variáveis: {mapping.extra.map((e) => `{${e.field}}`).join(', ')}
                  </p>
                )}
              </fieldset>
              <Field label="Etiquetas para estes contatos" htmlFor="imp-tags" hint="Ex.: Clientes 2026, Black Friday">
                <Input id="imp-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-sunken text-left text-ink-2">
                    <tr>
                      {preview.headers.map((h, i) => (
                        <th
                          key={i}
                          className={cn(
                            'px-2.5 py-1.5 font-medium whitespace-nowrap',
                            i === mapping.phone && 'text-accent-ink',
                            (i === mapping.name ||
                              i === mapping.birthday ||
                              mapping.extra.some((e) => e.column === i)) &&
                              'text-ink'
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {r.map((c, j) => (
                          <td key={j} className="max-w-[180px] truncate px-2.5 py-1.5" data-selectable>
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[12.5px] text-ink-3">
                Telefones são padronizados (DDD + número, com 55). Contatos que já existem são atualizados, nunca
                duplicados.
              </p>
            </>
          )
        )}
      </div>
    </Drawer>
  )
}

export function Contatos(): React.JSX.Element {
  const active = useActiveAccount()
  const accountId = active?.id ?? ''
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [optOut, setOptOut] = useState<'all' | 'only' | 'exclude'>('all')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<Person | null | 'new'>(null)
  const [importing, setImporting] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [managing, setManaging] = useState(false)
  const [managingFields, setManagingFields] = useState(false)
  const [toFunnel, setToFunnel] = useState(false)
  const [funnelStage, setFunnelStage] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const tagDefs = useTagDefs(accountId)
  const funil = !!active?.modules.funil
  const { busy, error, run } = useAction()

  const list = useLoad(
    () =>
      accountId
        ? window.api.invoke('people:list', { accountId, search, tag, optOut, limit: PAGE, offset: page * PAGE })
        : Promise.resolve({ items: [], total: 0 }),
    [accountId, search, tag, optOut, page]
  )
  const tags = useLoad(
    () => (accountId ? window.api.invoke('people:tags', { accountId }) : Promise.resolve([])),
    [accountId, list.data]
  )
  const fieldDefs = useLoad(
    () => (accountId ? window.api.invoke('people:field-definitions', { accountId }) : Promise.resolve([])),
    [accountId],
    { resetOnChange: true }
  )
  useEffect(() => {
    setEditing(null)
    setManagingFields(false)
  }, [accountId])
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const allChecked = items.length > 0 && items.every((p) => selected.has(p.id))
  const ids = useMemo(() => [...selected], [selected])

  if (!active) return <Empty icon={<Users className="size-9" />} title="Crie uma conta primeiro" />

  async function bulk(key: string, fn: () => Promise<unknown>): Promise<void> {
    await run(key, fn)
    setSelected(new Set())
    await list.reload()
    void tagDefs.reload()
  }

  return (
    <div>
      <PageHeader
        title="Contatos"
        description="Sua base de clientes para campanhas e lembretes. Quem responde SAIR vai para a lista de não receber automaticamente."
        actions={
          <>
            <Button disabled={!fieldDefs.data} onClick={() => setManagingFields(true)}>
              <FileSpreadsheet className="size-4" /> Campos do negócio
            </Button>
            <Button onClick={() => setManaging(true)}>
              <Tags className="size-4" /> Etiquetas
            </Button>
            <Button onClick={() => void window.api.invoke('people:export', { accountId })}>
              <Download className="size-4" /> Exportar
            </Button>
            <Button onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Importar planilha
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Novo contato
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            className="pl-8"
            placeholder="Nome ou telefone"
            aria-label="Buscar contatos"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </div>
        <Select
          aria-label="Filtrar por etiqueta"
          value={tag ?? ''}
          onChange={(e) => (setTag(e.target.value || null), setPage(0))}
        >
          <option value="">Todas as etiquetas</option>
          {(tags.data ?? []).map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filtrar não receber"
          value={optOut}
          onChange={(e) => (setOptOut(e.target.value as typeof optOut), setPage(0))}
        >
          <option value="all">Todos</option>
          <option value="exclude">Recebem mensagens</option>
          <option value="only">Pediram para não receber</option>
        </Select>
        <span className="tabular ml-auto text-[13px] text-ink-2">{total.toLocaleString('pt-BR')} contatos</span>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-2">
          <span className="text-[13.5px] font-medium">{selected.size} selecionados</span>
          <Input
            className="h-8 w-44"
            placeholder="Etiqueta"
            aria-label="Etiqueta para aplicar"
            list="tag-names"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
          />
          <datalist id="tag-names">
            {tagDefs.defs.map((t) => (
              <option key={t.name} value={t.name} />
            ))}
          </datalist>
          <Button
            size="sm"
            disabled={!tagInput.trim()}
            loading={busy === 'tag'}
            onClick={() =>
              void bulk('tag', () =>
                window.api.invoke('people:tag', { accountId, ids, tag: tagInput.trim(), add: true })
              )
            }
          >
            <Tag className="size-3.5" /> Etiquetar
          </Button>
          <Button
            size="sm"
            disabled={!tagInput.trim()}
            onClick={() =>
              void bulk('untag', () =>
                window.api.invoke('people:tag', { accountId, ids, tag: tagInput.trim(), add: false })
              )
            }
          >
            Tirar etiqueta
          </Button>
          {funil && (
            <Button size="sm" onClick={() => (setNotice(null), setToFunnel(true))}>
              <SquareKanban className="size-3.5" /> Adicionar ao funil
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => void bulk('opt', () => window.api.invoke('people:opt-out', { accountId, ids, value: true }))}
          >
            <Ban className="size-3.5" /> Não receber
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void bulk('optin', () => window.api.invoke('people:opt-out', { accountId, ids, value: false }))
            }
          >
            Voltar a receber
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm(`Excluir ${selected.size} contatos? (pedido de exclusão LGPD)`))
                void bulk('del', () => window.api.invoke('people:delete', { accountId, ids }))
            }}
          >
            <Trash2 className="size-3.5" /> Excluir
          </Button>
        </div>
      )}
      {notice && (
        <div className="mb-3">
          <Notice tone="ok">{notice}</Notice>
        </div>
      )}
      {(error || list.error || fieldDefs.error) && (
        <div className="mb-3">
          <Notice tone="bad">{error ?? list.error ?? fieldDefs.error}</Notice>
        </div>
      )}

      {!list.loading && total === 0 && !search && !tag && optOut === 'all' ? (
        <Empty
          icon={<Users className="size-9" strokeWidth={1.5} />}
          title="Nenhum contato ainda"
          action={
            <Button variant="primary" onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Importar planilha
            </Button>
          }
        >
          Importe a planilha de clientes (Excel ou CSV) ou cadastre um a um. Membros de grupos também podem ser copiados
          para cá.
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          <table className="w-full text-[13.5px]">
            <thead className="border-b border-line bg-sunken text-left text-[12.5px] text-ink-2">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    label="Selecionar todos"
                    checked={allChecked}
                    indeterminate={!allChecked && items.some((p) => selected.has(p.id))}
                    onChange={(v) => setSelected(v ? new Set(items.map((p) => p.id)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2 font-medium">Nome</th>
                <th className="px-2 py-2 font-medium">Telefone</th>
                <th className="px-2 py-2 font-medium">Aniversário</th>
                <th className="px-2 py-2 font-medium">Etiquetas</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-sunken/50">
                  <td className="px-3 py-2">
                    <Checkbox
                      label={`Selecionar ${p.name ?? p.phone}`}
                      checked={selected.has(p.id)}
                      onChange={(v) => {
                        const n = new Set(selected)
                        if (v) n.add(p.id)
                        else n.delete(p.id)
                        setSelected(n)
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button className="text-left font-medium hover:text-accent" onClick={() => setEditing(p)}>
                      {p.name || <span className="text-ink-3">Sem nome</span>}
                    </button>
                  </td>
                  <td className="tabular px-2 py-2 text-ink-2" data-selectable>
                    {formatPhone(p.phone)}
                    {p.hasWa === false && (
                      <Badge tone="warn" className="ml-2">
                        sem WhatsApp
                      </Badge>
                    )}
                  </td>
                  <td className="tabular px-2 py-2 text-ink-2">{birthdayLabel(p.birthday)}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.tags.slice(0, 4).map((t) => (
                        <TagChip key={t} name={t} color={tagDefs.colorOf(t)} size="sm" />
                      ))}
                      {p.tags.length > 4 && <Badge>+{p.tags.length - 4}</Badge>}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">{p.optOut && <Badge tone="bad">não receber</Badge>}</td>
                </tr>
              ))}
              {!list.loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-2">
                    Nenhum contato com estes filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {total > PAGE && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[13px] text-ink-2">
              <span className="tabular">
                {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} de {total.toLocaleString('pt-BR')}
              </span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && fieldDefs.data && (
        <PersonForm
          key={`${accountId}:${editing === 'new' ? 'new' : editing.id}`}
          fieldNames={fieldDefs.data}
          accountId={accountId}
          person={editing === 'new' ? null : editing}
          tagDefs={tagDefs.defs}
          funil={funil}
          onDone={() => {
            setEditing(null)
            void list.reload()
            void tagDefs.reload()
          }}
        />
      )}
      {managingFields && fieldDefs.data && (
        <BusinessFields
          key={accountId}
          accountId={accountId}
          names={fieldDefs.data}
          onDone={(changed) => {
            setManagingFields(false)
            if (changed) void fieldDefs.reload()
          }}
        />
      )}
      {managing && (
        <TagManager
          accountId={accountId}
          onClose={(changed) => {
            setManaging(false)
            if (changed) {
              void list.reload()
              void tagDefs.reload()
            }
          }}
        />
      )}
      {toFunnel && (
        <Drawer
          title="Adicionar ao funil"
          onClose={() => setToFunnel(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setToFunnel(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={!funnelStage}
                loading={busy === 'funil'}
                onClick={async () => {
                  const r = await run('funil', () =>
                    window.api.invoke('pipelines:add-people', { accountId, stageId: funnelStage!, personIds: ids })
                  )
                  if (r) {
                    setNotice(
                      `${r.added} contato(s) adicionado(s) ao funil${r.already ? ` · ${r.already} já estava(m) nele` : ''}.`
                    )
                    setToFunnel(false)
                    setSelected(new Set())
                  }
                }}
              >
                Adicionar {selected.size}
              </Button>
            </>
          }
        >
          <p className="mb-4 text-[13.5px] text-ink-2">
            Os {selected.size} contatos selecionados entram na coluna escolhida. Quem já está no funil continua onde
            está.
          </p>
          <StagePicker accountId={accountId} value={funnelStage} onChange={(id) => setFunnelStage(id)} />
        </Drawer>
      )}
      {importing && (
        <ImportWizard
          accountId={accountId}
          onDone={(changed) => {
            setImporting(false)
            if (changed) void list.reload()
          }}
        />
      )}
    </div>
  )
}
