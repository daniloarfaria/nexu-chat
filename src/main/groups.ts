import { EventEmitter } from 'node:events'
import { jidNormalizedUser, type GroupMetadata, type WASocket } from 'baileys'
import type { GroupInfo, GroupRule, MessageItem } from '@shared/types'

export type { GroupInfo, GroupRule }
import { getDb, transaction } from './db'
import { getAccount } from './accounts'
import { fold, hasLink, normalizePhone, randomBetween } from '@shared/rules'
import { canonJid, getRawMessage, phoneOf, setGroupName } from './wa/store'
import { sendAndStore } from './wa/send'
import { log } from './log'
import { enqueueSend } from './outbox'

export const groupEvents = new EventEmitter()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Participant {
  id: string
  pn: string | null
  admin: boolean
}

function participantsOf(accountId: string, g: GroupMetadata): Participant[] {
  return (g.participants ?? []).map((p) => {
    const alt = (p as { phoneNumber?: string }).phoneNumber
    const jid = canonJid(accountId, p.id, alt)
    return { id: p.id, pn: phoneOf(jid), admin: !!p.admin }
  })
}

export async function refreshGroups(sock: WASocket, accountId: string): Promise<GroupInfo[]> {
  const all = await sock.groupFetchAllParticipating()
  const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : ''
  const meLid = (sock.user as { lid?: string } | undefined)?.lid
    ? jidNormalizedUser((sock.user as { lid: string }).lid)
    : ''
  const db = getDb()
  const up = db.prepare(
    `INSERT INTO groups_cache (account_id, jid, subject, description, size, is_admin, announce, participants, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET subject = excluded.subject, description = excluded.description,
     size = excluded.size, is_admin = excluded.is_admin, announce = excluded.announce, participants = excluded.participants, updated_at = excluded.updated_at`
  )
  transaction(db, () => {
    db.prepare('DELETE FROM groups_cache WHERE account_id = ?').run(accountId)
    for (const g of Object.values(all)) {
      const parts = participantsOf(accountId, g)
      const mine = (g.participants ?? []).find((p) => {
        const id = jidNormalizedUser(p.id)
        return id === me || id === meLid
      })
      up.run(
        accountId,
        g.id,
        g.subject ?? '',
        g.desc ?? null,
        parts.length,
        mine?.admin ? 1 : 0,
        g.announce ? 1 : 0,
        JSON.stringify(parts),
        Date.now()
      )
    }
  })
  for (const g of Object.values(all)) if (g.subject) setGroupName(accountId, g.id, g.subject)
  return listGroups(accountId)
}

export function listGroups(accountId: string): GroupInfo[] {
  return (
    getDb()
      .prepare('SELECT * FROM groups_cache WHERE account_id = ? ORDER BY subject COLLATE NOCASE')
      .all(accountId) as Array<Record<string, unknown>>
  ).map((r) => ({
    jid: r.jid as string,
    subject: (r.subject as string) || 'Grupo',
    description: (r.description as string) ?? null,
    size: r.size as number,
    isAdmin: !!r.is_admin,
    announce: !!r.announce,
    updatedAt: r.updated_at as number
  }))
}

function cachedParticipants(accountId: string, jid: string): Participant[] {
  const r = getDb()
    .prepare('SELECT participants FROM groups_cache WHERE account_id = ? AND jid = ?')
    .get(accountId, jid) as { participants: string | null } | undefined
  return r?.participants ? (JSON.parse(r.participants) as Participant[]) : []
}

/** Copia os participantes (com número conhecido) para a base de contatos, com etiqueta do grupo. */
export function extractMembers(
  accountId: string,
  groupJids: string[]
): { added: number; existing: number; withoutNumber: number } {
  const db = getDb()
  const res = { added: 0, existing: 0, withoutNumber: 0 }
  const contactName = db.prepare(
    'SELECT COALESCE(name, notify, verified_name) AS n FROM contacts WHERE account_id = ? AND jid = ?'
  )
  transaction(db, () => {
    for (const gj of groupJids) {
      const g = listGroups(accountId).find((x) => x.jid === gj)
      const tag = `Grupo: ${(g?.subject ?? 'grupo').slice(0, 32)}`
      for (const p of cachedParticipants(accountId, gj)) {
        if (!p.pn) {
          res.withoutNumber++
          continue
        }
        const jid = `${p.pn}@s.whatsapp.net`
        const name = (contactName.get(accountId, jid) as { n: string | null } | undefined)?.n ?? null
        const cur = db.prepare('SELECT id FROM people WHERE account_id = ? AND phone = ?').get(accountId, p.pn) as
          { id: number } | undefined
        let id: number
        if (cur) {
          id = cur.id
          res.existing++
        } else {
          id = Number(
            db
              .prepare(
                'INSERT INTO people (account_id, phone, jid, name, has_wa, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
              )
              .run(accountId, p.pn, jid, name, Date.now(), Date.now()).lastInsertRowid
          )
          res.added++
        }
        db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?, ?)').run(id, tag)
      }
    }
  })
  return res
}

/**
 * Cria um grupo e adiciona os participantes devagar (lotes de 5 com intervalo),
 * porque adicionar muita gente de uma vez é um dos gatilhos de bloqueio.
 */
export async function createGroup(
  sock: WASocket,
  accountId: string,
  getSocket: (accountId: string) => WASocket | null,
  input: { subject: string; description?: string; phones: string[]; adminsOnly?: boolean }
): Promise<{ jid: string; inviteLink: string | null; queued: number }> {
  const phones = [...new Set(input.phones.map((p) => normalizePhone(p)).filter(Boolean) as string[])]
  if (!input.subject.trim()) throw new Error('Dê um nome ao grupo')
  if (!phones.length) throw new Error('Escolha pelo menos um participante')
  const jids = phones.map((p) => `${p}@s.whatsapp.net`)
  const first = jids.slice(0, 5)
  const rest = jids.slice(5)
  const g = await sock.groupCreate(input.subject.trim().slice(0, 100), first)
  const firstBlocked = (g.participants ?? []).filter(
    (p) => (p as { error?: string }).error && (p as { error?: string }).error !== '200'
  ).length
  if (input.description)
    await sock.groupUpdateDescription(g.id, input.description.slice(0, 2000)).catch(() => undefined)
  if (input.adminsOnly) await sock.groupSettingUpdate(g.id, 'announcement').catch(() => undefined)
  let invite: string | null
  try {
    invite = `https://chat.whatsapp.com/${await sock.groupInviteCode(g.id)}`
  } catch {
    invite = null
  }
  setGroupName(accountId, g.id, input.subject.trim())
  // Restante em segundo plano
  void (async () => {
    let done = first.length
    const blocked: string[] = Array(firstBlocked).fill('')
    for (let i = 0; i < rest.length; i += 5) {
      await sleep(randomBetween(30_000, 60_000))
      const batch = rest.slice(i, i + 5)
      // Usa a conexão atual (pode ter reconectado durante a espera)
      const cur = getSocket(accountId)
      try {
        if (!cur) throw new Error('WhatsApp desconectado')
        const r = await cur.groupParticipantsUpdate(g.id, batch, 'add')
        for (const x of r) if (x.status !== '200') blocked.push(x.jid ?? '')
      } catch (e) {
        blocked.push(...batch)
        log.warn('Falha ao adicionar participantes', { erro: (e as Error).message })
      }
      done += batch.length
      groupEvents.emit('create-progress', { accountId, jid: g.id, done, total: jids.length, blocked: blocked.length })
    }
    groupEvents.emit('create-progress', {
      accountId,
      jid: g.id,
      done: jids.length,
      total: jids.length,
      blocked: blocked.length,
      finished: true
    })
  })()
  return { jid: g.id, inviteLink: invite, queued: rest.length }
}

export async function groupInviteLink(sock: WASocket, jid: string): Promise<string> {
  return `https://chat.whatsapp.com/${await sock.groupInviteCode(jid)}`
}

// ---------- Moderação ----------

export function getGroupRule(accountId: string, jid: string): GroupRule {
  const r = getDb().prepare('SELECT * FROM group_rules WHERE account_id = ? AND group_jid = ?').get(accountId, jid) as
    { welcome: string | null; anti_link: number; banned_words: string | null; max_warnings: number } | undefined
  return {
    welcome: r?.welcome ?? null,
    antiLink: !!r?.anti_link,
    bannedWords: r?.banned_words ? (JSON.parse(r.banned_words) as string[]) : [],
    maxWarnings: r?.max_warnings ?? 2
  }
}

export function saveGroupRule(accountId: string, jid: string, rule: GroupRule): GroupRule {
  getDb()
    .prepare(
      `INSERT INTO group_rules (account_id, group_jid, welcome, anti_link, banned_words, max_warnings) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET welcome = excluded.welcome, anti_link = excluded.anti_link, banned_words = excluded.banned_words, max_warnings = excluded.max_warnings`
    )
    .run(
      accountId,
      jid,
      rule.welcome?.trim() || null,
      rule.antiLink ? 1 : 0,
      JSON.stringify(rule.bannedWords.map((w) => w.trim()).filter(Boolean)),
      Math.max(0, Math.min(10, rule.maxWarnings))
    )
  return getGroupRule(accountId, jid)
}

/** Motivo da infração, ou null. Função pura para teste. */
export function violation(rule: GroupRule, text: string | null): string | null {
  if (!text) return null
  if (rule.antiLink && hasLink(text)) return 'links não são permitidos neste grupo'
  const t = fold(text)
  const word = rule.bannedWords.find(
    (w) => w && new RegExp(`(^|[^\\p{L}])${fold(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(t)
  )
  return word ? 'esta mensagem não é permitida neste grupo' : null
}

export async function moderateGroupMessage(sock: WASocket, accountId: string, m: MessageItem): Promise<void> {
  const account = getAccount(accountId)
  if (!account?.modules.gruposModeracao) return
  const rule = getGroupRule(accountId, m.chatJid)
  const why = violation(rule, m.text)
  if (!why || !m.sender) return
  const group = listGroups(accountId).find((g) => g.jid === m.chatJid)
  if (!group?.isAdmin) return // sem admin não dá para apagar nem remover
  const parts = cachedParticipants(accountId, m.chatJid)
  const author = parts.find((p) => p.id === m.sender || (p.pn && m.sender?.startsWith(p.pn)))
  if (author?.admin) return

  const raw = getRawMessage(accountId, m.chatJid, m.id)
  if (raw) enqueueSend(accountId, () => sock.sendMessage(m.chatJid, { delete: raw.key }))

  const db = getDb()
  db.prepare(
    'INSERT INTO group_warnings (account_id, group_jid, participant, count) VALUES (?, ?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1'
  ).run(accountId, m.chatJid, m.sender)
  const count = (
    db
      .prepare('SELECT count FROM group_warnings WHERE account_id = ? AND group_jid = ? AND participant = ?')
      .get(accountId, m.chatJid, m.sender) as {
      count: number
    }
  ).count
  const mention = raw?.key.participant ?? m.sender
  const handle = '@' + (phoneOf(m.sender) ?? mention.split('@')[0])
  if (rule.maxWarnings > 0 && count > rule.maxWarnings) {
    enqueueSend(accountId, async () => {
      await sendAndStore(sock, accountId, m.chatJid, {
        text: `${handle} foi removido(a): ${why}.`,
        mentions: [mention]
      })
      await sock.groupParticipantsUpdate(m.chatJid, [mention], 'remove')
    })
    db.prepare('DELETE FROM group_warnings WHERE account_id = ? AND group_jid = ? AND participant = ?').run(
      accountId,
      m.chatJid,
      m.sender
    )
  } else {
    const left = Math.max(0, rule.maxWarnings - count + 1)
    const text = `${handle}, ${why}.${rule.maxWarnings > 0 ? ` Aviso ${count} de ${rule.maxWarnings}${left === 1 ? ' — no próximo, a remoção é automática' : ''}.` : ''}`
    enqueueSend(accountId, () => sendAndStore(sock, accountId, m.chatJid, { text, mentions: [mention] }))
  }
}

export async function welcomeParticipants(
  sock: WASocket,
  accountId: string,
  groupJid: string,
  participants: Array<{ id: string; phoneNumber?: string } | string>
): Promise<void> {
  const account = getAccount(accountId)
  if (!account?.modules.gruposModeracao) return
  const rule = getGroupRule(accountId, groupJid)
  if (!rule.welcome) return
  const ids = participants.map((p) => (typeof p === 'string' ? p : p.id))
  const handles = participants.map((p) => {
    const id = typeof p === 'string' ? p : p.id
    const alt = typeof p === 'string' ? undefined : p.phoneNumber
    return '@' + (phoneOf(canonJid(accountId, id, alt)) ?? id.split('@')[0])
  })
  const group = listGroups(accountId).find((g) => g.jid === groupJid)
  const text = rule.welcome
    .replace(/\{nome\}|\{participante\}/gi, handles.join(', '))
    .replace(/\{grupo\}/gi, group?.subject ?? '')
  enqueueSend(accountId, () => sendAndStore(sock, accountId, groupJid, { text, mentions: ids }))
}
