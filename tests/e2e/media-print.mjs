// Perfil temporário; webContents.print é interceptado ANTES de qualquer ação.
// Nenhuma impressão física e nenhuma conexão/envio ao WhatsApp.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'nexu-print-shots-'))
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'nexu-print-profile-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('nav')
  const accountId = await win.evaluate(async () => {
    const a = await window.api.invoke('accounts:create', { name: 'Teste de impressão', color: '#6a21fa' })
    await window.api.invoke('accounts:update', { id: a.id, modules: { conversas: true }, autoConnect: false })
    return a.id
  })
  await app.evaluate(
    async ({ app, BrowserWindow }, { accountId, png }) => {
      const require = process.mainModule.require.bind(process.mainModule)
      const fs = require('node:fs'),
        path = require('node:path'),
        { DatabaseSync } = require('node:sqlite')
      global.__printJobs = []
      global.__printCallbacks = []
      app.on('browser-window-created', (_event, w) => {
        w.webContents.print = (options, callback) => {
          global.__printJobs.push({ id: w.id, options, url: w.webContents.getURL() })
          global.__printCallbacks.push(callback)
        }
      })
      // Gerar fixture de PDF pela renderização HTML só no teste; produção carrega PDF existente.
      const fixture = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } })
      await fixture.loadURL('data:text/html,<h1>PDF de teste</h1><p>Documento para verificar o visualizador.</p>')
      const pdf = await fixture.webContents.printToPDF({})
      fixture.destroy()
      const root = path.join(app.getPath('userData'), 'media', accountId)
      fs.mkdirSync(root, { recursive: true })
      fs.writeFileSync(path.join(root, 'image.png'), Buffer.from(png, 'base64'))
      fs.writeFileSync(path.join(root, 'document.pdf'), pdf)
      const db = new DatabaseSync(path.join(app.getPath('userData'), 'dados.sqlite'))
      const jid = '5511987654321@s.whatsapp.net',
        now = Math.floor(Date.now() / 1000)
      db.prepare('INSERT INTO chats (account_id,jid,name,last_ts,last_preview) VALUES (?,?,?,?,?)').run(
        accountId,
        jid,
        'Contato de impressão',
        now,
        'Anexos de teste'
      )
      for (const [id, type, file, mimetype] of [
        ['print-image', 'image', 'image.png', 'image/png'],
        ['print-pdf', 'document', 'document.pdf', 'application/pdf']
      ]) {
        const media = {
          file,
          fileName: file,
          mimetype,
          url: `dspmedia://${accountId}/${file}`,
          size: fs.statSync(path.join(root, file)).size
        }
        db.prepare('INSERT INTO messages (account_id,chat_jid,id,from_me,ts,type,media) VALUES (?,?,?,?,?,?,?)').run(
          accountId,
          jid,
          id,
          0,
          now,
          type,
          JSON.stringify(media)
        )
      }
      db.close()
    },
    { accountId, png: readFileSync('resources/icon.png').toString('base64') }
  )
  await win.reload()
  await win.getByText('Contato de impressão', { exact: true }).click()
  await win.locator('#msg-print-image').getByRole('button', { name: 'Imprimir', exact: true }).waitFor()
  await win.locator('#msg-print-pdf').getByRole('button', { name: 'Imprimir', exact: true }).waitFor()
  for (const [index, id] of ['print-image', 'print-pdf'].entries()) {
    const windowEvent = app.waitForEvent('window')
    await win.locator(`#msg-${id}`).getByRole('button', { name: 'Imprimir', exact: true }).click()
    const preview = await windowEvent
    await preview.waitForLoadState('load')
    await app.evaluate(async (_electron, expected) => {
      const end = Date.now() + 10000
      while (global.__printJobs.length < expected) {
        if (Date.now() > end) throw new Error('print não foi chamado')
        await new Promise((r) => setTimeout(r, 50))
      }
    }, index + 1)
    await preview.waitForTimeout(500)
    const job = await app.evaluate(() => global.__printJobs.at(-1))
    assert.equal(job.options.silent, false)
    if (id === 'print-image') assert.match(job.url, /^data:text\/html/)
    else {
      assert.match(job.url, /^file:.*document\.pdf$/)
      const viewer = preview.frames().find((f) => f.url().startsWith('chrome-extension:'))
      assert.ok(viewer, 'frame do visualizador Chromium')
      await viewer.waitForFunction(() => !!document.querySelector('pdf-viewer')?.shadowRoot, {}, { timeout: 10000 })
      assert.equal(await viewer.evaluate(() => document.querySelector('pdf-viewer').loadState_), 'success')
    }
    await preview.screenshot({ path: join(out, `${id}-preview.png`) })
    const closing = preview.waitForEvent('close')
    await app.evaluate(() => global.__printCallbacks.at(-1)(false, 'Print job canceled'))
    await closing
  }
  assert.equal((await app.evaluate(() => global.__printJobs)).length, 2)
  console.log(
    JSON.stringify({
      ok: true,
      out,
      userData,
      checks: [
        'botões imagem/PDF nas conversas',
        'imagem isolada renderizada',
        'PDF original no viewer Chromium',
        'print silent:false interceptado',
        'cancelamento fecha janela'
      ],
      physicalPrintJobs: 0
    })
  )
} finally {
  await app.close()
}
