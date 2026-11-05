import { app, shell, BrowserWindow, session, Notification } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb, closeDb } from './db'
import { initLog, log } from './log'
import { registerIpc } from './ipc'
import { listAccounts } from './accounts'
import { wa } from './wa/manager'
import { refreshWaVersion } from './wa/version'
import { applyPendingRestore, getBackupSettings, isBackupDue, runBackup } from './backup'
import { setupAutoUpdate } from './updater'

const APP_ID = 'br.com.disparador.app'
const VERSION_RECHECK_MS = 6 * 60 * 60 * 1000
const BACKUP_CHECK_MS = 30 * 60 * 1000

// Só uma instância: duas conectando a mesma conta derrubariam uma à outra
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let quitting = false

  const send = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  }

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 980,
      minHeight: 640,
      show: false,
      title: 'Disparador',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      backgroundColor: '#0b0d10',
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true
      }
    })

    mainWindow.on('ready-to-show', () => mainWindow?.show())
    mainWindow.on('closed', () => (mainWindow = null))

    // Links externos só no navegador, e só http(s)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    mainWindow.webContents.on('will-navigate', (e, url) => {
      const dev = process.env['ELECTRON_RENDERER_URL']
      if (!(dev && url.startsWith(dev))) e.preventDefault()
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID)
    const dataDir = app.getPath('userData')
    initLog(join(dataDir, 'logs'))
    log.info(`Iniciando v${app.getVersion()} em ${process.platform}`)

    const dbPath = join(dataDir, 'dados.sqlite')
    if (applyPendingRestore(dbPath)) log.info('Backup restaurado')
    openDb(dbPath)

    // Nega permissões que o app não usa (câmera, microfone, localização…)
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'notifications'))

    registerIpc(
      () => mainWindow,
      () => {
        quitting = true
        wa.shutdown()
        closeDb()
        app.relaunch()
        app.exit(0)
      }
    )

    wa.on('state', (s) => {
      send('account:state', s)
      if (s.status === 'logged_out' && Notification.isSupported()) {
        new Notification({ title: 'WhatsApp desconectado', body: 'Uma conta precisa ler o QR Code de novo.' }).show()
      }
    })

    createWindow()

    // Atualizações do app: verifica ao abrir e avisa a interface
    setupAutoUpdate((st) => send('update:changed', st), !is.dev)

    // Versão do WhatsApp sempre atualizada antes de conectar
    const v = await refreshWaVersion()
    send('wa:version', v)
    setInterval(() => void refreshWaVersion().then((nv) => send('wa:version', nv)), VERSION_RECHECK_MS)

    for (const acc of listAccounts()) {
      if (acc.autoConnect) void wa.connect(acc.id).catch((e) => log.error('Falha ao conectar conta', e))
    }

    // Backup automático
    const checkBackup = (): void => {
      if (isBackupDue(getBackupSettings())) {
        runBackup()
          .then(() => send('backup:done', getBackupSettings()))
          .catch(() => send('backup:done', getBackupSettings()))
      }
    }
    setTimeout(checkBackup, 60_000)
    setInterval(checkBackup, BACKUP_CHECK_MS)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', (e) => {
    if (quitting) return
    const s = getBackupSettings()
    if (s.frequency === 'on_close' && s.folder && s.passwordSet) {
      e.preventDefault()
      quitting = true
      runBackup()
        .catch(() => undefined)
        .finally(() => {
          wa.shutdown()
          closeDb()
          app.quit()
        })
      return
    }
    quitting = true
    wa.shutdown()
    closeDb()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
