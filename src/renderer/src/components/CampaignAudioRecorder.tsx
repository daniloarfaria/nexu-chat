import { useEffect, useRef, useState } from 'react'
import { Mic, Square, X } from 'lucide-react'
import { Button } from './ui'

/** Captura apenas; quem chama decide quando salvar/enviar a gravação. */
export function CampaignAudioRecorder({
  onRecorded,
  disabled,
  onStateChange
}: {
  onRecorded: (file: File) => void
  disabled?: boolean
  onStateChange?: (recording: boolean) => void
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<{ recorder: MediaRecorder; chunks: Blob[]; discard: boolean } | null>(null)
  const mounted = useRef(true)
  const stateChange = useRef(onStateChange)
  useEffect(() => {
    stateChange.current = onStateChange
  }, [onStateChange])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const current = active.current
      if (current) {
        current.discard = true
        if (current.recorder.state !== 'inactive') current.recorder.stop()
        current.recorder.stream.getTracks().forEach((track) => track.stop())
      }
      stateChange.current?.(false)
    }
  }, [])
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])

  async function start(): Promise<void> {
    setError(null)
    setRequesting(true)
    stateChange.current?.(true)
    let stream: MediaStream | undefined
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find((type) =>
        MediaRecorder.isTypeSupported(type)
      )
      if (!mime)
        throw new Error('Este computador não suporta gravação Opus. Anexe um áudio pelo botão Escolher arquivo.')
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
      const current = { recorder, chunks: [] as Blob[], discard: false }
      active.current = current
      recorder.ondataavailable = (event) => {
        if (event.data.size) current.chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream!.getTracks().forEach((track) => track.stop())
        active.current = null
        if (!mounted.current) return
        setRecording(false)
        stateChange.current?.(false)
        if (!current.discard) {
          const blob = new Blob(current.chunks, { type: mime })
          if (blob.size)
            onRecorded(new File([blob], `gravacao.${mime.startsWith('audio/ogg') ? 'ogg' : 'webm'}`, { type: mime }))
          else setError('A gravação ficou vazia. Grave novamente.')
        }
      }
      recorder.onerror = () => {
        current.discard = true
        setError('Não foi possível concluir a gravação. Grave novamente.')
        if (recorder.state !== 'inactive') recorder.stop()
      }
      recorder.start(1000)
      setSeconds(0)
      setRecording(true)
      stateChange.current?.(true)
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop())
      if (mounted.current)
        setError(
          reason instanceof Error && reason.message.includes('Opus')
            ? reason.message
            : 'Não foi possível usar o microfone. Verifique a permissão nas configurações do sistema e tente novamente.'
        )
    } finally {
      if (mounted.current) {
        setRequesting(false)
        if (!active.current) stateChange.current?.(false)
      }
    }
  }
  function stop(discard: boolean): void {
    if (!active.current) return
    active.current.discard = discard
    active.current.recorder.stop()
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <>
            <span role="status" className="tabular text-[13px] text-bad">
              Gravando {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
            <Button size="sm" onClick={() => stop(false)}>
              <Square className="size-4" /> Concluir gravação
            </Button>
            <Button size="sm" variant="ghost" onClick={() => stop(true)}>
              <X className="size-4" /> Cancelar
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={disabled || requesting} onClick={() => void start()}>
            <Mic className="size-4" /> {requesting ? 'Abrindo microfone…' : 'Gravar áudio'}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
