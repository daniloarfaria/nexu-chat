import type { PanelBucket, PanelData, PanelFunnelStage, PanelOriginKind, PanelQuery, StageKind } from '@shared/types'
import { dayKey } from '@shared/rules'
import { getDb } from './db'
import { phoneIdentity } from './leadsPlanilha'

/**
 * Painel: junta o que já existe (vendas marcadas, funil, planilha de leads, origem de anúncio)
 * em poucas consultas por tela. Nada aqui é estimado: se um dado não existe, o número é zero
 * e `coverage` avisa para a tela dizer que aquilo não foi medido.
 */

const MAX_ACCOUNTS = 50

function marks(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

function identityOfJid(jid: string): string | null {
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid)
  return m ? phoneIdentity(m[1]) : null
}

/** Início do período do gráfico: dia, segunda-feira da semana ou primeiro dia do mês (hora local). */
export function bucketKey(ts: number, bucket: PanelBucket): string {
  const d = new Date(ts)
  if (bucket === 'month') return dayKey(new Date(d.getFullYear(), d.getMonth(), 1))
  if (bucket === 'week') return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)))
  return dayKey(d)
}

export function panel(q: PanelQuery): PanelData {
  const db = getDb()
  const ids = [...new Set(q.accountIds)].slice(0, MAX_ACCOUNTS)
  const empty: PanelData = {
    totals: {
      revenueCents: 0,
      won: 0,
      lost: 0,
      avgTicketCents: 0,
      newChats: 0,
      newChatsSold: 0,
      recovered: 0,
      recoveredCents: 0
    },
    pipelines: [],
    funnel: null,
    revenue: [],
    origins: [],
    lostReasons: [],
    coverage: { hasAdData: false, hasLeadData: false, hasRecovery: false }
  }
  if (!ids.length) return empty
  const inAcc = `account_id IN (${marks(ids.length)})`

  // 1) Vendas e perdas por origem (uma consulta só, coberta pelo índice deals_painel)
  const rows = db
    .prepare(
      `SELECT source_type, status, COUNT(*) AS n, SUM(amount_cents) AS cents FROM deals
       WHERE ${inAcc} AND created_at >= ? AND created_at < ? GROUP BY source_type, status`
    )
    .all(...ids, q.from, q.to) as Array<{ source_type: string; status: string; n: number; cents: number | null }>
  const origin = new Map<PanelOriginKind, { won: number; lost: number; revenueCents: number }>()
  const bump = (k: PanelOriginKind, status: string, n: number, cents: number): void => {
    const o = origin.get(k) ?? { won: 0, lost: 0, revenueCents: 0 }
    if (status === 'won') {
      o.won += n
      o.revenueCents += cents
    } else o.lost += n
    origin.set(k, o)
  }
  const KNOWN: PanelOriginKind[] = ['campaign', 'reminder', 'recovery', 'ad', 'group']
  for (const r of rows) {
    const k = r.source_type as PanelOriginKind
    // Espontâneo é separado abaixo (parte dele veio da planilha do site)
    if (k !== 'organic') bump(KNOWN.includes(k) ? k : 'organic', r.status, r.n, r.cents ?? 0)
  }

  // 2) Espontâneas que casam com um lead da planilha (telefone) anterior à venda viram "UTM"
  const leadAt = new Map<string, number>()
  for (const l of db
    .prepare(
      `SELECT account_id, phone, MIN(created_at) AS at FROM leads WHERE ${inAcc} AND phone IS NOT NULL GROUP BY account_id, phone`
    )
    .all(...ids) as Array<{ account_id: string; phone: string; at: number }>) {
    const key = `${l.account_id}:${phoneIdentity(l.phone)}`
    leadAt.set(key, Math.min(leadAt.get(key) ?? Infinity, l.at))
  }
  const organic = db
    .prepare(
      `SELECT account_id, chat_jid, status, amount_cents, created_at FROM deals
       WHERE ${inAcc} AND source_type = 'organic' AND created_at >= ? AND created_at < ?`
    )
    .all(...ids, q.from, q.to) as Array<{
    account_id: string
    chat_jid: string
    status: string
    amount_cents: number
    created_at: number
  }>
  for (const d of organic) {
    const idn = d.chat_jid.endsWith('@g.us') ? null : identityOfJid(d.chat_jid)
    const at = idn ? leadAt.get(`${d.account_id}:${idn}`) : undefined
    bump(at !== undefined && at <= d.created_at ? 'utm' : 'organic', d.status, 1, d.amount_cents)
  }

  // 3) Faturamento no tempo
  const won = db
    .prepare(
      `SELECT created_at, amount_cents FROM deals WHERE ${inAcc} AND status = 'won' AND created_at >= ? AND created_at < ?`
    )
    .all(...ids, q.from, q.to) as Array<{ created_at: number; amount_cents: number }>
  const buckets = new Map<string, { revenueCents: number; won: number }>()
  for (const d of won) {
    const k = bucketKey(d.created_at, q.bucket)
    const b = buckets.get(k) ?? { revenueCents: 0, won: 0 }
    b.revenueCents += d.amount_cents
    b.won++
    buckets.set(k, b)
  }

  // 4) Conversas novas: primeira mensagem RECEBIDA no período (grupos e canais ficam de fora).
  // Conversão: dessas conversas, quantas já têm venda marcada depois do primeiro contato.
  const chats = db
    .prepare(
      `SELECT COUNT(*) AS n,
         COALESCE(SUM(EXISTS(SELECT 1 FROM deals d WHERE d.account_id = f.account_id AND d.chat_jid = f.chat_jid
           AND d.status = 'won' AND d.created_at >= f.t * 1000)), 0) AS sold
       FROM (
         SELECT account_id, chat_jid, MIN(ts) AS t FROM messages
         WHERE ${inAcc} AND from_me = 0 AND chat_jid NOT LIKE '%@g.us' AND chat_jid NOT LIKE '%@broadcast'
           AND chat_jid NOT LIKE '%@newsletter'
         GROUP BY account_id, chat_jid HAVING t >= ? AND t < ?
       ) f`
    )
    .get(...ids, Math.floor(q.from / 1000), Math.floor(q.to / 1000)) as { n: number; sold: number }

  const lostReasons = db
    .prepare(
      `SELECT COALESCE(reason, 'Outro') AS reason, COUNT(*) AS count FROM deals
       WHERE ${inAcc} AND status = 'lost' AND created_at >= ? AND created_at < ? GROUP BY reason ORDER BY count DESC`
    )
    .all(...ids, q.from, q.to) as Array<{ reason: string; count: number }>

  const hasAd = db.prepare(`SELECT 1 FROM chat_attribution WHERE ${inAcc} LIMIT 1`).get(...ids) !== undefined
  const order: PanelOriginKind[] = ['campaign', 'reminder', 'recovery', 'ad', 'utm', 'group', 'organic']
  const origins = order
    .map((kind) => ({ kind, ...(origin.get(kind) ?? { won: 0, lost: 0, revenueCents: 0 }) }))
    .filter((o) => o.won + o.lost > 0 || ['campaign', 'ad', 'utm', 'organic'].includes(o.kind))
  const totalWon = origins.reduce((s, o) => s + o.won, 0)
  const totalLost = origins.reduce((s, o) => s + o.lost, 0)
  const revenue = origins.reduce((s, o) => s + o.revenueCents, 0)
  const rec = origin.get('recovery')

  // 5) Funis dos números escolhidos e o funil pedido
  const pipelines = (
    db
      .prepare(
        `SELECT p.id, p.name, p.account_id, a.name AS account_name FROM pipelines p JOIN accounts a ON a.id = p.account_id
         WHERE p.account_id IN (${marks(ids.length)}) ORDER BY p.account_id, p.position, p.id`
      )
      .all(...ids) as Array<{ id: number; name: string; account_id: string; account_name: string }>
  ).map((p) => ({ id: p.id, name: p.name, accountId: p.account_id, accountName: p.account_name }))
  const chosen = pipelines.find((p) => p.id === q.pipelineId)

  return {
    totals: {
      revenueCents: revenue,
      won: totalWon,
      lost: totalLost,
      avgTicketCents: totalWon ? Math.round(revenue / totalWon) : 0,
      newChats: chats.n,
      newChatsSold: chats.sold,
      recovered: rec?.won ?? 0,
      recoveredCents: rec?.revenueCents ?? 0
    },
    pipelines,
    funnel: chosen ? { pipelineId: chosen.id, name: chosen.name, stages: funnelStages(chosen.id) } : null,
    revenue: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, label: key, ...v })),
    origins,
    lostReasons,
    coverage: { hasAdData: hasAd, hasLeadData: leadAt.size > 0, hasRecovery: (rec?.won ?? 0) + (rec?.lost ?? 0) > 0 }
  }
}

function funnelStages(pipelineId: number): PanelFunnelStage[] {
  const db = getDb()
  const stages = db
    .prepare('SELECT id, name, kind FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position, id')
    .all(pipelineId) as Array<{ id: number; name: string; kind: StageKind }>
  const agg = new Map(
    (
      db
        .prepare(
          `SELECT stage_id, COUNT(*) AS n, SUM(value_cents) AS cents, AVG(moved_at) AS moved FROM pipeline_cards
           WHERE pipeline_id = ? GROUP BY stage_id`
        )
        .all(pipelineId) as Array<{ stage_id: number; n: number; cents: number | null; moved: number }>
    ).map((r) => [r.stage_id, r])
  )
  const now = Date.now()
  // "Chegou até aqui" = cartões que estão nesta coluna ou em uma mais adiante (colunas de perda não entram)
  const reached: number[] = new Array(stages.length).fill(0)
  let acc = 0
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].kind !== 'lost') acc += agg.get(stages[i].id)?.n ?? 0
    reached[i] = stages[i].kind === 'lost' ? 0 : acc
  }
  let prev: number | null = null
  return stages.map((s, i) => {
    const a = agg.get(s.id)
    let rate: number | null = null
    if (s.kind !== 'lost') {
      if (prev != null && prev > 0) rate = reached[i] / prev
      prev = reached[i]
    }
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      count: a?.n ?? 0,
      valueCents: a?.cents ?? 0,
      reached: reached[i],
      rateFromPrev: rate,
      avgIdleDays: a ? Math.max(0, (now - a.moved) / 86_400_000) : null
    }
  })
}
