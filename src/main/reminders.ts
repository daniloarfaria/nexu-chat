import type { Reminder } from '@shared/types'
import { getDb, transaction } from './db'
import { dayKey, normalizeDate } from '@shared/rules'
import { saveCampaign, startCampaign } from './campaigns'
import { listAccounts } from './accounts'
import { engine } from './engine'
import { log } from './log'

interface Row {
  id: number
  name: string
  kind: Reminder['kind']
  field: string | null
  offset_days: number
  send_hour: number
  template: string
  tags: string | null
  enabled: number
  last_run_day: string | null
}

const toReminder = (r: Row): Reminder => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  field: r.field,
  offsetDays: r.offset_days,
  sendHour: r.send_hour,
  template: r.template,
  tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
  enabled: !!r.enabled,
  lastRunDay: r.last_run_day
})

export function listReminders(accountId: string): Reminder[] {
  return (
    getDb().prepare('SELECT * FROM reminders WHERE account_id = ? ORDER BY id').all(accountId) as unknown as Row[]
  ).map(toReminder)
}

export function saveReminder(accountId: string, r: Omit<Reminder, 'id' | 'lastRunDay'> & { id?: number }): Reminder {
  if (!r.template.trim()) throw new Error('Escreva a mensagem do lembrete')
  if (r.kind !== 'birthday' && !r.field) throw new Error('Escolha o campo de data do contato')
  const db = getDb()
  const vals = [
    r.name.trim(),
    r.kind,
    r.kind === 'birthday' ? null : r.field,
    Math.max(-365, Math.min(3650, r.offsetDays)),
    Math.max(0, Math.min(23, r.sendHour)),
    r.template.trim(),
    JSON.stringify(r.tags),
    r.enabled ? 1 : 0
  ]
  let id = r.id
  if (id)
    db.prepare(
      'UPDATE reminders SET name=?, kind=?, field=?, offset_days=?, send_hour=?, template=?, tags=?, enabled=? WHERE id=? AND account_id=?'
    ).run(...vals, id, accountId)
  else
    id = Number(
      db
        .prepare(
          'INSERT INTO reminders (name, kind, field, offset_days, send_hour, template, tags, enabled, account_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
        )
        .run(...vals, accountId, Date.now()).lastInsertRowid
    )
  return toReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as unknown as Row)
}

export function deleteReminder(accountId: string, id: number): void {
  getDb().prepare('DELETE FROM reminders WHERE id = ? AND account_id = ?').run(id, accountId)
}

/** Data (AAAA-MM-DD ou --MM-DD) bate com hoje segundo a regra? Função pura para teste. */
export function matchesToday(kind: Reminder['kind'], date: string | null, offsetDays: number, today: Date): boolean {
  if (!date) return false
  const norm = normalizeDate(date)
  if (!norm) return false
  const target = new Date(today)
  target.setHours(12, 0, 0, 0)
  target.setDate(target.getDate() - offsetDays) // a data original que, somada ao offset, cai hoje
  const mmdd = `${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
  if (kind === 'birthday' || kind === 'yearly') {
    // 29/02 em ano não bissexto: lembra em 28/02
    const md = norm.slice(-5)
    if (md === mmdd) return true
    const leap = new Date(target.getFullYear(), 1, 29).getMonth() === 1
    return md === '02-29' && !leap && mmdd === '02-28'
  }
  if (norm.startsWith('--')) return false
  return norm === dayKey(target)
}

/** Período usado para não repetir: aniversário/anual = ano; dias depois = data exata. */
function periodKey(kind: Reminder['kind'], today: Date): string {
  return kind === 'days_after' ? dayKey(today) : String(today.getFullYear())
}

export function dueToday(accountId: string, r: Reminder, today = new Date()): number[] {
  const db = getDb()
  const where = ['p.account_id = ?', 'p.opt_out = 0']
  const args: Array<string | number> = [accountId]
  if (r.tags.length) {
    where.push(
      `EXISTS (SELECT 1 FROM person_tags t WHERE t.person_id = p.id AND t.tag IN (${r.tags.map(() => '?').join(',')}))`
    )
    args.push(...r.tags)
  }
  const people = db
    .prepare(`SELECT id, birthday, fields FROM people p WHERE ${where.join(' AND ')}`)
    .all(...args) as Array<{ id: number; birthday: string | null; fields: string | null }>
  const period = periodKey(r.kind, today)
  const done = new Set(
    (
      db.prepare('SELECT person_id FROM reminder_log WHERE reminder_id = ? AND period = ?').all(r.id, period) as Array<{
        person_id: number
      }>
    ).map((x) => x.person_id)
  )
  return people
    .filter((p) => !done.has(p.id))
    .filter((p) => {
      const date =
        r.kind === 'birthday'
          ? p.birthday
          : p.fields
            ? ((JSON.parse(p.fields) as Record<string, string>)[r.field ?? ''] ?? null)
            : null
      return matchesToday(r.kind, date, r.kind === 'birthday' ? 0 : r.offsetDays, today)
    })
    .map((p) => p.id)
}

/** Roda os lembretes do dia: vira uma campanha que o motor envia com a proteção anti-bloqueio. */
export function runReminders(now = new Date()): void {
  const today = dayKey(now)
  for (const a of listAccounts()) {
    if (!a.modules.lembretes) continue
    for (const r of listReminders(a.id)) {
      if (!r.enabled || r.lastRunDay === today || now.getHours() < r.sendHour) continue
      const ids = dueToday(a.id, r, now)
      const db = getDb()
      transaction(db, () => {
        db.prepare('UPDATE reminders SET last_run_day = ? WHERE id = ?').run(today, r.id)
        const period = periodKey(r.kind, now)
        const ins = db.prepare(
          'INSERT OR IGNORE INTO reminder_log (reminder_id, person_id, period, at) VALUES (?, ?, ?, ?)'
        )
        for (const id of ids) ins.run(r.id, id, period, Date.now())
      })
      if (!ids.length) continue
      const c = saveCampaign({
        accountId: a.id,
        name: `Lembrete: ${r.name} — ${now.toLocaleDateString('pt-BR')}`,
        templates: [r.template],
        audience: { type: 'list', personIds: ids },
        optOutFooter: false,
        scheduledAt: null,
        kind: 'reminder',
        source: `reminder:${r.id}`
      })
      startCampaign(c.id)
      engine.kick(a.id)
      log.info(`Lembrete "${r.name}": ${ids.length} contato(s)`)
    }
  }
}

export function startReminders(): void {
  setTimeout(() => runReminders(), 90_000)
  setInterval(() => runReminders(), 15 * 60_000)
}
