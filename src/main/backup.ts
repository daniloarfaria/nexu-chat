import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import type { BackupFile, BackupSettings } from '@shared/types'
import { getDb, getSetting, setSetting } from './db'
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
      const tmp = join(tmpdir(), `dsp-${process.pid}-${Date.now()}.sqlite`)
      getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
      const data = await encryptBackup(readFileSync(tmp), password)
      rmSync(tmp, { force: true })

      const name = `backup-${stamp()}${BACKUP_EXT}`
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

function prune(folder: string, keep: number): void {
  const files = listBackups(folder)
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
  const pending = dbPath + '.restore'
  if (!existsSync(pending)) return false
  if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.antes-restauracao-${stamp()}`)
  for (const ext of ['-wal', '-shm']) rmSync(dbPath + ext, { force: true })
  renameSync(pending, dbPath)
  return true
}
