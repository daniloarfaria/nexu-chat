import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({
  jobs: [] as Array<Promise<unknown>>,
  hold: false,
  held: [] as Array<() => Promise<unknown>>,
  sent: [] as Array<{ jid: string; text: string }>,
  sock: { sendPresenceUpdate: async () => undefined } as Record<string, unknown> | null
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))
vi.mock('../src/main/ai/router', () => ({
  complete: vi.fn(),
  getAiSettings: () => ({ privacy: 'anonimizar', paidMonthlyLimit: 300 })
}))
vi.mock('../src/main/outbox', () => ({
  lockChat: () => () => undefined,
  enqueueSend: (_acc: string, job: () => Promise<unknown>): boolean => {
    if (h.hold) h.held.push(job)
    else h.jobs.push(job().catch(() => undefined))
    return true
  }
}))
vi.mock('../src/main/wa/manager', () => ({ wa: { getSocket: () => h.sock, on: () => undefined } }))
vi.mock('../src/main/wa/send', () => ({
  sendAndStore: async (_s: unknown, _a: string, jid: string, c: { text: string }) => {
    h.sent.push({ jid, text: c.text })
    return undefined
  },
  wasSentByApp: (_a: string, id: string) => id.startsWith('app-')
}))

import { complete } from '../src/main/ai/router'
import { closeDb, getDb, openDb } from '../src/main/db'
import { updateAccount } from '../src/main/accounts'
import { saveBusinessContext } from '../src/main/ai/context'
import { storeEvents } from '../src/main/wa/store'
import type { MessageItem } from '../src/shared/types'
import * as R from '../src/main/iaAtendimento'
import { markAutoMessage } from '../src/main/autoMessages'

const ACC = '88888888-8888-4888-8888-888888888888'
const JID = '5511987650001@s.whatsapp.net'
const mockComplete = vi.mocked(complete)

let seq = 0
const nowSec = (): number => Math.floor(Date.now() / 1000)

function addMsg(fromMe: boolean, text: string | null, jid = JID, type = 'text', id?: string, at?: number): MessageItem {
  const mid = id ?? `m${++seq}`
  const ts = at ?? nowSec() - 300 + seq
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO chats (account_id, jid, name, last_ts, is_group) VALUES (?, ?, ?, ?, ?)').run(
    ACC,
    jid,
    'Ana Souza',
    ts,
    jid.endsWith('@g.us') ? 1 : 0
  )
  db.prepare('UPDATE chats SET last_ts = ? WHERE account_id = ? AND jid = ?').run(ts, ACC, jid)
  db.prepare(
    'INSERT INTO messages (account_id, chat_jid, id, from_me, ts, type, text) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(ACC, jid, mid, fromMe ? 1 : 0, ts, type, text)
  return {
    id: mid,
    chatJid: jid,
    fromMe,
    sender: null,
    senderName: null,
    ts,
    type,
    text,
    media: null,
    extra: null,
    quotedId: null,
    status: 0,
    reactions: null,
    edited: false,
    deleted: false
  } as MessageItem
}

const reply = (texto: string): { text: string; provider: string; model: string } => ({
  text: JSON.stringify({ acao: 'responder', texto }),
  provider: 'teste',
  model: 'm'
})

async function flush(): Promise<void> {
  await Promise.all(h.jobs.splice(0))
}

afterEach(() => {
  vi.useRealTimers()
  for (const e of ['incoming', 'status', 'group-participants']) storeEvents.removeAllListeners(e)
})

beforeEach(() => {
  h.hold = false
  h.held.length = 0
  R.resetRobotTimers()
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-onda5r2-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica Centro', '#000000', '{}', Date.now())
  updateAccount(ACC, { modules: { ia: true, iaAtendimento: true } })
  R.saveRobotSettings(ACC, { enabled: true })
  saveBusinessContext(ACC, {
    products: 'Armação a partir de R$ 199. Lente pronta em 7 dias.',
    hours: 'Seg a sáb, 9h às 18h'
  })
  R.tuning.debounceMs = 0
  R.tuning.sleep = async () => undefined
  h.jobs.length = 0
  h.sent.length = 0
  h.sock = { sendPresenceUpdate: async () => undefined }
  seq = 0
  mockComplete.mockReset()
})

describe('item 7: mensagem automática da loja não encerra a pergunta do cliente', () => {
  test('depois da boas-vindas automática o robô ainda responde a pergunta', async () => {
    mockComplete.mockResolvedValue(reply('Posso ajudar com armações.'))
    const q = addMsg(false, 'quanto custa uma armação?')
    const welcome = addMsg(true, 'Olá, bem-vindo!')
    markAutoMessage(ACC, welcome.id)
    R.onClientMessage(ACC, q)
    expect(await R.respond(ACC, JID)).toBe('respondeu')
    await flush()
    expect(h.sent.map((x) => x.text)).toEqual(['Posso ajudar com armações.'])
  })
  test('resposta de uma pessoa (não automática) continua encerrando a pergunta', async () => {
    addMsg(false, 'quanto custa uma armação?')
    R.onClientMessage(ACC, addMsg(false, 'oi?'))
    addMsg(true, 'Custa R$ 199')
    expect(await R.respond(ACC, JID)).toBe('ignorou')
  })
})

describe('item 8: modo fora do horário reavalia a cada mensagem', () => {
  const aberto = new Date(2026, 10, 9, 10, 0, 0) // segunda, 10h
  const fechado = new Date(2026, 10, 9, 22, 0, 0)
  test('conversa criada fora do horário não é respondida quando a loja já abriu', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(fechado)
    R.saveRobotSettings(ACC, { when: 'away' })
    mockComplete.mockResolvedValue(reply('Oi!'))
    const at = Math.floor(fechado.getTime() / 1000) - 5
    R.onClientMessage(ACC, addMsg(false, 'oi', JID, 'text', undefined, at))
    expect(R.getChatAi(ACC, JID)).toMatchObject({ mode: 'ia', reason: 'novo' })
    // amanhã de manhã: a loja abriu, quem atende é a equipe
    vi.setSystemTime(aberto)
    expect(await R.respond(ACC, JID)).toBe('ignorou')
    expect(mockComplete).not.toHaveBeenCalled()
  })
  test('exceção manual (devolvida para a IA) continua valendo com a loja aberta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(aberto)
    R.saveRobotSettings(ACC, { when: 'away' })
    mockComplete.mockResolvedValue(reply('Oi!'))
    addMsg(false, 'oi', JID, 'text', undefined, Math.floor(aberto.getTime() / 1000) - 5)
    R.giveBackToAi(ACC, JID)
    expect(await R.respond(ACC, JID)).toBe('respondeu')
  })
})
