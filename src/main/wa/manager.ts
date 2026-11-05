import { EventEmitter } from 'node:events'
import { makeWASocket, Browsers, DisconnectReason, makeCacheableSignalKeyStore, type WASocket } from 'baileys'
import QRCode from 'qrcode'
import type { AccountState } from '@shared/types'
import { sqliteAuthState } from './auth-store'
import { refreshWaVersion, versionForSocket } from './version'
import { log } from '../log'
import { getDb } from '../db'
import { attachStore } from './sync'
import { findRawById, resetAccountData } from './store'
import { deleteAccountMedia } from './media'

interface Session {
  sock: WASocket | null
  state: AccountState
  retries: number
  timer: NodeJS.Timeout | null
  stopped: boolean
  pairingPhone?: string
  wasConnected: boolean
  gen: number
}

const MAX_BACKOFF_MS = 60_000

/**
 * Mantém uma conexão Baileys por conta, com reconexão automática.
 * Eventos: 'state' (AccountState).
 */
class WhatsAppManager extends EventEmitter {
  private sessions = new Map<string, Session>()

  getState(accountId: string): AccountState {
    return this.sessions.get(accountId)?.state ?? { accountId, status: 'disconnected' }
  }

  getSocket(accountId: string): WASocket | null {
    const s = this.sessions.get(accountId)
    return s?.state.status === 'connected' ? s.sock : null
  }

  allStates(): AccountState[] {
    return [...this.sessions.values()].map((s) => s.state)
  }

  private setState(s: Session, patch: Partial<AccountState>): void {
    s.state = { ...s.state, ...patch }
    if (patch.status && patch.status !== 'qr') {
      delete s.state.qr
      delete s.state.pairingCode
    }
    this.emit('state', s.state)
  }

  async connect(accountId: string, opts: { pairingPhone?: string } = {}): Promise<void> {
    let s = this.sessions.get(accountId)
    if (s && (s.state.status === 'connected' || s.state.status === 'connecting' || s.state.status === 'qr') && s.sock) {
      if (!opts.pairingPhone) return
      this.teardown(s) // reinicia para pedir código de pareamento
    }
    if (!s) {
      s = {
        sock: null,
        state: { accountId, status: 'disconnected' },
        retries: 0,
        timer: null,
        stopped: false,
        wasConnected: false,
        gen: 0
      }
      this.sessions.set(accountId, s)
    }
    // Cancela uma reconexão agendada para não abrir duas conexões ao mesmo tempo
    if (s.timer) {
      clearTimeout(s.timer)
      s.timer = null
    }
    if (s.sock) this.teardown(s)
    s.stopped = false
    s.pairingPhone = opts.pairingPhone?.replace(/\D/g, '') || undefined
    await this.start(accountId, s)
  }

  private async start(accountId: string, s: Session): Promise<void> {
    if (s.stopped) return
    const gen = ++s.gen // conexões antigas reconhecem que foram substituídas
    this.setState(s, { status: 'connecting', error: undefined })

    const { state, saveCreds, clear } = sqliteAuthState(accountId)
    const logger = log.baileys()
    const version = versionForSocket()
    const sock = makeWASocket({
      ...(version ? { version } : {}), // undefined sobrescreveria o padrão do Baileys
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      // 'Windows Desktop' (WIN_HYBRID, ver patches/) é a identidade aceita hoje para pedir histórico completo.
      // macOS Desktop (DARWIN) é recusado pelo servidor com 428 antes do QR (Baileys #2880).
      browser: Browsers.windows('Desktop'),
      markOnlineOnConnect: false, // mantém as notificações no celular
      syncFullHistory: true, // histórico completo na primeira vinculação
      shouldSyncHistoryMessage: () => true, // o padrão do Baileys descarta o histórico FULL
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => (key.id ? findRawById(accountId, key.remoteJid, key.id) : undefined)
    })
    s.sock = sock
    let pairingRequested = false
    let qrShown = false

    // Credenciais só do socket atual (um antigo não regrava depois de sair/excluir)
    sock.ev.on('creds.update', () => {
      if (s.sock === sock) saveCreds()
    })
    attachStore(accountId, sock)

    sock.ev.on('connection.update', async (u) => {
      if (s.sock !== sock) return // socket antigo
      const { connection, lastDisconnect, qr } = u

      if (qr) {
        qrShown = true
        if (s.pairingPhone && !state.creds.registered) {
          if (!pairingRequested) {
            pairingRequested = true
            try {
              const code = await sock.requestPairingCode(s.pairingPhone)
              this.setState(s, { status: 'qr', pairingCode: code })
            } catch (e) {
              this.setState(s, { status: 'qr', error: 'Não foi possível gerar o código: ' + (e as Error).message })
            }
          }
        } else {
          const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
          this.setState(s, { status: 'qr', qr: dataUrl })
        }
      }

      if (connection === 'open') {
        s.retries = 0
        s.wasConnected = true
        const phone = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null
        if (phone) getDb().prepare('UPDATE accounts SET phone = ? WHERE id = ?').run(phone, accountId)
        this.setState(s, { status: 'connected', phone, error: undefined })
        log.info(`Conta ${accountId} conectada`)
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
        log.warn(`Conta ${accountId} desconectada`, { code })
        s.sock = null

        if (s.stopped) {
          this.setState(s, { status: 'disconnected' })
          return
        }
        if (code === DisconnectReason.loggedOut) {
          clear()
          getDb().prepare('UPDATE accounts SET phone = NULL WHERE id = ?').run(accountId)
          this.setState(s, { status: 'logged_out', phone: null, error: 'O WhatsApp foi desconectado no celular.' })
          return
        }
        if (code === DisconnectReason.connectionReplaced) {
          this.setState(s, {
            status: 'disconnected',
            error: 'Esta conta foi aberta em outro lugar. Clique em Conectar para retomar aqui.'
          })
          return
        }
        if (code === DisconnectReason.forbidden) {
          this.setState(s, {
            status: 'disconnected',
            error: 'O WhatsApp recusou a conexão (conta restrita ou banida).'
          })
          return
        }
        if (qrShown && !state.creds.registered && code !== DisconnectReason.restartRequired) {
          // QR/código expirou sem ser lido: não fica tentando para sempre
          this.setState(s, { status: 'disconnected', error: 'O QR Code expirou. Clique em Conectar para gerar outro.' })
          return
        }
        if (code === 405) {
          // versão recusada: busca a mais recente antes de tentar de novo
          await refreshWaVersion()
          if (s.gen !== gen || s.sock || s.stopped) return // outra conexão começou enquanto esperava
        }
        const delay =
          code === DisconnectReason.restartRequired ? 0 : Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.min(s.retries, 5))
        s.retries++
        this.setState(s, {
          status: 'connecting',
          error: delay ? `Reconectando em ${Math.round(delay / 1000)}s…` : undefined
        })
        if (s.timer) clearTimeout(s.timer)
        s.timer = setTimeout(() => {
          s.timer = null
          if (s.gen !== gen || s.sock) return
          void this.start(accountId, s)
        }, delay)
      }
    })
  }

  private teardown(s: Session): void {
    if (s.timer) clearTimeout(s.timer)
    s.timer = null
    const sock = s.sock
    s.sock = null
    try {
      ;(sock?.ev as unknown as { removeAllListeners(): void } | undefined)?.removeAllListeners()
      sock?.end(undefined)
    } catch {
      /* ignora */
    }
  }

  disconnect(accountId: string): void {
    const s = this.sessions.get(accountId)
    if (!s) return
    s.stopped = true
    this.teardown(s)
    this.setState(s, { status: 'disconnected', error: undefined })
  }

  /** Desconecta o aparelho no WhatsApp e apaga a sessão local. */
  async logout(accountId: string): Promise<void> {
    const s = this.sessions.get(accountId)
    if (s?.sock) {
      s.stopped = true
      try {
        await s.sock.logout()
      } catch {
        /* sem conexão: apaga localmente mesmo assim */
      }
    }
    if (s) this.teardown(s)
    sqliteAuthState(accountId).clear()
    getDb().prepare('UPDATE accounts SET phone = NULL WHERE id = ?').run(accountId)
    if (s) this.setState(s, { status: 'logged_out', phone: null, error: undefined })
  }

  remove(accountId: string): void {
    this.disconnect(accountId)
    this.sessions.delete(accountId)
    resetAccountData(accountId)
    deleteAccountMedia(accountId)
  }

  shutdown(): void {
    for (const id of this.sessions.keys()) this.disconnect(id)
  }
}

export const wa = new WhatsAppManager()
