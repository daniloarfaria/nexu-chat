import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'
import { gzipSync, gunzipSync } from 'node:zlib'
import type { BackupSettings } from '../shared/types'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>

/*
 * Formato v2: "DSPBAK02" | logN(1) | r(1) | p(1) | salt(16) | iv(12) | tag(16) | dados
 * O cabeçalho (tudo antes da tag) é autenticado (AAD). Dados = AES-256-GCM de gzip(sqlite).
 * v1 ("DSPBAK01", N=2^15 fixo, sem AAD) continua sendo lido.
 */
const MAGIC_V1 = Buffer.from('DSPBAK01')
const MAGIC_V2 = Buffer.from('DSPBAK02')
export const BACKUP_EXT = '.dspbak'
const MAX_DB_BYTES = 4 * 1024 * 1024 * 1024 // limite ao descompactar (proteção contra arquivo malicioso)
const KDF = { logN: 17, r: 8, p: 1 }

function kdf(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  if (logN < 14 || logN > 20 || r < 1 || r > 16 || p < 1 || p > 4)
    throw new Error('Este arquivo não é um backup do app')
  return scrypt(password, salt, 32, { N: 2 ** logN, r, p, maxmem: 128 * r * 2 ** logN * 2 })
}

export async function encryptBackup(plain: Buffer, password: string): Promise<Buffer> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const header = Buffer.concat([MAGIC_V2, Buffer.from([KDF.logN, KDF.r, KDF.p]), salt, iv])
  const key = await kdf(password, salt, KDF.logN, KDF.r, KDF.p)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const enc = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()])
  return Buffer.concat([header, cipher.getAuthTag(), enc])
}

export async function decryptBackup(file: Buffer, password: string): Promise<Buffer> {
  const magic = file.subarray(0, 8)
  let key: Buffer, iv: Buffer, tag: Buffer, body: Buffer, aad: Buffer | null
  if (magic.equals(MAGIC_V2) && file.length >= 8 + 3 + 16 + 12 + 16) {
    const [logN, r, p] = file.subarray(8, 11)
    const salt = file.subarray(11, 27)
    iv = file.subarray(27, 39)
    aad = file.subarray(0, 39)
    tag = file.subarray(39, 55)
    body = file.subarray(55)
    key = await kdf(password, salt, logN, r, p)
  } else if (magic.equals(MAGIC_V1) && file.length >= 52) {
    const salt = file.subarray(8, 24)
    iv = file.subarray(24, 36)
    tag = file.subarray(36, 52)
    body = file.subarray(52)
    aad = null
    key = await kdf(password, salt, 15, 8, 1)
  } else {
    throw new Error('Este arquivo não é um backup do app')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  if (aad) decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  let zipped: Buffer
  try {
    zipped = Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    throw new Error('Senha incorreta ou arquivo corrompido')
  }
  const plain = gunzipSync(zipped, { maxOutputLength: MAX_DB_BYTES })
  if (!plain.subarray(0, 16).toString('latin1').startsWith('SQLite format 3')) {
    throw new Error('O conteúdo do backup não é um banco válido')
  }
  return plain
}

/** Só para testes: gera um arquivo no formato antigo (v1). */
export async function encryptBackupV1(plain: Buffer, password: string): Promise<Buffer> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await kdf(password, salt, 15, 8, 1)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()])
  return Buffer.concat([MAGIC_V1, salt, iv, cipher.getAuthTag(), enc])
}

export function isBackupDue(s: BackupSettings, now = Date.now()): boolean {
  if (!s.folder || !s.passwordSet) return false
  const interval = s.frequency === 'daily' ? 86_400_000 : s.frequency === 'weekly' ? 7 * 86_400_000 : null
  if (!interval) return false
  return !s.lastBackupAt || now - s.lastBackupAt >= interval
}
