import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react'
import type { LeadsDimension } from '@shared/types'
import { useActiveAccount, useApp } from '../lib/store'
import { money, useAction, useLoad } from '../lib/useAsync'
import { formatDateTime, formatPhone } from '../lib/format'
import { Badge, Button, Empty, Notice, PageHeader, Section, Select, Tabs } from '../components/ui'

type Period = 'all' | 'month' | 'last_month' | '30' | '90' | 'year'

function range(p: Period): { from?: number; to?: number } {
  const now = new Date()
  if (p === 'all') return {}
  if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() }
  if (p === 'last_month')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      to: new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    }
  if (p === 'year') return { from: new Date(now.getFullYear(), 0, 1).getTime() }
  return { from: Date.now() - Number(p) * 86_400_000 }
}

const DIMS: Array<{ id: LeadsDimension; label: string; head: string }> = [
  { id: 'source', label: 'Por origem', head: 'Origem (utm_source)' },
  { id: 'campaign', label: 'Por campanha', head: 'Campanha (utm_campaign)' },
  { id: 'content', label: 'Por anúncio', head: 'Anúncio (utm_content)' }
]

export function Leads(): React.JSX.Element {
  const account = useActiveAccount()
  const accountId = account?.id ?? ''
  const go = useApp((s) => s.go)
  const [period, setPeriod] = useState<Period>('30')
  const [dim, setDim] = useState<LeadsDimension>('source')
  const r = useMemo(() => range(period), [period])
  const cfg = useLoad(
    () => (accountId ? window.api.invoke('leads:config', { accountId }) : Promise.resolve(null)),
    [accountId]
  )
  const report = useLoad(
    () => (accountId ? window.api.invoke('leads:report', { accountId, ...r }) : Promise.resolve(null)),
    [accountId, r]
  )
  const list = useLoad(
    () => (accountId ? window.api.invoke('leads:list', { accountId, ...r, limit: 200 }) : Promise.resolve(null)),
    [accountId, r]
  )
  const { busy, error, setError, run } = useAction()
  const [info, setInfo] = useState<string | null>(null)

  if (!account) return <Empty icon={<FileSpreadsheet className="size-9" />} title="Crie uma conta primeiro" />

  async function sync(): Promise<void> {
    setInfo(null)
    const res = await run('sync', () => window.api.invoke('leads:sync', { accountId }))
    if (!res) return
    if (res.ok) setInfo(res.added ? `${res.added} lead(s) novo(s).` : 'Nenhum lead novo.')
    else setError(res.error ?? 'Não foi possível atualizar.')
    await Promise.all([cfg.reload(), report.reload(), list.reload()])
  }

  const rep = report.data
  const rows = rep ? (dim === 'source' ? rep.bySource : dim === 'campaign' ? rep.byCampaign : rep.byContent) : []
  const head = DIMS.find((d) => d.id === dim)!.head
  const pct = (x: number): string => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

  return (
    <div>
      <PageHeader
        title="Leads do site"
        description="Quem preencheu o formulário do site, de qual anúncio veio, e se virou conversa e venda. O cruzamento é pelo telefone."
        actions={
          <>
            <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="month">Este mês</option>
              <option value="last_month">Mês passado</option>
              <option value="year">Este ano</option>
              <option value="all">Tudo</option>
            </Select>
            <Button loading={busy === 'sync'} disabled={!cfg.data?.url} onClick={() => void sync()}>
              <RefreshCw className="size-4" aria-hidden /> Atualizar agora
            </Button>
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      {info && (
        <div className="mb-4">
          <Notice tone="ok">{info}</Notice>
        </div>
      )}
      {cfg.data && !cfg.data.url ? (
        <Empty
          icon={<FileSpreadsheet className="size-9" strokeWidth={1.5} />}
          title="Conecte a planilha de leads"
          action={
            <Button variant="primary" onClick={() => go('configuracoes')}>
              Abrir Configurações
            </Button>
          }
        >
          Em Configurações → Integrações, informe o link do Apps Script e a senha do formulário. O app busca os leads a
          cada 30 minutos.
        </Empty>
      ) : (
        rep && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-card">
              {(
                [
                  ['Leads', rep.total.leads.toLocaleString('pt-BR')],
                  ['Conversaram', rep.total.talked.toLocaleString('pt-BR')],
                  ['Compraram', rep.total.bought.toLocaleString('pt-BR')],
                  ['Faturamento', money(rep.total.revenueCents)]
                ] as Array<[string, string]>
              ).map(([l, v]) => (
                <div key={l} className="bg-panel px-5 py-4">
                  <dt className="text-[13px] text-ink-2">{l}</dt>
                  <dd className="tabular mt-1 text-[22px] font-semibold tracking-[-0.01em]">{v}</dd>
                </div>
              ))}
            </dl>

            <Section
              title="Resultado por origem do anúncio"
              actions={
                <Button
                  size="sm"
                  disabled={!rows.length}
                  onClick={() =>
                    void run('csv', () => window.api.invoke('leads:report-export', { accountId, dimension: dim, ...r }))
                  }
                >
                  <Download className="size-4" aria-hidden /> Exportar CSV
                </Button>
              }
            >
              <Tabs value={dim} onChange={setDim} items={DIMS.map((d) => ({ id: d.id, label: d.label }))} />
              {rows.length === 0 ? (
                <p className="text-[13.5px] text-ink-3">Nenhum lead neste período.</p>
              ) : (
                <table className="w-full text-[13.5px]">
                  <thead className="text-left text-[12.5px] text-ink-2">
                    <tr>
                      <th className="pb-2 font-medium">{head}</th>
                      <th className="pb-2 text-right font-medium">Leads</th>
                      <th className="pb-2 text-right font-medium">Conversaram</th>
                      <th className="pb-2 text-right font-medium">Compraram</th>
                      <th className="pb-2 text-right font-medium">Faturamento</th>
                      <th className="pb-2 text-right font-medium" title="Compraram dividido por leads">
                        Taxa de compra
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.key} className="border-t border-line">
                        <td className="py-2 font-medium">{b.key}</td>
                        <td className="tabular py-2 text-right">{b.leads}</td>
                        <td className="tabular py-2 text-right">{b.talked}</td>
                        <td className="tabular py-2 text-right">{b.bought}</td>
                        <td className="tabular py-2 text-right">{money(b.revenueCents)}</td>
                        <td className="tabular py-2 text-right text-ink-2">{pct(b.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title="Leads recentes"
              description={
                list.data && list.data.total > list.data.items.length
                  ? `Mostrando os ${list.data.items.length} mais recentes de ${list.data.total}.`
                  : undefined
              }
            >
              {!list.data || list.data.items.length === 0 ? (
                <p className="text-[13.5px] text-ink-3">Nenhum lead neste período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13.5px]">
                    <thead className="text-left text-[12.5px] text-ink-2">
                      <tr>
                        <th className="pb-2 font-medium">Data</th>
                        <th className="pb-2 font-medium">Lead</th>
                        <th className="pb-2 font-medium">Origem</th>
                        <th className="pb-2 font-medium">Situação</th>
                        <th className="pb-2 text-right font-medium">Venda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.items.map((l) => (
                        <tr key={l.id} className="border-t border-line align-top">
                          <td className="tabular py-2 whitespace-nowrap text-ink-2">{formatDateTime(l.createdAt)}</td>
                          <td className="py-2">
                            <div className="font-medium">{l.name ?? 'Sem nome'}</div>
                            <div className="text-[12.5px] text-ink-3">
                              {l.phone ? formatPhone(l.phone) : (l.email ?? 'Sem telefone')}
                            </div>
                          </td>
                          <td className="py-2 text-ink-2">
                            {[l.utmSource, l.utmCampaign].filter(Boolean).join(' / ') || '—'}
                          </td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-1">
                              <Badge tone={l.chat ? 'ok' : 'neutral'}>{l.chat ? 'Conversou' : 'Sem conversa'}</Badge>
                              {l.personId != null && <Badge tone="info">Contato</Badge>}
                              {l.stage && (
                                <Badge tone="accent">
                                  {l.pipeline}: {l.stage}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="tabular py-2 text-right">{l.won ? money(l.valueCents) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        )
      )}
    </div>
  )
}
