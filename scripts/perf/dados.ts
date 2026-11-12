// Gera o banco sintético das medições. Tudo determinístico (semente fixa); só o "agora" acompanha o dia da medição.
import type { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'
import { proto } from 'baileys'
import { ACCOUNTS, BASELINE_COMMIT, SIZES, migrationsAt, openWith, rng } from './lib'

const DAY = 86_400
const FIRST = (
  'Maria Ana João José Antônio Francisca Carlos Paulo Pedro Lucas Luiz Marcos Luís Gabriel Rafael Daniel Marcelo Bruno ' +
  'Eduardo Felipe Juliana Márcia Fernanda Patrícia Aline Sandra Camila Amanda Bruna Jéssica Letícia Júlia Luciana Vanessa ' +
  'Mariana Gabriela Vera Vitória Larissa Cláudia Beatriz Rita Sônia Regina Tereza Helena Simone Débora Érica Íris'
).split(' ')
const LAST = (
  'Silva Santos Oliveira Souza Rodrigues Ferreira Alves Pereira Lima Gomes Costa Ribeiro Martins Carvalho Almeida Lopes ' +
  'Soares Fernandes Vieira Barbosa Rocha Dias Nascimento Andrade Moreira Nunes Marques Machado Mendes Freitas'
).split(' ')
const PHRASES = [
  'Bom dia, tudo bem?',
  'Boa tarde! Gostaria de saber o valor das lentes multifocais',
  'Vocês fazem exame de vista aí na loja?',
  'Qual o horário de funcionamento no sábado?',
  'Pode me mandar o orçamento por aqui mesmo',
  'Fechado, vou passar aí amanhã para retirar',
  'O óculos ficou pronto? Faz uma semana que deixei a receita',
  'Obrigada pelo atendimento',
  'Tem armação infantil? Meu filho tem 7 anos',
  'Aceitam cartão em quantas vezes sem juros?',
  'Vou pensar e te aviso, o preço ficou um pouco acima do que eu esperava',
  'Meu aniversário é dia 12/03, tem desconto de aniversariante?',
  'Segue a receita em anexo',
  'Perfeito, combinado então',
  'Olá! Vi o anúncio de vocês no Instagram e queria saber mais sobre a promoção',
  'Consegue um desconto à vista no pix?',
  'A lente com antirreflexo e filtro de luz azul sai por quanto?',
  'Pode ser para sexta-feira às 15h?',
  'Não estou enxergando bem de longe com o óculos novo, preciso ajustar',
  'Qual o endereço da loja do shopping?',
  'ok',
  'Sim',
  'Muito obrigado!',
  'Vocês trabalham com lente de contato colorida?',
  'Quanto tempo demora para ficar pronto?',
  'Boa noite, ainda estão atendendo?',
  'Recebi sim, obrigada. Vou conversar com meu marido e retorno',
  'O pagamento já foi feito, segue o comprovante',
  'Tem garantia a armação? A haste quebrou com dois meses de uso',
  'Pode reservar essa armação preta para mim até amanhã?'
]
const TAGS = [
  'cliente',
  'orçamento',
  'lead',
  'vip',
  'lentes de contato',
  'pós-venda',
  'multifocal',
  'infantil',
  'aniversariante',
  'inadimplente',
  'revisão anual',
  'solar'
]
const UTM_SOURCE = ['google', 'facebook', 'instagram', 'tiktok', null]
const REASONS = ['Preço', 'Sem resposta', 'Comprou em outro lugar', 'Sem interesse', 'Prazo', null]
const SOURCES: Array<[string, number]> = [
  ['organic', 0.55],
  ['campaign', 0.2],
  ['ad', 0.12],
  ['reminder', 0.05],
  ['recovery', 0.05],
  ['group', 0.03]
]

export interface Meta {
  now: number
  nowSec: number
  baseline: string
  counts: Record<string, number>
  samples: Record<
    string,
    {
      bigChat: string
      bigChatMessages: number
      bigGroup: string
      typicalChat: string
      personId: number
      pipelineId: number
      reminderIds: number[]
      adChats: number
    }
  >
}

interface ChatSeed {
  acc: number
  jid: string
  pn: string | null
  phone: string | null
  isGroup: boolean
  name: string
  n: number
  lastTs: number
  ad: boolean
}

function hex(n: number, len = 8): string {
  return (n >>> 0).toString(16).toUpperCase().padStart(len, '0')
}

/** Banco grande no esquema do commit de referência (antes das funções novas). */
export function generateBase(path: string, now: number): Meta {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
  const db = openWith(path, migrationsAt(BASELINE_COMMIT))
  const r = rng(20261111)
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]
  const int = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1))
  const fullName = (): string => `${pick(FIRST)} ${pick(LAST)}`
  const nowSec = Math.floor(now / 1000)
  const modules = JSON.stringify({
    conversas: true,
    campanhas: true,
    antiban: true,
    gruposEnvio: true,
    gruposExtrair: true,
    gruposCriar: true,
    gruposModeracao: true,
    respostasAuto: true,
    lembretes: true,
    vendas: true,
    funil: true,
    ia: true,
    status: true,
    metaConversoes: true,
    leadsPlanilha: true,
    perfilIa: true,
    iaAtendimento: true
  })
  const tx = (fn: () => void): void => {
    db.exec('BEGIN')
    fn()
    db.exec('COMMIT')
  }

  tx(() => {
    const ins = db.prepare(
      'INSERT INTO accounts (id, name, color, phone, modules, auto_connect, created_at) VALUES (?,?,?,?,?,1,?)'
    )
    ACCOUNTS.forEach((a, i) => ins.run(a.id, a.name, '#2563eb', `55119900000${i}`, modules, now - 700 * DAY * 1000 + i))
    const auth = db.prepare('INSERT INTO wa_auth (account_id, category, key_id, value) VALUES (?,?,?,?)')
    for (const a of ACCOUNTS)
      for (let i = 0; i < 2000; i++)
        auth.run(a.id, i % 3 ? 'session' : 'pre-key', `k${i}`, new Uint8Array(180).fill(i % 251))
  })

  // ---------- conversas (sementes) ----------
  const chats: ChatSeed[] = []
  const perAcc = ACCOUNTS.map((a) => Math.round(SIZES.chats * a.share))
  let idx = 0
  for (let acc = 0; acc < ACCOUNTS.length; acc++) {
    for (let i = 0; i < perAcc[acc]; i++, idx++) {
      const u = r()
      const phone = `55${11 + (idx % 80)}9${String(80_000_000 + idx)}`
      const isGroup = u < 0.03
      const lid = !isGroup && u < 0.33
      const jid = isGroup
        ? `1203630${String(100_000_000 + idx)}@g.us`
        : lid
          ? `${100_000_000_000_000 + idx * 7}@lid`
          : `${phone}@s.whatsapp.net`
      const v = r()
      let n = v < 0.7 ? int(1, 15) : v < 0.95 ? int(15, 60) : v < 0.995 ? int(60, 400) : int(400, 4000)
      if (isGroup) n *= 4
      chats.push({
        acc,
        jid,
        pn: isGroup ? null : `${phone}@s.whatsapp.net`,
        phone: isGroup ? null : phone,
        isGroup,
        name: isGroup ? `Grupo ${pick(LAST)} ${i}` : fullName(),
        n,
        lastTs: nowSec - Math.floor(r() ** 3 * 730 * DAY),
        ad: !isGroup && r() < 0.075
      })
    }
  }
  // Ajusta para o total pedido de mensagens
  const rawTotal = chats.reduce((s, c) => s + c.n, 0)
  let total = 0
  for (const c of chats) {
    c.n = Math.max(1, Math.round((c.n * SIZES.messages) / rawTotal))
    total += c.n
  }
  const biggest = chats.reduce((a, b) => (b.n > a.n ? b : a))
  biggest.n += SIZES.messages - total

  // ---------- mensagens: horários por conversa, depois ordem global de chegada ----------
  const msgChat = new Int32Array(SIZES.messages)
  const msgTs = new Int32Array(SIZES.messages)
  let k = 0
  chats.forEach((c, ci) => {
    const longMax = Math.min(5 * DAY, Math.max(3600, Math.floor((730 * DAY * 4) / c.n)))
    let t = c.lastTs
    for (let i = 0; i < c.n; i++) {
      msgChat[k] = ci
      msgTs[k] = t
      k++
      t -= r() < 0.75 ? int(5, 600) : int(1800, longMax)
    }
  })
  const order = Uint32Array.from({ length: SIZES.messages }, (_, i) => i).sort((a, b) => msgTs[a] - msgTs[b] || a - b)

  const thumbs = Array.from({ length: 64 }, () => {
    const b = new Uint8Array(int(700, 1500))
    for (let i = 0; i < b.length; i++) b[i] = int(0, 255)
    return b
  })
  const thumbUrls = thumbs.map((b) => `data:image/jpeg;base64,${Buffer.from(b).toString('base64')}`)
  const key32 = new Uint8Array(32).fill(7)
  const participants = Array.from(
    { length: 5000 },
    (_, i) => `55${11 + (i % 80)}9${String(70_000_000 + i)}@s.whatsapp.net`
  )

  const lastId: Array<string | null> = new Array(chats.length).fill(null)
  const lastPreview: Array<string | null> = new Array(chats.length).fill(null)
  const lastFromMe = new Uint8Array(chats.length)
  const seenIncoming = new Uint8Array(chats.length)
  const perAccMessages = [0, 0, 0]

  const insMsg = db.prepare(
    `INSERT INTO messages (account_id, chat_jid, id, from_me, sender, sender_name, ts, type, text, media, extra, quoted_id, status, raw, transcript)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  const insFts = db.prepare('INSERT INTO messages_fts (text, account_id, chat_jid, id) VALUES (?,?,?,?)')
  db.exec('BEGIN')
  for (let n = 0; n < order.length; n++) {
    if (n && n % 50_000 === 0) {
      db.exec('COMMIT')
      db.exec('BEGIN')
    }
    const i = order[n]
    const ci = msgChat[i]
    const c = chats[ci]
    const ts = msgTs[i]
    const accId = ACCOUNTS[c.acc].id
    const fromMe = r() < (c.isGroup ? 0.1 : 0.45) ? 1 : 0
    const id = (fromMe ? '3EB0' : '3A') + hex(n) + hex(Math.imul(n + 1, 2654435761)) + hex(Math.imul(n + 7, 40503), 4)
    const sender = fromMe ? null : c.isGroup ? participants[(ci * 31 + int(0, 40)) % participants.length] : c.jid
    const pushName = fromMe ? null : r() < 0.85 ? c.name : null
    const u = r()
    let type = 'text'
    let text: string | null = null
    let media: string | null = null
    let extra: string | null = null
    let transcript: string | null = null
    let quoted: string | null = null
    let message: proto.IMessage
    const firstIncomingAd = c.ad && !fromMe && !seenIncoming[ci]
    if (!fromMe) seenIncoming[ci] = 1
    if (u < 0.88 || firstIncomingAd) {
      text = pick(PHRASES) + (r() < 0.3 ? ' ' + pick(PHRASES) : '')
      if (firstIncomingAd) {
        message = {
          extendedTextMessage: {
            text,
            contextInfo: {
              conversionSource: 'FB_Ads',
              entryPointConversionSource: 'ctwa_ad',
              externalAdReply: {
                title: 'Óculos completos a partir de R$ 199',
                sourceId: `12023${String(1000 + (ci % 40))}`,
                sourceUrl: `https://fb.me/${hex(ci, 6)}`,
                ...(r() < 0.35 ? { ctwaClid: `Af${hex(ci)}${hex(n)}clid` } : {})
              }
            }
          }
        }
      } else if (lastId[ci] && r() < 0.03) {
        quoted = lastId[ci]
        extra = JSON.stringify({ quoted: { id: quoted, text: 'mensagem citada', type: 'text', fromMe: false } })
        message = { extendedTextMessage: { text, contextInfo: { stanzaId: quoted, participant: c.jid } } }
      } else message = r() < 0.8 ? { conversation: text } : { extendedTextMessage: { text } }
    } else if (u < 0.93) {
      type = 'image'
      const t = int(0, 63)
      text = r() < 0.2 ? pick(PHRASES) : null
      media = JSON.stringify({
        mimetype: 'image/jpeg',
        size: int(40_000, 400_000),
        width: 1080,
        height: 1350,
        thumb: thumbUrls[t]
      })
      message = {
        imageMessage: {
          mimetype: 'image/jpeg',
          fileLength: 123456,
          width: 1080,
          height: 1350,
          caption: text ?? undefined,
          jpegThumbnail: thumbs[t],
          mediaKey: key32,
          fileSha256: key32,
          fileEncSha256: key32,
          directPath: `/v/t62.7118-24/${hex(n)}_${hex(ci)}_n.enc?ccb=11-4&oh=01_Q5&oe=6712&_nc_sid=5e03e0`,
          url: `https://mmg.whatsapp.net/v/t62.7118-24/${hex(n)}_${hex(ci)}_n.enc`
        }
      }
    } else if (u < 0.97) {
      type = 'voice'
      const seconds = int(3, 90)
      media = JSON.stringify({ mimetype: 'audio/ogg; codecs=opus', size: seconds * 2000, seconds })
      if (r() < 0.3) transcript = pick(PHRASES)
      message = {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          seconds,
          ptt: true,
          mediaKey: key32,
          fileSha256: key32,
          fileEncSha256: key32,
          waveform: thumbs[0].subarray(0, 64),
          directPath: `/v/t62.7117-24/${hex(n)}.enc`
        }
      }
    } else if (u < 0.98) {
      type = 'sticker'
      media = JSON.stringify({ mimetype: 'image/webp', size: 30_000, width: 512, height: 512 })
      message = { stickerMessage: { mimetype: 'image/webp', mediaKey: key32, fileSha256: key32, fileEncSha256: key32 } }
    } else if (u < 0.99) {
      type = 'document'
      media = JSON.stringify({ mimetype: 'application/pdf', fileName: `receita-${n}.pdf`, size: 180_000 })
      message = {
        documentMessage: {
          mimetype: 'application/pdf',
          fileName: `receita-${n}.pdf`,
          mediaKey: key32,
          fileSha256: key32
        }
      }
    } else {
      type = 'system'
      extra = JSON.stringify({ label: 'As mensagens são protegidas com criptografia' })
      message = { protocolMessage: { type: 3 } }
    }
    const status = fromMe ? int(2, 4) : 0
    const raw = proto.WebMessageInfo.encode({
      key: { remoteJid: c.jid, fromMe: !!fromMe, id, ...(c.isGroup && sender ? { participant: sender } : {}) },
      messageTimestamp: ts,
      pushName: pushName ?? undefined,
      status,
      message
    }).finish()
    insMsg.run(
      accId,
      c.jid,
      id,
      fromMe,
      sender,
      pushName,
      ts,
      type,
      text,
      media,
      extra,
      quoted,
      status,
      raw,
      transcript
    )
    if (text) insFts.run(text, accId, c.jid, id)
    lastId[ci] = id
    lastFromMe[ci] = fromMe
    lastPreview[ci] = text
      ? text.slice(0, 100)
      : type === 'image'
        ? '📷 Foto'
        : type === 'voice'
          ? '🎤 Áudio'
          : 'Mensagem'
    perAccMessages[c.acc]++
  }
  db.exec('COMMIT')

  // ---------- conversas, contatos e mapa de LID ----------
  tx(() => {
    const insChat = db.prepare(
      `INSERT INTO chats (account_id, jid, name, is_group, unread, last_ts, last_preview, last_from_me, archived, pinned, muted_until)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    const insContact = db.prepare(
      'INSERT OR IGNORE INTO contacts (account_id, jid, name, notify, verified_name, updated_at) VALUES (?,?,?,?,?,?)'
    )
    const insLid = db.prepare('INSERT OR IGNORE INTO lid_map (account_id, lid, pn) VALUES (?,?,?)')
    chats.forEach((c, ci) => {
      const accId = ACCOUNTS[c.acc].id
      const unread = !lastFromMe[ci] && r() < 0.12 ? int(1, 9) : 0
      insChat.run(
        accId,
        c.jid,
        c.isGroup ? c.name : r() < 0.2 ? c.name : null,
        c.isGroup ? 1 : 0,
        unread,
        c.lastTs,
        lastPreview[ci],
        lastFromMe[ci],
        r() < 0.03 ? 1 : 0,
        r() < 0.003 ? 1 : 0,
        r() < 0.02 ? -1 : 0
      )
      if (c.isGroup) return
      insContact.run(accId, c.jid, r() < 0.55 ? c.name : null, r() < 0.85 ? c.name.split(' ')[0] : null, null, now)
      if (c.jid.endsWith('@lid')) {
        insLid.run(accId, c.jid, c.pn)
        insContact.run(accId, c.pn, null, c.name.split(' ')[0], null, now)
      }
    })
    // participantes de grupos (contato e LID, sem conversa própria)
    ACCOUNTS.forEach((a, ai) => {
      const count = Math.round(5000 * a.share)
      for (let i = 0; i < count; i++) {
        const jid = participants[(ai * 1777 + i) % participants.length]
        insContact.run(a.id, jid, null, pick(FIRST), null, now)
        insLid.run(a.id, `${200_000_000_000_000 + ai * 10_000_000 + i}@lid`, jid)
      }
    })
  })

  // ---------- contatos da base (people), etiquetas, supressão ----------
  const peopleByAcc: Array<Array<{ id: number; chat: ChatSeed | null; phone: string }>> = [[], [], []]
  tx(() => {
    const insPerson = db.prepare(
      `INSERT INTO people (account_id, phone, jid, name, birthday, fields, opt_out, opt_out_at, has_wa, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?)`
    )
    const insTag = db.prepare('INSERT OR IGNORE INTO person_tags (person_id, tag) VALUES (?,?)')
    const insDef = db.prepare('INSERT OR IGNORE INTO tag_defs (account_id, name, color, created_at) VALUES (?,?,?,?)')
    const insSup = db.prepare('INSERT OR IGNORE INTO suppression (account_id, key, at) VALUES (?,?,?)')
    ACCOUNTS.forEach((a, ai) => {
      for (const t of TAGS) insDef.run(a.id, t, 'slate', now)
      const mine = chats.filter((c) => c.acc === ai && !c.isGroup)
      const count = Math.round(SIZES.people * a.share)
      const stride = Math.max(1, Math.floor(mine.length / Math.ceil(count * 0.85)))
      let withChatCount = 0
      for (let i = 0; i < count; i++) {
        const withChat = i % 20 < 17
        const chat = withChat ? (mine[(withChatCount++ * stride) % mine.length] ?? null) : null
        const phone = chat?.phone ?? `55${11 + (i % 80)}9${String(60_000_000 + ai * 1_000_000 + i)}`
        const bd = r() < 0.4
        const birthday = bd
          ? r() < 0.6
            ? `${int(1950, 2005)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`
            : `--${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`
          : null
        const fields =
          r() < 0.35
            ? JSON.stringify({
                'Última compra': `202${int(4, 6)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
                Cidade: pick(['São Paulo', 'Campinas', 'Santos', 'Osasco'])
              })
            : null
        const opt = r() < 0.02 ? 1 : 0
        let id: number
        try {
          id = Number(
            insPerson.run(
              a.id,
              phone,
              chat?.pn ?? null,
              chat?.name ?? fullName(),
              birthday,
              fields,
              opt,
              opt ? now : null,
              now - int(0, 600) * DAY * 1000,
              now
            ).lastInsertRowid
          )
        } catch {
          continue // mesmo telefone sorteado duas vezes
        }
        peopleByAcc[ai].push({ id, chat, phone })
        const nt = r() < 0.3 ? 0 : r() < 0.6 ? 1 : int(2, 3)
        for (let t = 0; t < nt; t++) insTag.run(id, pick(TAGS))
        if (opt) {
          insSup.run(a.id, phone, now)
          insSup.run(a.id, `${phone}@s.whatsapp.net`, now)
        }
      }
    })
  })

  // ---------- lembretes, campanhas e envios ----------
  const reminderIds: number[][] = [[], [], []]
  tx(() => {
    const insRem = db.prepare(
      `INSERT INTO reminders (account_id, name, kind, field, offset_days, send_hour, template, tags, enabled, last_run_day, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,NULL,?)`
    )
    const insLog = db.prepare(
      'INSERT OR IGNORE INTO reminder_log (reminder_id, person_id, period, at) VALUES (?,?,?,?)'
    )
    const year = String(new Date(now).getFullYear())
    ACCOUNTS.forEach((a, ai) => {
      const defs: Array<[string, string, string | null, number, string]> = [
        ['Aniversário', 'birthday', null, 0, '[]'],
        ['Revisão anual', 'yearly', 'Última compra', 0, '[]'],
        ['Pós-venda 180 dias', 'days_after', 'Última compra', 180, JSON.stringify(['cliente'])]
      ]
      for (const [name, kind, field, off, tags] of defs) {
        const id = Number(
          insRem.run(a.id, name, kind, field, off, 9, 'Olá {nome}! Lembrete da loja.', tags, now).lastInsertRowid
        )
        reminderIds[ai].push(id)
        const ppl = peopleByAcc[ai]
        for (let i = 0; i < Math.min(300, ppl.length); i++)
          insLog.run(id, ppl[(i * 7) % ppl.length].id, year, now - int(1, 200) * DAY * 1000)
      }
    })
    const insCamp = db.prepare(
      `INSERT INTO campaigns (account_id, name, kind, status, templates, audience, started_at, finished_at, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    const insTarget = db.prepare(
      `INSERT INTO campaign_targets (campaign_id, seq, person_id, jid, phone, name, status, message_id, sent_at, delivered_at, read_at, replied_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    for (let c = 0; c < 40; c++) {
      const ai = c % 10 < 6 ? 0 : c % 10 < 9 ? 1 : 2
      const a = ACCOUNTS[ai]
      const reminder = c % 4 === 3
      const started = now - int(1, 360) * DAY * 1000
      const cid = Number(
        insCamp.run(
          a.id,
          `Campanha ${c + 1}`,
          reminder ? 'reminder' : 'people',
          'finished',
          JSON.stringify(['Olá {nome}, temos uma novidade para você!']),
          JSON.stringify({ type: 'all' }),
          started,
          started + 6 * 3600_000,
          reminder ? `reminder:${reminderIds[ai][c % 3]}` : null,
          started
        ).lastInsertRowid
      )
      const ppl = peopleByAcc[ai]
      const size = Math.min(ppl.length, int(200, 800))
      for (let s = 0; s < size; s++) {
        const p = ppl[(c * 131 + s) % ppl.length]
        const u = r()
        const st = u < 0.9 ? 'sent' : u < 0.95 ? 'failed' : 'pending'
        const at = started + s * 45_000
        insTarget.run(
          cid,
          s,
          p.id,
          `${p.phone}@s.whatsapp.net`,
          p.phone,
          null,
          st,
          st === 'sent' ? `3EB0C${hex(c)}${hex(s)}` : null,
          st === 'sent' ? at : null,
          st === 'sent' ? at + 4000 : null,
          st === 'sent' && r() < 0.6 ? at + 600_000 : null,
          st === 'sent' && r() < 0.08 ? at + 3600_000 : null
        )
      }
    }
    const insSend = db.prepare('INSERT OR IGNORE INTO send_log (account_id, day, sent) VALUES (?,?,?)')
    for (const a of ACCOUNTS)
      for (let d = 0; d < 400; d++)
        insSend.run(a.id, new Date(now - d * DAY * 1000).toISOString().slice(0, 10), int(0, 180))
  })

  // ---------- vendas e funis ----------
  const pipelineIds: number[][] = [[], [], []]
  tx(() => {
    const insDeal = db.prepare(
      `INSERT INTO deals (account_id, chat_jid, status, amount_cents, product, payment, reason, source_type, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    ACCOUNTS.forEach((a, ai) => {
      const mine = chats.filter((c) => c.acc === ai && !c.isGroup)
      const ppl = peopleByAcc[ai].filter((p) => p.chat)
      const count = Math.round(SIZES.deals * a.share)
      for (let i = 0; i < count; i++) {
        const chat = r() < 0.7 ? ppl[int(0, ppl.length - 1)].chat! : mine[int(0, mine.length - 1)]
        const won = r() < 0.7
        let u = r()
        let src = 'organic'
        for (const [name, w] of SOURCES) {
          if (u < w) {
            src = name
            break
          }
          u -= w
        }
        insDeal.run(
          a.id,
          chat.jid,
          won ? 'won' : 'lost',
          won ? int(5_000, 250_000) : 0,
          won ? pick(['Óculos completo', 'Lentes', 'Armação', 'Lente de contato']) : null,
          won ? pick(['pix', 'cartão', 'dinheiro']) : null,
          won ? null : pick(REASONS),
          src,
          now - Math.floor(r() ** 1.5 * 400 * DAY * 1000)
        )
      }
    })
    const insPipe = db.prepare(
      'INSERT INTO pipelines (account_id, name, color, position, created_at) VALUES (?,?,?,?,?)'
    )
    const insStage = db.prepare(
      'INSERT INTO pipeline_stages (pipeline_id, name, color, kind, position, auto_tag) VALUES (?,?,?,?,?,?)'
    )
    const insCard = db.prepare(
      `INSERT OR IGNORE INTO pipeline_cards (pipeline_id, stage_id, person_id, position, value_cents, note, created_at, moved_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    const stageDefs: Array<[string, string]> = [
      ['Novo contato', 'open'],
      ['Orçamento enviado', 'open'],
      ['Negociação', 'open'],
      ['Ganhou', 'won'],
      ['Perdeu', 'lost']
    ]
    ACCOUNTS.forEach((a, ai) => {
      const nPipes = ai === 2 ? 1 : 2
      const cards = Math.round(SIZES.cards * a.share)
      for (let p = 0; p < nPipes; p++) {
        const pid = Number(insPipe.run(a.id, p ? 'Pós-venda' : 'Vendas', 'blue', p, now).lastInsertRowid)
        pipelineIds[ai].push(pid)
        const stages = stageDefs.map(([name, kind], pos) =>
          Number(insStage.run(pid, name, 'slate', kind, pos, pos === 1 ? 'orçamento' : null).lastInsertRowid)
        )
        const ppl = peopleByAcc[ai]
        const share = p === 0 ? (nPipes === 1 ? 1 : 0.7) : 0.3
        const n = Math.min(ppl.length, Math.round(cards * share))
        for (let i = 0; i < n; i++) {
          const person = ppl[(i * 3 + p) % ppl.length]
          const stage = stages[Math.min(4, Math.floor(r() ** 1.3 * 5))]
          insCard.run(
            pid,
            stage,
            person.id,
            i + 1,
            r() < 0.6 ? int(10_000, 200_000) : 0,
            r() < 0.2 ? pick(PHRASES) : null,
            now,
            now
          )
        }
      }
    })
  })

  // ---------- automações, grupos, fotos, IA ----------
  tx(() => {
    const insRule = db.prepare(
      'INSERT INTO auto_rules (account_id, name, kind, enabled, keywords, match_mode, reply, cooldown_min, created_at) VALUES (?,?,?,1,?,?,?,60,?)'
    )
    const insALog = db.prepare('INSERT INTO auto_log (account_id, rule_id, jid, at) VALUES (?,?,?,?)')
    const insGroup = db.prepare(
      'INSERT INTO groups_cache (account_id, jid, subject, size, is_admin, announce, participants, updated_at) VALUES (?,?,?,?,?,?,?,?)'
    )
    const insAvatar = db.prepare('INSERT OR IGNORE INTO avatars (account_id, jid, file, checked_at) VALUES (?,?,?,?)')
    ACCOUNTS.forEach((a, ai) => {
      const mine = chats.filter((c) => c.acc === ai)
      const rules = [
        ['Preço', 'keyword', JSON.stringify(['preço', 'valor', 'quanto custa'])],
        ['Endereço', 'keyword', JSON.stringify(['endereço', 'onde fica'])],
        ['Horário', 'keyword', JSON.stringify(['horário', 'aberto'])],
        [
          'Fora do horário',
          'away',
          JSON.stringify({ schedule: { hourStart: 8, hourEnd: 18, days: [1, 2, 3, 4, 5, 6] } })
        ]
      ].map(([name, kind, kw]) =>
        Number(insRule.run(a.id, name, kind, kw, 'contains', 'Resposta automática', now).lastInsertRowid)
      )
      for (let i = 0; i < Math.round(5000 * a.share); i++)
        insALog.run(a.id, rules[i % rules.length], mine[int(0, mine.length - 1)].jid, now - int(0, 7 * DAY) * 1000)
      mine.forEach((c, i) => {
        if (c.isGroup) {
          const size = int(20, 200)
          const parts = Array.from({ length: size }, (_, p) => ({
            id: participants[(i * 13 + p) % participants.length],
            admin: p < 2
          }))
          insGroup.run(a.id, c.jid, c.name, size, i % 5 === 0 ? 1 : 0, 0, JSON.stringify(parts), now)
        }
        if (i % 5 < 2)
          insAvatar.run(a.id, c.jid, i % 3 ? `${hex(i)}${hex(ai)}.jpg` : null, now - int(0, 20) * DAY * 1000)
      })
    })
    const insProv = db.prepare(
      'INSERT INTO ai_providers (preset, name, base_url, model_fast, model_smart, trains_on_data, rpm, rpd, paid, enabled, priority, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)'
    )
    const insUsage = db.prepare('INSERT INTO ai_usage (provider_id, day, requests, tokens, errors) VALUES (?,?,?,?,?)')
    const insAiLog = db.prepare(
      'INSERT INTO ai_log (provider, model, task, customer_data, chars_sent, at) VALUES (?,?,?,?,?,?)'
    )
    const provs = ['groq', 'gemini', 'local'].map((p, i) =>
      Number(
        insProv.run(p, p, 'https://localhost.invalid/v1', 'rapido', 'forte', i === 2 ? 0 : 1, 30, 1000, 0, 100 + i, now)
          .lastInsertRowid
      )
    )
    for (const pid of provs)
      for (let d = 0; d < 90; d++)
        insUsage.run(
          pid,
          new Date(now - d * DAY * 1000).toISOString().slice(0, 10),
          int(0, 400),
          int(0, 400_000),
          int(0, 5)
        )
    for (let i = 0; i < 20_000; i++)
      insAiLog.run(
        'groq',
        'rapido',
        pick(['atendimento', 'perfil', 'assistente']),
        1,
        int(500, 6000),
        now - (20_000 - i) * 120_000
      )
    const insPb = db.prepare('INSERT INTO playbooks (account_id, content, updated_at) VALUES (?,?,?)')
    const insSync = db.prepare(
      'INSERT INTO sync_state (account_id, progress, messages, chats, started_at, finished_at) VALUES (?,?,?,?,?,?)'
    )
    ACCOUNTS.forEach((a, ai) => {
      insPb.run(a.id, Array.from({ length: 40 }, () => pick(PHRASES)).join('\n'), now)
      insSync.run(a.id, 100, perAccMessages[ai], perAcc[ai], now - 700 * DAY * 1000, now - 700 * DAY * 1000 + 600_000)
    })
  })

  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  const counts: Record<string, number> = {}
  for (const t of [
    'accounts',
    'chats',
    'messages',
    'contacts',
    'lid_map',
    'people',
    'person_tags',
    'deals',
    'pipeline_cards',
    'campaigns',
    'campaign_targets',
    'reminders',
    'reminder_log',
    'auto_log',
    'avatars',
    'groups_cache',
    'ai_log',
    'wa_auth'
  ])
    counts[t] = count(t)
  db.close()

  const samples: Meta['samples'] = {}
  ACCOUNTS.forEach((a, ai) => {
    const mine = chats.filter((c) => c.acc === ai)
    const single = mine.filter((c) => !c.isGroup)
    const big = single.reduce((x, y) => (y.n > x.n ? y : x))
    const typical = [...single].sort((x, y) => x.n - y.n)[Math.floor(single.length * 0.8)]
    samples[a.id] = {
      bigChat: big.jid,
      bigChatMessages: big.n,
      bigGroup: mine.filter((c) => c.isGroup).reduce((x, y) => (y.n > x.n ? y : x)).jid,
      typicalChat: typical.jid,
      personId: peopleByAcc[ai].find((p) => p.chat)!.id,
      pipelineId: pipelineIds[ai][0],
      reminderIds: reminderIds[ai],
      adChats: single.filter((c) => c.ad).length
    }
  })
  return { now, nowSec, baseline: BASELINE_COMMIT, counts, samples }
}

/** Preenche as tabelas criadas depois do commit de referência (o banco já precisa estar migrado). */
export function fillNewTables(db: DatabaseSync, meta: Meta): Record<string, number> {
  const r = rng(77)
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]
  const int = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1))
  const now = meta.now
  db.exec('BEGIN')
  const insLead = db.prepare(
    `INSERT OR IGNORE INTO leads (account_id, dedupe_key, tab, created_at, name, email, phone, interest, utm_source, utm_medium, utm_campaign, utm_content, utm_term, page, imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  const insNote = db.prepare(
    `INSERT INTO contact_notes (account_id, person_id, kind, title, body, author, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
  )
  const insState = db.prepare(
    'INSERT OR IGNORE INTO contact_profile_state (person_id, account_id, last_ts, failed_at) VALUES (?,?,?,0)'
  )
  const insMode = db.prepare(
    `INSERT OR IGNORE INTO chat_ai_mode (account_id, chat_jid, mode, reason, topic, agent, human_at, pending_since, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
  const insIaLog = db.prepare('INSERT INTO ia_atendimento_log (account_id, chat_jid, at) VALUES (?,?,?)')
  const insStatus = db.prepare(
    `INSERT INTO status_posts (account_id, kind, text, audience, scheduled_at, status, sent_at, recipients_count, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
  const setKey = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  for (const a of ACCOUNTS) {
    const ppl = db.prepare('SELECT id, phone FROM people WHERE account_id = ? ORDER BY id').all(a.id) as Array<{
      id: number
      phone: string
    }>
    const recent = db
      .prepare('SELECT jid FROM chats WHERE account_id = ? AND is_group = 0 ORDER BY last_ts DESC LIMIT ?')
      .all(a.id, Math.round(3000 * a.share)) as Array<{ jid: string }>
    const nLeads = Math.round(SIZES.leads * a.share)
    for (let i = 0; i < nLeads; i++) {
      const u = r()
      let phone: string | null = null
      if (u < 0.6) {
        phone = ppl[int(0, ppl.length - 1)].phone
        // parte dos formulários vem sem o nono dígito
        if (r() < 0.25 && phone.length === 13) phone = phone.slice(0, 4) + phone.slice(5)
      } else if (u < 0.85) phone = `55${11 + (i % 80)}9${String(50_000_000 + i)}`
      const src = pick(UTM_SOURCE)
      insLead.run(
        a.id,
        `lead-${a.id.slice(0, 4)}-${i}`,
        i % 4 ? 'Leads' : 'Orçamentos',
        now - Math.floor(r() * 180 * DAY * 1000),
        `${pick(FIRST)} ${pick(LAST)}`,
        `lead${i}@exemplo.com.br`,
        phone,
        pick(['multifocal', 'solar', 'infantil', null]),
        src,
        src ? 'cpc' : null,
        src ? `campanha-${int(1, 12)}` : null,
        src ? `criativo-${int(1, 20)}` : null,
        null,
        `/pagina-${int(1, 6)}`,
        now
      )
    }
    for (let i = 0; i < Math.round(4000 * a.share); i++) {
      const p = ppl[int(0, ppl.length - 1)]
      const at = now - int(0, 300) * DAY * 1000
      insNote.run(
        a.id,
        p.id,
        pick(['geral', 'perfil', 'preferencia', 'objecao', 'familia']),
        'Anotação',
        pick(PHRASES),
        r() < 0.5 ? 'ia' : 'atendente',
        r() < 0.1 ? 1 : 0,
        at,
        at
      )
    }
    for (let i = 0; i < Math.round(1500 * a.share); i++)
      insState.run(ppl[(i * 3) % ppl.length].id, a.id, meta.nowSec - int(1, 60) * DAY)
    recent.forEach((c, i) => {
      const u = r()
      const at = now - int(0, 30) * DAY * 1000
      if (u < 0.55) insMode.run(a.id, c.jid, 'ia', 'novo', null, null, null, null, at)
      else if (u < 0.98)
        insMode.run(
          a.id,
          c.jid,
          'humano',
          i % 3 ? 'atendente' : 'antiga',
          null,
          null,
          at,
          r() < 0.1 ? now - int(1, 600) * 60_000 : null,
          at
        )
      else insMode.run(a.id, c.jid, 'espera', 'pediu_humano', 'orçamento', 'Vendas', null, null, at)
    })
    for (let i = 0; i < Math.round(2000 * a.share); i++)
      insIaLog.run(a.id, recent[int(0, Math.min(recent.length, 400) - 1)].jid, now - int(0, 48 * 3600) * 1000)
    for (let i = 0; i < Math.round(300 * a.share); i++) {
      const at = now - int(0, 120) * DAY * 1000
      insStatus.run(a.id, 'text', pick(PHRASES), JSON.stringify({ type: 'all' }), at, 'enviado', at, int(50, 900), at)
    }
    setKey.run(
      `iaAtendimento:${a.id}`,
      JSON.stringify({
        enabled: true,
        when: 'new',
        resumeMin: 30,
        perHour: 20,
        perChat: 8,
        handoffOnClose: false,
        agentsText: 'Vendas: orçamento, preço\nFinanceiro: boleto, pagamento'
      })
    )
  }
  db.exec('COMMIT')
  const out: Record<string, number> = {}
  for (const t of [
    'leads',
    'contact_notes',
    'contact_profile_state',
    'chat_ai_mode',
    'ia_atendimento_log',
    'status_posts'
  ])
    out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  return out
}
