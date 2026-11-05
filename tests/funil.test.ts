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
import * as tags from '../src/main/tags'
import * as P from '../src/main/pipelines'
import * as C from '../src/main/campaigns'

const ACC = '44444444-4444-4444-8444-444444444444'
const OTHER = '55555555-5555-4555-8555-555555555555'

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-funil-')), 'db.sqlite'))
  for (const [id, name] of [
    [ACC, 'Ótica Centro'],
    [OTHER, 'Outra loja']
  ])
    getDb()
      .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, '#000000', '{}', Date.now())
})

function person(name: string, phone: string, t: string[] = [], acc = ACC): number {
  return people.savePerson(acc, { name, phone, tags: t }).id
}

describe('etiquetas', () => {
  test('mesma etiqueta com grafia diferente vira uma só, com cor', () => {
    person('Ana', '11987650001', ['VIP'])
    person('Bia', '11987650002', ['vip', 'Óculos'])
    const defs = tags.listTagDefs(ACC)
    expect(defs.map((d) => d.name)).toEqual(['Óculos', 'VIP'])
    expect(defs.find((d) => d.name === 'VIP')!.count).toBe(2)
    expect(defs[0].color).not.toBe('')
  })

  test('renomear atualiza contatos, colunas e campanhas não enviadas; juntar não duplica', () => {
    const a = person('Ana', '11987650001', ['VIP', 'Cliente'])
    const pipe = P.createFromTemplate(ACC, 'vendas')
    P.savePipeline(ACC, {
      id: pipe.id,
      name: pipe.name,
      color: 'blue',
      stages: pipe.stages.map((s, i) => ({ ...s, autoTag: i === 0 ? 'VIP' : s.autoTag }))
    })
    const camp = C.saveCampaign({
      accountId: ACC,
      name: 'Teste',
      templates: ['Oi'],
      audience: { type: 'tags', tags: ['VIP'] },
      optOutFooter: true,
      scheduledAt: null
    })
    tags.saveTag(ACC, { name: 'Clientes VIP', color: 'amber', previousName: 'VIP' })
    expect(people.getPerson(ACC, a)!.tags).toEqual(['Cliente', 'Clientes VIP'])
    expect(P.listPipelines(ACC)[0].stages[0].autoTag).toBe('Clientes VIP')
    expect(C.getCampaign(camp.id)!.audience.tags).toEqual(['Clientes VIP'])
    // Juntar com etiqueta existente
    tags.saveTag(ACC, { name: 'Cliente', color: 'green', previousName: 'Clientes VIP' })
    expect(people.getPerson(ACC, a)!.tags).toEqual(['Cliente'])
    expect(tags.listTagDefs(ACC).map((d) => d.name)).toEqual(['Cliente'])
  })

  test('apagar etiqueta mantém o contato', () => {
    const a = person('Ana', '11987650001', ['VIP'])
    tags.deleteTag(ACC, 'VIP')
    expect(people.getPerson(ACC, a)!.tags).toEqual([])
    expect(tags.listTagDefs(ACC)).toEqual([])
  })

  test('não deixa criar etiqueta repetida', () => {
    tags.saveTag(ACC, { name: 'VIP', color: 'red' })
    expect(() => tags.saveTag(ACC, { name: 'vip', color: 'red' })).toThrow(/Já existe/)
  })
})

describe('funis', () => {
  test('cria por modelo, move cartão, aplica e tira etiqueta automática', () => {
    const pipe = P.createFromTemplate(ACC, 'vendas')
    expect(pipe.stages.map((s) => s.name)).toEqual([
      'Novo contato',
      'Em conversa',
      'Orçamento enviado',
      'Negociação',
      'Ganho',
      'Perdido'
    ])
    const [novo, conversa] = pipe.stages
    P.savePipeline(ACC, {
      id: pipe.id,
      name: pipe.name,
      color: 'blue',
      stages: pipe.stages.map((s) =>
        s.id === conversa.id ? { ...s, autoTag: 'Em atendimento', removeTagOnLeave: true } : s
      )
    })
    const ana = person('Ana', '11987650001')
    const bia = person('Bia', '11987650002')
    expect(P.addPeople(ACC, novo.id, [ana, bia, ana])).toEqual({ added: 2, moved: 0, already: 0 })
    expect(P.addPeople(ACC, novo.id, [ana])).toEqual({ added: 0, moved: 0, already: 1 })
    const board = P.getBoard(ACC, pipe.id)
    const card = board.cards.find((c) => c.personId === ana)!
    P.moveCard(ACC, card.id, conversa.id, 0)
    expect(people.getPerson(ACC, ana)!.tags).toEqual(['Em atendimento'])
    P.moveCard(ACC, card.id, novo.id, 0)
    expect(people.getPerson(ACC, ana)!.tags).toEqual([])
    // Ordem dentro da coluna: Ana voltou para o topo
    const order = P.getBoard(ACC, pipe.id)
      .cards.filter((c) => c.stageId === novo.id)
      .map((c) => c.personId)
    expect(order).toEqual([ana, bia])
    const counts = P.listPipelines(ACC)[0].stages.map((s) => s.count)
    expect(counts.slice(0, 2)).toEqual([2, 0])
  })

  test('remover coluna leva os cartões para a anterior', () => {
    const pipe = P.createFromTemplate(ACC, 'vazio')
    const [a, b, c] = pipe.stages
    const ana = person('Ana', '11987650001')
    P.addPeople(ACC, b.id, [ana])
    const next = P.savePipeline(ACC, { id: pipe.id, name: 'X', color: 'red', stages: [a, c] })
    expect(next.stages.map((s) => s.name)).toEqual(['A fazer', 'Concluído'])
    expect(P.getBoard(ACC, pipe.id).cards[0].stageId).toBe(a.id)
  })

  test('isolamento entre contas', () => {
    const pipe = P.createFromTemplate(ACC, 'vendas')
    const intruso = person('Zé', '11987650009', [], OTHER)
    expect(() => P.getBoard(OTHER, pipe.id)).toThrow(/não encontrado/)
    expect(P.addPeople(ACC, pipe.stages[0].id, [intruso]).added).toBe(0)
    expect(() => P.addPeople(OTHER, pipe.stages[0].id, [intruso])).toThrow(/Coluna/)
    expect(C.countAudience(OTHER, { type: 'stages', stageIds: [pipe.stages[0].id] }).total).toBe(0)
  })

  test('contato a partir da conversa (número e LID)', () => {
    const pipe = P.createFromTemplate(ACC, 'vendas')
    getDb()
      .prepare('INSERT INTO chats (account_id, jid, name, is_group, last_ts) VALUES (?, ?, ?, 0, 1)')
      .run(ACC, '5511987650003@s.whatsapp.net', 'Carla da Silva')
    const pl = P.addFromChat(ACC, pipe.stages[1].id, '5511987650003@s.whatsapp.net')
    expect(pl[0].stageName).toBe('Em conversa')
    const p = people.getPerson(ACC, pl[0].personId)!
    expect(p.name).toBe('Carla da Silva')
    expect(p.phone).toBe('5511987650003')
    // Mesmo contato pelo LID mapeado
    getDb()
      .prepare('INSERT INTO lid_map (account_id, lid, pn) VALUES (?, ?, ?)')
      .run(ACC, '123456789@lid', '5511987650003@s.whatsapp.net')
    expect(P.chatProfile(ACC, '123456789@lid').personId).toBe(p.id)
    expect(() => P.addFromChat(ACC, pipe.stages[0].id, '999@lid')).toThrow(/número/)
    expect(() => P.addFromChat(ACC, pipe.stages[0].id, '1203@g.us')).toThrow(/Grupos/)
    // Número estrangeiro não vira brasileiro
    expect(P.personFromChat(ACC, '14155550123@s.whatsapp.net')).toBeGreaterThan(0)
    expect(people.findPersonByJid(ACC, '14155550123@s.whatsapp.net')!.phone).toBe('14155550123')
  })

  test('excluir contato (LGPD) tira o cartão', () => {
    const pipe = P.createFromTemplate(ACC, 'vendas')
    const ana = person('Ana', '11987650001')
    P.addPeople(ACC, pipe.stages[0].id, [ana])
    people.deletePeople(ACC, [ana])
    expect(P.getBoard(ACC, pipe.id).cards).toEqual([])
  })
})

describe('público da campanha', () => {
  test('etiquetas: qualquer uma × todas', () => {
    person('Ana', '11987650001', ['VIP', 'Óculos'])
    person('Bia', '11987650002', ['VIP'])
    person('Caio', '11987650003', ['Óculos'])
    expect(C.countAudience(ACC, { type: 'tags', tags: ['VIP', 'Óculos'] }).total).toBe(3)
    expect(C.countAudience(ACC, { type: 'tags', tags: ['VIP', 'Óculos'], tagMode: 'all' }).total).toBe(1)
  })

  test('disparo por coluna, com filtro e exclusão por etiqueta', () => {
    const pipe = P.createFromTemplate(ACC, 'vendas')
    const [novo, conversa] = pipe.stages
    const ana = person('Ana', '11987650001', ['VIP'])
    const bia = person('Bia', '11987650002')
    const caio = person('Caio', '11987650003', ['Inativo'])
    person('Fora do funil', '11987650004', ['VIP'])
    P.addPeople(ACC, novo.id, [ana, bia])
    P.addPeople(ACC, conversa.id, [caio])
    expect(C.countAudience(ACC, { type: 'stages', stageIds: [novo.id] }).total).toBe(2)
    expect(C.countAudience(ACC, { type: 'stages', stageIds: [novo.id, conversa.id] }).total).toBe(3)
    expect(
      C.countAudience(ACC, { type: 'stages', stageIds: [novo.id, conversa.id], excludeTags: ['Inativo'] }).total
    ).toBe(2)
    expect(C.countAudience(ACC, { type: 'stages', stageIds: [novo.id], tags: ['VIP'] }).total).toBe(1)
    expect(C.countAudience(ACC, { type: 'stages', stageIds: [] }).total).toBe(0)
  })
})
