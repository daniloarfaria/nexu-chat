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

import { closeDb, getDb, openDb } from '../src/main/db'
import * as people from '../src/main/people'
import * as notes from '../src/main/notes'
import { birthdayInfo, findBirthdayInText } from '../src/shared/dates'
import {
  parseProfileJson,
  isSensitive,
  isDuplicateNote,
  buildProfileNotes,
  notesForPrompt,
  dueForAutoProfile
} from '../src/main/ai/profile'
import { PLANS, MODULE_KEYS } from '../src/shared/types'

const ACC = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-notes-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica Centro', '#000000', '{}', Date.now())
})

function person(name = 'Ana Souza', phone = '11987650001'): number {
  return people.savePerson(ACC, { name, phone }).id
}

describe('notas do cliente', () => {
  test('cria, lista (fixadas primeiro), edita e apaga', () => {
    const p = person()
    const a = notes.saveNote(ACC, p, { kind: 'geral', title: 'Primeira', body: 'Prefere ligar de manhã' })
    const b = notes.saveNote(ACC, p, {
      kind: 'preferencia',
      title: 'Armação',
      body: 'Gosta de armação leve',
      pinned: true
    })
    const list = notes.listNotes(ACC, p)
    expect(list.map((n) => n.id)).toEqual([b.id, a.id])
    expect(a.author).toBe('atendente')
    const edited = notes.saveNote(ACC, p, { id: a.id, kind: 'objecao', title: 'Preço', body: 'Achou caro' })
    expect(edited.kind).toBe('objecao')
    expect(edited.createdAt).toBe(a.createdAt)
    notes.deleteNote(ACC, a.id)
    expect(notes.listNotes(ACC, p)).toHaveLength(1)
  })

  test('não deixa mexer em nota de outra conta nem de contato inexistente', () => {
    const p = person()
    const n = notes.saveNote(ACC, p, { kind: 'geral', title: 'x', body: 'y' })
    expect(() => notes.saveNote(ACC, 9999, { kind: 'geral', title: 'x', body: 'y' })).toThrow()
    const OTHER = '55555555-5555-4555-8555-555555555555'
    getDb()
      .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(OTHER, 'Outra', '#000000', '{}', Date.now())
    expect(() => notes.deleteNote(OTHER, n.id)).not.toThrow()
    expect(notes.listNotes(ACC, p)).toHaveLength(1)
    expect(() => notes.saveNote(OTHER, p, { id: n.id, kind: 'geral', title: 'x', body: 'z' })).toThrow()
  })

  test('texto vazio e texto enorme são tratados', () => {
    const p = person()
    expect(() => notes.saveNote(ACC, p, { kind: 'geral', title: '', body: '   ' })).toThrow(/escreva/i)
    const n = notes.saveNote(ACC, p, { kind: 'geral', title: '', body: 'a'.repeat(5000) })
    expect(n.body.length).toBeLessThanOrEqual(2000)
    expect(n.title.length).toBeGreaterThan(0)
  })

  test('excluir o contato apaga as notas (LGPD)', () => {
    const p = person()
    notes.saveNote(ACC, p, { kind: 'geral', title: 'x', body: 'segredo' })
    notes.saveAiNotes(ACC, p, [{ kind: 'perfil', title: 'y', body: 'z' }])
    people.deletePeople(ACC, [p])
    const left = getDb().prepare('SELECT COUNT(*) AS n FROM contact_notes').get() as { n: number }
    expect(left.n).toBe(0)
  })

  test('notas da IA ficam marcadas como IA', () => {
    const p = person()
    const added = notes.saveAiNotes(ACC, p, [{ kind: 'preferencia', title: 'Armação', body: 'Prefere armação leve' }])
    expect(added[0].author).toBe('ia')
  })
})

describe('mapeamento de perfil (funções puras)', () => {
  test('lê o JSON da IA, mesmo dentro de cercas de código', () => {
    const r = parseProfileJson(
      '```json\n{"notes":[{"kind":"preferencia","title":"Armação","body":"Prefere leve"}],"birthday":"12/03"}\n```'
    )
    expect(r.notes).toHaveLength(1)
    expect(r.birthday).toBe('--03-12')
  })

  test('texto que não é JSON dá erro simples', () => {
    expect(() => parseProfileJson('não sei')).toThrow(/IA/)
  })

  test('item inválido (tipo desconhecido, lixo) é descartado, sem corrigir', () => {
    const r = parseProfileJson(
      '{"notes":[{"kind":"xpto","title":"a","body":"b"},{"kind":"geral","title":"ok","body":"fica"},{"body":""},"oi"]}'
    )
    expect(r.notes).toEqual([{ kind: 'geral', title: 'ok', body: 'fica' }])
  })

  test('dado de saúde nunca vira nota', () => {
    expect(isSensitive('Grau -2,50 no olho direito')).toBe(true)
    expect(isSensitive('Tem miopia e astigmatismo')).toBe(true)
    expect(isSensitive('Faz tratamento de glaucoma')).toBe(true)
    expect(isSensitive('Usa remédio para pressão')).toBe(true)
    expect(isSensitive('Prefere armação leve')).toBe(false)
    expect(isSensitive('Comprou para a filha')).toBe(false)
  })

  test('detecta nota repetida, mesmo escrita diferente', () => {
    const old = [{ title: 'Armação', body: 'Prefere armação leve' }]
    expect(isDuplicateNote({ title: 'Armacao', body: 'prefere armacao leve.' }, old)).toBe(true)
    expect(isDuplicateNote({ title: 'Armação leve', body: 'Prefere armação bem leve' }, old)).toBe(true)
    expect(isDuplicateNote({ title: 'Família', body: 'Comprou para a filha' }, old)).toBe(false)
  })

  test('só propõe o que é novo, sem sensível, sem repetir entre si e com limite', () => {
    const old = [{ title: 'Armação', body: 'Prefere armação leve' }]
    const out = buildProfileNotes(
      [
        { kind: 'preferencia', title: 'Armação', body: 'Prefere armação leve' },
        { kind: 'perfil', title: 'Grau', body: 'Grau -3,00' },
        { kind: 'familia', title: 'Filha', body: 'Comprou para a filha' },
        { kind: 'familia', title: 'Filha', body: 'comprou para a filha' },
        { kind: 'objecao', title: 'Preço', body: 'Falou com [cliente] que achou caro [telefone]' }
      ],
      old
    )
    expect(out.map((n) => n.title)).toEqual(['Filha'])
  })

  test('troca o marcador [cliente] por "o cliente"', () => {
    const out = buildProfileNotes([{ kind: 'objecao', title: 'Objeção', body: '[cliente] achou caro' }], [])
    expect(out[0].body).toBe('o cliente achou caro')
  })

  test('notas entram anonimizadas no contexto da resposta', () => {
    const txt = notesForPrompt(
      [
        { title: 'Contato', body: 'Ana Souza prefere ligar no 11 98765-0001', pinned: false, kind: 'geral' },
        { title: 'Armação', body: 'Gosta de armação leve', pinned: true, kind: 'preferencia' }
      ],
      ['Ana Souza']
    )
    expect(txt).not.toMatch(/Ana|Souza|98765/)
    expect(txt).toContain('[cliente]')
    expect(txt).toContain('armação leve')
    expect(txt.indexOf('leve')).toBeLessThan(txt.indexOf('ligar')) // fixadas primeiro
  })

  test('sem notas, não entra nada no contexto', () => {
    expect(notesForPrompt([], [])).toBe('')
  })
})

describe('disparo automático (2 h parada, 10 mensagens novas)', () => {
  const NOW = 10_000_000
  const h = 3600
  test('só quando parou há 2 h e tem 10 mensagens novas', () => {
    expect(dueForAutoProfile({ lastTs: NOW - 2 * h, newMessages: 10 }, NOW)).toBe(true)
    expect(dueForAutoProfile({ lastTs: NOW - 2 * h + 60, newMessages: 10 }, NOW)).toBe(false)
    expect(dueForAutoProfile({ lastTs: NOW - 3 * h, newMessages: 9 }, NOW)).toBe(false)
  })

  test('candidatas: ignora grupo, quem já foi mapeado e quem tem poucas mensagens', () => {
    const h = 3600
    const p = person()
    const jid = '5511987650001@s.whatsapp.net'
    const db = getDb()
    db.prepare('UPDATE people SET jid = ? WHERE id = ?').run(jid, p)
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO chats (account_id, jid, name, last_ts) VALUES (?, ?, ?, ?)').run(
      ACC,
      jid,
      'Ana',
      now - 3 * h
    )
    const ins = db.prepare(
      'INSERT INTO messages (account_id, chat_jid, id, from_me, ts, type, text) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (let i = 0; i < 12; i++) ins.run(ACC, jid, `m${i}`, i % 2, now - 4 * h + i, 'text', `mensagem ${i}`)
    const gid = '120363@g.us'
    db.prepare('INSERT INTO chats (account_id, jid, name, last_ts, is_group) VALUES (?, ?, ?, ?, 1)').run(
      ACC,
      gid,
      'G',
      now - 3 * h
    )
    for (let i = 0; i < 12; i++) ins.run(ACC, gid, `g${i}`, 0, now - 4 * h + i, 'text', 'oi')
    const first = notes.autoProfileCandidates(ACC, now)
    expect(first.map((c) => c.personId)).toEqual([p])
    notes.markProfiled(ACC, p, now - 3 * h)
    expect(notes.autoProfileCandidates(ACC, now)).toHaveLength(0)
  })
})

describe('aniversário e datas', () => {
  const today = new Date(2026, 10, 10, 12) // 10/11/2026

  test('idade e dias que faltam', () => {
    const i = birthdayInfo('1985-12-01', today)!
    expect(i.age).toBe(40)
    expect(i.daysUntil).toBe(21)
    expect(i.label).toBe('01/12/1985')
  })

  test('aniversário hoje e já passou este ano', () => {
    expect(birthdayInfo('1990-11-10', today)!.daysUntil).toBe(0)
    expect(birthdayInfo('1990-11-10', today)!.age).toBe(36)
    const past = birthdayInfo('--03-12', today)!
    expect(past.age).toBeNull()
    expect(past.daysUntil).toBe(122)
    expect(past.label).toBe('12/03')
  })

  test('29/02 em ano que não é bissexto cai em 28/02', () => {
    expect(birthdayInfo('--02-29', new Date(2027, 1, 20, 12))!.daysUntil).toBe(8)
  })

  test('data inválida ou vazia não quebra', () => {
    expect(birthdayInfo(null, today)).toBeNull()
    expect(birthdayInfo('banana', today)).toBeNull()
  })

  test('acha a data de nascimento dita na conversa', () => {
    expect(findBirthdayInText('nasci em 12/03/1985')).toBe('1985-03-12')
    expect(findBirthdayInText('Meu aniversário é dia 12/03')).toBe('--03-12')
    expect(findBirthdayInText('faço anos dia 5 de agosto')).toBe('--08-05')
    expect(findBirthdayInText('minha data de nascimento: 01/02/1990')).toBe('1990-02-01')
  })

  test('não confunde com outras datas', () => {
    expect(findBirthdayInText('retiro os óculos dia 12/03')).toBeNull()
    expect(findBirthdayInText('quero marcar para 12/03')).toBeNull()
    expect(findBirthdayInText('aniversário da minha filha é 20/05')).toBeNull()
    expect(findBirthdayInText('nasci em 31/02/1990')).toBeNull()
  })

  test('histórico: lembrete de aniversário enviado, vindo da campanha e do registro', () => {
    const p = person()
    const db = getDb()
    const rid = Number(
      db
        .prepare(
          'INSERT INTO reminders (name, kind, field, offset_days, send_hour, template, tags, enabled, account_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
        )
        .run('Aniversário', 'birthday', null, 0, 9, 'Parabéns', '[]', 1, ACC, Date.now()).lastInsertRowid
    )
    const sent = new Date(2026, 2, 12, 9, 0).getTime()
    const cid = Number(
      db
        .prepare(
          "INSERT INTO campaigns (account_id, name, kind, status, templates, audience, source, created_at) VALUES (?, 'L', 'reminder', 'done', '[]', '{}', ?, ?)"
        )
        .run(ACC, `reminder:${rid}`, sent).lastInsertRowid
    )
    db.prepare(
      "INSERT INTO campaign_targets (campaign_id, seq, person_id, status, sent_at) VALUES (?, 1, ?, 'sent', ?)"
    ).run(cid, p, sent)
    // mesmo envio registrado no reminder_log: não pode aparecer duas vezes
    db.prepare('INSERT INTO reminder_log (reminder_id, person_id, period, at) VALUES (?, ?, ?, ?)').run(
      rid,
      p,
      '2026',
      sent
    )
    const h = notes.dateHistory(ACC, p)
    expect(h).toHaveLength(1)
    expect(h[0].label).toMatch(/^Lembrete de aniversário enviado em 12\/03\/2026$/)
  })

  test('sugestão de aniversário vem da conversa, só se o contato não tem data e some ao dispensar', () => {
    const p = person()
    const jid = '5511987650001@s.whatsapp.net'
    const db = getDb()
    db.prepare('UPDATE people SET jid = ? WHERE id = ?').run(jid, p)
    db.prepare('INSERT INTO chats (account_id, jid, name, last_ts) VALUES (?, ?, ?, ?)').run(ACC, jid, 'Ana', 1)
    const ins = db.prepare(
      'INSERT INTO messages (account_id, chat_jid, id, from_me, ts, type, text) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    ins.run(ACC, jid, 'a', 0, 100, 'text', 'Oi, meu aniversário é dia 12/03')
    ins.run(ACC, jid, 'b', 1, 101, 'text', 'Meu aniversário é 01/01 (loja)')
    const s = notes.birthdaySuggestion(ACC, p)!
    expect(s.date).toBe('--03-12')
    notes.dismissBirthdaySuggestion(ACC, p)
    expect(notes.birthdaySuggestion(ACC, p)).toBeNull()
  })

  test('com aniversário já salvo, não sugere nada', () => {
    const p = person()
    notes.setBirthday(ACC, p, '12/03')
    expect(notes.birthdaySuggestion(ACC, p)).toBeNull()
    expect(people.getPerson(ACC, p)?.birthday).toBe('--03-12')
  })

  test('data inválida não é salva', () => {
    const p = person()
    expect(() => notes.setBirthday(ACC, p, 'xx')).toThrow()
  })
})

describe('planos', () => {
  test('perfil pela IA é só do plano Completo', () => {
    expect(MODULE_KEYS).toContain('perfilIa')
    expect(PLANS.marketing.modulos).not.toContain('perfilIa')
    expect(PLANS.completo.modulos).toContain('perfilIa')
    expect(PLANS.basico.modulos).not.toContain('perfilIa')
  })
})
