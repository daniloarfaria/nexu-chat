import { beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'dsp-av-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import { avatarEvents, getAvatars, invalidateAvatar, setAvatarSocketGetter } from '../src/main/wa/avatars'

const ACC = '55555555-5555-4555-8555-555555555555'
const A = '5511987650001@s.whatsapp.net'
const B = '5511987650002@s.whatsapp.net'
let calls: string[] = []

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-avdb-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'T', '#000000', '{}', Date.now())
  calls = []
  setAvatarSocketGetter(
    () =>
      ({
        profilePictureUrl: async (jid: string) => {
          calls.push(jid)
          if (jid === B) throw new Error('item-not-found')
          return 'https://pps.whatsapp.net/v/foto.jpg'
        }
      }) as never
  )
  vi.stubGlobal(
    'fetch',
    async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
  )
})

test('busca em fila, guarda a foto, lembra quem não tem e não repete dentro de 24 h', async () => {
  const done = new Promise<Record<string, string | null>>((r) => {
    const seen: Record<string, string | null> = {}
    avatarEvents.on('changed', ({ avatars }) => {
      Object.assign(seen, avatars)
      if (A in seen && B in seen) r(seen)
    })
  })
  expect(getAvatars(ACC, [A, B])).toEqual({})
  const res = await done
  expect(res[A]).toMatch(/^dspmedia:\/\//)
  expect(res[B]).toBeNull()
  const file = (getDb().prepare('SELECT file FROM avatars WHERE jid = ?').get(A) as { file: string }).file
  expect(existsSync(join(userData, 'media', ACC, 'avatars', file))).toBe(true)
  // em cache: não busca de novo
  calls = []
  const again = getAvatars(ACC, [A, B])
  expect(again[A]).toMatch(/avatars/)
  expect(again[B]).toBeNull()
  await new Promise((r) => setTimeout(r, 50))
  expect(calls).toEqual([])
  // trocou a foto: busca de novo
  invalidateAvatar(ACC, A)
  getAvatars(ACC, [A])
  await new Promise((r) => setTimeout(r, 100))
  expect(calls).toEqual([A])
})
