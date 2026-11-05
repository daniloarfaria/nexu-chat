import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

// WhatsApp simulado
const sent: Array<{ jid: string; text: string }> = []
let connected = true
const fakeSock = {
  user: { id: '5511900000000:1@s.whatsapp.net' },
  onWhatsApp: async (phone: string) =>
    phone.endsWith('9999') ? [{ exists: false, jid: '' }] : [{ exists: true, jid: `${phone}@s.whatsapp.net` }],
  presenceSubscribe: async () => undefined,
  sendPresenceUpdate: async () => undefined,
  sendMessage: async (jid: string, content: { text?: string; caption?: string }) => {
    sent.push({ jid, text: content.text ?? content.caption ?? '' })
    return {
      key: { remoteJid: jid, fromMe: true, id: `OUT${sent.length}` },
      message: { conversation: content.text ?? '' },
      messageTimestamp: Math.floor(Date.now() / 1000)
    }
  }
}
vi.mock('../src/main/wa/manager', () => ({
  wa: { getSocket: () => (connected ? fakeSock : null), on: () => undefined }
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as people from '../src/main/people'
import * as C from '../src/main/campaigns'
import { engine } from '../src/main/engine'

const ACC = '44444444-4444-4444-8444-444444444444'

// Executa um passo do motor sem esperar os intervalos
async function step(): Promise<void> {
  const e = engine as unknown as {
    runner(a: string): object
    step(a: string, r: object): Promise<void>
    stop(a: string): void
  }
  await e.step(ACC, e.runner(ACC))
  e.stop(ACC)
}

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-eng-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica Centro', '#000000', '{}', Date.now())
  sent.length = 0
  connected = true
  // janela sempre aberta, sem simular digitação, sem pausa longa
  C.setAntiBan(ACC, {
    hourStart: 0,
    hourEnd: 24,
    days: [0, 1, 2, 3, 4, 5, 6],
    typing: false,
    pauseEvery: 0,
    dailyLimit: 100
  })
  ;(engine as unknown as { runners: Map<string, unknown> }).runners.clear()
})

function campaign(): number {
  people.savePerson(ACC, { name: 'ANA SOUZA', phone: '11987650001', tags: ['VIP'] })
  people.savePerson(ACC, { name: 'Sem Zap', phone: '11987659999', tags: ['VIP'] })
  people.savePerson(ACC, { name: 'Bruno', phone: '11987650002', tags: ['VIP'] })
  const c = C.saveCampaign({
    accountId: ACC,
    name: 'Teste',
    templates: ['{Oi|Olá} {primeiro_nome}, aqui é da {loja}!'],
    audience: { type: 'tags', tags: ['VIP'] },
    optOutFooter: true,
    scheduledAt: null
  })
  C.startCampaign(c.id)
  return c.id
}

describe('motor de campanhas', () => {
  test('envia com variáveis e rodapé, pula quem não tem WhatsApp e termina', async () => {
    const id = campaign()
    for (let i = 0; i < 5; i++) await step()
    expect(sent).toHaveLength(2)
    expect(sent[0].text).toMatch(/^(Oi|Olá) Ana, aqui é da Ótica Centro!/)
    expect(sent[0].text).toMatch(/responda SAIR/)
    const c = C.getCampaign(id)!
    expect(c.stats).toMatchObject({ sent: 2, noWa: 1, pending: 0 })
    expect(c.status).toBe('done')
    expect(C.sentToday(ACC)).toBe(2)
    // a mensagem enviada fica salva nas conversas
    const n = getDb().prepare('SELECT COUNT(*) AS n FROM messages WHERE account_id = ? AND from_me = 1').get(ACC) as {
      n: number
    }
    expect(n.n).toBe(2)
  })

  test('quem respondeu SAIR depois de entrar na fila não recebe', async () => {
    const id = campaign()
    const ana = people.listPeople({ accountId: ACC, search: 'ana', limit: 1, offset: 0 }).items[0]
    people.optOutByJid(ACC, '5511987650001@s.whatsapp.net')
    expect(people.getPerson(ACC, ana.id)?.optOut).toBe(true)
    for (let i = 0; i < 5; i++) await step()
    expect(sent.map((s) => s.jid)).toEqual(['5511987650002@s.whatsapp.net'])
    expect(C.getCampaign(id)!.stats.optedOut).toBe(1)
  })

  test('limite diário segura o envio', async () => {
    campaign()
    C.setAntiBan(ACC, { dailyLimit: 1 })
    for (let i = 0; i < 4; i++) await step()
    expect(sent).toHaveLength(1)
    expect(engine.state(ACC).phase).toBe('daily_limit')
  })

  test('fora do horário não envia; sem conexão espera', async () => {
    campaign()
    C.setAntiBan(ACC, { days: [(new Date().getDay() + 1) % 7] })
    await step()
    expect(sent).toHaveLength(0)
    expect(engine.state(ACC).phase).toBe('outside_hours')
    C.setAntiBan(ACC, { days: [0, 1, 2, 3, 4, 5, 6] })
    connected = false
    await step()
    expect(engine.state(ACC).phase).toBe('disconnected')
  })

  test('falhas seguidas pausam a campanha', async () => {
    const id = campaign()
    C.setAntiBan(ACC, { maxFailStreak: 2 })
    const orig = fakeSock.sendMessage
    fakeSock.sendMessage = async () => {
      throw new Error('Connection Closed')
    }
    for (let i = 0; i < 4; i++) await step()
    fakeSock.sendMessage = orig
    const c = C.getCampaign(id)!
    expect(c.status).toBe('paused')
    expect(c.pausedReason).toMatch(/falhas seguidas/)
  })

  test('pausa automática por baixa taxa de resposta', async () => {
    const id = campaign()
    C.setAntiBan(ACC, { minReplyRate: 20 })
    // simula 30 envios sem resposta
    const db = getDb()
    for (let i = 0; i < 30; i++)
      db.prepare(
        "INSERT INTO campaign_targets (campaign_id, seq, phone, status, sent_at) VALUES (?, ?, ?, 'sent', ?)"
      ).run(id, 100 + i, `55119876${i}`, Date.now())
    await step()
    expect(C.getCampaign(id)!.status).toBe('paused')
    expect(C.getCampaign(id)!.pausedReason).toMatch(/proteger o número/)
  })
})
