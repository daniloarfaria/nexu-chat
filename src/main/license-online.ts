import { app } from 'electron'
import { EventEmitter } from 'node:events'
import type { LicenseStatus } from '@shared/types'
import { NEXU_SITE } from '@shared/site'
import { getSetting, setSetting } from './db'
import { activateLicense, invalidateLicenseCache, licenseStatus, removeLicense } from './license'
import { machineHash, machineName } from './machine'
import { sealString, unsealString } from './secure'
import { log } from './log'

/**
 * Licença pela conta do site: e-mail e senha → chave assinada presa a este computador.
 * O app renova a chave ao abrir e a cada 6 h. Sem internet, a última chave vale até a validade dela.
 */

export const licenseEvents = new EventEmitter()
const REFRESH_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 20_000

type Reply = {
  ok: boolean
  key?: string
  session?: string
  code?: string
  error?: string
}

function device(): { id: string; name: string; platform: 'darwin' | 'win32' | 'linux'; appVersion: string } {
  return {
    id: machineHash(),
    name: machineName(),
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
    appVersion: app.getVersion()
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; data: Reply }> {
  const res = await fetch(`${NEXU_SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': `NexuChat/${app.getVersion()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const data = (await res.json().catch(() => ({ ok: false, error: `Servidor respondeu ${res.status}` }))) as Reply
  return { status: res.status, data }
}

function getSession(): string | null {
  const s = getSetting<string | null>('license_session', null)
  if (!s) return null
  try {
    return unsealString(s)
  } catch {
    return null
  }
}

function setSession(raw: string | null): void {
  setSetting('license_session', raw ? sealString(raw) : null)
}

function notice(msg: string | null): void {
  setSetting('license_notice', msg)
}

function changed(): LicenseStatus {
  invalidateLicenseCache()
  const st = licenseStatus()
  licenseEvents.emit('changed', st)
  return st
}

export async function loginOnline(email: string, password: string): Promise<LicenseStatus> {
  let r: { status: number; data: Reply }
  try {
    r = await post('/api/app/login', { email, password, device: device() })
  } catch {
    throw new Error('Sem conexão com o servidor de licenças. Confira a internet e tente de novo.')
  }
  if (!r.data.ok || !r.data.key || !r.data.session) throw new Error(r.data.error ?? 'Não foi possível entrar.')
  activateLicense(r.data.key)
  setSession(r.data.session)
  notice(null)
  log.info('Licença ativada pela conta do site')
  return changed()
}

/** Encerrada no servidor: tira a licença deste computador. */
const END_SESSION = new Set(['sessao_encerrada', 'outro_computador'])
const NO_LICENSE = new Set(['sem_licenca', 'licenca_vencida', 'licenca_encerrada'])

export async function refreshOnline(): Promise<void> {
  const session = getSession()
  if (!session) return
  let r: { status: number; data: Reply }
  try {
    r = await post('/api/app/refresh', { session, device: device() })
  } catch (e) {
    log.warn('Verificação de licença sem conexão', { erro: (e as Error).message })
    return // sem internet: vale a última chave até a validade dela
  }
  if (r.data.ok && r.data.key) {
    try {
      activateLicense(r.data.key)
      notice(null)
    } catch (e) {
      log.warn('Chave recebida inválida', { erro: (e as Error).message })
    }
    changed()
    return
  }
  const code = r.data.code ?? ''
  if (END_SESSION.has(code)) {
    setSession(null)
    removeLicense()
    notice(r.data.error ?? 'Sua sessão foi encerrada. Entre de novo.')
    changed()
  } else if (NO_LICENSE.has(code)) {
    // Mantém a sessão: se o cliente renovar, a próxima verificação libera sozinha
    removeLicense()
    notice(r.data.error ?? 'Sua licença não está ativa.')
    changed()
  }
}

export async function logoutOnline(): Promise<LicenseStatus> {
  const session = getSession()
  if (session) await post('/api/app/logout', { session }).catch(() => undefined)
  setSession(null)
  removeLicense()
  notice(null)
  return changed()
}

let timer: NodeJS.Timeout | null = null
export function startLicenseRefresh(): void {
  setTimeout(() => void refreshOnline(), 5_000)
  if (!timer) timer = setInterval(() => void refreshOnline(), REFRESH_MS)
}
