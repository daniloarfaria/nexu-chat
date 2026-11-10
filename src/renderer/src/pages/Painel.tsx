import { useMemo, useState } from 'react'
import { BarChart3, Info, Table2, Trash2 } from 'lucide-react'
import type { PanelBucket, PanelData, PanelOriginKind } from '@shared/types'
import { useApp } from '../lib/store'
import { useChats } from '../lib/chatStore'
import { money, pct, useAction, useLoad } from '../lib/useAsync'
import { formatDateTime } from '../lib/format'
import { Badge, Button, Empty, PageHeader, Section, Select } from '../components/ui'

type Period = 'month' | 'last_month' | '30' | '90' | 'year'

function range(p: Period): { from: number; to: number; label: string } {
  const now = new Date()
  const to = Date.now() + 1
  if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to, label: 'este mês' }
  if (p === 'last_month')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      to: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      label: 'mês passado'
    }
  if (p === 'year') return { from: new Date(now.getFullYear(), 0, 1).getTime(), to, label: 'este ano' }
  const d = Number(p)
  return { from: Date.now() - d * 86_400_000, to, label: `últimos ${d} dias` }
}

const ORIGIN: Record<PanelOriginKind, { label: string; hint: string }> = {
  campaign: { label: 'Campanha', hint: 'Cliente que recebeu uma campanha nos 7 dias antes da venda' },
  reminder: { label: 'Lembrete', hint: 'Cliente que recebeu um lembrete nos 7 dias antes da venda' },
  recovery: { label: 'Recuperação', hint: 'Venda de cliente que sumiu e foi chamado de volta pelo app' },
  ad: { label: 'Anúncio', hint: 'Conversa que começou num anúncio e fechou em até 30 dias' },
  utm: { label: 'Site (UTM)', hint: 'Telefone que está na planilha de leads do site, antes da venda' },
  group: { label: 'Grupo', hint: 'Venda marcada numa conversa de grupo' },
  organic: { label: 'Espontâneo', hint: 'Sem campanha, anúncio ou lead do site ligado a ela' }
}

const BUCKET_LABEL: Record<PanelBucket, string> = { day: 'por dia', week: 'por semana', month: 'por mês' }

function shortLabel(key: string, bucket: PanelBucket): string {
  const [y, m, d] = key.split('-')
  return bucket === 'month' ? `${m}/${y.slice(2)}` : `${d}/${m}`
}

/** Completa com zero os períodos sem venda, para o eixo do tempo não enganar. */
function fillBuckets(data: PanelData['revenue'], bucket: PanelBucket, from: number, to: number): PanelData['revenue'] {
  const byKey = new Map(data.map((r) => [r.key, r]))
  const out: PanelData['revenue'] = []
  const cur = new Date(from)
  cur.setHours(0, 0, 0, 0)
  if (bucket === 'week') cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7))
  if (bucket === 'month') cur.setDate(1)
  const key = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  while (cur.getTime() < to && out.length < 400) {
    const k = key(cur)
    out.push(byKey.get(k) ?? { key: k, label: k, revenueCents: 0, won: 0 })
    if (bucket === 'month') cur.setMonth(cur.getMonth() + 1)
    else cur.setDate(cur.getDate() + (bucket === 'week' ? 7 : 1))
  }
  return out.length >= 400 ? data : out
}

function RevenueChart({ data, bucket }: { data: PanelData['revenue']; bucket: PanelBucket }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 190
  const padL = 8
  const padB = 22
  const max = Math.max(1, ...data.map((d) => d.revenueCents))
  const slot = (W - padL) / Math.max(1, data.length)
  const bar = Math.max(2, Math.min(28, slot - 2))
  const every = Math.max(1, Math.ceil(data.length / 8))
  const h = hover != null ? data[hover] : null
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Faturamento ${BUCKET_LABEL[bucket]}. Use “Ver em tabela” para os valores exatos.`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke="var(--color-line-strong)" strokeWidth={1} />
        <line x1={0} x2={W} y1={(H - padB) / 2} y2={(H - padB) / 2} stroke="var(--color-line)" strokeWidth={1} />
        {data.map((d, i) => {
          const bh = d.revenueCents ? Math.max(3, (d.revenueCents / max) * (H - padB - 14)) : 0
          const x = padL + i * slot + (slot - bar) / 2
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)}>
              <rect x={padL + i * slot} y={0} width={slot} height={H - padB} fill="transparent" />
              {bh > 0 && (
                <rect
                  x={x}
                  y={H - padB - bh}
                  width={bar}
                  height={bh}
                  rx={Math.min(4, bar / 2)}
                  fill="var(--color-accent)"
                  opacity={hover == null || hover === i ? 1 : 0.55}
                />
              )}
              {i % every === 0 && (
                <text x={x + bar / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                  {shortLabel(d.key, bucket)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-lg border border-line bg-panel px-3 py-2 text-[13px] shadow-card">
          <div className="font-medium">{shortLabel(h.key, bucket)}</div>
          <div className="tabular">
            {money(h.revenueCents)} em {h.won} {h.won === 1 ? 'venda' : 'vendas'}
          </div>
        </div>
      )}
    </div>
  )
}

function Funnel({ data }: { data: NonNullable<PanelData['funnel']> }): React.JSX.Element {
  const top = Math.max(1, ...data.stages.map((s) => (s.kind === 'lost' ? s.count : s.reached)))
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(110px,1fr)_3fr_90px_90px] gap-3 text-[12.5px] text-ink-2">
        <span>Coluna</span>
        <span>Cartões que chegaram até aqui</span>
        <span className="text-right" title="Dos cartões que chegaram na coluna anterior, quantos chegaram nesta">
          Passaram
        </span>
        <span className="text-right" title="Média de dias desde a última mudança de coluna">
          Parados
        </span>
      </div>
      {data.stages.map((s) => {
        const lost = s.kind === 'lost'
        const n = lost ? s.count : s.reached
        return (
          <div key={s.id} className="grid grid-cols-[minmax(110px,1fr)_3fr_90px_90px] items-center gap-3 text-[13.5px]">
            <span className="truncate font-medium" title={s.name}>
              {s.name}
            </span>
            <div className="flex items-center gap-2">
              <div className="h-5 flex-1 overflow-hidden rounded bg-sunken">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(n / top) * 100}%`,
                    background: lost ? 'var(--color-ink-3)' : 'var(--color-accent)'
                  }}
                />
              </div>
              <span className="tabular w-20 text-right">
                {n}
                {!lost && s.count !== s.reached && <span className="text-ink-3"> ({s.count} aqui)</span>}
              </span>
            </div>
            <span className="tabular text-right">
              {s.rateFromPrev == null ? '—' : `${Math.round(s.rateFromPrev * 100)}%`}
            </span>
            <span className="tabular text-right text-ink-2">
              {s.avgIdleDays == null ? '—' : `${Math.round(s.avgIdleDays)} d`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Painel(): React.JSX.Element {
  const accounts = useApp((s) => s.accounts)
  const active = useApp((s) => s.activeAccountId)
  const go = useApp((s) => s.go)
  const usable = accounts.filter((a) => a.modules.vendas)
  const [period, setPeriod] = useState<Period>('month')
  const [bucket, setBucket] = useState<PanelBucket>('day')
  const [number, setNumber] = useState<string>('') // '' = o número em uso; 'all' = todos
  const [pipe, setPipe] = useState<number | undefined>(undefined)
  const [asTable, setAsTable] = useState(false)
  const r = useMemo(() => range(period), [period])
  const allIds = usable.map((a) => a.id)
  const one = number || (allIds.includes(active ?? '') ? active : allIds[0])
  const ids = number === 'all' ? allIds : one ? [one] : []
  const single = ids.length === 1 ? ids[0] : null
  const panel = useLoad(
    () =>
      ids.length
        ? window.api.invoke('painel:data', { accountIds: ids, from: r.from, to: r.to, bucket, pipelineId: pipe })
        : Promise.resolve(null),
    [ids.join(','), r, bucket, pipe]
  )
  const deals = useLoad(
    () =>
      single ? window.api.invoke('deals:list', { accountId: single, from: r.from, to: r.to }) : Promise.resolve([]),
    [single, r]
  )
  const { run } = useAction()
  const data = panel.data
  const filled = useMemo(() => (data ? fillBuckets(data.revenue, bucket, r.from, r.to) : []), [data, bucket, r])
  if (!usable.length)
    return <Empty icon={<BarChart3 className="size-9" />} title="Ligue o módulo Vendas para ver o painel" />

  const t = data?.totals
  const noData = !!t && t.won + t.lost + t.newChats === 0

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Quanto entrou, de onde veio e onde os clientes estão parando. Os números vêm do que você marca em cada conversa (“Virou venda” ou “Perdida”)."
        actions={
          <div className="flex gap-2">
            {usable.length > 1 && (
              <Select
                aria-label="Número"
                value={number}
                onChange={(e) => {
                  setNumber(e.target.value)
                  setPipe(undefined)
                }}
              >
                <option value="">Número em uso</option>
                <option value="all">Todos os números</option>
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
            <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="month">Este mês</option>
              <option value="last_month">Mês passado</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="year">Este ano</option>
            </Select>
          </div>
        }
      />
      {data && t && (
        <div className="flex flex-col gap-4">
          {noData && (
            <Empty
              icon={<BarChart3 className="size-9" strokeWidth={1.5} />}
              title={`Nada marcado ${r.label}`}
              action={
                <Button variant="primary" onClick={() => go('conversas')}>
                  Ir para Conversas
                </Button>
              }
            >
              Abra a conversa com o cliente e use “Virou venda” para registrar valor e produto, ou “Perdida” com o
              motivo.
            </Empty>
          )}
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card xl:grid-cols-6">
            {(
              [
                ['Faturado', money(t.revenueCents), `${r.label}`],
                ['Vendas', t.won.toLocaleString('pt-BR'), `${t.lost} perdidas`],
                ['Ticket médio', money(t.avgTicketCents), 'valor por venda'],
                ['Conversas novas', t.newChats.toLocaleString('pt-BR'), 'primeira mensagem do cliente'],
                [
                  'Viraram venda',
                  pct(t.newChatsSold, t.newChats),
                  `${t.newChatsSold} de ${t.newChats} conversas novas`
                ],
                [
                  'Recuperadas',
                  t.recovered.toLocaleString('pt-BR'),
                  data.coverage.hasRecovery ? money(t.recoveredCents) : 'ainda sem recuperação'
                ]
              ] as Array<[string, string, string]>
            ).map(([l, v, sub]) => (
              <div key={l} className="bg-panel px-4 py-3.5">
                <dt className="text-[13px] text-ink-2">{l}</dt>
                <dd className="tabular mt-1 text-[22px] font-semibold tracking-[-0.01em]">{v}</dd>
                <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>
              </div>
            ))}
          </dl>

          <Section
            title="Faturamento"
            description={`Valor das vendas marcadas, ${BUCKET_LABEL[bucket]}.`}
            actions={
              <div className="flex gap-2">
                <Select aria-label="Agrupar" value={bucket} onChange={(e) => setBucket(e.target.value as PanelBucket)}>
                  <option value="day">Por dia</option>
                  <option value="week">Por semana</option>
                  <option value="month">Por mês</option>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)}>
                  {asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
                  {asTable ? 'Ver gráfico' : 'Ver em tabela'}
                </Button>
              </div>
            }
          >
            {data.revenue.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">Nenhuma venda marcada neste período.</p>
            ) : asTable ? (
              <table className="w-full text-[13.5px]">
                <thead className="text-left text-[12.5px] text-ink-2">
                  <tr>
                    <th className="pb-2 font-medium">Período</th>
                    <th className="pb-2 text-right font-medium">Vendas</th>
                    <th className="pb-2 text-right font-medium">Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revenue.map((d) => (
                    <tr key={d.key} className="border-t border-line">
                      <td className="py-1.5">{shortLabel(d.key, bucket)}</td>
                      <td className="tabular py-1.5 text-right">{d.won}</td>
                      <td className="tabular py-1.5 text-right">{money(d.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <RevenueChart data={filled} bucket={bucket} />
            )}
          </Section>

          <Section
            title="Funil"
            description="Onde estão os clientes agora. É a foto de hoje (não muda com o período)."
            actions={
              data.pipelines.length > 0 && (
                <Select
                  aria-label="Funil"
                  value={pipe ?? ''}
                  onChange={(e) => setPipe(e.target.value ? Number(e.target.value) : undefined)}
                >
                  <option value="">Escolha um funil</option>
                  {data.pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {ids.length > 1 ? `${p.name} (${p.accountName})` : p.name}
                    </option>
                  ))}
                </Select>
              )
            }
          >
            {data.pipelines.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">Crie um funil na página Funis para acompanhar aqui.</p>
            ) : data.funnel ? (
              <Funnel data={data.funnel} />
            ) : (
              <p className="text-[13.5px] text-ink-3">Escolha um funil acima.</p>
            )}
          </Section>

          <div className="grid grid-cols-[1.6fr_1fr] items-start gap-4">
            <Section title="De onde vieram as vendas">
              <table className="w-full text-[13.5px]">
                <thead className="text-left text-[12.5px] text-ink-2">
                  <tr>
                    <th className="pb-2 font-medium">Origem</th>
                    <th className="pb-2 text-right font-medium">Vendas</th>
                    <th className="pb-2 text-right font-medium">Faturado</th>
                    <th
                      className="pb-2 text-right font-medium"
                      title="Vendas dividido por (vendas + perdidas) que você marcou nesta origem"
                    >
                      Fechou
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.origins.map((o) => (
                    <tr key={o.kind} className="border-t border-line" title={ORIGIN[o.kind].hint}>
                      <td className="py-2 font-medium">{ORIGIN[o.kind].label}</td>
                      <td className="tabular py-2 text-right">{o.won}</td>
                      <td className="tabular py-2 text-right">{money(o.revenueCents)}</td>
                      <td className="tabular py-2 text-right text-ink-2">{pct(o.won, o.won + o.lost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Por que não fechou">
              {data.lostReasons.length === 0 ? (
                <p className="text-[13.5px] text-ink-3">Nenhuma perda marcada.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.lostReasons.map((l) => (
                    <li key={l.reason}>
                      <div className="flex justify-between text-[13.5px]">
                        <span>{l.reason}</span>
                        <span className="tabular text-ink-2">{l.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                        <div
                          className="h-full rounded-full bg-ink-3"
                          style={{ width: `${(l.count / (t.lost || 1)) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title="O que este painel mede e o que não mede">
            <ul className="flex flex-col gap-1.5 text-[13.5px] text-ink-2">
              <li className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                <span>
                  <b className="font-medium text-ink">Medido:</b> só as vendas e perdas que você marcou nas conversas.
                  Venda que não foi marcada não aparece aqui.
                </span>
              </li>
              <li className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                <span>
                  “Viraram venda” olha as conversas novas do período (primeira mensagem do cliente) e conta as que já
                  têm venda marcada, mesmo que tenha fechado depois.
                </span>
              </li>
              <li className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                <span>
                  O funil mostra onde cada cliente está hoje, sem histórico de passagens. “Passaram” soma os cartões que
                  estão naquela coluna ou mais adiante.
                </span>
              </li>
              <li className="flex gap-2">
                <Info className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                <span>
                  {data.coverage.hasAdData
                    ? 'Anúncio: só entra quando o WhatsApp avisa que a conversa veio de um anúncio.'
                    : 'Anúncio: nenhuma conversa de anúncio foi detectada. Sem o aviso do WhatsApp, a venda cai em Espontâneo.'}{' '}
                  {data.coverage.hasLeadData
                    ? 'Site (UTM): vale quando o telefone do cliente está na planilha de leads.'
                    : 'Site (UTM): sem planilha de leads ligada, essas vendas aparecem como Espontâneo.'}
                </span>
              </li>
            </ul>
          </Section>

          {single && (
            <Section title="Registros">
              <table className="w-full text-[13.5px]">
                <thead className="text-left text-[12.5px] text-ink-2">
                  <tr>
                    <th className="pb-2 font-medium">Cliente</th>
                    <th className="pb-2 font-medium">Resultado</th>
                    <th className="pb-2 font-medium">Produto / motivo</th>
                    <th className="pb-2 font-medium">Origem</th>
                    <th className="pb-2 font-medium">Data</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(deals.data ?? []).map((d) => (
                    <tr key={d.id} className="border-t border-line">
                      <td className="py-2">
                        <button
                          className="font-medium hover:text-accent"
                          onClick={async () => {
                            go('conversas')
                            await useChats.getState().setAccount(single)
                            await useChats.getState().select(d.chatJid)
                          }}
                        >
                          {d.chatName}
                        </button>
                      </td>
                      <td className="py-2">
                        {d.status === 'won' ? (
                          <Badge tone="ok">{money(d.amountCents)}</Badge>
                        ) : (
                          <Badge tone="bad">perdida</Badge>
                        )}
                      </td>
                      <td className="py-2 text-ink-2">
                        {d.status === 'won' ? [d.product, d.payment].filter(Boolean).join(' · ') : d.reason}
                      </td>
                      <td className="py-2 text-ink-2">
                        {d.sourceName ?? ORIGIN[d.sourceType as PanelOriginKind]?.label ?? 'Espontâneo'}
                      </td>
                      <td className="tabular py-2 text-ink-2">{formatDateTime(d.createdAt)}</td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Excluir registro"
                          onClick={() =>
                            confirm('Excluir este registro?') &&
                            void run('d', () =>
                              window.api.invoke('deals:delete', { accountId: single, id: d.id })
                            ).then(() => (deals.reload(), panel.reload()))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
