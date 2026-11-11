import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Info, Table2, Trash2 } from 'lucide-react'
import type { Deal, PanelBucket, PanelData, PanelOriginKind } from '@shared/types'
import { dayKey } from '@shared/rules'
import { useApp } from '../lib/store'
import { useChats } from '../lib/chatStore'
import { money, pct, useAction, useLoad } from '../lib/useAsync'
import { formatDateTime } from '../lib/format'
import { bucketLabel, fillBuckets, periodRange, type Period } from '../lib/painel'
import { Badge, Button, Empty, PageHeader, Section, Select } from '../components/ui'

const ORIGIN: Record<PanelOriginKind, { label: string; hint: string }> = {
  campaign: { label: 'Campanha', hint: 'Recebeu uma campanha nos 7 dias antes da venda' },
  reminder: { label: 'Lembrete', hint: 'Recebeu um lembrete nos 7 dias antes da venda' },
  recovery: { label: 'Recuperação', hint: 'Cliente que sumiu e foi chamado de volta pelo app' },
  ad: { label: 'Anúncio', hint: 'A conversa começou num anúncio e fechou em até 30 dias' },
  utm: { label: 'Site (UTM)', hint: 'O telefone estava na planilha de leads até 30 dias antes da venda' },
  group: { label: 'Grupo', hint: 'Venda marcada numa conversa de grupo' },
  organic: { label: 'Espontâneo', hint: 'Sem campanha, anúncio ou lead do site ligado a ela' }
}

const BUCKET_LABEL: Record<PanelBucket, string> = { day: 'por dia', week: 'por semana', month: 'por mês' }
const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

function RevenueChart({ data, bucket }: { data: PanelData['revenue']; bucket: PanelBucket }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 190
  const padL = 8
  const padB = 22
  const padT = 16
  const max = Math.max(1, ...data.map((d) => d.revenueCents))
  const slot = (W - padL) / Math.max(1, data.length)
  const bar = Math.max(2, Math.min(28, slot - 2))
  const every = Math.max(1, Math.ceil(data.length / 8))
  const h = hover != null ? data[hover] : null
  const total = data.reduce((s, d) => s + d.revenueCents, 0)
  const top = data.reduce((a, d) => (d.revenueCents > a.revenueCents ? d : a), data[0])
  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[480px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Faturamento ${BUCKET_LABEL[bucket]}: total de ${money(total)}. Maior período: ${bucketLabel(top.key, bucket)}, com ${money(top.revenueCents)}. Use “Ver em tabela” para todos os valores.`}
          onMouseLeave={() => setHover(null)}
        >
          <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke="var(--color-line-strong)" strokeWidth={1} />
          <line x1={0} x2={W} y1={padT} y2={padT} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="3 3" />
          <text x={padL} y={padT - 4} fontSize={11} fill="var(--color-ink-2)">
            {money(max)}
          </text>
          {data.map((d, i) => {
            const bh = d.revenueCents ? Math.max(3, (d.revenueCents / max) * (H - padB - padT)) : 0
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
                  <text x={x + bar / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-2)">
                    {bucketLabel(d.key, bucket, true)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {h && (
          <div className="pointer-events-none absolute top-0 right-0 rounded-lg border border-line bg-panel px-3 py-2 text-[13px] shadow-card">
            <div className="font-medium">{bucketLabel(h.key, bucket)}</div>
            <div className="tabular">
              {money(h.revenueCents)} em {plural(h.won, 'venda', 'vendas')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Funnel({ data }: { data: NonNullable<PanelData['funnel']> }): React.JSX.Element {
  const top = Math.max(1, ...data.stages.map((s) => s.count))
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[13.5px]">
          <caption className="sr-only">Funil {data.name}: cartões e valores por coluna</caption>
          <thead className="text-left text-[12.5px] text-ink-2">
            <tr>
              <th scope="col" className="pb-2 font-medium">
                Coluna
              </th>
              <th scope="col" className="pb-2 font-medium">
                Cartões
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Soma dos valores
              </th>
            </tr>
          </thead>
          <tbody>
            {data.stages.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <th scope="row" className="max-w-[200px] truncate py-2 pr-3 text-left font-medium" title={s.name}>
                  {s.name}
                </th>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 min-w-16 flex-1 overflow-hidden rounded bg-sunken" aria-hidden>
                      <div
                        className="h-full rounded"
                        style={{ width: `${(s.count / top) * 100}%`, background: 'var(--color-accent)' }}
                      />
                    </div>
                    <span className="tabular whitespace-nowrap">{s.count}</span>
                  </div>
                </td>
                <td className="tabular py-2 text-right">{money(s.valueCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-medium">
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                Total do funil
              </th>
              <td className="tabular py-2 pr-3">{data.totalCount}</td>
              <td className="tabular py-2 text-right">{money(data.totalValueCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] text-ink-2">
        Mostra só quantos cartões estão em cada coluna agora e a soma dos valores deles, na ordem que você definiu.
      </p>
    </div>
  )
}

function Skeleton(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" className="flex animate-pulse flex-col gap-4">
      <span className="sr-only">Carregando o painel…</span>
      <div className="h-24 rounded-xl bg-sunken" />
      <div className="h-56 rounded-xl bg-sunken" />
      <div className="h-40 rounded-xl bg-sunken" />
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
  const [pipeSel, setPipeSel] = useState<{ key: string; id: number | undefined }>({ key: '', id: undefined })
  const [asTable, setAsTable] = useState(false)
  // Dia de hoje: muda se o app ficou aberto de um dia para o outro, e o período se recalcula
  const [today, setToday] = useState(() => dayKey())
  useEffect(() => {
    const refresh = (): void => setToday(dayKey())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` serve só para recalcular ao virar o dia
  const r = useMemo(() => periodRange(period), [period, today])
  const allIds = usable.map((a) => a.id)
  const one = number || (allIds.includes(active ?? '') ? active : allIds[0])
  const ids = number === 'all' ? allIds : one ? [one] : []
  const idsKey = ids.join(',')
  // O funil escolhido vale só para os números escolhidos; ao trocar o número, volta a "Escolha um funil"
  const pipe = pipeSel.key === idsKey ? pipeSel.id : undefined
  const single = ids.length === 1 ? ids[0] : null
  const panel = useLoad(
    () =>
      ids.length
        ? window.api.invoke('painel:data', { accountIds: ids, from: r.from, to: r.to, bucket, pipelineId: pipe })
        : Promise.resolve(null),
    [idsKey, r, bucket, pipe],
    { resetOnChange: true }
  )
  const deals = useLoad<{ accountId: string; items: Deal[] } | null>(
    async () =>
      single
        ? {
            accountId: single,
            items: await window.api.invoke('deals:list', { accountId: single, from: r.from, to: r.to })
          }
        : null,
    [single, r],
    { resetOnChange: true }
  )
  const { run, busy, error: actionError } = useAction()
  const data = panel.data
  const filled = useMemo(() => (data ? fillBuckets(data.revenue, bucket, r.from, r.to) : []), [data, bucket, r])
  if (!usable.length)
    return <Empty icon={<BarChart3 className="size-9" />} title="Ligue o módulo Vendas para ver o painel" />

  const t = data?.totals
  const noData = !!t && t.won + t.lost + t.newChats === 0
  const records = deals.data?.accountId === single ? deals.data.items : null

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Quanto entrou, de onde veio e onde os clientes estão parando. Os números vêm do que você marca em cada conversa (“Virou venda” ou “Perdida”)."
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {usable.length > 1 && (
              <Select aria-label="Número" value={number} onChange={(e) => setNumber(e.target.value)}>
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
      {panel.error && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-bad bg-bad-soft px-4 py-3 text-[14px]"
        >
          <span>Não foi possível carregar o painel: {panel.error}</span>
          <Button size="sm" onClick={() => void panel.reload()}>
            Tentar de novo
          </Button>
        </div>
      )}
      {!data && !panel.error && <Skeleton />}
      {data && t && (
        <div
          aria-busy={panel.loading}
          className={`flex flex-col gap-4 transition-opacity ${panel.loading ? 'opacity-60' : ''}`}
        >
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
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card sm:grid-cols-3 xl:grid-cols-6">
            {(
              [
                ['Faturado', money(t.revenueCents), r.label],
                ['Vendas', t.won.toLocaleString('pt-BR'), plural(t.lost, 'perdida', 'perdidas')],
                ['Ticket médio', money(t.avgTicketCents), 'só vendas com valor'],
                ['Conversas novas', t.newChats.toLocaleString('pt-BR'), 'pessoas que escreveram pela 1ª vez'],
                [
                  'Viraram venda',
                  pct(t.newChatsSold, t.newChats),
                  `${t.newChatsSold} de ${t.newChats} conversas novas, até hoje`
                ],
                [
                  'Recuperadas',
                  t.recovered.toLocaleString('pt-BR'),
                  data.coverage.hasRecovery
                    ? `${money(t.recoveredCents)}${t.recoveredDiscountCents ? `, desconto ${money(t.recoveredDiscountCents)}` : ''}`
                    : 'ainda sem recuperação'
                ]
              ] as Array<[string, string, string]>
            ).map(([l, v, sub]) => (
              <div key={l} className="bg-panel px-4 py-3.5">
                <dt className="text-[13px] text-ink-2">{l}</dt>
                <dd className="tabular mt-1 text-[22px] font-semibold tracking-[-0.01em]">{v}</dd>
                <dd className="mt-0.5 text-[12px] text-ink-2">{sub}</dd>
              </div>
            ))}
          </dl>

          <Section
            title="Faturamento"
            description={`Valor das vendas marcadas, ${BUCKET_LABEL[bucket]}.`}
            actions={
              <div className="flex flex-wrap gap-2">
                <Select aria-label="Agrupar" value={bucket} onChange={(e) => setBucket(e.target.value as PanelBucket)}>
                  <option value="day">Por dia</option>
                  <option value="week">Por semana</option>
                  <option value="month">Por mês</option>
                </Select>
                <Button size="sm" variant="ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
                  {asTable ? <BarChart3 className="size-4" aria-hidden /> : <Table2 className="size-4" aria-hidden />}
                  {asTable ? 'Ver gráfico' : 'Ver em tabela'}
                </Button>
              </div>
            }
          >
            {data.revenue.length === 0 ? (
              <p className="text-[13.5px] text-ink-2">Nenhuma venda marcada neste período.</p>
            ) : asTable ? (
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-[13.5px]">
                  <caption className="sr-only">Faturamento {BUCKET_LABEL[bucket]}</caption>
                  <thead className="text-left text-[12.5px] text-ink-2">
                    <tr>
                      <th scope="col" className="pb-2 font-medium">
                        Período
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Vendas
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Faturado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filled.map((d) => (
                      <tr key={d.key} className="border-t border-line">
                        <th scope="row" className="py-1.5 text-left font-normal">
                          {bucketLabel(d.key, bucket)}
                        </th>
                        <td className="tabular py-1.5 text-right">{d.won}</td>
                        <td className="tabular py-1.5 text-right">{money(d.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <RevenueChart data={filled} bucket={bucket} />
            )}
          </Section>

          <Section
            title="Funil"
            description="Onde estão os clientes agora, nos funis do número escolhido. É a foto de hoje: muda com o número, não com o período."
            actions={
              data.pipelines.length > 0 && (
                <Select
                  aria-label="Funil"
                  value={pipe ?? ''}
                  onChange={(e) => setPipeSel({ key: idsKey, id: e.target.value ? Number(e.target.value) : undefined })}
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
              <p className="text-[13.5px] text-ink-2">Crie um funil na página Funis para acompanhar aqui.</p>
            ) : data.funnel ? (
              <Funnel data={data.funnel} />
            ) : (
              <p className="text-[13.5px] text-ink-2">Escolha um funil acima.</p>
            )}
          </Section>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Section title="De onde vieram as vendas">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-[13.5px]">
                  <thead className="text-left text-[12.5px] text-ink-2">
                    <tr>
                      <th scope="col" className="pb-2 font-medium">
                        Origem
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Vendas
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Faturado
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Ticket
                      </th>
                      <th scope="col" className="pb-2 text-right font-medium">
                        Fechamento
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.origins.map((o) => (
                      <tr key={o.kind} className="border-t border-line">
                        <th scope="row" className="py-2 text-left font-normal">
                          <span className="font-medium">{ORIGIN[o.kind].label}</span>
                          <span className="block text-[12px] text-ink-2">{ORIGIN[o.kind].hint}</span>
                        </th>
                        <td className="tabular py-2 text-right">{o.won}</td>
                        <td className="tabular py-2 text-right">{money(o.revenueCents)}</td>
                        <td className="tabular py-2 text-right text-ink-2">
                          {o.avgTicketCents ? money(o.avgTicketCents) : '—'}
                        </td>
                        <td className="tabular py-2 text-right text-ink-2">
                          {o.closeRate == null ? '—' : `${Math.round(o.closeRate * 100)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[12.5px] text-ink-2">
                <b className="font-medium">Fechamento:</b> das vendas e perdas que você marcou nessa origem, quantas
                foram vendas. Não é a conversão das conversas novas.
              </p>
            </Section>
            <Section title="Por que não fechou">
              {data.lostReasons.length === 0 ? (
                <p className="text-[13.5px] text-ink-2">Nenhuma perda marcada.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {data.lostReasons.map((l) => (
                    <li key={l.reason}>
                      <div className="flex justify-between text-[13.5px]">
                        <span>{l.reason}</span>
                        <span className="tabular text-ink-2">{l.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
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
              {[
                <>
                  <b className="font-medium text-ink">Medido:</b> só as vendas e perdas que você marcou nas conversas.
                  Venda que não foi marcada não aparece aqui.
                </>,
                <>
                  <b className="font-medium text-ink">Conversas novas</b> são pessoas (o mesmo cliente com número e
                  identificador novo conta uma vez) cuja primeira mensagem recebida caiu no período. “Viraram venda”
                  conta, entre elas, quem tem venda marcada <b className="font-medium text-ink">até hoje</b>, mesmo que
                  tenha fechado depois do período.
                </>,
                <>
                  O funil mostra, por coluna, quantos cartões estão ali hoje e a soma dos valores. O painel não
                  interpreta o que cada coluna significa nem calcula passagem entre elas.
                </>,
                <>
                  {data.coverage.hasAdData
                    ? 'Anúncio: só entra quando o WhatsApp avisa que a conversa veio de um anúncio.'
                    : 'Anúncio: nenhuma conversa de anúncio foi detectada. Sem o aviso do WhatsApp, a venda cai em Espontâneo.'}{' '}
                  {data.coverage.hasLeadData
                    ? 'Site (UTM): vale quando o telefone está na planilha de leads até 30 dias antes da venda.'
                    : 'Site (UTM): sem planilha de leads, essas vendas aparecem como Espontâneo.'}
                </>
              ].map((c, i) => (
                <li key={i} className="flex gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Section>

          {single && (
            <Section title="Registros">
              {deals.error ? (
                <div role="alert" className="flex items-center justify-between gap-3 text-[13.5px] text-bad">
                  <span>Não foi possível carregar os registros: {deals.error}</span>
                  <Button size="sm" onClick={() => void deals.reload()}>
                    Tentar de novo
                  </Button>
                </div>
              ) : !records ? (
                <p role="status" aria-busy="true" className="text-[13.5px] text-ink-2">
                  Carregando registros…
                </p>
              ) : records.length === 0 ? (
                <p className="text-[13.5px] text-ink-2">Nenhum registro {r.label}.</p>
              ) : (
                <div className="overflow-x-auto">
                  {actionError && (
                    <p role="alert" className="mb-2 text-[13.5px] text-bad">
                      Não foi possível excluir: {actionError}
                    </p>
                  )}
                  <table className="w-full min-w-[560px] text-[13.5px]">
                    <thead className="text-left text-[12.5px] text-ink-2">
                      <tr>
                        <th scope="col" className="pb-2 font-medium">
                          Cliente
                        </th>
                        <th scope="col" className="pb-2 font-medium">
                          Resultado
                        </th>
                        <th scope="col" className="pb-2 font-medium">
                          Produto / motivo
                        </th>
                        <th scope="col" className="pb-2 font-medium">
                          Origem
                        </th>
                        <th scope="col" className="pb-2 font-medium">
                          Data
                        </th>
                        <th scope="col" className="pb-2">
                          <span className="sr-only">Ações</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((d) => (
                        <tr key={d.id} className="border-t border-line">
                          <td className="py-2">
                            <button
                              type="button"
                              className="rounded font-medium hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                              onClick={async () => {
                                go('conversas')
                                await useChats.getState().setAccount(deals.data!.accountId)
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
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Excluir o registro de ${d.chatName}`}
                              disabled={busy !== null}
                              loading={busy === `del-${d.id}`}
                              onClick={async () => {
                                if (!confirm('Excluir este registro?')) return
                                // Usa o número do próprio registro, nunca o que está selecionado agora
                                const acc = deals.data!.accountId
                                const done = await run(`del-${d.id}`, async () => {
                                  await window.api.invoke('deals:delete', { accountId: acc, id: d.id })
                                  return true
                                })
                                if (done) await Promise.all([deals.reload(), panel.reload()])
                              }}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
