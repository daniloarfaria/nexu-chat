import type { Deal, SalesSummary } from '@shared/types'
import { getDb } from './db'
import { lastTouch } from './campaigns'
import { getChats } from './wa/store'
import { dayKey } from '@shared/rules'
import { findPersonByJid } from './people'
import { getAccount } from './accounts'
import { getAttribution } from './ads'

/** Por quantos dias, depois do primeiro contato vindo de anúncio, a venda ainda conta como "Anúncio". */
export const AD_ORIGIN_DAYS = 30

interface Row {
  id: number
  chat_jid: string
  status: Deal['status']
  amount_cents: number
  product: string | null
  payment: string | null
  reason: string | null
  note: string | null
  source_type: Deal['sourceType']
  source_id: number | null
  source_name: string | null
  created_at: number
}

function toDeal(r: Row, names: Map<string, string>): Deal {
  return {
    id: r.id,
    chatJid: r.chat_jid,
    chatName: names.get(r.chat_jid) ?? r.chat_jid.split('@')[0],
    status: r.status,
    amountCents: r.amount_cents,
    product: r.product,
    payment: r.payment,
    reason: r.reason,
    note: r.note,
    sourceType: r.source_type,
    sourceName: r.source_name,
    createdAt: r.created_at
  }
}

export function saveDeal(
  accountId: string,
  d: {
    chatJid: string
    status: Deal['status']
    amountCents: number
    product?: string
    payment?: string
    reason?: string
    note?: string
  }
): Deal {
  // Atribuição: última campanha/lembrete enviado ao contato nos últimos 7 dias
  const touch = lastTouch(accountId, d.chatJid)
  // Sem campanha recente, a conversa que veio de anúncio vale como "Anúncio" por AD_ORIGIN_DAYS dias
  // depois do primeiro contato (módulo Anúncios da Meta)
  const adOrigin = !touch && getAccount(accountId)?.modules.metaConversoes ? getAttribution(accountId, d.chatJid) : null
  const fromAd = !!adOrigin && Date.now() / 1000 - adOrigin.firstTs <= AD_ORIGIN_DAYS * 86400
  const sourceType: Deal['sourceType'] = d.chatJid.endsWith('@g.us')
    ? 'group'
    : touch
      ? touch.kind === 'reminder'
        ? 'reminder'
        : 'campaign'
      : fromAd
        ? 'ad'
        : 'organic'
  const id = getDb()
    .prepare(
      `INSERT INTO deals (account_id, chat_jid, status, amount_cents, product, payment, reason, note, source_type, source_id, source_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      accountId,
      d.chatJid,
      d.status,
      d.status === 'won' ? Math.max(0, Math.round(d.amountCents)) : 0,
      d.product?.trim() || null,
      d.payment || null,
      d.status === 'lost' ? d.reason || 'Outro' : null,
      d.note?.trim() || null,
      sourceType,
      touch?.id ?? null,
      touch?.name ?? (sourceType === 'ad' ? 'Anúncio' : null),
      Date.now()
    ).lastInsertRowid
  return listDeals(accountId, { id: Number(id) })[0]
}

export function deleteDeal(accountId: string, id: number): void {
  getDb().prepare('DELETE FROM deals WHERE id = ? AND account_id = ?').run(id, accountId)
}

export function listDeals(
  accountId: string,
  f: { id?: number; chatJid?: string; from?: number; to?: number; limit?: number } = {}
): Deal[] {
  const where = ['account_id = ?']
  const args: Array<string | number> = [accountId]
  const add = (sql: string, v: string | number | undefined): void => {
    if (v === undefined || v === '' || v === 0) return
    where.push(sql)
    args.push(v)
  }
  add('id = ?', f.id)
  add('chat_jid = ?', f.chatJid)
  add('created_at >= ?', f.from)
  add('created_at < ?', f.to)
  const rows = getDb()
    .prepare(`SELECT * FROM deals WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, f.limit ?? 500) as unknown as Row[]
  const names = new Map(getChats(accountId, [...new Set(rows.map((r) => r.chat_jid))]).map((c) => [c.jid, c.name]))
  for (const r of rows) {
    if (names.has(r.chat_jid)) continue
    const p = findPersonByJid(accountId, r.chat_jid)
    const d = r.chat_jid.split('@')[0]
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
    names.set(r.chat_jid, p?.name ?? (m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : '+' + d))
  }
  return rows.map((r) => toDeal(r, names))
}

export function salesSummary(accountId: string, from: number, to: number): SalesSummary {
  const db = getDb()
  const base = db
    .prepare(
      `SELECT SUM(CASE WHEN status='won' THEN amount_cents ELSE 0 END) AS rev, SUM(status='won') AS won, SUM(status='lost') AS lost
       FROM deals WHERE account_id = ? AND created_at >= ? AND created_at < ?`
    )
    .get(accountId, from, to) as { rev: number | null; won: number | null; lost: number | null }
  const won = base.won ?? 0
  const bySourceRows = db
    .prepare(
      `SELECT source_type, source_id, COALESCE(source_name, '') AS name, SUM(status='won') AS won,
        SUM(CASE WHEN status='won' THEN amount_cents ELSE 0 END) AS rev
       FROM deals WHERE account_id = ? AND created_at >= ? AND created_at < ? GROUP BY source_type, source_id ORDER BY rev DESC`
    )
    .all(accountId, from, to) as Array<{
    source_type: Deal['sourceType']
    source_id: number | null
    name: string
    won: number
    rev: number
  }>
  const sentFor = db.prepare("SELECT COUNT(*) AS n FROM campaign_targets WHERE campaign_id = ? AND status = 'sent'")
  const label = {
    organic: 'Atendimento espontâneo',
    group: 'Grupos',
    campaign: 'Campanha',
    reminder: 'Lembrete',
    ad: 'Anúncio'
  }
  const days = db
    .prepare(
      `SELECT created_at, amount_cents FROM deals WHERE account_id = ? AND status = 'won' AND created_at >= ? AND created_at < ?`
    )
    .all(accountId, from, to) as Array<{ created_at: number; amount_cents: number }>
  const byDayMap = new Map<string, { revenueCents: number; won: number }>()
  for (const d of days) {
    const k = dayKey(new Date(d.created_at))
    const cur = byDayMap.get(k) ?? { revenueCents: 0, won: 0 }
    cur.revenueCents += d.amount_cents
    cur.won++
    byDayMap.set(k, cur)
  }
  return {
    revenueCents: base.rev ?? 0,
    won,
    lost: base.lost ?? 0,
    avgTicketCents: won ? Math.round((base.rev ?? 0) / won) : 0,
    bySource: bySourceRows.map((r) => ({
      sourceType: r.source_type,
      sourceId: r.source_id,
      name: r.name || label[r.source_type],
      won: r.won,
      revenueCents: r.rev,
      sent: r.source_id ? (sentFor.get(r.source_id) as { n: number }).n : 0
    })),
    lostReasons: db
      .prepare(
        `SELECT reason, COUNT(*) AS count FROM deals WHERE account_id = ? AND status = 'lost' AND created_at >= ? AND created_at < ?
         GROUP BY reason ORDER BY count DESC`
      )
      .all(accountId, from, to) as Array<{ reason: string; count: number }>,
    byDay: [...byDayMap.entries()].sort().map(([day, v]) => ({ day, ...v }))
  }
}
