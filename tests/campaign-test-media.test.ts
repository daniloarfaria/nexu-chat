import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ZodType } from 'zod'
const h = vi.hoisted(() => ({ root: '', send: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => h.root, on: () => undefined },
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))
vi.mock('../src/main/wa/manager', () => ({
  wa: {
    getSocket: () => ({ user: { id: '5511999999999:1@s.whatsapp.net' }, sendMessage: h.send }),
    on: () => undefined
  }
}))
import { closeDb, openDb, getDb } from '../src/main/db'
import { registerBusinessIpc } from '../src/main/ipc-business'
import * as C from '../src/main/campaigns'
const ACC = '99999999-9999-4999-8999-999999999999'
const OTHER = '88888888-8888-4888-8888-888888888888'
let invoke: (args: Record<string, unknown>) => Promise<unknown>
const image = { name: 'foto.png', mime: 'image/png', data: new Uint8Array([1, 2, 3]) }
beforeEach(() => {
  h.root = mkdtempSync(join(tmpdir(), 'campaign-test-'))
  openDb(join(h.root, 'db.sqlite'))
  for (const acc of [ACC, OTHER])
    getDb()
      .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(acc, 'Loja', '#000000', '{}', Date.now())
  h.send.mockReset().mockResolvedValue(undefined)
  registerBusinessIpc(
    ((channel: string, schema: ZodType, fn: (a: unknown) => unknown) => {
      if (channel === 'campaigns:test') invoke = async (args) => fn(schema.parse(args))
    }) as never,
    () => null
  )
})
afterEach(() => {
  closeDb()
  rmSync(h.root, { recursive: true, force: true })
})
const args = (): { accountId: string; templates: string[]; optOutFooter: boolean } => ({
  accountId: ACC,
  templates: ['Olá {primeiro_nome}'],
  optOutFooter: false
})
const saved = (): ReturnType<typeof C.setCampaignMedia> =>
  C.setCampaignMedia(
    C.saveCampaign({
      accountId: ACC,
      name: 'Teste',
      templates: ['Texto'],
      audience: { type: 'all' },
      optOutFooter: false,
      scheduledAt: null
    }).id,
    image
  )
test('texto sem anexo continua chegando ao próprio número', async () => {
  await invoke(args())
  expect(h.send.mock.calls[0].slice(0, 2)).toEqual(['5511999999999@s.whatsapp.net', { text: '[TESTE]\nOlá Maria' }])
})
test.each(['image/png', 'image/webp', 'video/mp4', 'audio/ogg', 'application/pdf'])(
  'anexo novo %s chega ao socket antes de salvar',
  async (mime) => {
    await invoke({ ...args(), file: { ...image, mime } })
    const content = h.send.mock.calls[0][1]
    const kind = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'document'
    expect(content[kind]).toEqual(Buffer.from([1, 2, 3]))
    if (kind === 'audio') expect(h.send.mock.calls[1][1]).toEqual({ text: '[TESTE]\nOlá Maria' })
    else expect(content.caption).toBe('[TESTE]\nOlá Maria')
  }
)
test('anexo salvo é lido da campanha', async () => {
  await invoke({ ...args(), campaignId: saved().id })
  expect(h.send.mock.calls[0][1]).toEqual({
    image: Buffer.from([1, 2, 3]),
    mimetype: 'image/png',
    caption: '[TESTE]\nOlá Maria'
  })
})
test('omitir referência após remover anexo não envia mídia salva', async () => {
  saved()
  await invoke(args())
  expect(h.send.mock.calls[0][1]).toEqual({ text: '[TESTE]\nOlá Maria' })
})
test('campanha de outra conta é rejeitada antes do envio', async () => {
  await expect(invoke({ ...args(), accountId: OTHER, campaignId: saved().id })).rejects.toThrow(
    'Campanha não encontrada'
  )
  expect(h.send).not.toHaveBeenCalled()
})
test('falha no upload é propagada', async () => {
  h.send.mockRejectedValueOnce(new Error('upload falhou'))
  await expect(invoke({ ...args(), file: image })).rejects.toThrow('upload falhou')
})
test.each([new Uint8Array(), new Uint8Array(64 * 1024 * 1024 + 1), [1, 2]])(
  'bytes inválidos são rejeitados',
  async (data) => {
    await expect(invoke({ ...args(), file: { ...image, data } })).rejects.toThrow()
    expect(h.send).not.toHaveBeenCalled()
  }
)
