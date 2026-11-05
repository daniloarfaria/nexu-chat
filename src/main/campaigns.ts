import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AntiBanSettings,
  Campaign,
  CampaignAudience,
  CampaignInput,
  CampaignMedia,
  CampaignStats,
  CampaignTarget,
  TargetStatus
} from '@shared/types'
import { getDb, getSetting, setSetting, transaction } from './db'
import { DEFAULT_ANTIBAN, dayKey, firstName } from '@shared/rules'
import { getAccount } from './accounts'

// ---------- Proteção anti-bloqueio (por conta) ----------

export function getAntiBan(accountId: string): AntiBanSettings {
  return { ...DEFAULT_ANTIBAN, ...getSetting<Partial<AntiBanSettings>>(`antiban:${accountId}`, {}) }
}

export function setAntiBan(accountId: string, patch: Partial<AntiBanSettings>): AntiBanSettings {
  const cur = getAntiBan(accountId)
  const next = { ...cur, ...patch }
  if (patch.warmup && !cur.warmup) next.warmupStartedAt = Date.now()
  if (patch.warmup === false) next.warmupStartedAt = null
  next.maxDelay = Math.max(next.maxDelay, next.minDelay)
  next.pauseMax = Math.max(next.pauseMax, next.pauseMin)
  next.hourEnd = Math.max(next.hourEnd, next.hourStart + 1)
  setSetting(`antiban:${accountId}`, next)
  return next
}

export function sentToday(accountId: string): number {
  const r = getDb().prepare('SELECT sent FROM send_log WHERE account_id = ? AND day = ?').get(accountId, dayKey()) as
    { sent: number } | undefined
  return r?.sent ?? 0
}

export function countSend(accountId: string): void {
  getDb()
    .prepare('INSERT INTO send_log (account_id, day, sent) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET sent = sent + 1')
    .run(accountId, dayKey())
}

// ---------- Campanhas ----------

interface Row {
  id: number
  account_id: string
  name: string
  kind: Campaign['kind']
  status: Campaign['status']
  templates: string
  media: string | null
  audience: string
  opt_out_footer: number
  scheduled_at: number | null
  started_at: number | null
  finished_at: number | null
  paused_reason: string | null
  created_at: number
}

export function campaignStats(id: number): CampaignStats {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(status = 'pending') AS pending, SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed,
        SUM(status = 'skipped') AS skipped, SUM(status = 'no_wa') AS noWa, SUM(status = 'opted_out') AS optedOut,
        SUM(delivered_at IS NOT NULL) AS delivered, SUM(read_at IS NOT NULL) AS read, SUM(replied_at IS NOT NULL) AS replied
       FROM campaign_targets WHERE campaign_id = ?`
    )
    .get(id) as Record<string, number | null>
  const n = (k: string): number => Number(r[k] ?? 0)
  return {
    total: n('total'),
    pending: n('pending'),
    sent: n('sent'),
    failed: n('failed'),
    skipped: n('skipped'),
    noWa: n('noWa'),
    optedOut: n('optedOut'),
    delivered: n('delivered'),
    read: n('read'),
    replied: n('replied')
  }
}

function toCampaign(r: Row): Campaign {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    kind: r.kind,
    status: r.status,
    templates: JSON.parse(r.templates) as string[],
    media: r.media ? (JSON.parse(r.media) as CampaignMedia) : null,
    audience: JSON.parse(r.audience) as CampaignAudience,
    optOutFooter: !!r.opt_out_footer,
    scheduledAt: r.scheduled_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    pausedReason: r.paused_reason,
    createdAt: r.created_at,
    stats: campaignStats(r.id)
  }
}

export function listCampaigns(accountId: string, kind?: Campaign['kind']): Campaign[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM campaigns WHERE account_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY created_at DESC LIMIT 300`
    )
    .all(...(kind ? [accountId, kind] : [accountId])) as unknown as Row[]
  return rows.map(toCampaign)
}

export function getCampaign(id: number): Campaign | null {
  const r = getDb().prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as Row | undefined
  return r ? toCampaign(r) : null
}

export function saveCampaign(input: CampaignInput & { kind?: Campaign['kind']; source?: string }): Campaign {
  const db = getDb()
  const templates = input.templates.map((t) => t.trim()).filter(Boolean)
  if (!templates.length) throw new Error('Escreva pelo menos uma mensagem')
  if (input.id) {
    const cur = getCampaign(input.id)
    if (!cur || cur.accountId !== input.accountId) throw new Error('Campanha não encontrada')
    if (cur.status !== 'draft' && cur.status !== 'scheduled')
      throw new Error('Só é possível editar campanhas que ainda não começaram')
    db.prepare(
      'UPDATE campaigns SET name = ?, templates = ?, audience = ?, opt_out_footer = ?, scheduled_at = ? WHERE id = ?'
    ).run(
      input.name.trim(),
      JSON.stringify(templates),
      JSON.stringify(input.audience),
      input.optOutFooter ? 1 : 0,
      input.scheduledAt,
      input.id
    )
    return getCampaign(input.id)!
  }
  const id = Number(
    db
      .prepare(
        `INSERT INTO campaigns (account_id, name, kind, templates, audience, opt_out_footer, scheduled_at, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.accountId,
        input.name.trim(),
        input.kind ?? (input.audience.type === 'groups' ? 'groups' : 'people'),
        JSON.stringify(templates),
        JSON.stringify(input.audience),
        input.optOutFooter ? 1 : 0,
        input.scheduledAt,
        input.source ?? null,
        Date.now()
      ).lastInsertRowid
  )
  return getCampaign(id)!
}

function mediaDir(): string {
  return join(app.getPath('userData'), 'campaign-media')
}

export function mediaPath(m: CampaignMedia): string {
  return join(mediaDir(), m.file)
}

export function setCampaignMedia(id: number, file: { name: string; mime: string; data: Uint8Array } | null): Campaign {
  const cur = getCampaign(id)
  if (!cur) throw new Error('Campanha não encontrada')
  if (cur.status !== 'draft' && cur.status !== 'scheduled') throw new Error('A campanha já começou')
  if (cur.media) rmSync(mediaPath(cur.media), { force: true })
  let media: CampaignMedia | null = null
  if (file) {
    if (file.data.length > 64 * 1024 * 1024) throw new Error('Arquivo maior que 64 MB')
    mkdirSync(mediaDir(), { recursive: true })
    const ext = (file.name.split('.').pop() ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin'
    media = { name: file.name.slice(0, 200), mime: file.mime, file: `${randomUUID()}.${ext}`, size: file.data.length }
    writeFileSync(mediaPath(media), file.data)
  }
  getDb()
    .prepare('UPDATE campaigns SET media = ? WHERE id = ?')
    .run(media ? JSON.stringify(media) : null, id)
  return getCampaign(id)!
}

export function deleteCampaign(id: number): void {
  const cur = getCampaign(id)
  if (!cur) return
  if (cur.status === 'running') throw new Error('Pause a campanha antes de excluir')
  if (cur.media) rmSync(mediaPath(cur.media), { force: true })
  getDb().prepare('DELETE FROM campaigns WHERE id = ?').run(id)
}

/** Quantas pessoas a campanha atingiria (para mostrar antes de enviar). */
export function countAudience(accountId: string, a: CampaignAudience): { total: number; optedOut: number } {
  const { sql, args } = audienceSql(accountId, a)
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS total, SUM(${OPTED_SQL}) AS optedOut FROM people p WHERE ${sql}`)
    .get(...args) as { total: number; optedOut: number | null }
  return { total: r.total, optedOut: r.optedOut ?? 0 }
}

// Pediu para sair: marcado no contato ou presente na lista de supressão (número ou JID)
const OPTED_SQL = `(p.opt_out = 1 OR EXISTS (SELECT 1 FROM suppression s WHERE s.account_id = p.account_id AND (s.key = p.phone OR s.key = p.jid)))`

function audienceSql(accountId: string, a: CampaignAudience): { sql: string; args: Array<string | number> } {
  const where = ['p.account_id = ?']
  const args: Array<string | number> = [accountId]
  if (a.type === 'tags' && a.tags?.length) {
    where.push(
      `EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag IN (${a.tags.map(() => '?').join(',')}))`
    )
    args.push(...a.tags)
  } else if (a.type === 'tags') {
    where.push('0')
  }
  if (a.type === 'list') {
    const ids = (a.personIds ?? []).slice(0, 50_000)
    where.push('p.id IN (SELECT value FROM json_each(?))')
    args.push(JSON.stringify(ids))
  }
  if (a.excludeTags?.length) {
    where.push(
      `NOT EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag IN (${a.excludeTags.map(() => '?').join(',')}))`
    )
    args.push(...a.excludeTags)
  }
  return { sql: where.join(' AND '), args }
}

/** Gera a lista de destinatários (uma vez, ao iniciar). */
function buildTargets(c: Campaign): void {
  const db = getDb()
  const ins = db.prepare(
    'INSERT INTO campaign_targets (campaign_id, seq, person_id, jid, phone, name, vars, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const account = getAccount(c.accountId)
  transaction(db, () => {
    if (c.audience.type === 'groups') {
      const groups = c.audience.groups ?? []
      groups.forEach((g, i) => {
        const row = db
          .prepare('SELECT subject FROM groups_cache WHERE account_id = ? AND jid = ?')
          .get(c.accountId, g) as { subject: string | null } | undefined
        ins.run(
          c.id,
          i + 1,
          null,
          g,
          null,
          row?.subject ?? 'Grupo',
          JSON.stringify({ loja: account?.name ?? '' }),
          'pending'
        )
      })
      return
    }
    const { sql, args } = audienceSql(c.accountId, c.audience)
    const people = db
      .prepare(
        `SELECT id, phone, jid, name, birthday, fields, ${OPTED_SQL} AS opt_out FROM people p WHERE ${sql} ORDER BY p.id`
      )
      .all(...args) as Array<{
      id: number
      phone: string
      jid: string | null
      name: string | null
      birthday: string | null
      fields: string | null
      opt_out: number
    }>
    let seq = 0
    for (const p of people) {
      const vars = {
        ...(p.fields ? (JSON.parse(p.fields) as Record<string, string>) : {}),
        nome: p.name ?? '',
        primeiro_nome: firstName(p.name),
        loja: account?.name ?? '',
        telefone: p.phone
      }
      ins.run(c.id, ++seq, p.id, p.jid, p.phone, p.name, JSON.stringify(vars), p.opt_out ? 'opted_out' : 'pending')
    }
  })
}

export function startCampaign(id: number): Campaign {
  const c = getCampaign(id)
  if (!c) throw new Error('Campanha não encontrada')
  if (c.status === 'running') return c
  if (c.status === 'done' || c.status === 'canceled') throw new Error('Esta campanha já terminou')
  if (c.stats.total === 0) buildTargets(c)
  const fresh = getCampaign(id)!
  if (fresh.stats.total === 0) throw new Error('Nenhum contato no público escolhido')
  const future = c.scheduledAt && c.scheduledAt > Date.now() && c.status === 'draft'
  getDb()
    .prepare('UPDATE campaigns SET status = ?, started_at = COALESCE(started_at, ?), paused_reason = NULL WHERE id = ?')
    .run(future ? 'scheduled' : 'running', future ? null : Date.now(), id)
  return getCampaign(id)!
}

export function pauseCampaign(id: number, reason: string | null = null): void {
  getDb()
    .prepare(
      "UPDATE campaigns SET status = 'paused', paused_reason = ? WHERE id = ? AND status IN ('running','scheduled')"
    )
    .run(reason, id)
}

export function cancelCampaign(id: number): void {
  const db = getDb()
  transaction(db, () => {
    db.prepare(
      "UPDATE campaigns SET status = 'canceled', finished_at = ? WHERE id = ? AND status NOT IN ('done','canceled')"
    ).run(Date.now(), id)
    db.prepare("UPDATE campaign_targets SET status = 'skipped' WHERE campaign_id = ? AND status = 'pending'").run(id)
  })
}

export function finishCampaign(id: number): void {
  getDb().prepare("UPDATE campaigns SET status = 'done', finished_at = ? WHERE id = ?").run(Date.now(), id)
}

export function retryFailed(id: number): Campaign {
  getDb()
    .prepare("UPDATE campaign_targets SET status = 'pending', error = NULL WHERE campaign_id = ? AND status = 'failed'")
    .run(id)
  getDb().prepare("UPDATE campaigns SET status = 'paused', finished_at = NULL WHERE id = ? AND status = 'done'").run(id)
  return getCampaign(id)!
}

/** Campanhas agendadas que já podem começar. */
export function promoteScheduled(accountId: string): void {
  getDb()
    .prepare(
      "UPDATE campaigns SET status = 'running', started_at = ? WHERE account_id = ? AND status = 'scheduled' AND scheduled_at <= ?"
    )
    .run(Date.now(), accountId, Date.now())
}

export function nextRunning(accountId: string): Campaign | null {
  const r = getDb()
    .prepare("SELECT * FROM campaigns WHERE account_id = ? AND status = 'running' ORDER BY started_at, id LIMIT 1")
    .get(accountId) as Row | undefined
  return r ? toCampaign(r) : null
}

export interface PendingTarget {
  seq: number
  person_id: number | null
  jid: string | null
  phone: string | null
  name: string | null
  vars: string | null
}

export function nextTarget(campaignId: number): PendingTarget | null {
  return (
    (getDb()
      .prepare(
        "SELECT seq, person_id, jid, phone, name, vars FROM campaign_targets WHERE campaign_id = ? AND status = 'pending' ORDER BY seq LIMIT 1"
      )
      .get(campaignId) as PendingTarget | undefined) ?? null
  )
}

export function markTarget(
  campaignId: number,
  seq: number,
  status: TargetStatus,
  extra: { messageId?: string; error?: string; jid?: string } = {}
): void {
  getDb()
    .prepare(
      `UPDATE campaign_targets SET status = ?, message_id = COALESCE(?, message_id), error = ?, jid = COALESCE(?, jid),
       sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE campaign_id = ? AND seq = ?`
    )
    .run(status, extra.messageId ?? null, extra.error ?? null, extra.jid ?? null, status, Date.now(), campaignId, seq)
}

export function listTargets(
  campaignId: number,
  status: TargetStatus | 'all',
  limit: number,
  offset: number
): CampaignTarget[] {
  const rows = getDb()
    .prepare(
      `SELECT seq, name, phone, jid, status, error, sent_at, delivered_at, read_at, replied_at FROM campaign_targets
       WHERE campaign_id = ? ${status === 'all' ? '' : 'AND status = ?'} ORDER BY seq LIMIT ? OFFSET ?`
    )
    .all(...(status === 'all' ? [campaignId, limit, offset] : [campaignId, status, limit, offset])) as Array<
    Record<string, unknown>
  >
  return rows.map((r) => ({
    seq: r.seq as number,
    name: (r.name as string) ?? null,
    phone: (r.phone as string) ?? ((r.jid as string) ?? '').split('@')[0],
    status: r.status as TargetStatus,
    error: (r.error as string) ?? null,
    sentAt: (r.sent_at as number) ?? null,
    deliveredAt: (r.delivered_at as number) ?? null,
    readAt: (r.read_at as number) ?? null,
    repliedAt: (r.replied_at as number) ?? null
  }))
}

const STATUS_LABEL: Record<TargetStatus, string> = {
  pending: 'Na fila',
  sent: 'Enviada',
  failed: 'Falhou',
  skipped: 'Cancelada',
  no_wa: 'Sem WhatsApp',
  opted_out: 'Pediu para não receber'
}

export function exportReport(campaignId: number): string {
  const rows = listTargets(campaignId, 'all', 1_000_000, 0)
  const t = (v: number | null): string => (v ? new Date(v).toLocaleString('pt-BR') : '')
  const esc = (v: unknown): string => {
    let s = String(v ?? '')
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Nome', 'Telefone', 'Situação', 'Enviada em', 'Entregue em', 'Lida em', 'Respondeu em', 'Erro']
  const lines = rows.map((r) =>
    [r.name, r.phone, STATUS_LABEL[r.status], t(r.sentAt), t(r.deliveredAt), t(r.readAt), t(r.repliedAt), r.error]
      .map(esc)
      .join(';')
  )
  return '﻿' + [head.join(';'), ...lines].join('\r\n')
}

// ---------- Acompanhamento: entrega, leitura e resposta ----------

export function onCampaignReceipt(messageId: string, status: number): void {
  const now = Date.now()
  if (status >= 3)
    getDb()
      .prepare('UPDATE campaign_targets SET delivered_at = COALESCE(delivered_at, ?) WHERE message_id = ?')
      .run(now, messageId)
  if (status >= 4)
    getDb()
      .prepare('UPDATE campaign_targets SET read_at = COALESCE(read_at, ?) WHERE message_id = ?')
      .run(now, messageId)
}

/** Resposta do cliente nos 7 dias seguintes conta para a campanha. */
export function onCampaignReply(accountId: string, jid: string): void {
  const phone = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : '§'
  getDb()
    .prepare(
      `UPDATE campaign_targets SET replied_at = ? WHERE replied_at IS NULL AND status = 'sent' AND sent_at > ?
       AND (jid = ? OR phone = ?) AND campaign_id IN (SELECT id FROM campaigns WHERE account_id = ?)`
    )
    .run(Date.now(), Date.now() - 7 * 86_400_000, jid, phone, accountId)
}

/** Última campanha/lembrete enviado para o contato (para atribuir vendas). */
export function lastTouch(
  accountId: string,
  jid: string,
  withinDays = 7
): { id: number; name: string; kind: Campaign['kind'] } | null {
  const phone = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : '§'
  return (
    (getDb()
      .prepare(
        `SELECT c.id, c.name, c.kind FROM campaign_targets t JOIN campaigns c ON c.id = t.campaign_id
         WHERE c.account_id = ? AND (t.jid = ? OR t.phone = ?) AND t.status = 'sent' AND t.sent_at > ?
         ORDER BY t.sent_at DESC LIMIT 1`
      )
      .get(accountId, jid, phone, Date.now() - withinDays * 86_400_000) as
      { id: number; name: string; kind: Campaign['kind'] } | undefined) ?? null
  )
}

/** Envios com idade mínima e quantos deles tiveram resposta (para o monitor de saúde). */
export function replyHealth(campaignId: number, minAgeMs: number): { sent: number; replied: number } {
  const r = getDb()
    .prepare(
      "SELECT COUNT(*) AS sent, SUM(replied_at IS NOT NULL) AS replied FROM campaign_targets WHERE campaign_id = ? AND status = 'sent' AND sent_at < ?"
    )
    .get(campaignId, Date.now() - minAgeMs) as { sent: number; replied: number | null }
  return { sent: r.sent, replied: r.replied ?? 0 }
}

export function targetStillPending(campaignId: number, seq: number): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM campaign_targets WHERE campaign_id = ? AND seq = ? AND status = 'pending'")
    .get(campaignId, seq)
}
