import {
  PIPELINE_TEMPLATES,
  TAG_COLORS,
  type CardPlacement,
  type Pipeline,
  type PipelineBoard,
  type PipelineCard,
  type PipelineStage,
  type PipelineStageInput,
  type StageKind,
  type TagColor
} from '@shared/types'
import { normalizePhone } from '@shared/rules'
import { getDb, transaction } from './db'
import { cleanTag, ensureTag, tagPerson } from './tags'

/**
 * Funis (kanban): cada conta tem vários quadros; cada quadro tem colunas personalizadas;
 * cada cartão é um contato da base (um contato aparece no máximo uma vez por quadro).
 */

const MAX_PIPELINES = 30
const MAX_STAGES = 20
const MAX_BOARD_CARDS = 5000

const color = (c: string): TagColor => ((TAG_COLORS as readonly string[]).includes(c) ? (c as TagColor) : 'slate')
const kind = (k: string): StageKind => (k === 'won' || k === 'lost' ? k : 'open')

interface StageRow {
  id: number
  pipeline_id: number
  name: string
  color: string
  kind: string
  position: number
  auto_tag: string | null
  remove_tag_on_leave: number
  sla_days: number | null
  description: string | null
  count: number
  value: number | null
}

function toStage(r: StageRow): PipelineStage {
  return {
    id: r.id,
    name: r.name,
    color: color(r.color),
    kind: kind(r.kind),
    position: r.position,
    autoTag: r.auto_tag,
    removeTagOnLeave: !!r.remove_tag_on_leave,
    slaDays: r.sla_days,
    description: r.description,
    count: r.count,
    valueCents: r.value ?? 0
  }
}

/** Confere que o quadro é desta conta (nenhuma conta mexe no quadro de outra). */
function ownPipeline(accountId: string, pipelineId: number): void {
  const ok = getDb().prepare('SELECT 1 FROM pipelines WHERE id = ? AND account_id = ?').get(pipelineId, accountId)
  if (!ok) throw new Error('Funil não encontrado')
}

function ownStage(accountId: string, stageId: number): { pipelineId: number; autoTag: string | null } {
  const r = getDb()
    .prepare(
      `SELECT s.pipeline_id, s.auto_tag FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
       WHERE s.id = ? AND p.account_id = ?`
    )
    .get(stageId, accountId) as { pipeline_id: number; auto_tag: string | null } | undefined
  if (!r) throw new Error('Coluna não encontrada')
  return { pipelineId: r.pipeline_id, autoTag: r.auto_tag }
}

function ownCard(accountId: string, cardId: number): { stageId: number; pipelineId: number; personId: number } {
  const r = getDb()
    .prepare(
      `SELECT c.stage_id, c.pipeline_id, c.person_id FROM pipeline_cards c JOIN pipelines p ON p.id = c.pipeline_id
       WHERE c.id = ? AND p.account_id = ?`
    )
    .get(cardId, accountId) as { stage_id: number; pipeline_id: number; person_id: number } | undefined
  if (!r) throw new Error('Cartão não encontrado')
  return { stageId: r.stage_id, pipelineId: r.pipeline_id, personId: r.person_id }
}

function stagesOf(pipelineId: number): PipelineStage[] {
  return (
    getDb()
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM pipeline_cards c WHERE c.stage_id = s.id) AS count,
           (SELECT SUM(value_cents) FROM pipeline_cards c WHERE c.stage_id = s.id) AS value
         FROM pipeline_stages s WHERE s.pipeline_id = ? ORDER BY s.position, s.id`
      )
      .all(pipelineId) as unknown as StageRow[]
  ).map(toStage)
}

export function listPipelines(accountId: string): Pipeline[] {
  const rows = getDb()
    .prepare('SELECT * FROM pipelines WHERE account_id = ? ORDER BY position, id')
    .all(accountId) as Array<{ id: number; name: string; color: string; position: number; created_at: number }>
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: color(r.color),
    position: r.position,
    createdAt: r.created_at,
    stages: stagesOf(r.id)
  }))
}

export function getPipeline(accountId: string, pipelineId: number): Pipeline {
  ownPipeline(accountId, pipelineId)
  return listPipelines(accountId).find((p) => p.id === pipelineId)!
}

function validStages(stages: PipelineStageInput[]): void {
  if (!stages.length) throw new Error('O funil precisa de pelo menos uma coluna')
  if (stages.length > MAX_STAGES) throw new Error(`Use no máximo ${MAX_STAGES} colunas`)
  const names = new Set<string>()
  for (const s of stages) {
    const n = s.name.trim().toLowerCase()
    if (!n) throw new Error('Toda coluna precisa de um nome')
    if (names.has(n)) throw new Error(`Há duas colunas chamadas "${s.name.trim()}"`)
    names.add(n)
  }
}

/**
 * Cria ou atualiza um funil com a lista completa de colunas (na ordem da tela).
 * Coluna removida que tinha cartões: os cartões vão para a coluna anterior (ou a primeira).
 */
export function savePipeline(
  accountId: string,
  input: { id?: number; name: string; color: TagColor; stages: PipelineStageInput[] }
): Pipeline {
  const name = input.name.trim().slice(0, 60)
  if (!name) throw new Error('Dê um nome para o funil')
  validStages(input.stages)
  const db = getDb()
  const id = transaction(db, () => {
    let pid = input.id
    if (pid) {
      ownPipeline(accountId, pid)
      db.prepare('UPDATE pipelines SET name = ?, color = ? WHERE id = ?').run(name, color(input.color), pid)
    } else {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM pipelines WHERE account_id = ?').get(accountId) as { n: number })
        .n
      if (n >= MAX_PIPELINES) throw new Error(`Use no máximo ${MAX_PIPELINES} funis por número`)
      pid = Number(
        db
          .prepare('INSERT INTO pipelines (account_id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(accountId, name, color(input.color), n, Date.now()).lastInsertRowid
      )
    }
    const existing = db
      .prepare('SELECT id FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position, id')
      .all(pid) as Array<{ id: number }>
    const existingIds = new Set(existing.map((e) => e.id))
    const kept: number[] = []
    input.stages.forEach((s, i) => {
      const autoTag = s.autoTag?.trim() ? ensureTag(accountId, s.autoTag) : null
      const vals = [
        s.name.trim().slice(0, 40),
        color(s.color),
        kind(s.kind),
        i,
        autoTag,
        s.removeTagOnLeave ? 1 : 0,
        s.slaDays && s.slaDays > 0 ? Math.min(365, Math.round(s.slaDays)) : null,
        s.description?.trim().slice(0, 200) || null
      ] as const
      if (s.id && existingIds.has(s.id)) {
        db.prepare(
          'UPDATE pipeline_stages SET name=?, color=?, kind=?, position=?, auto_tag=?, remove_tag_on_leave=?, sla_days=?, description=? WHERE id=?'
        ).run(...vals, s.id)
        kept.push(s.id)
      } else {
        kept.push(
          Number(
            db
              .prepare(
                'INSERT INTO pipeline_stages (name, color, kind, position, auto_tag, remove_tag_on_leave, sla_days, description, pipeline_id) VALUES (?,?,?,?,?,?,?,?,?)'
              )
              .run(...vals, pid).lastInsertRowid
          )
        )
      }
    })
    // Colunas removidas: cartões vão para a coluna mantida mais próxima antes dela
    const order = existing.map((e) => e.id)
    for (const old of order) {
      if (kept.includes(old)) continue
      const before = order
        .slice(0, order.indexOf(old))
        .reverse()
        .find((x) => kept.includes(x))
      const dest = before ?? kept[0]
      const top = maxPos(dest)
      const cards = db.prepare('SELECT id FROM pipeline_cards WHERE stage_id = ? ORDER BY position').all(old) as Array<{
        id: number
      }>
      cards.forEach((c, i) =>
        db.prepare('UPDATE pipeline_cards SET stage_id = ?, position = ? WHERE id = ?').run(dest, top + 1 + i, c.id)
      )
      db.prepare('DELETE FROM pipeline_stages WHERE id = ?').run(old)
    }
    return pid
  })
  return getPipeline(accountId, id)
}

export function createFromTemplate(accountId: string, templateId: string, name?: string): Pipeline {
  const t = PIPELINE_TEMPLATES.find((x) => x.id === templateId) ?? PIPELINE_TEMPLATES[0]
  return savePipeline(accountId, { name: name?.trim() || t.name, color: 'blue', stages: t.stages })
}

export function deletePipeline(accountId: string, pipelineId: number): void {
  ownPipeline(accountId, pipelineId)
  getDb().prepare('DELETE FROM pipelines WHERE id = ?').run(pipelineId)
}

export function reorderPipelines(accountId: string, ids: number[]): void {
  const db = getDb()
  transaction(db, () => {
    ids.forEach((id, i) =>
      db.prepare('UPDATE pipelines SET position = ? WHERE id = ? AND account_id = ?').run(i, id, accountId)
    )
  })
}

// ---------- quadro ----------

interface CardRow {
  id: number
  pipeline_id: number
  stage_id: number
  person_id: number
  position: number
  value_cents: number
  note: string | null
  created_at: number
  moved_at: number
  name: string | null
  phone: string
  jid: string | null
  opt_out: number
  tags: string | null
  last_ts: number | null
  last_preview: string | null
  unread: number | null
}

function toCard(r: CardRow): PipelineCard {
  return {
    id: r.id,
    pipelineId: r.pipeline_id,
    stageId: r.stage_id,
    personId: r.person_id,
    name: r.name,
    phone: r.phone,
    jid: r.jid,
    tags: r.tags ? r.tags.split('\u001f').sort((a, b) => a.localeCompare(b)) : [],
    optOut: !!r.opt_out,
    valueCents: r.value_cents,
    note: r.note,
    position: r.position,
    createdAt: r.created_at,
    movedAt: r.moved_at,
    // chats.last_ts fica em segundos
    lastMessageAt: r.last_ts ? r.last_ts * 1000 : null,
    lastPreview: r.last_preview,
    unread: r.unread ?? 0
  }
}

const CARD_SELECT = `SELECT c.*, p.name, p.phone, p.jid, p.opt_out,
  (SELECT group_concat(tag, char(31)) FROM person_tags t WHERE t.person_id = p.id) AS tags,
  ch.last_ts, ch.last_preview, ch.unread
  FROM pipeline_cards c
  JOIN people p ON p.id = c.person_id
  LEFT JOIN chats ch ON ch.account_id = p.account_id AND ch.jid = COALESCE(p.jid, p.phone || '@s.whatsapp.net')`

export function getBoard(
  accountId: string,
  pipelineId: number,
  filter: { search?: string; tags?: string[] } = {}
): PipelineBoard {
  const pipeline = getPipeline(accountId, pipelineId)
  const where = ['c.pipeline_id = ?']
  const args: Array<string | number> = [pipelineId]
  if (filter.search?.trim()) {
    const s = `%${filter.search.trim().replace(/[%_]/g, '')}%`
    const digits = filter.search.replace(/\D/g, '')
    where.push(
      '(unaccent(p.name) LIKE unaccent(?) OR unaccent(c.note) LIKE unaccent(?)' +
        (digits.length >= 3 ? ' OR p.phone LIKE ?' : '') +
        ')'
    )
    args.push(s, s)
    if (digits.length >= 3) args.push(`%${digits}%`)
  }
  for (const t of filter.tags ?? []) {
    where.push('EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag = ?)')
    args.push(t)
  }
  const cards = (
    getDb()
      .prepare(`${CARD_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.position, c.id LIMIT ${MAX_BOARD_CARDS}`)
      .all(...args) as unknown as CardRow[]
  ).map(toCard)
  return { pipeline, cards }
}

function maxPos(stageId: number): number {
  const r = getDb().prepare('SELECT MAX(position) AS m FROM pipeline_cards WHERE stage_id = ?').get(stageId) as {
    m: number | null
  }
  return r.m ?? 0
}

/** Posição para inserir no índice `index` da coluna (sem contar o próprio cartão). */
function positionAt(stageId: number, index: number, exceptCard?: number): number {
  const rows = getDb()
    .prepare('SELECT id, position FROM pipeline_cards WHERE stage_id = ? AND id != ? ORDER BY position, id')
    .all(stageId, exceptCard ?? 0) as Array<{ id: number; position: number }>
  const i = Math.max(0, Math.min(index, rows.length))
  const prev = rows[i - 1]?.position
  const next = rows[i]?.position
  if (prev == null && next == null) return 1
  if (prev == null) return next! - 1
  if (next == null) return prev + 1
  if (next - prev > 1e-6) return (prev + next) / 2
  // Ficou apertado demais: renumera a coluna e tenta de novo
  rows.forEach((r, k) =>
    getDb()
      .prepare('UPDATE pipeline_cards SET position = ? WHERE id = ?')
      .run(k + 1, r.id)
  )
  return i + 0.5
}

/** Aplica as etiquetas automáticas ao sair de uma coluna e entrar em outra. */
function applyStageTags(accountId: string, personId: number, fromStage: number | null, toStage: number): void {
  const db = getDb()
  if (fromStage != null && fromStage !== toStage) {
    const from = db.prepare('SELECT auto_tag, remove_tag_on_leave FROM pipeline_stages WHERE id = ?').get(fromStage) as
      { auto_tag: string | null; remove_tag_on_leave: number } | undefined
    if (from?.auto_tag && from.remove_tag_on_leave) tagPerson(accountId, personId, from.auto_tag, false)
  }
  const to = db.prepare('SELECT auto_tag FROM pipeline_stages WHERE id = ?').get(toStage) as
    { auto_tag: string | null } | undefined
  if (to?.auto_tag) tagPerson(accountId, personId, to.auto_tag, true)
}

export function moveCard(accountId: string, cardId: number, stageId: number, index: number): void {
  const card = ownCard(accountId, cardId)
  const dest = ownStage(accountId, stageId)
  if (dest.pipelineId !== card.pipelineId) throw new Error('A coluna é de outro funil')
  const db = getDb()
  transaction(db, () => {
    const pos = positionAt(stageId, index, cardId)
    const changed = card.stageId !== stageId
    db.prepare(
      `UPDATE pipeline_cards SET stage_id = ?, position = ?${changed ? ', moved_at = ?' : ''} WHERE id = ?`
    ).run(...(changed ? [stageId, pos, Date.now(), cardId] : [stageId, pos, cardId]))
    if (changed) applyStageTags(accountId, card.personId, card.stageId, stageId)
  })
}

export function updateCard(
  accountId: string,
  cardId: number,
  patch: { valueCents?: number; note?: string | null }
): void {
  ownCard(accountId, cardId)
  const db = getDb()
  if (patch.valueCents != null)
    db.prepare('UPDATE pipeline_cards SET value_cents = ? WHERE id = ?').run(
      Math.max(0, Math.min(Math.round(patch.valueCents), 1e12)),
      cardId
    )
  if (patch.note !== undefined)
    db.prepare('UPDATE pipeline_cards SET note = ? WHERE id = ?').run(patch.note?.trim().slice(0, 2000) || null, cardId)
}

export function removeCards(accountId: string, cardIds: number[]): void {
  const db = getDb()
  transaction(db, () => {
    for (const id of cardIds) {
      const c = ownCard(accountId, id)
      const st = db.prepare('SELECT auto_tag, remove_tag_on_leave FROM pipeline_stages WHERE id = ?').get(c.stageId) as
        { auto_tag: string | null; remove_tag_on_leave: number } | undefined
      if (st?.auto_tag && st.remove_tag_on_leave) tagPerson(accountId, c.personId, st.auto_tag, false)
      db.prepare('DELETE FROM pipeline_cards WHERE id = ?').run(id)
    }
  })
}

/** Põe contatos numa coluna. Quem já está no funil continua onde está (ou é movido, se `move`). */
export function addPeople(
  accountId: string,
  stageId: number,
  personIds: number[],
  move = false
): { added: number; moved: number; already: number } {
  const { pipelineId } = ownStage(accountId, stageId)
  const db = getDb()
  const out = { added: 0, moved: 0, already: 0 }
  transaction(db, () => {
    let pos = maxPos(stageId)
    const now = Date.now()
    const ownP = db.prepare('SELECT 1 FROM people WHERE id = ? AND account_id = ?')
    const cur = db.prepare('SELECT id, stage_id FROM pipeline_cards WHERE pipeline_id = ? AND person_id = ?')
    for (const pid of [...new Set(personIds)]) {
      if (!ownP.get(pid, accountId)) continue
      const ex = cur.get(pipelineId, pid) as { id: number; stage_id: number } | undefined
      if (ex) {
        if (move && ex.stage_id !== stageId) {
          db.prepare('UPDATE pipeline_cards SET stage_id = ?, position = ?, moved_at = ? WHERE id = ?').run(
            stageId,
            ++pos,
            now,
            ex.id
          )
          applyStageTags(accountId, pid, ex.stage_id, stageId)
          out.moved++
        } else out.already++
        continue
      }
      db.prepare(
        'INSERT INTO pipeline_cards (pipeline_id, stage_id, person_id, position, created_at, moved_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(pipelineId, stageId, pid, ++pos, now, now)
      applyStageTags(accountId, pid, null, stageId)
      out.added++
    }
  })
  return out
}

/** Todos os contatos com uma etiqueta (ou com qualquer uma das etiquetas) entram na coluna. */
export function addByTags(
  accountId: string,
  stageId: number,
  tags: string[]
): { added: number; moved: number; already: number } {
  if (!tags.length) return { added: 0, moved: 0, already: 0 }
  const ids = getDb()
    .prepare(
      `SELECT DISTINCT p.id FROM people p JOIN person_tags t ON t.person_id = p.id
       WHERE p.account_id = ? AND t.tag IN (${tags.map(() => '?').join(',')}) LIMIT 50000`
    )
    .all(accountId, ...tags) as Array<{ id: number }>
  return addPeople(
    accountId,
    stageId,
    ids.map((r) => r.id)
  )
}

/**
 * Contato a partir de uma conversa: acha pelo JID/telefone ou cria um novo com o nome da conversa.
 * Conversa só com LID (sem número conhecido) não vira contato.
 */
export function personFromChat(accountId: string, chatJid: string): number {
  const db = getDb()
  if (chatJid.endsWith('@g.us')) throw new Error('Grupos não entram no funil. Abra a conversa com a pessoa.')
  let pn = chatJid.endsWith('@s.whatsapp.net') ? chatJid : null
  if (chatJid.endsWith('@lid')) {
    const m = db.prepare('SELECT pn FROM lid_map WHERE account_id = ? AND lid = ?').get(accountId, chatJid) as
      { pn: string } | undefined
    pn = m?.pn ?? null
  }
  // O número do JID já vem com código do país
  const phone = pn ? normalizePhone('+' + pn.split('@')[0].split(':')[0]) : null
  const found = db
    .prepare('SELECT id FROM people WHERE account_id = ? AND (jid = ? OR (? IS NOT NULL AND phone = ?)) LIMIT 1')
    .get(accountId, chatJid, phone, phone) as { id: number } | undefined
  if (found) return found.id
  if (!phone)
    throw new Error('Ainda não sabemos o número desta conversa. Tente de novo depois que ela trocar mensagens.')
  const named = db
    .prepare(
      `SELECT COALESCE(
         (SELECT name FROM chats WHERE account_id = ? AND jid = ?),
         (SELECT COALESCE(name, notify, verified_name) FROM contacts WHERE account_id = ? AND jid = ?)
       ) AS n`
    )
    .get(accountId, chatJid, accountId, chatJid) as { n: string | null }
  const now = Date.now()
  return Number(
    db
      .prepare(
        'INSERT INTO people (account_id, phone, jid, name, has_wa, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
      )
      .run(accountId, phone, pn, named.n?.slice(0, 120) || null, now, now).lastInsertRowid
  )
}

export function addFromChat(accountId: string, stageId: number, chatJid: string): CardPlacement[] {
  const personId = personFromChat(accountId, chatJid)
  addPeople(accountId, stageId, [personId], true)
  return placementsOfPerson(accountId, personId)
}

export function placementsOfPerson(accountId: string, personId: number): CardPlacement[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id AS card_id, c.person_id, c.value_cents, p.id AS pipeline_id, p.name AS pipeline_name,
         s.id AS stage_id, s.name AS stage_name, s.color AS stage_color, s.kind AS stage_kind
       FROM pipeline_cards c
       JOIN pipelines p ON p.id = c.pipeline_id AND p.account_id = ?
       JOIN pipeline_stages s ON s.id = c.stage_id
       WHERE c.person_id = ? ORDER BY p.position, p.id`
    )
    .all(accountId, personId) as Array<{
    card_id: number
    person_id: number
    value_cents: number
    pipeline_id: number
    pipeline_name: string
    stage_id: number
    stage_name: string
    stage_color: string
    stage_kind: string
  }>
  return rows.map((r) => ({
    cardId: r.card_id,
    personId: r.person_id,
    pipelineId: r.pipeline_id,
    pipelineName: r.pipeline_name,
    stageId: r.stage_id,
    stageName: r.stage_name,
    stageColor: color(r.stage_color),
    stageKind: kind(r.stage_kind),
    valueCents: r.value_cents
  }))
}

/** Funis e etiquetas da pessoa por trás de uma conversa (sem criar contato). */
export function chatProfile(
  accountId: string,
  chatJid: string
): { personId: number | null; tags: string[]; placements: CardPlacement[] } {
  const db = getDb()
  let pn: string | null = chatJid.endsWith('@s.whatsapp.net') ? chatJid : null
  if (chatJid.endsWith('@lid'))
    pn =
      (
        db.prepare('SELECT pn FROM lid_map WHERE account_id = ? AND lid = ?').get(accountId, chatJid) as
          { pn: string } | undefined
      )?.pn ?? null
  const phone = pn ? pn.split('@')[0].split(':')[0] : null
  const p = db
    .prepare('SELECT id FROM people WHERE account_id = ? AND (jid = ? OR (? IS NOT NULL AND phone = ?)) LIMIT 1')
    .get(accountId, chatJid, phone, phone) as { id: number } | undefined
  if (!p) return { personId: null, tags: [], placements: [] }
  const tags = (
    db.prepare('SELECT tag FROM person_tags WHERE person_id = ? ORDER BY tag').all(p.id) as Array<{
      tag: string
    }>
  ).map((r) => r.tag)
  return { personId: p.id, tags, placements: placementsOfPerson(accountId, p.id) }
}

/** Etiquetas da pessoa de uma conversa (cria o contato se precisar). */
export function setChatTags(accountId: string, chatJid: string, tags: string[]): string[] {
  const personId = personFromChat(accountId, chatJid)
  const db = getDb()
  transaction(db, () => {
    db.prepare('DELETE FROM person_tags WHERE person_id = ?').run(personId)
    for (const t of [...new Set(tags.map(cleanTag).filter(Boolean))]) tagPerson(accountId, personId, t, true)
  })
  return (
    db.prepare('SELECT tag FROM person_tags WHERE person_id = ? ORDER BY tag').all(personId) as Array<{
      tag: string
    }>
  ).map((r) => r.tag)
}

/** Colunas válidas desta conta (para o público de campanha). */
export function stagesOfAccount(accountId: string, ids: number[]): number[] {
  if (!ids.length) return []
  return (
    getDb()
      .prepare(
        `SELECT s.id FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id
         WHERE p.account_id = ? AND s.id IN (SELECT value FROM json_each(?))`
      )
      .all(accountId, JSON.stringify(ids)) as Array<{ id: number }>
  ).map((r) => r.id)
}
