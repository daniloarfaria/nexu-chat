import {
  NOTE_KINDS,
  type BirthdaySuggestion,
  type ContactNote,
  type DateHistoryItem,
  type NoteInput,
  type NoteKind
} from '@shared/types'
import { findBirthdayInText, validDate } from '@shared/dates'
import { normalizeDate, dayKey } from '@shared/rules'
import { getDb, transaction } from './db'
import { isSensitive } from './ai/sensitive'
import * as people from './people'
import { personFromChat } from './pipelines'

/**
 * Notas do cliente (várias por contato), histórico de lembretes enviados e aniversário.
 * As notas apagam junto com o contato (chave estrangeira com ON DELETE CASCADE, direito de exclusão da LGPD).
 */

export const NOTE_TITLE_MAX = 80
export const NOTE_BODY_MAX = 2000
export const NOTES_PER_PERSON = 200
/** Conversa parada há 2 horas... */
export const AUTO_IDLE_SECONDS = 2 * 3600
/** ...com pelo menos 10 mensagens que a IA ainda não leu. */
export const AUTO_MIN_MESSAGES = 10
/** Só conversas recentes entram no automático (não varre o histórico antigo ao ligar a função). */
const AUTO_WINDOW_SECONDS = 3 * 86_400

interface NoteRow {
  id: number
  account_id: string
  person_id: number
  kind: string
  title: string
  body: string
  author: string
  pinned: number
  created_at: number
  updated_at: number
}

function toNote(r: NoteRow): ContactNote {
  return {
    id: r.id,
    accountId: r.account_id,
    personId: r.person_id,
    kind: (NOTE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as NoteKind) : 'geral',
    title: r.title,
    body: r.body,
    author: r.author === 'ia' ? 'ia' : 'atendente',
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function ownPerson(accountId: string, personId: number): void {
  const p = getDb().prepare('SELECT 1 FROM people WHERE id = ? AND account_id = ?').get(personId, accountId)
  if (!p) throw new Error('Contato não encontrado')
}

/** Contato da conversa, sem criar (para listar). */
export function personIdOfChat(accountId: string, chatJid: string): number | null {
  const db = getDb()
  const direct = people.findPersonByJid(accountId, chatJid)
  if (direct) return direct.id
  if (chatJid.endsWith('@lid')) {
    const m = db.prepare('SELECT pn FROM lid_map WHERE account_id = ? AND lid = ?').get(accountId, chatJid) as
      { pn: string } | undefined
    if (m) return people.findPersonByJid(accountId, m.pn)?.id ?? null
  }
  return null
}

/** Contato do alvo: pelo id, ou pela conversa (criando o contato quando `create`). */
export function resolveTarget(
  accountId: string,
  target: { personId?: number; chatJid?: string },
  create: boolean
): number | null {
  if (target.personId != null) {
    ownPerson(accountId, target.personId)
    return target.personId
  }
  if (!target.chatJid) throw new Error('Escolha o contato')
  const found = personIdOfChat(accountId, target.chatJid)
  if (found != null || !create) return found
  return personFromChat(accountId, target.chatJid)
}

export function listNotes(accountId: string, personId: number): ContactNote[] {
  return (
    getDb()
      .prepare(
        'SELECT * FROM contact_notes WHERE account_id = ? AND person_id = ? ORDER BY pinned DESC, updated_at DESC, id DESC'
      )
      .all(accountId, personId) as unknown as NoteRow[]
  ).map(toNote)
}

function clean(input: Pick<NoteInput, 'title' | 'body'>): { title: string; body: string } {
  const body = input.body.replace(/\r\n/g, '\n').trim().slice(0, NOTE_BODY_MAX)
  if (!body) throw new Error('Escreva o texto da nota')
  const title = (input.title.trim() || body.split('\n')[0]).slice(0, NOTE_TITLE_MAX)
  return { title, body }
}

export function saveNote(accountId: string, personId: number, input: NoteInput): ContactNote {
  ownPerson(accountId, personId)
  const db = getDb()
  const { title, body } = clean(input)
  if (isSensitive(`${title} ${body}`))
    throw new Error(
      'Esta nota parece ter dado sensível (saúde, como grau de óculos, religião, política...). Escreva sem isso: o app não guarda esse tipo de dado.'
    )
  const kind: NoteKind = (NOTE_KINDS as readonly string[]).includes(input.kind) ? input.kind : 'geral'
  const now = Date.now()
  if (input.id) {
    const cur = db
      .prepare('SELECT * FROM contact_notes WHERE id = ? AND account_id = ? AND person_id = ?')
      .get(input.id, accountId, personId) as NoteRow | undefined
    if (!cur) throw new Error('Nota não encontrada')
    // Editar uma nota da IA a torna do atendente: o texto agora é dele
    db.prepare(
      "UPDATE contact_notes SET kind = ?, title = ?, body = ?, pinned = ?, author = 'atendente', updated_at = ? WHERE id = ?"
    ).run(kind, title, body, input.pinned == null ? cur.pinned : input.pinned ? 1 : 0, now, cur.id)
    return toNote(db.prepare('SELECT * FROM contact_notes WHERE id = ?').get(cur.id) as unknown as NoteRow)
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM contact_notes WHERE person_id = ?').get(personId) as { n: number }
  if (n.n >= NOTES_PER_PERSON) throw new Error('Este contato já tem notas demais. Apague algumas antes de criar outra.')
  const id = Number(
    db
      .prepare(
        "INSERT INTO contact_notes (account_id, person_id, kind, title, body, author, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'atendente', ?, ?, ?)"
      )
      .run(accountId, personId, kind, title, body, input.pinned ? 1 : 0, now, now).lastInsertRowid
  )
  return toNote(db.prepare('SELECT * FROM contact_notes WHERE id = ?').get(id) as unknown as NoteRow)
}

/** Fixar e desafixar sem mexer no texto (e sem trocar o autor). */
export function pinNote(accountId: string, id: number, pinned: boolean): void {
  getDb()
    .prepare('UPDATE contact_notes SET pinned = ? WHERE id = ? AND account_id = ?')
    .run(pinned ? 1 : 0, id, accountId)
}

export function deleteNote(accountId: string, id: number): void {
  getDb().prepare('DELETE FROM contact_notes WHERE id = ? AND account_id = ?').run(id, accountId)
}

/** Notas que a IA propôs (já filtradas). Ficam marcadas "IA" e o atendente pode editar ou apagar. */
export function saveAiNotes(
  accountId: string,
  personId: number,
  items: Array<{ kind: NoteKind; title: string; body: string }>
): ContactNote[] {
  ownPerson(accountId, personId)
  const db = getDb()
  const have = (
    db.prepare('SELECT COUNT(*) AS n FROM contact_notes WHERE person_id = ?').get(personId) as { n: number }
  ).n
  if (have + items.length > NOTES_PER_PERSON)
    throw new Error(`Este contato chegou ao limite de ${NOTES_PER_PERSON} notas. Apague algumas para a IA anotar mais.`)
  const now = Date.now()
  const ins = db.prepare(
    "INSERT INTO contact_notes (account_id, person_id, kind, title, body, author, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ia', 0, ?, ?)"
  )
  return transaction(db, () =>
    items.map((it) => {
      const { title, body } = clean(it)
      const id = Number(ins.run(accountId, personId, it.kind, title, body, now, now).lastInsertRowid)
      return toNote(db.prepare('SELECT * FROM contact_notes WHERE id = ?').get(id) as unknown as NoteRow)
    })
  )
}

// ---------- Disparo automático ----------

interface State {
  last_ts: number
  failed_at: number
  birthday_suggestion: string | null
  birthday_dismissed: number
}

function stateOf(personId: number): State {
  return (
    (getDb()
      .prepare(
        'SELECT last_ts, failed_at, birthday_suggestion, birthday_dismissed FROM contact_profile_state WHERE person_id = ?'
      )
      .get(personId) as State | undefined) ?? {
      last_ts: 0,
      failed_at: 0,
      birthday_suggestion: null,
      birthday_dismissed: 0
    }
  )
}

function upsertState(accountId: string, personId: number, patch: Partial<State>): void {
  const cur = stateOf(personId)
  const next = { ...cur, ...patch }
  getDb()
    .prepare(
      `INSERT INTO contact_profile_state (person_id, account_id, last_ts, failed_at, birthday_suggestion, birthday_dismissed)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET last_ts = excluded.last_ts, failed_at = excluded.failed_at,
         birthday_suggestion = excluded.birthday_suggestion, birthday_dismissed = excluded.birthday_dismissed`
    )
    .run(personId, accountId, next.last_ts, next.failed_at, next.birthday_suggestion, next.birthday_dismissed)
}

/** Marca até onde a IA já leu a conversa (timestamp em segundos da última mensagem lida). */
export function markProfiled(accountId: string, personId: number, ts: number): void {
  upsertState(accountId, personId, { last_ts: ts, failed_at: 0 })
}

/** Espera depois de uma falha antes de tentar de novo com o mesmo contato. */
export const AUTO_RETRY_MS = 60 * 60_000

/** Guarda no banco que a IA falhou com este contato (a espera sobrevive a reiniciar o app). */
export function markProfileFailed(accountId: string, personId: number, nowMs = Date.now()): void {
  upsertState(accountId, personId, { failed_at: nowMs })
}

/** Quando a IA acha o aniversário na conversa, guarda só como sugestão (nada vai para o contato sem confirmar). */
export function storeBirthdayHint(accountId: string, personId: number, date: string | null): void {
  upsertState(accountId, personId, { birthday_suggestion: date })
}

export interface AutoCandidate {
  personId: number
  jid: string
  lastTs: number
  newMessages: number
}

/**
 * Conversas de contatos já cadastrados que pararam há 2 horas depois de pelo menos 10 mensagens novas.
 * `nowSec` em segundos (como o `ts` das mensagens).
 */
export function autoProfileCandidates(
  accountId: string,
  nowSec = Math.floor(Date.now() / 1000),
  limit = 3
): AutoCandidate[] {
  const db = getDb()
  const chats = db
    .prepare(
      `SELECT jid, last_ts FROM chats
       WHERE account_id = ? AND is_group = 0 AND last_ts <= ? AND last_ts >= ?
       ORDER BY last_ts DESC LIMIT 200`
    )
    .all(accountId, nowSec - AUTO_IDLE_SECONDS, nowSec - AUTO_WINDOW_SECONDS) as Array<{ jid: string; last_ts: number }>
  const out: AutoCandidate[] = []
  for (const c of chats) {
    const personId = personIdOfChat(accountId, c.jid)
    if (personId == null) continue
    const st = stateOf(personId)
    if (nowSec * 1000 - st.failed_at < AUTO_RETRY_MS) continue // falhou há pouco: não ocupa vaga
    const since = st.last_ts
    const n = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND chat_jid = ? AND ts > ? AND type != 'system' AND deleted = 0"
        )
        .get(accountId, c.jid, since) as { n: number }
    ).n
    if (n < AUTO_MIN_MESSAGES) continue
    out.push({ personId, jid: c.jid, lastTs: c.last_ts, newMessages: n })
    if (out.length >= limit) break
  }
  return out
}

// ---------- Aniversário e datas ----------

const REMINDER_LABEL: Record<string, (name: string, when: string, verb: string) => string> = {
  birthday: (_n, when, verb) => `Lembrete de aniversário ${verb} em ${when}`,
  yearly: (n, when, verb) => `Lembrete anual "${n}" ${verb} em ${when}`,
  days_after: (n, when, verb) => `Lembrete "${n}" ${verb} em ${when}`
}

/** Por quanto tempo um lembrete só registrado (sem envio confirmado) ainda conta como programado. */
const PENDING_WINDOW_MS = 12 * 3600_000

const fmt = (ms: number): string => new Date(ms).toLocaleDateString('pt-BR')

/**
 * Lembretes que este contato recebeu, do mais novo ao mais antigo.
 * Vem dos envios reais (campaign_targets); o que só está no registro do dia (reminder_log) aparece como "programado".
 */
export function dateHistory(accountId: string, personId: number, nowMs = Date.now()): DateHistoryItem[] {
  const db = getDb()
  const reminders = new Map<number, { name: string; kind: DateHistoryItem['kind'] }>(
    (
      db.prepare('SELECT id, name, kind FROM reminders WHERE account_id = ?').all(accountId) as Array<{
        id: number
        name: string
        kind: DateHistoryItem['kind']
      }>
    ).map((r) => [r.id, { name: r.name, kind: r.kind }])
  )
  /** Mesmo lembrete no mesmo período (ano para aniversário e anual, dia para "dias depois") = um envio só. */
  const periodOf = (rid: number, at: number): string => {
    const k = reminders.get(rid)?.kind
    const d = new Date(at)
    return `${rid}|${k === 'days_after' ? dayKey(d) : d.getFullYear()}`
  }
  const out: DateHistoryItem[] = []
  const seen = new Set<string>()
  const sent = db
    .prepare(
      `SELECT c.source AS source, t.sent_at AS at
       FROM campaign_targets t JOIN campaigns c ON c.id = t.campaign_id
       WHERE t.person_id = ? AND c.account_id = ? AND c.kind = 'reminder' AND t.sent_at IS NOT NULL`
    )
    .all(personId, accountId) as Array<{ source: string | null; at: number }>
  for (const s of sent) {
    const rid = Number(/^reminder:(\d+)$/.exec(s.source ?? '')?.[1])
    const r = reminders.get(rid)
    seen.add(periodOf(rid, s.at))
    const kind = r?.kind ?? 'yearly'
    out.push({
      kind,
      at: s.at,
      label: r ? REMINDER_LABEL[kind](r.name, fmt(s.at), 'enviado') : `Lembrete enviado em ${fmt(s.at)}`
    })
  }
  // O registro do dia só entra como "programado" enquanto o envio é recente; depois disso, sem envio, some
  const logged = db
    .prepare(
      `SELECT l.reminder_id AS rid, l.at AS at FROM reminder_log l JOIN reminders r ON r.id = l.reminder_id
       WHERE l.person_id = ? AND r.account_id = ?`
    )
    .all(personId, accountId) as Array<{ rid: number; at: number }>
  for (const l of logged) {
    if (seen.has(periodOf(l.rid, l.at)) || nowMs - l.at > PENDING_WINDOW_MS) continue
    const r = reminders.get(l.rid)
    if (!r) continue
    out.push({ kind: r.kind, at: l.at, label: REMINDER_LABEL[r.kind](r.name, fmt(l.at), 'programado') })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Conversas (JIDs) deste contato: pelo JID salvo, pelo número e pelos LIDs ligados ao número. */
export function chatJidsOf(accountId: string, personId: number): string[] {
  const p = people.getPerson(accountId, personId)
  if (!p) return []
  const pn = `${p.phone}@s.whatsapp.net`
  const jids = new Set<string>([pn])
  if (p.jid) jids.add(p.jid)
  const lids = getDb()
    .prepare('SELECT lid FROM lid_map WHERE account_id = ? AND pn IN (?, ?)')
    .all(accountId, pn, p.jid ?? pn) as Array<{ lid: string }>
  for (const l of lids) jids.add(l.lid)
  return [...jids]
}

/**
 * "Salvar 12/03 como aniversário?": só quando o contato ainda não tem aniversário, a sugestão não foi dispensada
 * e o cliente (não a loja) falou a data. Vem da IA (se ela achou) ou da leitura das últimas mensagens dele.
 */
export function birthdaySuggestion(accountId: string, personId: number): BirthdaySuggestion | null {
  const p = people.getPerson(accountId, personId)
  if (!p || p.birthday) return null
  const st = stateOf(personId)
  if (st.birthday_dismissed) return null
  const jids = chatJidsOf(accountId, personId)
  const rows = getDb()
    .prepare(
      `SELECT text FROM messages WHERE account_id = ? AND from_me = 0 AND text IS NOT NULL
         AND chat_jid IN (SELECT value FROM json_each(?)) ORDER BY ts DESC LIMIT 300`
    )
    .all(accountId, JSON.stringify(jids)) as Array<{ text: string }>
  for (const r of rows) {
    const d = findBirthdayInText(r.text)
    if (d) return { date: d, quote: r.text.replace(/\s+/g, ' ').trim().slice(0, 140) }
  }
  const hint = validDate(normalizeDate(st.birthday_suggestion))
  return hint ? { date: hint, quote: 'Encontrado pela IA na conversa' } : null
}

export function dismissBirthdaySuggestion(accountId: string, personId: number): void {
  ownPerson(accountId, personId)
  upsertState(accountId, personId, { birthday_dismissed: 1, birthday_suggestion: null })
}

/** Salva só o aniversário do contato (depois do clique de confirmação). */
export function setBirthday(accountId: string, personId: number, raw: string): string {
  ownPerson(accountId, personId)
  const date = validDate(normalizeDate(raw))
  if (!date) throw new Error('Data inválida. Use dia/mês ou dia/mês/ano, por exemplo 12/03.')
  getDb()
    .prepare('UPDATE people SET birthday = ?, updated_at = ? WHERE id = ? AND account_id = ?')
    .run(date, Date.now(), personId, accountId)
  upsertState(accountId, personId, { birthday_suggestion: null })
  return date
}
