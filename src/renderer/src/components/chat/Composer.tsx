import { useEffect, useRef, useState } from 'react'
import {
  BarChart3,
  Contact,
  FileText,
  Image as ImageIcon,
  MapPin,
  Mic,
  Paperclip,
  Pencil,
  Reply,
  Send,
  Sparkles,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { useChatStore } from '../../lib/chatStore'
import { useActiveAccount } from '../../lib/store'
import { cn } from '../../lib/cn'
import { Button, Input } from '../ui'

type Extra = 'location' | 'contact' | 'poll' | null

async function toOutgoing(f: File): Promise<{ name: string; mime: string; data: Uint8Array }> {
  return { name: f.name, mime: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) }
}

function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(`draft:${key}`) ?? ''
  } catch {
    return ''
  }
}

/** O componente é recriado (key) ao trocar de conversa ou entrar em edição, zerando o estado. */
export function Composer({ jid, disabled }: { jid: string; disabled?: string | null }): React.JSX.Element {
  const editingId = useChatStore((s) => s.editing?.id ?? '')
  const accountId = useChatStore((s) => s.accountId ?? '')
  return <ComposerInner key={`${accountId}|${jid}|${editingId}`} jid={jid} disabled={disabled} />
}

function ComposerInner({ jid, disabled }: { jid: string; disabled?: string | null }): React.JSX.Element {
  const { accountId, replyTo, editing, setReply, setEditing } = useChatStore()
  const iaOn = !!useActiveAccount()?.modules.ia
  const [suggesting, setSuggesting] = useState(false)

  async function suggest(): Promise<void> {
    if (!accountId) return
    setSuggesting(true)
    setError(null)
    try {
      const r = await window.api.invoke('ai:suggest', { accountId, jid })
      setText(r.text)
      ta.current?.focus()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSuggesting(false)
    }
  }
  const [text, setText] = useState(() => (editing ? (editing.text ?? '') : readDraft(`${accountId}|${jid}`)))
  const [files, setFiles] = useState<File[]>([])
  const [asDocument, setAsDocument] = useState(false)
  const [menu, setMenu] = useState(false)
  const [extra, setExtra] = useState<Extra>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<{ recorder: MediaRecorder; chunks: Blob[] } | null>(null)
  const mounted = useRef(true)
  const [recStart, setRecStart] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const docInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ta.current?.focus()
  }, [replyTo])
  // Ao trocar de conversa ou sair da tela no meio de uma gravação: desliga o microfone
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const cur = recRef.current
      if (cur) {
        cur.recorder.stream.getTracks().forEach((t) => t.stop())
        if (cur.recorder.state !== 'inactive') cur.recorder.stop()
        recRef.current = null
      }
    }
  }, [])
  useEffect(() => {
    if (editing) return
    try {
      sessionStorage.setItem(`draft:${accountId}|${jid}`, text)
    } catch {
      /* ignora */
    }
  }, [accountId, jid, text, editing])
  useEffect(() => {
    if (recStart == null) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [recStart])

  // Colar imagens e arrastar arquivos para a conversa
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const fs = [...(e.clipboardData?.files ?? [])]
      if (fs.length) {
        e.preventDefault()
        setFiles((cur) => [...cur, ...fs])
      }
    }
    const onDrop = (e: DragEvent): void => {
      const fs = [...(e.dataTransfer?.files ?? [])]
      if (fs.length) {
        e.preventDefault()
        setFiles((cur) => [...cur, ...fs])
      }
    }
    const onDragOver = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('paste', onPaste)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [])

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submit(): Promise<void> {
    if (!accountId || busy) return
    const body = text.trim()
    if (editing) {
      if (!body) return
      if (await run(() => window.api.invoke('messages:edit', { accountId, jid, id: editing.id, text: body }))) {
        setText('')
        setEditing(null)
      }
      return
    }
    if (files.length) {
      const ok = await run(async () => {
        for (let i = 0; i < files.length; i++) {
          await window.api.invoke('messages:send-file', {
            accountId,
            jid,
            file: await toOutgoing(files[i]),
            caption: i === 0 ? body || undefined : undefined,
            asDocument,
            quotedId: i === 0 ? (replyTo?.id ?? null) : null
          })
        }
      })
      if (ok) {
        setFiles([])
        setText('')
        setAsDocument(false)
        setReply(null)
      }
      return
    }
    if (!body) return
    if (
      await run(() =>
        window.api.invoke('messages:send-text', { accountId, jid, text: body, quotedId: replyTo?.id ?? null })
      )
    ) {
      setText('')
      setReply(null)
    }
  }

  async function startRec(): Promise<void> {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 })
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      recorder.start()
      recRef.current = { recorder, chunks }
      const t = Date.now()
      setRecStart(t)
      setNow(t)
    } catch {
      setError('Não foi possível usar o microfone. Verifique a permissão nas configurações do sistema.')
    }
  }

  function stopRec(send: boolean): void {
    const cur = recRef.current
    if (!cur) return
    const { recorder, chunks } = cur
    recorder.addEventListener('stop', async () => {
      recorder.stream.getTracks().forEach((t) => t.stop())
      if (!send || !accountId) return
      const blob = new Blob(chunks, { type: 'audio/webm' })
      await run(async () =>
        window.api.invoke('messages:send-file', {
          accountId,
          jid,
          file: { name: 'voz.webm', mime: 'audio/webm', data: new Uint8Array(await blob.arrayBuffer()) },
          voice: true,
          quotedId: replyTo?.id ?? null
        })
      )
      setReply(null)
    })
    recorder.stop()
    recRef.current = null
    setRecStart(null)
  }

  if (disabled) {
    return (
      <div className="border-t border-line bg-panel px-6 py-4 text-center text-[13.5px] text-ink-2">{disabled}</div>
    )
  }

  const banner = replyTo ?? editing
  const rec = recStart != null
  const secs = recStart != null ? Math.max(0, Math.floor((now - recStart) / 1000)) : 0
  const attach: Array<{ icon: typeof ImageIcon; label: string; kind: 'img' | 'doc' | NonNullable<Extra> }> = [
    { icon: ImageIcon, label: 'Fotos e vídeos', kind: 'img' },
    { icon: FileText, label: 'Documento', kind: 'doc' },
    { icon: MapPin, label: 'Localização', kind: 'location' },
    { icon: Contact, label: 'Contato', kind: 'contact' },
    { icon: BarChart3, label: 'Enquete', kind: 'poll' }
  ]
  function pick(kind: (typeof attach)[number]['kind']): void {
    setMenu(false)
    if (kind === 'img') imgInput.current?.click()
    else if (kind === 'doc') docInput.current?.click()
    else setExtra(kind)
  }

  return (
    <div className="border-t border-line bg-panel">
      {banner && (
        <div className="flex items-center gap-3 border-b border-line px-4 py-2">
          {editing ? <Pencil className="size-4 text-accent" /> : <Reply className="size-4 text-accent" />}
          <div className="min-w-0 flex-1 border-l-2 border-accent pl-2.5 text-[13px]">
            <div className="font-semibold text-accent-ink">
              {editing ? 'Editando mensagem' : banner.fromMe ? 'Você' : (banner.senderName ?? 'Contato')}
            </div>
            <div className="truncate text-ink-2">{banner.text ?? 'Mídia'}</div>
          </div>
          <button
            aria-label="Cancelar"
            onClick={() => {
              setReply(null)
              if (editing) {
                setEditing(null)
                setText('')
              }
            }}
            className="text-ink-3 hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2.5">
          {files.map((f, i) => (
            <span
              key={i}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-sunken py-1.5 pr-1.5 pl-2.5 text-[12.5px]"
            >
              {f.type.startsWith('image/') ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
              <span className="max-w-[180px] truncate">{f.name || 'imagem colada'}</span>
              <button
                aria-label={`Remover ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="text-ink-3 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <label className="ml-auto flex shrink-0 items-center gap-2 text-[12.5px] text-ink-2">
            <input
              type="checkbox"
              checked={asDocument}
              onChange={(e) => setAsDocument(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Enviar como documento (sem compressão)
          </label>
        </div>
      )}

      {extra && <ExtraForm kind={extra} jid={jid} onClose={() => setExtra(null)} />}

      {error && (
        <p className="px-4 pt-2 text-[12.5px] text-bad" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2 px-3 py-2.5">
        {rec ? (
          <div className="flex h-10 flex-1 items-center gap-3 rounded-xl bg-bad-soft px-4">
            <span className="size-2.5 animate-pulse rounded-full bg-bad" />
            <span className="tabular text-[14px]">
              Gravando {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
            </span>
            <button
              onClick={() => stopRec(false)}
              className="ml-auto flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-bad"
            >
              <Trash2 className="size-4" /> Descartar
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Button
                variant="ghost"
                aria-label="Anexar"
                aria-expanded={menu}
                onClick={() => setMenu((v) => !v)}
                className="size-10 px-0"
              >
                <Paperclip className="size-5" />
              </Button>
              {menu && (
                <div
                  className="absolute bottom-12 left-0 z-20 w-56 rounded-xl border border-line bg-panel py-1.5 shadow-pop"
                  onMouseLeave={() => setMenu(false)}
                >
                  {attach.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => pick(it.kind)}
                      className="flex w-full items-center gap-3 px-3.5 py-2 text-[14px] hover:bg-sunken"
                    >
                      <it.icon className="size-4 text-ink-2" /> {it.label}
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={imgInput}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  setFiles((c) => [...c, ...(e.target.files ?? [])])
                  setAsDocument(false)
                  e.target.value = ''
                }}
              />
              <input
                ref={docInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  setFiles((c) => [...c, ...(e.target.files ?? [])])
                  setAsDocument(true)
                  e.target.value = ''
                }}
              />
            </div>
            {iaOn && !jid.endsWith('@g.us') && (
              <Button
                variant="ghost"
                aria-label="Sugerir resposta com IA"
                title="Sugerir resposta com IA (você revisa antes de enviar)"
                loading={suggesting}
                onClick={() => void suggest()}
                className="size-10 px-0"
              >
                {!suggesting && <Sparkles className="size-5 text-accent" />}
              </Button>
            )}
            <textarea
              ref={ta}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void submit()
                }
                if (e.key === 'Escape') {
                  setReply(null)
                  setEditing(null)
                }
              }}
              placeholder={files.length ? 'Legenda (opcional)' : 'Digite uma mensagem'}
              aria-label="Mensagem"
              className="max-h-[180px] min-h-10 flex-1 resize-none [field-sizing:content] rounded-xl border border-line bg-sunken px-3.5 py-2 text-[14.5px] leading-[1.45] placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </>
        )}
        {text.trim() || files.length || editing ? (
          <Button
            variant="primary"
            aria-label="Enviar"
            onClick={() => void submit()}
            loading={busy}
            className="size-10 rounded-full px-0"
          >
            {!busy && <Send className="size-[18px]" />}
          </Button>
        ) : rec ? (
          <Button
            variant="primary"
            aria-label="Enviar mensagem de voz"
            onClick={() => stopRec(true)}
            className="size-10 rounded-full px-0"
          >
            <Send className="size-[18px]" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            aria-label="Gravar mensagem de voz"
            onClick={() => void startRec()}
            loading={busy}
            className={cn('size-10 rounded-full px-0')}
          >
            {!busy && <Mic className="size-5" />}
          </Button>
        )}
      </div>
      {rec && (
        <button onClick={() => stopRec(false)} className="sr-only">
          <Square /> Parar
        </button>
      )}
    </div>
  )
}

function ExtraForm({
  kind,
  jid,
  onClose
}: {
  kind: NonNullable<Extra>
  jid: string
  onClose: () => void
}): React.JSX.Element {
  const accountId = useChatStore((s) => s.accountId)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [opts, setOpts] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!accountId) return
    setBusy(true)
    setError(null)
    try {
      if (kind === 'location') {
        const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(a)
        if (!m) throw new Error('Cole as coordenadas no formato -23.5505, -46.6333 (copie do Google Maps)')
        await window.api.invoke('messages:send-location', {
          accountId,
          jid,
          lat: Number(m[1]),
          lng: Number(m[2]),
          name: b || undefined
        })
      } else if (kind === 'contact') {
        await window.api.invoke('messages:send-contact', { accountId, jid, name: a, phone: b })
      } else {
        await window.api.invoke('messages:send-poll', {
          accountId,
          jid,
          name: a,
          options: opts.map((o) => o.trim()).filter(Boolean),
          multiple: multi
        })
      }
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2.5 border-b border-line bg-sunken px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] font-semibold">
          {kind === 'location' ? 'Enviar localização' : kind === 'contact' ? 'Enviar contato' : 'Criar enquete'}
        </span>
        <button type="button" aria-label="Fechar" onClick={onClose} className="text-ink-3 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      {kind === 'location' && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            autoFocus
            placeholder="Coordenadas: -23.5505, -46.6333"
            value={a}
            onChange={(e) => setA(e.target.value)}
            aria-label="Coordenadas"
          />
          <Input
            placeholder="Nome do local (opcional)"
            value={b}
            onChange={(e) => setB(e.target.value)}
            aria-label="Nome do local"
          />
        </div>
      )}
      {kind === 'contact' && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            autoFocus
            placeholder="Nome"
            value={a}
            onChange={(e) => setA(e.target.value)}
            aria-label="Nome do contato"
          />
          <Input
            placeholder="Telefone com DDD"
            inputMode="tel"
            value={b}
            onChange={(e) => setB(e.target.value)}
            aria-label="Telefone do contato"
          />
        </div>
      )}
      {kind === 'poll' && (
        <>
          <Input
            autoFocus
            placeholder="Pergunta"
            value={a}
            onChange={(e) => setA(e.target.value)}
            aria-label="Pergunta da enquete"
          />
          {opts.map((o, i) => (
            <Input
              key={i}
              placeholder={`Opção ${i + 1}`}
              value={o}
              aria-label={`Opção ${i + 1}`}
              onChange={(e) => {
                const n = [...opts]
                n[i] = e.target.value
                if (i === n.length - 1 && e.target.value && n.length < 12) n.push('')
                setOpts(n)
              }}
            />
          ))}
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={multi}
              onChange={(e) => setMulti(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Permitir várias respostas
          </label>
        </>
      )}
      {error && <p className="text-[12.5px] text-bad">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} className="self-end">
        Enviar
      </Button>
    </form>
  )
}
