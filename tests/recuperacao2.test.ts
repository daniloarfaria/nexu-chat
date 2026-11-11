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
import { isOptedOut } from '../src/main/people'
import { saveDeal, deleteDeal } from '../src/main/deals'
import { saveLidMappings } from '../src/main/wa/store'
import type { MessageItem } from '../src/shared/types'
import * as R from '../src/main/recuperacao'

const ACC = '99999999-9999-4999-8999-999999999998'
const JID = '5511987650001@s.whatsapp.net'
const LID = '123456789012345@lid'
const mockComplete = vi.mocked(complete)
const DAY = 86_400
const nowSec = (): number => Math.floor(Date.now() / 1000)
let seq = 0

function addMsg(fromMe: boolean, text: string | null, at: number, jid = JID, extra: object | null = null): MessageItem {
  const id = `m${++seq}`
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO chats (account_id, jid, name, last_ts, is_group) VALUES (?, ?, ?, ?, 0)').run(
    ACC,
    jid,
    'Ana Souza',
    at
  )
  db.prepare('UPDATE chats SET last_ts = MAX(last_ts, ?) WHERE account_id = ? AND jid = ?').run(at, ACC, jid)
  db.prepare(
    'INSERT INTO messages (account_id, chat_jid, id, from_me, ts, type, text, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ACC, jid, id, fromMe ? 1 : 0, at, 'text', text, extra ? JSON.stringify(extra) : null)
  return { id, chatJid: jid, fromMe, ts: at, type: 'text', text } as unknown as MessageItem
}

/** Ids da seleção: funil com uma coluna em andamento escolhida e uma etiqueta escolhida. */
let STAGE = 0
let STAGE_WON = 0
const TAG = 'Quer comprar'

function person(jid: string, tag: string | null = TAG): number {
  const db = getDb()
  const pid = Number(
    db
      .prepare('INSERT INTO people (account_id, phone, jid, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
      .run(ACC, jid.split('@')[0], jid, 'Ana Souza').lastInsertRowid
  )
  if (tag) db.prepare('INSERT INTO person_tags (person_id, tag) VALUES (?, ?)').run(pid, tag)
  return pid
}

/** Conversa em que a loja respondeu e o cliente sumiu há 2 dias, com a etiqueta escolhida na regra. */
function chat(jid = JID, tag: string | null = TAG): void {
  addMsg(false, 'Quanto custa a armação?', nowSec() - 2 * DAY - 600, jid)
  addMsg(true, 'A armação sai a partir de R$ 199.', nowSec() - 2 * DAY, jid)
  person(jid, tag)
}

const ai = (texto: string): { text: string; provider: string; model: string } => ({
  text: JSON.stringify({ acao: 'enviar', texto }),
  provider: 't',
  model: 'm'
})
const flush = async (): Promise<void> => {
  await Promise.all(h.jobs.splice(0))
}
const attempts = (): Array<{ n: number; status: string; text: string; offer: string | null }> =>
  getDb().prepare('SELECT n, status, text, offer FROM followup_attempts ORDER BY id').all() as never
const fup = (): { status: string; stop_reason: string | null; attempts_done: number; reason_in: string } =>
  getDb().prepare('SELECT * FROM followups ORDER BY id DESC LIMIT 1').get() as never
async function runUntilQueued(): Promise<void> {
  expect(await R.scanCandidates(ACC)).toBe(1)
  expect(await R.processDue(ACC)).toBe(1)
}

function insFollowup(
  jid: string,
  o: {
    status?: string
    stop?: string | null
    startedDaysAgo?: number
    lastClientDaysAgo?: number
    due?: number | null
  } = {}
): number {
  const now = Date.now()
  return Number(
    getDb()
      .prepare(
        `INSERT INTO followups (account_id, chat_jid, status, stop_reason, reason_in, last_client_ts, next_due_at, started_at, updated_at)
         VALUES (?, ?, ?, ?, 'etiqueta', ?, ?, ?, ?)`
      )
      .run(
        ACC,
        jid,
        o.status ?? 'ativo',
        o.stop ?? null,
        nowSec() - Math.round((o.lastClientDaysAgo ?? 2) * DAY),
        o.due === undefined ? now : o.due,
        now - Math.round((o.startedDaysAgo ?? 0) * DAY * 1000),
        now
      ).lastInsertRowid
  )
}
function insAttempt(fid: number, jid: string, status = 'pendente'): number {
  return Number(
    getDb()
      .prepare(
        'INSERT INTO followup_attempts (followup_id, account_id, chat_jid, n, status, text, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)'
      )
      .run(fid, ACC, jid, status, 'Oi!', Date.now()).lastInsertRowid
  )
}

beforeEach(() => {
  R.resetRecoveryState()
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-rec2-')), 'db.sqlite'))
  const db = getDb()
  db.prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)').run(
    ACC,
    'Ótica Centro',
    '#000000',
    '{}',
    Date.now()
  )
  // Funil configurável: os nomes das colunas NÃO significam nada para o app, só o tipo (kind)
  const pl = Number(
    db.prepare("INSERT INTO pipelines (account_id, name, created_at) VALUES (?, 'Funil', ?)").run(ACC, Date.now())
      .lastInsertRowid
  )
  const st = db.prepare('INSERT INTO pipeline_stages (pipeline_id, name, kind, position) VALUES (?, ?, ?, ?)')
  STAGE = Number(st.run(pl, 'Coluna A', 'open', 0).lastInsertRowid)
  STAGE_WON = Number(st.run(pl, 'Orçamento fechado', 'won', 1).lastInsertRowid)
  updateAccount(ACC, { modules: { ia: true, recuperacao: true } })
  R.saveRecoverySettings(ACC, { enabled: true, tags: [TAG], stageIds: [] })
  setAntiBan(ACC, { hourStart: 0, hourEnd: 24, days: [0, 1, 2, 3, 4, 5, 6] })
  saveBusinessContext(ACC, {
    products: 'Armação a partir de R$ 199. Lente pronta em 7 dias.',
    hours: 'Seg a sáb, 9h às 18h'
  })
  R.tuning.sleep = async () => undefined
  h.jobs.length = 0
  h.sent.length = 0
  h.sock = { sendPresenceUpdate: async () => undefined }
  seq = 0
  mockComplete.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('entrada configurada pelo usuário (nada de adivinhar pelo nome)', () => {
  const put = (pid: number, stage: number): void => {
    const pl = (
      getDb().prepare('SELECT pipeline_id AS p FROM pipeline_stages WHERE id = ?').get(stage) as { p: number }
    ).p
    getDb()
      .prepare(
        'INSERT INTO pipeline_cards (pipeline_id, stage_id, person_id, position, created_at, moved_at) VALUES (?, ?, ?, 1, ?, ?)'
      )
      .run(pl, stage, pid, Date.now(), Date.now())
  }
  const bare = (): void => {
    addMsg(false, 'Oi', nowSec() - 2 * DAY - 60)
    addMsg(true, 'Olá!', nowSec() - 2 * DAY)
  }

  test('sem nenhuma coluna nem etiqueta escolhida, nada entra por funil ou etiqueta', async () => {
    R.saveRecoverySettings(ACC, { tags: [], stageIds: [] })
    chat(JID, 'Orçamento')
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('etiqueta com "orçamento" no nome não entra se o usuário não escolheu', async () => {
    chat(JID, 'Orçamento')
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('etiqueta escolhida entra, com qualquer nome', async () => {
    chat()
    expect(await R.scanCandidates(ACC)).toBe(1)
    expect(fup().reason_in).toBe('etiqueta')
  })
  test('coluna escolhida (por id) entra; coluna não escolhida não, mesmo com outro nome parecido', async () => {
    R.saveRecoverySettings(ACC, { tags: [], stageIds: [STAGE] })
    bare()
    const pid = person(JID, null)
    put(pid, STAGE)
    expect(await R.scanCandidates(ACC)).toBe(1)
    expect(fup().reason_in).toBe('funil')
  })
  test('coluna de ganho (kind) nunca entra, mesmo escolhida, e o nome não importa', async () => {
    R.saveRecoverySettings(ACC, { tags: [], stageIds: [STAGE_WON] })
    bare()
    put(person(JID, null), STAGE_WON)
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('cartão em coluna de ganho tira o cliente da etiqueta escolhida (kind, não nome)', async () => {
    chat()
    const pid = (getDb().prepare('SELECT id FROM people').get() as { id: number }).id
    put(pid, STAGE_WON)
    // O cliente tem a etiqueta, mas o cartão dele já está em ganho: não entra
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('o nome da coluna de ganho com "perdido" no texto não muda nada: vale o kind', async () => {
    getDb().prepare("UPDATE pipeline_stages SET name = 'Perdido talvez', kind = 'open' WHERE id = ?").run(STAGE)
    R.saveRecoverySettings(ACC, { tags: [], stageIds: [STAGE] })
    bare()
    put(person(JID, null), STAGE)
    expect(await R.scanCandidates(ACC)).toBe(1)
  })
  test('a regra guarda só ids que existem e limita a quantidade', () => {
    const s = R.saveRecoverySettings(ACC, {
      stageIds: [STAGE, STAGE, 999_999, -1],
      tags: [TAG, TAG, '  ', 'x'.repeat(100)]
    })
    expect(s.stageIds).toEqual([STAGE])
    expect(s.tags).toEqual([TAG])
  })
  test('deixa de ser elegível se a etiqueta sai da regra no meio do acompanhamento', async () => {
    chat()
    mockComplete.mockResolvedValue(ai('Oi! Ficou alguma dúvida sobre a armação?'))
    expect(await R.scanCandidates(ACC)).toBe(1)
    R.saveRecoverySettings(ACC, { tags: [] })
    await R.processDue(ACC)
    expect(fup().stop_reason).toBe('nao_se_aplica')
    expect(mockComplete).not.toHaveBeenCalled()
  })
})

describe('C1: fusão LID para número', () => {
  test('o acompanhamento e as mensagens da fila acompanham a conversa', () => {
    const f = insFollowup(LID)
    insAttempt(f, LID)
    saveLidMappings(ACC, [{ lid: LID, pn: JID }])
    expect(getDb().prepare('SELECT chat_jid, status, stop_reason FROM followups WHERE id = ?').get(f)).toEqual({
      chat_jid: JID,
      status: 'ativo',
      stop_reason: null
    })
    expect(getDb().prepare('SELECT chat_jid FROM followup_attempts').get()).toEqual({ chat_jid: JID })
    expect(R.listQueue(ACC)[0].chatName).not.toMatch(/^\+1234/)
  })
  test('os dois lados ativos: um para antes e a fusão não cai', () => {
    const a = insFollowup(LID)
    insAttempt(a, LID)
    const b = insFollowup(JID)
    expect(() => saveLidMappings(ACC, [{ lid: LID, pn: JID }])).not.toThrow()
    const rows = getDb().prepare('SELECT id, chat_jid, status FROM followups ORDER BY id').all() as Array<{
      id: number
      chat_jid: string
      status: string
    }>
    expect(rows.filter((r) => r.status === 'ativo')).toHaveLength(1)
    expect(rows.every((r) => r.chat_jid === JID)).toBe(true)
    expect(rows.find((r) => r.id === b)?.status).toBe('ativo')
    expect(getDb().prepare('SELECT status FROM followup_attempts').get()).toEqual({ status: 'descartada' })
  })
})

describe('S1: SAIR', () => {
  test('texto SAIR grava o opt-out mesmo sem campanhas, lembretes e robô', () => {
    chat()
    R.onClientReply(ACC, addMsg(false, 'SAIR', nowSec()))
    expect(isOptedOut(ACC, JID)).toBe(true)
  })
  test('SAIR por áudio transcrito também', () => {
    chat()
    R.onClientReply(ACC, { ...addMsg(false, null, nowSec()), transcript: 'sair' } as unknown as MessageItem)
    expect(isOptedOut(ACC, JID)).toBe(true)
  })
  test('cliente que disse SAIR nunca reabre, nem depois de 30 dias', async () => {
    chat()
    insFollowup(JID, { status: 'parado', stop: 'sair', startedDaysAgo: 90 })
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('SAIR transcrito depois da aprovação segura o envio', async () => {
    chat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    const id = R.listQueue(ACC)[0].id
    getDb()
      .prepare(
        "INSERT INTO messages (account_id, chat_jid, id, from_me, ts, type, text, transcript) VALUES (?, ?, 'au1', 0, ?, 'voice', NULL, 'sair')"
      )
      .run(ACC, JID, nowSec())
    R.approveAttempt(ACC, id)
    await flush()
    expect(h.sent).toHaveLength(0)
    expect(isOptedOut(ACC, JID)).toBe(true)
  })
})

describe('S2: edição não duplica a oferta', () => {
  async function withOffer(): Promise<{ id: number; phrase: string }> {
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 1, discountCondition: 'na compra à vista' })
    chat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Consegui {DESCONTO} para você.'))
    await runUntilQueued()
    return { id: R.listQueue(ACC)[0].id, phrase: R.listQueue(ACC)[0].offer! }
  }
  test('texto editado que já tem a frase oficial fica com uma só', async () => {
    const { id, phrase } = await withOffer()
    R.approveAttempt(ACC, id, `Oi Ana! Consegui ${phrase} para você, é só responder.`)
    await flush()
    expect(h.sent[0].text.split(phrase)).toHaveLength(2)
  })
  test('oferta apagada de propósito: sai sem oferta e sem reinserir', async () => {
    const { id, phrase } = await withOffer()
    R.approveAttempt(ACC, id, 'Oi Ana, posso ajudar com a armação?')
    await flush()
    expect(h.sent[0].text).not.toContain(phrase)
    expect(h.sent[0].text).not.toMatch(/desconto/i)
  })
  test('sem a frase oficial o texto vale como tentativa sem oferta: percentual e desconto bloqueiam', async () => {
    const { id } = await withOffer()
    expect(() => R.approveAttempt(ACC, id, 'Oi Ana, faço 10% para você.')).toThrow()
    expect(() => R.approveAttempt(ACC, id, 'Oi Ana, tenho um desconto.')).toThrow()
  })
})

describe('S3: contornos do filtro', () => {
  const src = 'Armação a partir de R$ 199.'
  const offer = (): R.Offer => R.offerFor(R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 1 }), 1)!
  test.each([
    'Ótimo descontão hoje',
    'Preço promocional só hoje',
    'Preço especial para você',
    'Com abatimento na armação',
    'Pela metade do valor',
    'Fica pela metade',
    'Dez porcento a menos',
    'Em 3 parcelas',
    'Posso parcelado',
    'Parcele como quiser',
    'Só com entrada de metade'
  ])('bloqueia com a oferta da regra no texto: %s', (t) => {
    const o = offer()
    expect(R.checkRecoveryReply(`Consegui ${o.phrase}. ${t}`, { source: src, offer: o }).ok, t).toBe(false)
  })
  test.each([
    'Temos uma condição especial',
    'Oferta exclusiva para você',
    'Um valor melhor para você',
    'Preço melhor só hoje',
    'Exclusividade de hoje'
  ])('bloqueia em tentativa sem oferta: %s', (t) => {
    expect(R.checkRecoveryReply(t, { source: src, offer: null }).ok, t).toBe(false)
  })
  test.each([
    'Temos um desc\u200Bonto para você',
    'Temos um des\u00ADconto para você',
    'Temos um de\u2060sconto',
    'Temos um d\uFEFFesconto'
  ])('caracteres invisíveis não escondem o desconto em tentativa sem oferta: %j', (t) => {
    expect(R.checkRecoveryReply(t, { source: src, offer: null }).ok).toBe(false)
  })
  test('marca com chaves de largura total ou invisíveis é reconhecida', () => {
    const o = offer()
    for (const m of ['｛DESCONTO｝', '{DES​CONTO}', '{ desconto }']) {
      const r = R.composeText(`Oi! Consegui ${m} para você.`, o)
      expect(r.ok && r.text.includes(o.phrase), m).toBe(true)
      expect(r.ok && /[{}｛｝]/.test(r.text), m).toBe(false)
    }
    expect(R.composeText('Oi ｛DESCONTO｝', null).ok).toBe(false)
  })
})

describe('S4: acompanhamento vencido há muito expira', () => {
  test('vencido há mais de 48 horas: expira sem chamar a IA', async () => {
    chat()
    const f = insFollowup(JID, { due: Date.now() - 3 * DAY * 1000 })
    expect(await R.processDue(ACC)).toBe(0)
    expect(mockComplete).not.toHaveBeenCalled()
    expect(getDb().prepare('SELECT stop_reason FROM followups WHERE id = ?').get(f)).toEqual({
      stop_reason: 'expirado'
    })
  })
  test('cliente antigo demais expira', async () => {
    chat()
    const f = insFollowup(JID, { lastClientDaysAgo: 40 })
    expect(await R.processDue(ACC)).toBe(0)
    expect(mockComplete).not.toHaveBeenCalled()
    expect(getDb().prepare('SELECT stop_reason FROM followups WHERE id = ?').get(f)).toEqual({
      stop_reason: 'expirado'
    })
  })
  test('mensagem aprovada de acompanhamento velho não sai', async () => {
    chat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    getDb()
      .prepare('UPDATE followups SET last_client_ts = ?')
      .run(nowSec() - 40 * DAY)
    R.approveAttempt(ACC, R.listQueue(ACC)[0].id)
    await flush()
    expect(h.sent).toHaveLength(0)
  })
})

describe('S5: um ciclo por cliente a cada 30 dias', () => {
  test('respondeu há 10 dias: não reabre', async () => {
    chat()
    insFollowup(JID, { status: 'parado', stop: 'respondeu', startedDaysAgo: 10, lastClientDaysAgo: 13 })
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('concluído há 10 dias: não reabre', async () => {
    chat()
    insFollowup(JID, { status: 'concluido', startedDaysAgo: 10 })
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('depois de 30 dias reabre se a última fala do cliente foi substantiva', async () => {
    chat()
    insFollowup(JID, { status: 'parado', stop: 'respondeu', startedDaysAgo: 31, lastClientDaysAgo: 34 })
    expect(await R.scanCandidates(ACC)).toBe(1)
  })
  test('depois de 30 dias não reabre se a última fala do cliente foi só "ok" ou emoji', async () => {
    chat()
    insFollowup(JID, { status: 'parado', stop: 'respondeu', startedDaysAgo: 40, lastClientDaysAgo: 43 })
    getDb().prepare("UPDATE messages SET text = 'ok' WHERE from_me = 0").run()
    expect(await R.scanCandidates(ACC)).toBe(0)
    getDb().prepare("UPDATE messages SET text = '👍' WHERE from_me = 0").run()
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
})

describe('S6: só conta resposta de pessoa ou do robô', () => {
  test('boas-vindas e ausência automáticas não contam', async () => {
    chat()
    const rule = Number(
      getDb()
        .prepare(
          "INSERT INTO auto_rules (account_id, name, kind, reply, created_at) VALUES (?, 'B', 'welcome', 'Olá', ?)"
        )
        .run(ACC, Date.now()).lastInsertRowid
    )
    getDb()
      .prepare('INSERT INTO auto_log (account_id, rule_id, jid, at) VALUES (?, ?, ?, ?)')
      .run(ACC, rule, JID, (nowSec() - 2 * DAY + 3) * 1000)
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('campanha ou lembrete enviados ao cliente também não', async () => {
    chat()
    const c = Number(
      getDb()
        .prepare(
          "INSERT INTO campaigns (account_id, name, templates, audience, created_at) VALUES (?, 'P', '[]', '{}', ?)"
        )
        .run(ACC, Date.now()).lastInsertRowid
    )
    getDb()
      .prepare(
        "INSERT INTO campaign_targets (campaign_id, seq, jid, phone, status, sent_at) VALUES (?, 1, ?, '5511987650001', 'sent', ?)"
      )
      .run(c, JID, (nowSec() - 2 * DAY + 5) * 1000)
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
  test('resposta do robô conta', async () => {
    chat()
    getDb()
      .prepare('INSERT INTO ia_atendimento_log (account_id, chat_jid, at) VALUES (?, ?, ?)')
      .run(ACC, JID, (nowSec() - 2 * DAY) * 1000)
    expect(await R.scanCandidates(ACC)).toBe(1)
  })
})

describe('S7 e L3: venda recuperada', () => {
  async function sentRecovery(extra: Partial<Parameters<typeof R.saveRecoverySettings>[1]> = {}): Promise<void> {
    R.saveRecoverySettings(ACC, { discountPct: 10, discountFrom: 1, ...extra })
    chat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Consegui {DESCONTO}.'))
    await runUntilQueued()
    R.approveAttempt(ACC, R.listQueue(ACC)[0].id)
    await flush()
  }
  const reply = (): void => void R.onClientReply(ACC, addMsg(false, 'Fechado, vou levar!', nowSec()))
  test('venda perdida não vira recuperação', async () => {
    await sentRecovery()
    reply()
    expect(saveDeal(ACC, { chatJid: JID, status: 'lost', amountCents: 0, reason: 'Preço' }).sourceType).toBe('organic')
  })
  test('sem mensagem do cliente depois do envio, não é recuperação', async () => {
    await sentRecovery()
    expect(saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000 }).sourceType).toBe('organic')
  })
  test('valor absurdo não vira recuperação nem custo', async () => {
    await sentRecovery()
    reply()
    expect(saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 999_999_999_999 }).sourceType).toBe('organic')
    expect(R.recoveryStats(ACC).discountCents).toBe(0)
  })
  test('custo estimado nunca passa do percentual da regra sobre o valor', async () => {
    await sentRecovery()
    reply()
    saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000 })
    expect(R.recoveryStats(ACC).discountCents).toBeLessThanOrEqual(900)
    expect(R.recoveryStats(ACC).discountCents).toBeGreaterThan(0)
  })
  test('teto em reais vale na mensagem e no custo', async () => {
    await sentRecovery({ discountCapReais: 5 })
    expect(h.sent[0].text).toContain('desconto máximo de R$ 5')
    reply()
    saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 90000 })
    expect(R.recoveryStats(ACC).discountCents).toBe(500)
  })
  test('janela de 14 dias por padrão', async () => {
    await sentRecovery()
    reply()
    getDb()
      .prepare('UPDATE followup_attempts SET sent_at = ?')
      .run(Date.now() - 16 * DAY * 1000)
    expect(saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000 }).sourceType).toBe('organic')
  })
  test('janela maior quando a validade do desconto é de 30 dias', async () => {
    await sentRecovery({ discountValidDays: 30 })
    reply()
    getDb()
      .prepare('UPDATE followup_attempts SET sent_at = ?')
      .run(Date.now() - 20 * DAY * 1000)
    expect(saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000 }).sourceType).toBe('recovery')
  })
  test('precedência sobre campanha e anúncio', async () => {
    await sentRecovery()
    reply()
    const c = Number(
      getDb()
        .prepare(
          "INSERT INTO campaigns (account_id, name, templates, audience, created_at) VALUES (?, 'P', '[]', '{}', ?)"
        )
        .run(ACC, Date.now()).lastInsertRowid
    )
    getDb()
      .prepare(
        "INSERT INTO campaign_targets (campaign_id, seq, jid, phone, status, sent_at) VALUES (?, 1, ?, '5511987650001', 'sent', ?)"
      )
      .run(c, JID, Date.now() - 1000)
    getDb()
      .prepare(
        'INSERT INTO chat_attribution (account_id, chat_jid, ad_id, first_ts, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(ACC, JID, 'ad1', nowSec(), Date.now())
    expect(saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000 }).sourceType).toBe('recovery')
  })
  test('apagar a venda: o cliente não volta a ser elegível antes dos 30 dias', async () => {
    await sentRecovery()
    reply()
    const d = saveDeal(ACC, { chatJid: JID, status: 'won', amountCents: 9000 })
    deleteDeal(ACC, d.id)
    expect(fup().status).toBe('parado')
    expect(await R.scanCandidates(ACC)).toBe(0)
  })
})

describe('L2: desligar para os acompanhamentos', () => {
  test('desligar a regra para os ativos com o motivo "desligado"; religar não reanima', async () => {
    chat()
    expect(await R.scanCandidates(ACC)).toBe(1)
    R.saveRecoverySettings(ACC, { enabled: false })
    expect(fup()).toMatchObject({ status: 'parado', stop_reason: 'desligado' })
    R.saveRecoverySettings(ACC, { enabled: true })
    expect(fup().status).toBe('parado')
  })
  test('módulo desligado: a rodada para os ativos', async () => {
    chat()
    await R.scanCandidates(ACC)
    updateAccount(ACC, { modules: { recuperacao: false } })
    await R.tick()
    expect(fup()).toMatchObject({ status: 'parado', stop_reason: 'desligado' })
  })
})

describe('L4: uma notificação por rodada', () => {
  test('duas mensagens escritas na mesma rodada geram um só aviso', async () => {
    chat()
    chat('5511987650002@s.whatsapp.net')
    mockComplete.mockResolvedValue(ai('Oi! Ficou alguma dúvida?'))
    const seen: Array<{ count: number }> = []
    R.recoveryEvents.on('approval', (p: { count: number }) => seen.push(p))
    await R.tick()
    R.recoveryEvents.removeAllListeners('approval')
    expect(R.listQueue(ACC)).toHaveLength(2)
    expect(seen).toHaveLength(1)
    expect(seen[0].count).toBe(2)
  })
})

describe('L5: "digitando…" só depois da conferência', () => {
  test('conversa que já não pode receber nunca mostra digitando', async () => {
    R.saveRecoverySettings(ACC, { mode: 'auto' })
    chat()
    mockComplete.mockResolvedValueOnce(ai('Oi! Ficou alguma dúvida?'))
    await runUntilQueued()
    const presence = vi.fn(async () => undefined)
    h.sock = { sendPresenceUpdate: presence }
    addMsg(false, 'Pode ser amanhã?', nowSec()) // só o banco sabe, sem o gancho
    R.deliverApproved(ACC)
    await flush()
    expect(presence).not.toHaveBeenCalled()
  })
})

describe('L6: migração, módulo e intervalos', () => {
  test('índice único: um acompanhamento ativo por conversa; encerrado não conta', () => {
    insFollowup(JID)
    expect(() => insFollowup(JID)).toThrow()
    insFollowup(JID, { status: 'parado', stop: 'manual' })
  })
  test('apagar o número apaga acompanhamentos e mensagens (CASCADE)', () => {
    const f = insFollowup(JID)
    insAttempt(f, JID)
    getDb().prepare('DELETE FROM accounts WHERE id = ?').run(ACC)
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM followups').get()).toEqual({ n: 0 })
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM followup_attempts').get()).toEqual({ n: 0 })
  })
  test('sem o Assistente de IA, ligar o módulo não liga', async () => {
    updateAccount(ACC, { modules: { ia: false, recuperacao: true } })
    const { getAccount } = await import('../src/main/accounts')
    expect(getAccount(ACC)?.modules.recuperacao).toBe(false)
  })
  test('3 tentativas: 2ª com 2 dias e 3ª com 4 dias depois, em datas absolutas', async () => {
    R.saveRecoverySettings(ACC, { mode: 'auto', attempts: 3, gapDays: [2, 4] })
    chat()
    const t0 = Date.now()
    mockComplete.mockResolvedValue(ai('Oi! Ficou alguma dúvida sobre a armação?'))
    await R.scanCandidates(ACC)
    await R.processDue(ACC)
    R.deliverApproved(ACC)
    await flush()
    let due = (getDb().prepare('SELECT next_due_at AS d FROM followups').get() as { d: number }).d
    expect(Math.abs(due - (t0 + 2 * DAY * 1000))).toBeLessThan(60_000)
    getDb()
      .prepare('UPDATE followups SET next_due_at = ?')
      .run(Date.now() - 1000)
    await R.processDue(ACC)
    R.deliverApproved(ACC)
    await flush()
    const t1 = Date.now()
    due = (getDb().prepare('SELECT next_due_at AS d FROM followups').get() as { d: number }).d
    expect(Math.abs(due - (t1 + 4 * DAY * 1000))).toBeLessThan(60_000)
    expect(attempts().filter((a) => a.status === 'enviada')).toHaveLength(2)
  })
  test('atendente escreveu (pelo app ou pelo celular): para', async () => {
    chat()
    await R.scanCandidates(ACC)
    R.onHumanMessage(ACC, JID)
    expect(fup().stop_reason).toBe('atendente')
  })
})
