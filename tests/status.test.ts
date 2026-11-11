import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let userData = tmpdir()
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

// WhatsApp simulado
const calls: Array<{ jid: string; content: Record<string, unknown>; opts: Record<string, unknown> }> = []
let connected = true
let failWith: string | null = null
/** envio que nunca responde (conexão travada) */
let hang = false
/** roda no meio do envio (ex.: usuário cancela) */
let duringSend: (() => void) | null = null
const fakeSock = {
  user: { id: '5511900000000:1@s.whatsapp.net' },
  sendMessage: async (jid: string, content: Record<string, unknown>, opts: Record<string, unknown>) => {
    if (hang) return new Promise(() => undefined)
    duringSend?.()
    if (failWith) throw new Error(failWith)
    calls.push({ jid, content, opts })
    return { key: { remoteJid: jid, fromMe: true, id: `ST${calls.length}` } }
  }
}
vi.mock('../src/main/wa/manager', () => ({
  wa: { getSocket: () => (connected ? fakeSock : null), on: () => undefined }
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as people from '../src/main/people'
import * as S from '../src/main/status'

const ACC = '55555555-5555-4555-8555-555555555555'

function contact(name: string, phone: string, tags: string[], wa = true): number {
  const p = people.savePerson(ACC, { name, phone, tags })
  if (wa) people.markHasWa(p.id, `55${phone}@s.whatsapp.net`, true)
  return p.id
}

beforeEach(() => {
  closeDb()
  userData = mkdtempSync(join(tmpdir(), 'dsp-status-'))
  openDb(join(userData, 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica Centro', '#000000', JSON.stringify({ status: true }), Date.now())
  S.resetStatusRuntime()
  calls.length = 0
  connected = true
  failWith = null
  hang = false
  duringSend = null
  contact('Ana', '11987650001', ['VIP'])
  contact('Bruno', '11987650002', [])
  contact('Carla', '11987650003', ['VIP', 'Fornecedor'])
  contact('Sem Zap', '11987650004', ['VIP'], false)
  contact('Saiu', '11987650005', ['VIP'])
  people.optOutByJid(ACC, '5511987650005@s.whatsapp.net')
})

const jid = (n: string): string => `551198765000${n}@s.whatsapp.net`

describe('quem vê o status', () => {
  test('todos: só quem tem WhatsApp e não pediu para sair', () => {
    expect(S.statusAudienceJids(ACC, { modo: 'todos', tags: [] })).toEqual([jid('1'), jid('2'), jid('3')])
  })

  test('por etiqueta', () => {
    expect(S.statusAudienceJids(ACC, { modo: 'etiqueta', tags: ['VIP'] })).toEqual([jid('1'), jid('3')])
  })

  test('todos menos a etiqueta', () => {
    expect(S.statusAudienceJids(ACC, { modo: 'todos_menos', tags: ['Fornecedor'] })).toEqual([jid('1'), jid('2')])
  })

  test('contagem mostra quem ficou de fora', () => {
    const c = S.countStatusAudience(ACC, { modo: 'etiqueta', tags: ['VIP'] })
    expect(c).toMatchObject({ total: 2, semWhatsapp: 1, optedOut: 1, large: false })
  })

  test('quem entra na supressão some da lista', () => {
    getDb().prepare('INSERT INTO suppression (account_id, key, at) VALUES (?, ?, ?)').run(ACC, jid('2'), Date.now())
    expect(S.statusAudienceJids(ACC, { modo: 'todos', tags: [] })).toEqual([jid('1'), jid('3')])
  })
})

describe('postagem', () => {
  test('agora: chama sendMessage em status@broadcast com a lista certa, cor e fonte', async () => {
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Promoção de óculos de sol!',
      background: '#AA3300',
      font: 6,
      audience: { modo: 'etiqueta', tags: ['VIP'] },
      scheduledAt: null
    })
    await S.runDueStatus(ACC)
    expect(calls).toHaveLength(1)
    expect(calls[0].jid).toBe('status@broadcast')
    expect(calls[0].content).toEqual({ text: 'Promoção de óculos de sol!' })
    expect(calls[0].opts).toEqual({
      statusJidList: [jid('1'), jid('3'), '5511900000000@s.whatsapp.net'],
      backgroundColor: '#AA3300',
      font: 6
    })
    const done = S.getStatusPost(p.id)!
    expect(done).toMatchObject({ status: 'enviado', recipientsCount: 2, error: null })
    expect(done.sentAt).toBeTypeOf('number')
  })

  test('foto: manda a imagem com legenda', async () => {
    S.createStatusPost({
      accountId: ACC,
      kind: 'imagem',
      text: 'Chegou coleção nova',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: null,
      media: { name: 'foto.jpg', mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) }
    })
    await S.runDueStatus(ACC)
    expect(calls[0].content).toMatchObject({ caption: 'Chegou coleção nova', mimetype: 'image/jpeg' })
    expect(Buffer.isBuffer(calls[0].content.image)).toBe(true)
    expect(calls[0].opts).toEqual({ statusJidList: [jid('1'), jid('2'), jid('3'), '5511900000000@s.whatsapp.net'] })
  })

  test('vídeo fora do padrão é recusado', () => {
    expect(() =>
      S.createStatusPost({
        accountId: ACC,
        kind: 'video',
        text: '',
        audience: { modo: 'todos', tags: [] },
        scheduledAt: null,
        media: { name: 'v.mov', mime: 'video/quicktime', data: new Uint8Array([1]) }
      })
    ).toThrow(/MP4/)
    expect(() =>
      S.createStatusPost({
        accountId: ACC,
        kind: 'video',
        text: '',
        audience: { modo: 'todos', tags: [] },
        scheduledAt: null,
        media: { name: 'v.mp4', mime: 'video/mp4', data: new Uint8Array(S.STATUS_MEDIA_MAX_BYTES + 1) }
      })
    ).toThrow(/16 MB/)
  })

  test('agendado só sai quando vence', async () => {
    const at = Date.now() + 3600_000
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Abrimos sábado',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: at
    })
    await S.runDueStatus(ACC)
    expect(calls).toHaveLength(0)
    expect(S.getStatusPost(p.id)!.status).toBe('agendado')
    await S.runDueStatus(ACC, at + 1000)
    expect(calls).toHaveLength(1)
    expect(S.getStatusPost(p.id)!.status).toBe('enviado')
  })

  test('conta desconectada: fica pendente e sai quando conectar', async () => {
    const at = Date.now() + 1000
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: at
    })
    connected = false
    await S.runDueStatus(ACC, at + 5000)
    expect(S.getStatusPost(p.id)!.status).toBe('agendado')
    expect(calls).toHaveLength(0)
    connected = true
    await S.runDueStatus(ACC, at + 60_000)
    expect(S.getStatusPost(p.id)!.status).toBe('enviado')
  })

  test('postar agora com a conta desconectada avisa', () => {
    connected = false
    expect(() =>
      S.createStatusPost({
        accountId: ACC,
        kind: 'texto',
        text: 'Oi',
        audience: { modo: 'todos', tags: [] },
        scheduledAt: null
      })
    ).toThrow(/não está conectado/)
  })

  test('falha do envio: status falhou com o erro', async () => {
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: null
    })
    failWith = 'Connection Closed'
    await S.runDueStatus(ACC)
    expect(S.getStatusPost(p.id)).toMatchObject({ status: 'falhou', error: 'Connection Closed' })
  })

  test('cancelar agendado', async () => {
    const at = Date.now() + 1000
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: at
    })
    expect(S.cancelStatusPost(ACC, p.id).status).toBe('cancelado')
    await S.runDueStatus(ACC, at + 1000)
    expect(calls).toHaveLength(0)
  })

  test('módulo desligado: não posta, espera', async () => {
    getDb().prepare('UPDATE accounts SET modules = ? WHERE id = ?').run('{}', ACC)
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: null
    })
    await S.runDueStatus(ACC)
    expect(calls).toHaveLength(0)
    expect(S.getStatusPost(p.id)!.status).toBe('agendado')
  })

  test('app fechou no meio da postagem: vira falha, não reposta', () => {
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: null
    })
    getDb().prepare("UPDATE status_posts SET status = 'enviando', sent_at = ? WHERE id = ?").run(Date.now(), p.id)
    expect(S.recoverInterrupted()).toBe(1)
    expect(S.getStatusPost(p.id)!.status).toBe('falhou')
  })
})

describe('limite diário', () => {
  // Data fixa: sem isso o teste quebra perto da meia-noite
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  const novo = (scheduledAt: number | null = null): S.StatusInput => ({
    accountId: ACC,
    kind: 'texto',
    text: 'Oi',
    audience: { modo: 'todos', tags: [] },
    scheduledAt
  })

  test('padrão é 10 e é configurável', () => {
    expect(S.getStatusSettings(ACC).dailyLimit).toBe(S.STATUS_DAILY_LIMIT_DEFAULT)
    expect(S.STATUS_DAILY_LIMIT_DEFAULT).toBe(10)
    expect(S.setStatusSettings(ACC, { dailyLimit: 3 }).dailyLimit).toBe(3)
    expect(S.setStatusSettings(ACC, { dailyLimit: 0 }).dailyLimit).toBe(1)
  })

  test('não deixa passar do limite no mesmo dia, contando enviados e agendados', async () => {
    S.setStatusSettings(ACC, { dailyLimit: 2 })
    S.createStatusPost(novo())
    await S.runDueStatus(ACC)
    S.createStatusPost(novo(Date.now() + 1000)) // agendado para hoje também conta
    expect(() => S.createStatusPost(novo())).toThrow(/Limite de 2/)
    // outro dia: pode
    const amanha = new Date()
    amanha.setDate(amanha.getDate() + 1)
    amanha.setHours(10, 0, 0, 0)
    expect(S.createStatusPost(novo(amanha.getTime())).status).toBe('agendado')
  })

  test('limite atingido na hora de postar: falhou com aviso', async () => {
    S.setStatusSettings(ACC, { dailyLimit: 1 })
    const at = Date.now() + 1000
    const p = S.createStatusPost(novo(at))
    // alguém postou antes (ex.: limite reduzido depois de agendar)
    getDb()
      .prepare(
        "INSERT INTO status_posts (account_id, kind, text, audience, scheduled_at, status, sent_at, created_at) VALUES (?, 'texto', 'x', '{}', ?, 'enviado', ?, ?)"
      )
      .run(ACC, Date.now(), Date.now(), Date.now())
    await S.runDueStatus(ACC, at + 1000)
    expect(calls).toHaveLength(0)
    expect(S.getStatusPost(p.id)).toMatchObject({ status: 'falhou' })
    expect(S.getStatusPost(p.id)!.error).toMatch(/Limite de 1/)
  })
})

describe('lista grande', () => {
  test('passa do teto: avisa mas deixa postar', async () => {
    const db = getDb()
    const ins = db.prepare(
      'INSERT INTO people (account_id, phone, jid, has_wa, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
    )
    for (let i = 0; i < S.STATUS_LARGE_AUDIENCE + 5; i++) {
      const phone = `55219${String(i).padStart(8, '0')}`
      ins.run(ACC, phone, `${phone}@s.whatsapp.net`, Date.now(), Date.now())
    }
    const c = S.countStatusAudience(ACC, { modo: 'todos', tags: [] })
    expect(c.large).toBe(true)
    expect(c.limit).toBe(S.STATUS_LARGE_AUDIENCE)
    S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: null
    })
    await S.runDueStatus(ACC)
    expect(calls).toHaveLength(1)
  })
})

/** MP4 mínimo com a caixa mvhd (versão 0): só serve para ler a duração. */
function mp4(seconds: number, timescale = 1000): Uint8Array {
  const box = (type: string, ...parts: Buffer[]): Buffer => {
    const body = Buffer.concat(parts)
    const h = Buffer.alloc(8)
    h.writeUInt32BE(body.length + 8, 0)
    h.write(type, 4, 'ascii')
    return Buffer.concat([h, body])
  }
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(timescale, 12)
  mvhd.writeUInt32BE(Math.round(seconds * timescale), 16)
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000')),
    box('moov', box('mvhd', mvhd)),
    box('mdat', Buffer.alloc(16))
  ])
}

describe('duração do vídeo (validada no processo principal)', () => {
  const video = (data: Uint8Array): S.StatusInput => ({
    accountId: ACC,
    kind: 'video',
    text: '',
    audience: { modo: 'todos', tags: [] },
    scheduledAt: null,
    media: { name: 'v.mp4', mime: 'video/mp4', data }
  })

  test('mais de 90 segundos é recusado', () => {
    expect(() => S.createStatusPost(video(mp4(91)))).toThrow(/90 segundos/)
  })

  test('até 90 segundos passa', () => {
    expect(S.createStatusPost(video(mp4(90))).status).toBe('agendado')
    expect(S.readMp4Seconds(mp4(12.5, 600))).toBeCloseTo(12.5)
  })

  test('mvhd com duração 0 ou 0xFFFFFFFF (fragmentado) conta como não lido e é recusado', () => {
    for (const d of [mp4(0), mp4(0xffffffff / 1000)]) {
      expect(S.readMp4Seconds(d)).toBeNull()
      expect(() => S.createStatusPost(video(d))).toThrow(/duração/)
    }
  })

  test('arquivo que não é MP4 legível é recusado', () => {
    expect(() => S.createStatusPost(video(new Uint8Array([1, 2, 3])))).toThrow(/duração/)
  })
})

describe('envio travado e cancelamento', () => {
  afterEach(() => vi.useRealTimers())
  const agora = (): S.StatusInput => ({
    accountId: ACC,
    kind: 'texto',
    text: 'Oi',
    audience: { modo: 'todos', tags: [] },
    scheduledAt: null
  })

  test('sendMessage sem resposta: expira, marca falhou (conta no limite) e segura os próximos até saber', async () => {
    vi.useFakeTimers()
    hang = true
    const p = S.createStatusPost(agora())
    const run = S.runDueStatus(ACC)
    await vi.advanceTimersByTimeAsync(S.STATUS_SEND_TIMEOUT_MS + 100)
    await run
    expect(S.getStatusPost(p.id)).toMatchObject({ status: 'falhou' })
    expect(S.getStatusPost(p.id)!.error).toMatch(/demorou/)
    // resultado incerto: os próximos esperam o prazo; depois dele o agendador volta a postar
    hang = false
    const q = S.createStatusPost(agora())
    await S.runDueStatus(ACC)
    expect(S.getStatusPost(q.id)!.status).toBe('agendado')
    await vi.advanceTimersByTimeAsync(S.STATUS_UNCERTAIN_HOLD_MS + 1000)
    await S.runDueStatus(ACC)
    expect(S.getStatusPost(q.id)!.status).toBe('enviado')
  })

  test('cancelar durante o envio não muda o resultado: já saiu', async () => {
    const p = S.createStatusPost(agora())
    duringSend = () => {
      expect(() => S.cancelStatusPost(ACC, p.id)).toThrow(/ainda não saíram/)
    }
    await S.runDueStatus(ACC)
    expect(S.getStatusPost(p.id)!.status).toBe('enviado')
  })

  test('cancelado depois de a lista de vencidos ser lida não vira falhou', async () => {
    const at = Date.now() + 1000
    const p = S.createStatusPost({ ...agora(), scheduledAt: at })
    const velha = S.getStatusPost(p.id)! // cópia lida antes do cancelamento
    S.cancelStatusPost(ACC, p.id)
    // sem público: o caminho que antes chamava finish() por cima do cancelado
    getDb().prepare('UPDATE people SET has_wa = 0').run()
    expect(await S.postStatus(velha, fakeSock as never)).toBeDefined()
    expect(S.getStatusPost(p.id)!.status).toBe('cancelado')
  })
})

describe('janela de 24 h, limpeza e concorrência', () => {
  test('agendado há mais de 24 h sem conexão não sai: falhou', async () => {
    const at = Date.now() + 1000
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: at
    })
    await S.runDueStatus(ACC, at + 24 * 3600_000 + 1000)
    expect(calls).toHaveLength(0)
    expect(S.getStatusPost(p.id)).toMatchObject({ status: 'falhou' })
    expect(S.getStatusPost(p.id)!.error).toMatch(/24 horas/)
  })

  test('dentro das 24 h ainda sai', async () => {
    const at = Date.now() + 1000
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: at
    })
    await S.runDueStatus(ACC, at + 23 * 3600_000)
    expect(S.getStatusPost(p.id)!.status).toBe('enviado')
  })

  test('limpeza apaga a mídia de postagens com mais de 7 dias e mantém as recentes', () => {
    const mk = (file: string, sentAt: number): number => {
      mkdirSync(join(userData, 'status-media'), { recursive: true })
      writeFileSync(join(userData, 'status-media', file), 'x')
      return Number(
        getDb()
          .prepare(
            "INSERT INTO status_posts (account_id, kind, audience, media, scheduled_at, status, sent_at, created_at) VALUES (?, 'imagem', '{}', ?, ?, 'enviado', ?, ?)"
          )
          .run(ACC, JSON.stringify({ name: 'a', mime: 'image/png', file, size: 1 }), sentAt, sentAt, sentAt)
          .lastInsertRowid
      )
    }
    const now = Date.now()
    const velha = mk('velha.png', now - 8 * 86_400_000)
    const nova = mk('nova.png', now - 2 * 86_400_000)
    S.cleanupStatusMedia(now)
    expect(existsSync(join(userData, 'status-media', 'velha.png'))).toBe(false)
    expect(existsSync(join(userData, 'status-media', 'nova.png'))).toBe(true)
    expect(S.getStatusPost(velha)!.media?.file).toBe('')
    expect(S.getStatusPost(nova)!.media?.file).toBe('nova.png')
  })

  test('duas verificações ao mesmo tempo não postam em dobro', async () => {
    const p = S.createStatusPost({
      accountId: ACC,
      kind: 'texto',
      text: 'Oi',
      audience: { modo: 'todos', tags: [] },
      scheduledAt: null
    })
    await Promise.all([S.runDueStatus(ACC), S.runDueStatus(ACC), S.runDueStatus(ACC)])
    expect(calls).toHaveLength(1)
    expect(S.getStatusPost(p.id)!.status).toBe('enviado')
  })
})
