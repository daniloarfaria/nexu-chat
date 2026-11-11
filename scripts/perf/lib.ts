// Utilitários das medições de desempenho (scripts/perf). Não é código do app.
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir, totalmem, release, platform, arch } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

/** Pasta de trabalho (bancos sintéticos e resultados). Fora do repositório por padrão. */
export const PERF_DIR = process.env['NEXU_PERF_DIR'] || join(tmpdir(), 'nexu-perf')
export const BASE_DB = join(PERF_DIR, 'base-v7.sqlite') // banco grande no esquema do commit de referência
export const BIG_DB = join(PERF_DIR, 'grande-atual.sqlite') // banco grande já migrado e com as tabelas novas preenchidas
export const META = join(PERF_DIR, 'meta.json')
export const RESULTS = join(PERF_DIR, 'resultados')

/** Commit de referência para simular a atualização de um banco antigo. */
export const BASELINE_COMMIT = 'b549c1f'

export const ACCOUNTS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Loja Centro', share: 0.6 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Loja Shopping', share: 0.3 },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Loja Bairro', share: 0.1 }
]

export const SIZES = {
  chats: 20_000,
  messages: 500_000,
  people: 5_000,
  cards: 2_000,
  leads: 5_000,
  deals: 3_000
}

export function ensureDirs(): void {
  mkdirSync(RESULTS, { recursive: true })
}

// ---------- Números pseudoaleatórios determinísticos ----------

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- Estatística ----------

export interface Stat {
  n: number
  medianMs: number
  p95Ms: number
  minMs: number
  maxMs: number
}

export function stat(samples: number[]): Stat {
  const s = [...samples].sort((a, b) => a - b)
  const q = (p: number): number => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]
  const round = (v: number): number => Math.round(v * 1000) / 1000
  return {
    n: s.length,
    medianMs: round(q(0.5)),
    p95Ms: round(q(0.95)),
    minMs: round(s[0]),
    maxMs: round(s[s.length - 1])
  }
}

/** Roda `fn` N vezes (depois de `warm` aquecimentos) e devolve mediana e p95 em milissegundos. */
export function bench(fn: () => unknown, n = 30, warm = 3): Stat {
  for (let i = 0; i < warm; i++) fn()
  const samples: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    fn()
    samples.push(performance.now() - t0)
  }
  return stat(samples)
}

/** N adaptável: consultas lentas rodam menos vezes para a medição não levar horas. */
export function benchAuto(fn: () => unknown): Stat {
  const t0 = performance.now()
  fn()
  const first = performance.now() - t0
  if (first > 2000) return bench(fn, 5, 0)
  if (first > 200) return bench(fn, 10, 1)
  return bench(fn, 30, 3)
}

// ---------- Gravador de SQL: quais comandos cada função real executa, quantas vezes e por quanto tempo ----------

export interface SqlUse {
  sql: string
  calls: number
  ms: number
}

type Prepare = DatabaseSync['prepare']
const proto = DatabaseSync.prototype as unknown as { prepare: Prepare }
const originalPrepare: Prepare = proto.prepare
let recording: Map<string, SqlUse> | null = null

/** Executa `fn` com o gravador ligado e devolve os comandos SQL usados (texto exato do código do app). */
export function recordSql<T>(fn: () => T): { result: T; uses: SqlUse[] } {
  const rec = new Map<string, SqlUse>()
  recording = rec
  proto.prepare = function (this: DatabaseSync, sql: string, ...rest: unknown[]) {
    const stmt = (originalPrepare as (...a: unknown[]) => object).call(this, sql, ...rest)
    const key = sql.replace(/\s+/g, ' ').trim()
    let use = rec.get(key)
    if (!use) rec.set(key, (use = { sql: key, calls: 0, ms: 0 }))
    const u = use
    return new Proxy(stmt, {
      get(target, prop) {
        const v = (target as Record<string | symbol, unknown>)[prop]
        if (typeof v !== 'function') return v
        if (prop === 'all' || prop === 'get' || prop === 'run') {
          return (...args: unknown[]) => {
            const t0 = performance.now()
            try {
              return (v as (...a: unknown[]) => unknown).apply(target, args)
            } finally {
              u.ms += performance.now() - t0
              u.calls++
            }
          }
        }
        return (v as (...a: unknown[]) => unknown).bind(target)
      }
    })
  } as Prepare
  try {
    const result = fn()
    return { result, uses: [...rec.values()].sort((a, b) => b.ms - a.ms) }
  } finally {
    proto.prepare = originalPrepare
    recording = null
  }
}

export function isRecording(): boolean {
  return recording != null
}

export interface Plan {
  sql: string
  plan: string[]
  /** Linhas do plano que varrem a tabela inteira ou ordenam em área temporária. */
  flags: string[]
}

/** EXPLAIN QUERY PLAN do comando, com as linhas problemáticas separadas. */
export function explain(db: DatabaseSync, sql: string): Plan {
  if (!/^\s*(SELECT|UPDATE|DELETE|INSERT|WITH)/i.test(sql)) return { sql, plan: [], flags: [] }
  let rows: Array<{ detail: string }> = []
  try {
    rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>
  } catch (e) {
    return { sql, plan: [`(não foi possível explicar: ${(e as Error).message})`], flags: [] }
  }
  const plan = rows.map((r) => r.detail)
  const flags = plan.filter(
    (d) =>
      /USE TEMP B-TREE/.test(d) ||
      // json_each e subconsultas materializadas aparecem como SCAN, mas não são varredura de tabela
      (/^SCAN /.test(d) && !/^SCAN (j|json_each|CONSTANT ROW|\(subquery|\(join)/i.test(d) && !/VIRTUAL TABLE/.test(d))
  )
  return { sql, plan, flags }
}

// ---------- Migrações de outro commit (para montar um banco "antigo") ----------

/** Lê a lista MIGRATIONS de src/main/db.ts em outro commit ou branch, sem trocar de branch. */
export function migrationsAt(ref: string): string[] {
  const src = execFileSync('git', ['show', `${ref}:src/main/db.ts`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return parseMigrations(src)
}

export function migrationsNow(): string[] {
  return parseMigrations(readFileSync(join(process.cwd(), 'src/main/db.ts'), 'utf8'))
}

function parseMigrations(src: string): string[] {
  const start = src.indexOf('const MIGRATIONS: string[] = [')
  const end = src.indexOf('\n]\n', start)
  if (start < 0 || end < 0) throw new Error('Não achei a lista MIGRATIONS em src/main/db.ts')
  const body = src.slice(src.indexOf('[', start) + 1, end)
  const out: string[] = []
  const re = /`([^`]*)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) out.push(m[1])
  return out
}

/** Abre um banco com os mesmos PRAGMAs do app e aplica uma lista de migrações (como src/main/db.ts faz). */
export function openWith(path: string, migrations: string[]): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;'
  )
  const cur = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = cur; v < migrations.length; v++) {
    db.exec('BEGIN IMMEDIATE')
    db.exec(migrations[v])
    db.exec(`PRAGMA user_version = ${v + 1}`)
    db.exec('COMMIT')
  }
  return db
}

// ---------- Ambiente e saída ----------

export function machine(): Record<string, string | number> {
  return {
    cpu: cpus()[0]?.model ?? '?',
    nucleos: cpus().length,
    memoriaGB: Math.round(totalmem() / 2 ** 30),
    sistema: `${platform()} ${release()} (${arch})`,
    node: process.version,
    sqlite: (process.versions as Record<string, string>)['sqlite'] ?? '?'
  }
}

export function fileMB(path: string): number {
  return Math.round((statSync(path).size / 2 ** 20) * 10) / 10
}

export function save(name: string, data: unknown): void {
  ensureDirs()
  writeFileSync(join(RESULTS, `${name}.json`), JSON.stringify({ maquina: machine(), ...(data as object) }, null, 2))
}

export function readMeta(): { now: number; nowSec: number; samples: Record<string, unknown> } {
  return JSON.parse(readFileSync(META, 'utf8'))
}

export function fmt(s: Stat): string {
  return `${s.medianMs} / ${s.p95Ms} (N=${s.n})`
}
