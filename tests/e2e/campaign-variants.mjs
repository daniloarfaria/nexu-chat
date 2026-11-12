// Smoke com perfil temporário e microfone sintético; nunca conecta ou envia ao WhatsApp.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'nexu-variantes-prints-'))
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'nexu-variantes-'))
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
})
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 1000 })
  const errors = []
  win.on('pageerror', (error) => errors.push(error.message))
  await win.waitForSelector('nav')
  const accountId = await win.evaluate(async () => {
    const a = await window.api.invoke('accounts:create', { name: 'Loja de teste', color: '#6a21fa' })
    await window.api.invoke('accounts:update', { id: a.id, modules: { campanhas: true }, autoConnect: false })
    return a.id
  })
  await win.reload()
  await win.getByRole('button', { name: 'Campanhas', exact: true }).click()
  await win.getByRole('button', { name: 'Nova campanha', exact: true }).click()
  await win.getByLabel('Nome da campanha (só para você)').fill('Mídias por versão')
  await win.locator('textarea').first().fill('Primeira versão')
  const png = readFileSync('resources/icon.png')
  await win
    .locator('input[type=file]')
    .nth(0)
    .setInputFiles({ name: 'primeira.png', mimeType: 'image/png', buffer: png })
  await win.getByRole('button', { name: 'Outra versão', exact: true }).click()
  await win.locator('textarea').nth(1).fill('Segunda versão')
  await win
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles({ name: 'segunda.png', mimeType: 'image/png', buffer: png })
  await win.getByAltText('primeira.png', { exact: true }).waitFor()
  await win.getByAltText('segunda.png', { exact: true }).waitFor()
  await win.getByRole('button', { name: 'Outra versão', exact: true }).click()
  await win.locator('textarea').nth(2).fill('Versão com voz')
  await win.getByRole('button', { name: 'Gravar áudio', exact: true }).nth(2).click()
  await win.getByRole('button', { name: 'Concluir gravação', exact: true }).waitFor()
  await win.waitForTimeout(1200)
  await win.getByRole('button', { name: 'Concluir gravação', exact: true }).click()
  await win.locator('audio').waitFor()
  await win.waitForFunction(() => document.querySelector('audio')?.readyState >= 1)
  assert.equal(await win.evaluate(() => document.querySelectorAll('img[alt$=".png"]').length), 2)
  await win.screenshot({ path: join(out, 'campanhas-versoes-gravacao.png'), fullPage: true })
  await win.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
  await win.getByRole('button', { name: 'Editar', exact: true }).waitFor()
  const saved = await win.evaluate(async (id) => {
    const items = await window.api.invoke('campaigns:list', { accountId: id })
    return items.find((item) => item.name === 'Mídias por versão')
  }, accountId)
  assert.equal(saved.templateMedia.length, 3)
  assert.equal(saved.templateMedia[0].name, 'primeira.png')
  assert.equal(saved.templateMedia[1].name, 'segunda.png')
  assert.equal(saved.templateMedia[2].voice, true)
  assert.match(saved.templateMedia[2].mime, /^audio\/ogg/)
  await win.getByRole('button', { name: 'Editar', exact: true }).click()
  await win.getByAltText('primeira.png', { exact: true }).waitFor()
  await win.getByAltText('segunda.png', { exact: true }).waitFor()
  await win.locator('audio').waitFor()
  await win.screenshot({ path: join(out, 'campanhas-versoes-salvas.png'), fullPage: true })
  await win.getByRole('button', { name: 'Contatos', exact: true }).click()
  await win.getByRole('button', { name: 'Campos do negócio', exact: true }).click()
  await win.getByLabel('Nome do campo', { exact: true }).fill('modelo')
  await win.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await win.getByRole('button', { name: 'Salvar campos', exact: true }).click()
  await win.getByRole('button', { name: 'Novo contato', exact: true }).click()
  await win.getByLabel('Valor de modelo', { exact: true }).fill('Armação leve')
  await win.screenshot({ path: join(out, 'contatos-campos-do-negocio.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      ok: true,
      out,
      userData,
      checks: [
        'previews distintas',
        'microfone sintético',
        'voz Ogg salva',
        'previews após reabrir',
        'campo do negócio na ficha'
      ],
      errors
    })
  )
} finally {
  await app.close()
}
