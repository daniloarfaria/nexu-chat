import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Megaphone,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type { Campaign, CampaignAudience, CampaignTarget, EngineState, TargetStatus } from '@shared/types'
import { hasLink, OPT_OUT_FOOTER, renderTemplate } from '@shared/rules'
import { useActiveAccount, useApp } from '../lib/store'
import { fileBytes, pct, useAction, useLoad } from '../lib/useAsync'
import { formatDateTime, formatPhone, formatBytes } from '../lib/format'
import {
  Badge,
  Button,
  Empty,
  Field,
  Input,
  Notice,
  PageHeader,
  Section,
  Switch,
  Tabs,
  Textarea
} from '../components/ui'
import { cn } from '../lib/cn'
import { ColorDot, TagToggles } from '../components/tags'
import { useTagDefs } from '../lib/tagColors'

const STATUS: Record<
  Campaign['status'],
  { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' }
> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  scheduled: { label: 'Agendada', tone: 'info' },
  running: { label: 'Enviando', tone: 'accent' },
  paused: { label: 'Pausada', tone: 'warn' },
  done: { label: 'Concluída', tone: 'ok' },
  canceled: { label: 'Cancelada', tone: 'neutral' }
}

const PHASE: Record<EngineState['phase'], string> = {
  idle: 'Parado',
  sending: 'Enviando agora…',
  waiting: 'Aguardando o intervalo de segurança',
  paused_long: 'Pausa longa de segurança',
  outside_hours: 'Fora do horário de envio',
  daily_limit: 'Limite diário atingido',
  disconnected: 'WhatsApp desconectado'
}

const SAMPLE = { nome: 'Maria da Silva', primeiro_nome: 'Maria', telefone: '5511987654321' }

function useClock(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function Countdown({ at }: { at: number | null }): React.JSX.Element | null {
  const now = useClock()
  if (!at) return null
  const s = Math.max(0, Math.round((at - now) / 1000))
  if (s > 3600)
    return (
      <span className="tabular">
        às {new Date(at).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
      </span>
    )
  return (
    <span className="tabular">
      em {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  )
}

// ---------- Editor ----------

function Editor({
  accountId,
  initial,
  draft,
  onClose
}: {
  accountId: string
  initial: Campaign | null
  draft?: { name: string; audience: CampaignAudience } | null
  onClose: (saved?: Campaign) => void
}): React.JSX.Element {
  const account = useActiveAccount()
  const groupsEnabled = !!account?.modules.gruposEnvio
  const iaEnabled = !!account?.modules.ia
  const funilEnabled = !!account?.modules.funil
  const [name, setName] = useState(initial?.name ?? draft?.name ?? '')
  const [templates, setTemplates] = useState<string[]>(initial?.templates.length ? initial.templates : [''])
  const [audience, setAudience] = useState<CampaignAudience>(
    initial?.audience ?? draft?.audience ?? { type: 'tags', tags: [] }
  )
  const [footer, setFooter] = useState(initial?.optOutFooter ?? true)
  const [when, setWhen] = useState<string>(
    initial?.scheduledAt
      ? new Date(initial.scheduledAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : ''
  )
  const [media, setMedia] = useState<File | null>(null)
  const [keepMedia, setKeepMedia] = useState(!!initial?.media)
  const [brief, setBrief] = useState('')
  const { busy, error, run, setError } = useAction()
  const tagDefs = useTagDefs(accountId)
  const pipelines = useLoad(
    () => (funilEnabled ? window.api.invoke('pipelines:list', { accountId }) : Promise.resolve([])),
    [accountId, funilEnabled]
  )
  const fields = useLoad(() => window.api.invoke('people:fields', { accountId }), [accountId])
  const groups = useLoad(
    () => (groupsEnabled ? window.api.invoke('groups:list', { accountId }) : Promise.resolve([])),
    [accountId, groupsEnabled]
  )
  const count = useLoad(
    () => window.api.invoke('campaigns:audience-count', { accountId, audience }),
    [accountId, JSON.stringify(audience)]
  )
  const [previewSeed, setPreviewSeed] = useState(0.3)
  const isGroups = audience.type === 'groups'
  const vars = ['primeiro_nome', 'nome', 'loja', ...(fields.data ?? [])]
  const anyLink = templates.some((t) => hasLink(t))

  const preview = useMemo(() => {
    const t = templates.find((x) => x.trim()) ?? ''
    let out = renderTemplate(t, { ...SAMPLE, loja: account?.name ?? '' }, () => previewSeed)
    if (footer && !isGroups && out) out += `\n\n${OPT_OUT_FOOTER}`
    return out
  }, [templates, previewSeed, footer, isGroups, account?.name])

  async function save(start: boolean): Promise<void> {
    const c = await run(start ? 'start' : 'save', async () => {
      let saved = await window.api.invoke('campaigns:save', {
        id: initial?.id,
        accountId,
        name: name || 'Campanha sem nome',
        templates: templates.filter((t) => t.trim()),
        audience,
        optOutFooter: footer && !isGroups,
        scheduledAt: when ? new Date(when).getTime() : null
      })
      if (media) saved = await window.api.invoke('campaigns:media', { id: saved.id, file: await fileBytes(media) })
      else if (!keepMedia && saved.media)
        saved = await window.api.invoke('campaigns:media', { id: saved.id, file: null })
      if (start) saved = await window.api.invoke('campaigns:start', { id: saved.id })
      return saved
    })
    if (c) onClose(c)
  }

  function insertVar(i: number, v: string): void {
    setTemplates(templates.map((t, j) => (j === i ? `${t}{${v}}` : t)))
  }

  return (
    <div>
      <button
        onClick={() => onClose()}
        className="mb-3 flex items-center gap-1.5 text-[13.5px] text-ink-2 hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Campanhas
      </button>
      <PageHeader title={initial ? 'Editar campanha' : 'Nova campanha'} />
      {error && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      <div className="grid grid-cols-[1fr_340px] items-start gap-5">
        <div className="flex flex-col gap-4">
          <Section title="Nome e público">
            <div className="flex flex-col gap-4">
              <Field label="Nome da campanha (só para você)" htmlFor="c-name">
                <Input
                  id="c-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Black Friday semijoias"
                />
              </Field>
              <div
                className="flex flex-wrap gap-1 rounded-lg border border-line bg-sunken p-0.5 self-start"
                role="radiogroup"
                aria-label="Público"
              >
                {(
                  [
                    ['tags', 'Por etiqueta'],
                    ...(funilEnabled || audience.type === 'stages' ? [['stages', 'Colunas do funil']] : []),
                    ['all', 'Todos os contatos'],
                    ...(groupsEnabled ? [['groups', 'Grupos']] : [])
                  ] as Array<[CampaignAudience['type'], string]>
                ).map(([t, l]) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={audience.type === t}
                    onClick={() => setAudience({ type: t, tags: [], groups: [], stageIds: [] })}
                    className={cn(
                      'h-8 rounded-md px-3 text-[13.5px] text-ink-2',
                      audience.type === t && 'bg-panel font-medium text-ink shadow-card'
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {audience.type === 'stages' && (
                <div className="flex flex-col gap-3">
                  {(pipelines.data ?? []).length === 0 && (
                    <p className="text-[13px] text-ink-3">Nenhum funil ainda. Crie em Funis.</p>
                  )}
                  {(pipelines.data ?? []).map((p) => (
                    <div key={p.id}>
                      <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
                        <ColorDot color={p.color} /> {p.name}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.stages.map((st) => {
                          const on = audience.stageIds?.includes(st.id)
                          return (
                            <button
                              key={st.id}
                              aria-pressed={on}
                              onClick={() =>
                                setAudience({
                                  ...audience,
                                  stageIds: on
                                    ? audience.stageIds!.filter((x) => x !== st.id)
                                    : [...(audience.stageIds ?? []), st.id]
                                })
                              }
                              className={cn(
                                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px]',
                                on
                                  ? 'border-accent bg-accent-soft font-medium text-accent-ink'
                                  : 'border-line-strong text-ink-2 hover:text-ink'
                              )}
                            >
                              <ColorDot color={st.color} />
                              {st.name} <span className="tabular text-ink-3">{st.count}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(audience.type === 'tags' || audience.type === 'stages') && (
                <Field
                  label={audience.type === 'stages' ? 'Só quem tem a etiqueta (opcional)' : 'Etiquetas'}
                  hint={
                    (audience.tags?.length ?? 0) > 1 ? (
                      <span className="inline-flex items-center gap-2">
                        Enviar para quem tem
                        <span role="radiogroup" aria-label="Combinação das etiquetas" className="inline-flex gap-1">
                          {(
                            [
                              ['any', 'qualquer uma'],
                              ['all', 'todas']
                            ] as const
                          ).map(([m, l]) => (
                            <button
                              key={m}
                              role="radio"
                              aria-checked={(audience.tagMode ?? 'any') === m}
                              onClick={() => setAudience({ ...audience, tagMode: m })}
                              className={cn(
                                'rounded-md border px-2 leading-6',
                                (audience.tagMode ?? 'any') === m
                                  ? 'border-accent bg-accent-soft font-medium text-accent-ink'
                                  : 'border-line text-ink-2'
                              )}
                            >
                              {l}
                            </button>
                          ))}
                        </span>
                      </span>
                    ) : undefined
                  }
                >
                  <TagToggles
                    defs={tagDefs.defs}
                    value={audience.tags ?? []}
                    onChange={(t) => setAudience({ ...audience, tags: t })}
                    empty="Nenhuma etiqueta ainda. Crie em Contatos ou importe contatos com etiquetas."
                  />
                </Field>
              )}
              {audience.type !== 'groups' && tagDefs.defs.length > 0 && (
                <Field label="Não enviar para quem tem a etiqueta">
                  <TagToggles
                    defs={tagDefs.defs}
                    value={audience.excludeTags ?? []}
                    onChange={(t) => setAudience({ ...audience, excludeTags: t })}
                    tone="exclude"
                  />
                </Field>
              )}
              {isGroups && (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-line">
                  {(groups.data ?? []).map((g) => {
                    const on = audience.groups?.includes(g.jid)
                    return (
                      <label
                        key={g.jid}
                        className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-0 hover:bg-sunken/50"
                      >
                        <input
                          type="checkbox"
                          checked={!!on}
                          className="accent-[var(--color-accent)]"
                          onChange={() =>
                            setAudience({
                              ...audience,
                              groups: on
                                ? audience.groups!.filter((x) => x !== g.jid)
                                : [...(audience.groups ?? []), g.jid]
                            })
                          }
                        />
                        <span className="flex-1 truncate text-[13.5px]">{g.subject}</span>
                        <span className="tabular text-[12px] text-ink-3">{g.size} membros</span>
                        {g.announce && !g.isAdmin && <Badge tone="warn">só admins enviam</Badge>}
                      </label>
                    )
                  })}
                  {(groups.data ?? []).length === 0 && (
                    <p className="px-3 py-4 text-[13px] text-ink-3">
                      Nenhum grupo encontrado. Conecte o WhatsApp e abra a página Grupos.
                    </p>
                  )}
                </div>
              )}
              <p className="tabular text-[13.5px]">
                {count.data ? (
                  <>
                    <b>{(count.data.total - count.data.optedOut).toLocaleString('pt-BR')}</b>{' '}
                    {isGroups ? 'grupos' : 'contatos'} vão receber
                    {count.data.optedOut > 0 && (
                      <span className="text-ink-2">
                        {' '}
                        · {count.data.optedOut} pediram para não receber e serão pulados
                      </span>
                    )}
                  </>
                ) : (
                  '…'
                )}
              </p>
            </div>
          </Section>

          <Section
            title="Mensagem"
            description="Escreva 2 ou mais versões com palavras diferentes: o app sorteia uma para cada pessoa, o que reduz o risco de bloqueio. Use {Oi|Olá} para variar palavras."
          >
            <div className="flex flex-col gap-3">
              {templates.map((t, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12.5px] font-medium text-ink-2">Versão {i + 1}</span>
                    {templates.length > 1 && (
                      <button
                        aria-label={`Remover versão ${i + 1}`}
                        onClick={() => setTemplates(templates.filter((_, j) => j !== i))}
                        className="text-ink-3 hover:text-bad"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                  <Textarea
                    rows={5}
                    value={t}
                    onChange={(e) => setTemplates(templates.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder="{Oi|Olá} {primeiro_nome}! Aqui é da {loja}…"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {vars.map((v) => (
                      <button
                        key={v}
                        onClick={() => insertVar(i, v)}
                        className="h-6 rounded-md bg-sunken px-2 font-mono text-[11.5px] text-ink-2 hover:text-ink"
                      >
                        {`{${v}}`}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                {templates.length < 10 && (
                  <Button size="sm" onClick={() => setTemplates([...templates, ''])}>
                    <Plus className="size-4" /> Outra versão
                  </Button>
                )}
                {iaEnabled && (
                  <>
                    <Input
                      className="h-8 w-64"
                      placeholder="Briefing para a IA (opcional)"
                      aria-label="Briefing para a IA"
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                    />
                    <Button
                      size="sm"
                      loading={busy === 'ai'}
                      onClick={async () => {
                        const v = await run('ai', () =>
                          window.api.invoke('ai:variations', {
                            accountId,
                            base: templates.find((x) => x.trim()) ?? '',
                            count: 3,
                            brief: brief || undefined
                          })
                        )
                        if (v?.length) setTemplates([...templates.filter((x) => x.trim()), ...v].slice(0, 10))
                      }}
                    >
                      <Sparkles className="size-4" /> Gerar versões com IA
                    </Button>
                  </>
                )}
              </div>
              {anyLink && (
                <Notice tone="warn" icon={<AlertTriangle className="size-4" />}>
                  Mensagens com link para quem não salvou seu número aumentam bastante o risco de bloqueio. Prefira
                  pedir para a pessoa responder.
                </Notice>
              )}
              <label className="flex items-center justify-between gap-4 text-[13.5px]">
                <span>
                  Rodapé “responda SAIR para não receber”
                  <span className="block text-[12.5px] text-ink-3">Recomendado: reduz denúncias e atende a LGPD.</span>
                </span>
                <Switch
                  label="Rodapé de saída"
                  checked={footer && !isGroups}
                  disabled={isGroups}
                  onChange={setFooter}
                />
              </label>
            </div>
          </Section>

          <Section title="Imagem, vídeo ou arquivo (opcional)" description="A mensagem vira a legenda.">
            {media || (keepMedia && initial?.media) ? (
              <div className="flex items-center gap-3 rounded-lg bg-sunken px-3 py-2.5">
                {(media?.type ?? initial?.media?.mime ?? '').startsWith('image') ? (
                  <ImageIcon className="size-5 text-ink-2" />
                ) : (
                  <FileText className="size-5 text-ink-2" />
                )}
                <span className="flex-1 truncate text-[13.5px]">{media?.name ?? initial?.media?.name}</span>
                <span className="tabular text-[12.5px] text-ink-3">
                  {formatBytes(media?.size ?? initial?.media?.size ?? 0)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => (setMedia(null), setKeepMedia(false))}>
                  Remover
                </Button>
              </div>
            ) : (
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-panel px-3.5 text-[14px] shadow-card hover:bg-sunken">
                <ImageIcon className="size-4" /> Escolher arquivo
                <input
                  type="file"
                  hidden
                  accept="image/*,video/*,audio/*,application/pdf"
                  onChange={(e) => setMedia(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </Section>

          <Section title="Quando enviar">
            <div className="flex items-end gap-4">
              <Field
                label="Agendar para"
                htmlFor="c-when"
                hint="Deixe vazio para começar agora. Os envios respeitam o horário e os limites da Proteção."
              >
                <Input
                  id="c-when"
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="w-60"
                />
              </Field>
            </div>
          </Section>
        </div>

        <div className="sticky top-4 flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-[#e9e2d9] p-4 dark:bg-[#1b1714]">
            <div className="mb-2 flex items-center justify-between text-[12px] text-ink-2">
              <span>Prévia (como Maria vai ver)</span>
              <button className="underline-offset-2 hover:underline" onClick={() => setPreviewSeed(Math.random())}>
                sortear outra
              </button>
            </div>
            <div
              className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[14px] leading-[1.45] whitespace-pre-wrap text-[#111b21] shadow-card dark:bg-[#005c4b] dark:text-[#e9edef]"
              data-selectable
            >
              {(media || (keepMedia && initial?.media)) && (
                <div className="mb-1.5 grid h-28 place-items-center rounded-lg bg-black/10 text-[12px]">anexo</div>
              )}
              {preview || <span className="opacity-60">Escreva a mensagem…</span>}
            </div>
          </div>
          <Button
            loading={busy === 'test'}
            disabled={!templates.some((t) => t.trim())}
            onClick={async () => {
              const ok = await run('test', () =>
                window.api.invoke('campaigns:test', {
                  accountId,
                  templates: templates.filter((t) => t.trim()),
                  optOutFooter: footer && !isGroups
                })
              )
              if (ok !== undefined) setError(null)
            }}
          >
            <Send className="size-4" /> Enviar teste para mim
          </Button>
          <Button loading={busy === 'save'} onClick={() => void save(false)}>
            Salvar rascunho
          </Button>
          <Button
            variant="primary"
            loading={busy === 'start'}
            disabled={!templates.some((t) => t.trim()) || !count.data || count.data.total - count.data.optedOut <= 0}
            onClick={() => void save(true)}
          >
            <Play className="size-4" /> {when ? 'Agendar campanha' : 'Iniciar campanha'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------- Detalhe ----------

const TARGET_LABEL: Record<TargetStatus, string> = {
  pending: 'Na fila',
  sent: 'Enviada',
  failed: 'Falhou',
  skipped: 'Cancelada',
  no_wa: 'Sem WhatsApp',
  opted_out: 'Não receber'
}

function Detail({
  campaign,
  onBack,
  onEdit
}: {
  campaign: Campaign
  onBack: () => void
  onEdit: () => void
}): React.JSX.Element {
  const [c, setC] = useState(campaign)
  const [filter, setFilter] = useState<TargetStatus | 'all'>('all')
  const [engineState, setEngine] = useState<EngineState | null>(null)
  const { busy, error, run } = useAction()
  const targets = useLoad<CampaignTarget[]>(
    () => window.api.invoke('campaigns:targets', { id: c.id, status: filter, limit: 300, offset: 0 }),
    [c.id, filter, c.stats.sent, c.stats.failed]
  )

  useEffect(() => {
    void window.api.invoke('engine:state', { accountId: c.accountId }).then(setEngine)
    const off1 = window.api.on('campaign:changed', (x) => x.id === c.id && setC(x))
    const off2 = window.api.on('engine:changed', (e) => e.accountId === c.accountId && setEngine(e))
    return () => {
      off1()
      off2()
    }
  }, [c.id, c.accountId])

  const s = c.stats
  const done = s.total - s.pending
  const act = (k: string, fn: () => Promise<Campaign>): void => void run(k, fn).then((x) => x && setC(x))

  return (
    <div>
      <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[13.5px] text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Campanhas
      </button>
      <PageHeader
        title={c.name}
        description={
          <span className="flex items-center gap-2">
            <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
            {c.startedAt && <span>iniciada em {formatDateTime(c.startedAt)}</span>}
            {c.scheduledAt && c.status === 'scheduled' && <span>começa em {formatDateTime(c.scheduledAt)}</span>}
          </span>
        }
        actions={
          <>
            {(c.status === 'draft' || c.status === 'scheduled') && <Button onClick={onEdit}>Editar</Button>}
            {c.status === 'running' && (
              <Button
                loading={busy === 'pause'}
                onClick={() => act('pause', () => window.api.invoke('campaigns:pause', { id: c.id }))}
              >
                <Pause className="size-4" /> Pausar
              </Button>
            )}
            {(c.status === 'paused' || c.status === 'draft') && (
              <Button
                variant="primary"
                loading={busy === 'start'}
                onClick={() => act('start', () => window.api.invoke('campaigns:start', { id: c.id }))}
              >
                <Play className="size-4" /> {c.status === 'paused' ? 'Retomar' : 'Iniciar'}
              </Button>
            )}
            {s.failed > 0 && c.status !== 'running' && (
              <Button
                loading={busy === 'retry'}
                onClick={() => act('retry', () => window.api.invoke('campaigns:retry', { id: c.id }))}
              >
                <RotateCcw className="size-4" /> Reenviar falhas
              </Button>
            )}
            <Button onClick={() => void window.api.invoke('campaigns:export', { id: c.id })}>
              <Download className="size-4" /> Relatório
            </Button>
            {['running', 'paused', 'scheduled'].includes(c.status) && (
              <Button
                variant="danger"
                onClick={() =>
                  confirm('Cancelar a campanha? Quem ainda não recebeu não vai receber.') &&
                  act('cancel', () => window.api.invoke('campaigns:cancel', { id: c.id }))
                }
              >
                Cancelar
              </Button>
            )}
          </>
        }
      />
      {error && (
        <div className="mb-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      {c.pausedReason && c.status === 'paused' && (
        <div className="mb-3">
          <Notice tone="warn" icon={<AlertTriangle className="size-4" />}>
            {c.pausedReason}
          </Notice>
        </div>
      )}
      {c.status === 'running' && engineState && engineState.campaignId === c.id && (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-accent-soft px-4 py-2.5 text-[13.5px]" role="status">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          <span className="flex-1">
            {PHASE[engineState.phase]} {engineState.phase !== 'sending' && <Countdown at={engineState.nextAt} />}
          </span>
          <span className="tabular text-ink-2">
            Hoje: {engineState.sentToday} de {engineState.limitToday}
          </span>
        </div>
      )}

      <section className="mb-4 rounded-xl border border-line bg-panel p-5 shadow-card">
        <div className="mb-2 flex justify-between text-[13px] text-ink-2">
          <span>Progresso</span>
          <span className="tabular">
            {done.toLocaleString('pt-BR')} de {s.total.toLocaleString('pt-BR')}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: pct(done, s.total) === '—' ? '0%' : pct(done, s.total) }}
          />
        </div>
        <dl className="mt-5 grid grid-cols-4 gap-4 text-[13px] md:grid-cols-8">
          {(
            [
              ['Enviadas', s.sent],
              ['Entregues', s.delivered],
              ['Lidas', s.read],
              ['Responderam', s.replied],
              ['Na fila', s.pending],
              ['Falharam', s.failed],
              ['Sem WhatsApp', s.noWa],
              ['Não receber', s.optedOut]
            ] as Array<[string, number]>
          ).map(([l, v]) => (
            <div key={l}>
              <dt className="text-ink-2">{l}</dt>
              <dd className="tabular mt-0.5 text-[17px] font-semibold">{v.toLocaleString('pt-BR')}</dd>
            </div>
          ))}
        </dl>
        {s.sent > 0 && (
          <p className="mt-4 text-[13px] text-ink-2">
            Taxa de resposta: <b className="text-ink">{pct(s.replied, s.sent)}</b> · leitura:{' '}
            <b className="text-ink">{pct(s.read, s.sent)}</b>
            {s.sent >= 20 && s.replied / s.sent < 0.1 && (
              <span className="text-warn"> — baixa: considere pausar e rever a mensagem.</span>
            )}
          </p>
        )}
      </section>

      <Tabs
        value={filter}
        onChange={setFilter}
        items={[
          { id: 'all', label: 'Todos', count: s.total },
          { id: 'sent', label: 'Enviadas', count: s.sent },
          { id: 'pending', label: 'Na fila', count: s.pending },
          { id: 'failed', label: 'Falharam', count: s.failed },
          { id: 'no_wa', label: 'Sem WhatsApp', count: s.noWa },
          { id: 'opted_out', label: 'Não receber', count: s.optedOut }
        ]}
      />
      <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
        <table className="w-full text-[13px]">
          <thead className="border-b border-line bg-sunken text-left text-[12.5px] text-ink-2">
            <tr>
              <th className="px-4 py-2 font-medium">Contato</th>
              <th className="px-2 py-2 font-medium">Situação</th>
              <th className="px-2 py-2 font-medium">Enviada</th>
              <th className="px-2 py-2 font-medium">Leu</th>
              <th className="px-2 py-2 font-medium">Respondeu</th>
            </tr>
          </thead>
          <tbody>
            {(targets.data ?? []).map((t) => (
              <tr key={t.seq} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium">{t.name || '—'}</div>
                  <div className="tabular text-[12px] text-ink-3">{t.phone ? formatPhone(t.phone) : ''}</div>
                </td>
                <td className="px-2 py-2">
                  <Badge
                    tone={
                      t.status === 'sent'
                        ? 'ok'
                        : t.status === 'failed'
                          ? 'bad'
                          : t.status === 'pending'
                            ? 'neutral'
                            : 'warn'
                    }
                  >
                    {TARGET_LABEL[t.status]}
                  </Badge>
                  {t.error && (
                    <div className="mt-0.5 max-w-[280px] truncate text-[12px] text-bad" title={t.error}>
                      {t.error}
                    </div>
                  )}
                </td>
                <td className="tabular px-2 py-2 text-ink-2">{t.sentAt ? formatDateTime(t.sentAt) : ''}</td>
                <td className="px-2 py-2">{t.readAt ? '✓' : ''}</td>
                <td className="px-2 py-2">{t.repliedAt ? <Badge tone="accent">respondeu</Badge> : ''}</td>
              </tr>
            ))}
            {(targets.data ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-3">
                  Nada aqui.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- Lista ----------

export function Campanhas(): React.JSX.Element {
  const active = useActiveAccount()
  const accountId = active?.id ?? ''
  const goSettings = useApp((s) => s.goSettings)
  const [draft, setDraft] = useState(() => {
    const d = useApp.getState().campaignDraft
    if (d) useApp.setState({ campaignDraft: null })
    return d
  })
  const [view, setView] = useState<
    { mode: 'list' } | { mode: 'edit'; c: Campaign | null } | { mode: 'detail'; c: Campaign }
  >(draft ? { mode: 'edit', c: null } : { mode: 'list' })
  const list = useLoad(
    () => (accountId ? window.api.invoke('campaigns:list', { accountId }) : Promise.resolve([])),
    [accountId]
  )
  const { run } = useAction()

  useEffect(() => window.api.on('campaign:changed', () => void list.reload()), [list])

  if (!active) return <Empty icon={<Megaphone className="size-9" />} title="Crie uma conta primeiro" />
  if (view.mode === 'edit')
    return (
      <Editor
        accountId={accountId}
        initial={view.c}
        draft={view.c ? null : draft}
        onClose={(saved) => (
          setDraft(null),
          void list.reload(),
          setView(saved ? { mode: 'detail', c: saved } : { mode: 'list' })
        )}
      />
    )
  if (view.mode === 'detail')
    return (
      <Detail
        campaign={view.c}
        onBack={() => (void list.reload(), setView({ mode: 'list' }))}
        onEdit={() => setView({ mode: 'edit', c: view.c })}
      />
    )

  const items = (list.data ?? []).filter((c) => c.kind !== 'reminder')
  return (
    <div>
      <PageHeader
        title="Campanhas"
        description="Envios para sua base de clientes com intervalos e limites que protegem o número."
        actions={
          <>
            <Button onClick={() => goSettings('protecao')}>Proteção anti-bloqueio</Button>
            <Button variant="primary" onClick={() => setView({ mode: 'edit', c: null })}>
              <Plus className="size-4" /> Nova campanha
            </Button>
          </>
        }
      />
      {items.length === 0 && !list.loading ? (
        <Empty
          icon={<Megaphone className="size-9" strokeWidth={1.5} />}
          title="Nenhuma campanha ainda"
          action={
            <Button variant="primary" onClick={() => setView({ mode: 'edit', c: null })}>
              <Plus className="size-4" /> Criar campanha
            </Button>
          }
        >
          Importe seus contatos, escolha as etiquetas e escreva 2 ou mais versões da mensagem. O app cuida do ritmo de
          envio.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((c) => {
            const done = c.stats.total - c.stats.pending
            return (
              <li key={c.id}>
                <div className="flex items-center gap-4 rounded-xl border border-line bg-panel px-5 py-3.5 shadow-card">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setView({ mode: 'detail', c })}>
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold hover:text-accent">{c.name}</span>
                      <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                      {c.kind === 'groups' && <Badge>grupos</Badge>}
                    </div>
                    <div className="tabular mt-1 text-[12.5px] text-ink-2">
                      {c.stats.total
                        ? `${done} de ${c.stats.total} · ${c.stats.sent} enviadas · ${pct(c.stats.replied, c.stats.sent)} responderam`
                        : 'Ainda não iniciada'}{' '}
                      · criada {formatDateTime(c.createdAt)}
                    </div>
                  </button>
                  {c.stats.total > 0 && (
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full bg-accent" style={{ width: `${(done / c.stats.total) * 100}%` }} />
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Duplicar"
                    title="Duplicar"
                    onClick={() =>
                      void run('dup', () => window.api.invoke('campaigns:duplicate', { id: c.id })).then(() =>
                        list.reload()
                      )
                    }
                  >
                    <Copy className="size-4" />
                  </Button>
                  {c.status !== 'running' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Excluir"
                      title="Excluir"
                      onClick={() =>
                        confirm(`Excluir "${c.name}"?`) &&
                        void run('del', () => window.api.invoke('campaigns:delete', { id: c.id })).then(() =>
                          list.reload()
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
