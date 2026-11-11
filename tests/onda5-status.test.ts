import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userData = tmpdir()
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

const h = vi.hoisted(() => ({
  calls: [] as string[],
  late: null as null | ((v: unknown) => void),
  mode: 'ok' as 'ok' | 'late'
}))
const fakeSock = {
  user: { id: '5511900000000:1@s.whatsapp.net' },
  sendMessage: async (jid: string) => {
    if (h.mode === 'late')
      return new Promise((resolve) => {
        h.late = resolve
      })
    h.calls.push(jid)
    return { key: { remoteJid: jid, fromMe: true, id: `ST${h.calls.length}` } }
  }
}
vi.mock('../src/main/wa/manager', () => ({ wa: { getSocket: () => fakeSock, on: () => undefined } }))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as people from '../src/main/people'
import * as S from '../src/main/status'

const ACC = '77777777-7777-4777-8777-777777777777'
const agora = (): S.StatusInput => ({
  accountId: ACC,
  kind: 'texto',
  text: 'Oi',
  audience: { modo: 'todos', tags: [] },
  scheduledAt: null
})

beforeEach(() => {
  closeDb()
  userData = mkdtempSync(join(tmpdir(), 'dsp-onda5s-'))
  openDb(join(userData, 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica', '#000000', JSON.stringify({ status: true }), Date.now())
  h.calls.length = 0
  h.mode = 'ok'
  h.late = null
  S.resetStatusRuntime()
})
afterEach(() => vi.useRealTimers())

describe('item 6: SAIR registrado só no LID vale para o status', () => {
  test('a pessoa conhecida pelo número fica fora do público', () => {
    const p = people.savePerson(ACC, { name: 'Ana', phone: '11987650001', tags: [] })
    people.markHasWa(p.id, '5511987650001@s.whatsapp.net', true)
    const q = people.savePerson(ACC, { name: 'Bia', phone: '11987650002', tags: [] })
    people.markHasWa(q.id, '5511987650002@s.whatsapp.net', true)
    // SAIR chegou pelo LID antes de o número ser conhecido; o mapa só chegou depois
    people.optOutByJid(ACC, '321@lid')
    getDb()
      .prepare('INSERT INTO lid_map (account_id, lid, pn) VALUES (?, ?, ?)')
      .run(ACC, '321@lid', '5511987650001@s.whatsapp.net')
    expect(S.statusAudienceJids(ACC, { modo: 'todos', tags: [] })).toEqual(['5511987650002@s.whatsapp.net'])
    expect(S.countStatusAudience(ACC, { modo: 'todos', tags: [] })).toMatchObject({ total: 1, optedOut: 1 })
  })
})

describe('item 9: tempo esgotado é resultado incerto', () => {
  test('a tentativa continua contando no limite e novos envios esperam', async () => {
    vi.useFakeTimers()
    const p = (() => {
      const x = people.savePerson(ACC, { name: 'Ana', phone: '11987650001', tags: [] })
      people.markHasWa(x.id, '5511987650001@s.whatsapp.net', true)
      return x
    })()
    expect(p.id).toBeGreaterThan(0)
    h.mode = 'late'
    const post = S.createStatusPost(agora())
    const run = S.runDueStatus(ACC)
    await vi.advanceTimersByTimeAsync(S.STATUS_SEND_TIMEOUT_MS + 100)
    await run
    expect(S.getStatusPost(post.id)).toMatchObject({ status: 'falhou' })
    expect(S.postsOnDay(ACC, Date.now(), false)).toBe(1) // a tentativa conta
    // novos envios esperam a reconciliação
    h.mode = 'ok'
    const q = S.createStatusPost(agora())
    await S.runDueStatus(ACC)
    expect(S.getStatusPost(q.id)!.status).toBe('agendado')
    // o envio que parecia travado termina depois: a postagem passa a "enviado" e o bloqueio some
    h.late?.({ key: { id: 'TARDE' } })
    await vi.advanceTimersByTimeAsync(10)
    expect(S.getStatusPost(post.id)).toMatchObject({ status: 'enviado' })
    await S.runDueStatus(ACC)
    expect(S.getStatusPost(q.id)!.status).toBe('enviado')
  })
})

describe('item 17: limpeza periódica de mídias', () => {
  test('falha em um arquivo não impede os outros', () => {
    const now = Date.now()
    mkdirSync(join(userData, 'status-media'), { recursive: true })
    const mk = (file: string): number => {
      writeFileSync(join(userData, 'status-media', file), 'x')
      return Number(
        getDb()
          .prepare(
            `INSERT INTO status_posts (account_id, kind, text, media, audience, scheduled_at, status, sent_at, created_at)
             VALUES (?, 'imagem', 'a', ?, '{"modo":"todos","tags":[]}', ?, 'enviado', ?, ?)`
          )
          .run(
            ACC,
            JSON.stringify({ name: file, mime: 'image/png', file, size: 1 }),
            now - 9 * 86_400_000,
            now - 9 * 86_400_000,
            now
          ).lastInsertRowid
      )
    }
    mk('a.png')
    // media com JSON quebrado: antes derrubava a limpeza inteira
    getDb()
      .prepare(
        `INSERT INTO status_posts (account_id, kind, text, media, audience, scheduled_at, status, sent_at, created_at)
         VALUES (?, 'imagem', 'b', 'quebrado', '{"modo":"todos","tags":[]}', ?, 'enviado', ?, ?)`
      )
      .run(ACC, now - 9 * 86_400_000, now - 9 * 86_400_000, now)
    mk('c.png')
    S.cleanupStatusMedia(now)
    expect(existsSync(join(userData, 'status-media', 'a.png'))).toBe(false)
    expect(existsSync(join(userData, 'status-media', 'c.png'))).toBe(false)
  })
})
