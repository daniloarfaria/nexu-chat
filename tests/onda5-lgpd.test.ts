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

import { closeDb, getDb, getSetting, openDb, setSetting } from '../src/main/db'
import * as people from '../src/main/people'

const ACC = '55555555-5555-4555-8555-555555555555'
const n = (sql: string): number => (getDb().prepare(sql).get() as { n: number }).n

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-onda5-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica', '#000000', '{}', Date.now())
})

describe('item 1: exclusão a pedido apaga tudo da pessoa', () => {
  test('leads, atribuição, modo do robô, log da IA e pendências, em todas as variantes', () => {
    const db = getDb()
    const p = people.savePerson(ACC, { name: 'Ana', phone: '5511987650001', tags: [] })
    const lid = '999@lid'
    const alt = '551187650001@s.whatsapp.net' // sem o nono dígito
    db.prepare('INSERT INTO lid_map (account_id, lid, pn) VALUES (?, ?, ?)').run(ACC, lid, alt)
    for (const jid of ['5511987650001@s.whatsapp.net', alt, lid]) {
      db.prepare('INSERT INTO chat_attribution (account_id, chat_jid, first_ts, updated_at) VALUES (?, ?, 1, 1)').run(
        ACC,
        jid
      )
      db.prepare("INSERT INTO chat_ai_mode (account_id, chat_jid, mode, updated_at) VALUES (?, ?, 'ia', 1)").run(
        ACC,
        jid
      )
      db.prepare('INSERT INTO ia_atendimento_log (account_id, chat_jid, at) VALUES (?, ?, 1)').run(ACC, jid)
    }
    const ins = db.prepare(
      'INSERT INTO leads (account_id, dedupe_key, tab, created_at, phone, name, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    ins.run(ACC, 'k1', 'a', 1, '5511987650001', 'Ana', 1)
    ins.run(ACC, 'k2', 'a', 1, '551187650001', 'Ana', 1)
    ins.run(ACC, 'k3', 'a', 1, '5511999990000', 'Outra', 1)
    setSetting(`leadsContactsPending:${ACC}`, [
      { name: 'Ana', phone: '5511987650001' },
      { name: 'Outra', phone: '5511999990000' }
    ])

    people.deletePeople(ACC, [p.id])

    expect(n('SELECT COUNT(*) AS n FROM chat_attribution')).toBe(0)
    expect(n('SELECT COUNT(*) AS n FROM chat_ai_mode')).toBe(0)
    expect(n('SELECT COUNT(*) AS n FROM ia_atendimento_log')).toBe(0)
    expect(n('SELECT COUNT(*) AS n FROM leads')).toBe(1)
    expect(getSetting<Array<{ phone: string }>>(`leadsContactsPending:${ACC}`, []).map((x) => x.phone)).toEqual([
      '5511999990000'
    ])
  })
})
