// Popula um banco temporário com conversas fictícias para prints da interface.
// Uso: DSP_SEED_DB=/caminho/dados.sqlite npx vitest run --config vitest.seed.config.ts
import { test } from 'vitest'
import type { WAMessage } from 'baileys'
import { closeDb, getDb, openDb } from '../../src/main/db'
import * as store from '../../src/main/wa/store'

const ACC = '22222222-2222-4222-8222-222222222222'
let n = 0
const now = Math.floor(Date.now() / 1000)
function m(jid: string, fromMe: boolean, message: object, ago: number, extra: object = {}): WAMessage {
  return {
    key: { remoteJid: jid, fromMe, id: `D${++n}` },
    messageTimestamp: now - ago,
    message,
    status: fromMe ? 4 : 0,
    ...extra
  } as WAMessage
}
const t = (s: string): object => ({ conversation: s })

test('seed', () => {
  openDb(process.env.DSP_SEED_DB!)
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO accounts (id, name, color, modules, auto_connect, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    )
    .run(
      ACC,
      'Ótica Centro',
      '#D9481F',
      JSON.stringify({ conversas: true, campanhas: true, antiban: true, vendas: true }),
      Date.now()
    )
  const ana = '5511987650001@s.whatsapp.net'
  const carlos = '5511987650002@s.whatsapp.net'
  const grupo = '120363000000000001@g.us'
  store.saveContacts(ACC, [
    { id: ana, name: 'Ana Souza' },
    { id: carlos, notify: 'Carlos Lima' },
    { id: '5511987650003@s.whatsapp.net', name: 'Beatriz Rocha' },
    { id: '5511987650004@s.whatsapp.net', name: 'Diego Martins' }
  ])
  store.setGroupName(ACC, grupo, 'Clientes VIP Equipe da Visão')
  store.saveMessages(
    ACC,
    [
      m(ana, false, t('Oi! Vi a promoção de Black Friday. Os 10% valem para óculos de grau também?'), 86400 + 3600),
      m(
        ana,
        true,
        t(
          'Oi Ana! Nesta campanha o desconto é para *semijoias e relógios*. Para óculos de grau temos condição especial em 10x sem juros 😊'
        ),
        86400 + 3000
      ),
      m(
        ana,
        false,
        {
          imageMessage: {
            caption: 'Gostei deste modelo, tem em dourado?',
            mimetype: 'image/jpeg',
            width: 800,
            height: 600
          }
        },
        7200
      ),
      m(ana, true, { conversation: 'Temos sim! Separo um para você?' }, 7000, {}),
      m(
        ana,
        false,
        {
          extendedTextMessage: {
            text: 'Pode separar, passo aí amanhã depois do almoço',
            contextInfo: { stanzaId: 'D4', participant: ana }
          }
        },
        600
      ),
      m(ana, false, { audioMessage: { ptt: true, seconds: 14, mimetype: 'audio/ogg; codecs=opus' } }, 300),
      m(carlos, false, t('Bom dia, meu óculos já ficou pronto?'), 3 * 3600),
      m(carlos, true, t('Bom dia, Carlos! Ficou sim, pode retirar até as 18h.'), 2 * 3600),
      m(
        carlos,
        false,
        {
          documentMessage: { fileName: 'receita-oftalmologista.pdf', mimetype: 'application/pdf', fileLength: 238000 }
        },
        2 * 3600 - 200
      ),
      m(grupo, false, t('Chegaram as novas armações Ray-Ban?'), 5 * 3600, {
        key: { remoteJid: grupo, participant: carlos, fromMe: false, id: 'DG1' },
        pushName: 'Carlos Lima'
      }),
      m(
        grupo,
        true,
        {
          locationMessage: {
            degreesLatitude: -23.561,
            degreesLongitude: -46.656,
            name: 'Equipe da Visão – Loja Centro',
            address: 'Av. Paulista, 1000'
          }
        },
        4 * 3600
      ),
      m(
        grupo,
        false,
        {
          pollCreationMessageV3: {
            name: 'Qual horário prefere para o evento?',
            options: [{ optionName: 'Sábado de manhã' }, { optionName: 'Sábado à tarde' }],
            selectableOptionsCount: 1
          }
        },
        4 * 3600 - 100,
        { key: { remoteJid: grupo, participant: ana, fromMe: false, id: 'DG2' }, pushName: 'Ana Souza' }
      ),
      m('5511987650003@s.whatsapp.net', false, t('Obrigada pelo atendimento! ❤️'), 2 * 86400),
      m('5511987650004@s.whatsapp.net', true, t('Diego, sua lente de contato chegou.'), 5 * 86400)
    ],
    { live: false }
  )
  store.saveMessages(
    ACC,
    [m(ana, false, { reactionMessage: { key: { remoteJid: ana, fromMe: true, id: 'D2' }, text: '🙏' } }, 200)],
    { live: false }
  )
  getDb().prepare('UPDATE chats SET unread = 2 WHERE jid = ?').run(ana)
  getDb().prepare('UPDATE chats SET unread = 1 WHERE jid = ?').run(carlos)
  closeDb()
})
