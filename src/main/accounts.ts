import { randomUUID } from 'node:crypto'
import { DEFAULT_MODULES, MODULE_KEYS, type Account, type Modules } from '@shared/types'
import { getDb } from './db'

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
  getDb()
    .prepare('UPDATE accounts SET name = ?, color = ?, modules = ?, auto_connect = ? WHERE id = ?')
    .run(
      patch.name ?? cur.name,
      patch.color ?? cur.color,
      JSON.stringify(modules),
      (patch.autoConnect ?? cur.autoConnect) ? 1 : 0,
      id
    )
  return getAccount(id)!
}

export function deleteAccount(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}
