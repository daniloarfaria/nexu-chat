import { app, shell } from 'electron'
import updater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { log } from './log'

// Atualização do próprio app via GitHub Releases (repositório público só com os instaladores).
// Verifica ao abrir e a cada 6 h; o usuário decide quando baixar.
// No Mac sem assinatura da Apple a troca automática não é permitida pelo sistema,
// então o botão abre a página de download do novo .dmg.

const RELEASES_URL = 'https://github.com/daniloarfaria/disparador-releases/releases/latest'
const MAC_SIGNED = false

let status: UpdateStatus = { state: 'idle', currentVersion: '' }
let emit: (s: UpdateStatus) => void = () => undefined

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  emit(status)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function setupAutoUpdate(onStatus: (s: UpdateStatus) => void, enabled: boolean): void {
  emit = onStatus
  status = { state: 'idle', currentVersion: app.getVersion() }
  if (!enabled) return

  const { autoUpdater } = updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (i) =>
    set({
      state: 'available',
      checkedAt: Date.now(),
      version: i.version,
      releaseDate: i.releaseDate,
      notes: typeof i.releaseNotes === 'string' ? stripHtml(i.releaseNotes) : undefined
    })
  )
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => set({ state: 'ready', percent: 100 }))
  autoUpdater.on('error', (e) => {
    log.warn('Falha na atualização do app', { erro: e.message })
    set({ state: 'error', error: 'Não foi possível verificar atualizações agora.' })
  })

  void checkForUpdates()
  setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    set({ state: 'none', checkedAt: Date.now() })
    return status
  }
  try {
    await updater.autoUpdater.checkForUpdates()
  } catch {
    /* tratado no evento 'error' */
  }
  return status
}

export async function downloadUpdate(): Promise<void> {
  if (status.state !== 'available') return
  if (process.platform === 'darwin' && !MAC_SIGNED) {
    await shell.openExternal(RELEASES_URL)
    return
  }
  set({ state: 'downloading', percent: 0 })
  await updater.autoUpdater.downloadUpdate()
}

export function installUpdate(): void {
  if (status.state === 'ready') updater.autoUpdater.quitAndInstall(false, true)
}

function stripHtml(s: string): string {
  return s
    .replace(/<li>/g, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000)
}
