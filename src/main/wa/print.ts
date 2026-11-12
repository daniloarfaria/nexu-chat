import { app, BrowserWindow, nativeImage } from 'electron'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { WASocket } from 'baileys'
import { printableMediaKind } from '@shared/printing'
import { ensureMedia } from './media'
import { getMessagesByIds } from './store'

export type MediaPrintResult = { success: boolean; canceled: boolean }
const inflight = new Map<string, Promise<MediaPrintResult>>()
const MAX_PRINT_BYTES = 64 * 1024 * 1024

/** Resolve somente arquivo já associado à conta e à mensagem, nunca um path do renderer. */
export function storedPrintPath(accountId: string, file: string): string {
  if (!/^[\da-f-]{36}$/i.test(accountId) || !file || basename(file) !== file || file.includes('\\'))
    throw new Error('Mídia inválida')
  const root = realpathSync(join(app.getPath('userData'), 'media', accountId))
  const path = realpathSync(join(root, file))
  if (dirname(path) !== root) throw new Error('Mídia fora da pasta da conta')
  const stat = statSync(path)
  if (!stat.isFile() || !stat.size || stat.size > MAX_PRINT_BYTES)
    throw new Error('Arquivo vazio ou maior que 64 MB para imprimir')
  return path
}

export function printMessageMedia(
  socket: WASocket | null,
  accountId: string,
  jid: string,
  id: string,
  parent: BrowserWindow | null
): Promise<MediaPrintResult> {
  const key = `${accountId}|${jid}|${id}`
  const existing = inflight.get(key)
  if (existing) return existing
  const promise = (async () => {
    const message = getMessagesByIds(accountId, jid, [id])[0]
    if (!message || message.deleted) throw new Error('Mensagem não encontrada')
    const kind = printableMediaKind(message.media)
    if (!kind) throw new Error('Só é possível imprimir imagens e PDF')
    const media = (await ensureMedia(socket, accountId, jid, id)) as typeof message.media & { file?: string }
    if (!media?.file || printableMediaKind(media) !== kind) throw new Error('Mídia indisponível para impressão')
    const path = storedPrintPath(accountId, media.file)
    const data = readFileSync(path)
    if (kind === 'pdf' && !data.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('O arquivo não é um PDF válido')
    let png: string | null = null
    if (kind === 'image') {
      const image = nativeImage.createFromBuffer(data)
      if (image.isEmpty()) throw new Error('Não foi possível abrir esta imagem para imprimir')
      png = image.toPNG().toString('base64')
    }
    return printWindow(kind, path, png, parent)
  })()
  inflight.set(key, promise)
  void promise.finally(() => inflight.delete(key)).catch(() => undefined)
  return promise
}

async function printWindow(
  kind: 'image' | 'pdf',
  path: string,
  png: string | null,
  parent: BrowserWindow | null
): Promise<MediaPrintResult> {
  const win = new BrowserWindow({
    title: 'Imprimir — Nexu Chat',
    width: 900,
    height: 740,
    show: false,
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      plugins: true,
      partition: `print-${randomUUID()}`
    }
  })
  const session = win.webContents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  const allowedFile = pathToFileURL(path).href
  session.webRequest.onBeforeRequest((details, callback) => {
    const allowed =
      details.url === allowedFile ||
      details.url.startsWith('data:') ||
      details.url.startsWith('blob:') ||
      details.url.startsWith('chrome-extension:') ||
      details.url.startsWith('chrome://resources/') ||
      details.url.startsWith('chrome://theme/')
    callback({ cancel: !allowed })
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  let closed = false
  let closeResolve: ((result: MediaPrintResult) => void) | undefined
  const closedPromise = new Promise<MediaPrintResult>((resolve) => {
    closeResolve = resolve
  })
  win.once('closed', () => {
    closed = true
    closeResolve?.({ success: false, canceled: true })
  })
  const loadTimeout = setTimeout(() => {
    if (!win.isDestroyed()) win.destroy()
  }, 30_000)
  try {
    if (kind === 'pdf') {
      // Electron >=35.6 usa o PrintViewManager do PDF plugin (upstream #47377).
      // Carregar o PDF original mantém páginas, fontes e vetores do documento.
      await win.loadFile(path)
      await waitForPdfViewer(win)
    } else {
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Imprimir imagem</title><style>@page{margin:12mm}html,body{margin:0;background:white}img{display:block;max-width:100%;max-height:95vh;object-fit:contain;margin:auto}</style></head><body><img alt="Imagem para impressão" src="data:image/png;base64,${png}"></body></html>`
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await win.webContents.executeJavaScript('Promise.all(Array.from(document.images, image => image.decode()))')
    }
    clearTimeout(loadTimeout)
    if (closed || win.isDestroyed()) return { success: false, canceled: true }
    win.show()
    const printed = new Promise<MediaPrintResult>((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success) resolve({ success: true, canceled: false })
        else if (/cancel/i.test(reason)) resolve({ success: false, canceled: true })
        else
          reject(
            new Error(
              `Não foi possível imprimir${reason ? `: ${reason}` : '. Verifique a impressora e tente novamente.'}`
            )
          )
      })
    })
    return await Promise.race([printed, closedPromise])
  } finally {
    clearTimeout(loadTimeout)
    if (!win.isDestroyed()) win.destroy()
    session.webRequest.onBeforeRequest(null)
    await session.clearStorageData().catch(() => undefined)
  }
}

/** O carregamento da página termina antes do plugin concluir o documento. */
async function waitForPdfViewer(win: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 15_000
  while (!win.isDestroyed() && Date.now() < deadline) {
    const frame = win.webContents.mainFrame.framesInSubtree.find((item) =>
      item.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')
    )
    if (frame) {
      // Estado do viewer Chromium distribuído com Electron 44; não executar scripts do PDF.
      const state = await frame.executeJavaScript('document.querySelector("pdf-viewer")?.loadState_').catch(() => null)
      if (state === 'success') return
      if (state === 'failed') throw new Error('Não foi possível abrir este PDF para imprimir')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!win.isDestroyed()) throw new Error('O PDF não terminou de carregar. Tente novamente.')
}
