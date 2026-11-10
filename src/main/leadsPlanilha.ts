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
import { bulkTag, savePerson } from './people'
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
const MAX_LEADS_PER_CALL = 2000
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
  pendingSince?: number
  pendingOffset?: number
}

interface Pending {
  name: string | null
  phone: string | null
  tries?: number
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
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'script.google.com' ||
    u.username ||
    u.password ||
    u.port ||
    /:\d+(?:[/?#]|$)/.test(raw)
  )
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
    .transform((v) =>
      v == null
        ? null
        : String(v)
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
            .trim()
            .slice(0, n) || null
    )

const rawLead = z.object({
  aba: z.string().max(60).default('Leads'),
  ts: z
    .number()
    .int()
    .positive()
    .refine((ts) => ts <= Date.now() + 86_400_000),
  nome: opt(120),
  email: opt(160).transform((v) => (v && z.email().safeParse(v).success ? v : null)),
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

/** Conta elementos antes de JSON.parse materializar arrays controlados pela rede. */
function checkArrayLimits(text: string): void {
  const stack: Array<{ array: boolean; count: number; next: boolean }> = []
  let quoted = false
  let escaped = false
  for (const ch of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') quoted = false
      continue
    }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue
    const top = stack.at(-1)
    if (top?.array && top.next && ch !== ']') {
      top.next = false
      if (++top.count > MAX_LEADS_PER_CALL) throw new Error('A resposta excedeu o limite de linhas da planilha')
    }
    if (ch === '"') quoted = true
    else if (ch === '[' || ch === '{') stack.push({ array: ch === '[', count: 0, next: true })
    else if (ch === ']' || ch === '}') stack.pop()
    else if (ch === ',' && top?.array) top.next = true
  }
}

async function readLimitedBody(res: Response): Promise<string> {
  const tooLarge = (): Error => new Error('A resposta da planilha veio grande demais')
  if (Number(res.headers.get('content-length')) > MAX_BODY) {
    await res.body?.cancel()
    throw tooLarge()
  }
  if (!res.body) throw new Error('A planilha respondeu sem conteúdo')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_BODY) {
        await reader.cancel()
        throw tooLarge()
      }
      text += decoder.decode(part.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function fetchLeads(c: Stored, desde: number, offset: number): Promise<{ raws: RawLead[]; count: number }> {
  let u = new URL(checkUrl(c.url))
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  let res: Response
  for (let hop = 0; ; hop++) {
    res = await fetch(u.toString(), {
      signal,
      redirect: 'manual',
      method: hop === 0 ? 'POST' : 'GET',
      ...(hop === 0
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operacao: 'leads', segredo: unsealString(c.secret), desde, offset })
          }
        : {})
    })
    if (![301, 302, 303, 307, 308].includes(res.status)) break
    const location = res.headers.get('location')
    await res.body?.cancel()
    if (hop >= 2 || !location) throw new Error('Redirecionamento da planilha não permitido')
    const next = new URL(location, u)
    if (
      next.protocol !== 'https:' ||
      next.port ||
      next.username ||
      next.password ||
      /:\d+(?:[/?#]|$)/.test(location) ||
      !(next.hostname === 'script.google.com' || next.hostname.endsWith('.googleusercontent.com'))
    )
      throw new Error('Redirecionamento da planilha não permitido')
    // URLs de resposta nunca recebem o segredo, nem mesmo ao voltar ao host inicial.
    next.searchParams.delete('segredo')
    u = next
  }
  if (!res.ok) throw new Error(`A planilha respondeu com erro ${res.status}`)
  const text = await readLimitedBody(res)
  checkArrayLimits(text)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('A planilha não respondeu como esperado. Confira o link e se o script foi atualizado.')
  }
  const env = envelope.safeParse(json)
  if (!env.success) throw new Error('A planilha não respondeu como esperado. Confira se o script foi atualizado.')
  if (!env.data.ok) throw new Error('Não autorizado')
  const out: RawLead[] = []
  let discarded = 0
  for (const r of env.data.leads ?? []) {
    const p = rawLead.safeParse(r)
    if (p.success) out.push(p.data)
    else discarded++
  }
  if (discarded) log.warn('Linhas inválidas descartadas da planilha de leads', { quantidade: discarded })
  return { raws: out, count: env.data.leads?.length ?? 0 }
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
    const desde = c.pendingSince ?? Math.max(0, (c.cursor ?? 0) - OVERLAP_MS)
    let offset = c.pendingOffset ?? 0
    let added = 0
    let contacts = 0
    let cursor = c.cursor ?? 0
    for (let page = 0; page < 10; page++) {
      const batch = await fetchLeads(c, desde, offset)
      const saved = saveRaws(accountId, batch.raws, c)
      added += saved.added
      contacts += saved.contacts
      cursor = Math.max(cursor, saved.maxTs)
      offset += batch.count
      const full = batch.count === MAX_LEADS_PER_CALL
      store(accountId, {
        ...load(accountId),
        cursor: cursor || c.cursor,
        pendingSince: full ? desde : undefined,
        pendingOffset: full ? offset : undefined,
        lastSyncAt: Date.now(),
        lastError: null,
        lastAdded: added
      })
      if (!full) break
    }
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
  const fresh: Pending[] = []
  let maxTs = 0
  const pendingKey = `leadsContactsPending:${accountId}`
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
    if (c.createContacts) {
      const pending = getSetting<Pending[]>(pendingKey, [])
      setSetting(pendingKey, [...pending, ...fresh])
    }
  })
  const contacts = c.createContacts ? makeContacts(accountId, getSetting(pendingKey, []), c.pipelineId) : 0
  return { added: fresh.length, contacts, maxTs }
}

/** Lead novo vira contato com a etiqueta "Lead site" e cartão na primeira coluna do funil escolhido. */
function makeContacts(accountId: string, fresh: Pending[], pipelineId: number | null): number {
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
  const pendingKey = `leadsContactsPending:${accountId}`
  const remaining: Pending[] = []
  const save = (rest: Pending[]): void => setSetting(pendingKey, [...rest, ...remaining])
  for (let i = 0; i < fresh.length; i++) {
    const f = fresh[i]
    const rest = fresh.slice(i + 1)
    if (!f.phone) {
      save(rest)
      continue
    }
    try {
      const phones = phoneVariants(f.phone)
      const existing = db
        .prepare(`SELECT id FROM people WHERE account_id = ? AND phone IN (${phones.map(() => '?').join(',')})`)
        .get(accountId, ...phones) as { id: number } | undefined
      const p = existing ?? savePerson(accountId, { name: f.name ?? '', phone: f.phone, tags: [LEAD_TAG] })
      if (existing) bulkTag(accountId, [p.id], LEAD_TAG, true)
      if (firstStage != null) addPeople(accountId, firstStage, [p.id])
      n++
    } catch {
      // Sem dado pessoal no log. Tenta de novo na próxima atualização, até 3 vezes, sem travar os outros leads
      const tries = (f.tries ?? 0) + 1
      log.warn('Não foi possível criar o contato de um lead', { tentativa: tries })
      if (tries < 3) remaining.push({ ...f, tries })
    }
    save(rest)
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
  lastTs: number
  personId: number | null
  pipeline: string | null
  stage: string | null
  deals: Array<{ at: number; cents: number }>
}

/** Telefones brasileiros antigos e atuais podem representar o mesmo WhatsApp. */
function phoneVariants(phone: string): string[] {
  const variants = [phone]
  if (phone.startsWith('55')) {
    if (phone.length === 13 && phone[4] === '9') variants.push(phone.slice(0, 4) + phone.slice(5))
    else if (phone.length === 12) variants.push(phone.slice(0, 4) + '9' + phone.slice(4))
  }
  return variants
}

export function phoneIdentity(phone: string): string {
  return phoneVariants(phone).sort((a, b) => a.length - b.length)[0]
}

function matchPhones(accountId: string, phones: string[], includePlacement: boolean): Map<string, Match> {
  const db = getDb()
  const matches = new Map<string, Match>()
  for (let start = 0; start < phones.length; start += 200) {
    const batch = phones.slice(start, start + 200)
    const byPhone = new Map<string, Match[]>()
    const byJid = new Map<string, Match[]>()
    const link = (map: Map<string, Match[]>, key: string, match: Match): void => {
      const values = map.get(key) ?? []
      if (!values.includes(match)) values.push(match)
      map.set(key, values)
    }
    for (const phone of batch) {
      const match: Match = { lastTs: 0, personId: null, pipeline: null, stage: null, deals: [] }
      matches.set(phone, match)
      for (const variant of phoneVariants(phone)) {
        link(byPhone, variant, match)
        link(byJid, `${variant}@s.whatsapp.net`, match)
      }
    }
    const marks = (values: unknown[]): string => values.map(() => '?').join(',')
    const numbers = [...byPhone.keys()]
    const initialJids = [...byJid.keys()]
    const persons = db
      .prepare(
        `SELECT id, phone, jid FROM people WHERE account_id = ? AND (phone IN (${marks(numbers)}) OR jid IN (${marks(initialJids)}))`
      )
      .all(accountId, ...numbers, ...initialJids) as Array<{ id: number; phone: string; jid: string | null }>
    for (const person of persons) {
      const targets = new Set([...(byPhone.get(person.phone) ?? []), ...(byJid.get(person.jid ?? '') ?? [])])
      for (const match of targets) {
        match.personId ??= person.id
        if (person.jid) link(byJid, person.jid, match)
        if (includePlacement && match.stage == null) {
          const place = placementsOfPerson(accountId, person.id)[0]
          match.pipeline = place?.pipelineName ?? null
          match.stage = place?.stageName ?? null
        }
      }
    }
    const pns = [...byJid.keys()]
    const lids = db
      .prepare(`SELECT lid, pn FROM lid_map WHERE account_id = ? AND pn IN (${marks(pns)})`)
      .all(accountId, ...pns) as Array<{ lid: string; pn: string }>
    for (const lid of lids) for (const match of byJid.get(lid.pn) ?? []) link(byJid, lid.lid, match)
    // Blocos também nos JIDs: o mapeamento de LIDs pode ampliar a lista.
    const jids = [...byJid.keys()]
    for (let offset = 0; offset < jids.length; offset += 400) {
      const part = jids.slice(offset, offset + 400)
      const chats = db
        .prepare(`SELECT jid, last_ts FROM chats WHERE account_id = ? AND jid IN (${marks(part)})`)
        .all(accountId, ...part) as Array<{ jid: string; last_ts: number | null }>
      for (const chat of chats)
        for (const match of byJid.get(chat.jid) ?? []) match.lastTs = Math.max(match.lastTs, (chat.last_ts ?? 0) * 1000) // last_ts fica em segundos
      const deals = db
        .prepare(
          `SELECT chat_jid, created_at, amount_cents FROM deals WHERE account_id = ? AND status = 'won' AND chat_jid IN (${marks(part)})`
        )
        .all(accountId, ...part) as Array<{ chat_jid: string; created_at: number; amount_cents: number }>
      for (const deal of deals)
        for (const match of byJid.get(deal.chat_jid) ?? [])
          match.deals.push({ at: deal.created_at, cents: deal.amount_cents })
    }
  }
  return matches
}

function enrich(accountId: string, rows: LeadRow[], includePlacement = true): LeadItem[] {
  const cache = matchPhones(accountId, [...new Set(rows.flatMap((r) => (r.phone ? [r.phone] : [])))], includePlacement)
  return rows.map((r) => {
    const m = r.phone ? cache.get(r.phone) : undefined
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
      chat: m != null && m.lastTs >= r.created_at,
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
  const total = row('Total')
  const groups: Record<LeadsDimension, Map<string, LeadsReportRow>> = {
    source: new Map(),
    campaign: new Map(),
    content: new Map()
  }
  const seen = new Set<string>()
  let lastAt = 0
  let lastId = 0
  while (true) {
    const rows = getDb()
      .prepare(
        `SELECT * FROM leads WHERE ${sql} AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC LIMIT 2000`
      )
      .all(...args, lastAt, lastAt, lastId) as unknown as LeadRow[]
    if (!rows.length) break
    const items = enrich(accountId, rows, false)
    for (const it of items) {
      // A mesma pessoa que preenche o formulário duas vezes conta como lead duas vezes, mas a compra vale uma só
      const identity = it.phone ? phoneIdentity(it.phone) : null
      const first = identity != null && !seen.has(identity)
      if (identity) seen.add(identity)
      const vals: Record<LeadsDimension, string | null> = {
        source: it.utmSource,
        campaign: it.utmCampaign,
        content: it.utmContent
      }
      const targets = [total]
      for (const d of Object.keys(groups) as LeadsDimension[]) {
        const value = vals[d]?.trim().toLowerCase() || null
        const k = value == null ? 'blank:' : `value:${value}`
        const label =
          value == null
            ? BLANK[d]
            : Object.values(BLANK).includes(value) || value.startsWith('valor informado:')
              ? `valor informado: ${value}`
              : value
        let g = groups[d].get(k)
        if (!g) groups[d].set(k, (g = row(label)))
        targets.push(g)
      }
      for (const t of targets) {
        t.leads++
        if (it.chat && first) t.talked++
        if (it.won && first) {
          t.bought++
          t.revenueCents += it.valueCents
        }
      }
    }
    const last = rows[rows.length - 1]
    lastAt = last.created_at
    lastId = last.id
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
    if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s // evita fórmula maliciosa ao abrir no Excel
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const num = (n: number): string => n.toFixed(2).replace('.', ',')
  const head = [HEAD[dim], 'Leads', 'Conversaram', 'Compraram', 'Faturamento', 'Taxa de compra']
  const line = (r: LeadsReportRow): string =>
    [r.key, r.leads, r.talked, r.bought, num(r.revenueCents / 100), `${num(r.rate * 100)}%`].map(esc).join(';')
  return '﻿' + [head.map(esc).join(';'), ...list.map(line), line(rep.total)].join('\r\n')
}
