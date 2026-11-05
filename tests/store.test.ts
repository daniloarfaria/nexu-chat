import { beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WAMessage } from 'baileys'
import { closeDb, getDb, openDb } from '../src/main/db'
import * as store from '../src/main/wa/store'

const ACC = '11111111-1111-4111-8111-111111111111'
const PN = '5511987654321@s.whatsapp.net'
const LID = '123456789012345@lid'
const GROUP = '120363000000000000@g.us'
let seq = 0

function msg(over: Partial<WAMessage> & { text?: string }): WAMessage {
  const { text, ...rest } = over
  return {
    key: { remoteJid: PN, fromMe: false, id: `M${++seq}` },
    messageTimestamp: 1_790_000_000 + seq,
    message: { conversation: text ?? `mensagem ${seq}` },
    ...rest
  } as WAMessage
}

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-store-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Teste', '#000000', '{}', Date.now())
})

describe('histórico e mensagens', () => {
  test('histórico não gera não lidas; mensagem nova gera', () => {
    store.saveMessages(ACC, [msg({}), msg({})], { live: false })
    expect(store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })[0].unread).toBe(0)
    const fresh = store.saveMessages(ACC, [msg({ text: 'oi, tudo bem?' })], { live: true })
    expect(fresh).toHaveLength(1)
    const chat = store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })[0]
    expect(chat.unread).toBe(1)
    expect(chat.lastPreview).toBe('oi, tudo bem?')
    expect(chat.phone).toBe('5511987654321')
  })

  test('mensagem repetida (histórico + tempo real) não duplica', () => {
    const m = msg({ text: 'única' })
    store.saveMessages(ACC, [m], { live: true })
    store.saveMessages(ACC, [m], { live: true })
    expect(store.listMessages(ACC, PN, null, 50)).toHaveLength(1)
    expect(store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })[0].unread).toBe(1)
  })

  test('conversa por LID é unida à do número quando o mapeamento chega', () => {
    store.saveMessages(ACC, [msg({ key: { remoteJid: LID, fromMe: false, id: 'L1' }, text: 'via lid' })], {
      live: true
    })
    store.saveMessages(ACC, [msg({ text: 'via número' })], { live: true })
    expect(store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })).toHaveLength(2)
    store.saveLidMappings(ACC, [{ lid: LID, pn: PN }])
    const chats = store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })
    expect(chats).toHaveLength(1)
    expect(chats[0].jid).toBe(PN)
    expect(chats[0].unread).toBe(2)
    expect(store.listMessages(ACC, PN, null, 50).map((m) => m.text)).toEqual(['via lid', 'via número'])
  })

  test('remoteJidAlt resolve o LID direto para o número', () => {
    store.saveMessages(ACC, [msg({ key: { remoteJid: LID, remoteJidAlt: PN, fromMe: false, id: 'A1' } as never })], {
      live: false
    })
    expect(store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })[0].jid).toBe(PN)
  })

  test('reação, edição e apagar para todos', () => {
    store.saveMessages(ACC, [msg({ key: { remoteJid: PN, fromMe: true, id: 'T1' }, text: 'preço 100' })], {
      live: false
    })
    store.saveMessages(
      ACC,
      [msg({ message: { reactionMessage: { key: { remoteJid: PN, fromMe: true, id: 'T1' }, text: '❤️' } } })],
      { live: true }
    )
    let m = store.listMessages(ACC, PN, null, 10)
    expect(m).toHaveLength(1)
    expect(Object.values(m[0].reactions ?? {})).toEqual(['❤️'])

    store.saveMessages(
      ACC,
      [
        msg({
          key: { remoteJid: PN, fromMe: true, id: 'E1' },
          message: {
            protocolMessage: {
              type: 14,
              key: { remoteJid: PN, fromMe: true, id: 'T1' },
              editedMessage: { conversation: 'preço 90' }
            }
          }
        })
      ],
      { live: true }
    )
    m = store.listMessages(ACC, PN, null, 10)
    expect(m[0].text).toBe('preço 90')
    expect(m[0].edited).toBe(true)
    expect(store.searchMessages(ACC, 'preco 90')).toHaveLength(1)

    store.saveMessages(
      ACC,
      [
        msg({
          key: { remoteJid: PN, fromMe: true, id: 'R1' },
          message: { protocolMessage: { type: 0, key: { remoteJid: PN, fromMe: true, id: 'T1' } } }
        })
      ],
      { live: true }
    )
    m = store.listMessages(ACC, PN, null, 10)
    expect(m[0].deleted).toBe(true)
    expect(m[0].text).toBeNull()
    expect(store.searchMessages(ACC, 'preco')).toHaveLength(0)
  })

  test('status de entrega só avança', () => {
    store.saveMessages(ACC, [msg({ key: { remoteJid: PN, fromMe: true, id: 'S1' }, status: 2 })], { live: false })
    store.updateStatus(ACC, PN, 'S1', 4)
    store.updateStatus(ACC, PN, 'S1', 3)
    expect(store.listMessages(ACC, PN, null, 10)[0].status).toBe(4)
  })

  test('tipos de mídia, citação e grupo', () => {
    store.saveMessages(
      ACC,
      [
        msg({
          key: { remoteJid: GROUP, participant: PN, fromMe: false, id: 'G1' },
          pushName: 'Maria',
          text: 'pergunta'
        }),
        msg({
          key: { remoteJid: GROUP, fromMe: true, id: 'G2' },
          message: {
            imageMessage: {
              caption: 'foto do óculos',
              mimetype: 'image/jpeg',
              width: 800,
              height: 600,
              contextInfo: { stanzaId: 'G1', participant: PN }
            }
          }
        }),
        msg({
          key: { remoteJid: GROUP, participant: PN, fromMe: false, id: 'G3' },
          message: { audioMessage: { ptt: true, seconds: 7, mimetype: 'audio/ogg; codecs=opus' } }
        }),
        msg({
          key: { remoteJid: GROUP, participant: PN, fromMe: false, id: 'G4' },
          message: { documentMessage: { fileName: 'receita.pdf', mimetype: 'application/pdf' } }
        }),
        msg({
          key: { remoteJid: GROUP, participant: PN, fromMe: false, id: 'G5' },
          message: { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: 'Loja' } }
        }),
        msg({
          key: { remoteJid: GROUP, participant: PN, fromMe: false, id: 'G6' },
          message: {
            pollCreationMessageV3: {
              name: 'Qual cor?',
              options: [{ optionName: 'Preto' }, { optionName: 'Dourado' }],
              selectableOptionsCount: 1
            }
          }
        })
      ],
      { live: false }
    )
    const list = store.listMessages(ACC, GROUP, null, 10)
    expect(list.map((m) => m.type)).toEqual(['text', 'image', 'voice', 'document', 'location', 'poll'])
    expect(list[0].senderName).toBe('Maria')
    expect(list[1].extra?.quoted?.text).toBe('pergunta')
    expect(list[1].text).toBe('foto do óculos')
    expect(list[2].media?.seconds).toBe(7)
    expect(list[3].media?.fileName).toBe('receita.pdf')
    expect(list[4].extra?.location?.name).toBe('Loja')
    expect(list[5].extra?.poll?.options).toEqual(['Preto', 'Dourado'])
    const chat = store.listChats(ACC, { filter: 'groups', limit: 10, offset: 0 })
    expect(chat).toHaveLength(1)
    expect(chat[0].isGroup).toBe(true)
  })

  test('paginação de mensagens antigas', () => {
    const many = Array.from({ length: 25 }, () => msg({}))
    store.saveMessages(ACC, many, { live: false })
    const last = store.listMessages(ACC, PN, null, 10)
    expect(last).toHaveLength(10)
    const older = store.listMessages(ACC, PN, last[0].ts, 10)
    expect(older).toHaveLength(10)
    expect(older[older.length - 1].ts).toBeLessThan(last[0].ts)
  })

  test('nome do contato aparece na conversa e ler zera não lidas', () => {
    store.saveMessages(ACC, [msg({})], { live: true })
    store.saveContacts(ACC, [{ id: PN, name: 'João da Ótica' }])
    expect(store.listChats(ACC, { filter: 'all', search: 'joao otica', limit: 10, offset: 0 })).toHaveLength(0)
    expect(store.listChats(ACC, { filter: 'all', search: 'joao', limit: 10, offset: 0 })).toHaveLength(1)
    expect(store.listChats(ACC, { filter: 'all', search: '98765', limit: 10, offset: 0 })).toHaveLength(1)
    expect(store.listChats(ACC, { filter: 'all', search: 'João', limit: 10, offset: 0 })[0].name).toBe('João da Ótica')
    store.markChatRead(ACC, PN)
    expect(store.unreadTotal(ACC)).toBe(0)
  })
})

describe('tipos especiais', () => {
  test('cabeçalho de álbum e aviso de histórico não viram balão; modelo vira texto', () => {
    store.saveMessages(
      ACC,
      [
        msg({ message: { albumMessage: { expectedImageCount: 3 } } }),
        msg({ message: { messageHistoryNotice: {} } as never }),
        msg({
          message: {
            templateMessage: { hydratedFourRowTemplate: { hydratedContentText: 'Seu pedido saiu para entrega' } }
          }
        })
      ],
      { live: false }
    )
    const list = store.listMessages(ACC, PN, null, 10)
    expect(list.map((m) => [m.type, m.text])).toEqual([['text', 'Seu pedido saiu para entrega']])
  })

  test('reprocessa mensagens antigas não suportadas', () => {
    store.saveMessages(
      ACC,
      [msg({ message: { templateMessage: { hydratedFourRowTemplate: { hydratedContentText: 'Oi' } } } })],
      { live: false }
    )
    getDb().prepare("UPDATE messages SET type = 'unsupported', text = NULL").run()
    expect(store.reparseUnsupported()).toBe(1)
    expect(store.listMessages(ACC, PN, null, 10)[0]).toMatchObject({ type: 'text', text: 'Oi' })
  })
})
