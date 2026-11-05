import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BackupFile, BackupSettings } from '@shared/types'
import { getDb, getDbPath, getSetting, setSetting } from './db'
import { sealString, unsealString } from './secure'
import { log } from './log'
import { BACKUP_EXT, decryptBackup, encryptBackup, isBackupDue } from './backup-core'

export { BACKUP_EXT, isBackupDue }

const DEFAULTS: BackupSettings = {
  folder: null,
  frequency: 'daily',
  keep: 10,
  passwordSet: false,
  lastBackupAt: null,
  lastError: null
}

export function getBackupSettings(): BackupSettings {
  const s = getSetting<BackupSettings>('backup', DEFAULTS)
  return { ...DEFAULTS, ...s, passwordSet: !!getSetting<string | null>('backupPassword', null) }
}

export function updateBackupSettings(patch: Partial<Omit<BackupSettings, 'passwordSet'>>): BackupSettings {
  const next = { ...getBackupSettings(), ...patch }
  const { passwordSet: _ignored, ...persist } = next
  void _ignored
  setSetting('backup', persist)
  return getBackupSettings()
}

export function setBackupPassword(password: string): void {
  if (password.length < 8) throw new Error('A senha do backup precisa ter pelo menos 8 caracteres')
  setSetting('backupPassword', sealString(password))
}

function getPassword(): string {
  const sealed = getSetting<string | null>('backupPassword', null)
  if (!sealed) throw new Error('Defina uma senha de backup antes')
  try {
    return unsealString(sealed)
  } catch {
    throw new Error('Defina a senha de backup novamente (dados vieram de outro computador)')
  }
}

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

let running: Promise<string> | null = null

/** Gera um backup na pasta configurada e apaga os mais antigos além do limite. */
export function runBackup(): Promise<string> {
  if (running) return running
  running = (async () => {
    const settings = getBackupSettings()
    try {
      if (!settings.folder) throw new Error('Escolha a pasta de backup')
      if (!existsSync(settings.folder)) throw new Error('A pasta de backup não existe ou não está acessível')
      const password = getPassword()

      // Cópia consistente do banco, mesmo com o app em uso
      // Cópia temporária fica na pasta do app (não na pasta temporária do sistema) e sempre é apagada
      const tmp = join(dirname(getDbPath()), `.backup-${process.pid}-${Date.now()}.sqlite`)
      let data: Buffer
      try {
        getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
        data = await encryptBackup(readFileSync(tmp), password)
      } finally {
        rmSync(tmp, { force: true })
      }

      const name = `backup-${installId()}-${stamp()}${BACKUP_EXT}`
      const dest = join(settings.folder, name)
      writeFileSync(dest + '.part', data)
      renameSync(dest + '.part', dest) // nunca deixa um backup pela metade com o nome final
      prune(settings.folder, settings.keep)
      updateBackupSettings({ lastBackupAt: Date.now(), lastError: null })
      log.info(`Backup criado: ${name}`)
      return dest
    } catch (e) {
      updateBackupSettings({ lastError: (e as Error).message })
      log.error('Falha no backup', e)
      throw e
    } finally {
      running = null
    }
  })()
  return running
}

export function listBackups(folder = getBackupSettings().folder): BackupFile[] {
  if (!folder || !existsSync(folder)) return []
  return readdirSync(folder)
    .filter((f) => f.startsWith('backup-') && f.endsWith(BACKUP_EXT))
    .map((f) => {
      const st = statSync(join(folder, f))
      return { name: f, size: st.size, createdAt: st.mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Apaga só os backups antigos DESTE computador (a pasta pode ser compartilhada). */
function prune(folder: string, keep: number): void {
  const mine = `backup-${installId()}-`
  const files = listBackups(folder).filter((f) => f.name.startsWith(mine))
  for (const f of files.slice(Math.max(1, keep))) {
    rmSync(join(folder, basename(f.name)), { force: true })
  }
}

/**
 * Restaura: decifra o arquivo e grava como banco pendente.
 * O app reinicia e troca o banco antes de abri-lo (ver applyPendingRestore).
 */
export async function prepareRestore(file: string, password: string, dbPath: string): Promise<void> {
  const plain = await decryptBackup(readFileSync(file), password)
  mkdirSync(join(dbPath, '..'), { recursive: true })
  writeFileSync(dbPath + '.restore', plain)
}

export function applyPendingRestore(dbPath: string): boolean {
  cleanupOldCopies(dbPath)
  const pending = dbPath + '.restore'
  if (!existsSync(pending)) return false
  if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.antes-restauracao-${stamp()}`)
  for (const ext of ['-wal', '-shm']) rmSync(dbPath + ext, { force: true })
  renameSync(pending, dbPath)
  return true
}

function installId(): string {
  let id = getSetting<string | null>('installId', null)
  if (!id) {
    id = randomUUID().slice(0, 8)
    setSetting('installId', id)
  }
  return id
}

/** Cópias sem criptografia de antes de uma restauração: guarda por 7 dias e só a mais recente. */
function cleanupOldCopies(dbPath: string): void {
  const dir = dirname(dbPath)
  const base = basename(dbPath)
  const copies = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.antes-restauracao-`) || (f.startsWith('.backup-') && f.endsWith('.sqlite')))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  copies.forEach((c, i) => {
    const temp = c.f.startsWith('.backup-')
    if (temp || i > 0 || Date.now() - c.t > 7 * 86_400_000) rmSync(join(dir, c.f), { force: true })
  })
}
