import { app } from 'electron'
import { createPublicKey, verify } from 'node:crypto'
import { MODULE_KEYS, type LicensePayload, type LicenseStatus, type ModuleKey } from '@shared/types'
import { getSetting, setSetting } from './db'
import { LICENSE_PUBLIC_KEY } from './license-key'

/**
 * Licença do app: texto assinado (Ed25519) pela agência.
 * Formato: DSP1.<payload base64url>.<assinatura base64url>
 * O app só tem a chave PÚBLICA: confere a assinatura sem internet, ninguém consegue gerar ou editar licenças.
 */

const GRACE_DAYS = 7
const FREE_MODULES: ModuleKey[] = ['conversas'] // sem licença: só atendimento, nunca prende os dados do cliente

const b64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

export function parseLicense(key: string, publicKeyPem = LICENSE_PUBLIC_KEY): LicensePayload {
  const parts = key.trim().replace(/\s+/g, '').split('.')
  if (parts.length !== 3 || parts[0] !== 'DSP1') throw new Error('Chave de licença inválida')
  const data = Buffer.from(`${parts[0]}.${parts[1]}`)
  const ok = verify(null, data, createPublicKey(publicKeyPem), b64url(parts[2]))
  if (!ok) throw new Error('Chave de licença inválida (assinatura não confere)')
  const p = JSON.parse(b64url(parts[1]).toString('utf8')) as LicensePayload
  if (p.v !== 1 || !p.id || !p.cliente || !Array.isArray(p.modulos)) throw new Error('Chave de licença inválida')
  p.modulos = p.modulos.filter((m) => (MODULE_KEYS as readonly string[]).includes(m))
  return p
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000
  )
}

/** Situação da licença numa data (função pura para teste). */
export function evaluate(p: LicensePayload | null, now = new Date(), dev = false): LicenseStatus {
  if (dev)
    return {
      state: 'dev',
      payload: p,
      daysLeft: null,
      modules: [...MODULE_KEYS],
      maxAccounts: 50,
      message: 'Versão de desenvolvimento'
    }
  if (!p)
    return {
      state: 'none',
      payload: null,
      daysLeft: null,
      modules: FREE_MODULES,
      maxAccounts: 1,
      message: 'Sem licença: só Conversas. Ative sua licença para liberar os demais módulos.'
    }
  const base = { payload: p, maxAccounts: Math.max(1, p.contas) }
  if (!p.validade)
    return {
      ...base,
      state: 'active',
      daysLeft: null,
      modules: p.modulos,
      message: `Licença de ${p.cliente}, sem vencimento`
    }
  const [y, m, d] = p.validade.split('-').map(Number)
  const left = daysBetween(now, new Date(y, m - 1, d))
  if (left >= 0)
    return {
      ...base,
      state: 'active',
      daysLeft: left,
      modules: p.modulos,
      message: left <= 7 ? `A licença vence em ${left} dia(s)` : `Licença válida até ${d}/${m}/${y}`
    }
  if (left >= -GRACE_DAYS)
    return {
      ...base,
      state: 'grace',
      daysLeft: GRACE_DAYS + left,
      modules: p.modulos,
      message: `Licença vencida. Os módulos continuam liberados por mais ${GRACE_DAYS + left} dia(s).`
    }
  return {
    ...base,
    state: 'expired',
    daysLeft: 0,
    modules: FREE_MODULES,
    maxAccounts: base.maxAccounts,
    message: 'Licença vencida: só Conversas está liberado. Renove para voltar a usar os demais módulos.'
  }
}

let cached: LicenseStatus | null = null
let cachedDay = ''

export function licenseStatus(): LicenseStatus {
  const today = new Date().toDateString()
  if (cached && cachedDay === today) return cached
  const key = getSetting<string | null>('license', null)
  let payload: LicensePayload | null = null
  let invalid = false
  if (key) {
    try {
      payload = parseLicense(key)
    } catch {
      invalid = true
    }
  }
  const st = evaluate(payload, new Date(), !app?.isPackaged)
  cached =
    invalid && st.state !== 'dev'
      ? { ...st, state: 'invalid', message: 'A licença salva é inválida. Ative uma nova chave.' }
      : st
  cachedDay = today
  return cached
}

export function activateLicense(key: string): LicenseStatus {
  parseLicense(key) // lança erro se inválida
  setSetting('license', key.trim().replace(/\s+/g, ''))
  cached = null
  return licenseStatus()
}

export function removeLicense(): LicenseStatus {
  setSetting('license', null)
  cached = null
  return licenseStatus()
}

export function moduleLicensed(m: ModuleKey): boolean {
  return licenseStatus().modules.includes(m)
}
