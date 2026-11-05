import { beforeEach, describe, expect, test, vi } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'dsp-tr-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
  protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined },
  net: {}
}))

import { closeDb, getDb, openDb } from '../src/main/db'
import * as store from '../src/main/wa/store'
import { setTranscribeSettings, transcribe } from '../src/main/wa/transcribe'
import { saveProvider } from '../src/main/ai/router'

const ACC = '66666666-6666-4666-8666-666666666666'
const PN = '5511987650001@s.whatsapp.net'

function voiceMessage(id: string): void {
  store.saveMessages(
    ACC,
    [
      {
        key: { remoteJid: PN, fromMe: false, id },
        messageTimestamp: 1_790_000_000,
        message: { audioMessage: { ptt: true, seconds: 3, mimetype: 'audio/ogg; codecs=opus' } }
      } as never
    ],
    { live: false }
  )
  const dir = join(userData, 'media', ACC)
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(__dirname, 'fixtures/voz-pt.ogg'), join(dir, `${id}.ogg`))
  store.setMediaUrl(ACC, PN, id, { mimetype: 'audio/ogg; codecs=opus', file: `${id}.ogg` } as never)
}

beforeEach(() => {
  closeDb()
  openDb(join(mkdtempSync(join(tmpdir(), 'dsp-trdb-')), 'db.sqlite'))
  getDb()
    .prepare('INSERT INTO accounts (id, name, color, modules, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(ACC, 'T', '#000000', '{}', Date.now())
  vi.unstubAllGlobals()
})

describe('transcrição de áudio', () => {
  const local =
    existsSync('/opt/homebrew/bin/whisper-cli') &&
    existsSync('/opt/homebrew/bin/ffmpeg') &&
    existsSync(join(process.env.HOME ?? '', '.cache/marketing-melvin/modelos/ggml-small.bin'))
  test.skipIf(!local)(
    'Whisper local transcreve a mensagem de voz, salva e entra na busca',
    async () => {
      voiceMessage('V1')
      setTranscribeSettings({ engine: 'local' })
      const text = await transcribe(null, ACC, PN, 'V1')
      expect(text.toLowerCase()).toContain('óculos')
      expect(store.listMessages(ACC, PN, null, 5)[0].transcript).toBe(text)
      expect(store.searchMessages(ACC, 'oculos pronto')).toHaveLength(1)
    },
    120_000
  )

  test('Groq: envia o áudio e guarda o texto devolvido', async () => {
    voiceMessage('V2')
    saveProvider({ preset: 'groq', apiKey: 'gsk_teste' })
    setTranscribeSettings({ engine: 'groq' })
    let called = ''
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      called = url
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk_teste')
      return new Response('Quero saber do meu óculos.')
    })
    expect(await transcribe(null, ACC, PN, 'V2')).toBe('Quero saber do meu óculos.')
    expect(called).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  })

  test('sem motor disponível explica o que fazer', async () => {
    voiceMessage('V3')
    setTranscribeSettings({ engine: 'groq' })
    await expect(transcribe(null, ACC, PN, 'V3')).rejects.toThrow(/Groq|Whisper/)
    expect(existsSync(join(userData, 'media', ACC, 'V3.ogg'))).toBe(true)
  })
})
