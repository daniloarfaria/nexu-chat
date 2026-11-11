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
import * as store from '../src/main/wa/store'
import { ADS_SCAN_SQL, ensureAdsScanIndex, getAttribution, recordAttribution } from '../src/main/ads'

const ACC = '13131313-1313-4313-8313-131313131313'
const PN = '5511987654321@s.whatsapp.net'

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-onda5a-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Ótica', '#000000', '{}', Date.now())
})

const ad = (
  id: string,
  clid: string | null = null
): { conversionSource: string; entryPoint: string; adId: string; adUrl: string; ctwaClid: string | null } => ({
  conversionSource: 'FB_Ads',
  entryPoint: 'ctwa_ad',
  adId: id,
  adUrl: `https://fb.me/${id}`,
  ctwaClid: clid
})

describe('item 13: a origem do anúncio é uma unidade (primeira atribuição)', () => {
  test('origem mais antiga de outro anúncio troca todos os campos e a data juntos', () => {
    recordAttribution(ACC, PN, ad('B', 'clidB'), 2000, true)
    recordAttribution(ACC, PN, ad('A'), 1000, true)
    expect(getAttribution(ACC, PN)).toMatchObject({
      adId: 'A',
      adUrl: 'https://fb.me/A',
      ctwaClid: null,
      firstTs: 1000
    })
  })
  test('origem mais nova de outro anúncio não mexe em nada', () => {
    recordAttribution(ACC, PN, ad('A'), 1000, true)
    recordAttribution(ACC, PN, ad('B', 'clidB'), 2000, true)
    expect(getAttribution(ACC, PN)).toMatchObject({ adId: 'A', ctwaClid: null, firstTs: 1000 })
  })
  test('mesmo anúncio: completa o código que faltava', () => {
    recordAttribution(ACC, PN, ad('A'), 1000, true)
    recordAttribution(ACC, PN, ad('A', 'clidA'), 2000, true)
    expect(getAttribution(ACC, PN)).toMatchObject({ adId: 'A', ctwaClid: 'clidA', firstTs: 1000 })
  })
  test('fusão LID/número usa a mesma regra', () => {
    const LID = '555@lid'
    recordAttribution(ACC, PN, ad('B', 'clidB'), 2000, true)
    recordAttribution(ACC, LID, ad('A'), 1000, true)
    store.saveLidMappings(ACC, [{ lid: LID, pn: PN }])
    expect(getAttribution(ACC, PN)).toMatchObject({ adId: 'A', ctwaClid: null, firstTs: 1000 })
  })
})

describe('item 11: reprocessar o histórico usa índice e não ordena a cada lote', () => {
  test('o plano da consulta usa o índice parcial, sem varrer a tabela nem ordenar', () => {
    ensureAdsScanIndex()
    const plan = (getDb().prepare(`EXPLAIN QUERY PLAN ${ADS_SCAN_SQL}`).all(0, 0, 500) as Array<{ detail: string }>)
      .map((r) => r.detail)
      .join(' | ')
    expect(plan).toMatch(/USING INDEX messages_ads_scan/)
    expect(plan).not.toMatch(/TEMP B-TREE/)
    expect(plan).not.toMatch(/SCAN messages(?! USING)/)
  })
  test('a migração de abertura não cria o índice (criação tardia)', () => {
    const r = getDb().prepare("SELECT 1 FROM sqlite_master WHERE name = 'messages_ads_scan'").get()
    expect(r).toBeUndefined()
  })
})
