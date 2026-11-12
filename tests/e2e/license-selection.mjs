// Smoke visual isolado: IPC simulado e dados sintéticos; sem servidor ou credenciais reais.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexu-license-ui-'))}`] })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('nav')
  await app.evaluate(({ ipcMain }) => {
    const options = [
      { id: 'LICENSE-ONE', plano: 'completo', contas: 8, teste: false, fim: null, status: 'active' },
      { id: 'LICENSE-TWO', plano: 'basico', contas: 2, teste: false, fim: null, status: 'active' }
    ]
    const initial = {
      state: 'none',
      payload: null,
      daysLeft: null,
      modules: ['conversas'],
      maxAccounts: 1,
      message: 'Escolha sua licença',
      online: null
    }
    let current = initial
    for (const channel of ['license:status', 'license:login', 'license:refresh', 'license:logout'])
      ipcMain.removeHandler(channel)
    const handle = (channel, fn) => ipcMain.handle(channel, (...args) => ({ ok: true, data: fn(...args) }))
    handle('license:status', () => current)
    handle('license:refresh', () => current)
    handle('license:logout', () => {
      current = initial
      return current
    })
    handle('license:login', (_event, args) => {
      if (!args.licenseId && args.email !== 'single@example.test') return { selectionRequired: true, licenses: options }
      const option = options.find((o) => o.id === args.licenseId) ?? options[0]
      current = {
        state: 'active',
        daysLeft: null,
        modules: ['conversas'],
        maxAccounts: option.contas,
        message: 'Licença escolhida',
        online: { email: args.email },
        payload: {
          v: 1,
          id: option.id,
          cliente: 'Conta de teste',
          plano: option.plano,
          contas: option.contas,
          modulos: ['conversas'],
          emitida: '2026-11-12',
          validade: null,
          online: true,
          email: args.email
        }
      }
      return current
    })
  })
  await win.getByRole('button', { name: 'Configurações', exact: true }).click()
  await win.getByRole('tab', { name: 'Licença', exact: true }).click()
  const email = win.getByLabel('E-mail', { exact: true })
  const password = win.getByLabel('Senha', { exact: true })
  await email.fill('multiple@example.test')
  await password.fill('synthetic-memory-only')
  await win.getByRole('button', { name: 'Entrar', exact: true }).click()
  await win.getByText('Escolha a licença deste computador', { exact: true }).waitFor()
  assert.equal(await win.locator('input[name="license"]').count(), 2)
  assert.equal(await win.getByRole('button', { name: 'Usar esta licença', exact: true }).isDisabled(), true)
  await win.getByRole('button', { name: 'Usar outra conta', exact: true }).click()
  assert.equal(await password.inputValue(), '')
  await password.fill('synthetic-memory-only')
  await win.getByRole('button', { name: 'Entrar', exact: true }).click()
  await win.locator('input[name="license"]').nth(1).check()
  await win.getByRole('button', { name: 'Usar esta licença', exact: true }).click()
  await win.getByText('Licença LICENSE-TWO', { exact: true }).waitFor()
  assert.equal(await win.locator('input[name="license"]').count(), 0)
  await win.getByRole('button', { name: 'Trocar licença', exact: true }).click()
  assert.equal(await password.inputValue(), '')
  await win.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await win.getByText('Licença LICENSE-TWO', { exact: true }).waitFor()
  await win.getByRole('button', { name: 'Trocar licença', exact: true }).click()
  await email.fill('single@example.test')
  await password.fill('synthetic-memory-only')
  await win.getByRole('button', { name: 'Entrar', exact: true }).click()
  await win.getByText('Licença LICENSE-ONE', { exact: true }).waitFor()
  assert.equal(await win.locator('input[name="license"]').count(), 0)
  console.log('Licenciamento UI: seleção, cancelamento, troca e licença única passaram.')
} finally {
  await app.close()
}
