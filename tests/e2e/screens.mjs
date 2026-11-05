// Abre o app com dados temporários e tira prints das telas principais (claro e escuro).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.'
const userData = mkdtempSync(join(tmpdir(), 'dsp-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, DSP_E2E: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1280, height: 820 })
await win.waitForSelector('nav')
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

async function shot(name) {
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(out, `${name}.png`) })
}

for (const theme of ['light', 'dark']) {
  await win.evaluate((t) => {
    localStorage.setItem('theme', t)
    document.documentElement.dataset.theme = t
  }, theme)
  await win.getByRole('button', { name: 'Início' }).click()
  await shot(`${theme}-inicio-vazio`)
  await win.getByRole('button', { name: 'Gerenciar contas' }).or(win.getByRole('button', { name: 'Adicionar conta' })).first().click()
  if (theme === 'light') {
    await win.getByRole('button', { name: 'Nova conta' }).first().click()
    await win.getByLabel('Nome da conta').fill('Ótica Centro')
    await win.getByRole('button', { name: 'Criar e conectar' }).click()
    await win.waitForSelector('img[alt^="QR Code"]', { timeout: 30000 }).catch(() => errors.push('QR não apareceu'))
  }
  await shot(`${theme}-contas`)
  await win.getByRole('button', { name: 'Configurações' }).click()
  await shot(`${theme}-config-backup`)
  await win.getByRole('tab', { name: 'Módulos' }).click()
  await shot(`${theme}-config-modulos`)
  await win.getByRole('tab', { name: 'Sistema' }).click()
  await shot(`${theme}-config-sistema`)
  await win.getByRole('button', { name: 'Conversas' }).click()
  await shot(`${theme}-conversas`)
  await win.getByRole('button', { name: 'Início' }).click()
  await shot(`${theme}-inicio`)
}
// Desconecta a conta de teste antes de sair (não vincula nenhum número)
console.log(JSON.stringify({ errors }))
await app.close()
