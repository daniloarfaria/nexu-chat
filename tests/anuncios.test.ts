import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WAMessage } from 'baileys'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as store from '../src/main/wa/store'
import { adStats, extractAdAttribution, getAttribution, reprocessAdAttribution } from '../src/main/ads'
import { saveDeal } from '../src/main/deals'

const ACC = '44444444-4444-4444-8444-444444444444'
const PN = '5511987654321@s.whatsapp.net'
let seq = 0

function adMsg(opts: { ctwaClid?: string; fromMe?: boolean; jid?: string; withAd?: boolean } = {}): WAMessage {
  const withAd = opts.withAd ?? true
  return {
    key: { remoteJid: opts.jid ?? PN, fromMe: opts.fromMe ?? false, id: `AD${++seq}` },
    messageTimestamp: 1_790_000_000 + seq,
    message: {
      extendedTextMessage: {
        text: 'Oi, vi o anúncio dos óculos',
        contextInfo: withAd
          ? {
              conversionSource: 'FB_Ads',
              entryPointConversionSource: 'ctwa_ad',
              externalAdReply: {
                sourceId: '120210000000001',
                sourceUrl: 'https://fb.me/anuncio',
                ...(opts.ctwaClid ? { ctwaClid: opts.ctwaClid } : {})
              }
            }
          : undefined
      }
    }
  } as WAMessage
}

function enableModule(on: boolean): void {
  getDb()
    .prepare('UPDATE accounts SET modules = ? WHERE id = ?')
    .run(JSON.stringify({ metaConversoes: on }), ACC)
}

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-ads-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica', '#000000', JSON.stringify({ metaConversoes: true }), Date.now())
})

describe('leitura do contextInfo', () => {
  test('lê origem, anúncio e ctwaClid quando vêm', () => {
    expect(extractAdAttribution(adMsg({ ctwaClid: 'ARAxyz' }))).toEqual({
      conversionSource: 'FB_Ads',
      entryPoint: 'ctwa_ad',
      adId: '120210000000001',
      adUrl: 'https://fb.me/anuncio',
      ctwaClid: 'ARAxyz'
    })
  })

  test('tolera a ausência do ctwaClid', () => {
    const a = extractAdAttribution(adMsg())
    expect(a).toMatchObject({ conversionSource: 'FB_Ads', adId: '120210000000001', ctwaClid: null })
  })

  test('mensagem comum, sem anúncio, não gera nada', () => {
    expect(extractAdAttribution(adMsg({ withAd: false }))).toBeNull()
    expect(extractAdAttribution({ key: { id: 'x' }, message: null } as WAMessage)).toBeNull()
  })

  test('prévia de link (externalAdReply sem sinal de anúncio) não conta', () => {
    const m = {
      key: { remoteJid: PN, fromMe: false, id: 'L1' },
      message: {
        extendedTextMessage: {
          text: 'olha isso',
          contextInfo: { externalAdReply: { sourceUrl: 'https://exemplo.com', title: 'Site' } }
        }
      }
    } as WAMessage
    expect(extractAdAttribution(m)).toBeNull()
  })
})

describe('captura ao receber mensagens', () => {
  test('guarda a origem na conversa, sem ctwaClid', () => {
    store.saveMessages(ACC, [adMsg()], { live: true })
    expect(getAttribution(ACC, PN)).toMatchObject({
      conversionSource: 'FB_Ads',
      adId: '120210000000001',
      ctwaClid: null
    })
    expect(store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })[0].fromAd).toBe(true)
  })

  test('com ctwaClid, guarda o código', () => {
    store.saveMessages(ACC, [adMsg({ ctwaClid: 'ARAxyz' })], { live: true })
    expect(getAttribution(ACC, PN)?.ctwaClid).toBe('ARAxyz')
  })

  test('mensagem seguinte completa o código sem trocar o anúncio de origem', () => {
    store.saveMessages(ACC, [adMsg()], { live: true })
    store.saveMessages(ACC, [adMsg({ ctwaClid: 'ARAlate' })], { live: true })
    expect(getAttribution(ACC, PN)).toMatchObject({ ctwaClid: 'ARAlate', adId: '120210000000001' })
  })

  test('mensagem enviada por nós e grupos não entram', () => {
    store.saveMessages(ACC, [adMsg({ fromMe: true }), adMsg({ jid: '120363000000000000@g.us' })], { live: true })
    expect(getAttribution(ACC, PN)).toBeNull()
    expect(getAttribution(ACC, '120363000000000000@g.us')).toBeNull()
  })

  test('conversa sem anúncio não é marcada', () => {
    store.saveMessages(ACC, [adMsg({ withAd: false })], { live: true })
    expect(store.listChats(ACC, { filter: 'all', limit: 10, offset: 0 })[0].fromAd).toBe(false)
  })

  test('conta no resumo local quantos anúncios vieram e quantos com ctwaClid, sem dados do cliente', () => {
    store.saveMessages(ACC, [adMsg()], { live: true })
    store.saveMessages(ACC, [adMsg({ ctwaClid: 'ARAxyz', jid: '5511911112222@s.whatsapp.net' })], { live: true })
    const s = adStats()
    expect(s).toMatchObject({ anuncios: 2, comCtwaClid: 1 })
    expect(JSON.stringify(s)).not.toContain('5511')
    expect(JSON.stringify(s)).not.toContain('ARAxyz')
  })
})

describe('reprocessar o histórico', () => {
  test('acha anúncios em mensagens antigas guardadas em raw', () => {
    store.saveMessages(ACC, [adMsg({ ctwaClid: 'ARAold' })], { live: false })
    getDb().prepare('DELETE FROM chat_attribution').run()
    expect(getAttribution(ACC, PN)).toBeNull()
    const r = reprocessAdAttribution()
    expect(r).toMatchObject({ found: 1, done: true })
    expect(getAttribution(ACC, PN)?.ctwaClid).toBe('ARAold')
  })

  test('processa em lotes e não repete o trabalho', () => {
    for (let i = 0; i < 5; i++) store.saveMessages(ACC, [adMsg({ withAd: false })], { live: false })
    store.saveMessages(ACC, [adMsg()], { live: false })
    getDb().prepare('DELETE FROM chat_attribution').run()
    expect(reprocessAdAttribution(2).done).toBe(false)
    let guard = 0
    while (!reprocessAdAttribution(2).done && guard++ < 10);
    expect(getAttribution(ACC, PN)).not.toBeNull()
    expect(reprocessAdAttribution()).toMatchObject({ scanned: 0, done: true })
  })
})

describe('origem da venda', () => {
  test('venda de conversa que veio de anúncio ganha a origem Anúncio', () => {
    store.saveMessages(ACC, [adMsg()], { live: true })
    getDb()
      .prepare('UPDATE chat_attribution SET first_ts = ?')
      .run(Math.floor(Date.now() / 1000))
    const d = saveDeal(ACC, { chatJid: PN, status: 'won', amountCents: 10000 })
    expect(d.sourceType).toBe('ad')
    expect(d.sourceName).toBe('Anúncio')
  })

  test('sem anúncio, continua espontânea', () => {
    expect(saveDeal(ACC, { chatJid: PN, status: 'won', amountCents: 10000 }).sourceType).toBe('organic')
  })

  test('com o módulo desligado, a venda não muda de origem', () => {
    store.saveMessages(ACC, [adMsg()], { live: true })
    enableModule(false)
    expect(saveDeal(ACC, { chatJid: PN, status: 'won', amountCents: 10000 }).sourceType).toBe('organic')
  })
})

describe('fusão, limpeza e janela', () => {
  const LID = '123456789012345@lid'

  test('a origem acompanha a fusão do LID para o número', () => {
    store.saveMessages(ACC, [adMsg({ jid: LID })], { live: true })
    expect(getAttribution(ACC, LID)).not.toBeNull()
    store.saveLidMappings(ACC, [{ lid: LID, pn: PN }])
    expect(getAttribution(ACC, LID)).toBeNull()
    expect(getAttribution(ACC, PN)).toMatchObject({ adId: '120210000000001' })
  })

  test('na fusão, o destino completa campos vazios e mantém a origem mais antiga', () => {
    store.saveMessages(ACC, [adMsg({ jid: LID, ctwaClid: 'ARAlid' })], { live: true })
    store.saveMessages(ACC, [adMsg()], { live: true })
    getDb().prepare('UPDATE chat_attribution SET first_ts = 5 WHERE chat_jid = ?').run(LID)
    store.saveLidMappings(ACC, [{ lid: LID, pn: PN }])
    expect(getAttribution(ACC, PN)).toMatchObject({ ctwaClid: 'ARAlid', firstTs: 5 })
    expect(getAttribution(ACC, LID)).toBeNull()
  })

  test('excluir a conversa apaga a origem', () => {
    store.saveMessages(ACC, [adMsg()], { live: true })
    store.deleteChats(ACC, [PN])
    expect(getAttribution(ACC, PN)).toBeNull()
  })

  test('zerar os dados da conta apaga as origens e reinicia o cursor', () => {
    store.saveMessages(ACC, [adMsg()], { live: false })
    reprocessAdAttribution()
    store.resetAccountData(ACC)
    expect(getAttribution(ACC, PN)).toBeNull()
    expect(getDb().prepare("SELECT 1 FROM settings WHERE key = 'ads.reprocess.cursor'").get()).toBeUndefined()
  })

  test('a origem Anúncio vale por 30 dias; depois a venda volta a ser espontânea', () => {
    store.saveMessages(ACC, [adMsg()], { live: true })
    const dia = 86_400_000
    getDb()
      .prepare('UPDATE chat_attribution SET first_ts = ?')
      .run(Math.floor((Date.now() - 29 * dia) / 1000))
    expect(saveDeal(ACC, { chatJid: PN, status: 'won', amountCents: 1 }).sourceType).toBe('ad')
    getDb()
      .prepare('UPDATE chat_attribution SET first_ts = ?')
      .run(Math.floor((Date.now() - 31 * dia) / 1000))
    expect(saveDeal(ACC, { chatJid: PN, status: 'won', amountCents: 1 }).sourceType).toBe('organic')
  })

  test('o reprocesso usa a mensagem mais antiga como primeira origem', () => {
    const novo = adMsg({ ctwaClid: 'ARAnovo' })
    novo.messageTimestamp = 1_790_000_900
    const velho = adMsg()
    velho.messageTimestamp = 1_790_000_100
    store.saveMessages(ACC, [novo, velho], { live: false })
    getDb().prepare('DELETE FROM chat_attribution').run()
    reprocessAdAttribution()
    expect(getAttribution(ACC, PN)?.firstTs).toBe(1_790_000_100)
  })
})
