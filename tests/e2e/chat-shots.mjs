// Prints da tela de conversas com dados fictícios (claro e escuro).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const out = process.argv[2] ?? '.'
const userData = mkdtempSync(join(tmpdir(), 'dsp-chat-'))
execFileSync('npx', ['vitest', 'run', '--config', 'vitest.seed.config.ts'], {
  env: { ...process.env, DSP_SEED_DB: join(userData, 'dados.sqlite') },
  stdio: 'ignore'
})
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1280, height: 820 })
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await win.waitForSelector('nav')

for (const theme of ['light', 'dark']) {
  await win.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
  await win.getByRole('button', { name: /^Conversas/ }).click()
  await win.getByRole('option', { name: /Ana Souza/ }).click()
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(out, `${theme}-conversa.png`) })
  await win.getByRole('option', { name: /Clientes VIP/ }).click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: join(out, `${theme}-grupo.png`) })
}
console.log(JSON.stringify({ errors }))
await app.close()
