import { useEffect, useState } from 'react'
import { Bot, BookOpenText, KeyRound, Plus, Settings2, ShieldCheck, Trash2, Wand2 } from 'lucide-react'
import type { AiPreset, AiProvider, AiPrivacy } from '@shared/types'
import { isLoopbackUrl } from '@shared/rules'
import { useActiveAccount } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import { formatDateTime, timeAgo } from '../lib/format'
import {
  Badge,
  Button,
  Drawer,
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
import { MeuNegocio } from './ia/MeuNegocio'
import { ConfigurarIA } from './ia/ConfigurarIA'

const FAIXA = 'Tem faixa gratuita com limites; confira no site do provedor.'

const PRESETS: Array<{ id: AiPreset; name: string; note: string; url: string; free: boolean }> = [
  {
    id: 'groq',
    name: 'Groq',
    note: `${FAIXA} Rápido. Não usa seus dados para treinar.`,
    url: 'https://console.groq.com/keys',
    free: true
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    note: `${FAIXA} No plano gratuito o Google pode usar os textos para melhorar produtos.`,
    url: 'https://aistudio.google.com/apikey',
    free: true
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    note: `${FAIXA} Você cola a sua chave, criada em build.nvidia.com. O modelo pode ser trocado.`,
    url: 'https://build.nvidia.com/settings/api-keys',
    free: true
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    note: 'Cobrado por uso (costuma ser barato); confira os preços no site do provedor. Você cola a sua chave.',
    url: 'https://platform.deepseek.com/api_keys',
    free: false
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    note: `${FAIXA} Vários modelos com sufixo :free, com poucos pedidos por dia. Rotas gratuitas podem registrar dados.`,
    url: 'https://openrouter.ai/keys',
    free: true
  },
  {
    id: 'mistral',
    name: 'Mistral',
    note: `${FAIXA} Treina com os dados, a menos que você desative na conta.`,
    url: 'https://console.mistral.ai/api-keys',
    free: true
  },
  {
    id: 'ollama',
    name: 'Ollama (no computador)',
    note: 'Grátis e sem chave. Roda no próprio computador, nada sai daqui. Precisa instalar o Ollama.',
    url: 'https://ollama.com/download',
    free: true
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    note: 'Pago, melhor qualidade. Entra depois dos gratuitos, com limite de pedidos por mês só dele.',
    url: 'https://platform.claude.com/settings/keys',
    free: false
  }
]

/** Provedores de nuvem: o texto sai do computador (anonimizado, conforme a privacidade escolhida). */
const CLOUD_WARNING =
  'Este provedor fica na nuvem: os trechos enviados (anonimizados, conforme a privacidade escolhida) saem do computador e vão para o provedor.'
const DEEPSEEK_WARNING =
  'Os trechos anonimizados vão para os servidores da DeepSeek, que ficam fora do Brasil. Confira a política de privacidade antes de usar com dados de clientes.'

const CUSTOM_WARNING =
  'Provedor personalizado: os trechos enviados saem do computador e vão para o endereço que você informar. Só use um endereço em que você confia.'
/** Entram com o uso em conversas de clientes desligado: o dono liga de propósito, depois de ler o aviso. */
const CUSTOMERS_OFF_BY_DEFAULT: AiPreset[] = ['nvidia', 'deepseek', 'custom']
const PAID_PRESETS: AiPreset[] = ['claude', 'deepseek']
const isLocalPreset = (preset: AiPreset): boolean => preset === 'ollama' || preset === 'local'

const PRIVACY: Record<AiPrivacy, { label: string; desc: string }> = {
  estrita: {
    label: 'Estrita',
    desc: 'Conversas de clientes só vão para provedores que não treinam com os dados (Groq, Ollama, Claude). Áudios só são transcritos no próprio computador.'
  },
  anonimizar: {
    label: 'Anonimizar',
    desc: 'Nomes, telefones, e-mails, CPF e endereços são trocados por marcadores antes de enviar. Recomendado.'
  },
  livre: { label: 'Livre', desc: 'Envia as conversas como estão. Use só com provedores de confiança.' }
}

function ProviderForm({
  p,
  preset,
  onDone
}: {
  p: AiProvider | null
  preset: AiPreset
  onDone: () => void
}): React.JSX.Element {
  const info = PRESETS.find((x) => x.id === preset)
  const [key, setKey] = useState('')
  const [fast, setFast] = useState(p?.modelFast ?? '')
  const [smart, setSmart] = useState(p?.modelSmart ?? '')
  const [baseUrl, setBaseUrl] = useState(p?.baseUrl ?? '')
  const [useCust, setUseCust] = useState(p ? !p.noCustomerData : !CUSTOMERS_OFF_BY_DEFAULT.includes(preset))
  const paid = p?.paid ?? PAID_PRESETS.includes(preset)
  const [rpm, setRpm] = useState(p?.rpm ? String(p.rpm) : '')
  const [monthly, setMonthly] = useState(p?.monthlyLimit != null ? String(p.monthlyLimit) : '')
  const whole = (text: string, min: number): number | undefined =>
    text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Math.max(min, Math.round(Number(text)))
  const [test, setTest] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  return (
    <Drawer
      title={p ? `Editar ${p.name}` : `Adicionar ${info?.name ?? 'provedor'}`}
      onClose={onDone}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy === 's'}
            onClick={async () => {
              const saved = await run('s', () =>
                window.api.invoke('ai:provider-save', {
                  id: p?.id,
                  preset,
                  apiKey: key ? key : undefined,
                  modelFast: fast || undefined,
                  modelSmart: smart || undefined,
                  noCustomerData: isLocalPreset(preset) ? undefined : !useCust,
                  // só na edição: no cadastro vale o limite padrão do provedor
                  rpm: p ? (whole(rpm, 1) ?? null) : undefined,
                  monthlyLimit: paid ? whole(monthly, 0) : undefined,
                  baseUrl: preset === 'custom' || p ? baseUrl || undefined : undefined
                })
              )
              if (!saved) return
              const ok = await run('t', () => window.api.invoke('ai:provider-test', { id: saved.id }))
              setTest(ok ? `Funcionando: “${ok.slice(0, 60)}”` : null)
              if (ok) setTimeout(onDone, 900)
            }}
          >
            Salvar e testar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {info && <Notice tone={info.free ? 'info' : 'warn'}>{info.note}</Notice>}
        {!isLocalPreset(preset) && (
          <Notice tone="warn">
            {preset === 'deepseek' ? DEEPSEEK_WARNING : preset === 'custom' ? CUSTOM_WARNING : CLOUD_WARNING}
          </Notice>
        )}
        {!isLocalPreset(preset) && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
            <div className="text-[13px]">
              <b>Usar em conversas de clientes</b>
              <div className="text-[12px] text-ink-2">
                Desligado, o provedor só faz tarefas sem dado de cliente, como variações de campanha. Ligue só depois de
                ler o aviso acima.
              </div>
            </div>
            <Switch label="Usar este provedor em conversas de clientes" checked={useCust} onChange={setUseCust} />
          </div>
        )}
        {isLocalPreset(preset) && (
          <Notice tone="info">
            Este provedor roda no próprio computador. O endereço precisa ser localhost ou 127.0.0.1; para um servidor de
            fora, cadastre um provedor personalizado.
          </Notice>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        {test && <Notice tone="ok">{test}</Notice>}
        {preset !== 'ollama' && (
          <Field
            label="Chave da API"
            htmlFor="ai-key"
            hint={
              <>
                Crie em{' '}
                <a className="text-info underline" href={info?.url} target="_blank" rel="noreferrer">
                  {info?.url}
                </a>
                . Fica guardada criptografada neste computador.
              </>
            }
          >
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={p?.hasKey ? '•••••••• (deixe vazio para manter)' : ''}
            />
          </Field>
        )}
        {(preset === 'custom' || p) && (
          <Field label="Endereço da API (compatível com OpenAI)" htmlFor="ai-url">
            <Input id="ai-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modelo rápido" htmlFor="ai-fast" hint="Sugestões de resposta">
            <Input
              id="ai-fast"
              value={fast}
              onChange={(e) => setFast(e.target.value)}
              placeholder="padrão do provedor"
            />
          </Field>
          <Field label="Modelo caprichado" htmlFor="ai-smart" hint="Playbook e campanhas">
            <Input
              id="ai-smart"
              value={smart}
              onChange={(e) => setSmart(e.target.value)}
              placeholder="padrão do provedor"
            />
          </Field>
        </div>
        {(p || paid) && (
          <div className="grid grid-cols-2 gap-3">
            {p && (
              <Field label="Pedidos por minuto" htmlFor="ai-rpm" hint="Vazio: sem limite por minuto">
                <Input
                  id="ai-rpm"
                  type="number"
                  min={1}
                  className="tabular"
                  value={rpm}
                  onChange={(e) => setRpm(e.target.value)}
                />
              </Field>
            )}
            {paid && (
              <Field
                label="Limite de pedidos por mês"
                htmlFor="ai-monthly"
                hint="Só deste provedor. Ao chegar no limite, ele espera o mês seguinte."
              >
                <Input
                  id="ai-monthly"
                  type="number"
                  min={0}
                  className="tabular"
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value)}
                  placeholder="padrão: 300"
                />
              </Field>
            )}
          </div>
        )}
      </div>
    </Drawer>
  )
}

function Providers(): React.JSX.Element {
  const list = useLoad(() => window.api.invoke('ai:providers'), [])
  const settings = useLoad(() => window.api.invoke('ai:settings'), [])
  const [form, setForm] = useState<{ p: AiProvider | null; preset: AiPreset } | null>(null)
  const { run } = useAction()
  const providers = list.data ?? []
  const [now] = useState(() => Date.now())

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Provedores"
        description="O app usa primeiro os que têm faixa gratuita e troca sozinho de provedor quando um atinge o limite. Cadastre pelo menos dois. Os cobrados por uso (DeepSeek, Claude) entram depois dos gratuitos, cada um com o seu limite de pedidos por mês. Provedores de nuvem recebem trechos anonimizados das conversas."
      >
        {providers.length > 0 && (
          <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
            {providers.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {p.paid ? (
                      <Badge tone="warn">{p.preset === 'claude' ? 'pago' : 'cobrado por uso'}</Badge>
                    ) : isLocalPreset(p.preset) ? (
                      p.preset === 'local' || isLoopbackUrl(p.baseUrl) ? (
                        <Badge tone="ok">grátis, sem chave</Badge>
                      ) : (
                        <Badge tone="bad">endereço de fora do computador: não é usado</Badge>
                      )
                    ) : (
                      <Badge tone="info">faixa gratuita com limites</Badge>
                    )}
                    {p.noCustomerData && <Badge tone="warn">sem conversas de clientes</Badge>}
                    {p.trainsOnData ? <Badge>pode treinar com dados</Badge> : <Badge tone="info">não treina</Badge>}
                    {!p.hasKey && p.preset !== 'ollama' && p.preset !== 'local' && <Badge tone="bad">sem chave</Badge>}
                    {p.preset === 'local' && <Badge tone="info">no computador</Badge>}
                    {p.cooldownUntil > now && (
                      <Badge tone="warn">
                        em pausa até{' '}
                        {new Date(p.cooldownUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </Badge>
                    )}
                  </div>
                  <div className="tabular mt-0.5 text-[12px] text-ink-3">
                    {p.modelFast}
                    {p.modelSmart !== p.modelFast && ` / ${p.modelSmart}`} · hoje {p.usedToday}
                    {p.rpd ? ` de ${p.rpd}` : ''} pedidos{p.errorsToday ? ` · ${p.errorsToday} erros` : ''}
                    {p.paid && p.monthlyLimit != null && ` · este mês ${p.usedMonth ?? 0} de ${p.monthlyLimit}`}
                  </div>
                </div>
                <Switch
                  label={`Ativar ${p.name}`}
                  checked={p.enabled}
                  onChange={(v) =>
                    void run('t', () =>
                      window.api.invoke('ai:provider-save', { id: p.id, preset: p.preset, enabled: v })
                    ).then(() => list.reload())
                  }
                />
                {p.preset !== 'local' && (
                  <Button size="sm" variant="ghost" onClick={() => setForm({ p, preset: p.preset })}>
                    <KeyRound className="size-4" /> Editar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remover"
                  onClick={() =>
                    p.preset === 'local'
                      ? alert('Para remover a IA do computador, use o botão Configurar IA.')
                      : confirm(`Remover ${p.name}?`) &&
                        void run('d', () => window.api.invoke('ai:provider-delete', { id: p.id })).then(() =>
                          list.reload()
                        )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.filter((x) => !providers.some((p) => p.preset === x.id)).map((x) => (
            <button
              key={x.id}
              onClick={() => setForm({ p: null, preset: x.id })}
              className="flex flex-col items-start gap-1 rounded-lg border border-line p-3 text-left hover:border-accent"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Plus className="size-4 text-accent" /> {x.name}
              </span>
              <span className="text-[12px] text-ink-2">{x.note}</span>
            </button>
          ))}
        </div>
      </Section>

      {settings.data && (
        <Section
          title="Privacidade das conversas"
          description="Vale para sugestões de resposta e para o playbook, que usam conversas reais."
        >
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRIVACY) as AiPrivacy[]).map((k) => (
              <button
                key={k}
                aria-pressed={settings.data!.privacy === k}
                onClick={() =>
                  void run('p', () => window.api.invoke('ai:settings-save', { privacy: k })).then(() =>
                    settings.reload()
                  )
                }
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left',
                  settings.data!.privacy === k ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
                )}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="size-4" /> {PRIVACY[k].label}
                </span>
                <span className="text-[12px] text-ink-2">{PRIVACY[k].desc}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      {form && <ProviderForm p={form.p} preset={form.preset} onDone={() => (setForm(null), void list.reload())} />}
    </div>
  )
}

function Playbook({ accountId }: { accountId: string }): React.JSX.Element {
  const pb = useLoad(() => window.api.invoke('ai:playbook', { accountId }), [accountId])
  const [text, setText] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const { busy, error, run } = useAction()
  useEffect(() => window.api.on('ai:progress', (p) => p.accountId === accountId && setProgress(p)), [accountId])
  const content = text ?? pb.data?.content ?? ''

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={<BookOpenText className="size-4" />}>
        A IA lê as conversas marcadas como <b>venda</b> ou <b>perdida</b> (até 40, dos últimos 4 meses), descobre o que
        funcionou e escreve o playbook da loja. As sugestões de resposta seguem este playbook.
      </Notice>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          loading={busy === 'b'}
          onClick={async () => {
            setProgress(null)
            const r = await run('b', () => window.api.invoke('ai:playbook-build', { accountId }))
            if (r) {
              setText(r)
              void pb.reload()
            }
          }}
        >
          <Wand2 className="size-4" /> {pb.data ? 'Atualizar com as conversas recentes' : 'Montar playbook'}
        </Button>
        {busy === 'b' && progress && (
          <span className="tabular text-[13px] text-ink-2">
            Analisando conversa {progress.done} de {progress.total}…
          </span>
        )}
        {pb.data && <span className="ml-auto text-[12.5px] text-ink-3">Atualizado {timeAgo(pb.data.updatedAt)}</span>}
      </div>
      {(content || pb.data) && (
        <>
          <Textarea
            rows={22}
            value={content}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-[13px]"
          />
          <div className="flex justify-end">
            <Button
              loading={busy === 's'}
              disabled={text == null}
              onClick={() =>
                void run('s', () => window.api.invoke('ai:playbook-save', { accountId, content })).then(
                  () => (setText(null), pb.reload())
                )
              }
            >
              Salvar edições
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Usage(): React.JSX.Element {
  const log = useLoad(() => window.api.invoke('ai:log'), [])
  const TASK: Record<string, string> = {
    sugerir_resposta: 'Sugestão de resposta',
    variacoes_campanha: 'Versões de campanha',
    analisar_conversa: 'Análise de conversa',
    playbook: 'Playbook',
    preencher_contexto: 'Preencher contexto do negócio',
    teste: 'Teste'
  }
  return (
    <Section title="Últimos usos" description="Registro do que foi enviado para a IA (sem o conteúdo).">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[12.5px] text-ink-2">
          <tr>
            <th className="pb-2 font-medium">Quando</th>
            <th className="pb-2 font-medium">Tarefa</th>
            <th className="pb-2 font-medium">Provedor</th>
            <th className="pb-2 font-medium">Dados de cliente</th>
            <th className="pb-2 text-right font-medium">Caracteres</th>
          </tr>
        </thead>
        <tbody>
          {(log.data ?? []).map((l, i) => (
            <tr key={i} className="border-t border-line">
              <td className="tabular py-1.5 text-ink-2">{formatDateTime(l.at)}</td>
              <td className="py-1.5">{TASK[l.task] ?? l.task}</td>
              <td className="py-1.5 text-ink-2">
                {l.provider} <span className="text-ink-3">· {l.model}</span>
              </td>
              <td className="py-1.5">{l.customerData ? <Badge tone="warn">sim</Badge> : <Badge>não</Badge>}</td>
              <td className="tabular py-1.5 text-right text-ink-2">{l.charsSent.toLocaleString('pt-BR')}</td>
            </tr>
          ))}
          {(log.data ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-ink-3">
                Nada ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Section>
  )
}

export function IA(): React.JSX.Element {
  const account = useActiveAccount()
  const [tab, setTab] = useState<'negocio' | 'playbook' | 'provedores' | 'uso'>('negocio')
  const [setup, setSetup] = useState(false)
  const [setupKey, setSetupKey] = useState(0)
  if (!account) return <Empty icon={<Bot className="size-9" />} title="Crie uma conta primeiro" />
  return (
    <div>
      <PageHeader
        title="Assistente de IA"
        description="Sugere respostas nas conversas, cria versões de campanhas e monta o playbook de vendas da loja. Nada é enviado ao cliente sem você revisar."
        actions={
          <Button variant="primary" onClick={() => setSetup(true)}>
            <Settings2 className="size-4" /> Configurar IA
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'negocio', label: 'Meu negócio' },
          { id: 'provedores', label: 'Provedores' },
          { id: 'playbook', label: 'Playbook de vendas' },
          { id: 'uso', label: 'Uso' }
        ]}
      />
      {tab === 'negocio' && <MeuNegocio key={account.id} accountId={account.id} />}
      {tab === 'provedores' && <Providers key={setupKey} />}
      {tab === 'playbook' && <Playbook accountId={account.id} />}
      {tab === 'uso' && <Usage />}
      {setup && <ConfigurarIA onClose={() => (setSetup(false), setSetupKey((k) => k + 1))} />}
    </div>
  )
}
