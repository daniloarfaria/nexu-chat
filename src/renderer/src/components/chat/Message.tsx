import { memo, useState } from 'react'
import {
  AlertCircle,
  Ban,
  BarChart3,
  Check,
  CheckCheck,
  Clock,
  Contact as ContactIcon,
  Download,
  FileText,
  Forward,
  MapPin,
  Mic,
  Music,
  Pencil,
  Phone,
  Play,
  Reply,
  SmilePlus,
  Trash2,
  CalendarDays,
  Eye
} from 'lucide-react'
import type { MediaInfo, MessageItem } from '@shared/types'
import { cn } from '../../lib/cn'
import { useChatStore } from '../../lib/chatStore'
import { formatBytes } from '../../lib/format'
import { duration, msgTime } from './time'
import { Avatar } from './Avatar'

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏']

function StatusTick({ status }: { status: number }): React.JSX.Element {
  if (status === 0) return <AlertCircle className="size-3.5 text-bad" aria-label="Erro no envio" />
  if (status <= 1) return <Clock className="size-3 text-ink-3" aria-label="Enviando" />
  if (status === 2) return <Check className="size-3.5 text-ink-3" aria-label="Enviada" />
  if (status === 3) return <CheckCheck className="size-3.5 text-ink-3" aria-label="Entregue" />
  return <CheckCheck className="size-3.5 text-info" aria-label="Lida" />
}

/** Carrega a mídia sob demanda (baixa do WhatsApp na primeira vez). */
function useMedia(m: MessageItem): {
  media: MediaInfo | null
  loading: boolean
  error: string | null
  load: () => Promise<MediaInfo | null>
} {
  const accountId = useChatStore((s) => s.accountId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = async (): Promise<MediaInfo | null> => {
    if (m.media?.url) return m.media
    if (!accountId) return null
    setLoading(true)
    setError(null)
    try {
      return await window.api.invoke('media:get', { accountId, jid: m.chatJid, id: m.id })
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }
  return { media: m.media, loading, error, load }
}

function DownloadOverlay({
  loading,
  onClick,
  label
}: {
  loading: boolean
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="absolute inset-0 grid place-items-center bg-black/25 text-white transition-colors hover:bg-black/35"
      aria-label={label}
    >
      <span className="flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12.5px] font-medium backdrop-blur-sm">
        {loading ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : (
          <Download className="size-3.5" />
        )}
        {label}
      </span>
    </button>
  )
}

function Visual({ m }: { m: MessageItem }): React.JSX.Element {
  const { media, loading, error, load } = useMedia(m)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(false)
  const w = media?.width ?? 320
  const h = media?.height ?? 240
  const ratio = Math.min(Math.max(h / w, 0.4), 1.6)
  const isVideo = m.type === 'video' || m.type === 'gif'
  const src = media?.url

  if (media?.viewOnce && !src) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2.5 text-[13px] dark:bg-white/5">
        <Eye className="size-4" /> Visualização única (abra no celular)
      </div>
    )
  }

  return (
    <div className="relative w-[280px] overflow-hidden rounded-lg bg-black/10" style={{ aspectRatio: `1 / ${ratio}` }}>
      {src && !isVideo && (
        <img
          src={src}
          alt={m.text ?? 'Foto'}
          className="size-full cursor-zoom-in object-cover"
          onClick={() => setZoom(true)}
        />
      )}
      {zoom && src && (
        <div
          role="dialog"
          aria-label="Foto ampliada"
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-8"
          onClick={() => setZoom(false)}
          onKeyDown={(e) => e.key === 'Escape' && setZoom(false)}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <img
            src={src}
            alt={m.text ?? 'Foto'}
            className="max-h-full max-w-full rounded-lg object-contain shadow-pop"
          />
        </div>
      )}
      {src && isVideo && (
        <video
          src={src}
          className="size-full bg-black object-contain"
          controls={m.type !== 'gif' || playing}
          autoPlay={m.type === 'gif' || playing}
          loop={m.type === 'gif'}
          muted={m.type === 'gif'}
          playsInline
        />
      )}
      {!src && (
        <>
          {media?.thumb ? (
            <img src={media.thumb} alt="" className="size-full scale-105 object-cover blur-[2px]" />
          ) : (
            <div className="size-full" />
          )}
          <DownloadOverlay
            loading={loading}
            onClick={() => void load().then((r) => r && setPlaying(true))}
            label={
              isVideo ? `Vídeo ${duration(media?.seconds)}`.trim() : media?.size ? formatBytes(media.size) : 'Baixar'
            }
          />
          {isVideo && !loading && (
            <Play className="pointer-events-none absolute top-3 left-3 size-5 text-white drop-shadow" />
          )}
        </>
      )}
      {error && <div className="absolute inset-x-0 bottom-0 bg-bad px-2 py-1 text-[12px] text-white">{error}</div>}
    </div>
  )
}

function Sticker({ m }: { m: MessageItem }): React.JSX.Element {
  const { media, loading, load } = useMedia(m)
  if (media?.url) return <img src={media.url} alt="Figurinha" className="size-36 object-contain" />
  return (
    <button
      onClick={() => void load()}
      className="grid size-36 place-items-center rounded-lg bg-black/5 text-[12.5px] text-ink-2 dark:bg-white/5"
    >
      {loading ? 'Carregando…' : 'Figurinha'}
    </button>
  )
}

function Transcript({ m }: { m: MessageItem }): React.JSX.Element | null {
  const accountId = useChatStore((s) => s.accountId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (m.transcript) {
    return (
      <p
        className="mt-1.5 max-w-[260px] border-t border-black/5 pt-1.5 text-[13px] text-ink-2 italic dark:border-white/10"
        data-selectable
      >
        “{m.transcript}”
      </p>
    )
  }
  if (!accountId) return null
  return (
    <div className="mt-1">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await window.api.invoke('transcribe:message', { accountId, jid: m.chatJid, id: m.id })
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
        className="flex items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline disabled:opacity-60"
      >
        <FileText className="size-3.5" /> {busy ? 'Transcrevendo…' : 'Transcrever'}
      </button>
      {error && <p className="mt-0.5 max-w-[260px] text-[12px] text-bad">{error}</p>}
    </div>
  )
}

function AudioMsg({ m }: { m: MessageItem }): React.JSX.Element {
  const { media, loading, error, load } = useMedia(m)
  const voice = m.type === 'voice'
  return (
    <div>
      {media?.url ? (
        <audio src={media.url} controls preload="metadata" className="h-10 w-[260px]" />
      ) : (
        <button
          onClick={() => void load()}
          className="flex w-[260px] items-center gap-3 rounded-lg bg-black/5 px-3 py-2.5 text-left dark:bg-white/5"
        >
          <span className="grid size-9 place-items-center rounded-full bg-accent text-on-accent">
            {loading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : voice ? (
              <Mic className="size-4" />
            ) : (
              <Music className="size-4" />
            )}
          </span>
          <span className="flex-1 text-[13px]">
            {voice ? 'Mensagem de voz' : 'Áudio'} <span className="tabular text-ink-2">{duration(media?.seconds)}</span>
            {error && <span className="block text-[12px] text-bad">{error}</span>}
          </span>
        </button>
      )}
      <Transcript m={m} />
    </div>
  )
}

function DocumentMsg({ m }: { m: MessageItem }): React.JSX.Element {
  const accountId = useChatStore((s) => s.accountId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const media = m.media
  const ext = media?.fileName?.split('.').pop()?.toUpperCase().slice(0, 4)
  return (
    <div className="w-[280px]">
      <button
        onClick={async () => {
          if (!accountId) return
          setBusy(true)
          setError(null)
          try {
            await window.api.invoke('media:save-as', { accountId, jid: m.chatJid, id: m.id })
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
        className="flex w-full items-center gap-3 rounded-lg bg-black/5 px-3 py-2.5 text-left hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
      >
        <span className="relative grid size-10 shrink-0 place-items-center rounded-md bg-panel text-ink-2">
          <FileText className="size-5" />
          {ext && (
            <span className="absolute -bottom-1 rounded bg-accent px-1 text-[9px] font-bold text-on-accent">{ext}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{media?.fileName ?? 'Documento'}</span>
          <span className="tabular text-[12px] text-ink-2">{media?.size ? formatBytes(media.size) : ''}</span>
        </span>
        {busy ? (
          <span className="size-4 animate-spin rounded-full border-2 border-ink-3/40 border-t-ink-2" />
        ) : (
          <Download className="size-4 text-ink-2" />
        )}
      </button>
      {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
    </div>
  )
}

function LocationMsg({ m }: { m: MessageItem }): React.JSX.Element {
  const l = m.extra?.location
  if (!l) return <span>Localização</span>
  const url = `https://www.google.com/maps?q=${l.lat},${l.lng}`
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex w-[260px] items-center gap-3 rounded-lg bg-black/5 px-3 py-2.5 hover:bg-black/10 dark:bg-white/5"
    >
      <MapPin className="size-5 shrink-0 text-accent" />
      <span className="min-w-0 text-[13px]">
        <span className="block truncate font-medium">
          {l.name ?? (l.live ? 'Localização em tempo real' : 'Localização')}
        </span>
        <span className="tabular block truncate text-ink-2">
          {l.address ?? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`}
        </span>
      </span>
    </a>
  )
}

function ContactMsg({ m }: { m: MessageItem }): React.JSX.Element {
  return (
    <div className="flex w-[260px] flex-col gap-1.5">
      {(m.extra?.contacts ?? []).map((c, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
          <ContactIcon className="size-5 shrink-0 text-ink-2" />
          <span className="min-w-0 text-[13px]">
            <span className="block truncate font-medium">{c.name}</span>
            <span className="tabular block truncate text-ink-2" data-selectable>
              {c.phones.map((p) => '+' + p).join(', ')}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

function PollMsg({ m }: { m: MessageItem }): React.JSX.Element {
  const p = m.extra?.poll
  return (
    <div className="w-[260px]">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <BarChart3 className="size-4 text-accent" /> {p?.name}
      </div>
      <ul className="flex flex-col gap-1">
        {(p?.options ?? []).map((o) => (
          <li key={o} className="rounded-md border border-line px-2.5 py-1.5 text-[13px]">
            {o}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11.5px] text-ink-3">
        {p && p.selectable > 1 ? 'Várias respostas' : 'Uma resposta'} · votos no celular
      </p>
    </div>
  )
}

function Body({ m }: { m: MessageItem }): React.JSX.Element | null {
  if (m.deleted)
    return (
      <span className="flex items-center gap-1.5 text-ink-3 italic">
        <Ban className="size-3.5" /> Mensagem apagada
      </span>
    )
  switch (m.type) {
    case 'image':
    case 'video':
    case 'gif':
      return <Visual m={m} />
    case 'sticker':
      return <Sticker m={m} />
    case 'audio':
    case 'voice':
      return <AudioMsg m={m} />
    case 'document':
      return <DocumentMsg m={m} />
    case 'location':
      return <LocationMsg m={m} />
    case 'contact':
      return <ContactMsg m={m} />
    case 'poll':
      return <PollMsg m={m} />
    case 'event':
      return (
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-accent" /> Evento: {m.text}
        </span>
      )
    case 'call':
      return (
        <span className="flex items-center gap-2 text-ink-2">
          <Phone className="size-4" /> Chamada
        </span>
      )
    case 'unsupported':
      return (
        <span className="text-ink-3 italic">
          Tipo de mensagem não exibido aqui ({m.extra?.label ?? 'desconhecido'}). Veja no celular.
        </span>
      )
    default:
      return null
  }
}

/** Texto com links clicáveis e *negrito* / _itálico_ / ~tachado~ do WhatsApp. */
function RichText({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(https?:\/\/[^\s]+|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p))
          return (
            <a
              key={i}
              href={p}
              target="_blank"
              rel="noreferrer"
              className="break-all text-info underline underline-offset-2"
            >
              {p}
            </a>
          )
        if (/^\*[^*]+\*$/.test(p)) return <b key={i}>{p.slice(1, -1)}</b>
        if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>
        if (/^~[^~]+~$/.test(p)) return <s key={i}>{p.slice(1, -1)}</s>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

export const Message = memo(function Message({
  m,
  showSender,
  isGroup,
  onJump
}: {
  m: MessageItem
  showSender: boolean
  isGroup: boolean
  onJump: (id: string) => void
}): React.JSX.Element {
  const { accountId, setReply, setEditing } = useChatStore()
  const [picker, setPicker] = useState(false)
  const [openedAt] = useState(() => Date.now() / 1000)

  if (m.type === 'system') {
    return (
      <div className="my-1.5 flex justify-center">
        <span className="rounded-md bg-panel/80 px-2.5 py-1 text-[12px] text-ink-2 shadow-card">{m.extra?.label}</span>
      </div>
    )
  }

  const visual = !m.deleted && ['image', 'video', 'gif'].includes(m.type)
  const sticker = !m.deleted && m.type === 'sticker'
  const reactions = m.reactions ? Object.values(m.reactions) : []
  const grouped = reactions.reduce<Record<string, number>>((acc, e) => ((acc[e] = (acc[e] ?? 0) + 1), acc), {})
  const canEdit = m.fromMe && m.type === 'text' && !m.deleted && openedAt - m.ts < 15 * 60

  async function act(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        'group flex px-[6%]',
        m.fromMe ? 'justify-end' : 'justify-start',
        reactions.length ? 'mb-4' : 'mb-1'
      )}
    >
      {/* Grupos: foto de quem mandou na primeira mensagem da sequência (como no WhatsApp) */}
      {isGroup && !m.fromMe && (
        <div className="mr-1.5 w-7 shrink-0 self-start pt-0.5">
          {showSender && m.sender && <Avatar id={m.sender} name={m.senderName ?? ''} size={28} />}
        </div>
      )}
      <div className={cn('relative flex max-w-[min(560px,78%)] items-start gap-1', m.fromMe && 'flex-row-reverse')}>
        <div
          className={cn(
            'relative rounded-xl text-[14.5px] leading-[1.45] shadow-card',
            sticker ? 'bg-transparent shadow-none' : m.fromMe ? 'bg-accent-soft' : 'bg-panel',
            visual || sticker ? 'p-1' : 'px-3 py-1.5'
          )}
          data-selectable
        >
          {showSender && isGroup && !m.fromMe && (
            <div
              className={cn(
                'mb-0.5 truncate text-[12.5px] font-semibold text-accent-ink',
                (visual || sticker) && 'px-2 pt-1'
              )}
            >
              {m.senderName ?? 'Participante'}
            </div>
          )}
          {m.extra?.forwarded && (
            <div className={cn('mb-0.5 flex items-center gap-1 text-[12px] text-ink-3 italic', visual && 'px-2 pt-1')}>
              <Forward className="size-3" /> Encaminhada
            </div>
          )}
          {m.extra?.quoted && (
            <button
              onClick={() => onJump(m.extra!.quoted!.id)}
              className={cn(
                'mb-1 block w-full rounded-md border-l-2 border-accent bg-black/5 px-2 py-1 text-left text-[12.5px] dark:bg-white/5',
                visual && 'mx-1 mt-1 w-[calc(100%-8px)]'
              )}
            >
              <span className="block truncate font-semibold text-accent-ink">
                {m.extra.quoted.fromMe ? 'Você' : (m.extra.quoted.senderName ?? 'Contato')}
              </span>
              <span className="line-clamp-2 text-ink-2">{m.extra.quoted.text || 'Mensagem'}</span>
            </button>
          )}
          <Body m={m} />
          {m.text && !m.deleted && m.type !== 'poll' && m.type !== 'event' && (
            <p
              className={cn(
                'break-words whitespace-pre-wrap',
                visual && 'px-2 pt-1.5 pb-0.5',
                m.type === 'location' && 'mt-1'
              )}
            >
              <RichText text={m.text} />
            </p>
          )}
          <div
            className={cn(
              'flex items-center justify-end gap-1 text-[11px] text-ink-3',
              visual ? 'px-2 pb-1' : sticker ? 'rounded bg-black/40 px-1.5 text-white' : '-mb-0.5'
            )}
          >
            {m.edited && <span>editada</span>}
            <span className="tabular">{msgTime(m.ts)}</span>
            {m.fromMe && !m.deleted && <StatusTick status={m.status} />}
          </div>
          {reactions.length > 0 && (
            <div
              className={cn(
                'absolute -bottom-3.5 flex items-center gap-0.5 rounded-full border border-line bg-panel px-1.5 py-0.5 text-[12px] shadow-card',
                m.fromMe ? 'right-2' : 'left-2'
              )}
              title={reactions.join(' ')}
            >
              {Object.entries(grouped).map(([e, n]) => (
                <span key={e}>
                  {e}
                  {n > 1 && <span className="tabular ml-0.5 text-ink-2">{n}</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Ações ao passar o mouse */}
        {!m.deleted && accountId && (
          <div className="relative flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              aria-label="Reagir"
              onClick={() => setPicker((v) => !v)}
              className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-ink"
            >
              <SmilePlus className="size-4" />
            </button>
            <button
              aria-label="Responder"
              onClick={() => setReply(m)}
              className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-ink"
            >
              <Reply className="size-4" />
            </button>
            {canEdit && (
              <button
                aria-label="Editar"
                onClick={() => setEditing(m)}
                className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-ink"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            {m.fromMe && (
              <button
                aria-label="Apagar para todos"
                onClick={() => {
                  if (confirm('Apagar esta mensagem para todos?'))
                    void act(() => window.api.invoke('messages:delete', { accountId, jid: m.chatJid, id: m.id }))
                }}
                className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-panel hover:text-bad"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            {picker && (
              <div
                className={cn(
                  'absolute bottom-9 z-20 flex gap-0.5 rounded-full border border-line bg-panel p-1 shadow-pop',
                  m.fromMe ? 'right-0' : 'left-0'
                )}
              >
                {QUICK.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      setPicker(false)
                      void act(() =>
                        window.api.invoke('messages:react', { accountId, jid: m.chatJid, id: m.id, emoji: e })
                      )
                    }}
                    className="grid size-8 place-items-center rounded-full text-[18px] transition-transform hover:scale-125"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
