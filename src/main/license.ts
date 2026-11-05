import { app } from 'electron'
import { createPublicKey, verify } from 'node:crypto'
import { MODULE_KEYS, PLANS, type LicensePayload, type LicenseStatus, type ModuleKey, type PlanId } from '@shared/types'
import { getSetting, setSetting } from './db'
import { LICENSE_PUBLIC_KEY } from './license-key'
import { machineHash } from './machine'

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
  // Módulos novos entram nos planos sem precisar emitir outra chave
  const doPlano = PLANS[p.plano as PlanId]?.modulos ?? []
  p.modulos = [...new Set([...p.modulos, ...doPlano])].filter((m) => (MODULE_KEYS as readonly string[]).includes(m))
  return p
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000
  )
}

/** Situação da licença numa data (função pura para teste). `machine` = hash deste computador. */
export function evaluate(p: LicensePayload | null, now = new Date(), dev = false, machine?: string): LicenseStatus {
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
  // Chave emitida para outro computador (cópia da pasta de dados ou da chave)
  if (p.dispositivo && machine && p.dispositivo !== machine)
    return {
      state: 'invalid',
      payload: p,
      daysLeft: null,
      modules: FREE_MODULES,
      maxAccounts: 1,
      message: 'Esta licença foi ativada em outro computador. Entre com seu e-mail e senha para usar neste.'
    }
  const base = { payload: p, maxAccounts: Math.max(1, p.contas) }
  // Fim real das chaves online (a validade é só a janela até a próxima verificação)
  const fimTxt = p.fim ? p.fim.split('-').reverse().join('/') : null
  const grace = p.online && p.fim && p.validade && p.validade >= p.fim ? 0 : GRACE_DAYS
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
      message: p.online
        ? p.teste
          ? `Teste grátis até ${fimTxt ?? `${d}/${m}/${y}`}`
          : fimTxt
            ? `Licença válida até ${fimTxt}`
            : 'Licença vitalícia'
        : left <= 7
          ? `A licença vence em ${left} dia(s)`
          : `Licença válida até ${d}/${m}/${y}`
    }
  if (left >= -grace && grace > 0)
    return {
      ...base,
      state: 'grace',
      daysLeft: grace + left,
      modules: p.modulos,
      message: p.online
        ? `Não conseguimos confirmar sua licença pela internet. Os módulos continuam liberados por mais ${grace + left} dia(s).`
        : `Licença vencida. Os módulos continuam liberados por mais ${grace + left} dia(s).`
    }
  return {
    ...base,
    state: 'expired',
    daysLeft: 0,
    modules: FREE_MODULES,
    maxAccounts: base.maxAccounts,
    message: p.teste
      ? 'Seu teste grátis terminou: só Conversas está liberado. Escolha um plano para continuar.'
      : 'Licença vencida: só Conversas está liberado. Renove para voltar a usar os demais módulos.'
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
  // Relógio voltado para trás não estende a licença: usa o maior horário já visto
  const seen = getSetting<number>('license_clock', 0)
  const nowMs = Math.max(Date.now(), seen)
  if (Date.now() > seen) setSetting('license_clock', Date.now())
  const st = evaluate(payload, new Date(nowMs), !app?.isPackaged, machineHash())
  const session = getSetting<string | null>('license_session', null)
  const extra = {
    online: session && payload?.email ? { email: payload.email } : null,
    notice: getSetting<string | null>('license_notice', null)
  }
  cached =
    invalid && st.state !== 'dev'
      ? { ...st, ...extra, state: 'invalid', message: 'A licença salva é inválida. Ative uma nova chave.' }
      : { ...st, ...extra }
  cachedDay = today
  return cached
}

export function activateLicense(key: string): LicenseStatus {
  const p = parseLicense(key) // lança erro se inválida
  if (p.dispositivo && p.dispositivo !== machineHash())
    throw new Error('Esta chave foi emitida para outro computador. Entre com seu e-mail e senha.')
  setSetting('license', key.trim().replace(/\s+/g, ''))
  cached = null
  return licenseStatus()
}

/** Limpa o cache depois de mudanças vindas da verificação online. */
export function invalidateLicenseCache(): void {
  cached = null
}

export function removeLicense(): LicenseStatus {
  setSetting('license', null)
  cached = null
  return licenseStatus()
}

export function moduleLicensed(m: ModuleKey): boolean {
  return licenseStatus().modules.includes(m)
}
