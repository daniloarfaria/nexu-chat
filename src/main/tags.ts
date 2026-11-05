import { TAG_COLORS, type TagColor, type TagDef } from '@shared/types'
import { getDb, transaction } from './db'

/**
 * Etiquetas com cor e descrição. O vínculo com o contato continua em `person_tags` (pelo nome),
 * e `tag_defs` guarda o nome oficial (sem diferenciar maiúsculas), a cor e a descrição.
 */

export const MAX_TAG = 40

export function cleanTag(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG)
}

/** Cor estável para uma etiqueta nova (a mesma etiqueta sempre ganha a mesma cor). */
export function colorFor(name: string): TagColor {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TAG_COLORS[1 + (h % (TAG_COLORS.length - 1))]
}

/** Garante que a etiqueta existe e devolve o nome oficial (respeita a grafia já cadastrada). */
export function ensureTag(accountId: string, name: string): string {
  const clean = cleanTag(name)
  if (!clean) throw new Error('Etiqueta vazia')
  const db = getDb()
  const cur = db.prepare('SELECT name FROM tag_defs WHERE account_id = ? AND name = ?').get(accountId, clean) as
    { name: string } | undefined
  if (cur) return cur.name
  db.prepare('INSERT INTO tag_defs (account_id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
    accountId,
    clean,
    colorFor(clean),
    Date.now()
  )
  return clean
}

export function listTagDefs(accountId: string): TagDef[] {
  const rows = getDb()
    .prepare(
      `SELECT d.name, d.color, d.description,
         (SELECT COUNT(*) FROM person_tags t JOIN people p ON p.id = t.person_id
          WHERE p.account_id = d.account_id AND t.tag = d.name) AS count
       FROM tag_defs d WHERE d.account_id = ?`
    )
    .all(accountId) as Array<{ name: string; color: string; description: string | null; count: number }>
  const sorted = rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
  return sorted.map((r) => ({
    name: r.name,
    color: (TAG_COLORS as readonly string[]).includes(r.color) ? (r.color as TagColor) : 'slate',
    description: r.description,
    count: r.count
  }))
}

const PEOPLE_OF = 'person_id IN (SELECT id FROM people WHERE account_id = ?)'

/** Troca o nome de uma etiqueta em tudo que a usa (contatos, colunas, campanhas não enviadas, lembretes). */
function renameEverywhere(accountId: string, from: string, to: string): void {
  const db = getDb()
  db.prepare(`UPDATE OR IGNORE person_tags SET tag = ? WHERE tag = ? AND ${PEOPLE_OF}`).run(to, from, accountId)
  db.prepare(`DELETE FROM person_tags WHERE tag = ? AND ${PEOPLE_OF}`).run(from, accountId) // já tinha a outra
  db.prepare(
    'UPDATE pipeline_stages SET auto_tag = ? WHERE auto_tag = ? AND pipeline_id IN (SELECT id FROM pipelines WHERE account_id = ?)'
  ).run(to, from, accountId)
  rewriteTagLists(accountId, (list) => [...new Set(list.map((t) => (t === from ? to : t)))])
}

function rewriteTagLists(accountId: string, fn: (list: string[]) => string[]): void {
  const db = getDb()
  const camps = db
    .prepare("SELECT id, audience FROM campaigns WHERE account_id = ? AND status IN ('draft','scheduled','paused')")
    .all(accountId) as Array<{ id: number; audience: string }>
  for (const c of camps) {
    const a = JSON.parse(c.audience) as { tags?: string[]; excludeTags?: string[] }
    const next = { ...a, tags: a.tags && fn(a.tags), excludeTags: a.excludeTags && fn(a.excludeTags) }
    const json = JSON.stringify(next)
    if (json !== c.audience) db.prepare('UPDATE campaigns SET audience = ? WHERE id = ?').run(json, c.id)
  }
  const rems = db
    .prepare('SELECT id, tags FROM reminders WHERE account_id = ? AND tags IS NOT NULL')
    .all(accountId) as Array<{ id: number; tags: string }>
  for (const r of rems) {
    const json = JSON.stringify(fn(JSON.parse(r.tags) as string[]))
    if (json !== r.tags) db.prepare('UPDATE reminders SET tags = ? WHERE id = ?').run(json, r.id)
  }
}

export function saveTag(
  accountId: string,
  input: { name: string; color: TagColor; description?: string | null; previousName?: string | null }
): TagDef {
  const name = cleanTag(input.name)
  if (!name) throw new Error('Dê um nome para a etiqueta')
  const db = getDb()
  transaction(db, () => {
    const prev = input.previousName ? cleanTag(input.previousName) : null
    const old = prev
      ? (db.prepare('SELECT name FROM tag_defs WHERE account_id = ? AND name = ?').get(accountId, prev) as
          { name: string } | undefined)
      : undefined
    if (prev && !old) throw new Error('Etiqueta não encontrada')
    const target = db.prepare('SELECT name FROM tag_defs WHERE account_id = ? AND name = ?').get(accountId, name) as
      { name: string } | undefined
    const sameDef = old && target && old.name.toLowerCase() === target.name.toLowerCase()
    if (old && !sameDef) {
      // Renomear (ou juntar com uma etiqueta que já existe)
      const final = target?.name ?? name
      if (!target)
        db.prepare(
          'INSERT INTO tag_defs (account_id, name, color, description, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(accountId, final, input.color, input.description?.trim() || null, Date.now())
      renameEverywhere(accountId, old.name, final)
      db.prepare('DELETE FROM tag_defs WHERE account_id = ? AND name = ?').run(accountId, old.name)
      db.prepare('UPDATE tag_defs SET color = ?, description = ? WHERE account_id = ? AND name = ?').run(
        input.color,
        input.description?.trim() || null,
        accountId,
        final
      )
    } else if (old && sameDef && old.name !== name) {
      // Só mudou maiúsculas/minúsculas
      db.prepare('UPDATE tag_defs SET name = ?, color = ?, description = ? WHERE account_id = ? AND name = ?').run(
        name,
        input.color,
        input.description?.trim() || null,
        accountId,
        old.name
      )
      renameEverywhere(accountId, old.name, name)
    } else if (target) {
      if (!old && target) throw new Error('Já existe uma etiqueta com esse nome')
      db.prepare('UPDATE tag_defs SET color = ?, description = ? WHERE account_id = ? AND name = ?').run(
        input.color,
        input.description?.trim() || null,
        accountId,
        target.name
      )
    } else {
      db.prepare('INSERT INTO tag_defs (account_id, name, color, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
        accountId,
        name,
        input.color,
        input.description?.trim() || null,
        Date.now()
      )
    }
  })
  return listTagDefs(accountId).find((t) => t.name.toLowerCase() === name.toLowerCase())!
}

/** Apaga a etiqueta de todos os contatos e de onde ela é usada (os contatos continuam). */
export function deleteTag(accountId: string, name: string): void {
  const db = getDb()
  transaction(db, () => {
    const def = db.prepare('SELECT name FROM tag_defs WHERE account_id = ? AND name = ?').get(accountId, name) as
      { name: string } | undefined
    const real = def?.name ?? name
    db.prepare(`DELETE FROM person_tags WHERE tag = ? AND ${PEOPLE_OF}`).run(real, accountId)
    db.prepare(
      'UPDATE pipeline_stages SET auto_tag = NULL WHERE auto_tag = ? AND pipeline_id IN (SELECT id FROM pipelines WHERE account_id = ?)'
    ).run(real, accountId)
    rewriteTagLists(accountId, (list) => list.filter((t) => t !== real))
    db.prepare('DELETE FROM tag_defs WHERE account_id = ? AND name = ?').run(accountId, real)
  })
}

/** Põe ou tira uma etiqueta de um contato (usado pelas colunas do funil). */
export function tagPerson(accountId: string, personId: number, tag: string, add: boolean): void {
  const db = getDb()
  if (add) {
    const name = ensureTag(accountId, tag)
    db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?, ?)').run(personId, name)
  } else {
    db.prepare('DELETE FROM person_tags WHERE person_id = ? AND tag = ?').run(personId, tag)
  }
}
