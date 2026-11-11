import { randomUUID } from 'node:crypto'
import { DEFAULT_MODULES, MODULE_KEYS, type Account, type Modules } from '@shared/types'
import { getDb, getSetting, setSetting } from './db'
import { licenseStatus } from './license'

interface Row {
  id: string
  name: string
  color: string
  phone: string | null
  modules: string
  auto_connect: number
  created_at: number
}

function toAccount(r: Row): Account {
  let mods: Partial<Modules> = {}
  try {
    mods = JSON.parse(r.modules)
  } catch {
    /* usa padrão */
  }
  const modules = { ...DEFAULT_MODULES }
  for (const k of MODULE_KEYS) if (typeof mods[k] === 'boolean') modules[k] = mods[k] as boolean
  // Só fica ligado o que a licença libera
  const allowed = licenseStatus().modules
  for (const k of MODULE_KEYS) if (!allowed.includes(k)) modules[k] = false
  // O perfil pela IA, o robô de atendimento e a recuperação de vendas dependem do Assistente de IA
  if (!modules.ia) {
    modules.perfilIa = false
    modules.iaAtendimento = false
    modules.recuperacao = false
  }
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    phone: r.phone,
    modules,
    autoConnect: !!r.auto_connect,
    createdAt: r.created_at
  }
}

export function listAccounts(): Account[] {
  return (getDb().prepare('SELECT * FROM accounts ORDER BY created_at').all() as unknown as Row[]).map(toAccount)
}

export function getAccount(id: string): Account | null {
  const r = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined
  return r ? toAccount(r) : null
}

export function createAccount(name: string, color: string): Account {
  const max = licenseStatus().maxAccounts
  const n = (getDb().prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
  if (n >= max) throw new Error(`Sua licença permite ${max} número(s) de WhatsApp. Fale com a agência para ampliar.`)
  const id = randomUUID()
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, color, JSON.stringify(DEFAULT_MODULES), Date.now())
  return getAccount(id)!
}

export function updateAccount(
  id: string,
  patch: { name?: string; color?: string; modules?: Partial<Modules>; autoConnect?: boolean }
): Account {
  const cur = getAccount(id)
  if (!cur) throw new Error('Conta não encontrada')
  const modules = { ...cur.modules, ...(patch.modules ?? {}) }
  if (!modules.ia) {
    modules.perfilIa = false
    modules.iaAtendimento = false
    modules.recuperacao = false
  }
  getDb()
    .prepare('UPDATE accounts SET name = ?, color = ?, modules = ?, auto_connect = ? WHERE id = ?')
    .run(
      patch.name ?? cur.name,
      patch.color ?? cur.color,
      JSON.stringify(modules),
      (patch.autoConnect ?? cur.autoConnect) ? 1 : 0,
      id
    )
  // Ao ligar os Lembretes pela primeira vez, já vem o lembrete de aniversário pronto
  if (patch.modules?.lembretes && !cur.modules.lembretes) ensureBirthdayReminder(id)
  return getAccount(id)!
}

/** Cria o lembrete de aniversário padrão uma vez por conta (e só se ela ainda não tem um). */
function ensureBirthdayReminder(accountId: string): void {
  const flag = `reminders.birthday-default.${accountId}`
  if (getSetting<boolean>(flag, false)) return
  setSetting(flag, true)
  const db = getDb()
  if (db.prepare("SELECT 1 FROM reminders WHERE account_id = ? AND kind = 'birthday'").get(accountId)) return
  db.prepare(
    'INSERT INTO reminders (name, kind, field, offset_days, send_hour, template, tags, enabled, account_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    'Aniversário',
    'birthday',
    null,
    0,
    10,
    '{Parabéns|Feliz aniversário}, {primeiro_nome}! A equipe da {loja} deseja um dia muito especial.',
    '[]',
    1,
    accountId,
    Date.now()
  )
}

export function deleteAccount(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
