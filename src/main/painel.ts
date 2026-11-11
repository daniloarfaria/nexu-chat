import type { PanelBucket, PanelData, PanelFunnelStage, PanelOriginKind, PanelQuery } from '@shared/types'
import { dayKey, phoneIdentity, phoneVariants } from '@shared/rules'
import { getDb } from './db'
import { getAccount } from './accounts'

/**
 * Painel: junta o que já existe (vendas marcadas, funil, planilha de leads, origem de anúncio)
 * em poucas consultas por tela. Nada aqui é estimado: se um dado não existe, o número é zero
 * e `coverage` avisa para a tela dizer que aquilo não foi medido.
 */

const MAX_ACCOUNTS = 50
/** Quanto tempo antes da venda um lead da planilha ainda conta como origem "Site (UTM)" (igual ao Anúncio). */
const UTM_DAYS = 30
const DAY_MS = 86_400_000
const PN_JID = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/

function marks(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

/**
 * Identidade da pessoa numa conta: o número (sem diferença do nono dígito) e o lid dele são a mesma pessoa.
 * Vale para conversas, vendas e leads da planilha.
 */
function identityResolver(ids: string[]): {
  of: (acc: string, jid: string) => string
  jidsOf: (acc: string, identity: string) => string[]
} {
  const lids = new Map<string, string>() // conta:lid -> identidade
  const byIdentity = new Map<string, string[]>() // conta:identidade -> lids
  for (const r of getDb()
    .prepare(`SELECT account_id, lid, pn FROM lid_map WHERE account_id IN (${marks(ids.length)})`)
    .all(...ids) as Array<{ account_id: string; lid: string; pn: string }>) {
    const m = PN_JID.exec(r.pn)
    if (!m) continue
    const idn = phoneIdentity(m[1])
    lids.set(`${r.account_id}:${r.lid}`, idn)
    const k = `${r.account_id}:${idn}`
    byIdentity.set(k, [...(byIdentity.get(k) ?? []), r.lid])
  }
  const of = (acc: string, jid: string): string => {
    const m = PN_JID.exec(jid)
    if (m) return phoneIdentity(m[1])
    return lids.get(`${acc}:${jid}`) ?? jid
  }
  const jidsOf = (acc: string, identity: string): string[] =>
    /^\d+$/.test(identity)
      ? [...phoneVariants(identity).map((p) => `${p}@s.whatsapp.net`), ...(byIdentity.get(`${acc}:${identity}`) ?? [])]
      : [identity]
  return { of, jidsOf }
}

/** Início do período do gráfico: dia, segunda-feira da semana ou primeiro dia do mês (hora local). */
export function bucketKey(ts: number, bucket: PanelBucket): string {
  const d = new Date(ts)
  if (bucket === 'month') return dayKey(new Date(d.getFullYear(), d.getMonth(), 1))
  if (bucket === 'week') return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)))
  return dayKey(d)
}

interface Acc {
  won: number
  lost: number
  revenueCents: number
  paid: number
}

/**
 * Pessoas novas: a primeira mensagem RECEBIDA caiu no período (grupos e canais ficam de fora).
 * Acha só as conversas com movimento no período (chats.last_ts) e confere, pelo índice
 * messages_chat_ts, que não havia mensagem anterior. Conversão: dessas pessoas, quantas têm venda ganha até hoje.
 */
function newPeople(
  ids: string[],
  from: number,
  to: number,
  who: ReturnType<typeof identityResolver>
): { n: number; sold: number } {
  const db = getDb()
  const first = db.prepare(
    `SELECT j.value AS jid, (SELECT MIN(ts) FROM messages m WHERE m.account_id = ? AND m.chat_jid = j.value AND m.from_me = 0) AS t
     FROM json_each(?) j`
  )
  const wonOf = db.prepare(
    `SELECT DISTINCT chat_jid FROM deals WHERE account_id = ? AND status = 'won' AND chat_jid IN (SELECT value FROM json_each(?))`
  )
  let n = 0
  let sold = 0
  for (const acc of ids) {
    const active = db
      .prepare(
        `SELECT jid FROM chats WHERE account_id = ? AND last_ts >= ? AND is_group = 0
         AND jid NOT LIKE '%@g.us' AND jid NOT LIKE '%@broadcast' AND jid NOT LIKE '%@newsletter'`
      )
      .all(acc, Math.floor(from / 1000)) as Array<{ jid: string }>
    if (!active.length) continue
    // A mesma pessoa pode ter outro JID (número e lid): olha todos eles
    const jids = new Set<string>()
    for (const c of active) {
      jids.add(c.jid)
      for (const j of who.jidsOf(acc, who.of(acc, c.jid))) jids.add(j)
    }
    const firstAt = new Map<string, number>()
    for (const r of first.all(acc, JSON.stringify([...jids])) as Array<{ jid: string; t: number | null }>) {
      if (r.t == null) continue
      const idn = who.of(acc, r.jid)
      firstAt.set(idn, Math.min(firstAt.get(idn) ?? Infinity, r.t))
    }
    const fresh = [...firstAt].filter(([, t]) => t * 1000 >= from && t * 1000 < to).map(([idn]) => idn)
    n += fresh.length
    if (!fresh.length) continue
    const all = new Set(fresh.flatMap((idn) => who.jidsOf(acc, idn)))
    const sellers = new Set(
      (wonOf.all(acc, JSON.stringify([...all])) as Array<{ chat_jid: string }>).map((r) => who.of(acc, r.chat_jid))
    )
    sold += fresh.filter((idn) => sellers.has(idn)).length
  }
  return { n, sold }
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
    coverage: { hasAdData: false, hasLeadData: false, hasRecovery: false, adModule: false, leadModule: false }
  }
  if (!ids.length) return empty
  const inAcc = `account_id IN (${marks(ids.length)})`
  const mods = new Map(ids.map((id) => [id, getAccount(id)?.modules]))
  const adModule = ids.some((id) => mods.get(id)?.metaConversoes)
  const leadModule = ids.some((id) => mods.get(id)?.leadsPlanilha)
  const who = identityResolver(ids)

  // 1) Vendas e perdas por origem (uma consulta só)
  const rows = db
    .prepare(
      `SELECT source_type, status, COUNT(*) AS n, SUM(amount_cents) AS cents, SUM(amount_cents > 0) AS paid FROM deals
       WHERE ${inAcc} AND created_at >= ? AND created_at < ? GROUP BY source_type, status`
    )
    .all(...ids, q.from, q.to) as Array<{
    source_type: string
    status: string
    n: number
    cents: number | null
    paid: number | null
  }>
  const origin = new Map<PanelOriginKind, Acc>()
  const bump = (k: PanelOriginKind, status: string, n: number, cents: number, paid: number): void => {
    const o = origin.get(k) ?? { won: 0, lost: 0, revenueCents: 0, paid: 0 }
    if (status === 'won') {
      o.won += n
      o.revenueCents += cents
      o.paid += paid
    } else o.lost += n
    origin.set(k, o)
  }
  const KNOWN: PanelOriginKind[] = ['campaign', 'reminder', 'recovery', 'ad', 'group']
  for (const r of rows) {
    const k = r.source_type as PanelOriginKind
    // Espontâneo é separado abaixo (parte dele veio da planilha do site)
    if (k !== 'organic') bump(KNOWN.includes(k) ? k : 'organic', r.status, r.n, r.cents ?? 0, r.paid ?? 0)
  }

  // 2) Espontâneas cujo telefone estava na planilha de leads até 30 dias antes da venda viram "Site (UTM)"
  const leadTimes = new Map<string, number[]>()
  for (const l of db
    .prepare(`SELECT account_id, phone, created_at FROM leads WHERE ${inAcc} AND phone IS NOT NULL`)
    .all(...ids) as Array<{ account_id: string; phone: string; created_at: number }>) {
    const key = `${l.account_id}:${phoneIdentity(l.phone)}`
    leadTimes.set(key, [...(leadTimes.get(key) ?? []), l.created_at])
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
    const fromSheet =
      !!mods.get(d.account_id)?.leadsPlanilha &&
      !d.chat_jid.endsWith('@g.us') &&
      (leadTimes.get(`${d.account_id}:${who.of(d.account_id, d.chat_jid)}`) ?? []).some(
        (at) => at <= d.created_at && d.created_at - at <= UTM_DAYS * DAY_MS
      )
    bump(fromSheet ? 'utm' : 'organic', d.status, 1, d.amount_cents, d.amount_cents > 0 ? 1 : 0)
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

  const people = newPeople(ids, q.from, q.to, who)

  const lostReasons = db
    .prepare(
      `SELECT COALESCE(reason, 'Outro') AS reason, COUNT(*) AS count FROM deals
       WHERE ${inAcc} AND status = 'lost' AND created_at >= ? AND created_at < ?
       GROUP BY COALESCE(reason, 'Outro') ORDER BY count DESC`
    )
    .all(...ids, q.from, q.to) as Array<{ reason: string; count: number }>

  const hasAd = db.prepare(`SELECT 1 FROM chat_attribution WHERE ${inAcc} LIMIT 1`).get(...ids) !== undefined
  const order: PanelOriginKind[] = ['campaign', 'reminder', 'recovery', 'ad', 'utm', 'group', 'organic']
  const origins = order
    .filter((k) => {
      const o = origin.get(k)
      if (o && o.won + o.lost > 0) return true
      return k === 'campaign' || k === 'organic' || (k === 'ad' && adModule) || (k === 'utm' && leadModule)
    })
    .map((kind) => {
      const o = origin.get(kind) ?? { won: 0, lost: 0, revenueCents: 0, paid: 0 }
      return {
        kind,
        won: o.won,
        lost: o.lost,
        revenueCents: o.revenueCents,
        avgTicketCents: o.paid ? Math.round(o.revenueCents / o.paid) : 0,
        closeRate: o.won + o.lost ? o.won / (o.won + o.lost) : null
      }
    })
  const totalWon = origins.reduce((s, o) => s + o.won, 0)
  const totalLost = origins.reduce((s, o) => s + o.lost, 0)
  const revenue = origins.reduce((s, o) => s + o.revenueCents, 0)
  const paid = [...origin.values()].reduce((s, o) => s + o.paid, 0)
  const rec = origin.get('recovery')

  // 4) Funis dos números escolhidos e o funil pedido
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
      avgTicketCents: paid ? Math.round(revenue / paid) : 0,
      newChats: people.n,
      newChatsSold: people.sold,
      recovered: rec?.won ?? 0,
      recoveredCents: rec?.revenueCents ?? 0
    },
    pipelines,
    funnel: chosen ? buildFunnel(chosen.id, chosen.name) : null,
    revenue: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, label: key, ...v })),
    origins,
    lostReasons,
    coverage: {
      hasAdData: hasAd,
      hasLeadData: leadTimes.size > 0,
      hasRecovery: (rec?.won ?? 0) + (rec?.lost ?? 0) > 0,
      adModule,
      leadModule
    }
  }
}

/** Por coluna: só quantos cartões e a soma dos valores. Sem presumir ordem nem significado das colunas. */
function buildFunnel(pipelineId: number, name: string): NonNullable<PanelData['funnel']> {
  const stages = funnelStages(pipelineId)
  return {
    pipelineId,
    name,
    stages,
    totalCount: stages.reduce((n, s) => n + s.count, 0),
    totalValueCents: stages.reduce((n, s) => n + s.valueCents, 0)
  }
}

function funnelStages(pipelineId: number): PanelFunnelStage[] {
  const db = getDb()
  const stages = db
    .prepare('SELECT id, name FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position, id')
    .all(pipelineId) as Array<{ id: number; name: string }>
  const agg = new Map(
    (
      db
        .prepare(
          `SELECT stage_id, COUNT(*) AS n, SUM(value_cents) AS cents FROM pipeline_cards
           WHERE pipeline_id = ? GROUP BY stage_id`
        )
        .all(pipelineId) as Array<{ stage_id: number; n: number; cents: number | null }>
    ).map((r) => [r.stage_id, r])
  )
  return stages.map((s) => {
    const a = agg.get(s.id)
    return { id: s.id, name: s.name, count: a?.n ?? 0, valueCents: a?.cents ?? 0 }
  })
}
