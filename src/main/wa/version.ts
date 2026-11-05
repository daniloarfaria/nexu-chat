import { fetchLatestWaWebVersion } from 'baileys'
import type { WaVersionInfo } from '@shared/types'
import { getSetting, setSetting } from '../db'
import { log } from '../log'

// Fonte usada pelo site wppconnect.io/pt-BR/whatsapp-versions
export const WPPCONNECT_URL = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json'
const SETTING_KEY = 'waVersion'

import { parseWaVersion, type V } from './version-parse'

export { parseWaVersion }

async function fromWppconnect(): Promise<V | null> {
  const res = await fetch(WPPCONNECT_URL, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { currentVersion?: unknown }
  return parseWaVersion(json.currentVersion)
}

async function fromWhatsAppWeb(): Promise<V | null> {
  const r = await fetchLatestWaWebVersion({ signal: AbortSignal.timeout(8000) } as RequestInit)
  return r.isLatest ? (r.version as V) : null
}

let current: WaVersionInfo | null = null

export function getCachedWaVersion(): WaVersionInfo | null {
  return current ?? getSetting<WaVersionInfo | null>(SETTING_KEY, null)
}

/**
 * Busca a versão mais recente do WhatsApp Web.
 * Ordem: WPPConnect → WhatsApp Web (sw.js) → última que funcionou → padrão do Baileys.
 */
export async function refreshWaVersion(): Promise<WaVersionInfo> {
  const attempts: Array<[WaVersionInfo['source'], () => Promise<V | null>]> = [
    ['wppconnect', fromWppconnect],
    ['whatsapp-web', fromWhatsAppWeb]
  ]
  for (const [source, fn] of attempts) {
    try {
      const v = await fn()
      if (v) {
        current = { version: v, source, checkedAt: Date.now() }
        setSetting(SETTING_KEY, current)
        log.info(`Versão do WhatsApp Web: ${v.join('.')} (fonte: ${source})`)
        return current
      }
    } catch (e) {
      log.warn(`Falha ao buscar versão em ${source}`, { erro: (e as Error).message })
    }
  }
  const cached = getSetting<WaVersionInfo | null>(SETTING_KEY, null)
  if (cached) {
    current = { ...cached, source: 'cache' }
    return current
  }
  current = { version: [2, 3000, 0], source: 'padrao', checkedAt: Date.now() }
  return current
}

/** Versão a usar na conexão; `undefined` deixa o Baileys usar a própria versão padrão. */
export function versionForSocket(): V | undefined {
  const c = getCachedWaVersion()
  return c && c.source !== 'padrao' ? c.version : undefined
}
