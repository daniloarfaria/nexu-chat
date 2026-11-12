import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { z } from 'zod'
import type { LicenseLoginResult, LicenseStatus } from '@shared/types'
import { NEXU_SITE } from '@shared/site'
import { getSetting, setSetting } from './db'
import { activateLicense, invalidateLicenseCache, licenseStatus, parseLicense, removeLicense } from './license'
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

const replySchema = z.object({
  ok: z.boolean(),
  key: z.string().min(1).max(8000).optional(),
  session: z.string().min(1).max(8192).optional(),
  code: z.string().max(100).optional(),
  error: z.string().max(1000).optional(),
  selectionRequired: z.boolean().optional(),
  licenses: z.unknown().optional()
})
type Reply = z.infer<typeof replySchema>

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
    redirect: 'error',
    headers: { 'content-type': 'application/json', 'user-agent': `NexuChat/${app.getVersion()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const data = await res.json().catch(() => ({ ok: false, error: `Servidor respondeu ${res.status}` }))
  const parsed = replySchema.safeParse(data)
  return {
    status: res.status,
    data: parsed.success
      ? parsed.data
      : { ok: false, error: 'O servidor de licenças respondeu dados inválidos. Tente novamente.' }
  }
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
  if (!raw) setSetting('license_online_id', null)
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

const selectionSchema = z.object({
  selectionRequired: z.literal(true),
  licenses: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        plano: z.enum(['basico', 'marketing', 'completo']),
        contas: z.number().int().min(1).max(50),
        teste: z.boolean(),
        fim: z.string().max(80).nullable(),
        status: z.string().min(1).max(40)
      })
    )
    .min(2)
    .max(200)
})
let loginPending = false
let sessionEpoch = 0

export async function loginOnline(email: string, password: string, licenseId?: string): Promise<LicenseLoginResult> {
  if (loginPending) throw new Error('Já há um login em andamento. Aguarde a conclusão.')
  loginPending = true
  const epoch = ++sessionEpoch
  try {
    let r: { status: number; data: Reply }
    try {
      r = await post('/api/app/login', { email, password, device: device(), ...(licenseId ? { licenseId } : {}) })
    } catch {
      throw new Error('Sem conexão com o servidor de licenças. Confira a internet e tente de novo.')
    }
    if (epoch !== sessionEpoch) throw new Error('Operação cancelada. Entre novamente.')
    if (!r.data.ok) throw new Error(r.data.error ?? 'Não foi possível entrar.')
    if (r.data.selectionRequired) {
      const result = selectionSchema.safeParse(r.data)
      if (!result.success || licenseId)
        throw new Error('Não foi possível confirmar as licenças disponíveis. Entre novamente.')
      return result.data // Nenhuma sessão, senha ou escolha é persistida nesta etapa.
    }
    if (!r.data.key || !r.data.session) throw new Error('Não foi possível entrar.')
    const payload = parseLicense(r.data.key)
    if (licenseId && payload.id !== licenseId)
      throw new Error('A resposta não corresponde à licença escolhida. Tente novamente.')
    activateLicense(r.data.key)
    setSession(r.data.session)
    setSetting('license_online_id', payload.id)
    notice(null)
    log.info('Licença ativada pela conta do site')
    return changed()
  } finally {
    loginPending = false
  }
}

/** Encerrada no servidor: tira a licença deste computador. */
const END_SESSION = new Set(['sessao_encerrada', 'outro_computador', 'selecionar_licenca'])
const NO_LICENSE = new Set(['sem_licenca', 'licenca_vencida', 'licenca_encerrada', 'licenca_indisponivel'])

export async function refreshOnline(): Promise<void> {
  const session = getSession()
  if (!session || loginPending) return
  const epoch = sessionEpoch
  const currentId = getSetting<string | null>('license_online_id', null) ?? licenseStatus().payload?.id
  let r: { status: number; data: Reply }
  try {
    r = await post('/api/app/refresh', { session, device: device() })
  } catch (e) {
    log.warn('Verificação de licença sem conexão', { erro: (e as Error).message })
    return // sem internet: vale a última chave até a validade dela
  }
  if (epoch !== sessionEpoch || getSession() !== session) return
  if (r.data.ok && r.data.key) {
    try {
      if (currentId && parseLicense(r.data.key).id !== currentId)
        throw new Error('A renovação não corresponde à licença deste computador.')
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
  ++sessionEpoch
  const session = getSession()
  // Invalida localmente antes da rede: uma resposta lenta do logout não apaga um login novo.
  setSession(null)
  removeLicense()
  notice(null)
  changed()
  if (session) await post('/api/app/logout', { session }).catch(() => undefined)
  return licenseStatus()
}

let timer: NodeJS.Timeout | null = null
export function startLicenseRefresh(): void {
  setTimeout(() => void refreshOnline(), 5_000)
  if (!timer) timer = setInterval(() => void refreshOnline(), REFRESH_MS)
}
