// Prints do Assistente de IA: aba "Meu negócio" e o assistente "Configurar IA" (sem conectar WhatsApp, sem baixar nada).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.'
const userData = mkdtempSync(join(tmpdir(), 'dsp-e2e-ia-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, DSP_E2E: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1360, height: 900 })
await win.waitForSelector('nav')
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const shot = async (name) => {
  await win.waitForTimeout(450)
  await win.screenshot({ path: join(out, `${name}.png`) })
}

await win.evaluate(async () => {
  const a = await window.api.invoke('accounts:create', { name: 'Ótica Centro', color: '#2f6f5e' })
  await window.api.invoke('accounts:update', { id: a.id, modules: { ia: true }, autoConnect: false })
  await window.api.invoke('ai:context-save', {
    accountId: a.id,
    context: {
      about: 'Ótica de bairro. Óculos de grau, de sol e lentes de contato para a família toda.',
      hours: 'Segunda a sexta, 9h às 18h. Sábado, 9h às 13h.',
      forbidden: 'Não prometer desconto. Não falar de concorrentes.'
    }
  })
})
await win.reload()
await win.waitForSelector('nav')

for (const theme of ['light', 'dark']) {
  await win.evaluate((t) => {
    localStorage.setItem('theme', t)
    document.documentElement.dataset.theme = t
  }, theme)
  await win.getByRole('button', { name: 'Assistente de IA' }).click()
  await win.getByRole('tab', { name: 'Meu negócio' }).click()
  await shot(`${theme}-ia-meu-negocio`)
  await win.getByRole('button', { name: 'Preencher com a IA' }).click()
  await shot(`${theme}-ia-preencher`)
  await win.getByRole('button', { name: 'Cancelar' }).click()
  await win.getByRole('button', { name: 'Configurar IA' }).click()
  await win.waitForSelector('text=Recomendação')
  await shot(`${theme}-ia-configurar`)
  await win.getByRole('button', { name: 'Fechar', exact: true }).last().click()
}
console.log(JSON.stringify({ errors }))
await app.close()
