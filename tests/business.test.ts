import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { deflateRawSync } from 'node:zlib'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as people from '../src/main/people'
import * as C from '../src/main/campaigns'
import { pickRule } from '../src/main/automation'
import { violation } from '../src/main/groups'
import { matchesToday, dueToday, saveReminder } from '../src/main/reminders'
import { saveDeal, salesSummary } from '../src/main/deals'
import { anonymize } from '../src/main/ai/assistant'
import { candidates } from '../src/main/ai/router'
import type { AiProvider, AutoRule } from '../src/shared/types'

const ACC = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-biz-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica Centro', '#000000', '{}', Date.now())
})

function sheet(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Clientes')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

describe('importação de planilha', () => {
  test('sugere colunas, normaliza, remove repetidos e conta inválidos', () => {
    const data = sheet([
      ['Nome do Cliente', 'Celular', 'Data de Nascimento', 'Cidade'],
      ['Ana Souza', '(11) 98765-0001', '05/03/1985', 'Campinas'],
      ['Bruno Lima', '11 98765-0002', '', 'Santos'],
      ['Ana de novo', '11987650001', '', ''],
      ['Sem número', 'não tem', '', ''],
      ['Carla', '', '', '']
    ])
    const prev = people.previewImport(data)
    expect(prev.total).toBe(5)
    expect(prev.suggested.name).toBe(0)
    expect(prev.suggested.phone).toBe(1)
    expect(prev.suggested.birthday).toBe(2)
    const r = people.runImport(ACC, prev.token, { ...prev.suggested, extra: [{ column: 3, field: 'cidade' }] }, [
      'Black Friday'
    ])
    expect(r).toMatchObject({ imported: 2, updated: 0, duplicates: 1, invalid: 1 })
    const { items, total } = people.listPeople({ accountId: ACC, limit: 10, offset: 0 })
    expect(total).toBe(2)
    const ana = items.find((p) => p.name === 'Ana Souza')!
    expect(ana.phone).toBe('5511987650001')
    expect(ana.birthday).toBe('1985-03-05')
    expect(ana.fields.cidade).toBe('Campinas')
    expect(ana.tags).toEqual(['Black Friday'])
    // Reimportar atualiza em vez de duplicar
    const again = people.previewImport(data)
    expect(people.runImport(ACC, again.token, again.suggested, []).updated).toBe(2)
  })

  test('busca sem acento e exportação protegida contra fórmulas', () => {
    people.savePerson(ACC, { name: 'João =HYPERLINK("x")', phone: '11987650009', tags: ['VIP'] })
    expect(people.listPeople({ accountId: ACC, search: 'joao', limit: 10, offset: 0 }).total).toBe(1)
    const csv = people.exportCsv(ACC)
    expect(csv).not.toMatch(/;=HYPERLINK/)
    expect(() => people.savePerson(ACC, { name: 'x', phone: '123' })).toThrow(/Telefone inválido/)
  })
})

describe('campanhas', () => {
  function seed(): void {
    people.savePerson(ACC, { name: 'ANA SOUZA', phone: '11987650001', tags: ['VIP'] })
    people.savePerson(ACC, { name: 'Bruno', phone: '11987650002', tags: ['VIP', 'Inativo'] })
    people.savePerson(ACC, { name: 'Carla', phone: '11987650003', tags: ['Outros'] })
    const p = people.savePerson(ACC, { name: 'Dani', phone: '11987650004', tags: ['VIP'] })
    people.setOptOut(ACC, [p.id], true)
  }

  test('público por etiqueta, exclusão e opt-out', () => {
    seed()
    expect(C.countAudience(ACC, { type: 'tags', tags: ['VIP'] })).toEqual({ total: 3, optedOut: 1 })
    expect(C.countAudience(ACC, { type: 'tags', tags: ['VIP'], excludeTags: ['Inativo'] }).total).toBe(2)
    expect(C.countAudience(ACC, { type: 'all' }).total).toBe(4)
    expect(C.countAudience(ACC, { type: 'tags', tags: [] }).total).toBe(0)
  })

  test('iniciar gera destinatários com variáveis; opt-out já entra marcado', () => {
    seed()
    const c = C.saveCampaign({
      accountId: ACC,
      name: 'Black',
      templates: ['Oi {primeiro_nome}!'],
      audience: { type: 'tags', tags: ['VIP'] },
      optOutFooter: true,
      scheduledAt: null
    })
    const started = C.startCampaign(c.id)
    expect(started.status).toBe('running')
    expect(started.stats).toMatchObject({ total: 3, pending: 2, optedOut: 1 })
    const t = C.nextTarget(c.id)!
    expect(JSON.parse(t.vars!)).toMatchObject({ primeiro_nome: 'Ana', loja: 'Ótica Centro' })
    C.markTarget(c.id, t.seq, 'sent', { messageId: 'MSG1', jid: '5511987650001@s.whatsapp.net' })
    C.onCampaignReceipt('MSG1', 4)
    C.onCampaignReply(ACC, '5511987650001@s.whatsapp.net')
    const s = C.getCampaign(c.id)!.stats
    expect(s).toMatchObject({ sent: 1, delivered: 1, read: 1, replied: 1 })
    expect(C.lastTouch(ACC, '5511987650001@s.whatsapp.net')?.id).toBe(c.id)
    expect(() =>
      C.saveCampaign({
        id: c.id,
        accountId: ACC,
        name: 'x',
        templates: ['y'],
        audience: { type: 'all' },
        optOutFooter: false,
        scheduledAt: null
      })
    ).toThrow(/não começaram/)
  })

  test('agendada só começa na hora', () => {
    seed()
    const c = C.saveCampaign({
      accountId: ACC,
      name: 'Futura',
      templates: ['Oi'],
      audience: { type: 'all' },
      optOutFooter: false,
      scheduledAt: Date.now() + 3600_000
    })
    expect(C.startCampaign(c.id).status).toBe('scheduled')
    C.promoteScheduled(ACC)
    expect(C.getCampaign(c.id)!.status).toBe('scheduled')
    getDb()
      .prepare('UPDATE campaigns SET scheduled_at = ? WHERE id = ?')
      .run(Date.now() - 1, c.id)
    C.promoteScheduled(ACC)
    expect(C.getCampaign(c.id)!.status).toBe('running')
  })

  test('contagem diária de envios', () => {
    C.countSend(ACC)
    C.countSend(ACC)
    expect(C.sentToday(ACC)).toBe(2)
  })
})

describe('respostas automáticas', () => {
  const base = { enabled: true, keywords: [], matchMode: 'contains' as const, cooldownMin: 60 }
  const rules: AutoRule[] = [
    { ...base, id: 1, name: 'Horário', kind: 'keyword', keywords: ['horário', 'que horas'], reply: 'Abrimos 9h' },
    {
      ...base,
      id: 2,
      name: 'Fora',
      kind: 'away',
      reply: 'Estamos fechados',
      schedule: { hourStart: 9, hourEnd: 18, days: [1, 2, 3, 4, 5] }
    },
    { ...base, id: 3, name: 'Oi', kind: 'welcome', reply: 'Bem-vindo' }
  ]
  const ctx = (now: Date, first = false, answered: number[] = []): Parameters<typeof pickRule>[2] => ({
    now,
    firstContact: first,
    recentlyAnswered: (id) => answered.includes(id)
  })
  const monday10 = new Date(2026, 10, 2, 10)
  const monday22 = new Date(2026, 10, 2, 22)

  test('palavra-chave sem acento e palavra inteira', () => {
    expect(pickRule(rules, 'Qual o HORARIO de vocês?', ctx(monday10))?.id).toBe(1)
    expect(pickRule(rules, 'horarios', ctx(monday10))).toBeNull()
  })
  test('fora do horário, boas-vindas e intervalo entre respostas', () => {
    expect(pickRule(rules, 'oi', ctx(monday22))?.id).toBe(2)
    expect(pickRule(rules, 'oi', ctx(monday10, true))?.id).toBe(3)
    expect(pickRule(rules, 'horário?', ctx(monday10, false, [1]))).toBeNull()
  })
})

describe('moderação de grupos', () => {
  const rule = { welcome: null, antiLink: true, bannedWords: ['golpe'], maxWarnings: 2 }
  test('link e palavra proibida', () => {
    expect(violation(rule, 'olha www.promo.com.br')).toMatch(/links/)
    expect(violation(rule, 'isso é GOLPE')).toMatch(/não é permitida/)
    expect(violation(rule, 'golpeado')).toBeNull()
    expect(violation({ ...rule, antiLink: false }, 'https://x.com')).toBeNull()
  })
})

describe('lembretes', () => {
  test('aniversário, X dias depois e anual (inclusive 29/02)', () => {
    const today = new Date(2026, 10, 5, 10)
    expect(matchesToday('birthday', '1990-11-05', 0, today)).toBe(true)
    expect(matchesToday('birthday', '--11-05', 0, today)).toBe(true)
    expect(matchesToday('birthday', '1990-11-06', 0, today)).toBe(false)
    expect(matchesToday('days_after', '2026-10-29', 7, today)).toBe(true)
    expect(matchesToday('days_after', '05/11/2025', 365, today)).toBe(true)
    expect(matchesToday('yearly', '2024-11-05', 0, today)).toBe(true)
    expect(matchesToday('birthday', '2000-02-29', 0, new Date(2027, 1, 28, 10))).toBe(true)
  })
  test('quem está na fila hoje, respeitando opt-out e etiquetas', () => {
    const today = new Date()
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`
    people.savePerson(ACC, {
      name: 'Ana',
      phone: '11987650001',
      birthday: `${mmdd.split('/')[1]}/${mmdd.split('/')[0]}/1990`,
      tags: ['VIP']
    })
    const b = people.savePerson(ACC, {
      name: 'Bia',
      phone: '11987650002',
      birthday: `${mmdd.split('/')[1]}/${mmdd.split('/')[0]}/1991`
    })
    people.setOptOut(ACC, [b.id], true)
    const r = saveReminder(ACC, {
      name: 'Aniversário',
      kind: 'birthday',
      field: null,
      offsetDays: 0,
      sendHour: 9,
      template: 'Parabéns {primeiro_nome}!',
      tags: [],
      enabled: true
    })
    expect(dueToday(ACC, r)).toHaveLength(1)
    const onlyVip = saveReminder(ACC, { ...r, id: r.id, tags: ['Outros'] })
    expect(dueToday(ACC, onlyVip)).toHaveLength(0)
  })
})

describe('vendas', () => {
  test('atribui à campanha recente e resume o retorno', () => {
    people.savePerson(ACC, { name: 'Ana', phone: '11987650001', tags: ['VIP'] })
    const c = C.saveCampaign({
      accountId: ACC,
      name: 'Black Friday',
      templates: ['Oi'],
      audience: { type: 'all' },
      optOutFooter: false,
      scheduledAt: null
    })
    C.startCampaign(c.id)
    C.markTarget(c.id, 1, 'sent', { messageId: 'M', jid: '5511987650001@s.whatsapp.net' })
    const won = saveDeal(ACC, {
      chatJid: '5511987650001@s.whatsapp.net',
      status: 'won',
      amountCents: 25990,
      product: 'Relógio',
      payment: 'Pix'
    })
    expect(won.sourceType).toBe('campaign')
    expect(won.sourceName).toBe('Black Friday')
    saveDeal(ACC, { chatJid: '5511900000000@s.whatsapp.net', status: 'won', amountCents: 10000 })
    saveDeal(ACC, { chatJid: '5511900000001@s.whatsapp.net', status: 'lost', amountCents: 999, reason: 'Preço' })
    const s = salesSummary(ACC, Date.now() - 86_400_000, Date.now() + 1000)
    expect(s).toMatchObject({ revenueCents: 35990, won: 2, lost: 1, avgTicketCents: 17995 })
    expect(s.bySource.find((x) => x.sourceType === 'campaign')).toMatchObject({
      name: 'Black Friday',
      revenueCents: 25990,
      sent: 1
    })
    expect(s.lostReasons).toEqual([{ reason: 'Preço', count: 1 }])
  })
})

describe('IA', () => {
  test('anonimiza dados pessoais e nomes', () => {
    const t = anonymize(
      'Oi, sou a Maria Souza, CPF 123.456.789-09, tel (11) 98765-4321, maria@x.com, CEP 01310-100. Fala com a maria!',
      ['Maria Souza']
    )
    expect(t).not.toMatch(/Maria|maria@|123\.456|98765|01310/)
    expect(t).toContain('[cliente]')
    expect(t).toContain('[cpf]')
    expect(t).toContain('[telefone]')
    expect(t).toContain('[email]')
  })

  const p = (over: Partial<AiProvider>): AiProvider => ({
    id: 1,
    preset: 'groq',
    name: 'p',
    baseUrl: '',
    hasKey: true,
    modelFast: 'm',
    modelSmart: 'm',
    trainsOnData: false,
    rpm: null,
    rpd: 100,
    paid: false,
    enabled: true,
    priority: 100,
    usedToday: 0,
    errorsToday: 0,
    cooldownUntil: 0,
    ...over
  })
  const list = [
    p({ id: 1, name: 'groq', priority: 10 }),
    p({ id: 2, name: 'gemini', preset: 'gemini', trainsOnData: true, priority: 5 }),
    p({ id: 3, name: 'claude', preset: 'claude', paid: true }),
    p({ id: 4, name: 'sem chave', hasKey: false }),
    p({ id: 5, name: 'esgotado', usedToday: 100 }),
    p({ id: 6, name: 'em pausa', cooldownUntil: Date.now() + 60_000 })
  ]
  test('gratuitos primeiro, pago por último; pula sem chave, esgotado e em pausa', () => {
    const r = candidates(list, { customerData: false }, { privacy: 'anonimizar', paidMonthlyLimit: 10 }, 0)
    expect(r.map((x) => x.name)).toEqual(['gemini', 'groq', 'claude'])
  })
  test('modo estrito: dados de clientes só em quem não treina; limite mensal do pago', () => {
    const r = candidates(list, { customerData: true }, { privacy: 'estrita', paidMonthlyLimit: 10 }, 10)
    expect(r.map((x) => x.name)).toEqual(['groq'])
  })
  test('tarefa premium tenta o pago primeiro', () => {
    const r = candidates(list, { customerData: false, premium: true }, { privacy: 'livre', paidMonthlyLimit: 10 }, 0)
    expect(r[0].name).toBe('claude')
  })
})

describe('anonimização reforçada', () => {
  test('receita, telefones em vários formatos, endereço, RG e datas', () => {
    const t = anonymize(
      'Receita: OD -2,50 OE -1,75 eixo 90. Liga 11 9 8765-4321 ou 11.98765.4321. Moro na Rua das Flores, 123. RG 12.345.678-9, nasci 05/03/1985. Fala com o Jo!',
      ['Jo Lima']
    )
    expect(t).not.toMatch(/-2,50|-1,75|8765|Flores|12\.345|1985|\bJo\b/)
  })
})

describe('provedor de IA', () => {
  test('endereço: https, http só local, sem truques de host', async () => {
    const { validateBaseUrl } = await import('../src/main/ai/router')
    expect(validateBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1')
    expect(validateBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(() => validateBaseUrl('http://localhost.atacante.com/v1')).toThrow()
    expect(() => validateBaseUrl('http://127.0.0.1.nip.io/v1')).toThrow()
    expect(() => validateBaseUrl('https://user:pw@x.com')).toThrow()
    expect(() => validateBaseUrl('file:///etc/passwd')).toThrow()
  })
})

describe('LGPD: supressão e exclusão', () => {
  test('SAIR por LID sem número fica gravado e bloqueia o envio quando o número é descoberto', () => {
    const LID = '99887766554433@lid'
    people.optOutByJid(ACC, LID)
    expect(people.isOptedOut(ACC, LID)).toBe(true)
    // depois o WhatsApp revela o número desse LID
    getDb()
      .prepare('INSERT INTO lid_map (account_id, lid, pn) VALUES (?, ?, ?)')
      .run(ACC, LID, '5511987650077@s.whatsapp.net')
    expect(people.isOptedOut(ACC, '5511987650077@s.whatsapp.net')).toBe(true)
  })

  test('excluir contato apaga dados e mantém o opt-out; reimportar não volta a receber', async () => {
    const p = people.savePerson(ACC, { name: 'Ana', phone: '11987650001', tags: ['VIP'] })
    const jid = '5511987650001@s.whatsapp.net'
    people.setOptOut(ACC, [p.id], true)
    const store = await import('../src/main/wa/store')
    store.saveMessages(
      ACC,
      [
        {
          key: { remoteJid: jid, fromMe: false, id: 'Z1' },
          messageTimestamp: 1_790_000_000,
          message: { conversation: 'oi' }
        } as never
      ],
      { live: false }
    )
    saveDeal(ACC, { chatJid: jid, status: 'won', amountCents: 100 })
    people.deletePeople(ACC, [p.id])
    const n = (sql: string): number => (getDb().prepare(sql).get() as { n: number }).n
    expect(n('SELECT COUNT(*) AS n FROM messages')).toBe(0)
    expect(n('SELECT COUNT(*) AS n FROM chats')).toBe(0)
    expect(n('SELECT COUNT(*) AS n FROM deals')).toBe(0)
    expect(n('SELECT COUNT(*) AS n FROM people')).toBe(0)
    // volta pela planilha
    people.savePerson(ACC, { name: 'Ana', phone: '11987650001', tags: ['VIP'] })
    expect(C.countAudience(ACC, { type: 'tags', tags: ['VIP'] })).toEqual({ total: 1, optedOut: 1 })
  })
})

describe('planilha maliciosa', () => {
  // ZIP mínimo (1 arquivo, deflate) montado à mão
  function zipOf(name: string, content: Buffer): Uint8Array {
    const comp = deflateRawSync(content, { level: 9 })
    const fn = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(fn.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(fn.length, 28)
    const cdOffset = local.length + fn.length + comp.length
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(1, 8)
    eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(central.length + fn.length, 12)
    eocd.writeUInt32LE(cdOffset, 16)
    return new Uint8Array(Buffer.concat([local, fn, comp, central, fn, eocd]))
  }
  test('recusa ZIP que explode ao abrir e aceita planilha normal', () => {
    expect(() =>
      people.assertZipNotBomb(
        sheet([
          ['Nome', 'Telefone'],
          ['Ana', '11987650001']
        ])
      )
    ).not.toThrow()
    expect(() => people.assertZipNotBomb(zipOf('xl/x.xml', Buffer.alloc(50 * 1024 * 1024)))).toThrow(/suspeita|grande/)
    expect(() => people.assertZipNotBomb(zipOf('xl/x.xml', Buffer.from('ok'.repeat(1000))))).not.toThrow()
  })
})
