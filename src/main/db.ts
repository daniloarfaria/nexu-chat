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
  `,
  // v3 — base de clientes, campanhas, automações, lembretes, vendas, grupos e IA
  `
  CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    jid TEXT,
    name TEXT,
    birthday TEXT,
    fields TEXT,
    opt_out INTEGER NOT NULL DEFAULT 0,
    opt_out_at INTEGER,
    has_wa INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (account_id, phone)
  );
  CREATE INDEX people_jid ON people (account_id, jid);
  CREATE TABLE person_tags (
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (person_id, tag)
  );
  CREATE INDEX person_tags_tag ON person_tags (tag);

  CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'people',
    status TEXT NOT NULL DEFAULT 'draft',
    templates TEXT NOT NULL,
    media TEXT,
    audience TEXT NOT NULL,
    opt_out_footer INTEGER NOT NULL DEFAULT 1,
    scheduled_at INTEGER,
    started_at INTEGER,
    finished_at INTEGER,
    paused_reason TEXT,
    source TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE campaign_targets (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    person_id INTEGER,
    jid TEXT,
    phone TEXT,
    name TEXT,
    vars TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    message_id TEXT,
    error TEXT,
    sent_at INTEGER,
    delivered_at INTEGER,
    read_at INTEGER,
    replied_at INTEGER,
    PRIMARY KEY (campaign_id, seq)
  );
  CREATE INDEX targets_status ON campaign_targets (campaign_id, status);
  CREATE INDEX targets_msg ON campaign_targets (message_id);
  CREATE INDEX targets_jid ON campaign_targets (jid, sent_at);
  CREATE TABLE send_log (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, day)
  );

  CREATE TABLE auto_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    keywords TEXT,
    match_mode TEXT NOT NULL DEFAULT 'contains',
    reply TEXT NOT NULL,
    cooldown_min INTEGER NOT NULL DEFAULT 60,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE auto_log (
    account_id TEXT NOT NULL,
    rule_id INTEGER NOT NULL,
    jid TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX auto_log_idx ON auto_log (account_id, rule_id, jid, at);

  CREATE TABLE reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    field TEXT,
    offset_days INTEGER NOT NULL DEFAULT 0,
    send_hour INTEGER NOT NULL DEFAULT 10,
    template TEXT NOT NULL,
    tags TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_day TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE reminder_log (
    reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (reminder_id, person_id, period)
  );

  CREATE TABLE deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    chat_jid TEXT NOT NULL,
    status TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    product TEXT,
    payment TEXT,
    reason TEXT,
    note TEXT,
    source_type TEXT NOT NULL DEFAULT 'organic',
    source_id INTEGER,
    source_name TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX deals_account ON deals (account_id, created_at);
  CREATE INDEX deals_chat ON deals (account_id, chat_jid);

  CREATE TABLE group_rules (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    group_jid TEXT NOT NULL,
    welcome TEXT,
    anti_link INTEGER NOT NULL DEFAULT 0,
    banned_words TEXT,
    max_warnings INTEGER NOT NULL DEFAULT 2,
    PRIMARY KEY (account_id, group_jid)
  );
  CREATE TABLE group_warnings (
    account_id TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    participant TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, group_jid, participant)
  );
  CREATE TABLE groups_cache (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    jid TEXT NOT NULL,
    subject TEXT,
    description TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    announce INTEGER NOT NULL DEFAULT 0,
    participants TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, jid)
  );

  CREATE TABLE ai_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preset TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT,
    model_fast TEXT,
    model_smart TEXT,
    trains_on_data INTEGER NOT NULL DEFAULT 1,
    rpm INTEGER,
    rpd INTEGER,
    paid INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 100,
    cooldown_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE ai_usage (
    provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider_id, day)
  );
  CREATE TABLE ai_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    task TEXT NOT NULL,
    customer_data INTEGER NOT NULL,
    chars_sent INTEGER NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE TABLE playbooks (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v4 — lista de supressão (opt-out) que sobrevive à exclusão do contato
  `
  CREATE TABLE suppression (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (account_id, key)
  );
  INSERT OR IGNORE INTO suppression (account_id, key, at)
    SELECT account_id, phone, COALESCE(opt_out_at, 0) FROM people WHERE opt_out = 1;
  INSERT OR IGNORE INTO suppression (account_id, key, at)
    SELECT account_id, jid, COALESCE(opt_out_at, 0) FROM people WHERE opt_out = 1 AND jid IS NOT NULL;
  `,
  // v5 — fotos de perfil (cache local)
  `
  CREATE TABLE avatars (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    jid TEXT NOT NULL,
    file TEXT,
    checked_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, jid)
  );
  `,
  // v6 — transcrição de áudios (Whisper)
  `
  ALTER TABLE messages ADD COLUMN transcript TEXT;
  `,
  // v7 — etiquetas com cor e funis (kanban)
  `
  CREATE TABLE tag_defs (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    color TEXT NOT NULL DEFAULT 'slate',
    description TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, name)
  );
  INSERT OR IGNORE INTO tag_defs (account_id, name, color, created_at)
    SELECT DISTINCT p.account_id, t.tag, 'slate', CAST(strftime('%s','now') AS INTEGER) * 1000
    FROM person_tags t JOIN people p ON p.id = t.person_id;
  UPDATE OR IGNORE person_tags SET tag = (
    SELECT d.name FROM tag_defs d JOIN people p ON p.account_id = d.account_id
    WHERE p.id = person_tags.person_id AND d.name = person_tags.tag
  );
  DELETE FROM person_tags WHERE NOT EXISTS (
    SELECT 1 FROM tag_defs d JOIN people p ON p.account_id = d.account_id
    WHERE p.id = person_tags.person_id AND d.name = person_tags.tag COLLATE BINARY
  );

  CREATE TABLE pipelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'blue',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX pipelines_account ON pipelines (account_id, position);
  CREATE TABLE pipeline_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    kind TEXT NOT NULL DEFAULT 'open',
    position INTEGER NOT NULL,
    auto_tag TEXT,
    remove_tag_on_leave INTEGER NOT NULL DEFAULT 0,
    sla_days INTEGER,
    description TEXT
  );
  CREATE INDEX stages_pipeline ON pipeline_stages (pipeline_id, position);
  CREATE TABLE pipeline_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position REAL NOT NULL,
    value_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at INTEGER NOT NULL,
    moved_at INTEGER NOT NULL,
    UNIQUE (pipeline_id, person_id)
  );
  CREATE INDEX cards_stage ON pipeline_cards (stage_id, position);
  CREATE INDEX cards_person ON pipeline_cards (person_id);
  `,
  // status
  `
  CREATE TABLE status_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT,
    media TEXT,
    background TEXT,
    font INTEGER,
    audience TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'agendado',
    error TEXT,
    sent_at INTEGER,
    recipients_count INTEGER,
    message_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX status_posts_due ON status_posts (status, scheduled_at);
  CREATE INDEX status_posts_account ON status_posts (account_id, created_at);
  `,
  // notas do cliente e datas
  `
  CREATE TABLE contact_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'geral',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'atendente',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX contact_notes_person ON contact_notes (person_id, pinned DESC, updated_at DESC);
  -- até onde a IA já leu a conversa de cada contato (disparo automático) e sugestões já dispensadas
  CREATE TABLE contact_profile_state (
    person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    last_ts INTEGER NOT NULL DEFAULT 0,
    birthday_suggestion TEXT,
    birthday_dismissed INTEGER NOT NULL DEFAULT 0
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
