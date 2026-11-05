// Popula um banco temporário com conversas fictícias para prints da interface.
// Uso: DSP_SEED_DB=/caminho/dados.sqlite npx vitest run --config vitest.seed.config.ts
import { test } from 'vitest'
import type { WAMessage } from 'baileys'
import { closeDb, getDb, openDb } from '../../src/main/db'
import * as store from '../../src/main/wa/store'
import * as people from '../../src/main/people'
import * as C from '../../src/main/campaigns'
import { saveDeal } from '../../src/main/deals'
import { saveRule } from '../../src/main/automation'
import { saveReminder } from '../../src/main/reminders'

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
  getDb()
    .prepare('UPDATE accounts SET modules = ? WHERE id = ?')
    .run(
      JSON.stringify({
        conversas: true,
        campanhas: true,
        antiban: true,
        vendas: true,
        ia: true,
        respostasAuto: true,
        lembretes: true,
        gruposEnvio: true,
        gruposExtrair: true,
        gruposCriar: true,
        gruposModeracao: true
      }),
      ACC
    )
  const names = [
    'Ana Souza',
    'Bruno Costa',
    'Carla Mendes',
    'Diego Martins',
    'Elisa Prado',
    'Fábio Nunes',
    'Gabi Torres',
    'Heitor Reis'
  ]
  names.forEach((nm, i) =>
    people.savePerson(ACC, {
      name: nm,
      phone: `1198765${String(1000 + i)}`,
      birthday: i % 3 === 0 ? `0${(i % 9) + 1}/11/19${80 + i}` : null,
      tags: i % 2 ? ['VIP', 'Clientes 2026'] : ['Clientes 2026'],
      fields: { cidade: i % 2 ? 'Campinas' : 'São Paulo', data_compra: `2025-11-0${(i % 8) + 1}` }
    })
  )
  const c = C.saveCampaign({
    accountId: ACC,
    name: 'Black Friday semijoias',
    templates: [
      '{Oi|Olá} {primeiro_nome}! A Black da {loja} chegou: 10% OFF em semijoias e relógios. Quer que eu separe algum modelo pra você?',
      'Oi {primeiro_nome}, tudo bem? Novembro é mês de Black aqui na {loja}! Semijoias e relógios com 10% OFF. Posso te mostrar as novidades?'
    ],
    audience: { type: 'tags', tags: ['Clientes 2026'] },
    optOutFooter: true,
    scheduledAt: null
  })
  C.startCampaign(c.id)
  for (let s = 1; s <= 5; s++)
    C.markTarget(c.id, s, 'sent', { messageId: `X${s}`, jid: `55119876${1000 + s - 1}@s.whatsapp.net` })
  C.markTarget(c.id, 6, 'no_wa')
  C.onCampaignReceipt('X1', 4)
  C.onCampaignReceipt('X2', 4)
  C.onCampaignReceipt('X3', 3)
  C.onCampaignReply(ACC, '5511987651000@s.whatsapp.net')
  C.onCampaignReply(ACC, '5511987651001@s.whatsapp.net')
  C.pauseCampaign(c.id, null)
  saveDeal(ACC, { chatJid: ana, status: 'won', amountCents: 25990, product: 'Relógio dourado', payment: 'Pix' })
  saveDeal(ACC, {
    chatJid: '5511987651001@s.whatsapp.net',
    status: 'won',
    amountCents: 18900,
    product: 'Brinco',
    payment: 'Cartão de crédito'
  })
  saveDeal(ACC, { chatJid: carlos, status: 'won', amountCents: 89000, product: 'Óculos de grau', payment: 'Crediário' })
  saveDeal(ACC, { chatJid: '5511987650003@s.whatsapp.net', status: 'lost', amountCents: 0, reason: 'Preço' })
  saveRule(ACC, {
    name: 'Horário de funcionamento',
    kind: 'keyword',
    enabled: true,
    keywords: ['horário', 'que horas', 'aberto'],
    matchMode: 'contains',
    reply: 'Oi {primeiro_nome}! Funcionamos de segunda a sábado, das 9h às 19h. 😊',
    cooldownMin: 120
  })
  saveRule(ACC, {
    name: 'Fora do expediente',
    kind: 'away',
    enabled: true,
    keywords: [],
    matchMode: 'contains',
    reply: 'Recebemos sua mensagem! Respondemos assim que a loja abrir.',
    cooldownMin: 720,
    schedule: { hourStart: 9, hourEnd: 19, days: [1, 2, 3, 4, 5, 6] }
  })
  saveReminder(ACC, {
    name: 'Aniversário',
    kind: 'birthday',
    field: null,
    offsetDays: 0,
    sendHour: 10,
    template: 'Parabéns, {primeiro_nome}! 🎉',
    tags: [],
    enabled: true
  })
  saveReminder(ACC, {
    name: 'Revisão anual',
    kind: 'yearly',
    field: 'data_compra',
    offsetDays: 0,
    sendHour: 10,
    template: 'Oi {primeiro_nome}! Que tal revisar o grau?',
    tags: [],
    enabled: true
  })
  closeDb()
})
