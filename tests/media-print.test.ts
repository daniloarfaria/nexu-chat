import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const h = vi.hoisted(() => ({
  root: '',
  windows: [] as unknown[],
  message: null as unknown,
  media: null as unknown,
  ensure: vi.fn(),
  print: vi.fn(),
  load: vi.fn(),
  options: null as unknown,
  imageEmpty: false,
  pdfState: 'success'
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWindow extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {
        framesInSubtree: [
          {
            url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html',
            executeJavaScript: vi.fn(async () => h.pdfState)
          }
        ]
      },
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
        clearStorageData: vi.fn().mockResolvedValue(undefined)
      },
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      print: h.print
    })
    constructor(options: unknown) {
      super()
      h.options = options
      h.windows.push(this)
    }
    loadFile = vi.fn(async (path: string) => h.load(path))
    loadURL = vi.fn(async (url: string) => h.load(url))
    show = vi.fn()
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      this.destroyed = true
      this.emit('closed')
    }
  }
  return {
    app: { getPath: () => h.root },
    BrowserWindow: FakeWindow,
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => h.imageEmpty, toPNG: () => Buffer.from('clean-png') }) }
  }
})
vi.mock('../src/main/wa/media', () => ({ ensureMedia: h.ensure }))
vi.mock('../src/main/wa/store', () => ({
  getMessagesByIds: (accountId: string, jid: string, ids: string[]) =>
    accountId === ACC && jid === JID && ids[0] === 'm1' && h.message ? [h.message] : []
}))
import { printMessageMedia, storedPrintPath } from '../src/main/wa/print'
import { printableMediaKind } from '../src/shared/printing'
const ACC = '99999999-9999-4999-8999-999999999999'
const JID = '5511987654321@s.whatsapp.net'
beforeEach(() => {
  h.root = mkdtempSync(join(tmpdir(), 'nexu-print-'))
  mkdirSync(join(h.root, 'media', ACC), { recursive: true })
  h.windows = []
  h.imageEmpty = false
  h.pdfState = 'success'
  h.options = null
  h.media = { file: 'image.png', mimetype: 'image/png' }
  h.message = { deleted: false, media: h.media }
  writeFileSync(join(h.root, 'media', ACC, 'image.png'), 'image-bytes')
  h.ensure.mockReset().mockImplementation(async () => h.media)
  h.print.mockReset().mockImplementation((_options, callback) => callback(true, ''))
  h.load.mockReset().mockResolvedValue(undefined)
})
afterEach(() => rmSync(h.root, { recursive: true, force: true }))
const run = (): ReturnType<typeof printMessageMedia> => printMessageMedia(null, ACC, JID, 'm1', null)
test.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])('permite %s', (mime) =>
  expect(printableMediaKind({ mimetype: mime })).not.toBeNull()
)
test.each(['image/svg+xml', 'text/html', 'audio/ogg', 'video/mp4', 'application/msword'])('recusa %s', (mime) =>
  expect(printableMediaKind({ mimetype: mime })).toBeNull()
)
test('recusa visualização única e PDF falsamente nomeado como HTML', () => {
  expect(printableMediaKind({ mimetype: 'image/png', viewOnce: true })).toBeNull()
  expect(printableMediaKind({ mimetype: 'text/html', fileName: 'falso.pdf' })).toBeNull()
  expect(printableMediaKind({ mimetype: 'application/octet-stream', fileName: 'arquivo.PDF' })).toBe('pdf')
})
test('imprime imagem reencodificada em janela isolada e diálogo não silencioso', async () => {
  expect(await run()).toEqual({ success: true, canceled: false })
  expect(h.ensure).toHaveBeenCalledWith(null, ACC, JID, 'm1')
  expect(h.options).toMatchObject({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true, webSecurity: true }
  })
  expect(h.print).toHaveBeenCalledWith({ silent: false, printBackground: true }, expect.any(Function))
  const html = decodeURIComponent(h.load.mock.calls[0][0])
  expect(html).toContain(Buffer.from('clean-png').toString('base64'))
  expect(html).not.toContain('image-bytes')
  const win = h.windows[0] as {
    destroyed: boolean
    webContents: { session: { clearStorageData: ReturnType<typeof vi.fn> } }
  }
  expect(win.destroyed).toBe(true)
  expect(win.webContents.session.clearStorageData).toHaveBeenCalled()
})
test('PDF original é carregado pelo viewer, sem converter para imagem ou HTML', async () => {
  h.media = { file: 'document.pdf', mimetype: 'application/pdf' }
  h.message = { deleted: false, media: h.media }
  writeFileSync(join(h.root, 'media', ACC, 'document.pdf'), '%PDF-1.7\nfixture')
  await run()
  expect(h.load).toHaveBeenCalledWith(realpathSync(join(h.root, 'media', ACC, 'document.pdf')))
})
test('cancelar diálogo fecha janela e não trata cancelamento como falha', async () => {
  h.print.mockImplementation((_options, callback) => callback(false, 'Print job canceled'))
  expect(await run()).toEqual({ success: false, canceled: true })
  expect((h.windows[0] as { destroyed: boolean }).destroyed).toBe(true)
})
test('falha de impressão fecha janela e permite tentar novamente', async () => {
  h.print.mockImplementation((_options, callback) => callback(false, 'printer offline'))
  await expect(run()).rejects.toThrow('printer offline')
  expect((h.windows[0] as { destroyed: boolean }).destroyed).toBe(true)
  h.print.mockImplementation((_options, callback) => callback(true, ''))
  await expect(run()).resolves.toEqual({ success: true, canceled: false })
})
test('falha de carregamento limpa janela e sessão', async () => {
  h.load.mockRejectedValue(new Error('load falhou'))
  await expect(run()).rejects.toThrow('load falhou')
  expect((h.windows[0] as { destroyed: boolean }).destroyed).toBe(true)
  expect(h.print).not.toHaveBeenCalled()
})
test('conta ou conversa errada e mensagem apagada não baixam nem abrem janela', async () => {
  await expect(printMessageMedia(null, '88888888-8888-4888-8888-888888888888', JID, 'm1', null)).rejects.toThrow(
    'Mensagem não encontrada'
  )
  await expect(printMessageMedia(null, ACC, 'outra@s.whatsapp.net', 'm1', null)).rejects.toThrow(
    'Mensagem não encontrada'
  )
  h.message = { deleted: true, media: h.media }
  await expect(run()).rejects.toThrow('Mensagem não encontrada')
  expect(h.ensure).not.toHaveBeenCalled()
  expect(h.windows).toHaveLength(0)
})
test('caminho traversal e symlink para fora da conta são rejeitados', () => {
  expect(() => storedPrintPath(ACC, '../image.png')).toThrow('Mídia inválida')
  writeFileSync(join(h.root, 'outside.png'), 'outside')
  symlinkSync(join(h.root, 'outside.png'), join(h.root, 'media', ACC, 'link.png'))
  expect(() => storedPrintPath(ACC, 'link.png')).toThrow('fora da pasta')
})
test('PDF com conteúdo inválido e imagem indecodificável não abrem diálogo', async () => {
  h.media = { file: 'image.png', mimetype: 'application/pdf' }
  h.message = { deleted: false, media: h.media }
  await expect(run()).rejects.toThrow('PDF válido')
  h.media = { file: 'image.png', mimetype: 'image/png' }
  h.message = { deleted: false, media: h.media }
  h.imageEmpty = true
  await expect(run()).rejects.toThrow('Não foi possível abrir')
  expect(h.print).not.toHaveBeenCalled()
})
test('cliques concorrentes compartilham uma impressão', async () => {
  let resolve: (success: boolean, reason: string) => void = () => undefined
  h.print.mockImplementation((_options, callback) => {
    resolve = callback
  })
  const one = run()
  const two = run()
  expect(one).toBe(two)
  await vi.waitFor(() => expect(h.print).toHaveBeenCalledTimes(1))
  resolve(false, 'canceled')
  await Promise.all([one, two])
})

test('erro no viewer PDF fecha a janela antes de chamar impressão', async () => {
  h.media = { file: 'document.pdf', mimetype: 'application/pdf' }
  h.message = { deleted: false, media: h.media }
  writeFileSync(join(h.root, 'media', ACC, 'document.pdf'), '%PDF-1.7\nfixture')
  h.pdfState = 'failed'
  await expect(run()).rejects.toThrow('Não foi possível abrir este PDF')
  expect(h.print).not.toHaveBeenCalled()
  expect((h.windows[0] as { destroyed: boolean }).destroyed).toBe(true)
})
