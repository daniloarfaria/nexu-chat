import { randomUUID } from 'node:crypto'
import * as XLSX from 'xlsx'
import type { ImportMapping, ImportPreview, ImportResult, Person, PersonQuery } from '@shared/types'
import { getDb, transaction } from './db'
import { ensureTag, listTagDefs } from './tags'
import { fold, normalizeDate, normalizePhone } from '@shared/rules'

// Planilhas lidas ficam em memória por alguns minutos entre a prévia e a importação
const pendingImports = new Map<string, { rows: unknown[][]; at: number }>()
const MAX_ROWS = 50_000

interface Row {
  id: number
  phone: string
  jid: string | null
  name: string | null
  birthday: string | null
  fields: string | null
  opt_out: number
  has_wa: number | null
  created_at: number
  tags: string | null
}

function toPerson(r: Row): Person {
  return {
    id: r.id,
    phone: r.phone,
    jid: r.jid,
    name: r.name,
    birthday: r.birthday,
    fields: r.fields ? (JSON.parse(r.fields) as Record<string, string>) : {},
    tags: r.tags ? r.tags.split('\u001f').sort() : [],
    optOut: !!r.opt_out,
    hasWa: r.has_wa == null ? null : !!r.has_wa,
    createdAt: r.created_at
  }
}

const SELECT = `SELECT p.*, (SELECT group_concat(tag, char(31)) FROM person_tags t WHERE t.person_id = p.id) AS tags FROM people p`

export function listPeople(q: PersonQuery): { items: Person[]; total: number } {
  const where = ['p.account_id = ?']
  const args: Array<string | number> = [q.accountId]
  if (q.search?.trim()) {
    const s = `%${q.search.trim().replace(/[%_]/g, '')}%`
    const digits = q.search.replace(/\D/g, '')
    where.push('(unaccent(p.name) LIKE unaccent(?)' + (digits.length >= 3 ? ' OR p.phone LIKE ?' : '') + ')')
    args.push(s)
    if (digits.length >= 3) args.push(`%${digits}%`)
  }
  if (q.tag) {
    where.push('EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag = ?)')
    args.push(q.tag)
  }
  if (q.optOut === 'only') where.push('p.opt_out = 1')
  if (q.optOut === 'exclude') where.push('p.opt_out = 0')
  const db = getDb()
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM people p WHERE ${where.join(' AND ')}`).get(...args) as { n: number }
  ).n
  const items = (
    db
      .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`)
      .all(...args, q.limit, q.offset) as unknown as Row[]
  ).map(toPerson)
  return { items, total }
}

export function getPerson(accountId: string, id: number): Person | null {
  const r = getDb().prepare(`${SELECT} WHERE p.account_id = ? AND p.id = ?`).get(accountId, id) as Row | undefined
  return r ? toPerson(r) : null
}

export function findPersonByJid(accountId: string, jid: string): Person | null {
  const phone = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : /^\d{8,15}$/.test(jid) ? jid : null
  const r = getDb()
    .prepare(`${SELECT} WHERE p.account_id = ? AND (p.jid = ? OR p.phone = ?) LIMIT 1`)
    .get(accountId, jid, phone ?? '§') as Row | undefined
  return r ? toPerson(r) : null
}

export function listTags(accountId: string): Array<{ tag: string; count: number; color: string }> {
  return listTagDefs(accountId).map((t) => ({ tag: t.name, count: t.count, color: t.color }))
}

export function savePerson(
  accountId: string,
  input: {
    id?: number
    name: string
    phone: string
    birthday?: string | null
    fields?: Record<string, string>
    tags?: string[]
  }
): Person {
  const phone = normalizePhone(input.phone)
  if (!phone) throw new Error('Telefone inválido. Use DDD + número.')
  const db = getDb()
  const now = Date.now()
  return transaction(db, () => {
    let id = input.id
    if (id) {
      const clash = db
        .prepare('SELECT id FROM people WHERE account_id = ? AND phone = ? AND id != ?')
        .get(accountId, phone, id)
      if (clash) throw new Error('Já existe um contato com este telefone')
      // Telefone mudou: o WhatsApp antigo (jid) não vale mais
      db.prepare(
        'UPDATE people SET jid = CASE WHEN phone = ? THEN jid ELSE NULL END, has_wa = CASE WHEN phone = ? THEN has_wa ELSE NULL END WHERE id = ? AND account_id = ?'
      ).run(phone, phone, id, accountId)
      db.prepare("UPDATE campaign_targets SET jid = NULL, phone = ? WHERE person_id = ? AND status = 'pending'").run(
        phone,
        id
      )
      db.prepare(
        'UPDATE people SET name = ?, phone = ?, birthday = ?, fields = ?, updated_at = ? WHERE id = ? AND account_id = ?'
      ).run(
        input.name.trim() || null,
        phone,
        normalizeDate(input.birthday) ?? null,
        input.fields && Object.keys(input.fields).length ? JSON.stringify(input.fields) : null,
        now,
        id,
        accountId
      )
    } else {
      const exists = db.prepare('SELECT id FROM people WHERE account_id = ? AND phone = ?').get(accountId, phone) as
        { id: number } | undefined
      if (exists) throw new Error('Já existe um contato com este telefone')
      id = Number(
        db
          .prepare(
            'INSERT INTO people (account_id, phone, name, birthday, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            accountId,
            phone,
            input.name.trim() || null,
            normalizeDate(input.birthday) ?? null,
            input.fields ? JSON.stringify(input.fields) : null,
            now,
            now
          ).lastInsertRowid
      )
    }
    if (input.tags) setTags(accountId, id!, input.tags)
    return getPerson(accountId, id!)!
  })
}

function setTags(accountId: string, personId: number, tags: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM person_tags WHERE person_id = ?').run(personId)
  const ins = db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?, ?)')
  for (const t of tags.map((x) => x.trim()).filter(Boolean)) ins.run(personId, ensureTag(accountId, t))
}

export function bulkTag(accountId: string, ids: number[], tag: string, add: boolean): void {
  const db = getDb()
  transaction(db, () => {
    const name = add ? ensureTag(accountId, tag) : tag.trim()
    for (const id of ids) {
      const own = db.prepare('SELECT 1 FROM people WHERE id = ? AND account_id = ?').get(id, accountId)
      if (!own) continue
      if (add) db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?, ?)').run(id, name)
      else db.prepare('DELETE FROM person_tags WHERE person_id = ? AND tag = ? COLLATE NOCASE').run(id, name)
    }
  })
}

/** Chaves que identificam a pessoa: número e JIDs conhecidos (inclusive LID mapeado). */
function identityKeys(accountId: string, jidOrPhone: string): string[] {
  const keys = new Set<string>([jidOrPhone])
  const phone = jidOrPhone.endsWith('@s.whatsapp.net')
    ? jidOrPhone.split('@')[0]
    : /^\d+$/.test(jidOrPhone)
      ? jidOrPhone
      : null
  if (phone) {
    keys.add(phone)
    keys.add(`${phone}@s.whatsapp.net`)
    const lids = getDb()
      .prepare('SELECT lid FROM lid_map WHERE account_id = ? AND pn = ?')
      .all(accountId, `${phone}@s.whatsapp.net`) as Array<{ lid: string }>
    for (const l of lids) keys.add(l.lid)
  }
  if (jidOrPhone.endsWith('@lid')) {
    const pn = getDb().prepare('SELECT pn FROM lid_map WHERE account_id = ? AND lid = ?').get(accountId, jidOrPhone) as
      { pn: string } | undefined
    if (pn) {
      keys.add(pn.pn)
      keys.add(pn.pn.split('@')[0])
    }
  }
  return [...keys]
}

function suppress(accountId: string, keys: string[]): void {
  const ins = getDb().prepare('INSERT OR IGNORE INTO suppression (account_id, key, at) VALUES (?, ?, ?)')
  for (const k of keys) ins.run(accountId, k, Date.now())
}

/**
 * Exclusão a pedido (LGPD): apaga contato, conversas, mensagens, mídias, vendas e histórico de envios.
 * Se a pessoa tinha pedido para não receber, só o número fica na lista de supressão.
 */
export function deletePeople(accountId: string, ids: number[]): { mediaFiles: string[] } {
  const db = getDb()
  const mediaFiles: string[] = []
  transaction(db, () => {
    for (const id of ids) {
      const p = db
        .prepare('SELECT phone, jid, opt_out FROM people WHERE id = ? AND account_id = ?')
        .get(id, accountId) as { phone: string; jid: string | null; opt_out: number } | undefined
      if (!p) continue
      const keys = identityKeys(accountId, p.phone)
      if (p.jid) for (const k of identityKeys(accountId, p.jid)) keys.push(k)
      // Se qualquer identidade (número, JID, LID) pediu SAIR, a supressão vale para todas antes de apagar os mapas
      const suppressed = db
        .prepare(`SELECT 1 FROM suppression WHERE account_id = ? AND key IN (SELECT value FROM json_each(?)) LIMIT 1`)
        .get(accountId, JSON.stringify(keys))
      if (suppressed || p.opt_out) suppress(accountId, [...keys, p.phone])
      const jids = [...new Set(keys.filter((k) => k.includes('@')))]
      for (const jid of jids) {
        const media = db
          .prepare('SELECT media FROM messages WHERE account_id = ? AND chat_jid = ? AND media IS NOT NULL')
          .all(accountId, jid) as Array<{ media: string }>
        for (const m of media) {
          const f = (JSON.parse(m.media) as { file?: string }).file
          if (f) mediaFiles.push(f)
        }
        for (const t of ['messages', 'messages_fts'])
          db.prepare(`DELETE FROM ${t} WHERE account_id = ? AND chat_jid = ?`).run(accountId, jid)
        db.prepare('DELETE FROM chats WHERE account_id = ? AND jid = ?').run(accountId, jid)
        db.prepare('DELETE FROM contacts WHERE account_id = ? AND jid = ?').run(accountId, jid)
        db.prepare('DELETE FROM deals WHERE account_id = ? AND chat_jid = ?').run(accountId, jid)
        db.prepare('DELETE FROM auto_log WHERE account_id = ? AND jid = ?').run(accountId, jid)
        db.prepare('DELETE FROM group_warnings WHERE account_id = ? AND participant = ?').run(accountId, jid)
        db.prepare('DELETE FROM lid_map WHERE account_id = ? AND (lid = ? OR pn = ?)').run(accountId, jid, jid)
      }
      db.prepare("UPDATE campaign_targets SET status = 'skipped' WHERE person_id = ? AND status = 'pending'").run(id)
      db.prepare(
        `UPDATE campaign_targets SET name = NULL, phone = NULL, jid = NULL, vars = NULL, error = NULL
         WHERE person_id = ? AND campaign_id IN (SELECT id FROM campaigns WHERE account_id = ?)`
      ).run(id, accountId)
      db.prepare('DELETE FROM people WHERE id = ? AND account_id = ?').run(id, accountId)
    }
  })
  return { mediaFiles }
}

export function setOptOut(accountId: string, ids: number[], value: boolean): void {
  const db = getDb()
  transaction(db, () => {
    for (const id of ids) {
      const p = db.prepare('SELECT phone, jid FROM people WHERE id = ? AND account_id = ?').get(id, accountId) as
        { phone: string; jid: string | null } | undefined
      if (!p) continue
      db.prepare('UPDATE people SET opt_out = ?, opt_out_at = ? WHERE id = ?').run(
        value ? 1 : 0,
        value ? Date.now() : null,
        id
      )
      const keys = [...identityKeys(accountId, p.phone), ...(p.jid ? identityKeys(accountId, p.jid) : [])]
      if (value) suppress(accountId, keys)
      else
        for (const k of keys) db.prepare('DELETE FROM suppression WHERE account_id = ? AND key = ?').run(accountId, k)
    }
  })
}

/** Marca opt-out pelo número/JID (resposta "SAIR"), inclusive quando só se conhece o LID. */
export function optOutByJid(accountId: string, jid: string): void {
  const db = getDb()
  transaction(db, () => {
    suppress(accountId, identityKeys(accountId, jid))
    const p = findPersonByJid(accountId, jid)
    if (p)
      db.prepare('UPDATE people SET opt_out = 1, opt_out_at = ?, jid = COALESCE(jid, ?) WHERE id = ?').run(
        Date.now(),
        jid,
        p.id
      )
  })
}

export function isOptedOut(accountId: string, jidOrPhone: string): boolean {
  const keys = identityKeys(accountId, jidOrPhone)
  const hit = getDb()
    .prepare(`SELECT 1 FROM suppression WHERE account_id = ? AND key IN (${keys.map(() => '?').join(',')}) LIMIT 1`)
    .get(accountId, ...keys)
  return !!hit || !!findPersonByJid(accountId, jidOrPhone)?.optOut
}

export function exportCsv(accountId: string): string {
  const { items } = listPeople({ accountId, limit: 1_000_000, offset: 0 })
  const fieldNames = [...new Set(items.flatMap((p) => Object.keys(p.fields)))]
  const esc = (v: unknown): string => {
    let s = String(v ?? '')
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // evita fórmula maliciosa ao abrir no Excel
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Nome', 'Telefone', 'Aniversário', 'Etiquetas', 'Não receber', ...fieldNames]
  const lines = items.map((p) =>
    [
      p.name,
      p.phone,
      p.birthday?.replace(/^--/, ''),
      p.tags.join(', '),
      p.optOut ? 'sim' : '',
      ...fieldNames.map((f) => p.fields[f])
    ]
      .map(esc)
      .join(';')
  )
  return '﻿' + [head.map(esc).join(';'), ...lines].join('\r\n')
}

// ---------- Importação ----------

function guess(headers: string[], words: string[]): number | null {
  const i = headers.findIndex((h) => words.some((w) => fold(h).includes(w)))
  return i >= 0 ? i : null
}

export function previewImport(data: Uint8Array, sheetName?: string): ImportPreview {
  if (data.length > 30 * 1024 * 1024) throw new Error('Planilha maior que 30 MB')
  assertZipNotBomb(data)
  // sheetRows limita o que é lido (evita travar com planilha gigante ou maliciosa)
  const wb = XLSX.read(data, { type: 'array', cellDates: true, dense: true, sheetRows: MAX_ROWS + 2 })
  const sheet = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0]
  if (!sheet) throw new Error('Planilha vazia')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false
  })
  if (!rows.length) throw new Error('A aba escolhida está vazia')
  if (rows.length > MAX_ROWS + 1) throw new Error(`Máximo de ${MAX_ROWS.toLocaleString('pt-BR')} linhas por importação`)
  const width = Math.min(200, Math.max(...rows.slice(0, 50).map((r) => r.length)))
  const headers = Array.from({ length: width }, (_, i) => String(rows[0][i] ?? '').trim() || `Coluna ${i + 1}`)
  const body = rows.slice(1)
  const token = randomUUID()
  pendingImports.set(token, { rows: body, at: Date.now() })
  for (const [k, v] of pendingImports) if (Date.now() - v.at > 30 * 60_000) pendingImports.delete(k)

  const phoneCol =
    guess(headers, ['telefone', 'celular', 'whats', 'fone', 'phone', 'contato', 'numero']) ??
    headers.findIndex((_, i) => body.slice(0, 20).filter((r) => normalizePhone(r[i])).length >= 5)
  const suggested: ImportMapping = {
    name: guess(headers, ['nome', 'cliente', 'name']),
    phone: phoneCol != null && phoneCol >= 0 ? phoneCol : null,
    birthday: guess(headers, ['nasc', 'aniver', 'birth']),
    extra: []
  }
  return {
    token,
    sheets: wb.SheetNames,
    sheet,
    headers,
    rows: body.slice(0, 8).map((r) => headers.map((_, i) => cell(r[i]))),
    total: body.length,
    suggested
  }
}

function cell(v: unknown): string {
  if (v instanceof Date) return v.toLocaleDateString('pt-BR')
  return String(v ?? '').trim()
}

export function runImport(accountId: string, token: string, mapping: ImportMapping, tags: string[]): ImportResult {
  const pending = pendingImports.get(token)
  if (!pending) throw new Error('A prévia expirou. Escolha a planilha de novo.')
  if (mapping.phone == null) throw new Error('Escolha a coluna do telefone')
  const db = getDb()
  const now = Date.now()
  const result: ImportResult = { imported: 0, updated: 0, invalid: 0, duplicates: 0, invalidSamples: [] }
  const seen = new Set<string>()
  const find = db.prepare('SELECT id, fields FROM people WHERE account_id = ? AND phone = ?')
  const ins = db.prepare(
    'INSERT INTO people (account_id, phone, name, birthday, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const upd = db.prepare(
    'UPDATE people SET name = COALESCE(?, name), birthday = COALESCE(?, birthday), fields = ?, updated_at = ? WHERE id = ?'
  )
  const tag = db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?, ?)')
  transaction(db, () => {
    const cleanTags = [
      ...new Set(
        tags
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => ensureTag(accountId, t))
      )
    ]
    for (const r of pending.rows) {
      const raw = r[mapping.phone!]
      const phone = normalizePhone(raw)
      if (!phone) {
        if (cell(raw)) {
          result.invalid++
          if (result.invalidSamples.length < 5) result.invalidSamples.push(cell(raw))
        }
        continue
      }
      if (seen.has(phone)) {
        result.duplicates++
        continue
      }
      seen.add(phone)
      const name = mapping.name != null ? cell(r[mapping.name]).replace(/\s+/g, ' ').slice(0, 120) || null : null
      const birthday = mapping.birthday != null ? normalizeDate(r[mapping.birthday]) : null
      const extra: Record<string, string> = {}
      for (const e of mapping.extra) {
        const v = r[e.column]
        const val = v instanceof Date ? v.toISOString().slice(0, 10) : cell(v)
        if (val && e.field.trim()) extra[e.field.trim().slice(0, 40)] = val.slice(0, 500)
      }
      const cur = find.get(accountId, phone) as { id: number; fields: string | null } | undefined
      let id: number
      if (cur) {
        const merged = { ...(cur.fields ? JSON.parse(cur.fields) : {}), ...extra }
        upd.run(name, birthday, Object.keys(merged).length ? JSON.stringify(merged) : null, now, cur.id)
        id = cur.id
        result.updated++
      } else {
        id = Number(
          ins.run(accountId, phone, name, birthday, Object.keys(extra).length ? JSON.stringify(extra) : null, now, now)
            .lastInsertRowid
        )
        result.imported++
      }
      for (const t of cleanTags) tag.run(id, t)
    }
  })
  pendingImports.delete(token)
  return result
}

export function customFieldNames(accountId: string): string[] {
  const rows = getDb()
    .prepare('SELECT fields FROM people WHERE account_id = ? AND fields IS NOT NULL LIMIT 2000')
    .all(accountId) as Array<{
    fields: string
  }>
  const set = new Set<string>()
  for (const r of rows) for (const k of Object.keys(JSON.parse(r.fields))) set.add(k)
  return [...set].sort()
}

export function markHasWa(personId: number, jid: string | null, has: boolean): void {
  getDb()
    .prepare('UPDATE people SET has_wa = ?, jid = COALESCE(?, jid) WHERE id = ?')
    .run(has ? 1 : 0, jid, personId)
}

/**
 * .xlsx/.ods são arquivos ZIP. Antes de abrir, soma o tamanho descompactado declarado
 * no índice do ZIP: um arquivo pequeno que "explode" para gigabytes travaria o app.
 */
export function assertZipNotBomb(data: Uint8Array, maxTotal = 250 * 1024 * 1024): void {
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) return // não é ZIP (CSV, .xls antigo)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // Fim do diretório central: assinatura 0x06054b50 nos últimos 64 KB
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Planilha corrompida')
  const entries = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  if (entries > 10_000 || off >= data.length) throw new Error('Planilha corrompida ou suspeita')
  let total = 0
  for (let n = 0; n < entries; n++) {
    if (off + 46 > data.length || dv.getUint32(off, true) !== 0x02014b50) throw new Error('Planilha corrompida')
    const comp = dv.getUint32(off + 20, true)
    const size = dv.getUint32(off + 24, true)
    if (size === 0xffffffff || comp === 0xffffffff) throw new Error('Planilha grande demais')
    if (comp > 0 && size / comp > 1000) throw new Error('Planilha suspeita (compressão anormal)')
    total += size
    if (total > maxTotal) throw new Error('Planilha grande demais depois de aberta')
    off += 46 + dv.getUint16(off + 28, true) + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true)
  }
}
