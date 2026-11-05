import { useEffect, useState } from 'react'
import { Link2, RefreshCw, Shield, UserPlus, Users, UsersRound } from 'lucide-react'
import type { GroupInfo, GroupRule } from '@shared/types'
import { useActiveAccount, useApp } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import {
  Badge,
  Button,
  Checkbox,
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

function Moderation({
  accountId,
  group,
  onDone
}: {
  accountId: string
  group: GroupInfo
  onDone: () => void
}): React.JSX.Element {
  const rule = useLoad(() => window.api.invoke('groups:rule-get', { accountId, jid: group.jid }), [group.jid])
  const [r, setR] = useState<GroupRule | null>(null)
  const [words, setWords] = useState('')
  const { busy, error, run } = useAction()
  const cur = r ?? rule.data
  if (!cur)
    return (
      <Drawer title={group.subject} onClose={onDone}>
        <div className="h-40 animate-pulse rounded-lg bg-sunken" />
      </Drawer>
    )
  const set = (p: Partial<GroupRule>): void => setR({ ...cur, ...p })
  return (
    <Drawer
      title={`Moderação: ${group.subject}`}
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
                window.api.invoke('groups:rule-save', {
                  accountId,
                  jid: group.jid,
                  rule: {
                    ...cur,
                    bannedWords: (words || cur.bannedWords.join(', '))
                      .split(',')
                      .map((w) => w.trim())
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
        {!group.isAdmin && (
          <Notice tone="warn">
            Este número não é administrador do grupo: dá para dar boas-vindas, mas não para apagar mensagens nem remover
            pessoas.
          </Notice>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        <Field
          label="Mensagem de boas-vindas"
          htmlFor="g-w"
          hint="Enviada quando alguém entra. Use {nome} para marcar a pessoa e {grupo}. Deixe vazio para não enviar."
        >
          <Textarea
            id="g-w"
            rows={4}
            value={cur.welcome ?? ''}
            onChange={(e) => set({ welcome: e.target.value })}
            placeholder="Bem-vindo(a), {nome}! Aqui no {grupo} você recebe nossas ofertas antes de todo mundo."
          />
        </Field>
        <label className="flex items-center justify-between gap-4 text-[14px]">
          <span>
            Apagar links de quem não é admin
            <span className="block text-[12.5px] text-ink-3">Avisa a pessoa e apaga a mensagem.</span>
          </span>
          <Switch label="Anti-link" checked={cur.antiLink} onChange={(v) => set({ antiLink: v })} />
        </label>
        <Field label="Palavras proibidas" htmlFor="g-b" hint="Separe por vírgula.">
          <Input id="g-b" defaultValue={cur.bannedWords.join(', ')} onChange={(e) => setWords(e.target.value)} />
        </Field>
        <Field label="Remover depois de quantos avisos" htmlFor="g-m" hint="0 = só avisa e apaga, nunca remove.">
          <Input
            id="g-m"
            type="number"
            min={0}
            max={10}
            className="w-24"
            value={cur.maxWarnings}
            onChange={(e) => set({ maxWarnings: Number(e.target.value) })}
          />
        </Field>
      </div>
    </Drawer>
  )
}

function CreateGroup({ accountId, onDone }: { accountId: string; onDone: () => void }): React.JSX.Element {
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [tag, setTag] = useState('')
  const [phones, setPhones] = useState('')
  const [adminsOnly, setAdminsOnly] = useState(true)
  const [result, setResult] = useState<{ jid: string; inviteLink: string | null; queued: number } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; blocked: number; finished?: boolean } | null>(
    null
  )
  const tags = useLoad(() => window.api.invoke('people:tags', { accountId }), [accountId])
  const { busy, error, run } = useAction()
  useEffect(() => window.api.on('groups:progress', (p) => result && p.jid === result.jid && setProgress(p)), [result])

  return (
    <Drawer
      title="Criar grupo"
      onClose={onDone}
      footer={
        result ? (
          <Button variant="primary" onClick={onDone}>
            Concluir
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={busy === 'c'}
            disabled={!subject.trim() || (!tag && !phones.trim())}
            onClick={async () => {
              const r = await run('c', () =>
                window.api.invoke('groups:create', {
                  accountId,
                  subject,
                  description: description || undefined,
                  tag: tag || undefined,
                  phones: phones
                    .split(/[\n,;]+/)
                    .map((p) => p.trim())
                    .filter(Boolean),
                  adminsOnly
                })
              )
              if (r) setResult(r)
            }}
          >
            Criar grupo
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="bad">{error}</Notice>}
        {result ? (
          <>
            <Notice tone="ok">
              Grupo criado com os 5 primeiros participantes.
              {result.queued > 0 && (
                <>
                  {' '}
                  Os outros {result.queued} são adicionados aos poucos, 5 a cada 30 a 60 segundos, para proteger o
                  número.
                </>
              )}
            </Notice>
            {progress && (
              <p className="tabular text-[13.5px]">
                {progress.done} de {progress.total} adicionados
                {progress.blocked > 0 && (
                  <>
                    {' '}
                    · {progress.blocked} não puderam ser adicionados (privacidade). Mande o link de convite para eles.
                  </>
                )}
              </p>
            )}
            {result.inviteLink && (
              <Field label="Link de convite">
                <Input readOnly value={result.inviteLink} onFocus={(e) => e.target.select()} />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label="Nome do grupo" htmlFor="ng-s">
              <Input id="ng-s" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Descrição" htmlFor="ng-d">
              <Textarea id="ng-d" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Participantes: contatos com a etiqueta" htmlFor="ng-t">
              <Select id="ng-t" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Nenhuma</option>
                {(tags.data ?? []).map((t) => (
                  <option key={t.tag} value={t.tag}>
                    {t.tag} ({t.count})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="e/ou estes números" htmlFor="ng-p" hint="Um por linha, com DDD.">
              <Textarea id="ng-p" rows={4} value={phones} onChange={(e) => setPhones(e.target.value)} />
            </Field>
            <label className="flex items-center justify-between gap-4 text-[14px]">
              Só administradores enviam mensagens
              <Switch label="Só admins" checked={adminsOnly} onChange={setAdminsOnly} />
            </label>
            <Notice tone="warn">
              Adicionar muitas pessoas que não têm seu número salvo é um dos principais motivos de bloqueio. Para listas
              grandes, prefira divulgar o link de convite.
            </Notice>
          </>
        )}
      </div>
    </Drawer>
  )
}

export function Grupos(): React.JSX.Element {
  const account = useActiveAccount()
  const accountId = account?.id ?? ''
  const go = useApp((s) => s.go)
  const [refresh, setRefresh] = useState(0)
  const list = useLoad(
    () => (accountId ? window.api.invoke('groups:list', { accountId, refresh: refresh > 0 }) : Promise.resolve([])),
    [accountId, refresh]
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moderating, setModerating] = useState<GroupInfo | null>(null)
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  if (!account) return <Empty icon={<Users className="size-9" />} title="Crie uma conta primeiro" />
  const m = account.modules
  const groups = list.data ?? []

  return (
    <div>
      <PageHeader
        title="Grupos"
        description="Grupos em que este número participa."
        actions={
          <>
            <Button loading={list.loading && refresh > 0} onClick={() => setRefresh((n) => n + 1)}>
              <RefreshCw className="size-4" /> Atualizar
            </Button>
            {m.gruposCriar && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <UserPlus className="size-4" /> Criar grupo
              </Button>
            )}
          </>
        }
      />
      {(error || list.error) && (
        <div className="mb-3">
          <Notice tone="bad">{error ?? list.error}</Notice>
        </div>
      )}
      {msg && (
        <div className="mb-3">
          <Notice tone="ok">{msg}</Notice>
        </div>
      )}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-2">
          <span className="text-[13.5px] font-medium">{selected.size} grupos</span>
          {m.gruposExtrair && (
            <Button
              size="sm"
              loading={busy === 'x'}
              onClick={async () => {
                const r = await run('x', () => window.api.invoke('groups:extract', { accountId, jids: [...selected] }))
                if (r)
                  setMsg(
                    `${r.added} contatos novos e ${r.existing} já existentes etiquetados com o nome do grupo.${r.withoutNumber ? ` ${r.withoutNumber} participantes ocultam o número e não foram copiados.` : ''}`
                  )
              }}
            >
              <UsersRound className="size-3.5" /> Copiar membros para Contatos
            </Button>
          )}
          {m.gruposEnvio && (
            <Button size="sm" onClick={() => go('campanhas')}>
              Enviar mensagem (em Campanhas → público Grupos)
            </Button>
          )}
        </div>
      )}
      {groups.length === 0 && !list.loading ? (
        <Empty icon={<Users className="size-9" strokeWidth={1.5} />} title="Nenhum grupo encontrado">
          Conecte o WhatsApp e clique em Atualizar.
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          <table className="w-full text-[13.5px]">
            <thead className="border-b border-line bg-sunken text-left text-[12.5px] text-ink-2">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    label="Selecionar todos"
                    checked={groups.length > 0 && selected.size === groups.length}
                    onChange={(v) => setSelected(v ? new Set(groups.map((g) => g.jid)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2 font-medium">Grupo</th>
                <th className="px-2 py-2 font-medium">Membros</th>
                <th className="px-2 py-2 font-medium">Você</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.jid} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <Checkbox
                      label={`Selecionar ${g.subject}`}
                      checked={selected.has(g.jid)}
                      onChange={(v) => {
                        const n = new Set(selected)
                        if (v) n.add(g.jid)
                        else n.delete(g.jid)
                        setSelected(n)
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-medium">{g.subject}</div>
                    {g.description && (
                      <div className="max-w-[420px] truncate text-[12px] text-ink-3">{g.description}</div>
                    )}
                  </td>
                  <td className="tabular px-2 py-2 text-ink-2">{g.size}</td>
                  <td className="px-2 py-2">
                    {g.isAdmin ? <Badge tone="accent">admin</Badge> : <Badge>membro</Badge>}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {g.isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Copiar link de convite"
                        onClick={async () => {
                          const l = await run('i', () => window.api.invoke('groups:invite', { accountId, jid: g.jid }))
                          if (l) {
                            await navigator.clipboard.writeText(l)
                            setMsg('Link de convite copiado.')
                          }
                        }}
                      >
                        <Link2 className="size-4" />
                      </Button>
                    )}
                    {m.gruposModeracao && (
                      <Button size="sm" variant="ghost" onClick={() => setModerating(g)}>
                        <Shield className="size-4" /> Moderação
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {moderating && <Moderation accountId={accountId} group={moderating} onDone={() => setModerating(null)} />}
      {creating && <CreateGroup accountId={accountId} onDone={() => (setCreating(false), setRefresh((n) => n + 1))} />}
    </div>
  )
}
