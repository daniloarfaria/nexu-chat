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
import { setTranscribeSettings, transcribe, transcribeStatus } from '../src/main/wa/transcribe'
import { saveProvider, setAiSettings } from '../src/main/ai/router'

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

  test('Groq: o envio do áudio não segue redirecionamento', async () => {
    voiceMessage('V2b')
    saveProvider({ preset: 'groq', apiKey: 'gsk_teste' })
    setTranscribeSettings({ engine: 'groq' })
    let redirect: RequestInit['redirect']
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      redirect = init.redirect
      return new Response('ok')
    })
    await transcribe(null, ACC, PN, 'V2b')
    expect(redirect).toBe('error')
  })

  describe('privacidade: o áudio do cliente não vai para a Groq quando o dono não deixou', () => {
    const semLocal = { engine: 'groq' as const, whisperPath: null, modelPath: null, ffmpegPath: null }
    const fetchSpy = vi.fn(async () => new Response('não devia chegar aqui'))
    beforeEach(() => {
      fetchSpy.mockClear()
      vi.stubGlobal('fetch', fetchSpy)
    })

    test('Groq marcada "sem conversas de clientes": não envia', async () => {
      voiceMessage('P1')
      saveProvider({ preset: 'groq', apiKey: 'gsk_teste', noCustomerData: true })
      setTranscribeSettings(semLocal)
      const st = transcribeStatus()
      expect(st.groq).toBe(false)
      expect(st.groqBlocked).toBe('sem-clientes')
      if (!st.local.ready) await expect(transcribe(null, ACC, PN, 'P1')).rejects.toThrow(/sem transcrição/i)
      else await transcribe(null, ACC, PN, 'P1')
      expect(fetchSpy).not.toHaveBeenCalled()
    }, 120_000)

    test('privacidade Estrita: não envia', async () => {
      voiceMessage('P2')
      saveProvider({ preset: 'groq', apiKey: 'gsk_teste' })
      setAiSettings({ privacy: 'estrita' })
      setTranscribeSettings(semLocal)
      const st = transcribeStatus()
      expect(st.groq).toBe(false)
      expect(st.groqBlocked).toBe('estrita')
      if (!st.local.ready) await expect(transcribe(null, ACC, PN, 'P2')).rejects.toThrow(/sem transcrição/i)
      else await transcribe(null, ACC, PN, 'P2')
      expect(fetchSpy).not.toHaveBeenCalled()
    }, 120_000)

    test('Groq marcada como "pode treinar com os dados": não envia', async () => {
      saveProvider({ preset: 'groq', apiKey: 'gsk_teste', trainsOnData: true })
      expect(transcribeStatus().groq).toBe(false)
      expect(transcribeStatus().groqBlocked).toBe('treina')
    })

    test('sem bloqueio, a Groq continua disponível', () => {
      saveProvider({ preset: 'groq', apiKey: 'gsk_teste' })
      expect(transcribeStatus().groq).toBe(true)
      expect(transcribeStatus().groqBlocked).toBeNull()
    })
  })

  test('sem motor disponível explica o que fazer', async () => {
    voiceMessage('V3')
    setTranscribeSettings({ engine: 'groq' })
    await expect(transcribe(null, ACC, PN, 'V3')).rejects.toThrow(/Groq|Whisper/)
    expect(existsSync(join(userData, 'media', ACC, 'V3.ogg'))).toBe(true)
  })
})
