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
  `,
  // v2 — conversas, contatos, mensagens e sincronização de histórico
  `
  CREATE TABLE contacts (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    jid TEXT NOT NULL,
    name TEXT,
    notify TEXT,
    verified_name TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, jid)
  );
  CREATE TABLE lid_map (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    lid TEXT NOT NULL,
    pn TEXT NOT NULL,
    PRIMARY KEY (account_id, lid)
  );
  CREATE TABLE chats (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    jid TEXT NOT NULL,
    name TEXT,
    is_group INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 0,
    last_ts INTEGER NOT NULL DEFAULT 0,
    last_preview TEXT,
    last_from_me INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted_until INTEGER NOT NULL DEFAULT 0,
    read_only INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, jid)
  );
  CREATE INDEX chats_recent ON chats (account_id, archived, pinned DESC, last_ts DESC);
  CREATE TABLE messages (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    chat_jid TEXT NOT NULL,
    id TEXT NOT NULL,
    from_me INTEGER NOT NULL,
    sender TEXT,
    sender_name TEXT,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    text TEXT,
    media TEXT,
    extra TEXT,
    quoted_id TEXT,
    status INTEGER NOT NULL DEFAULT 0,
    reactions TEXT,
    edited INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    raw BLOB,
    PRIMARY KEY (account_id, chat_jid, id)
  );
  CREATE INDEX messages_chat_ts ON messages (account_id, chat_jid, ts);
  CREATE INDEX messages_id ON messages (account_id, id);
  CREATE VIRTUAL TABLE messages_fts USING fts5 (
    text, account_id UNINDEXED, chat_jid UNINDEXED, id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE sync_state (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    progress INTEGER,
    messages INTEGER NOT NULL DEFAULT 0,
    chats INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER,
    finished_at INTEGER
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
  // Busca sem acento e sem maiúsculas: unaccent('João') = 'joao'
  db.function('unaccent', { deterministic: true }, (v) =>
    typeof v === 'string' ? v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : null
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
