import { randomUUID } from 'node:crypto'
import * as XLSX from 'xlsx'
import type { ImportMapping, ImportPreview, ImportResult, Person, PersonQuery } from '@shared/types'
import { getDb, transaction } from './db'
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
  const phone = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : null
  const r = getDb()
    .prepare(`${SELECT} WHERE p.account_id = ? AND (p.jid = ? OR p.phone = ?) LIMIT 1`)
    .get(accountId, jid, phone ?? '§') as Row | undefined
  return r ? toPerson(r) : null
}

export function listTags(accountId: string): Array<{ tag: string; count: number }> {
  return getDb()
    .prepare(
      `SELECT t.tag, COUNT(*) AS count FROM person_tags t JOIN people p ON p.id = t.person_id
       WHERE p.account_id = ? GROUP BY t.tag ORDER BY t.tag COLLATE NOCASE`
    )
    .all(accountId) as Array<{ tag: string; count: number }>
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
    if (input.tags) setTags(id!, input.tags)
    return getPerson(accountId, id!)!
  })
}

function setTags(personId: number, tags: string[]): void {
  const db = getDb()
  db.prepare('DELETE FROM person_tags WHERE person_id = ?').run(personId)
  const ins = db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?, ?)')
  for (const t of tags.map((x) => x.trim()).filter(Boolean)) ins.run(personId, t.slice(0, 40))
}

export function bulkTag(accountId: string, ids: number[], tag: string, add: boolean): void {
  const db = getDb()
  transaction(db, () => {
    for (const id of ids) {
      const own = db.prepare('SELECT 1 FROM people WHERE id = ? AND account_id = ?').get(id, accountId)
      if (!own) continue
      if (add)
        db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?, ?)').run(id, tag.trim().slice(0, 40))
      else db.prepare('DELETE FROM person_tags WHERE person_id = ? AND tag = ?').run(id, tag)
    }
  })
}

export function deletePeople(accountId: string, ids: number[]): void {
  const db = getDb()
  transaction(db, () => {
    for (const id of ids) db.prepare('DELETE FROM people WHERE id = ? AND account_id = ?').run(id, accountId)
  })
}

export function setOptOut(accountId: string, ids: number[], value: boolean): void {
  const db = getDb()
  transaction(db, () => {
    for (const id of ids)
      db.prepare('UPDATE people SET opt_out = ?, opt_out_at = ? WHERE id = ? AND account_id = ?').run(
        value ? 1 : 0,
        value ? Date.now() : null,
        id,
        accountId
      )
  })
}

/** Marca opt-out pelo número/JID (resposta "SAIR"). Cria o contato se não existir. */
export function optOutByJid(accountId: string, jid: string): void {
  const phone = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : null
  const db = getDb()
  const p = findPersonByJid(accountId, jid)
  if (p) {
    db.prepare('UPDATE people SET opt_out = 1, opt_out_at = ?, jid = COALESCE(jid, ?) WHERE id = ?').run(
      Date.now(),
      jid,
      p.id
    )
  } else if (phone) {
    db.prepare(
      'INSERT INTO people (account_id, phone, jid, opt_out, opt_out_at, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT DO UPDATE SET opt_out = 1'
    ).run(accountId, phone, jid, Date.now(), Date.now(), Date.now())
  }
}

export function isOptedOut(accountId: string, jid: string): boolean {
  return !!findPersonByJid(accountId, jid)?.optOut
}

export function exportCsv(accountId: string): string {
  const { items } = listPeople({ accountId, limit: 1_000_000, offset: 0 })
  const fieldNames = [...new Set(items.flatMap((p) => Object.keys(p.fields)))]
  const esc = (v: unknown): string => {
    let s = String(v ?? '')
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // evita fórmula maliciosa ao abrir no Excel
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
  const wb = XLSX.read(data, { type: 'array', cellDates: true, dense: true })
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
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length))
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
  const cleanTags = tags.map((t) => t.trim().slice(0, 40)).filter(Boolean)

  transaction(db, () => {
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
