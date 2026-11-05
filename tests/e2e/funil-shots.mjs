// Prints do Kanban, etiquetas e disparo por coluna com dados de demonstração (sem conectar WhatsApp).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? '.'
const userData = mkdtempSync(join(tmpdir(), 'dsp-e2e-funil-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, DSP_E2E: '1' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1360, height: 840 })
await win.waitForSelector('nav')
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const shot = async (name) => {
  await win.waitForTimeout(450)
  await win.screenshot({ path: join(out, `${name}.png`) })
}

const acc = await win.evaluate(async () => {
  const api = window.api
  const a = await api.invoke('accounts:create', { name: 'Ótica Centro', color: '#2f6f5e' })
  const pessoas = [
    ['Ana Souza', '11987650001', ['VIP', 'Óculos de grau']],
    ['Bruno Lima', '11987650002', ['Lentes de contato']],
    ['Carla Mendes', '11987650003', ['VIP']],
    ['Diego Rocha', '11987650004', ['Óculos de sol']],
    ['Elisa Prado', '11987650005', ['Óculos de grau']],
    ['Fábio Nunes', '11987650006', []],
    ['Gabriela Reis', '11987650007', ['VIP', 'Lentes de contato']],
    ['Heitor Alves', '11987650008', ['Inativo']]
  ]
  const ids = []
  for (const [name, phone, tags] of pessoas) ids.push((await api.invoke('people:save', { accountId: a.id, name, phone, tags })).id)
  await api.invoke('tags:save', { accountId: a.id, name: 'VIP', color: 'amber', previousName: 'VIP', description: 'Compram acima de R$ 1.000' })
  const p = await api.invoke('pipelines:create-template', { accountId: a.id, templateId: 'vendas' })
  const st = p.stages
  await api.invoke('pipelines:save', {
    accountId: a.id, id: p.id, name: p.name, color: 'blue',
    stages: st.map((s, i) => ({ id: s.id, name: s.name, color: s.color, kind: s.kind, slaDays: s.slaDays, autoTag: i === 2 ? 'Orçamento enviado' : null }))
  })
  const put = async (stage, who) => api.invoke('pipelines:add-people', { accountId: a.id, stageId: st[stage].id, personIds: who.map((i) => ids[i]) })
  await put(0, [0, 5]); await put(1, [1, 6]); await put(2, [2]); await put(3, [3]); await put(4, [4]); await put(5, [7])
  const b = await api.invoke('pipelines:board', { accountId: a.id, pipelineId: p.id })
  const vals = { 'Carla Mendes': 89000, 'Diego Rocha': 45990, 'Elisa Prado': 129900, 'Bruno Lima': 32000 }
  for (const c of b.cards) {
    if (vals[c.name]) await api.invoke('pipelines:update-card', { accountId: a.id, cardId: c.id, valueCents: vals[c.name], note: c.name === 'Carla Mendes' ? 'Quer armação dourada, retorna sexta.' : null })
  }
  await api.invoke('pipelines:create-template', { accountId: a.id, templateId: 'pedidos' })
  return a.id
})
await win.reload()
await win.waitForSelector('nav')

for (const theme of ['light', 'dark']) {
  await win.evaluate((t) => {
    localStorage.setItem('theme', t)
    document.documentElement.dataset.theme = t
  }, theme)
  await win.getByRole('button', { name: 'Funis' }).click()
  await win.waitForSelector('[data-card]', { timeout: 15000 }).catch(async () => {
    await win.screenshot({ path: join(out, 'debug.png') })
    throw new Error('quadro não carregou')
  })
  await shot(`${theme}-funil`)
}
await win.getByRole('button', { name: /Carla Mendes/ }).click()
await shot('dark-cartao')
await win.getByRole('button', { name: 'Fechar', exact: true }).last().click()
await win.getByRole('button', { name: 'Editar funil' }).click()
await win.getByRole('button', { name: 'Configurar Orçamento enviado' }).click()
await shot('dark-editor')
await win.getByRole('button', { name: 'Cancelar' }).click()
await win.evaluate(() => {
  localStorage.setItem('theme', 'light')
  document.documentElement.dataset.theme = 'light'
})
await win.getByRole('button', { name: 'Ações da coluna Em conversa' }).click()
await shot('light-menu-coluna')
await win.getByRole('menuitem', { name: /Disparar campanha/ }).click()
await win.waitForTimeout(600)
await shot('light-campanha-coluna')
await win.getByRole('button', { name: 'Contatos', exact: true }).click()
await shot('light-contatos')
await win.getByRole('button', { name: 'Etiquetas', exact: true }).click()
await shot('light-etiquetas')
console.log(JSON.stringify({ acc, errors }))
await app.close()
