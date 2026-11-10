import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
  LeadItem,
  LeadsConfig,
  LeadsConfigInput,
  LeadsDimension,
  LeadsReport,
  LeadsReportRow,
  LeadsSyncResult
} from '@shared/types'
import { normalizePhone } from '@shared/rules'
import { getDb, getSetting, setSetting, transaction } from './db'
import { sealString, unsealString } from './secure'
import { listAccounts } from './accounts'
import { moduleLicensed } from './license'
import { savePerson } from './people'
import { addPeople, getPipeline, placementsOfPerson } from './pipelines'
import { log } from './log'

/**
 * Planilha de leads do site (Google Planilhas via Apps Script, com senha).
 * O script devolve só as linhas novas desde uma data; nada é público. Os leads ficam na tabela `leads`
 * e são cruzados pelo telefone (mesma normalização de people.ts) com conversas, contatos, funil e vendas.
 */

export const LEAD_TAG = 'Lead site'
const SYNC_EVERY_MS = 30 * 60_000
const FETCH_TIMEOUT_MS = 25_000
const MAX_BODY = 8 * 1024 * 1024
const MAX_LEADS_PER_CALL = 5000
const OVERLAP_MS = 86_400_000 // pede 1 dia a mais; a tabela descarta o que já veio

interface Stored {
  url: string
  secret: string // selada
  createContacts: boolean
  pipelineId: number | null
  cursor: number | null
  lastSyncAt: number | null
  lastError: string | null
  lastAdded: number
}

const EMPTY: Stored = {
  url: '',
  secret: '',
  createContacts: false,
  pipelineId: null,
  cursor: null,
  lastSyncAt: null,
  lastError: null,
  lastAdded: 0
}

const key = (acc: string): string => `leadsPlanilha:${acc}`
const load = (acc: string): Stored => ({ ...EMPTY, ...getSetting<Partial<Stored>>(key(acc), {}) })
const store = (acc: string, v: Stored): void => setSetting(key(acc), v)

export function getConfig(accountId: string): LeadsConfig {
  const c = load(accountId)
  return {
    url: c.url,
    hasSecret: !!c.secret,
    createContacts: c.createContacts,
    pipelineId: c.pipelineId,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
    lastAdded: c.lastAdded
  }
}

function checkUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('Endereço inválido. Cole o link do Apps Script (começa com https://script.google.com/).')
  }
  if (u.protocol !== 'https:' || u.hostname !== 'script.google.com')
    throw new Error('Use o link do Apps Script, que começa com https://script.google.com/')
  u.search = ''
  u.hash = ''
  return u.toString()
}

export function saveConfig(accountId: string, input: LeadsConfigInput): LeadsConfig {
  const cur = load(accountId)
  const url = checkUrl(input.url)
  const secret = input.secret?.trim() ? sealString(input.secret.trim()) : cur.secret
  if (!secret) throw new Error('Informe a senha do formulário')
  const createContacts = input.createContacts ?? cur.createContacts
  const pipelineId = input.pipelineId === undefined ? cur.pipelineId : input.pipelineId
  if (pipelineId != null) getPipeline(accountId, pipelineId) // confere que o funil é desta conta
  store(accountId, {
    ...cur,
    url,
    secret,
    createContacts,
    pipelineId,
    cursor: url === cur.url ? cur.cursor : null
  })
  return getConfig(accountId)
}

// ---------- Resposta do script ----------

const opt = (n: number): z.ZodType<string | null | undefined> =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? null : String(v).trim().slice(0, n) || null))

const rawLead = z.object({
  aba: z.string().max(60).default('Leads'),
  ts: z.number().int().positive(),
  nome: opt(120),
  email: opt(160),
  telefone: opt(40),
  interesse: opt(300),
  mensagem: opt(1000),
  utm_source: opt(120),
  utm_medium: opt(120),
  utm_campaign: opt(160),
  utm_content: opt(160),
  utm_term: opt(160),
  pagina: opt(300)
})
const envelope = z.object({ ok: z.boolean(), erro: z.string().optional(), leads: z.array(z.unknown()).optional() })

type RawLead = z.infer<typeof rawLead>

function dedupeKey(l: RawLead, phone: string | null): string {
  const who = phone ?? l.email?.toLowerCase() ?? ''
  return createHash('sha1')
    .update(`${l.aba}|${l.ts}|${who}|${(l.nome ?? '').toLowerCase()}`)
    .digest('hex')
}

async function fetchLeads(c: Stored): Promise<RawLead[]> {
  const u = new URL(checkUrl(c.url))
  u.searchParams.set('segredo', unsealString(c.secret))
  if (c.cursor) u.searchParams.set('desde', String(Math.max(0, c.cursor - OVERLAP_MS)))
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' })
  if (!res.ok) throw new Error(`A planilha respondeu com erro ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_BODY) throw new Error('A resposta da planilha veio grande demais')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('A planilha não respondeu como esperado. Confira o link e se o script foi atualizado.')
  }
  const env = envelope.safeParse(json)
  if (!env.success) throw new Error('A planilha não respondeu como esperado. Confira se o script foi atualizado.')
  if (!env.data.ok) throw new Error(env.data.erro?.slice(0, 200) || 'A planilha recusou o pedido (senha incorreta?)')
  const out: RawLead[] = []
  for (const r of (env.data.leads ?? []).slice(0, MAX_LEADS_PER_CALL)) {
    const p = rawLead.safeParse(r)
    if (p.success) out.push(p.data)
  }
  return out
}

// ---------- Sincronização ----------

const running = new Set<string>()

export async function syncLeads(accountId: string): Promise<LeadsSyncResult> {
  const c = load(accountId)
  if (!c.url || !c.secret)
    return { ok: false, added: 0, contacts: 0, error: 'Configure o link e a senha da planilha primeiro' }
  if (running.has(accountId)) return { ok: false, added: 0, contacts: 0, error: 'Já está atualizando' }
  running.add(accountId)
  try {
    const raws = await fetchLeads(c)
    const { added, contacts, maxTs } = saveRaws(accountId, raws, c)
    store(accountId, {
      ...load(accountId),
      cursor: Math.max(maxTs, c.cursor ?? 0) || c.cursor,
      lastSyncAt: Date.now(),
      lastError: null,
      lastAdded: added
    })
    return { ok: true, added, contacts }
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.name === 'TimeoutError'
          ? 'A planilha demorou demais para responder'
          : e.message
        : 'Erro desconhecido'
    log.warn('Falha ao atualizar a planilha de leads', { erro: msg })
    try {
      store(accountId, { ...load(accountId), lastSyncAt: Date.now(), lastError: msg })
    } catch {
      /* banco fechado: nada a fazer */
    }
    return { ok: false, added: 0, contacts: 0, error: msg }
  } finally {
    running.delete(accountId)
  }
}

function saveRaws(accountId: string, raws: RawLead[], c: Stored): { added: number; contacts: number; maxTs: number } {
  const db = getDb()
  const ins = db.prepare(
    `INSERT OR IGNORE INTO leads (account_id, dedupe_key, tab, created_at, name, email, phone, interest,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term, page, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const fresh: Array<{ name: string | null; phone: string | null }> = []
  let maxTs = 0
  transaction(db, () => {
    for (const l of raws) {
      const phone = normalizePhone(l.telefone)
      maxTs = Math.max(maxTs, l.ts)
      const r = ins.run(
        accountId,
        dedupeKey(l, phone),
        l.aba,
        l.ts,
        l.nome ?? null,
        l.email ?? null,
        phone,
        l.interesse ?? l.mensagem ?? null,
        l.utm_source ?? null,
        l.utm_medium ?? null,
        l.utm_campaign ?? null,
        l.utm_content ?? null,
        l.utm_term ?? null,
        l.pagina ?? null,
        Date.now()
      )
      if (Number(r.changes) > 0) fresh.push({ name: l.nome ?? null, phone })
    }
  })
  const contacts = c.createContacts ? makeContacts(accountId, fresh, c.pipelineId) : 0
  return { added: fresh.length, contacts, maxTs }
}

/** Lead novo vira contato com a etiqueta "Lead site" e cartão na primeira coluna do funil escolhido. */
function makeContacts(
  accountId: string,
  fresh: Array<{ name: string | null; phone: string | null }>,
  pipelineId: number | null
): number {
  const db = getDb()
  let firstStage: number | null = null
  if (pipelineId != null) {
    try {
      firstStage = getPipeline(accountId, pipelineId).stages[0]?.id ?? null
    } catch {
      firstStage = null // funil apagado: o contato é criado mesmo assim
    }
  }
  let n = 0
  for (const f of fresh) {
    if (!f.phone) continue
    try {
      if (db.prepare('SELECT 1 FROM people WHERE account_id = ? AND phone = ?').get(accountId, f.phone)) continue
      const p = savePerson(accountId, { name: f.name ?? '', phone: f.phone, tags: [LEAD_TAG] })
      if (firstStage != null) addPeople(accountId, firstStage, [p.id])
      n++
    } catch (e) {
      log.warn('Não foi possível criar o contato do lead', { erro: (e as Error).message })
    }
  }
  return n
}

let timer: ReturnType<typeof setInterval> | null = null

/** Atualiza todas as contas configuradas a cada 30 minutos. Nunca lança. */
export function startLeadsSync(): void {
  if (timer) return
  const tick = async (): Promise<void> => {
    try {
      for (const a of listAccounts()) {
        if (!a.modules.leadsPlanilha || !moduleLicensed('leadsPlanilha')) continue
        if (!load(a.id).url) continue
        await syncLeads(a.id)
      }
    } catch (e) {
      log.warn('Falha na atualização automática de leads', { erro: (e as Error).message })
    }
  }
  setTimeout(() => void tick(), 90_000).unref()
  timer = setInterval(() => void tick(), SYNC_EVERY_MS)
  timer.unref()
}

// ---------- Casamento pelo telefone ----------

interface LeadRow {
  id: number
  tab: string
  created_at: number
  name: string | null
  email: string | null
  phone: string | null
  interest: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  page: string | null
}

interface Match {
  chat: boolean
  personId: number | null
  pipeline: string | null
  stage: string | null
  deals: Array<{ at: number; cents: number }>
}

function matchPhone(accountId: string, phone: string): Match {
  const db = getDb()
  const jids = [`${phone}@s.whatsapp.net`]
  const lids = db.prepare('SELECT lid FROM lid_map WHERE account_id = ? AND pn = ?').all(accountId, jids[0]) as Array<{
    lid: string
  }>
  jids.push(...lids.map((l) => l.lid))
  const person = db.prepare('SELECT id, jid FROM people WHERE account_id = ? AND phone = ?').get(accountId, phone) as
    { id: number; jid: string | null } | undefined
  if (person?.jid && !jids.includes(person.jid)) jids.push(person.jid)
  const ph = jids.map(() => '?').join(',')
  const chat = !!db
    .prepare(`SELECT 1 FROM chats WHERE account_id = ? AND jid IN (${ph}) LIMIT 1`)
    .get(accountId, ...jids)
  const deals = (
    db
      .prepare(
        `SELECT created_at, amount_cents FROM deals WHERE account_id = ? AND status = 'won' AND chat_jid IN (${ph})`
      )
      .all(accountId, ...jids) as Array<{ created_at: number; amount_cents: number }>
  ).map((d) => ({ at: d.created_at, cents: d.amount_cents }))
  const place = person ? placementsOfPerson(accountId, person.id)[0] : undefined
  return {
    chat,
    personId: person?.id ?? null,
    pipeline: place?.pipelineName ?? null,
    stage: place?.stageName ?? null,
    deals
  }
}

function enrich(accountId: string, rows: LeadRow[]): LeadItem[] {
  const cache = new Map<string, Match>()
  return rows.map((r) => {
    let m: Match | null = null
    if (r.phone) {
      m = cache.get(r.phone) ?? matchPhone(accountId, r.phone)
      cache.set(r.phone, m)
    }
    const mine = m?.deals.filter((d) => d.at >= r.created_at) ?? []
    return {
      id: r.id,
      createdAt: r.created_at,
      tab: r.tab,
      name: r.name,
      email: r.email,
      phone: r.phone,
      interest: r.interest,
      utmSource: r.utm_source,
      utmMedium: r.utm_medium,
      utmCampaign: r.utm_campaign,
      utmContent: r.utm_content,
      utmTerm: r.utm_term,
      page: r.page,
      chat: m?.chat ?? false,
      personId: m?.personId ?? null,
      pipeline: m?.pipeline ?? null,
      stage: m?.stage ?? null,
      won: mine.length > 0,
      valueCents: mine.reduce((s, d) => s + d.cents, 0)
    }
  })
}

function select(accountId: string, q: { from?: number; to?: number }): { sql: string; args: number[] | string[] } {
  const where = ['account_id = ?']
  const args: Array<string | number> = [accountId]
  if (q.from != null) {
    where.push('created_at >= ?')
    args.push(q.from)
  }
  if (q.to != null) {
    where.push('created_at < ?')
    args.push(q.to)
  }
  return { sql: where.join(' AND '), args: args as string[] }
}

export function listLeads(
  accountId: string,
  q: { from?: number; to?: number; limit?: number; offset?: number }
): { items: LeadItem[]; total: number } {
  const db = getDb()
  const { sql, args } = select(accountId, q)
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE ${sql}`).get(...args) as { n: number }).n
  const rows = db
    .prepare(`SELECT * FROM leads WHERE ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, Math.min(q.limit ?? 200, 1000), q.offset ?? 0) as unknown as LeadRow[]
  return { items: enrich(accountId, rows), total }
}

// ---------- Relatório por UTM ----------

const BLANK: Record<LeadsDimension, string> = {
  source: '(sem origem)',
  campaign: '(sem campanha)',
  content: '(sem conteúdo)'
}

function row(key: string): LeadsReportRow {
  return { key, leads: 0, talked: 0, bought: 0, revenueCents: 0, rate: 0 }
}

export function leadsReport(accountId: string, q: { from?: number; to?: number }): LeadsReport {
  const { sql, args } = select(accountId, q)
  const rows = getDb()
    .prepare(`SELECT * FROM leads WHERE ${sql} ORDER BY created_at ASC, id ASC LIMIT 100000`)
    .all(...args) as unknown as LeadRow[]
  const items = enrich(accountId, rows)
  const total = row('Total')
  const groups: Record<LeadsDimension, Map<string, LeadsReportRow>> = {
    source: new Map(),
    campaign: new Map(),
    content: new Map()
  }
  const seen = new Set<string>()
  for (const it of items) {
    // A mesma pessoa que preenche o formulário duas vezes conta como lead duas vezes, mas a compra vale uma só
    const first = !it.phone || !seen.has(it.phone)
    if (it.phone) seen.add(it.phone)
    const vals: Record<LeadsDimension, string | null> = {
      source: it.utmSource,
      campaign: it.utmCampaign,
      content: it.utmContent
    }
    const targets = [total]
    for (const d of Object.keys(groups) as LeadsDimension[]) {
      const k = vals[d]?.trim().toLowerCase() || BLANK[d]
      let g = groups[d].get(k)
      if (!g) groups[d].set(k, (g = row(k)))
      targets.push(g)
    }
    for (const t of targets) {
      t.leads++
      if (it.chat) t.talked++
      if (it.won && first) {
        t.bought++
        t.revenueCents += it.valueCents
      }
    }
  }
  const fin = (r: LeadsReportRow): LeadsReportRow => ({ ...r, rate: r.leads ? r.bought / r.leads : 0 })
  const sorted = (m: Map<string, LeadsReportRow>): LeadsReportRow[] =>
    [...m.values()]
      .map(fin)
      .sort((a, b) => b.leads - a.leads || b.revenueCents - a.revenueCents || a.key.localeCompare(b.key))
  return {
    total: fin(total),
    bySource: sorted(groups.source),
    byCampaign: sorted(groups.campaign),
    byContent: sorted(groups.content)
  }
}

const HEAD: Record<LeadsDimension, string> = { source: 'Origem', campaign: 'Campanha', content: 'Conteúdo' }

export function reportCsv(accountId: string, dim: LeadsDimension, q: { from?: number; to?: number }): string {
  const rep = leadsReport(accountId, q)
  const list = dim === 'source' ? rep.bySource : dim === 'campaign' ? rep.byCampaign : rep.byContent
  const esc = (v: unknown): string => {
    let s = String(v ?? '')
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // evita fórmula maliciosa ao abrir no Excel
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const num = (n: number): string => n.toFixed(2).replace('.', ',')
  const head = [HEAD[dim], 'Leads', 'Conversaram', 'Compraram', 'Faturamento', 'Taxa de compra']
  const line = (r: LeadsReportRow): string =>
    [r.key, r.leads, r.talked, r.bought, num(r.revenueCents / 100), `${num(r.rate * 100)}%`].map(esc).join(';')
  return '﻿' + [head.map(esc).join(';'), ...list.map(line), line(rep.total)].join('\r\n')
}
