import { EventEmitter } from 'node:events'
import { isJidGroup, isLidUser, jidNormalizedUser, proto, type Chat, type Contact, type WAMessage } from 'baileys'
import type { ChatFilter, ChatItem, MediaInfo, MessageExtra, MessageItem, MessageType, SyncState } from '@shared/types'
import { getDb, transaction } from '../db'
import { log } from '../log'
import { extractAdAttribution, recordAttribution } from '../ads'
import { mutationOf, parseMessage, previewOf } from './parse'

/**
 * Persistência das conversas no SQLite.
 * Identificadores: o WhatsApp está migrando contatos para "LID" (@lid). Sempre que sabemos
 * o número (pn) de um LID, a conversa é guardada pelo número, para não duplicar a pessoa.
 */

export const storeEvents = new EventEmitter()
storeEvents.setMaxListeners(50)

const STATUS_JID = 'status@broadcast'

// ---------- utilidades de JID ----------

export function phoneOf(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null
  return jid.split('@')[0].split(':')[0]
}

function lidToPn(accountId: string, jid: string): string | null {
  const r = getDb().prepare('SELECT pn FROM lid_map WHERE account_id = ? AND lid = ?').get(accountId, jid) as
    { pn: string } | undefined
  return r?.pn ?? null
}

/** JID canônico da conversa: número quando conhecido, senão o próprio JID. */
export function canonJid(accountId: string, jid: string | null | undefined, alt?: string | null): string {
  if (!jid) return ''
  const n = jidNormalizedUser(jid) || jid
  if (isLidUser(n)) {
    if (alt && alt.endsWith('@s.whatsapp.net')) return jidNormalizedUser(alt)
    return lidToPn(accountId, n) ?? n
  }
  return n
}

// ---------- mudanças agregadas para a interface ----------

type Pending = { chats: Set<string>; messages: Map<string, Set<string>> }
const pending = new Map<string, Pending>()
let flushTimer: NodeJS.Timeout | null = null

function touch(accountId: string, chatJid: string, msgId?: string): void {
  let p = pending.get(accountId)
  if (!p) pending.set(accountId, (p = { chats: new Set(), messages: new Map() }))
  p.chats.add(chatJid)
  if (msgId) {
    let s = p.messages.get(chatJid)
    if (!s) p.messages.set(chatJid, (s = new Set()))
    s.add(msgId)
  }
  if (!flushTimer) flushTimer = setTimeout(flush, 250)
}

function flush(): void {
  flushTimer = null
  for (const [accountId, p] of pending) {
    storeEvents.emit('chats', { accountId, jids: [...p.chats] })
    for (const [chatJid, ids] of p.messages) {
      if (ids.size > 200) storeEvents.emit('reload', { accountId, chatJid })
      else
        storeEvents.emit('messages', { accountId, chatJid, messages: getMessagesByIds(accountId, chatJid, [...ids]) })
    }
  }
  pending.clear()
}

// ---------- contatos e LID ----------

export function saveLidMappings(accountId: string, maps: Array<{ lid: string; pn: string }>): void {
  if (!maps.length) return
  const db = getDb()
  const ins = db.prepare(
    'INSERT INTO lid_map (account_id, lid, pn) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET pn = excluded.pn'
  )
  transaction(db, () => {
    for (const m of maps) {
      const lid = jidNormalizedUser(m.lid)
      const pn = jidNormalizedUser(m.pn)
      if (!lid || !pn || !isLidUser(lid)) continue
      ins.run(accountId, lid, pn)
      mergeChat(accountId, lid, pn)
    }
  })
}

/** A origem de anúncio segue a conversa: o destino completa campos vazios e fica com a origem mais antiga. */
function mergeAttribution(accountId: string, from: string, to: string): void {
  const db = getDb()
  const src = db
    .prepare('SELECT first_ts FROM chat_attribution WHERE account_id = ? AND chat_jid = ?')
    .get(accountId, from) as { first_ts: number } | undefined
  if (!src) return
  db.prepare('UPDATE OR IGNORE chat_attribution SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(
    to,
    accountId,
    from
  )
  // Se o destino já tinha origem, a do LID completa o que faltava
  const cols = ['conversion_source', 'entry_point', 'ad_id', 'ad_url', 'ctwa_clid']
  const fill = cols
    .map((c) => `${c} = COALESCE(${c}, (SELECT ${c} FROM chat_attribution WHERE account_id = ?1 AND chat_jid = ?2))`)
    .join(', ')
  db.prepare(
    `UPDATE chat_attribution SET ${fill}, first_ts = MIN(first_ts, ?3) WHERE account_id = ?1 AND chat_jid = ?4`
  ).run(accountId, from, src.first_ts, to)
  db.prepare('DELETE FROM chat_attribution WHERE account_id = ? AND chat_jid = ?').run(accountId, from)
}

/** Junta a conversa guardada pelo LID na conversa do número. */
function mergeChat(accountId: string, from: string, to: string): void {
  const db = getDb()
  // Vendas e registros de automação acompanham a conversa (mesmo sem mensagens salvas no LID)
  db.prepare('UPDATE deals SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(to, accountId, from)
  db.prepare('UPDATE auto_log SET jid = ? WHERE account_id = ? AND jid = ?').run(to, accountId, from)
  mergeAttribution(accountId, from, to)
  db.prepare('UPDATE OR IGNORE chat_ai_mode SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(
    to,
    accountId,
    from
  )
  db.prepare('DELETE FROM chat_ai_mode WHERE account_id = ? AND chat_jid = ?').run(accountId, from)
  db.prepare('UPDATE ia_atendimento_log SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(
    to,
    accountId,
    from
  )
  const exists = db.prepare('SELECT 1 FROM chats WHERE account_id = ? AND jid = ?').get(accountId, from)
  if (!exists) return
  db.prepare(
    `INSERT INTO chats (account_id, jid, name, is_group, unread, last_ts, last_preview, last_from_me, archived, pinned, muted_until, read_only)
     SELECT account_id, ?, name, is_group, unread, last_ts, last_preview, last_from_me, archived, pinned, muted_until, read_only
     FROM chats WHERE account_id = ? AND jid = ?
     ON CONFLICT(account_id, jid) DO UPDATE SET
       unread = chats.unread + excluded.unread,
       name = COALESCE(chats.name, excluded.name),
       last_preview = CASE WHEN excluded.last_ts > chats.last_ts THEN excluded.last_preview ELSE chats.last_preview END,
       last_from_me = CASE WHEN excluded.last_ts > chats.last_ts THEN excluded.last_from_me ELSE chats.last_from_me END,
       last_ts = MAX(chats.last_ts, excluded.last_ts)`
  ).run(to, accountId, from)
  db.prepare('UPDATE OR IGNORE messages SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(
    to,
    accountId,
    from
  )
  db.prepare('DELETE FROM messages WHERE account_id = ? AND chat_jid = ?').run(accountId, from)
  // Evita resultado duplicado na busca: remove do índice as cópias que já existem na conversa de destino
  db.prepare(
    'DELETE FROM messages_fts WHERE account_id = ? AND chat_jid = ? AND id IN (SELECT id FROM messages_fts WHERE account_id = ? AND chat_jid = ?)'
  ).run(accountId, from, accountId, to)
  db.prepare('UPDATE messages_fts SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(to, accountId, from)
  db.prepare('DELETE FROM chats WHERE account_id = ? AND jid = ?').run(accountId, from)
  storeEvents.emit('merged', { accountId, from, to })
}

export function saveContacts(accountId: string, contacts: Partial<Contact>[]): void {
  if (!contacts.length) return
  const db = getDb()
  const up = db.prepare(
    `INSERT INTO contacts (account_id, jid, name, notify, verified_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, jid) DO UPDATE SET
       name = COALESCE(excluded.name, contacts.name),
       notify = COALESCE(excluded.notify, contacts.notify),
       verified_name = COALESCE(excluded.verified_name, contacts.verified_name),
       updated_at = excluded.updated_at`
  )
  const maps: Array<{ lid: string; pn: string }> = []
  transaction(db, () => {
    for (const c of contacts) {
      if (!c.id) continue
      const id = jidNormalizedUser(c.id)
      if (c.lid && c.phoneNumber) maps.push({ lid: c.lid, pn: c.phoneNumber })
      else if (isLidUser(id) && c.phoneNumber) maps.push({ lid: id, pn: c.phoneNumber })
      else if (c.lid && id.endsWith('@s.whatsapp.net')) maps.push({ lid: c.lid, pn: id })
      const jid = canonJid(accountId, id, c.phoneNumber)
      up.run(accountId, jid, c.name ?? null, c.notify ?? null, c.verifiedName ?? null, Date.now())
      touch(accountId, jid)
    }
  })
  saveLidMappings(accountId, maps)
}

// ---------- conversas ----------

export function saveChats(accountId: string, chats: Partial<Chat>[], fromUpdate = false): void {
  if (!chats.length) return
  const db = getDb()
  const up = db.prepare(
    `INSERT INTO chats (account_id, jid, name, is_group, unread, last_ts, archived, pinned, muted_until, read_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, jid) DO UPDATE SET
       name = COALESCE(excluded.name, chats.name),
       unread = CASE WHEN ? THEN (CASE WHEN excluded.unread = 1 AND chats.unread > 0 THEN chats.unread ELSE excluded.unread END) ELSE chats.unread END,
       last_ts = MAX(chats.last_ts, excluded.last_ts),
       archived = CASE WHEN ? THEN excluded.archived ELSE chats.archived END,
       pinned = CASE WHEN ? THEN excluded.pinned ELSE chats.pinned END,
       muted_until = CASE WHEN ? THEN excluded.muted_until ELSE chats.muted_until END,
       read_only = CASE WHEN ? THEN excluded.read_only ELSE chats.read_only END`
  )
  transaction(db, () => {
    for (const c of chats) {
      if (!c.id || c.id === STATUS_JID || c.id.endsWith('@newsletter') || c.id.endsWith('@broadcast')) continue
      const jid = canonJid(accountId, c.id, (c as { pnJid?: string }).pnJid)
      const ts = Number(c.conversationTimestamp ?? c.lastMessageRecvTimestamp ?? 0)
      // Em chats.update o Baileys manda unreadCount como incremento (+1), que o saveMessages já conta.
      // Só valem: 0 (lida em outro aparelho) e -1 (marcada como não lida). No histórico, é o total.
      const u = c.unreadCount
      const setUnread = fromUpdate ? u === 0 || (u != null && u < 0) : u != null
      const unreadValue = u != null && u < 0 ? 1 : Math.max(0, u ?? 0)
      up.run(
        accountId,
        jid,
        c.name ?? null,
        isJidGroup(jid) ? 1 : 0,
        unreadValue,
        ts,
        c.archived ? 1 : 0,
        c.pinned ? Number(c.pinned) : 0,
        Number(c.muteEndTime ?? 0),
        c.readOnly ? 1 : 0,
        setUnread ? 1 : 0,
        'archived' in c ? 1 : 0,
        'pinned' in c ? 1 : 0, // null = desafixada
        'muteEndTime' in c ? 1 : 0, // null = sem silêncio
        'readOnly' in c ? 1 : 0
      )
      touch(accountId, jid)
    }
  })
}

export function deleteChats(accountId: string, jids: string[]): void {
  const db = getDb()
  transaction(db, () => {
    for (const j of jids) {
      const jid = canonJid(accountId, j)
      db.prepare('DELETE FROM chats WHERE account_id = ? AND jid = ?').run(accountId, jid)
      db.prepare('DELETE FROM chat_attribution WHERE account_id = ? AND chat_jid = ?').run(accountId, jid)
      db.prepare('DELETE FROM messages WHERE account_id = ? AND chat_jid = ?').run(accountId, jid)
      db.prepare('DELETE FROM messages_fts WHERE account_id = ? AND chat_jid = ?').run(accountId, jid)
      touch(accountId, jid)
    }
  })
}

export function setGroupName(accountId: string, jid: string, name: string): void {
  getDb()
    .prepare(
      'INSERT INTO chats (account_id, jid, name, is_group) VALUES (?, ?, ?, 1) ON CONFLICT DO UPDATE SET name = excluded.name'
    )
    .run(accountId, jid, name)
  touch(accountId, jid)
}

export function markChatRead(accountId: string, jid: string): void {
  getDb().prepare('UPDATE chats SET unread = 0 WHERE account_id = ? AND jid = ?').run(accountId, jid)
  touch(accountId, jid)
}

// ---------- mensagens ----------

export interface SaveOpts {
  /** mensagem nova em tempo real (conta como não lida e atualiza a prévia) */
  live: boolean
  ownJid?: string | null
}

const encodeRaw = (m: WAMessage): Uint8Array => proto.WebMessageInfo.encode(m as proto.IWebMessageInfo).finish()

/** Grava mensagens (histórico ou novas). Retorna as mensagens novas que podem gerar notificação. */
export function saveMessages(accountId: string, msgs: WAMessage[], opts: SaveOpts): MessageItem[] {
  if (!msgs.length) return []
  const db = getDb()
  const ins = db.prepare(
    `INSERT INTO messages (account_id, chat_jid, id, from_me, sender, sender_name, ts, type, text, media, extra, quoted_id, status, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, chat_jid, id) DO UPDATE SET
       status = MAX(messages.status, excluded.status),
       raw = CASE WHEN messages.deleted = 1 THEN NULL ELSE COALESCE(excluded.raw, messages.raw) END,
       media = CASE WHEN messages.deleted = 1 THEN NULL WHEN messages.media IS NULL THEN excluded.media ELSE messages.media END`
  )
  const fts = db.prepare('INSERT INTO messages_fts (text, account_id, chat_jid, id) VALUES (?, ?, ?, ?)')
  const exists = db.prepare('SELECT type, deleted FROM messages WHERE account_id = ? AND chat_jid = ? AND id = ?')
  const fill = db.prepare(
    'UPDATE messages SET type = ?, text = ?, media = ?, extra = ?, quoted_id = ? WHERE account_id = ? AND chat_jid = ? AND id = ?'
  )
  const chatUp = db.prepare(
    `INSERT INTO chats (account_id, jid, name, is_group, unread, last_ts, last_preview, last_from_me)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, jid) DO UPDATE SET
       unread = chats.unread + excluded.unread,
       last_preview = CASE WHEN excluded.last_ts >= chats.last_ts THEN excluded.last_preview ELSE chats.last_preview END,
       last_from_me = CASE WHEN excluded.last_ts >= chats.last_ts THEN excluded.last_from_me ELSE chats.last_from_me END,
       last_ts = MAX(chats.last_ts, excluded.last_ts),
       archived = CASE WHEN excluded.unread > 0 AND chats.muted_until = 0 THEN 0 ELSE chats.archived END`
  )
  const fresh: Array<{ chat: string; id: string }> = []
  const maps: Array<{ lid: string; pn: string }> = []

  transaction(db, () => {
    for (const m of msgs) {
      const key = m.key
      if (!key?.id || !key.remoteJid) continue
      if (key.remoteJid === STATUS_JID || key.remoteJid.endsWith('@newsletter')) continue
      const k = key as typeof key & { remoteJidAlt?: string; participantAlt?: string }
      if (k.remoteJidAlt && isLidUser(key.remoteJid)) maps.push({ lid: key.remoteJid, pn: k.remoteJidAlt })
      if (k.participantAlt && key.participant && isLidUser(key.participant))
        maps.push({ lid: key.participant, pn: k.participantAlt })

      const chat = canonJid(accountId, key.remoteJid, k.remoteJidAlt)
      const mut = mutationOf(m)
      if (mut) {
        const actor = key.fromMe
          ? (opts.ownJid ?? 'me')
          : key.participant
            ? canonJid(accountId, key.participant, k.participantAlt)
            : chat
        applyMutation(accountId, chat, mut, actor, !!key.fromMe)
        continue
      }
      const ad = !key.fromMe && !isJidGroup(chat) ? extractAdAttribution(m) : null
      if (ad) {
        try {
          recordAttribution(accountId, chat, ad, Number(m.messageTimestamp ?? 0) || Math.floor(Date.now() / 1000))
        } catch (e) {
          log.warn('Falha ao guardar a origem do anúncio', { erro: String(e) })
        }
      }
      const p = parseMessage(m)
      if (p.type === 'system' && !isJidGroup(chat) && p.extra?.label === 'Atualização do grupo') continue
      const fromMe = key.fromMe ? 1 : 0
      const sender = fromMe ? null : key.participant ? canonJid(accountId, key.participant, k.participantAlt) : chat
      const ts = Number(m.messageTimestamp ?? 0) || Math.floor(Date.now() / 1000)
      const prev = exists.get(accountId, chat, key.id) as { type: string; deleted: number } | undefined
      // Aviso "não pôde ser lida" (mensagem ainda cifrada) substituído pelo conteúdo real: conta como nova
      const upgraded = !!prev && prev.type === 'system' && p.type !== 'system' && !prev.deleted
      const isNew = !prev || upgraded
      if (upgraded) {
        fill.run(
          p.type,
          p.text,
          p.media ? JSON.stringify(p.media) : null,
          p.extra ? JSON.stringify(p.extra) : null,
          p.quotedId,
          accountId,
          chat,
          key.id
        )
      }
      ins.run(
        accountId,
        chat,
        key.id,
        fromMe,
        sender,
        m.pushName ?? null,
        ts,
        p.type,
        p.text,
        p.media ? JSON.stringify(p.media) : null,
        p.extra ? JSON.stringify(p.extra) : null,
        p.quotedId,
        m.status ?? (fromMe ? 2 : 0),
        encodeRaw(m)
      )
      if (isNew) {
        if (p.text) fts.run(p.text, accountId, chat, key.id)
        const unread = opts.live && !fromMe && p.type !== 'system' ? 1 : 0
        chatUp.run(
          accountId,
          chat,
          null,
          isJidGroup(chat) ? 1 : 0,
          unread,
          ts,
          previewOf(p.type, p.text, p.media),
          fromMe
        )
        if (opts.live) fresh.push({ chat, id: key.id })
      }
      touch(accountId, chat, key.id)
    }
  })
  saveLidMappings(accountId, maps)

  return fresh.map((f) => getMessagesByIds(accountId, f.chat, [f.id])[0]).filter((x) => x && !x.fromMe)
}

function applyMutation(
  accountId: string,
  chat: string,
  mut: ReturnType<typeof mutationOf>,
  actor: string,
  actorIsMe: boolean
): void {
  if (!mut || mut.kind === 'ignore') return
  const db = getDb()
  const row = db
    .prepare(
      'SELECT chat_jid, reactions, sender, from_me, deleted FROM messages WHERE account_id = ? AND id = ? AND chat_jid = ?'
    )
    .get(accountId, mut.targetId, chat) as
    { chat_jid: string; reactions: string | null; sender: string | null; from_me: number; deleted: number } | undefined
  if (!row) return
  // Editar/apagar só vale vindo de quem escreveu a mensagem
  if (mut.kind !== 'reaction') {
    const isAuthor = row.from_me
      ? actorIsMe
      : !actorIsMe && (row.sender === actor || (!isJidGroup(chat) && actor === chat))
    if (!isAuthor || row.deleted) return
  }
  if (mut.kind === 'reaction') {
    const r = row.reactions ? (JSON.parse(row.reactions) as Record<string, string>) : {}
    if (mut.emoji) r[actor] = mut.emoji
    else delete r[actor]
    db.prepare('UPDATE messages SET reactions = ? WHERE account_id = ? AND chat_jid = ? AND id = ?').run(
      Object.keys(r).length ? JSON.stringify(r) : null,
      accountId,
      chat,
      mut.targetId
    )
  } else if (mut.kind === 'revoke') {
    const old = db
      .prepare('SELECT media FROM messages WHERE account_id = ? AND chat_jid = ? AND id = ?')
      .get(accountId, chat, mut.targetId) as { media: string | null } | undefined
    const file = old?.media ? (JSON.parse(old.media) as { file?: string }).file : undefined
    if (file) storeEvents.emit('purge-media', { accountId, file })
    // Apagada para todos: não guarda mais o conteúdo (nem o original bruto)
    db.prepare(
      'UPDATE messages SET deleted = 1, text = NULL, raw = NULL, media = NULL, extra = NULL WHERE account_id = ? AND chat_jid = ? AND id = ?'
    ).run(accountId, chat, mut.targetId)
    db.prepare('DELETE FROM messages_fts WHERE account_id = ? AND chat_jid = ? AND id = ?').run(
      accountId,
      chat,
      mut.targetId
    )
  } else if (mut.kind === 'edit') {
    db.prepare('UPDATE messages SET text = ?, edited = 1 WHERE account_id = ? AND chat_jid = ? AND id = ?').run(
      mut.text,
      accountId,
      chat,
      mut.targetId
    )
    db.prepare('UPDATE messages_fts SET text = ? WHERE account_id = ? AND chat_jid = ? AND id = ?').run(
      mut.text,
      accountId,
      chat,
      mut.targetId
    )
  }
  touch(accountId, chat, mut.targetId)
}

export function updateStatus(accountId: string, remoteJid: string, id: string, status: number): void {
  const chat = canonJid(accountId, remoteJid)
  const r = getDb()
    .prepare('UPDATE messages SET status = MAX(status, ?) WHERE account_id = ? AND chat_jid = ? AND id = ?')
    .run(status, accountId, chat, id)
  if (r.changes) touch(accountId, chat, id)
  storeEvents.emit('status', { accountId, id, status })
}

export function setMediaUrl(accountId: string, chatJid: string, id: string, media: MediaInfo): void {
  getDb()
    .prepare('UPDATE messages SET media = ? WHERE account_id = ? AND chat_jid = ? AND id = ?')
    .run(JSON.stringify(media), accountId, chatJid, id)
  touch(accountId, chatJid, id)
}

export function getRawMessage(accountId: string, chatJid: string, id: string): WAMessage | null {
  const r = getDb()
    .prepare('SELECT raw FROM messages WHERE account_id = ? AND chat_jid = ? AND id = ?')
    .get(accountId, chatJid, id) as { raw: Uint8Array | null } | undefined
  return r?.raw ? (proto.WebMessageInfo.decode(r.raw) as WAMessage) : null
}

/** Usado pelo Baileys para reenviar mensagens que o destinatário não conseguiu decifrar. */
export function findRawById(
  accountId: string,
  remoteJid: string | null | undefined,
  id: string
): proto.IMessage | undefined {
  // Só a conversa que pediu o reenvio (nunca outra conversa com o mesmo id)
  if (!remoteJid) return undefined
  const chat = canonJid(accountId, remoteJid)
  const r = getDb()
    .prepare(
      'SELECT raw FROM messages WHERE account_id = ? AND chat_jid = ? AND id = ? AND from_me = 1 AND deleted = 0'
    )
    .get(accountId, chat, id) as { raw: Uint8Array | null } | undefined
  return r?.raw ? (proto.WebMessageInfo.decode(r.raw).message ?? undefined) : undefined
}

// ---------- leitura para a interface ----------

interface ChatRow {
  jid: string
  name: string | null
  is_group: number
  unread: number
  last_ts: number
  last_preview: string | null
  last_from_me: number
  archived: number
  pinned: number
  muted_until: number
  read_only: number
  from_ad: number
  ai_mode: string | null
  ai_reason: string | null
  c_name: string | null
  c_notify: string | null
  c_verified: string | null
}

function chatName(r: ChatRow): string {
  const phone = phoneOf(r.jid)
  return r.c_name || r.name || r.c_verified || r.c_notify || (phone ? '+' + phone : r.is_group ? 'Grupo' : 'Contato')
}

function toChat(r: ChatRow): ChatItem {
  const now = Date.now() / 1000
  return {
    jid: r.jid,
    name: chatName(r),
    phone: phoneOf(r.jid),
    isGroup: !!r.is_group,
    unread: r.unread,
    lastTs: r.last_ts,
    lastPreview: r.last_preview,
    lastFromMe: !!r.last_from_me,
    archived: !!r.archived,
    pinned: !!r.pinned,
    muted: r.muted_until === -1 || r.muted_until > now,
    readOnly: !!r.read_only,
    fromAd: !!r.from_ad,
    ai: r.ai_mode ? { mode: r.ai_mode as 'ia' | 'humano' | 'espera', reason: r.ai_reason } : null
  }
}

const CHAT_SELECT = `SELECT ch.*,
  EXISTS (SELECT 1 FROM chat_attribution ca WHERE ca.account_id = ch.account_id AND ca.chat_jid = ch.jid) AS from_ad,
  am.mode AS ai_mode, am.reason AS ai_reason,
  co.name AS c_name, co.notify AS c_notify, co.verified_name AS c_verified
  FROM chats ch LEFT JOIN contacts co ON co.account_id = ch.account_id AND co.jid = ch.jid
  LEFT JOIN chat_ai_mode am ON am.account_id = ch.account_id AND am.chat_jid = ch.jid`

export function listChats(
  accountId: string,
  opts: { filter: ChatFilter; search?: string; limit: number; offset: number }
): ChatItem[] {
  const where = ['ch.account_id = ?', 'ch.last_ts > 0']
  const args: Array<string | number> = [accountId]
  if (opts.filter === 'archived') where.push('ch.archived = 1')
  else where.push('ch.archived = 0')
  if (opts.filter === 'unread') where.push('ch.unread > 0')
  if (opts.filter === 'groups') where.push('ch.is_group = 1')
  if (opts.filter === 'waiting') where.push("am.mode = 'espera'")
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim().replace(/[%_]/g, '')}%`
    where.push(
      '(unaccent(ch.name) LIKE unaccent(?) OR unaccent(co.name) LIKE unaccent(?) OR unaccent(co.notify) LIKE unaccent(?) OR ch.jid LIKE ?)'
    )
    args.push(q, q, q, `%${opts.search.replace(/\D/g, '') || '§'}%`)
  }
  const rows = getDb()
    .prepare(`${CHAT_SELECT} WHERE ${where.join(' AND ')} ORDER BY ch.pinned DESC, ch.last_ts DESC LIMIT ? OFFSET ?`)
    .all(...args, opts.limit, opts.offset) as unknown as ChatRow[]
  return rows.map(toChat)
}

export function getChats(accountId: string, jids: string[]): ChatItem[] {
  if (!jids.length) return []
  const rows = getDb()
    .prepare(`${CHAT_SELECT} WHERE ch.account_id = ? AND ch.jid IN (${jids.map(() => '?').join(',')})`)
    .all(accountId, ...jids) as unknown as ChatRow[]
  return rows.map(toChat)
}

export function unreadTotal(accountId: string): number {
  const r = getDb()
    .prepare(
      'SELECT COALESCE(SUM(unread),0) AS n FROM chats WHERE account_id = ? AND archived = 0 AND (muted_until = 0 OR muted_until < ?)'
    )
    .get(accountId, Math.floor(Date.now() / 1000)) as { n: number }
  return r.n
}

interface MsgRow {
  rid: number
  transcript: string | null
  chat_jid: string
  id: string
  from_me: number
  sender: string | null
  sender_name: string | null
  ts: number
  type: MessageType
  text: string | null
  media: string | null
  extra: string | null
  quoted_id: string | null
  status: number
  reactions: string | null
  edited: number
  deleted: number
  c_name: string | null
}

function toMsg(r: MsgRow): MessageItem {
  const extra = r.extra ? (JSON.parse(r.extra) as MessageExtra) : null
  return {
    id: r.id,
    rid: r.rid,
    transcript: r.transcript,
    chatJid: r.chat_jid,
    fromMe: !!r.from_me,
    sender: r.sender,
    senderName: r.c_name || r.sender_name || (r.sender ? (phoneOf(r.sender) ? '+' + phoneOf(r.sender) : null) : null),
    ts: r.ts,
    type: r.type,
    text: r.text,
    media: r.media ? (JSON.parse(r.media) as MediaInfo) : null,
    extra,
    quotedId: r.quoted_id,
    status: r.status,
    reactions: r.reactions ? (JSON.parse(r.reactions) as Record<string, string>) : null,
    edited: !!r.edited,
    deleted: !!r.deleted
  }
}

const MSG_SELECT = `SELECT m.rowid AS rid, m.chat_jid, m.id, m.from_me, m.sender, m.sender_name, m.ts, m.type, m.text, m.media, m.extra,
  m.quoted_id, m.status, m.reactions, m.edited, m.deleted, m.transcript, co.name AS c_name
  FROM messages m LEFT JOIN contacts co ON co.account_id = m.account_id AND co.jid = m.sender`

/** Página de mensagens antes do cursor (horário, posição): nunca pula nem repete, mesmo no mesmo segundo. */
export function listMessages(
  accountId: string,
  chatJid: string,
  before: number | null,
  limit: number,
  beforeRid?: number | null
): MessageItem[] {
  const cursor = before ? (beforeRid ? 'AND (m.ts < ? OR (m.ts = ? AND m.rowid < ?))' : 'AND m.ts < ?') : ''
  const cargs = before ? (beforeRid ? [before, before, beforeRid] : [before]) : []
  const rows = getDb()
    .prepare(
      `${MSG_SELECT} WHERE m.account_id = ? AND m.chat_jid = ? ${cursor} ORDER BY m.ts DESC, m.rowid DESC LIMIT ?`
    )
    .all(accountId, chatJid, ...cargs, limit) as unknown as MsgRow[]
  return fillQuoted(accountId, rows.reverse().map(toMsg))
}

export function getMessagesByIds(accountId: string, chatJid: string, ids: string[]): MessageItem[] {
  if (!ids.length) return []
  const rows = getDb()
    .prepare(`${MSG_SELECT} WHERE m.account_id = ? AND m.chat_jid = ? AND m.id IN (${ids.map(() => '?').join(',')})`)
    .all(accountId, chatJid, ...ids) as unknown as MsgRow[]
  return fillQuoted(accountId, rows.map(toMsg))
}

/** Completa a citação com o texto real da mensagem citada, quando ela está no banco. */
function fillQuoted(accountId: string, msgs: MessageItem[]): MessageItem[] {
  const ids = [...new Set(msgs.map((m) => m.quotedId).filter(Boolean))] as string[]
  if (!ids.length) return msgs
  const rows = getDb()
    .prepare(`${MSG_SELECT} WHERE m.account_id = ? AND m.id IN (${ids.map(() => '?').join(',')})`)
    .all(accountId, ...ids) as unknown as MsgRow[]
  const byId = new Map(rows.map((r) => [r.id, toMsg(r)]))
  for (const m of msgs) {
    const q = m.quotedId ? byId.get(m.quotedId) : null
    if (q && m.extra?.quoted) {
      m.extra.quoted = {
        id: q.id,
        text: previewOf(q.type, q.text, q.media),
        type: q.type,
        fromMe: q.fromMe,
        senderName: q.fromMe ? 'Você' : (q.senderName ?? undefined)
      }
    }
  }
  return msgs
}

export function searchMessages(
  accountId: string,
  query: string,
  limit = 50
): Array<MessageItem & { chatName: string }> {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ')
  if (!terms) return []
  const hits = getDb()
    .prepare(
      'SELECT chat_jid, id FROM messages_fts WHERE messages_fts MATCH ? AND account_id = ? ORDER BY rank LIMIT ?'
    )
    .all(terms, accountId, limit) as Array<{ chat_jid: string; id: string }>
  const out: Array<MessageItem & { chatName: string }> = []
  for (const h of hits) {
    const m = getMessagesByIds(accountId, h.chat_jid, [h.id])[0]
    const c = getChats(accountId, [h.chat_jid])[0]
    if (m) out.push({ ...m, chatName: c?.name ?? h.chat_jid })
  }
  return out
}

// ---------- sincronização ----------

const syncRunning = new Map<string, NodeJS.Timeout>()

export function syncProgress(
  accountId: string,
  progress: number | null | undefined,
  added: { messages: number; chats: number }
): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO sync_state (account_id, progress, messages, chats, started_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       progress = COALESCE(excluded.progress, sync_state.progress),
       messages = sync_state.messages + excluded.messages,
       chats = sync_state.chats + excluded.chats,
       started_at = COALESCE(sync_state.started_at, excluded.started_at),
       finished_at = NULL`
  ).run(accountId, progress ?? null, added.messages, added.chats, Date.now())
  // Considera concluída quando para de chegar histórico por 20 s ou o progresso chega a 100
  const prev = syncRunning.get(accountId)
  if (prev) clearTimeout(prev)
  const finish = (): void => {
    syncRunning.delete(accountId)
    db.prepare('UPDATE sync_state SET finished_at = ? WHERE account_id = ?').run(Date.now(), accountId)
    storeEvents.emit('sync', getSyncState(accountId))
  }
  if (progress != null && progress >= 100) finish()
  else syncRunning.set(accountId, setTimeout(finish, 20_000))
  storeEvents.emit('sync', getSyncState(accountId))
}

export function getSyncState(accountId: string): SyncState {
  const r = getDb().prepare('SELECT * FROM sync_state WHERE account_id = ?').get(accountId) as
    { progress: number | null; messages: number; chats: number; finished_at: number | null } | undefined
  return {
    accountId,
    progress: r?.progress ?? null,
    messages: r?.messages ?? 0,
    chats: r?.chats ?? 0,
    running: syncRunning.has(accountId),
    finishedAt: r?.finished_at ?? null
  }
}

export function resetAccountData(accountId: string): void {
  const db = getDb()
  transaction(db, () => {
    for (const t of ['messages', 'chats', 'contacts', 'lid_map', 'sync_state']) {
      db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(accountId)
    }
    db.prepare('DELETE FROM messages_fts WHERE account_id = ?').run(accountId)
    db.prepare('DELETE FROM chat_attribution WHERE account_id = ?').run(accountId)
    // O histórico volta a ser lido do começo quando as mensagens forem baixadas de novo
    db.prepare("DELETE FROM settings WHERE key = 'ads.reprocess.cursor'").run()
  })
}

/** Reprocessa mensagens antigas marcadas como não suportadas (quando o app aprende um tipo novo). */
export function reparseUnsupported(): number {
  const db = getDb()
  const rows = db
    .prepare(
      "SELECT account_id, chat_jid, id, raw FROM messages WHERE type = 'unsupported' AND raw IS NOT NULL LIMIT 5000"
    )
    .all() as Array<{ account_id: string; chat_jid: string; id: string; raw: Uint8Array }>
  let changed = 0
  transaction(db, () => {
    for (const r of rows) {
      const msg = proto.WebMessageInfo.decode(r.raw) as WAMessage
      const mut = mutationOf(msg)
      if (mut?.kind === 'ignore') {
        db.prepare('DELETE FROM messages WHERE account_id = ? AND chat_jid = ? AND id = ?').run(
          r.account_id,
          r.chat_jid,
          r.id
        )
        changed++
        continue
      }
      const p = parseMessage(msg)
      if (p.type === 'unsupported') continue
      db.prepare(
        'UPDATE messages SET type = ?, text = ?, media = ?, extra = ? WHERE account_id = ? AND chat_jid = ? AND id = ?'
      ).run(
        p.type,
        p.text,
        p.media ? JSON.stringify(p.media) : null,
        p.extra ? JSON.stringify(p.extra) : null,
        r.account_id,
        r.chat_jid,
        r.id
      )
      if (p.text)
        db.prepare('INSERT INTO messages_fts (text, account_id, chat_jid, id) VALUES (?, ?, ?, ?)').run(
          p.text,
          r.account_id,
          r.chat_jid,
          r.id
        )
      changed++
    }
  })
  return changed
}

/** Avisa a interface que uma mensagem mudou (ex.: transcrição pronta). */
export function touchMessage(accountId: string, chatJid: string, id: string): void {
  touch(accountId, chatJid, id)
}
