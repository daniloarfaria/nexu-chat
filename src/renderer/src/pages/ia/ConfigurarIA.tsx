import { useEffect, useState } from 'react'
import { Cloud, Cpu, ExternalLink, HardDrive, MemoryStick, ShieldCheck, Trash2 } from 'lucide-react'
import type { LocalAiProgress, LocalAiStatus } from '@shared/types'
import { useAction, useLoad } from '../../lib/useAsync'
import { Badge, Button, Drawer, Field, Input, Notice, Switch } from '../../components/ui'
import { cn } from '../../lib/cn'

const CLOUD_OPTIONS = [
  {
    preset: 'groq' as const,
    name: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    site: 'abrir o site do Groq',
    steps: 'Crie a chave no site do Groq (pode entrar com a conta do Google):',
    how: 'Clique em “Create API Key”, copie e cole aqui:',
    hint: 'gsk_...',
    note: 'Mais rápida e escreve melhor. Tem faixa gratuita com limites; confira no site do provedor. A Groq diz que não usa os textos para treinar.',
    askCustomers: false
  },
  {
    preset: 'nvidia' as const,
    name: 'NVIDIA',
    keyUrl: 'https://build.nvidia.com/settings/api-keys',
    site: 'abrir build.nvidia.com',
    steps: 'Entre em build.nvidia.com com a sua conta e abra a página de chaves:',
    how: 'Clique em “Generate API Key”, copie e cole aqui. O modelo padrão pode ser trocado depois em Provedores.',
    hint: 'nvapi-...',
    note: 'Tem faixa gratuita com limites; confira no site do provedor. A chave é sua e fica guardada criptografada neste computador. Não há garantia pública de que os textos não são usados para treinar.',
    askCustomers: true
  },
  {
    preset: 'deepseek' as const,
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    site: 'abrir platform.deepseek.com',
    steps: 'Entre em platform.deepseek.com e abra a página de chaves:',
    how: 'Crie a chave, copie e cole aqui. O modelo pode ser trocado depois em Provedores.',
    hint: 'sk-...',
    note: 'Cobrado por uso (costuma ser barato); confira os preços no site do provedor. Os trechos anonimizados vão para os servidores da DeepSeek, que ficam fora do Brasil; confira a política de privacidade antes de usar com dados de clientes.',
    askCustomers: true
  }
]

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
        Grátis e sem chave: as conversas não saem deste computador e funciona sem internet. Fica para as tarefas rápidas
        (entender o que o cliente quer, etiquetar, tirar datas). As tarefas maiores vão para a nuvem.
      </p>
      {error && <Notice tone="bad">{error}</Notice>}
      {!rec.localSupported ? (
        <Notice tone="warn">
          Este sistema ainda não tem a IA no computador. Use uma IA na nuvem (tem faixa gratuita com limites; confira no
          site do provedor).
        </Notice>
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
                <b>Modelo médio (opcional).</b> Escreve melhor: com ele ligado, as sugestões de resposta e os textos
                também são feitos no computador, e a nuvem fica de reserva. Usa cerca de 3 GB de memória enquanto
                trabalha e baixa {mb(medium.sizeMb)}. Só aparece porque este computador tem 16 GB ou mais.
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
  opt,
  id,
  hasKey,
  noCustomerData,
  onChange
}: {
  opt: (typeof CLOUD_OPTIONS)[number]
  id: number | null
  hasKey: boolean
  /** Como está gravado; vazio quando o provedor ainda não foi cadastrado */
  noCustomerData: boolean | null
  onChange: () => void
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [ok, setOk] = useState(false)
  // antes de cadastrar, a escolha fica aqui; depois, vale o que está gravado
  const [wantCust, setWantCust] = useState(false)
  const useCust = noCustomerData == null ? wantCust : !noCustomerData
  const { busy, error, run } = useAction()
  const fid = `${opt.preset}-key`
  return (
    <Card
      icon={<Cloud className="size-4 text-info" />}
      title={`IA na nuvem (${opt.name})`}
      badge={
        hasKey || ok ? (
          <Badge tone="ok">configurada</Badge>
        ) : opt.preset === 'groq' ? (
          <Badge tone="accent">recomendada</Badge>
        ) : (
          <Badge>opcional</Badge>
        )
      }
    >
      <p>{opt.note}</p>
      <p>
        As conversas saem do computador, com nomes e telefones trocados por marcadores, conforme a privacidade
        escolhida.
      </p>
      {opt.askCustomers && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
          <div>
            <b>Usar em conversas de clientes</b>
            <div className="text-[12px] text-ink-2">
              Vem desligado: assim este provedor só faz tarefas sem dado de cliente, como variações de campanha. Ligue
              só depois de ler o aviso acima.
            </div>
          </div>
          <Switch
            label={`Usar ${opt.name} em conversas de clientes`}
            checked={useCust}
            onChange={(v) => {
              setWantCust(v)
              if (id != null)
                void run('c', () =>
                  window.api.invoke('ai:provider-save', { id, preset: opt.preset, noCustomerData: !v })
                ).then(onChange)
            }}
          />
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      {ok && <Notice tone="ok">Funcionando. A IA na nuvem já está pronta.</Notice>}
      {!hasKey && !ok && (
        <>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            <li>
              {opt.steps}{' '}
              <a
                className="inline-flex items-center gap-1 text-info underline"
                href={opt.keyUrl}
                target="_blank"
                rel="noreferrer"
              >
                {opt.site} <ExternalLink className="size-3.5" />
              </a>
            </li>
            <li>{opt.how}</li>
          </ol>
          <div className="flex items-end gap-2">
            <Field label={`Cole a sua chave do ${opt.name}`} htmlFor={fid}>
              <Input
                id={fid}
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={opt.hint}
              />
            </Field>
            <Button
              variant="primary"
              loading={busy === 'g'}
              disabled={key.trim().length < 10}
              onClick={async () => {
                const r = await run('g', async () => {
                  const saved = await window.api.invoke('ai:provider-save', {
                    id: id ?? undefined,
                    preset: opt.preset,
                    apiKey: key.trim(),
                    enabled: true,
                    ...(opt.askCustomers ? { noCustomerData: !useCust } : {})
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
              ? 'use as duas juntas. A IA no computador é a principal para as tarefas rápidas, e a nuvem faz as maiores e serve de reserva. O app troca sozinho quando uma não responde.'
              : 'use uma IA na nuvem (tem faixa gratuita com limites; confira no site do provedor).'}
            {st.recommendation.reasons.length > 0 && (
              <span className="mt-1 block text-ink-2">{st.recommendation.reasons.join(' ')}</span>
            )}
          </Notice>
          <LocalCard st={st} onChange={reload} />
          {CLOUD_OPTIONS.map((opt) => {
            const cur = (providers.data ?? []).find((p) => p.preset === opt.preset)
            return (
              <CloudCard
                key={opt.preset}
                opt={opt}
                id={cur?.id ?? null}
                hasKey={!!cur?.hasKey}
                noCustomerData={cur ? !!cur.noCustomerData : null}
                onChange={reload}
              />
            )
          })}
        </div>
      )}
    </Drawer>
  )
}
