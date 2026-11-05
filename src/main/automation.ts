import { isJidGroup, type WASocket } from 'baileys'
import type { AutoRule, MessageItem } from '@shared/types'
import { getDb } from './db'
import { getAccount } from './accounts'
import { fold, isOptOut, renderTemplate, sendWindow, DEFAULT_ANTIBAN, firstName } from '@shared/rules'
import { findPersonByJid, isOptedOut, optOutByJid } from './people'
import { onCampaignReceipt, onCampaignReply } from './campaigns'
import { storeEvents, getChats } from './wa/store'
import { sendAndStore } from './wa/send'
import { wa } from './wa/manager'
import { moderateGroupMessage, welcomeParticipants } from './groups'
import { log } from './log'

/**
 * Tudo que reage a mensagens recebidas:
 * - "SAIR" → lista de não receber + confirmação
 * - resposta conta para a campanha (taxa de resposta)
 * - respostas automáticas (palavra-chave, fora do horário, boas-vindas)
 * - moderação de grupos
 */

const OPT_OUT_CONFIRM =
  'Pronto! Você não vai mais receber nossas mensagens promocionais. Se mudar de ideia, é só nos chamar. 😊'
const MAX_AUTO_PER_HOUR = 30
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------- Regras ----------

interface RuleRow {
  id: number
  name: string
  kind: AutoRule['kind']
  enabled: number
  keywords: string | null
  match_mode: AutoRule['matchMode']
  reply: string
  cooldown_min: number
}

function toRule(r: RuleRow): AutoRule {
  const kw = r.keywords ? JSON.parse(r.keywords) : null
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    enabled: !!r.enabled,
    keywords: Array.isArray(kw) ? kw : (kw?.keywords ?? []),
    matchMode: r.match_mode,
    reply: r.reply,
    cooldownMin: r.cooldown_min,
    schedule: r.kind === 'away' && kw && !Array.isArray(kw) ? kw.schedule : undefined
  }
}

export function listRules(accountId: string): AutoRule[] {
  return (
    getDb()
      .prepare('SELECT * FROM auto_rules WHERE account_id = ? ORDER BY kind, id')
      .all(accountId) as unknown as RuleRow[]
  ).map(toRule)
}

export function saveRule(accountId: string, r: Omit<AutoRule, 'id'> & { id?: number }): AutoRule {
  if (!r.reply.trim()) throw new Error('Escreva a resposta')
  if (r.kind === 'keyword' && !r.keywords.filter((k) => k.trim()).length)
    throw new Error('Informe pelo menos uma palavra-chave')
  const kw =
    r.kind === 'away'
      ? JSON.stringify({ schedule: r.schedule ?? { hourStart: 8, hourEnd: 18, days: [1, 2, 3, 4, 5, 6] } })
      : JSON.stringify(r.keywords.map((k) => k.trim()).filter(Boolean))
  const db = getDb()
  if (r.id) {
    db.prepare(
      'UPDATE auto_rules SET name = ?, kind = ?, enabled = ?, keywords = ?, match_mode = ?, reply = ?, cooldown_min = ? WHERE id = ? AND account_id = ?'
    ).run(r.name.trim(), r.kind, r.enabled ? 1 : 0, kw, r.matchMode, r.reply.trim(), r.cooldownMin, r.id, accountId)
    return toRule(db.prepare('SELECT * FROM auto_rules WHERE id = ?').get(r.id) as unknown as RuleRow)
  }
  const id = db
    .prepare(
      'INSERT INTO auto_rules (account_id, name, kind, enabled, keywords, match_mode, reply, cooldown_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      accountId,
      r.name.trim(),
      r.kind,
      r.enabled ? 1 : 0,
      kw,
      r.matchMode,
      r.reply.trim(),
      r.cooldownMin,
      Date.now()
    ).lastInsertRowid
  return toRule(db.prepare('SELECT * FROM auto_rules WHERE id = ?').get(id) as unknown as RuleRow)
}

export function deleteRule(accountId: string, id: number): void {
  getDb().prepare('DELETE FROM auto_rules WHERE id = ? AND account_id = ?').run(id, accountId)
}

/** Decide qual regra responde a esta mensagem (função pura, testável). */
export function pickRule(
  rules: AutoRule[],
  text: string | null,
  ctx: { now: Date; firstContact: boolean; recentlyAnswered: (ruleId: number) => boolean }
): AutoRule | null {
  const t = text ? fold(text) : ''
  const active = rules.filter((r) => r.enabled && !ctx.recentlyAnswered(r.id))
  for (const r of active.filter((x) => x.kind === 'keyword')) {
    const hit = r.keywords.some((k) => {
      const kw = fold(k)
      if (!kw) return false
      if (r.matchMode === 'exact') return t.replace(/[^\p{L}\d\s]/gu, '').trim() === kw
      if (r.matchMode === 'starts') return t.startsWith(kw)
      return new RegExp(`(^|[^\\p{L}\\d])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\d]|$)`, 'u').test(t)
    })
    if (hit) return r
  }
  const away = active.find((x) => x.kind === 'away')
  if (away) {
    const sch = away.schedule ?? { hourStart: 8, hourEnd: 18, days: [1, 2, 3, 4, 5, 6] }
    const open = sendWindow({ ...DEFAULT_ANTIBAN, ...sch }, ctx.now).open
    if (!open) return away
  }
  if (ctx.firstContact) {
    const welcome = active.find((x) => x.kind === 'welcome')
    if (welcome) return welcome
  }
  return null
}

function answeredRecently(accountId: string, ruleId: number, jid: string, minutes: number): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM auto_log WHERE account_id = ? AND rule_id = ? AND jid = ? AND at > ? LIMIT 1')
    .get(accountId, ruleId, jid, Date.now() - minutes * 60_000)
}

function autoCountLastHour(accountId: string): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM auto_log WHERE account_id = ? AND at > ?')
      .get(accountId, Date.now() - 3600_000) as {
      n: number
    }
  ).n
}

function isFirstContact(accountId: string, jid: string): boolean {
  const r = getDb()
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND chat_jid = ?')
    .get(accountId, jid) as { n: number }
  return r.n <= 1
}

async function reply(sock: WASocket, accountId: string, jid: string, text: string): Promise<void> {
  await sock.sendPresenceUpdate('composing', jid).catch(() => undefined)
  await sleep(1500 + Math.min(4000, text.length * 25))
  await sendAndStore(sock, accountId, jid, { text })
}

// ---------- Entrada ----------

async function onIncoming(accountId: string, m: MessageItem): Promise<void> {
  const account = getAccount(accountId)
  const sock = wa.getSocket(accountId)
  if (!account || !sock || m.fromMe) return

  if (isJidGroup(m.chatJid)) {
    await moderateGroupMessage(sock, accountId, m)
    return
  }

  onCampaignReply(accountId, m.chatJid)

  // "SAIR": sempre respeitado quando a loja usa campanhas
  if ((account.modules.campanhas || account.modules.lembretes) && isOptOut(m.text)) {
    const already = isOptedOut(accountId, m.chatJid)
    optOutByJid(accountId, m.chatJid)
    // Só confirma depois de gravado
    if (!already && isOptedOut(accountId, m.chatJid))
      await reply(sock, accountId, m.chatJid, OPT_OUT_CONFIRM).catch(() => undefined)
    return
  }

  if (!account.modules.respostasAuto) return
  if (autoCountLastHour(accountId) >= MAX_AUTO_PER_HOUR) return
  const rules = listRules(accountId)
  const rule = pickRule(rules, m.text, {
    now: new Date(),
    firstContact: isFirstContact(accountId, m.chatJid),
    recentlyAnswered: (id) =>
      answeredRecently(accountId, id, m.chatJid, Math.max(1, rules.find((r) => r.id === id)?.cooldownMin ?? 60))
  })
  if (!rule) return
  const person = findPersonByJid(accountId, m.chatJid)
  const chat = getChats(accountId, [m.chatJid])[0]
  const name = person?.name ?? m.senderName ?? chat?.name ?? ''
  const text = renderTemplate(rule.reply, {
    ...(person?.fields ?? {}),
    nome: name,
    primeiro_nome: firstName(name.startsWith('+') ? '' : name),
    loja: account.name
  })
  getDb()
    .prepare('INSERT INTO auto_log (account_id, rule_id, jid, at) VALUES (?, ?, ?, ?)')
    .run(accountId, rule.id, m.chatJid, Date.now())
  await reply(sock, accountId, m.chatJid, text)
}

export function startAutomation(): void {
  storeEvents.on('incoming', ({ accountId, message }: { accountId: string; message: MessageItem }) => {
    onIncoming(accountId, message).catch((e) => log.warn('Falha na automação', { erro: (e as Error).message }))
  })
  storeEvents.on('status', ({ id, status }: { id: string; status: number }) => onCampaignReceipt(id, status))
  storeEvents.on(
    'group-participants',
    (u: { accountId: string; id: string; participants: Array<{ id: string } | string>; action: string }) => {
      const sock = wa.getSocket(u.accountId)
      if (sock && u.action === 'add')
        welcomeParticipants(sock, u.accountId, u.id, u.participants).catch(() => undefined)
    }
  )
  // limpeza do registro
  setInterval(
    () =>
      getDb()
        .prepare('DELETE FROM auto_log WHERE at < ?')
        .run(Date.now() - 7 * 86_400_000),
    6 * 3600_000
  )
}
