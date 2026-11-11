import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, FolderOpen, Mic } from 'lucide-react'
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
  useEffect(() => {
    let alive = true
    void window.api.invoke('transcribe:status').then((s) => alive && setSt(s))
    return () => {
      alive = false
    }
  }, [])
  if (!st) return <div className="h-40 animate-pulse rounded-xl bg-sunken" />
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
            : 'Encontre os 3 itens abaixo para transcrever sem enviar áudio para fora.'
        }
      >
        <ul className="-my-1 divide-y divide-line">
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
