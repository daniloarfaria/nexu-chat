// Medição 1: gera o banco sintético, mede a abertura do banco e as migrações (banco vazio e banco grande antigo).
import { expect, test, vi } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

vi.mock('electron', () => ({
  app: { getPath: () => process.env['NEXU_PERF_DIR'] ?? '/tmp', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../../src/main/db'
import { reparseUnsupported } from '../../src/main/wa/store'
import { reprocessAdAttribution } from '../../src/main/ads'
import {
  BASELINE_COMMIT,
  BASE_DB,
  BIG_DB,
  META,
  PERF_DIR,
  bench,
  ensureDirs,
  fileMB,
  migrationsAt,
  migrationsNow,
  openWith,
  save,
  stat,
  type Stat
} from './lib'
import { fillNewTables, generateBase, type Meta } from './dados'

const out: Record<string, unknown> = {}
const wipe = (p: string): void => {
  for (const s of ['', '-wal', '-shm']) rmSync(p + s, { force: true })
}

test('gera o banco grande no esquema do commit de referência', () => {
  ensureDirs()
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const t0 = performance.now()
  const meta = generateBase(BASE_DB, today.getTime())
  out.geracao = {
    segundos: Math.round((performance.now() - t0) / 100) / 10,
    tamanhoMB: fileMB(BASE_DB),
    contagens: meta.counts
  }
  writeFileSync(META, JSON.stringify(meta, null, 2))
  expect(meta.counts.messages).toBe(500_000)
})

test('banco vazio: abrir e migrar', () => {
  const dir = mkdtempSync(join(PERF_DIR, 'vazio-'))
  let i = 0
  const base = migrationsAt(BASELINE_COMMIT)
  out.versoes = { referencia: base.length, atual: migrationsNow().length }
  // v0 → atual (instalação nova): cria o arquivo e roda todas as migrações
  const novo = bench(() => {
    openDb(join(dir, `novo-${i++}.sqlite`))
    closeDb()
  }, 30)
  // já na versão atual: só abrir
  const p = join(dir, 'pronto.sqlite')
  openDb(p)
  closeDb()
  const reabrir = bench(() => {
    openDb(p)
    closeDb()
  }, 30)
  // vazio na versão do commit de referência → atual
  const samples: number[] = []
  for (let n = 0; n < 33; n++) {
    const q = join(dir, `antigo-${n}.sqlite`)
    openWith(q, base).close()
    const t0 = performance.now()
    openDb(q)
    const dt = performance.now() - t0
    closeDb()
    if (n >= 3) samples.push(dt)
  }
  out.vazio = { novoV0aAtual: novo, reabrirSemMigrar: reabrir, referenciaAAtual: stat(samples) }
  rmSync(dir, { recursive: true, force: true })
})

test('banco grande: atualização do commit de referência até o atual', () => {
  const work = join(PERF_DIR, 'trabalho.sqlite')
  const abrir: number[] = []
  const fechar: number[] = []
  for (let n = 0; n < 5; n++) {
    wipe(work)
    copyFileSync(BASE_DB, work)
    const t0 = performance.now()
    openDb(work)
    abrir.push(performance.now() - t0)
    expect((getDb().prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(
      migrationsNow().length
    )
    const t1 = performance.now()
    closeDb()
    fechar.push(performance.now() - t1)
  }
  wipe(BIG_DB)
  copyFileSync(work, BIG_DB)
  wipe(work)
  out.grandeAtualizacao = { abrirEMigrar: stat(abrir), fechar: stat(fechar) }
})

test('banco grande já migrado: abrir, etapas síncronas da inicialização e fechar', () => {
  const abrir: number[] = []
  const reparse: number[] = []
  const fechar: number[] = []
  for (let n = 0; n < 11; n++) {
    const t0 = performance.now()
    openDb(BIG_DB)
    const t1 = performance.now()
    reparseUnsupported() // roda de forma síncrona antes de a janela abrir (src/main/index.ts)
    const t2 = performance.now()
    closeDb()
    const t3 = performance.now()
    if (n === 0) {
      out.grandePrimeiraAbertura = { abrirMs: t1 - t0, reparseUnsupportedMs: t2 - t1 }
      continue
    }
    abrir.push(t1 - t0)
    reparse.push(t2 - t1)
    fechar.push(t3 - t2)
  }
  out.grandeAbrir = { abrir: stat(abrir), reparseUnsupported: stat(reparse), fechar: stat(fechar) }
})

test('tabelas novas preenchidas e histórico de anúncios reprocessado do zero', () => {
  const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta
  const db = openDb(BIG_DB)
  out.tabelasNovas = fillNewTables(db, meta)
  // Depois de atualizar, o app relê TODO o histórico em lotes de 500 a cada 200 ms (src/main/index.ts → scanAds)
  const lotes: number[] = []
  let scanned = 0
  let found = 0
  let done = false
  const budget = 20 * 60_000
  const start = performance.now()
  while (!done && performance.now() - start < budget) {
    const t0 = performance.now()
    const r = reprocessAdAttribution()
    lotes.push(performance.now() - t0)
    scanned += r.scanned
    found += r.found
    done = r.done
  }
  const cpuMs = lotes.reduce((a, b) => a + b, 0)
  const third = Math.max(1, Math.floor(lotes.length / 3))
  const part = (a: number[]): Stat => stat(a.length ? a : [0])
  out.anuncios = {
    terminou: done,
    lotes: lotes.length,
    mensagensLidas: scanned,
    conversasDeAnuncio: found,
    porLote: stat(lotes),
    primeiroTerco: part(lotes.slice(0, third)),
    ultimoTerco: part(lotes.slice(-third)),
    cpuTotalSegundos: Math.round(cpuMs / 100) / 10,
    // tempo de relógio no app: soma dos lotes + 200 ms de pausa entre eles
    relogioNoAppSegundos: Math.round((cpuMs + lotes.length * 200) / 100) / 10
  }
  closeDb()
  out.tamanhoFinalMB = fileMB(BIG_DB)
  save('01-banco-e-migracoes', out)
  console.log(JSON.stringify(out, null, 2))
})
