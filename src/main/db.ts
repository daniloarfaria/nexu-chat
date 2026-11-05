import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// Banco local (SQLite embutido no Node/Electron, sem módulo nativo).
// Cada migração roda uma única vez, em ordem, dentro de uma transação.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    phone TEXT,
    modules TEXT NOT NULL,
    auto_connect INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE wa_auth (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    key_id TEXT NOT NULL,
    value BLOB NOT NULL,
    PRIMARY KEY (account_id, category, key_id)
  );
  `
]

let db: DatabaseSync | null = null
let dbPath = ''

export function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  dbPath = path
  db = new DatabaseSync(path)
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;'
  )
  migrate(db)
  return db
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Banco de dados não foi aberto')
  return db
}

export function getDbPath(): string {
  return dbPath
}

export function closeDb(): void {
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignora */
    }
    db.close()
    db = null
  }
}

function migrate(d: DatabaseSync): void {
  const current = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(d, () => {
      d.exec(MIGRATIONS[v])
      d.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

export function transaction<T>(d: DatabaseSync, fn: () => T): T {
  d.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    d.exec('COMMIT')
    return r
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

// --- Configurações (chave → JSON) ---
export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value))
}
