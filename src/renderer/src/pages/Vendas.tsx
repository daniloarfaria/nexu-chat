import { useMemo, useState } from 'react'
import { TrendingUp, Trash2 } from 'lucide-react'
import { useActiveAccount, useApp } from '../lib/store'
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

const SOURCE = { campaign: 'Campanha', reminder: 'Lembrete', group: 'Grupo', organic: 'Espontâneo' } as const

export function Vendas(): React.JSX.Element {
  const account = useActiveAccount()
  const accountId = account?.id ?? ''
  const go = useApp((s) => s.go)
  const [period, setPeriod] = useState<Period>('month')
  const r = useMemo(() => range(period), [period])
  const summary = useLoad(
    () =>
      accountId ? window.api.invoke('deals:summary', { accountId, from: r.from, to: r.to }) : Promise.resolve(null),
    [accountId, r]
  )
  const deals = useLoad(
    () => (accountId ? window.api.invoke('deals:list', { accountId, from: r.from, to: r.to }) : Promise.resolve([])),
    [accountId, r]
  )
  const { run } = useAction()
  if (!account) return <Empty icon={<TrendingUp className="size-9" />} title="Crie uma conta primeiro" />
  const s = summary.data

  return (
    <div>
      <PageHeader
        title="Vendas"
        description="Marque “Virou venda” ou “Perdida” no topo de cada conversa. A venda é atribuída à campanha ou ao lembrete enviado ao cliente nos 7 dias anteriores."
        actions={
          <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="month">Este mês</option>
            <option value="last_month">Mês passado</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="year">Este ano</option>
          </Select>
        }
      />
      {s && s.won + s.lost === 0 ? (
        <Empty
          icon={<TrendingUp className="size-9" strokeWidth={1.5} />}
          title={`Nenhuma venda marcada ${r.label}`}
          action={
            <Button variant="primary" onClick={() => go('conversas')}>
              Ir para Conversas
            </Button>
          }
        >
          Abra a conversa com o cliente e use “Virou venda” para registrar valor e produto, ou “Perdida” com o motivo. É
          isso que alimenta este painel e o playbook da IA.
        </Empty>
      ) : (
        s && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card">
              {(
                [
                  ['Faturado pelo WhatsApp', money(s.revenueCents)],
                  ['Vendas', s.won.toLocaleString('pt-BR')],
                  ['Ticket médio', money(s.avgTicketCents)],
                  ['Conversão', pct(s.won, s.won + s.lost)]
                ] as Array<[string, string]>
              ).map(([l, v]) => (
                <div key={l} className="bg-panel px-5 py-4">
                  <dt className="text-[13px] text-ink-2">{l}</dt>
                  <dd className="tabular mt-1 text-[22px] font-semibold tracking-[-0.01em]">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="grid grid-cols-[1.6fr_1fr] items-start gap-4">
              <Section title="De onde vieram as vendas">
                <table className="w-full text-[13.5px]">
                  <thead className="text-left text-[12.5px] text-ink-2">
                    <tr>
                      <th className="pb-2 font-medium">Origem</th>
                      <th className="pb-2 text-right font-medium">Vendas</th>
                      <th className="pb-2 text-right font-medium">Faturado</th>
                      <th className="pb-2 text-right font-medium" title="Faturado dividido pelas mensagens enviadas">
                        Por mensagem
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.bySource.map((b, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="py-2">
                          <span className="font-medium">{b.name}</span>{' '}
                          <Badge className="ml-1">{SOURCE[b.sourceType]}</Badge>
                        </td>
                        <td className="tabular py-2 text-right">{b.won}</td>
                        <td className="tabular py-2 text-right">{money(b.revenueCents)}</td>
                        <td className="tabular py-2 text-right text-ink-2">
                          {b.sent ? money(Math.round(b.revenueCents / b.sent)) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
              <Section title="Por que não fechou">
                {s.lostReasons.length === 0 ? (
                  <p className="text-[13.5px] text-ink-3">Nenhuma perda marcada.</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {s.lostReasons.map((l) => (
                      <li key={l.reason}>
                        <div className="flex justify-between text-[13.5px]">
                          <span>{l.reason}</span>
                          <span className="tabular text-ink-2">{l.count}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                          <div
                            className="h-full rounded-full bg-ink-3"
                            style={{ width: `${(l.count / s.lost) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

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
                            await useChats.getState().setAccount(accountId)
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
                      <td className="py-2 text-ink-2">{d.sourceName ?? SOURCE[d.sourceType]}</td>
                      <td className="tabular py-2 text-ink-2">{formatDateTime(d.createdAt)}</td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Excluir registro"
                          onClick={() =>
                            confirm('Excluir este registro?') &&
                            void run('d', () => window.api.invoke('deals:delete', { accountId, id: d.id })).then(
                              () => (deals.reload(), summary.reload())
                            )
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
          </div>
        )
      )}
    </div>
  )
}
