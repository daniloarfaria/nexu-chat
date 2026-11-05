import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptBackup, decryptBackup, isBackupDue } from '../src/main/backup-core.ts'
import { parseWaVersion } from '../src/main/wa/version-parse.ts'
import { maskPhone } from '../src/main/log.ts'

const fakeDb = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(2048, 7)])

test('backup: cifra e decifra com a senha certa', async () => {
  const enc = await encryptBackup(fakeDb, 'senha-forte-123')
  assert.ok(!enc.includes(Buffer.from('SQLite format 3')), 'conteúdo não pode aparecer em claro')
  assert.deepEqual(await decryptBackup(enc, 'senha-forte-123'), fakeDb)
})

test('backup: senha errada é recusada', async () => {
  const enc = await encryptBackup(fakeDb, 'senha-forte-123')
  await assert.rejects(decryptBackup(enc, 'outra-senha'), /Senha incorreta/)
})

test('backup: arquivo adulterado é recusado', async () => {
  const enc = await encryptBackup(fakeDb, 'senha-forte-123')
  enc[enc.length - 5] ^= 0xff
  await assert.rejects(decryptBackup(enc, 'senha-forte-123'), /Senha incorreta ou arquivo corrompido/)
})

test('backup: arquivo que não é backup', async () => {
  await assert.rejects(
    decryptBackup(Buffer.from('qualquer coisa que não é backup, com tamanho suficiente pra passar'), 'x'),
    /não é um backup/
  )
})

test('backup: quando está na hora', () => {
  const base = { folder: '/tmp', keep: 5, passwordSet: true, lastError: null }
  const now = 10 * 86_400_000
  assert.equal(isBackupDue({ ...base, frequency: 'daily', lastBackupAt: null }, now), true)
  assert.equal(isBackupDue({ ...base, frequency: 'daily', lastBackupAt: now - 3_600_000 }, now), false)
  assert.equal(isBackupDue({ ...base, frequency: 'daily', lastBackupAt: now - 86_400_000 }, now), true)
  assert.equal(isBackupDue({ ...base, frequency: 'weekly', lastBackupAt: now - 2 * 86_400_000 }, now), false)
  assert.equal(isBackupDue({ ...base, frequency: 'off', lastBackupAt: null }, now), false)
  assert.equal(isBackupDue({ ...base, passwordSet: false, frequency: 'daily', lastBackupAt: null }, now), false)
})

test('versão do WhatsApp: formato da WPPConnect', () => {
  assert.deepEqual(parseWaVersion('2.3000.1053174903-alpha'), [2, 3000, 1053174903])
  assert.deepEqual(parseWaVersion('2.2412.54'), [2, 2412, 54])
  assert.equal(parseWaVersion('abc'), null)
  assert.equal(parseWaVersion(null), null)
  assert.equal(parseWaVersion('3.1.1'), null)
})

test('logs: telefone mascarado', () => {
  assert.equal(maskPhone('enviado para 5511987654321@s.whatsapp.net'), 'enviado para 5511*****4321@s.whatsapp.net')
  assert.equal(maskPhone('linha 42'), 'linha 42')
})
