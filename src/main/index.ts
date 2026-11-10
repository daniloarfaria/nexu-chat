import { PRODUCT_NAME, setupAppMenu } from './identity'
import { licenseEvents, startLicenseRefresh } from './license-online'
import { app, shell, BrowserWindow, session, Notification, ipcMain } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb, closeDb } from './db'
import { initLog, log } from './log'
import { registerIpc, trustedSender } from './ipc'
import { listAccounts } from './accounts'
import { wa } from './wa/manager'
import { refreshWaVersion } from './wa/version'
import { applyPendingRestore, getBackupSettings, isBackupDue, runBackup } from './backup'
import { setupAutoUpdate } from './updater'
import { handleMediaProtocol, registerMediaScheme } from './wa/media'
import { reprocessAdAttribution } from './ads'
import { getChats, reparseUnsupported, storeEvents, unreadTotal } from './wa/store'
import { notificationText } from './wa/sync'
import type { Campaign, EngineState, MessageItem, SyncState } from '@shared/types'
import { engine } from './engine'
import { startAutomation } from './automation'
import { startReminders } from './reminders'
import { startStatus, statusEvents } from './status'
import { groupEvents } from './groups'
import { avatarEvents, setAvatarSocketGetter } from './wa/avatars'
import { shutdownLocalAi } from './ai/local/service'

const APP_ID = 'br.com.disparador.app'
const VERSION_RECHECK_MS = 6 * 60 * 60 * 1000
const BACKUP_CHECK_MS = 30 * 60 * 1000

// Protocolo das mídias precisa ser registrado antes do app ficar pronto
registerMediaScheme()

// App instalado não aceita depuração remota (os fusíveis já bloqueiam o inspetor do Node)
if (app.isPackaged && process.argv.some((a) => /^--(inspect|remote-debugging|js-flags)/.test(a))) app.exit(1)

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
      title: PRODUCT_NAME,
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
        spellcheck: true,
        // App instalado: sem ferramentas de inspeção
        devTools: !app.isPackaged
      }
    })

    mainWindow.on('ready-to-show', () => mainWindow?.show())
    if (app.isPackaged) mainWindow.webContents.on('devtools-opened', () => mainWindow?.webContents.closeDevTools())
    mainWindow.on('closed', () => (mainWindow = null))

    // Links externos só no navegador, e só http(s)
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    const blockNav = (e: { preventDefault: () => void }, url: string): void => {
      const dev = process.env['ELECTRON_RENDERER_URL']
      if (!(dev && !app.isPackaged && url.startsWith(dev))) e.preventDefault()
    }
    mainWindow.webContents.on('will-navigate', (e, url) => blockNav(e, url))
    mainWindow.webContents.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame) e.preventDefault()
    })
    mainWindow.webContents.on('will-redirect', (e, url) => blockNav(e, url))
    mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  // Conversa aberta na tela (para não notificar o que o usuário já está vendo)
  let focusedChat: { accountId: string; jid: string } | null = null
  ipcMain.on('ui:focused-chat', (e, v: unknown) => {
    if (!trustedSender(e)) return
    const o = v as { accountId?: unknown; jid?: unknown } | null
    focusedChat =
      o && typeof o.accountId === 'string' && typeof o.jid === 'string' && o.jid.length < 120 && o.accountId.length < 60
        ? { accountId: o.accountId, jid: o.jid }
        : null
  })

  function notify(accountId: string, m: MessageItem): void {
    if (!Notification.isSupported()) return
    if (Date.now() / 1000 - m.ts > 10 * 60) return // acumuladas com o app fechado: só contam como não lidas
    const win = mainWindow
    const visible = !!win && win.isFocused() && focusedChat?.accountId === accountId && focusedChat.jid === m.chatJid
    if (visible) return
    const chat = getChats(accountId, [m.chatJid])[0]
    if (!chat || chat.muted || chat.archived) return
    const { title, body } = notificationText(m, chat.name)
    const n = new Notification({ title, body: body.slice(0, 200), silent: false })
    n.on('click', () => {
      if (!mainWindow) createWindow()
      mainWindow?.show()
      mainWindow?.focus()
      send('nav:open-chat', { accountId, jid: m.chatJid })
    })
    n.show()
  }

  let badgeTimer: NodeJS.Timeout | null = null
  function updateBadge(): void {
    if (badgeTimer) return
    badgeTimer = setTimeout(() => {
      badgeTimer = null
      const total = listAccounts().reduce((n, a) => n + unreadTotal(a.id), 0)
      app.setBadgeCount(total)
    }, 1000)
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    setupAppMenu()
    startLicenseRefresh()
    app.setAppUserModelId(APP_ID)
    const dataDir = app.getPath('userData')
    initLog(join(dataDir, 'logs'))
    log.info(`Iniciando v${app.getVersion()} em ${process.platform}`)

    const dbPath = join(dataDir, 'dados.sqlite')
    if (applyPendingRestore(dbPath)) log.info('Backup restaurado')
    openDb(dbPath)
    try {
      const n = reparseUnsupported()
      if (n) log.info(`${n} mensagens antigas reprocessadas`)
    } catch (e) {
      log.error('Falha ao reprocessar mensagens', e)
    }
    // Procura anúncios no histórico, em lotes, sem travar a abertura do app
    const scanAds = (): void => {
      try {
        if (!reprocessAdAttribution().done) setTimeout(scanAds, 200)
      } catch (e) {
        log.error('Falha ao reprocessar anúncios', e)
      }
    }
    setTimeout(scanAds, 3000)

    // Nega permissões que o app não usa (câmera, microfone, localização…)
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
      if (permission === 'notifications') return cb(true)
      // Microfone só para gravar mensagem de voz (sem câmera)
      if (permission === 'media') {
        const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
        return cb(types.length > 0 && types.every((t) => t === 'audio'))
      }
      cb(false)
    })

    registerIpc(
      () => mainWindow,
      () => {
        quitting = true
        // app.exit() pula os eventos de saída: para a IA local antes
        void shutdownLocalAi()
          .catch(() => undefined)
          .finally(() => {
            wa.shutdown()
            closeDb()
            app.relaunch()
            app.exit(0)
          })
      }
    )

    wa.on('state', (s) => {
      send('account:state', s)
      if (s.status === 'logged_out' && Notification.isSupported()) {
        new Notification({ title: 'WhatsApp desconectado', body: 'Uma conta precisa ler o QR Code de novo.' }).show()
      }
    })

    // Conversas: repassa mudanças do banco para a interface
    handleMediaProtocol()
    storeEvents.on('chats', ({ accountId, jids }: { accountId: string; jids: string[] }) => {
      for (let i = 0; i < jids.length; i += 200) {
        send('chats:changed', { accountId, chats: getChats(accountId, jids.slice(i, i + 200)) })
      }
      updateBadge()
    })
    storeEvents.on('messages', (p: unknown) => send('messages:changed', p))
    licenseEvents.on('changed', (st: unknown) => send('license:changed', st))
    storeEvents.on('reload', (p: unknown) => send('messages:reload', p))
    storeEvents.on('merged', (p: unknown) => send('chats:merged', p))
    storeEvents.on('sync', (p: SyncState) => send('sync:changed', p))
    storeEvents.on('incoming', ({ accountId, message }: { accountId: string; message: MessageItem }) =>
      notify(accountId, message)
    )

    // Campanhas, automações, lembretes e grupos
    engine.on('state', (st: EngineState) => send('engine:changed', st))
    engine.on('campaign', (c: Campaign) => send('campaign:changed', c))
    groupEvents.on('create-progress', (p: unknown) => send('groups:progress', p))
    startAutomation()
    setAvatarSocketGetter((id) => wa.getSocket(id))
    avatarEvents.on('changed', (p: unknown) => send('avatars:changed', p))

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
    engine.startAll()
    startReminders()
    startStatus()
    statusEvents.on('changed', (p: unknown) => send('status:changed', p))
    // Ao conectar, retoma campanhas paradas por falta de conexão
    wa.on('state', (s) => s.status === 'connected' && engine.kick(s.accountId))

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
        .then(() => shutdownLocalAi())
        .catch(() => undefined)
        .finally(() => {
          wa.shutdown()
          closeDb()
          app.quit()
        })
      return
    }
    // para a IA local e espera o processo sair antes de fechar de vez
    e.preventDefault()
    quitting = true
    void shutdownLocalAi()
      .catch(() => undefined)
      .finally(() => {
        wa.shutdown()
        closeDb()
        app.quit()
      })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
