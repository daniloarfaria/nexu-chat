import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WASocket } from 'baileys'
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))
import { closeDb, getDb, openDb } from '../src/main/db'
import { deleteForEveryone } from '../src/main/wa/send'
import { saveMessages } from '../src/main/wa/store'
const ACC = '99999999-9999-4999-8999-999999999999'
const JID = '5511987654321@s.whatsapp.net'
let root: string
const send = vi.fn()
const socket = { sendMessage: send, user: { id: '5511999999999@s.whatsapp.net' } } as unknown as WASocket
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'delete-message-'))
  openDb(join(root, 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'Loja', '#000000', '{}', Date.now())
  send.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  closeDb()
  rmSync(root, { recursive: true, force: true })
})
const seed = (fromMe: boolean): void => {
  saveMessages(
    ACC,
    [{ key: { id: 'm1', remoteJid: JID, fromMe }, messageTimestamp: 123, message: { conversation: 'Segredo' } }],
    { live: false, ownJid: socket.user!.id }
  )
}
const row = (): unknown =>
  getDb().prepare('SELECT deleted, text, raw FROM messages WHERE account_id = ? AND id = ?').get(ACC, 'm1')
test('apaga conteúdo local após envio mesmo sem mensagem de protocolo devolvida pelo socket', async () => {
  seed(true)
  await deleteForEveryone(socket, ACC, JID, 'm1')
  expect(row()).toMatchObject({ deleted: 1, text: null, raw: null })
  expect(getDb().prepare('SELECT 1 FROM messages_fts WHERE account_id = ? AND id = ?').get(ACC, 'm1')).toBeUndefined()
})
test('recusa mensagens de terceiros antes de enviar', async () => {
  seed(false)
  await expect(deleteForEveryone(socket, ACC, JID, 'm1')).rejects.toThrow(/enviadas por você/)
  expect(send).not.toHaveBeenCalled()
  expect(row()).toMatchObject({ deleted: 0, text: 'Segredo' })
})
test('falha de envio preserva conteúdo local', async () => {
  seed(true)
  send.mockRejectedValue(new Error('offline'))
  await expect(deleteForEveryone(socket, ACC, JID, 'm1')).rejects.toThrow('offline')
  expect(row()).toMatchObject({ deleted: 0, text: 'Segredo' })
})
