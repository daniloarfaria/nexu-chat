import { useEffect, useState } from 'react'
import { Cloud, Cpu, ExternalLink, HardDrive, MemoryStick, ShieldCheck, Trash2 } from 'lucide-react'
import type { LocalAiProgress, LocalAiStatus } from '@shared/types'
import { useAction, useLoad } from '../../lib/useAsync'
import { Badge, Button, Drawer, Field, Input, Notice } from '../../components/ui'
import { cn } from '../../lib/cn'

const GROQ_KEYS = 'https://console.groq.com/keys'

const mb = (n: number): string =>
  n >= 1024 ? `${(n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB` : `${Math.round(n)} MB`

function Progress({ p }: { p: LocalAiProgress }): React.JSX.Element {
  const pct = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[13px]">
        <span>{p.label}…</span>
        {pct != null && (
          <span className="tabular text-ink-2">
            {mb(p.received / 1024 ** 2)} de {mb(p.total / 1024 ** 2)} · {pct}%
          </span>
        )}
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-label={p.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <div
          className={cn(
            'h-full rounded-full bg-accent transition-[width] duration-300',
            pct == null && 'animate-pulse'
          )}
          style={{ width: `${pct ?? 100}%` }}
        />
      </div>
    </div>
  )
}

function Card({
  icon,
  title,
  badge,
  children
}: {
  icon: React.ReactNode
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-line p-4">
      <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
        {icon} {title} {badge}
      </h3>
      <div className="flex flex-col gap-3 text-[13.5px] text-ink-2">{children}</div>
    </section>
  )
}

function LocalCard({ st, onChange }: { st: LocalAiStatus; onChange: () => void }): React.JSX.Element {
  const [progress, setProgress] = useState<LocalAiProgress | null>(st.installing)
  const { busy, error, run } = useAction()
  useEffect(() => window.api.on('ai:local-progress', (p) => setProgress(p)), [])
  const rec = st.recommendation
  const light = st.models.find((m) => m.tier === 'leve')
  const medium = st.models.find((m) => m.tier === 'medio')
  const installed = st.engineInstalled && !!light?.installed
  const install = (tier: 'leve' | 'medio'): void =>
    void run(tier, () => window.api.invoke('ai:local-install', { tier })).then(onChange)

  return (
    <Card
      icon={<ShieldCheck className="size-4 text-accent" />}
      title="IA no computador"
      badge={
        installed ? (
          <Badge tone="ok">instalada</Badge>
        ) : rec.primary === 'ambas' ? (
          <Badge tone="accent">recomendada</Badge>
        ) : null
      }
    >
      <p>
        Privada e grátis: as conversas não saem deste computador e funciona sem internet. Fica para as tarefas rápidas
        (entender o que o cliente quer, etiquetar, tirar datas). As tarefas maiores vão para a nuvem.
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {!rec.localSupported ? (
        <Notice tone="warn">Este sistema ainda não tem a IA no computador. Use a IA gratuita na nuvem.</Notice>
      ) : progress ? (
        <>
          <Progress p={progress} />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void window.api.invoke('ai:local-cancel')}>
              Parar download
            </Button>
            <span className="text-[12.5px] text-ink-3">O que já baixou fica guardado e continua de onde parou.</span>
          </div>
        </>
      ) : installed ? (
        <>
          <p className="text-ink">
            {light?.name} · {st.running ? 'trabalhando agora' : 'desligada (não gasta memória até ser usada)'} · ocupa{' '}
            {mb(st.diskUsedMb)} no disco
          </p>
          {medium?.offered && (
            <div className="rounded-lg bg-sunken p-3">
              <p className="mb-2 text-ink">
                <b>Modelo médio (opcional).</b> Escreve melhor, mas usa cerca de 3 GB de memória enquanto trabalha e
                baixa {mb(medium.sizeMb)}. Só aparece porque este computador tem 16 GB ou mais.
              </p>
              {st.mediumEnabled ? (
                <Button
                  size="sm"
                  loading={busy === 'off'}
                  onClick={() => void run('off', () => window.api.invoke('ai:local-medium-off')).then(onChange)}
                >
                  Desligar e apagar o modelo médio
                </Button>
              ) : (
                <Button size="sm" loading={busy === 'medio'} onClick={() => install('medio')}>
                  Baixar e ligar o modelo médio
                </Button>
              )}
            </div>
          )}
          <div>
            <Button
              variant="danger"
              size="sm"
              loading={busy === 'rm'}
              onClick={() =>
                confirm('Remover a IA do computador? Os arquivos baixados serão apagados.') &&
                void run('rm', () => window.api.invoke('ai:local-remove')).then(onChange)
              }
            >
              <Trash2 className="size-4" /> Remover IA local
            </Button>
          </div>
        </>
      ) : (
        <>
          {!rec.localRecommended && (
            <Notice tone="warn">Não recomendado neste computador. Se instalar mesmo assim, pode ficar lento.</Notice>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant={rec.localRecommended ? 'primary' : 'secondary'}
              loading={busy === 'leve'}
              onClick={() => install('leve')}
            >
              Instalar IA no computador
            </Button>
            <span className="text-[12.5px] text-ink-3">
              Baixa cerca de {mb((light?.sizeMb ?? 0) + 20)}. Não pede senha de administrador.
            </span>
          </div>
        </>
      )}
      {rec.localSupported && (
        <p className="text-[12.5px] text-ink-3">
          {rec.slowWarning ? 'Este computador é mais simples: a IA local vai responder devagar. ' : ''}
          Em computador fraco a IA local responde devagar. Para o robô de atendimento, o melhor é a nuvem com a local de
          reserva.
        </p>
      )}
    </Card>
  )
}

function CloudCard({
  groqId,
  hasGroq,
  onChange
}: {
  groqId: number | null
  hasGroq: boolean
  onChange: () => void
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [ok, setOk] = useState(false)
  const { busy, error, run } = useAction()
  return (
    <Card
      icon={<Cloud className="size-4 text-info" />}
      title="IA gratuita na nuvem (Groq)"
      badge={hasGroq || ok ? <Badge tone="ok">configurada</Badge> : <Badge tone="accent">recomendada</Badge>}
    >
      <p>
        Mais rápida e escreve melhor. Grátis até cerca de 1.000 pedidos por dia, e a Groq não usa os textos para
        treinar. As conversas saem do computador (com nomes e telefones trocados por marcadores, conforme a privacidade
        escolhida).
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {ok && <Notice tone="ok">Funcionando. A IA na nuvem já está pronta.</Notice>}
      {!hasGroq && !ok && (
        <>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            <li>
              Crie a chave no site do Groq (pode entrar com a conta do Google):{' '}
              <a
                className="inline-flex items-center gap-1 text-info underline"
                href={GROQ_KEYS}
                target="_blank"
                rel="noreferrer"
              >
                abrir o site do Groq <ExternalLink className="size-3.5" />
              </a>
            </li>
            <li>Clique em “Create API Key”, copie e cole aqui:</li>
          </ol>
          <div className="flex items-end gap-2">
            <Field label="Chave do Groq" htmlFor="groq-key">
              <Input
                id="groq-key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="gsk_..."
              />
            </Field>
            <Button
              variant="primary"
              loading={busy === 'g'}
              disabled={key.trim().length < 10}
              onClick={async () => {
                const r = await run('g', async () => {
                  const saved = await window.api.invoke('ai:provider-save', {
                    id: groqId ?? undefined,
                    preset: 'groq',
                    apiKey: key.trim(),
                    enabled: true
                  })
                  try {
                    return await window.api.invoke('ai:provider-test', { id: saved.id })
                  } catch (e) {
                    throw new Error(`A chave foi guardada, mas o teste falhou: ${(e as Error).message}`, { cause: e })
                  }
                })
                if (r) {
                  setOk(true)
                  setKey('')
                }
                onChange()
              }}
            >
              Salvar e testar
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

/** Assistente de uma tela: olha o computador, recomenda e instala/cadastra a IA. */
export function ConfigurarIA({ onClose }: { onClose: () => void }): React.JSX.Element {
  const status = useLoad(() => window.api.invoke('ai:local-status'), [])
  const providers = useLoad(() => window.api.invoke('ai:providers'), [])
  const st = status.data
  const groq = (providers.data ?? []).find((p) => p.preset === 'groq')
  const hasGroq = !!groq?.hasKey
  const reload = (): void => {
    void status.reload()
    void providers.reload()
  }
  return (
    <Drawer title="Configurar IA" onClose={onClose} wide>
      {!st ? (
        <div className="text-[13px] text-ink-3">{status.error ?? 'Olhando o computador…'}</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 text-[13px]">
            <div className="rounded-lg bg-sunken p-3">
              <MemoryStick className="mb-1 size-4 text-ink-3" />
              <b className="tabular">{st.hardware.totalMemGb.toLocaleString('pt-BR')} GB</b> de memória
            </div>
            <div className="rounded-lg bg-sunken p-3">
              <Cpu className="mb-1 size-4 text-ink-3" />
              <b className="tabular">{st.hardware.cpus}</b> núcleos
              <div className="truncate text-[12px] text-ink-3" title={st.hardware.cpuModel}>
                {st.hardware.cpuModel}
              </div>
            </div>
            <div className="rounded-lg bg-sunken p-3">
              <HardDrive className="mb-1 size-4 text-ink-3" />
              {st.hardware.freeDiskGb == null ? (
                'espaço livre desconhecido'
              ) : (
                <>
                  <b className="tabular">{st.hardware.freeDiskGb.toLocaleString('pt-BR')} GB</b> livres no disco
                </>
              )}
            </div>
          </div>
          <Notice tone="info">
            <b>Recomendação:</b>{' '}
            {st.recommendation.primary === 'ambas'
              ? 'use as duas juntas. A IA no computador é a principal para as tarefas rápidas, e a nuvem gratuita faz as maiores e serve de reserva. O app troca sozinho quando uma não responde.'
              : 'use a IA gratuita na nuvem.'}
            {st.recommendation.reasons.length > 0 && (
              <span className="mt-1 block text-ink-2">{st.recommendation.reasons.join(' ')}</span>
            )}
          </Notice>
          <LocalCard st={st} onChange={reload} />
          <CloudCard groqId={groq?.id ?? null} hasGroq={hasGroq} onChange={reload} />
        </div>
      )}
    </Drawer>
  )
}
