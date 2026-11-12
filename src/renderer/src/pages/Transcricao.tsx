import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Download, FolderOpen, LoaderCircle, Mic } from 'lucide-react'
import type { TranscribeStatus } from '@shared/types'
import { Button, Notice, Section } from '../components/ui'
import { cn } from '../lib/cn'

const MODES = [
  { id: 'manual', label: 'Botão "Transcrever"', desc: 'Você transcreve o áudio que quiser, na conversa.' },
  { id: 'auto', label: 'Automático', desc: 'Toda mensagem de voz recebida é transcrita sozinha.' },
  { id: 'off', label: 'Desligado', desc: 'Nem o playbook da IA usa os áudios.' }
] as const

const ENGINES = [
  {
    id: 'auto',
    label: 'Automático',
    desc: 'Usa o Whisper do computador; se não houver, a Groq (quando a privacidade deixar).'
  },
  { id: 'local', label: 'Só no computador', desc: 'O áudio nunca sai daqui (precisa do Whisper instalado).' },
  {
    id: 'groq',
    label: 'Só Groq',
    desc: 'Whisper na nuvem: o áudio sai do computador. Não vale na privacidade Estrita.'
  }
] as const

const GROQ_BLOCKED: Record<NonNullable<TranscribeStatus['groqBlocked']>, string> = {
  'sem-clientes': 'a Groq está com "usar em conversas de clientes" desligado em Assistente de IA → Provedores',
  estrita: 'a privacidade Estrita (Assistente de IA → Provedores) não deixa o áudio sair do computador',
  treina: 'a Groq está marcada como "pode treinar com os dados"'
}

function Item({
  ok,
  label,
  value,
  onPick
}: {
  ok: boolean
  label: string
  value: string | null
  onPick: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {ok ? (
        <CheckCircle2 className="size-4 shrink-0 text-ok" />
      ) : (
        <CircleAlert className="size-4 shrink-0 text-warn" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{label}</div>
        <div className="truncate text-[12px] text-ink-3" data-selectable title={value ?? undefined}>
          {value ?? 'não encontrado'}
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onPick}>
        <FolderOpen className="size-4" /> Escolher
      </Button>
    </li>
  )
}

export function Transcricao(): React.JSX.Element {
  const [st, setSt] = useState<TranscribeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void window.api
        .invoke('transcribe:status')
        .then((s) => {
          if (alive) setSt(s)
        })
        .catch((e) => {
          if (alive) setError(String(e))
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  if (!st)
    return error ? <Notice tone="warn">{error}</Notice> : <div className="h-40 animate-pulse rounded-xl bg-sunken" />
  const installAction = (channel: 'transcribe:install' | 'transcribe:cancel'): void => {
    setError(null)
    void window.api
      .invoke(channel)
      .then(setSt)
      .catch((e) => setError(String(e)))
  }
  const mb = (bytes: number): string => `${Math.ceil(bytes / 1_000_000)} MB`
  const save = (p: Parameters<typeof window.api.invoke<'transcribe:save'>>[1]): void =>
    void window.api.invoke('transcribe:save', p).then(setSt)
  const pick = (what: 'whisper' | 'model' | 'ffmpeg'): void =>
    void window.api.invoke('transcribe:pick', { what }).then(setSt)

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={<Mic className="size-4" />}>
        Os áudios transcritos aparecem como texto embaixo de cada mensagem de voz, entram na busca e dão contexto para a
        IA nas sugestões de resposta e no playbook de vendas.
      </Notice>
      <Section title="Quando transcrever">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              aria-pressed={st.settings.mode === m.id}
              onClick={() => save({ mode: m.id })}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-3 text-left',
                st.settings.mode === m.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
              )}
            >
              <span className="text-[14px] font-medium">{m.label}</span>
              <span className="text-[12px] text-ink-2">{m.desc}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Onde transcrever">
        <div className="grid grid-cols-3 gap-2">
          {ENGINES.map((m) => (
            <button
              key={m.id}
              aria-pressed={st.settings.engine === m.id}
              onClick={() => save({ engine: m.id })}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-3 text-left',
                st.settings.engine === m.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
              )}
            >
              <span className="text-[14px] font-medium">{m.label}</span>
              <span className="text-[12px] text-ink-2">{m.desc}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section
        title="Whisper no computador"
        description={
          st.local.ready
            ? 'Pronto: os áudios são transcritos aqui, sem internet.'
            : 'Baixe e configure a voz para transcrever neste computador. A internet é necessária apenas na instalação.'
        }
      >
        {!st.local.ready && !st.install.running && (
          <div className="mb-3 flex flex-col items-start gap-2">
            <Button disabled={!st.install.supported} onClick={() => installAction('transcribe:install')}>
              <Download className="size-4" /> Baixar e configurar
            </Button>
            <p className="text-[12px] text-ink-2">
              {st.install.supported
                ? `Download de até ${mb(st.install.downloadBytes)}. Os componentes já encontrados serão aproveitados.`
                : 'Instalação automática indisponível neste instalador ou sistema. Atualize o Nexu Chat ou use as opções avançadas.'}
            </p>
          </div>
        )}
        {st.install.running && (
          <div className="mb-3 flex flex-col gap-2" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-[13px]">
              <LoaderCircle className="size-4 animate-spin" /> {st.install.label}
              <Button size="sm" variant="ghost" onClick={() => installAction('transcribe:cancel')}>
                Cancelar
              </Button>
            </div>
            {st.install.total > 0 && (
              <>
                <progress
                  className="h-2 w-full accent-accent"
                  value={st.install.received}
                  max={st.install.total}
                  aria-label={st.install.label}
                />
                <span className="text-[12px] text-ink-2">
                  {mb(st.install.received)} de {mb(st.install.total)}
                </span>
              </>
            )}
          </div>
        )}
        {(error || st.install.error) && (
          <div className="mb-3">
            <Notice tone="warn">{error || st.install.error}</Notice>
          </div>
        )}
        {!st.install.running && st.install.label && !st.install.error && (
          <p className="mb-3 text-[12px] text-ink-2" role="status">
            {st.install.label}
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-[13px] text-ink-2">
            Opções avançadas: escolher arquivos manualmente
          </summary>
          <ul className="mt-2 divide-y divide-line">
            <Item
              ok={!!st.local.whisper}
              label="Programa whisper-cli (whisper.cpp)"
              value={st.local.whisper}
              onPick={() => pick('whisper')}
            />
            <Item
              ok={!!st.local.model}
              label="Modelo (ggml-small.bin recomendado)"
              value={st.local.model}
              onPick={() => pick('model')}
            />
            <Item
              ok={!!st.local.ffmpeg}
              label="ffmpeg (converte o áudio do WhatsApp)"
              value={st.local.ffmpeg}
              onPick={() => pick('ffmpeg')}
            />
          </ul>
        </details>
      </Section>
      <Section title="Whisper da Groq (nuvem)">
        <p className="text-[13.5px] text-ink-2">
          {st.groq ? (
            <>
              Disponível: usa a chave da Groq cadastrada no Assistente de IA. O áudio do cliente é enviado para a Groq
              como está (áudio não é anonimizado).
            </>
          ) : st.groqBlocked ? (
            <>
              Bloqueado pela privacidade: {GROQ_BLOCKED[st.groqBlocked]}. Nenhum áudio é enviado para a Groq.{' '}
              {st.local.ready
                ? 'Os áudios são transcritos no computador.'
                : 'Sem o Whisper no computador, os áudios ficam sem transcrição.'}
            </>
          ) : (
            <>Cadastre a Groq em Assistente de IA → Provedores (gratuito) para transcrever sem instalar nada.</>
          )}
        </p>
      </Section>
    </div>
  )
}
