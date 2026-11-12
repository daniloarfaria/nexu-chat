import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const h = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.root } }))
import { closeDb, openDb, getDb } from '../src/main/db'
import * as C from '../src/main/campaigns'
const ACC = '99999999-9999-4999-8999-999999999999'
const image = (n: number): { name: string; mime: string; data: Uint8Array } => ({
  name: `${n}.png`,
  mime: 'image/png',
  data: new Uint8Array([n])
})
const input = {
  accountId: ACC,
  name: 'Teste',
  templates: ['A', 'B'],
  audience: { type: 'all' as const },
  optOutFooter: false,
  scheduledAt: null
}
beforeEach(() => {
  h.root = mkdtempSync(join(tmpdir(), 'campaign-versions-'))
  openDb(join(h.root, 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id,name,color,modules,created_at) VALUES (?,?,?,?,?)')
    .run(ACC, 'Loja', '#000', '{}', Date.now())
})
afterEach(() => {
  closeDb()
  rmSync(h.root, { recursive: true, force: true })
})
test('cada índice escolhe seu texto e sua mídia; versão sem mídia não herda outra', () => {
  const c = C.saveCampaign(input)
  C.setCampaignMedia(c.id, image(1), 0)
  const saved = C.setCampaignMedia(c.id, image(2), 1)
  expect(C.campaignVersion(saved, 0)).toMatchObject({ text: 'A', media: { name: '1.png' } })
  expect(C.campaignVersion(saved, 1)).toMatchObject({ text: 'B', media: { name: '2.png' } })
  expect(C.campaignVersion(C.setCampaignMedia(c.id, null, 0), 0).media).toBeNull()
})
test('remover/reordenar versões mantém associação e limpa só arquivos sem referência', () => {
  let c = C.saveCampaign(input)
  c = C.setCampaignMedia(c.id, image(1), 0)
  c = C.setCampaignMedia(c.id, image(2), 1)
  const old = C.mediaPath(c.templateMedia![0]!)
  const saved = C.saveCampaign({ ...input, id: c.id, templates: ['B'], mediaIndices: [1] })
  expect(C.campaignVersion(saved, 0)).toMatchObject({ text: 'B', media: { name: '2.png' } })
  expect(existsSync(old)).toBe(false)
})
test('legado mantém mídia global e ao editar um índice preserva a outra versão', () => {
  const c = C.setCampaignMedia(C.saveCampaign(input).id, image(1))
  expect(C.campaignVersion(c, 1).media?.name).toBe('1.png')
  const saved = C.setCampaignMedia(c.id, null, 0)
  expect(C.campaignVersion(saved, 0).media).toBeNull()
  expect(C.campaignVersion(saved, 1).media?.name).toBe('1.png')
})
test('preview é isolado por conta e recusa caminhos fora da pasta', () => {
  const c = C.setCampaignMedia(C.saveCampaign(input).id, image(1), 0)
  expect(C.campaignMediaPreview(c.id, ACC, 0)?.data).toEqual(new Uint8Array([1]))
  expect(() => C.campaignMediaPreview(c.id, 'outra', 0)).toThrow('Campanha não encontrada')
  expect(() => C.mediaPath({ ...c.templateMedia![0]!, file: '../outside' })).toThrow()
})
test('voz gravada vira Ogg/Opus e upload de áudio permanece intacto', () => {
  const c = C.saveCampaign(input)
  const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures/voice.webm')))
  const voice = C.setCampaignMedia(c.id, { name: 'voz.webm', mime: 'audio/webm', data: bytes, voice: true }, 0)
  expect(voice.templateMedia![0]).toMatchObject({ voice: true, mime: 'audio/ogg; codecs=opus' })
  expect(readFileSync(C.mediaPath(voice.templateMedia![0]!)).subarray(0, 4).toString()).toBe('OggS')
  const upload = C.setCampaignMedia(c.id, { name: 'audio.webm', mime: 'audio/webm', data: bytes }, 1)
  expect(readFileSync(C.mediaPath(upload.templateMedia![1]!))).toEqual(Buffer.from(bytes))
})
test('duplicação copia anexos; excluir original não quebra cópia', () => {
  const original = C.setCampaignMedia(C.saveCampaign(input).id, image(1), 0)
  const copy = C.duplicateCampaign(original.id)
  C.deleteCampaign(original.id)
  expect(C.campaignMediaPreview(copy.id, ACC, 0)?.data).toEqual(new Uint8Array([1]))
})
test.each([[[0, 9]], [[0]]])('índices inválidos %s não alteram nome, texto ou mídia', (mediaIndices) => {
  const c = C.setCampaignMedia(C.saveCampaign(input).id, image(1), 0)
  expect(() =>
    C.saveCampaign({ ...input, id: c.id, name: 'Alterado', templates: ['Novo', 'Outro'], mediaIndices })
  ).toThrow()
  expect(C.getCampaign(c.id)).toMatchObject({ name: 'Teste', templates: ['A', 'B'], templateMedia: c.templateMedia })
})

test('upload inválido em outra versão preserva campanha e arquivos anteriores', () => {
  const c = C.setCampaignMedia(C.saveCampaign(input).id, image(1), 0)
  expect(() =>
    C.saveCampaign({
      ...input,
      id: c.id,
      name: 'Alterada',
      mediaIndices: [0, null],
      files: [image(2), { name: 'voz.webm', mime: 'audio/webm', data: new Uint8Array([0]), voice: true }]
    })
  ).toThrow()
  expect(C.getCampaign(c.id)).toMatchObject({ name: 'Teste', templateMedia: c.templateMedia })
  expect(C.campaignMediaPreview(c.id, ACC, 0)?.data).toEqual(new Uint8Array([1]))
})

test('falha SQL reverte texto e mídia juntos, preservando arquivo anterior', () => {
  const c = C.setCampaignMedia(C.saveCampaign(input).id, image(1), 0)
  getDb().exec(
    "CREATE TRIGGER fail_campaign_media BEFORE UPDATE OF template_media ON campaigns BEGIN SELECT RAISE(ABORT,'falha simulada'); END"
  )
  expect(() =>
    C.saveCampaign({
      ...input,
      id: c.id,
      name: 'Alterada',
      templates: ['Nova A', 'Nova B'],
      mediaIndices: [0, null],
      files: [image(2), null]
    })
  ).toThrow('falha simulada')
  expect(C.getCampaign(c.id)).toMatchObject({ name: 'Teste', templates: ['A', 'B'], templateMedia: c.templateMedia })
  expect(C.campaignMediaPreview(c.id, ACC, 0)?.data).toEqual(new Uint8Array([1]))
})
