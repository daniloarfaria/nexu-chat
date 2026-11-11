import { getDb } from './db'
import { chatJidsOf, personIdOfChat } from './notes'

/**
 * Parte da recuperação de vendas que só mexe no banco (sem IA, sem WhatsApp):
 * parar o acompanhamento e ligar uma venda marcada à recuperação.
 * Fica separada para a página de Vendas e o Painel poderem usá-la sem carregar o robô.
 */

/** Venda acima disso (R$ 100.000) é tratada como erro de digitação e não vira "Recuperação". */
export const MAX_RECOVERY_CENTS = 10_000_000

/** Uma venda marcada até este prazo depois da última mensagem de recuperação conta como "Recuperação". */
export const RECOVERY_DAYS = 14

/** A conversa e as outras formas do mesmo contato (número e identificador novo do WhatsApp). */
export function relatedJids(accountId: string, jid: string): string[] {
  const out = new Set<string>([jid])
  const pid = personIdOfChat(accountId, jid)
  if (pid != null) for (const j of chatJidsOf(accountId, pid)) out.add(j)
  return [...out]
}

const marks = (n: number): string => Array(n).fill('?').join(',')

export type StopReason =
  | 'respondeu'
  | 'venda'
  | 'sair'
  | 'atendente'
  | 'manual'
  | 'nao_se_aplica'
  | 'esperando_atendente'
  | 'ia_fora'
  | 'desligado'
  | 'sem_interesse'
  | 'desistiu'
  | 'expirado'
  | 'venda_removida'
  | 'fusao'

/**
 * Para o acompanhamento ativo da conversa e descarta as mensagens que ainda não saíram.
 * Devolve quantos acompanhamentos pararam.
 */
export function stopFollowups(
  accountId: string,
  jid: string,
  reason: StopReason,
  o: { afterTs?: number; now?: number } = {}
): number {
  const db = getDb()
  const now = o.now ?? Date.now()
  const jids = relatedJids(accountId, jid)
  const rows = db
    .prepare(
      `SELECT id, last_client_ts FROM followups WHERE account_id = ? AND status = 'ativo' AND chat_jid IN (${marks(jids.length)})`
    )
    .all(accountId, ...jids) as Array<{ id: number; last_client_ts: number }>
  let n = 0
  for (const f of rows) {
    // Mensagem antiga (sincronização) não conta como resposta
    if (o.afterTs != null && o.afterTs <= f.last_client_ts) continue
    db.prepare(
      `UPDATE followups SET status = 'parado', stop_reason = ?, replied_at = CASE WHEN ? = 'respondeu' THEN ? ELSE replied_at END,
         next_due_at = NULL, updated_at = ? WHERE id = ?`
    ).run(reason, reason, now, now, f.id)
    db.prepare(
      "UPDATE followup_attempts SET status = 'descartada', error = ? WHERE followup_id = ? AND status IN ('pendente', 'aprovada')"
    ).run(`parou: ${reason}`, f.id)
    n++
  }
  return n
}

/** Para todos os acompanhamentos ativos do número (regra ou módulo desligado). Religar não os reanima. */
export function stopAllFollowups(accountId: string, reason: StopReason, now = Date.now()): number {
  const db = getDb()
  const ids = (
    db.prepare("SELECT id FROM followups WHERE account_id = ? AND status = 'ativo'").all(accountId) as Array<{
      id: number
    }>
  ).map((r) => r.id)
  for (const id of ids) {
    db.prepare(
      "UPDATE followups SET status = 'parado', stop_reason = ?, next_due_at = NULL, updated_at = ? WHERE id = ?"
    ).run(reason, now, id)
    db.prepare(
      "UPDATE followup_attempts SET status = 'descartada', error = ? WHERE followup_id = ? AND status IN ('pendente', 'aprovada')"
    ).run(`parou: ${reason}`, id)
  }
  return ids.length
}

/**
 * A conversa guardada pelo identificador novo (LID) foi juntada à do número: o acompanhamento vai junto.
 * Se os dois lados têm acompanhamento ativo, o do LID para antes (o índice de "um ativo por conversa" derrubaria a fusão).
 */
export function moveFollowups(accountId: string, from: string, to: string, now = Date.now()): void {
  const db = getDb()
  const active = (jid: string): number =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM followups WHERE account_id = ? AND chat_jid = ? AND status = 'ativo'")
        .get(accountId, jid) as {
        n: number
      }
    ).n
  if (active(from) && active(to)) {
    db.prepare(
      "UPDATE followup_attempts SET status = 'descartada', error = 'parou: fusao' WHERE account_id = ? AND chat_jid = ? AND status IN ('pendente', 'aprovada')"
    ).run(accountId, from)
    db.prepare(
      "UPDATE followups SET status = 'parado', stop_reason = 'fusao', next_due_at = NULL, updated_at = ? WHERE account_id = ? AND chat_jid = ? AND status = 'ativo'"
    ).run(now, accountId, from)
  }
  db.prepare('UPDATE followups SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(to, accountId, from)
  db.prepare('UPDATE followup_attempts SET chat_jid = ? WHERE account_id = ? AND chat_jid = ?').run(to, accountId, from)
}

/** A última recuperação enviada a esta conversa, se foi há pouco e ainda não virou venda. */
export function recoveryTouch(
  accountId: string,
  jid: string,
  now = Date.now()
): { followupId: number; name: string } | null {
  const jids = relatedJids(accountId, jid)
  const r = getDb()
    .prepare(
      `SELECT f.id FROM followups f JOIN followup_attempts a ON a.followup_id = f.id
       WHERE f.account_id = ? AND f.chat_jid IN (${marks(jids.length)}) AND f.recovered_deal_id IS NULL
         AND a.status = 'enviada'
         AND a.sent_at > ? - MAX(?, COALESCE(a.valid_days, 0) * 86400000)
         AND EXISTS (SELECT 1 FROM messages m WHERE m.account_id = f.account_id AND m.chat_jid IN (${marks(jids.length)})
                     AND m.from_me = 0 AND m.type <> 'system' AND (m.ts + 1) * 1000 > a.sent_at)
       ORDER BY a.sent_at DESC LIMIT 1`
    )
    .get(accountId, ...jids, now, RECOVERY_DAYS * 86_400_000, ...jids) as { id: number } | undefined
  return r ? { followupId: r.id, name: 'Recuperação' } : null
}

const money = (cents: number): number => Math.max(0, Math.round(cents))

/**
 * Estimativa do desconto dado: o valor da venda é o que o cliente pagou, já com desconto.
 * Só conta se a última mensagem enviada trazia desconto e ele ainda estava na validade.
 */
export function estimateDiscountCents(
  paidCents: number,
  offer: { pct: number; capCents: number | null } | null
): number {
  if (!offer || offer.pct <= 0 || offer.pct >= 100 || paidCents <= 0) return 0
  const original = Math.round((paidCents * 100) / (100 - offer.pct))
  // Nunca mais que o percentual da regra sobre o valor da venda (estimativa conservadora)
  const off = Math.min(original - paidCents, Math.round((paidCents * offer.pct) / 100))
  return money(offer.capCents != null && offer.capCents > 0 ? Math.min(off, offer.capCents) : off)
}

/**
 * Uma venda ou perda foi marcada na conversa: o acompanhamento para.
 * Venda ganha com recuperação enviada recentemente fica registrada como recuperada, com o custo do desconto.
 */
export function linkDeal(
  accountId: string,
  jid: string,
  deal: { id: number; status: 'won' | 'lost'; amountCents: number },
  touch: { followupId: number } | null,
  now = Date.now()
): void {
  const db = getDb()
  if (touch && deal.status === 'won' && deal.amountCents <= MAX_RECOVERY_CENTS) {
    const a = db
      .prepare(
        `SELECT discount_pct, discount_cap_cents, valid_until FROM followup_attempts
         WHERE followup_id = ? AND status = 'enviada' ORDER BY sent_at DESC LIMIT 1`
      )
      .get(touch.followupId) as
      { discount_pct: number | null; discount_cap_cents: number | null; valid_until: number | null } | undefined
    const valid = !!a && a.discount_pct != null && (a.valid_until == null || a.valid_until >= now)
    const discount = valid
      ? estimateDiscountCents(deal.amountCents, { pct: a!.discount_pct!, capCents: a!.discount_cap_cents })
      : 0
    db.prepare(
      `UPDATE followups SET status = 'recuperada', stop_reason = 'venda', recovered_deal_id = ?, recovered_cents = ?,
         discount_cents = ?, next_due_at = NULL, updated_at = ? WHERE id = ?`
    ).run(deal.id, money(deal.amountCents), discount, now, touch.followupId)
    db.prepare(
      "UPDATE followup_attempts SET status = 'descartada', error = 'parou: venda' WHERE followup_id = ? AND status IN ('pendente', 'aprovada')"
    ).run(touch.followupId)
  }
  stopFollowups(accountId, jid, 'venda', { now })
}
