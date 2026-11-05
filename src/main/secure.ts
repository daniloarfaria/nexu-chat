import { safeStorage } from 'electron'
import { log } from './log'

// Criptografia local amarrada ao usuário do sistema (Keychain no Mac, DPAPI no Windows).
// Prefixo de 1 byte indica se o valor está protegido (1) ou em texto puro (0, fallback raro).

let warned = false

export function seal(plain: Buffer): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return Buffer.concat([Buffer.from([1]), safeStorage.encryptString(plain.toString('base64'))])
  }
  if (!warned) {
    warned = true
    log.warn('Criptografia do sistema indisponível; dados de sessão ficam sem proteção extra')
  }
  return Buffer.concat([Buffer.from([0]), plain])
}

export function unseal(data: Uint8Array): Buffer {
  const buf = Buffer.from(data)
  if (buf[0] === 0) return buf.subarray(1)
  if (buf[0] === 1) return Buffer.from(safeStorage.decryptString(buf.subarray(1)), 'base64')
  throw new Error('Formato de dado protegido desconhecido')
}

export function sealString(s: string): string {
  return seal(Buffer.from(s, 'utf8')).toString('base64')
}

export function unsealString(s: string): string {
  return unseal(Buffer.from(s, 'base64')).toString('utf8')
}
