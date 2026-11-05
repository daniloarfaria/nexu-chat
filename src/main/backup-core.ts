import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'
import { gzipSync, gunzipSync } from 'node:zlib'
import type { BackupSettings } from '../shared/types'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>

// Formato do arquivo: MAGIC(8) | salt(16) | iv(12) | tag(16) | dados cifrados (AES-256-GCM de gzip(sqlite))
const MAGIC = Buffer.from('DSPBAK01')
export const BACKUP_EXT = '.dspbak'
const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export async function encryptBackup(plain: Buffer, password: string): Promise<Buffer> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await scrypt(password, salt, 32, SCRYPT_OPTS)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), enc])
}

export async function decryptBackup(file: Buffer, password: string): Promise<Buffer> {
  if (file.length < 52 || !file.subarray(0, 8).equals(MAGIC)) throw new Error('Este arquivo não é um backup do app')
  const salt = file.subarray(8, 24)
  const iv = file.subarray(24, 36)
  const tag = file.subarray(36, 52)
  const key = await scrypt(password, salt, 32, SCRYPT_OPTS)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  let zipped: Buffer
  try {
    zipped = Buffer.concat([decipher.update(file.subarray(52)), decipher.final()])
  } catch {
    throw new Error('Senha incorreta ou arquivo corrompido')
  }
  const plain = gunzipSync(zipped)
  if (!plain.subarray(0, 16).toString('latin1').startsWith('SQLite format 3')) {
    throw new Error('O conteúdo do backup não é um banco válido')
  }
  return plain
}

export function isBackupDue(s: BackupSettings, now = Date.now()): boolean {
  if (!s.folder || !s.passwordSet) return false
  const interval = s.frequency === 'daily' ? 86_400_000 : s.frequency === 'weekly' ? 7 * 86_400_000 : null
  if (!interval) return false
  return !s.lastBackupAt || now - s.lastBackupAt >= interval
}
