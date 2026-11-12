import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { MODULE_KEYS } from '@shared/types'
import type { ApiChannel, ApiMap } from '@shared/api'
import * as accounts from './accounts'
import * as backup from './backup'
import { getDbPath } from './db'
import { wa } from './wa/manager'
import { getCachedWaVersion, refreshWaVersion } from './wa/version'
import { log } from './log'
import { registerChatIpc } from './ipc-chat'
import { activateLicense, licenseStatus, removeLicense } from './license'
import { loginOnline, logoutOnline, refreshOnline } from './license-online'
import { markNovidadesSeen, pendingNovidades } from './novidades'
import { NEXU_SITE, SITE_PAGES, type SitePage } from '@shared/site'
import { registerBusinessIpc } from './ipc-business'
import { registerStatusIpc } from './ipc-status'
import { registerNotesIpc } from './ipc-notes'
import { registerRobotIpc } from './ipc-robot'
import { registerRecoveryIpc } from './ipc-recuperacao'
import { checkForUpdates, downloadUpdate, getUpdateStatus, installUpdate } from './updater'

export type Handle = <C extends ApiChannel>(channel: C, schema: z.ZodTypeAny | null, fn: Handler<C>) => void

type Handler<C extends ApiChannel> = (...args: ApiMap[C]['args']) => Promise<ApiMap[C]['ret']> | ApiMap[C]['ret']

// Só aceita chamadas da nossa própria janela (arquivo local ou servidor de dev)
// Só a janela principal do app, e só a página do próprio app (nada de outros arquivos locais ou iframes)
export function trustedSender(e: { senderFrame: Electron.WebFrameMain | null }): boolean {
  const frame = e.senderFrame
  if (!frame || frame.parent) return false
  const url = frame.url.split('#')[0].split('?')[0]
  if (url === pathToFileURL(join(__dirname, '../renderer/index.html')).href) return true
  const dev = process.env['ELECTRON_RENDERER_URL']
  return !!dev && !app.isPackaged && url.startsWith(dev)
}

function handle<C extends ApiChannel>(channel: C, schema: z.ZodTypeAny | null, fn: Handler<C>): void {
  ipcMain.handle(channel, async (e, ...raw: unknown[]) => {
    if (!trustedSender(e)) return { ok: false, error: 'Origem não autorizada' }
    try {
      const args = schema ? [schema.parse(raw[0])] : []
      const data = await (fn as (...a: unknown[]) => unknown)(...args)
      return { ok: true, data }
    } catch (err) {
      const msg =
        err instanceof z.ZodError
          ? 'Dados inválidos: ' + err.issues.map((i) => i.message).join(', ')
          : (err as Error).message
      log.warn(`Erro em ${channel}`, { erro: msg })
      return { ok: false, error: msg }
    }
  })
}

const id = z.string().uuid()
const name = z.string().trim().min(1, 'Informe um nome').max(60)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const modulesSchema = z.object(Object.fromEntries(MODULE_KEYS.map((k) => [k, z.boolean().optional()]))).strict()

export function registerIpc(getWindow: () => BrowserWindow | null, relaunch: () => void): void {
  handle('app:info', null, () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataPath: app.getPath('userData')
  }))
  handle('app:open-data-folder', null, async () => {
    await shell.openPath(app.getPath('userData'))
  })

  handle('update:status', null, () => getUpdateStatus())
  handle('update:check', null, () => checkForUpdates())
  handle('update:download', null, () => downloadUpdate())
  handle('update:install', null, () => installUpdate())

  handle('license:status', null, () => licenseStatus())
  handle('license:activate', z.object({ key: z.string().min(20).max(4000) }).strict(), (a) => activateLicense(a.key))
  handle('license:remove', null, () => removeLicense())
  handle(
    'license:login',
    z
      .object({
        email: z.string().trim().email().max(200),
        password: z.string().min(1).max(200),
        licenseId: z.string().min(1).max(80).optional()
      })
      .strict(),
    (a) => loginOnline(a.email.toLowerCase(), a.password, a.licenseId)
  )
  handle('license:logout', null, () => logoutOnline())
  handle('license:refresh', null, async () => {
    await refreshOnline()
    return licenseStatus()
  })
  handle(
    'app:open-site',
    z.object({ page: z.enum(Object.keys(SITE_PAGES) as [SitePage, ...SitePage[]]) }).strict(),
    async (a) => {
      await shell.openExternal(`${NEXU_SITE}${SITE_PAGES[a.page]}`)
    }
  )
  handle('novidades:pendentes', null, () => pendingNovidades())
  handle('novidades:vistas', null, () => markNovidadesSeen())

  handle('wa:version', null, () => getCachedWaVersion())
  handle('wa:refresh-version', null, () => refreshWaVersion())

  handle('accounts:list', null, () => accounts.listAccounts())
  handle('accounts:states', null, () => wa.allStates())
  handle('accounts:create', z.object({ name, color }).strict(), (a) => accounts.createAccount(a.name, a.color))
  handle(
    'accounts:update',
    z
      .object({
        id,
        name: name.optional(),
        color: color.optional(),
        modules: modulesSchema.optional(),
        autoConnect: z.boolean().optional()
      })
      .strict(),
    (a) => accounts.updateAccount(a.id, a)
  )
  handle('accounts:delete', z.object({ id }).strict(), async (a) => {
    await wa.logout(a.id)
    wa.remove(a.id)
    accounts.deleteAccount(a.id)
  })
  handle(
    'accounts:connect',
    z
      .object({
        id,
        pairingPhone: z
          .string()
          .regex(/^\+?[\d\s()-]{10,20}$/, 'Telefone inválido')
          .optional()
      })
      .strict(),
    async (a) => {
      if (!accounts.getAccount(a.id)) throw new Error('Conta não encontrada')
      await wa.connect(a.id, { pairingPhone: a.pairingPhone })
    }
  )
  handle('accounts:disconnect', z.object({ id }).strict(), (a) => wa.disconnect(a.id))
  handle('accounts:logout', z.object({ id }).strict(), (a) => wa.logout(a.id))

  registerChatIpc(handle, getWindow)
  registerBusinessIpc(handle, getWindow)
  registerStatusIpc(handle)
  registerNotesIpc(handle)
  registerRobotIpc(handle)
  registerRecoveryIpc(handle)

  handle('backup:get', null, () => backup.getBackupSettings())
  handle(
    'backup:update',
    z
      .object({
        frequency: z.enum(['off', 'daily', 'weekly', 'on_close']).optional(),
        keep: z.number().int().min(1).max(365).optional()
      })
      .strict(),
    (a) => backup.updateBackupSettings(a)
  )
  handle('backup:choose-folder', null, async () => {
    const win = getWindow()
    const r = await (win
      ? dialog.showOpenDialog(win, { title: 'Pasta de backup', properties: ['openDirectory', 'createDirectory'] })
      : dialog.showOpenDialog({ title: 'Pasta de backup', properties: ['openDirectory', 'createDirectory'] }))
    if (!r.canceled && r.filePaths[0]) return backup.updateBackupSettings({ folder: r.filePaths[0] })
    return backup.getBackupSettings()
  })
  handle(
    'backup:set-password',
    z.object({ password: z.string().min(8, 'Mínimo de 8 caracteres').max(200) }).strict(),
    (a) => {
      backup.setBackupPassword(a.password)
      return backup.getBackupSettings()
    }
  )
  handle('backup:run', null, () => backup.runBackup())
  handle('backup:list', null, () => backup.listBackups())
  handle(
    'backup:restore',
    z
      .object({
        name: z
          .string()
          .regex(/^backup-[\w-]+\.dspbak$/)
          .optional(),
        password: z.string().min(1).max(200)
      })
      .strict(),
    async (a) => {
      let file: string | undefined
      if (a.name) {
        const folder = backup.getBackupSettings().folder
        if (!folder) throw new Error('Pasta de backup não configurada')
        file = join(folder, a.name)
      } else {
        const win = getWindow()
        const opts = {
          title: 'Escolha o backup',
          properties: ['openFile' as const],
          filters: [{ name: 'Backup', extensions: ['dspbak'] }]
        }
        const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
        if (r.canceled || !r.filePaths[0]) throw new Error('Nenhum arquivo escolhido')
        file = r.filePaths[0]
      }
      await backup.prepareRestore(file, a.password, getDbPath())
      log.info('Restauração preparada; reiniciando o app')
      setTimeout(relaunch, 300)
    }
  )
}
