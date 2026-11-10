import { proto, type WAMessage, normalizeMessageContent } from 'baileys'
import { getDb, getSetting, setSetting, transaction } from './db'
import { log } from './log'

/**
 * Captura de anúncios que clicam para o WhatsApp (módulo metaConversoes).
 * Lê do `contextInfo` das mensagens recebidas de onde o cliente veio e guarda por conversa.
 * O `ctwaClid` pode não chegar pelo WhatsApp Web: tudo aqui funciona sem ele.
 */

export interface AdAttribution {
  conversionSource: string | null
  entryPoint: string | null
  adId: string | null
  adUrl: string | null
  ctwaClid: string | null
}

export interface ChatAttribution extends AdAttribution {
  firstTs: number
}

const MAX_FIELD = 600
// Origens que a Meta/WhatsApp marcam como anúncio: "FB_Ads", "IG_Ads", "ctwa_ad", "ctwa_post"…
const AD_SIGNAL = /(^|_)ads?($|_)|ctwa/i

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, MAX_FIELD) : null
}

function contextOf(m: proto.IMessage): proto.IContextInfo | null {
  for (const v of Object.values(m)) {
    if (v && typeof v === 'object' && 'contextInfo' in v) {
      const c = (v as { contextInfo?: proto.IContextInfo | null }).contextInfo
      if (c) return c
    }
  }
  return null
}

/** Devolve a origem do anúncio, ou null quando a mensagem não veio de um. */
export function extractAdAttribution(msg: WAMessage): AdAttribution | null {
  const content = normalizeMessageContent(msg.message)
  if (!content) return null
  const ctx = contextOf(content)
  if (!ctx) return null
  const ad = ctx.externalAdReply
  const conversionSource = clean(ctx.conversionSource)
  const entryPoint = clean(ctx.entryPointConversionSource)
  const ctwaClid = clean(ad?.ctwaClid)
  const isAd = !!ctwaClid || AD_SIGNAL.test(conversionSource ?? '') || AD_SIGNAL.test(entryPoint ?? '')
  if (!isAd) return null
  return { conversionSource, entryPoint, adId: clean(ad?.sourceId), adUrl: clean(ad?.sourceUrl), ctwaClid }
}

/**
 * Guarda a origem da conversa. A primeira origem fica; campos que faltavam (ex.: ctwaClid
 * que chegou numa mensagem seguinte) são completados. Devolve true se algo foi gravado.
 */
export function recordAttribution(
  accountId: string,
  chatJid: string,
  a: AdAttribution,
  ts: number,
  quiet = false
): boolean {
  const db = getDb()
  const cur = db
    .prepare('SELECT ctwa_clid FROM chat_attribution WHERE account_id = ? AND chat_jid = ?')
    .get(accountId, chatJid) as { ctwa_clid: string | null } | undefined
  db.prepare(
    `INSERT INTO chat_attribution (account_id, chat_jid, conversion_source, entry_point, ad_id, ad_url, ctwa_clid, first_ts, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, chat_jid) DO UPDATE SET
       conversion_source = COALESCE(chat_attribution.conversion_source, excluded.conversion_source),
       entry_point = COALESCE(chat_attribution.entry_point, excluded.entry_point),
       ad_id = COALESCE(chat_attribution.ad_id, excluded.ad_id),
       ad_url = COALESCE(chat_attribution.ad_url, excluded.ad_url),
       ctwa_clid = COALESCE(chat_attribution.ctwa_clid, excluded.ctwa_clid),
       first_ts = MIN(chat_attribution.first_ts, excluded.first_ts),
       updated_at = excluded.updated_at`
  ).run(accountId, chatJid, a.conversionSource, a.entryPoint, a.adId, a.adUrl, a.ctwaClid, ts, Date.now())
  const isNew = !cur
  const gotClid = !!a.ctwaClid && !cur?.ctwa_clid
  // Registro só local e sem dado do cliente: serve para conferir se o ctwaClid chega pelo WhatsApp Web.
  if (!quiet && (isNew || gotClid))
    log.info('Anúncio: conversa que veio de anúncio', {
      novaConversa: isNew,
      ctwaClid: gotClid ? 'chegou' : cur?.ctwa_clid ? 'já tinha' : 'não veio',
      origem: a.conversionSource ?? a.entryPoint ?? 'desconhecida'
    })
  return isNew || gotClid
}

export function getAttribution(accountId: string, chatJid: string): ChatAttribution | null {
  const r = getDb()
    .prepare('SELECT * FROM chat_attribution WHERE account_id = ? AND chat_jid = ?')
    .get(accountId, chatJid) as
    | {
        conversion_source: string | null
        entry_point: string | null
        ad_id: string | null
        ad_url: string | null
        ctwa_clid: string | null
        first_ts: number
      }
    | undefined
  return r
    ? {
        conversionSource: r.conversion_source,
        entryPoint: r.entry_point,
        adId: r.ad_id,
        adUrl: r.ad_url,
        ctwaClid: r.ctwa_clid,
        firstTs: r.first_ts
      }
    : null
}

export function hasAdOrigin(accountId: string, chatJid: string): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM chat_attribution WHERE account_id = ? AND chat_jid = ?')
    .get(accountId, chatJid)
}

/** Resumo local, sem dados do cliente: quantas conversas vieram de anúncio e em quantas o ctwaClid chegou. */
export function adStats(): { anuncios: number; comCtwaClid: number } {
  const r = getDb()
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(ctwa_clid IS NOT NULL), 0) AS c FROM chat_attribution')
    .get() as { n: number; c: number }
  return { anuncios: r.n, comCtwaClid: r.c }
}

const CURSOR = 'ads.reprocess.cursor'

/**
 * Reprocessa o histórico (messages.raw) em lotes, no mesmo padrão de reparseUnsupported.
 * Guarda até onde foi, então cada lote só olha mensagens ainda não vistas.
 */
export function reprocessAdAttribution(limit = 2000): { scanned: number; found: number; done: boolean } {
  const db = getDb()
  const cursor = getSetting<number>(CURSOR, 0)
  const rows = db
    .prepare(
      `SELECT rowid AS rid, account_id, chat_jid, ts, raw FROM messages
       WHERE rowid > ? AND from_me = 0 AND raw IS NOT NULL AND chat_jid NOT LIKE '%@g.us'
       ORDER BY rowid LIMIT ?`
    )
    .all(cursor, limit) as Array<{ rid: number; account_id: string; chat_jid: string; ts: number; raw: Uint8Array }>
  let found = 0
  transaction(db, () => {
    for (const r of rows) {
      try {
        const a = extractAdAttribution(proto.WebMessageInfo.decode(r.raw) as WAMessage)
        if (a && recordAttribution(r.account_id, r.chat_jid, a, r.ts, true)) found++
      } catch {
        // mensagem antiga ilegível: segue para a próxima
      }
    }
  })
  if (rows.length) setSetting(CURSOR, rows[rows.length - 1].rid)
  const done = rows.length < limit
  if (found || (done && rows.length))
    log.info('Anúncios no histórico reprocessados', { lidas: rows.length, conversas: found })
  return { scanned: rows.length, found, done }
}
