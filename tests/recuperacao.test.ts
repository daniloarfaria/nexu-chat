import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({
  jobs: [] as Array<Promise<unknown>>,
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
  enqueueSend: (_acc: string, job: () => Promise<unknown>): boolean => {
    h.jobs.push(job().catch(() => undefined))
    return true
  }
}))
vi.mock('../src/main/wa/manager', () => ({ wa: { getSocket: () => h.sock, on: () => undefined } }))
vi.mock('../src/main/wa/send', () => ({
  sendAndStore: async (_s: unknown, _a: string, jid: string, c: { text: string }) => {
    h.sent.push({ jid, text: c.text })
    return undefined
  },
  wasSentByApp: () => false
}))

import { complete } from '../src/main/ai/router'
import { closeDb, getDb, openDb } from '../src/main/db'
import { updateAccount } from '../src/main/accounts'
import { saveBusinessContext } from '../src/main/ai/context'
import { setAntiBan } from '../src/main/campaigns'
import { optOutByJid } from '../src/main/people'
import { saveDeal, deleteDeal } from '../src/main/deals'
import { panel } from '../src/main/painel'
import type { MessageItem } from '../src/shared/types'
import * as R from '../src/main/recuperacao'
import { estimateDiscountCents } from '../src/main/recoveryLink'

const ACC = '99999999-9999-4999-8999-999999999999'
const JID = '5511987650001@s.whatsapp.net'
const mockComplete = vi.mocked(complete)
const DAY = 86_400
const nowSec = (): number => Math.floor(Date.now() / 1000)
let seq = 0

function addMsg(fromMe: boolean, text: string, at: number, jid = JID): MessageItem {
  const id = `m${++seq}`
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO chats (account_id, jid, name, last_ts, is_group) VALUES (?, ?, ?, ?, 0)').run(
    ACC,
    jid,
    'Ana Souza',
    at
  )
  db.prepare('UPDATE chats SET last_ts = MAX(last_ts, ?) WHERE account_id = ? AND jid = ?').run(at, ACC, jid)
  db.prepare('INSERT INTO messages (account_id, chat_jid, id, from_me, ts, type, text) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    ACC,
    jid,
    id,
    fromMe ? 1 : 0,
    at,
    'text',
    text
  )
  return { id, chatJid: jid, fromMe, ts: at, type: 'text', text } as unknown as MessageItem
}

/** Conversa em que a loja respondeu e o cliente sumiu há 2 dias, com a etiqueta "Orçamento". */
function quoteChat(jid = JID): void {
  addMsg(false, 'Quanto custa a armação?', nowSec() - 2 * DAY - 600, jid)
  addMsg(true, 'A armação sai a partir de R$ 199.', nowSec() - 2 * DAY, jid)
  const phone = jid.split('@')[0]
  const db = getDb()
  const pid = Number(
    db
      .prepare('INSERT INTO people (account_id, phone, jid, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ACC, phone, jid, 'Ana Souza', Date.now(), Date.now()).lastInsertRowid
  )
  db.prepare('INSERT INTO person_tags (person_id, tag) VALUES (?, ?)').run(pid, 'Orçamento')
}

const ai = (texto: string): { text: string; provider: string; model: string } => ({
  text: JSON.stringify({ acao: 'enviar', texto }),
  provider: 't',
  model: 'm'
})

async function flush(): Promise<void> {
  await Promise.all(h.jobs.splice(0))
}

const attempts = (): Array<{ n: number; status: string; text: string; offer: string | null; error: string | null }> =>
  getDb().prepare('SELECT n, status, text, offer, error FROM followup_attempts ORDER BY id').all() as never
const fup = (): { status: string; stop_reason: string | null; attempts_done: number } =>
  getDb().prepare('SELECT * FROM followups ORDER BY id DESC LIMIT 1').get() as never

/** Entra, escreve a tentativa e devolve a fila. */
async function runUntilQueued(): Promise<void> {
  expect(await R.scanCandidates(ACC)).toBe(1)
  expect(await R.processDue(ACC)).toBe(1)
}

beforeEach(() => {
  R.resetRecoveryState()
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-rec-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica Centro', '#000000', '{}', Date.now())
  updateAccount(ACC, { modules: { ia: true, recuperacao: true } })
  R.saveRecoverySettings(ACC, { enabled: true })
  setAntiBan(ACC, { hourStart: 0, hourEnd: 24, days: [0, 1, 2, 3, 4, 5, 6] })
  saveBusinessContext(ACC, { products: 'Armação a partir de R$ 199. Lente pronta em 7 dias.', hours: 'Seg a sáb, 9h às 18h' })
  R.tuning.sleep = async () => undefined
  h.jobs.length = 0
  h.sent.length = 0
  h.sock = { sendPresenceUpdate: async () => undefined }
  seq = 0
  mockComplete.mockReset()
})

afterEach(() => vi.useRealTimers())

describe('desconto: o número vem só da regra', () => {
  const s = (p = {}): ReturnType<typeof R.getRecoverySettings> =>
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 3, discountCondition: 'na compra à vista', ...p })

  test('offerFor: só a partir da tentativa configurada, e sem percentual não há oferta', () => {
    const cfg = s()
    expect(R.offerFor(cfg, 1)).toBeNull()
    expect(R.offerFor(cfg, 2)).toBeNull()
    expect(R.offerFor(cfg, 3)?.phrase).toBe('um desconto de 10% na compra à vista, válido por 7 dias')
    expect(R.offerFor(s({ discountPct: 0 }), 3)).toBeNull()
    expect(R.offerFor(s({ discountPct: 10, discountCapReais: 50 }), 3)?.phrase).toContain('desconto máximo de R$ 50')
  })

  test('limites da regra: percentual até 50, tentativas de 1 a 3, condição sem marcas', () => {
    const cfg = R.saveRecoverySettings(ACC, {
      discountPct: 90,
      attempts: 9,
      discountCondition: '{DESCONTO} <b>à vista</b>'
    })
    expect(cfg.discountPct).toBe(50)
    expect(cfg.attempts).toBe(3)
    expect(cfg.discountCondition).not.toMatch(/[{}<>]/)
    expect(R.saveRecoverySettings(ACC, {}).mode).toBe('approve')
  })

  test('a IA nunca vê o desconto: o pedido não tem o percentual, o valor nem o prazo da regra', () => {
    const cfg = s({ discountCapReais: 77, discountValidDays: 9 })
    const offer = R.offerFor(cfg, 3)!
    const p = R.buildRecoveryPrompt({
      context: 'Armação a partir de R$ 199.',
      playbook: null,
      notes: '',
      history: [{ fromMe: true, text: 'Oi!' }],
      n: 3,
      of: 3,
      offer,
      daysSilent: 2
    })
    const all = `${p.system}\n${p.prompt}`
    expect(all).toContain('{DESCONTO}')
    expect(all).not.toMatch(/10\s*%/)
    expect(all).not.toContain('77')
    expect(all).not.toContain('à vista')
    expect(all).not.toContain(offer.phrase)
    // Sem desconto na tentativa: a IA é proibida de oferecer
    const q = R.buildRecoveryPrompt({ context: 'x', playbook: null, notes: '', history: [], n: 1, of: 3, offer: null, daysSilent: 1 })
    expect(q.system).toContain('Não ofereça desconto')
  })

  test('composeText troca a marca pelo texto oficial; sem marca acrescenta; marca sem desconto é recusada', () => {
    const offer = R.offerFor(s(), 3)!
    const a = R.composeText('Oi! Consegui {DESCONTO} para você.', offer)
    expect(a).toEqual({ ok: true, text: `Oi! Consegui ${offer.phrase} para você.` })
    const b = R.composeText('Oi, tudo bem?', offer)
    expect(b.ok && b.text.includes(offer.phrase)).toBe(true)
    expect(R.composeText('Consegui {DESCONTO}', null).ok).toBe(false)
    expect(R.composeText('Oi {desconto} e {desconto}', offer)).toMatchObject({ ok: true })
  })

  describe('checkRecoveryReply', () => {
    const src = 'Armação a partir de R$ 199. Lente pronta em 7 dias.'
    const offer = (): R.Offer => R.offerFor(s(), 3)!
    const fine = (t: string, o: R.Offer | null): void =>
      expect(R.checkRecoveryReply(t, { source: src, offer: o }).ok, t).toBe(true)
    const bad = (t: string, o: R.Offer | null): void =>
      expect(R.checkRecoveryReply(t, { source: src, offer: o }).ok, t).toBe(false)

    test('só o percentual da regra passa', () => {
      const o = offer()
      fine(`Oi! Consegui ${o.phrase} para você.`, o)
      bad('Oi! Consegui um desconto de 15% na compra à vista, válido por 7 dias para você.', o)
      bad(`Consegui ${o.phrase}. E se pagar no Pix, mais 5%.`, o)
      bad('Consegui um desconto de 10% na compra à vista, válido por 30 dias.', o)
    })

    test('qualquer outro número ou oferta é bloqueado', () => {
      const o = offer()
      for (const t of [
        `Consegui ${o.phrase} e um brinde.`,
        `Consegui ${o.phrase} sem juros.`,
        `Consegui ${o.phrase}. Fica por R$ 150.`,
        `Consegui ${o.phrase}. Parcelo em 12x.`,
        `Consegui ${o.phrase}. Frete de graça.`,
        `Consegui ${o.phrase}. Pague por Pix.`
      ])
        bad(t, o)
    })

    test('tentativa sem desconto: nada de desconto, percentual ou promoção, mesmo que o contexto fale', () => {
      fine('Oi! Ficou alguma dúvida sobre a armação?', null)
      bad('Oi! Temos um desconto para você.', null)
      bad('Oi! Hoje está com 10% de abatimento.', null)
      bad('Oi! Tem promoção até sexta.', null)
      expect(R.checkRecoveryReply('Temos desconto de 10%', { source: `${src} Desconto de 10% à vista.`, offer: null }).ok).toBe(false)
    })

    test('o valor do contexto da loja continua valendo', () => {
      fine('A armação sai a partir de R$ 199 e a lente fica pronta em 7 dias.', null)
      bad('A armação sai a partir de R$ 99.', null)
    })
  })

  test('estimativa do desconto: o valor pago já tem o desconto, e o teto vale', () => {
    expect(estimateDiscountCents(9000, { pct: 10, capCents: null })).toBe(1000)
    expect(estimateDiscountCents(9000, { pct: 10, capCents: 500 })).toBe(500)
    expect(estimateDiscountCents(0, { pct: 10, capCents: null })).toBe(0)
    expect(estimateDiscountCents(9000, null)).toBe(0)
  })
})

describe('fluxo: aprovar antes', () => {
  test('entra, a IA escreve, fica na fila e só sai com um clique', async () => {
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida sobre a armação?'))
    await runUntilQueued()
    const q = R.listQueue(ACC)
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ n: 1, of: 3, status: 'pendente', reasonIn: 'orcamento', offer: null })
    expect(q[0].chatName).toBe('Ana Souza')
    // sem clique nada sai, nem depois de várias rodadas
    await R.tick()
    await flush()
    expect(h.sent).toHaveLength(0)

    R.approveAttempt(ACC, q[0].id)
    await flush()
    expect(h.sent).toEqual([{ jid: JID, text: 'Oi! Ficou alguma dúvida sobre a armação?' }])
    expect(attempts()[0].status).toBe('enviada')
    expect(fup()).toMatchObject({ status: 'ativo', attempts_done: 1 })
    const sentToday = getDb().prepare('SELECT sent FROM send_log WHERE account_id = ?').get(ACC) as { sent: number }
    expect(sentToday.sent).toBe(1)
  })

  test('editar antes de enviar: texto novo passa pelo filtro; preço inventado não', async () => {
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    const id = R.listQueue(ACC)[0].id
    expect(() => R.approveAttempt(ACC, id, 'Oi! Fecho por R$ 99 hoje.')).toThrow(/recuperação não pode enviar/)
    expect(() => R.approveAttempt(ACC, id, 'Oi! Faço 20% de desconto.')).toThrow()
    expect(h.sent).toHaveLength(0)
    R.approveAttempt(ACC, id, 'Oi Ana, posso ajudar com a armação?')
    await flush()
    expect(h.sent[0].text).toBe('Oi Ana, posso ajudar com a armação?')
    expect(getDb().prepare('SELECT edited FROM followup_attempts WHERE id = ?').get(id)).toEqual({ edited: 1 })
  })

  test('descartar pula a tentativa e o acompanhamento segue para a próxima', async () => {
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    R.discardAttemptById(ACC, R.listQueue(ACC)[0].id)
    expect(R.listQueue(ACC)).toHaveLength(0)
    expect(fup()).toMatchObject({ status: 'ativo', attempts_done: 1 })
    const due = getDb().prepare('SELECT next_due_at FROM followups').get() as { next_due_at: number }
    expect(due.next_due_at).toBeGreaterThan(Date.now() + 1.5 * DAY * 1000)
    expect(h.sent).toHaveLength(0)
  })

  test('o desconto entra só na tentativa configurada e é o texto da regra', async () => {
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 2, discountCondition: 'na compra à vista', attempts: 2 })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    expect(R.listQueue(ACC)[0].offer).toBeNull()
    R.approveAttempt(ACC, R.listQueue(ACC)[0].id)
    await flush()
    // avança o relógio da 2ª tentativa
    getDb().prepare('UPDATE followups SET next_due_at = ?').run(Date.now() - 1000)
    mockComplete.mockResolvedValueOnce(ai('De novo por aqui! Consegui {DESCONTO} para você.'))
    expect(await R.processDue(ACC)).toBe(1)
    const q = R.listQueue(ACC)[0]
    expect(q).toMatchObject({ n: 2, discountPct: 10 })
    expect(q.text).toBe('De novo por aqui! Consegui um desconto de 10% na compra à vista, válido por 7 dias para você.')
    // o pedido à IA não levou o número
    const req = mockComplete.mock.calls[1][0]
    expect(`${req.system}${req.prompt}`).not.toMatch(/10\s*%/)
  })

  test('IA que escreve outro percentual ou oferta fora da regra é bloqueada: nada na fila', async () => {
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 1 })
    quoteChat()
    for (const t of [
      'Consegui 25% de desconto para você!',
      'Consegui {DESCONTO} e mais um brinde.',
      'Consegui {DESCONTO}. Fica por R$ 120.',
      'Consegui {DESCONTO} sem juros.'
    ]) {
      mockComplete.mockResolvedValueOnce(ai(t))
    }
    await R.scanCandidates(ACC)
    for (let i = 0; i < 2; i++) {
      getDb().prepare('UPDATE followups SET next_due_at = ? WHERE status = ?').run(Date.now() - 1000, 'ativo')
      await R.processDue(ACC)
    }
    expect(R.listQueue(ACC)).toHaveLength(0)
    expect(attempts()).toHaveLength(0)
    expect(fup().status).toBe('ativo')
  })

  test('IA fora do ar: 3 falhas param o acompanhamento, sem mandar nada', async () => {
    quoteChat()
    mockComplete.mockRejectedValue(new Error('fora'))
    await R.scanCandidates(ACC)
    for (let i = 0; i < 3; i++) {
      getDb().prepare('UPDATE followups SET next_due_at = ? WHERE status = ?').run(Date.now() - 1000, 'ativo')
      await R.processDue(ACC)
    }
    expect(fup()).toMatchObject({ status: 'parado', stop_reason: 'ia_fora' })
    expect(h.sent).toHaveLength(0)
  })

  test('IA que desiste: o acompanhamento para', async () => {
    quoteChat()
    mockComplete.mockResolvedValueOnce({ text: '{"acao":"desistir"}', provider: 't', model: 'm' })
    await R.scanCandidates(ACC)
    await R.processDue(ACC)
    expect(fup()).toMatchObject({ status: 'parado', stop_reason: 'sem_interesse' })
  })
})

describe('modo automático', () => {
  test('sai sozinho, pela fila, com o texto filtrado', async () => {
    R.saveRecoverySettings(ACC, { mode: 'auto' })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida sobre a armação?'))
    await runUntilQueued()
    expect(attempts()[0].status).toBe('aprovada')
    R.deliverApproved(ACC)
    await flush()
    expect(h.sent).toHaveLength(1)
    expect(attempts()[0].status).toBe('enviada')
  })

  test('fora do horário de envio espera, sem descartar', async () => {
    R.saveRecoverySettings(ACC, { mode: 'auto' })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    const h0 = new Date().getHours()
    setAntiBan(ACC, { hourStart: (h0 + 2) % 23, hourEnd: ((h0 + 2) % 23) + 1 })
    R.deliverApproved(ACC)
    await flush()
    expect(h.sent).toHaveLength(0)
    expect(attempts()[0].status).toBe('aprovada')
    expect(R.listQueue(ACC)[0].waiting).toMatch(/horário/)
  })

  test('limite diário de envios segura a mensagem', async () => {
    R.saveRecoverySettings(ACC, { mode: 'auto' })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    setAntiBan(ACC, { dailyLimit: 1 })
    const { countSend } = await import('../src/main/campaigns')
    countSend(ACC)
    R.deliverApproved(ACC)
    await flush()
    expect(h.sent).toHaveLength(0)
  })

  test('sem socket conectado nada sai', async () => {
    R.saveRecoverySettings(ACC, { mode: 'auto' })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    h.sock = null
    R.deliverApproved(ACC)
    await flush()
    expect(h.sent).toHaveLength(0)
  })
})

describe('para sozinha', () => {
  async function queued(): Promise<number> {
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    return R.listQueue(ACC)[0].id
  }

  test('o cliente responde: para e nada sai, mesmo já aprovado', async () => {
    const id = await queued()
    R.onClientReply(ACC, addMsg(false, 'Oi, ainda quero', nowSec()))
    expect(fup()).toMatchObject({ status: 'parado', stop_reason: 'respondeu' })
    expect(attempts()[0].status).toBe('descartada')
    expect(() => R.approveAttempt(ACC, id)).toThrow()
    await flush()
    expect(h.sent).toHaveLength(0)
  })

  test('o cliente responde depois da aprovação e antes do envio (sem o evento): o filtro final segura', async () => {
    const id = await queued()
    R.approveAttempt(ACC, id)
    // a mensagem chega no banco antes de a fila rodar e o gancho não foi chamado
    addMsg(false, 'Pode ser amanhã?', nowSec())
    await flush()
    expect(h.sent).toHaveLength(0)
    expect(attempts()[0].status).toBe('descartada')
  })

  test('SAIR vence: para e registra o motivo', async () => {
    await queued()
    R.onClientReply(ACC, addMsg(false, 'SAIR', nowSec()))
    expect(fup()).toMatchObject({ status: 'parado', stop_reason: 'sair' })
  })

  test('quem pediu para não receber nunca recebe, mesmo aprovado', async () => {
    const id = await queued()
    optOutByJid(ACC, JID)
    R.approveAttempt(ACC, id)
    await flush()
    expect(h.sent).toHaveLength(0)
    expect(fup().stop_reason).toBe('sair')
  })

  test('o atendente assume (escreve na conversa): para', async () => {
    await queued()
    R.onHumanMessage(ACC, JID)
    expect(fup()).toMatchObject({ status: 'parado', stop_reason: 'atendente' })
    expect(R.listQueue(ACC)).toHaveLength(0)
  })

  test('a venda é marcada: para, e perda também', async () => {
    await queued()
    saveDeal(ACC, { chatJid: JID, status: 'lost', amountCents: 0, reason: 'Preço' })
    expect(fup().status).toBe('parado')
    expect(R.listQueue(ACC)).toHaveLength(0)
  })

  test('mensagem antiga (sincronização) não conta como resposta', async () => {
    await queued()
    R.onClientReply(ACC, addMsg(false, 'antiga', nowSec() - 5 * DAY))
    expect(fup().status).toBe('ativo')
  })

  test('desligar a regra descarta o que estava esperando', async () => {
    await queued()
    R.saveRecoverySettings(ACC, { enabled: false })
    expect(R.listQueue(ACC)).toHaveLength(0)
  })

  test('mudar o desconto da regra invalida o texto antigo', async () => {
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 1 })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Consegui {DESCONTO}.'))
    await runUntilQueued()
    const id = R.listQueue(ACC)[0].id
    R.saveRecoverySettings(ACC, { discountPct: 5 })
    R.approveAttempt(ACC, id)
    await flush()
    expect(h.sent).toHaveLength(0)
    expect(attempts()[0].status).toBe('descartada')
    // e o acompanhamento escreve de novo com a regra nova
    expect(fup().status).toBe('ativo')
  })
})

describe('quem entra', () => {
  test('conversa sem orçamento, sem funil e sem interesse não entra', async () => {
    addMsg(false, 'Oi', nowSec() - 2 * DAY - 60)
    addMsg(true, 'Olá!', nowSec() - 2 * DAY)
    expect(await R.scanCandidates(ACC)).toBe(0)
  })

  test('cartão de funil em andamento entra; ganho ou perdido não', async () => {
    addMsg(false, 'Oi', nowSec() - 2 * DAY - 60)
    addMsg(true, 'Olá!', nowSec() - 2 * DAY)
    const db = getDb()
    const pid = Number(
      db
        .prepare('INSERT INTO people (account_id, phone, jid, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(ACC, '5511987650001', JID, Date.now(), Date.now()).lastInsertRowid
    )
    const pl = Number(
      db.prepare("INSERT INTO pipelines (account_id, name, created_at) VALUES (?, 'Vendas', ?)").run(ACC, Date.now()).lastInsertRowid
    )
    const stage = (name: string, kind: string, pos: number): number =>
      Number(
        db.prepare('INSERT INTO pipeline_stages (pipeline_id, name, kind, position) VALUES (?, ?, ?, ?)').run(pl, name, kind, pos)
          .lastInsertRowid
      )
    const won = stage('Ganho', 'won', 1)
    const card = db.prepare('INSERT INTO pipeline_cards (pipeline_id, stage_id, person_id, position, created_at, moved_at) VALUES (?, ?, ?, 1, ?, ?)')
    const c = Number(card.run(pl, won, pid, Date.now(), Date.now()).lastInsertRowid)
    expect(await R.scanCandidates(ACC)).toBe(0)
    db.prepare('UPDATE pipeline_cards SET stage_id = ? WHERE id = ?').run(stage('Conversa', 'open', 0), c)
    expect(await R.scanCandidates(ACC)).toBe(1)
    expect(fup()).toBeDefined()
    expect((getDb().prepare('SELECT reason_in FROM followups').get() as { reason_in: string }).reason_in).toBe('funil')
  })

  test('só depois do prazo de silêncio e dentro da janela de entrada', async () => {
    addMsg(false, 'Oi', nowSec() - 3600 - 60)
    addMsg(true, 'Olá!', nowSec() - 3600) // há 1 hora: cedo
    const phone = JID.split('@')[0]
    const pid = Number(
      getDb().prepare('INSERT INTO people (account_id, phone, jid, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(ACC, phone, JID, 1, 1)
        .lastInsertRowid
    )
    getDb().prepare('INSERT INTO person_tags (person_id, tag) VALUES (?, ?)').run(pid, 'orçamento')
    expect(await R.scanCandidates(ACC)).toBe(0)
    // regra de 1 hora: entra
    R.saveRecoverySettings(ACC, { idleHours: 1 })
    expect(await R.scanCandidates(ACC)).toBe(1)
  })

  test('conversa velha (semanas) não é acordada ao ligar a regra', async () => {
    quoteChat()
    getDb().prepare('UPDATE messages SET ts = ts - ?').run(20 * DAY)
    getDb().prepare('UPDATE chats SET last_ts = last_ts - ?').run(20 * DAY)
    expect(await R.scanCandidates(ACC)).toBe(0)
  })

  test('cliente que já escreveu de novo, grupo, opt-out e venda já marcada não entram', async () => {
    quoteChat()
    addMsg(false, 'Voltei', nowSec() - 3600) // última mensagem é do cliente
    expect(await R.scanCandidates(ACC)).toBe(0)

    const J2 = '5511987650002@s.whatsapp.net'
    quoteChat(J2)
    optOutByJid(ACC, J2)
    expect(await R.scanCandidates(ACC)).toBe(0)

    const J3 = '5511987650003@s.whatsapp.net'
    quoteChat(J3)
    saveDeal(ACC, { chatJid: J3, status: 'won', amountCents: 1000 })
    expect(await R.scanCandidates(ACC)).toBe(0)
  })

  test('precedência com o robô: conversa esperando atendente ou com resposta do robô a caminho não entra', async () => {
    quoteChat()
    getDb()
      .prepare("INSERT INTO chat_ai_mode (account_id, chat_jid, mode, updated_at) VALUES (?, ?, 'espera', ?)")
      .run(ACC, JID, Date.now())
    expect(await R.scanCandidates(ACC)).toBe(0)
  })

  test('não abre dois acompanhamentos para a mesma conversa nem repete logo depois do fim', async () => {
    quoteChat()
    expect(await R.scanCandidates(ACC)).toBe(1)
    expect(await R.scanCandidates(ACC)).toBe(0)
    R.stopFollowupById(ACC, (getDb().prepare('SELECT id FROM followups').get() as { id: number }).id)
    expect(await R.scanCandidates(ACC)).toBe(0) // 30 dias de descanso após parada manual
  })

  test('interesse pela IA: só trechos anonimizados vão, e "sem interesse" não é perguntado de novo', async () => {
    R.saveRecoverySettings(ACC, { byInterest: true, byQuote: false, byFunnel: false })
    addMsg(false, 'Oi sou a Ana Souza, quanto custa a armação? meu email ana@x.com', nowSec() - 2 * DAY - 60)
    addMsg(true, 'A partir de R$ 199.', nowSec() - 2 * DAY)
    mockComplete.mockResolvedValueOnce({ text: '{"interesse":false}', provider: 't', model: 'm' })
    expect(await R.scanCandidates(ACC)).toBe(0)
    const sentPrompt = mockComplete.mock.calls[0][0].prompt
    expect(sentPrompt).not.toContain('ana@x.com')
    expect(sentPrompt).not.toContain('Ana Souza')
    expect(mockComplete.mock.calls[0][0].customerData).toBe(true)
    expect(await R.scanCandidates(ACC)).toBe(0)
    expect(mockComplete).toHaveBeenCalledTimes(1)
  })

  test('interesse pela IA: com interesse, abre; se a IA cai, não abre', async () => {
    R.saveRecoverySettings(ACC, { byInterest: true, byQuote: false, byFunnel: false })
    addMsg(false, 'Quanto custa?', nowSec() - 2 * DAY - 60)
    addMsg(true, 'A partir de R$ 199.', nowSec() - 2 * DAY)
    mockComplete.mockRejectedValueOnce(new Error('fora'))
    expect(await R.scanCandidates(ACC)).toBe(0)
    R.resetRecoveryState()
    mockComplete.mockResolvedValueOnce({ text: '{"interesse":true}', provider: 't', model: 'm' })
    expect(await R.scanCandidates(ACC)).toBe(1)
    expect((getDb().prepare('SELECT reason_in FROM followups').get() as { reason_in: string }).reason_in).toBe('interesse')
  })
})

describe('mensagem e contexto enviados à IA', () => {
  test('conversa anonimizada e sem o nome; notas entram', async () => {
    quoteChat()
    addMsg(false, 'Meu telefone é 11 98765-4321, sou Ana Souza', nowSec() - 2 * DAY - 300)
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    const req = mockComplete.mock.calls[0][0]
    expect(req.customerData).toBe(true)
    expect(req.prompt).not.toContain('98765-4321')
    expect(req.prompt).not.toContain('Ana Souza')
    expect(req.system).toContain('Armação a partir de R$ 199')
  })
})

describe('venda recuperada em Vendas e no Painel', () => {
  test('venda marcada depois da tentativa vira origem Recuperação, com o custo do desconto', async () => {
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 1, discountCapReais: null })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Consegui {DESCONTO} para você.'))
    await runUntilQueued()
    R.approveAttempt(ACC, R.listQueue(ACC)[0].id)
    await flush()
    R.onClientReply(ACC, addMsg(false, 'Fechado, vou levar', nowSec()))
    expect(fup().status).toBe('parado')

    const d = saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000, product: 'Armação' })
    expect(d.sourceType).toBe('recovery')
    expect(d.sourceName).toBe('Recuperação')
    expect(fup().status).toBe('recuperada')
    const st = R.recoveryStats(ACC)
    expect(st).toMatchObject({ sent: 1, replied: 1, recovered: 1, recoveredCents: 9000, discountCents: 1000 })

    const p = panel({ accountIds: [ACC], from: Date.now() - 86_400_000, to: Date.now() + 1000, bucket: 'day' })
    expect(p.totals).toMatchObject({ recovered: 1, recoveredCents: 9000, recoveredDiscountCents: 1000 })

    // apagar a venda tira a recuperação e o custo
    deleteDeal(ACC, d.id)
    expect(R.recoveryStats(ACC)).toMatchObject({ recovered: 0, discountCents: 0 })
  })

  test('sem recuperação enviada, a venda segue como espontânea', () => {
    quoteChat()
    expect(saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 5000 }).sourceType).toBe('organic')
  })

  test('desconto vencido não conta como custo', async () => {
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 1 })
    quoteChat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Consegui {DESCONTO}.'))
    await runUntilQueued()
    R.approveAttempt(ACC, R.listQueue(ACC)[0].id)
    await flush()
    getDb().prepare('UPDATE followup_attempts SET valid_until = ?').run(Date.now() - 1000)
    saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000 })
    expect(R.recoveryStats(ACC)).toMatchObject({ recovered: 1, discountCents: 0 })
  })
})

describe('módulo e dependência', () => {
  test('sem o Assistente de IA o módulo desliga; com o módulo desligado nada é enviado', async () => {
    updateAccount(ACC, { modules: { ia: false } })
    const { getAccount } = await import('../src/main/accounts')
    expect(getAccount(ACC)?.modules.recuperacao).toBe(false)
    expect(R.recoveryActive(ACC)).toBe(false)
  })
})
