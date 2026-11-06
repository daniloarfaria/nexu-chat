import { useEffect, useMemo, useState } from 'react'
import { CircleDashed, Film, Image as ImageIcon, Plus, Type, X } from 'lucide-react'
import type { StatusAudience, StatusKind, StatusPost, StatusPostState } from '@shared/types'
import { useActiveAccount, useApp } from '../lib/store'
import { fileBytes, useAction, useLoad } from '../lib/useAsync'
import { formatBytes, formatDateTime } from '../lib/format'
import { cn } from '../lib/cn'
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
  Tabs,
  Textarea
} from '../components/ui'

// Limites conferidos no processo principal (src/main/status.ts); aqui só para avisar antes
const TEXT_MAX = 700
const CAPTION_MAX = 1024
const MEDIA_MAX = 16 * 1024 * 1024
const VIDEO_MAX_SECONDS = 90

const COLORS = ['#128C7E', '#075E54', '#25D366', '#1E88E5', '#6A1B9A', '#C2185B', '#E64A19', '#F9A825', '#37474F']
const FONTS: Array<{ id: number; label: string; css: string }> = [
  { id: 0, label: 'Normal', css: 'font-sans' },
  { id: 6, label: 'Negrito', css: 'font-sans font-bold' },
  { id: 2, label: 'Manuscrita', css: 'italic font-serif' },
  { id: 10, label: 'Máquina de escrever', css: 'font-mono font-bold' }
]

const STATE: Record<StatusPostState, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' }> = {
  agendado: { label: 'Agendado', tone: 'info' },
  enviando: { label: 'Postando', tone: 'accent' },
  enviado: { label: 'Postado', tone: 'ok' },
  falhou: { label: 'Falhou', tone: 'bad' },
  cancelado: { label: 'Cancelado', tone: 'neutral' }
}

const KIND_ICON = { texto: Type, imagem: ImageIcon, video: Film }

function audienceLabel(a: StatusAudience): string {
  if (a.modo === 'etiqueta') return `Quem tem ${a.tags.join(', ')}`
  if (a.modo === 'todos_menos') return `Todos menos ${a.tags.join(', ')}`
  return 'Todos os contatos'
}

function videoSeconds(f: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(f)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(v.duration)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(NaN)
    }
    v.src = url
  })
}

function Preview({
  kind,
  text,
  background,
  font,
  fileUrl
}: {
  kind: StatusKind
  text: string
  background: string
  font: number
  fileUrl: string | null
}): React.JSX.Element {
  const fontCss = FONTS.find((f) => f.id === font)?.css ?? 'font-sans'
  return (
    <div
      className="relative mx-auto flex aspect-[9/16] w-[200px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-line bg-black shadow-card"
      aria-label="Prévia do status"
    >
      {kind === 'texto' ? (
        <div className="flex size-full items-center justify-center p-4" style={{ background }}>
          <p className={cn('text-center text-[15px] leading-snug break-words whitespace-pre-wrap text-white', fontCss)}>
            {text || 'Seu texto aparece aqui'}
          </p>
        </div>
      ) : fileUrl ? (
        <>
          {kind === 'imagem' ? (
            <img src={fileUrl} alt="" className="size-full object-contain" />
          ) : (
            <video src={fileUrl} className="size-full object-contain" muted controls />
          )}
          {text && (
            <p className="absolute right-0 bottom-0 left-0 bg-black/60 px-3 py-2 text-[12.5px] break-words whitespace-pre-wrap text-white">
              {text}
            </p>
          )}
        </>
      ) : (
        <p className="px-4 text-center text-[13px] text-white/70">
          {kind === 'imagem' ? 'Escolha uma foto' : 'Escolha um vídeo'}
        </p>
      )}
    </div>
  )
}

function NewStatus({ accountId, onDone }: { accountId: string; onDone: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<StatusKind>('texto')
  const [text, setText] = useState('')
  const [background, setBackground] = useState(COLORS[0])
  const [font, setFont] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [modo, setModo] = useState<StatusAudience['modo']>('todos')
  const [tagSel, setTagSel] = useState('')
  const [schedule, setSchedule] = useState(false)
  const [when, setWhen] = useState('')
  const { busy, error, run } = useAction()
  const tags = useLoad(() => window.api.invoke('tags:list', { accountId }), [accountId])
  const audience: StatusAudience = useMemo(
    () => ({ modo, tags: modo === 'todos' || !tagSel ? [] : [tagSel] }),
    [modo, tagSel]
  )
  const count = useLoad(
    () => window.api.invoke('status:audience-count', { accountId, audience }),
    [accountId, audience]
  )
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (fileUrl && URL.revokeObjectURL(fileUrl)), [fileUrl])

  const max = kind === 'texto' ? TEXT_MAX : CAPTION_MAX
  const needsTag = modo !== 'todos' && !tagSel
  const canPost =
    !needsTag &&
    !fileError &&
    (kind === 'texto' ? text.trim().length > 0 : !!file) &&
    text.length <= max &&
    (!schedule || !!when) &&
    (count.data?.total ?? 0) > 0

  async function pick(f: File | null): Promise<void> {
    setFile(null)
    setFileError(null)
    if (!f) return
    if (f.size > MEDIA_MAX) return setFileError(`O arquivo tem ${formatBytes(f.size)}. O máximo é 16 MB.`)
    if (kind === 'imagem' && !/^image\/(jpeg|png|webp)$/.test(f.type))
      return setFileError('Use foto em JPG, PNG ou WEBP.')
    if (kind === 'video') {
      if (f.type !== 'video/mp4') return setFileError('Use vídeo em MP4.')
      const s = await videoSeconds(f)
      if (!Number.isFinite(s)) return setFileError('Não foi possível ler este vídeo. Tente outro arquivo MP4.')
      if (s > VIDEO_MAX_SECONDS)
        return setFileError(
          `O vídeo tem ${Math.round(s)} segundos. O status aceita até ${VIDEO_MAX_SECONDS} segundos. Corte o vídeo antes.`
        )
    }
    setFile(f)
  }

  async function submit(): Promise<void> {
    const at = schedule ? new Date(when).getTime() : null
    const ok = await run('post', async () =>
      window.api.invoke('status:create', {
        accountId,
        kind,
        text,
        background: kind === 'texto' ? background : null,
        font: kind === 'texto' ? font : null,
        audience,
        scheduledAt: at,
        media: kind !== 'texto' && file ? await fileBytes(file) : null
      })
    )
    if (ok) onDone()
  }

  const [minWhen] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 60_000).toISOString().slice(0, 16)
  )

  return (
    <Drawer
      wide
      title="Novo status"
      onClose={onDone}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!canPost} loading={busy === 'post'} onClick={() => void submit()}>
            {schedule ? 'Agendar' : 'Postar agora'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_220px] gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {error && <Notice tone="bad">{error}</Notice>}
          <Tabs
            value={kind}
            onChange={(k) => {
              setKind(k)
              setFile(null)
              setFileError(null)
            }}
            items={[
              { id: 'texto', label: 'Texto' },
              { id: 'imagem', label: 'Foto' },
              { id: 'video', label: 'Vídeo' }
            ]}
          />
          {kind === 'texto' ? (
            <>
              <Field label="Texto" htmlFor="st-text" hint={`${text.length} de ${TEXT_MAX} letras`}>
                <Textarea
                  id="st-text"
                  rows={4}
                  value={text}
                  maxLength={TEXT_MAX}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
              <div>
                <span className="text-[13px] font-medium text-ink">Cor de fundo</span>
                <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Cor de fundo">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={background === c}
                      aria-label={`Cor ${c}`}
                      onClick={() => setBackground(c)}
                      className={cn(
                        'size-8 rounded-full border-2 transition-shadow',
                        background === c ? 'border-ink ring-2 ring-accent/40' : 'border-transparent'
                      )}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <Field label="Letra" htmlFor="st-font">
                <Select id="st-font" value={font} onChange={(e) => setFont(Number(e.target.value))}>
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field
                label={kind === 'imagem' ? 'Foto' : 'Vídeo'}
                htmlFor="st-file"
                error={fileError}
                hint={
                  kind === 'imagem'
                    ? 'JPG, PNG ou WEBP, até 16 MB.'
                    : `MP4 de até ${VIDEO_MAX_SECONDS} segundos e 16 MB.`
                }
              >
                <input
                  id="st-file"
                  type="file"
                  accept={kind === 'imagem' ? 'image/jpeg,image/png,image/webp' : 'video/mp4'}
                  onChange={(e) => void pick(e.target.files?.[0] ?? null)}
                  className="text-[13.5px] text-ink-2 file:mr-3 file:h-9 file:rounded-lg file:border file:border-line-strong file:bg-panel file:px-3 file:text-ink"
                />
              </Field>
              <Field label="Legenda (opcional)" htmlFor="st-cap" hint={`${text.length} de ${CAPTION_MAX} letras`}>
                <Textarea
                  id="st-cap"
                  rows={3}
                  value={text}
                  maxLength={CAPTION_MAX}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Quem vê" htmlFor="st-modo">
            <div className="flex gap-2">
              <Select id="st-modo" value={modo} onChange={(e) => setModo(e.target.value as StatusAudience['modo'])}>
                <option value="todos">Todos os contatos com WhatsApp</option>
                <option value="etiqueta">Só quem tem a etiqueta</option>
                <option value="todos_menos">Todos menos quem tem a etiqueta</option>
              </Select>
              {modo !== 'todos' && (
                <Select aria-label="Etiqueta" value={tagSel} onChange={(e) => setTagSel(e.target.value)}>
                  <option value="">Escolha a etiqueta…</option>
                  {(tags.data ?? []).map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </Field>
          {count.data && !needsTag && (
            <p className="text-[13px] text-ink-2">
              <strong className="tabular text-ink">{count.data.total}</strong> pessoa(s) vão poder ver.
              {count.data.optedOut > 0 && ` ${count.data.optedOut} pediram para não receber e ficam de fora.`}
              {count.data.semWhatsapp > 0 &&
                ` ${count.data.semWhatsapp} ainda não têm WhatsApp confirmado (o app confirma ao enviar uma campanha) e ficam de fora.`}
            </p>
          )}
          {count.data?.large && (
            <Notice tone="warn">
              A lista passa de {count.data.limit} pessoas. O WhatsApp manda a postagem para cada aparelho da lista,
              então ela pode demorar e pesar no celular. Dá para postar mesmo assim; se puder, use uma etiqueta para
              escolher um público menor.
            </Notice>
          )}
          {count.data && count.data.total === 0 && !needsTag && (
            <Notice tone="warn">Ninguém neste público tem WhatsApp confirmado.</Notice>
          )}

          <Field label="Quando" htmlFor="st-when">
            <div className="flex items-center gap-3">
              <Select
                id="st-when-mode"
                aria-label="Quando postar"
                value={schedule ? 'depois' : 'agora'}
                onChange={(e) => setSchedule(e.target.value === 'depois')}
              >
                <option value="agora">Agora</option>
                <option value="depois">Agendar</option>
              </Select>
              {schedule && (
                <Input
                  id="st-when"
                  type="datetime-local"
                  min={minWhen}
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="w-auto"
                />
              )}
            </div>
          </Field>
          {schedule && (
            <p className="text-[13px] text-ink-3">
              O app precisa estar aberto e o WhatsApp conectado na hora marcada. Se estiver desconectado, posta assim
              que conectar (até 24 horas depois).
            </p>
          )}
        </div>
        <div>
          <span className="mb-2 block text-[13px] font-medium text-ink">Prévia</span>
          <Preview kind={kind} text={text} background={background} font={font} fileUrl={fileUrl} />
        </div>
      </div>
    </Drawer>
  )
}

function PostItem({ p, onCancel }: { p: StatusPost; onCancel: () => void }): React.JSX.Element {
  const Icon = KIND_ICON[p.kind]
  const st = STATE[p.status]
  return (
    <li className="flex items-center gap-4 rounded-xl border border-line bg-panel px-5 py-3.5 shadow-card">
      <span
        className="grid size-10 shrink-0 place-items-center rounded-lg text-white"
        style={{ background: p.kind === 'texto' ? (p.background ?? '#128C7E') : 'var(--color-ink-3)' }}
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className="text-[13px] text-ink-2">{audienceLabel(p.audience)}</span>
          {p.recipientsCount != null && (
            <span className="tabular text-[13px] text-ink-3">{p.recipientsCount} pessoa(s)</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[13.5px] text-ink">
          {p.text || (p.kind === 'imagem' ? 'Foto sem legenda' : p.kind === 'video' ? 'Vídeo sem legenda' : '')}
        </p>
        {p.error && <p className="mt-0.5 text-[13px] text-bad">{p.error}</p>}
      </div>
      <span className="tabular shrink-0 text-right text-[12.5px] text-ink-2">
        {p.status === 'enviado' && p.sentAt ? `postado em ${formatDateTime(p.sentAt)}` : formatDateTime(p.scheduledAt)}
      </span>
      {p.status === 'agendado' && (
        <Button size="sm" variant="ghost" aria-label="Cancelar postagem agendada" onClick={onCancel}>
          <X className="size-4" /> Cancelar
        </Button>
      )}
    </li>
  )
}

export function Status(): React.JSX.Element {
  const account = useActiveAccount()
  const states = useApp((s) => s.states)
  const accountId = account?.id ?? ''
  const [creating, setCreating] = useState(false)
  const [limitDraft, setLimitDraft] = useState<string | null>(null)
  const list = useLoad(
    () => (accountId ? window.api.invoke('status:list', { accountId }) : Promise.resolve([])),
    [accountId]
  )
  const settings = useLoad(
    () => (accountId ? window.api.invoke('status:settings', { accountId }) : Promise.resolve(null)),
    [accountId]
  )
  const { error, run } = useAction()
  useEffect(
    () =>
      window.api.on('status:changed', (e) => {
        if (e.accountId !== accountId) return
        void list.reload()
        void settings.reload()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId]
  )
  if (!account) return <Empty icon={<CircleDashed className="size-9" />} title="Crie uma conta primeiro" />
  const connected = states[accountId]?.status === 'connected'

  return (
    <div>
      <PageHeader
        title="Status"
        description="Poste texto, foto ou vídeo no status do WhatsApp da loja, agora ou agendado, para todos os contatos ou só para uma etiqueta."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Novo status
          </Button>
        }
      />
      {!connected && (
        <div className="mb-4">
          <Notice tone="warn">
            O WhatsApp desta conta não está conectado. Dá para agendar; a postagem sai quando conectar.
          </Notice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      {settings.data && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[13.5px] text-ink-2">
          <span>
            Hoje: <strong className="tabular text-ink">{settings.data.postedToday}</strong> de{' '}
            <strong className="tabular text-ink">{settings.data.dailyLimit}</strong> postagens.
          </span>
          <label htmlFor="st-limit" className="ml-2">
            Limite por dia
          </label>
          <Input
            id="st-limit"
            type="number"
            min={1}
            max={50}
            className="w-20"
            value={limitDraft ?? settings.data.dailyLimit}
            onChange={(e) => setLimitDraft(e.target.value)}
          />
          {limitDraft != null && Number(limitDraft) !== settings.data.dailyLimit && (
            <Button
              size="sm"
              onClick={() =>
                void run('limit', () =>
                  window.api.invoke('status:settings-save', {
                    accountId,
                    dailyLimit: Math.max(1, Math.min(50, Math.round(Number(limitDraft) || 1)))
                  })
                ).then(() => {
                  setLimitDraft(null)
                  void settings.reload()
                })
              }
            >
              Salvar
            </Button>
          )}
        </div>
      )}
      {(list.data ?? []).length === 0 && !list.loading ? (
        <Empty icon={<CircleDashed className="size-9" strokeWidth={1.5} />} title="Nenhum status postado">
          Divulgue uma novidade, uma promoção ou o horário especial da loja. O status fica no ar por 24 horas.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {(list.data ?? []).map((p) => (
            <PostItem
              key={p.id}
              p={p}
              onCancel={() =>
                confirm('Cancelar esta postagem agendada?') &&
                void run('c', () => window.api.invoke('status:cancel', { accountId, id: p.id })).then(() =>
                  list.reload()
                )
              }
            />
          ))}
        </ul>
      )}
      {creating && (
        <NewStatus
          accountId={accountId}
          onDone={() => {
            setCreating(false)
            void list.reload()
            void settings.reload()
          }}
        />
      )}
    </div>
  )
}
