import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync, realpathSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { webmToOgg } from './wa/ogg'
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
import { stagesOfAccount } from './pipelines'
import { getDb, getSetting, setSetting, transaction } from './db'
import { DEFAULT_ANTIBAN, dayKey, firstName } from '@shared/rules'
import { getAccount } from './accounts'
import { log } from './log'

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

/**
 * Reserva uma vaga do limite diário de forma atômica (campanhas e robô dividem o mesmo contador).
 * Devolve false se o limite já foi atingido. Quem reservou e não enviou chama releaseDailySend.
 */
export function reserveDailySend(accountId: string, limit: number): boolean {
  const day = dayKey()
  const r = getDb()
    .prepare(
      `INSERT INTO send_log (account_id, day, sent) SELECT ?1, ?2, 1 WHERE ?3 > 0
       ON CONFLICT DO UPDATE SET sent = sent + 1 WHERE sent < ?3`
    )
    .run(accountId, day, limit)
  return Number(r.changes) > 0
}

export function releaseDailySend(accountId: string): void {
  getDb()
    .prepare('UPDATE send_log SET sent = MAX(0, sent - 1) WHERE account_id = ? AND day = ?')
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
  template_media: string | null
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
    templateMedia: r.template_media ? (JSON.parse(r.template_media) as (CampaignMedia | null)[]) : null,
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
  const cur = input.id ? getCampaign(input.id) : null
  if (input.id && (!cur || cur.accountId !== input.accountId)) throw new Error('Campanha não encontrada')
  if (cur && cur.status !== 'draft' && cur.status !== 'scheduled')
    throw new Error('Só é possível editar campanhas que ainda não começaram')
  if (input.mediaIndices && input.mediaIndices.length !== input.templates.length)
    throw new Error('Índices de mídia inválidos')
  if (input.files && input.files.length !== input.templates.length) throw new Error('Mídias das versões inválidas')
  const mapped = input.mediaIndices
    ? input.mediaIndices.map((index) => {
        if (index === null) return null
        if (!cur) throw new Error('Versão não encontrada')
        return campaignVersion(cur, index).media
      })
    : cur
      ? input.templates.map((_, i) => (i < cur.templates.length ? campaignVersion(cur, i).media : null))
      : input.templates.map(() => null)
  // Converta e valide todas as gravações antes de mudar a campanha ou seus arquivos.
  const uploads = input.files?.map((file) => (file ? prepareCampaignFile(file) : null))
  const created: CampaignMedia[] = []
  let resultId: number
  try {
    uploads?.forEach((file, i) => {
      if (!file || !input.templates[i].trim()) return
      const media = writeCampaignFile(file)
      created.push(media)
      mapped[i] = media
    })
    const finalMedia = mapped.filter((_, i) => input.templates[i].trim())
    resultId = transaction(db, () => {
      let id = cur?.id
      if (id) {
        db.prepare(
          'UPDATE campaigns SET name = ?, templates = ?, audience = ?, opt_out_footer = ?, scheduled_at = ? WHERE id = ?'
        ).run(
          input.name.trim(),
          JSON.stringify(templates),
          JSON.stringify(input.audience),
          input.optOutFooter ? 1 : 0,
          input.scheduledAt,
          id
        )
      } else {
        id = Number(
          db
            .prepare(
              `INSERT INTO campaigns (account_id, name, kind, templates, audience, opt_out_footer, scheduled_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      }
      if (input.mediaIndices || input.files || cur?.templateMedia)
        db.prepare('UPDATE campaigns SET media = NULL, template_media = ? WHERE id = ?').run(
          JSON.stringify(finalMedia),
          id
        )
      return id
    })
    if (cur) cleanupMedia(cur, input.mediaIndices || input.files || cur.templateMedia ? finalMedia : [cur.media])
  } catch (error) {
    for (const media of created) rmSync(mediaPath(media), { force: true })
    throw error
  }
  return getCampaign(resultId)!
}

function mediaDir(): string {
  return join(app.getPath('userData'), 'campaign-media')
}

export function mediaPath(m: CampaignMedia): string {
  if (!m.file || basename(m.file) !== m.file || m.file.includes('\\')) throw new Error('Caminho de mídia inválido')
  const path = join(mediaDir(), m.file)
  // Arquivos são gerados pelo app. Não seguir links que saiam da pasta de campanhas.
  try {
    if (dirname(realpathSync(path)) !== realpathSync(mediaDir())) throw new Error('Caminho de mídia inválido')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return path
}

export function campaignVersion(c: Campaign, index: number): { text: string; media: CampaignMedia | null } {
  if (!Number.isInteger(index) || index < 0 || index >= c.templates.length) throw new Error('Versão não encontrada')
  return { text: c.templates[index], media: c.templateMedia ? (c.templateMedia[index] ?? null) : c.media }
}

function allMedia(c: Campaign): CampaignMedia[] {
  return [...(c.media ? [c.media] : []), ...(c.templateMedia ?? []).filter((m): m is CampaignMedia => !!m)]
}
function cleanupMedia(c: Campaign, keep: (CampaignMedia | null)[]): void {
  const kept = new Set(keep.filter(Boolean).map((m) => m!.file))
  for (const file of new Set(allMedia(c).map((m) => m.file)))
    if (!kept.has(file)) {
      try {
        rmSync(mediaPath({ file } as CampaignMedia), { force: true })
      } catch (error) {
        log.warn('Não foi possível limpar mídia antiga de campanha', { erro: (error as Error).message })
      }
    }
}

export type CampaignFile = { name: string; mime: string; data: Uint8Array; voice?: boolean }
export function prepareCampaignFile(file: CampaignFile): CampaignFile {
  if (!file.data.length || file.data.length > 64 * 1024 * 1024) throw new Error('Arquivo vazio ou maior que 64 MB')
  if (!file.voice) return file
  if (file.mime.split(';')[0] === 'audio/ogg') return file
  if (file.mime.split(';')[0] !== 'audio/webm') throw new Error('Formato de gravação inválido')
  const { ogg } = webmToOgg(file.data)
  return { name: file.name.replace(/\.[^.]+$/, '') + '.ogg', mime: 'audio/ogg; codecs=opus', data: ogg, voice: true }
}

export function campaignMediaPreview(id: number, accountId: string, index: number): CampaignFile | null {
  const c = getCampaign(id)
  if (!c || c.accountId !== accountId) throw new Error('Campanha não encontrada')
  const media = campaignVersion(c, index).media
  if (!media) return null
  const path = mediaPath(media)
  if (statSync(path).size > 64 * 1024 * 1024) throw new Error('Arquivo maior que 64 MB')
  return { name: media.name, mime: media.mime, voice: media.voice, data: new Uint8Array(readFileSync(path)) }
}

function writeCampaignFile(file: CampaignFile): CampaignMedia {
  mkdirSync(mediaDir(), { recursive: true })
  const ext = (file.name.split('.').pop() ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin'
  const media: CampaignMedia = {
    name: file.name.slice(0, 200),
    mime: file.mime,
    file: `${randomUUID()}.${ext}`,
    size: file.data.length,
    ...(file.voice ? { voice: true } : {})
  }
  writeFileSync(mediaPath(media), file.data)
  return media
}

export function setCampaignMedia(id: number, upload: CampaignFile | null, variantIndex?: number): Campaign {
  const cur = getCampaign(id)
  if (!cur) throw new Error('Campanha não encontrada')
  if (cur.status !== 'draft' && cur.status !== 'scheduled') throw new Error('A campanha já começou')
  if (variantIndex !== undefined) campaignVersion(cur, variantIndex)
  const file = upload ? prepareCampaignFile(upload) : null
  const media = file ? writeCampaignFile(file) : null
  const next =
    variantIndex === undefined
      ? null
      : cur.templates.map((_, i) => (i === variantIndex ? media : campaignVersion(cur, i).media))
  try {
    getDb()
      .prepare('UPDATE campaigns SET media = ?, template_media = ? WHERE id = ?')
      .run(variantIndex === undefined && media ? JSON.stringify(media) : null, next ? JSON.stringify(next) : null, id)
  } catch (error) {
    if (media) rmSync(mediaPath(media), { force: true })
    throw error
  }
  cleanupMedia(cur, next ?? [media])
  return getCampaign(id)!
}

export function deleteCampaign(id: number): void {
  const cur = getCampaign(id)
  if (!cur) return
  if (cur.status === 'running') throw new Error('Pause a campanha antes de excluir')
  getDb().prepare('DELETE FROM campaigns WHERE id = ?').run(id)
  cleanupMedia(cur, [])
}

export function duplicateCampaign(id: number): Campaign {
  const c = getCampaign(id)
  if (!c) throw new Error('Campanha não encontrada')
  let copy = saveCampaign({
    accountId: c.accountId,
    name: `${c.name} (cópia)`,
    templates: c.templates,
    audience: c.audience,
    optOutFooter: c.optOutFooter,
    scheduledAt: null
  })
  try {
    for (let i = 0; i < c.templates.length; i++) {
      const file = campaignMediaPreview(c.id, c.accountId, i)
      if (file) copy = setCampaignMedia(copy.id, file, i)
    }
    return copy
  } catch (error) {
    deleteCampaign(copy.id)
    throw error
  }
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

function tagSql(tags: string[], mode: 'any' | 'all' | undefined): string {
  const list = tags.map(() => '?').join(',')
  return mode === 'all'
    ? `(SELECT COUNT(DISTINCT t.tag) FROM person_tags t WHERE t.person_id = p.id AND t.tag IN (${list})) = ${new Set(tags).size}`
    : `EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag IN (${list}))`
}

function audienceSql(accountId: string, a: CampaignAudience): { sql: string; args: Array<string | number> } {
  const where = ['p.account_id = ?']
  const args: Array<string | number> = [accountId]
  if (a.type === 'tags' && a.tags?.length) {
    where.push(tagSql(a.tags, a.tagMode))
    args.push(...a.tags)
  } else if (a.type === 'tags') {
    where.push('0')
  }
  if (a.type === 'stages') {
    // Só colunas de funis desta conta; as etiquetas escolhidas filtram junto
    const ids = stagesOfAccount(accountId, a.stageIds ?? [])
    if (!ids.length) where.push('0')
    else {
      where.push(
        'EXISTS (SELECT 1 FROM pipeline_cards c WHERE c.person_id = p.id AND c.stage_id IN (SELECT value FROM json_each(?)))'
      )
      args.push(JSON.stringify(ids))
    }
    if (a.tags?.length) {
      where.push(tagSql(a.tags, a.tagMode))
      args.push(...a.tags)
    }
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
