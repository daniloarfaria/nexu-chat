import { describe, expect, test } from 'vitest'
import { voiceAssetsFor, WHISPER_MODEL, WHISPER_SOURCE, BUILD_CMAKE, FFMPEG_SOURCE } from '../src/main/wa/voice-catalog'

describe('catálogo de instalação de voz', () => {
  test('Mac usa CLI embutida sem baixar build tools; Windows baixa CLI', () => {
    expect(voiceAssetsFor('darwin', 'arm64')?.binary).toBeUndefined()
    expect(Object.keys(voiceAssetsFor('darwin', 'x64')!)).toEqual([])
    expect(voiceAssetsFor('win32', 'x64')?.binary?.file).toContain('x64.zip')
    expect(voiceAssetsFor('linux', 'arm64')).toBeNull()
  })
  test('todos arquivos têm integridade e tamanho pinados', () => {
    for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
      const [os, arch] = platform.split('-')
      for (const asset of [
        ...Object.values(voiceAssetsFor(os, arch)!),
        WHISPER_MODEL,
        WHISPER_SOURCE,
        BUILD_CMAKE,
        FFMPEG_SOURCE
      ]) {
        expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
        expect(asset.size).toBeGreaterThan(1000)
        expect(asset.url).toMatch(/^https:\/\//)
      }
    }
  })
})

import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installVoiceComponents } from '../src/main/wa/voice-install'

test('reaproveita todos componentes existentes e não baixa nem altera caminhos', async () => {
  const model = join(mkdtempSync(join(tmpdir(), 'voice-model-')), 'ggml-small.bin')
  writeFileSync(model, 'lmgg')
  truncateSync(model, 1_000_000)
  const tools = { whisper: '/custom/whisper', ffmpeg: '/custom/ffmpeg', model }
  const calls: string[] = []
  const got = await installVoiceComponents({
    root: mkdtempSync(join(tmpdir(), 'voice-')),
    platform: 'darwin',
    arch: 'arm64',
    bundledWhisper: null,
    tools,
    signal: new AbortController().signal,
    progress: () => {},
    download: async () => {
      throw new Error('não deve baixar')
    },
    extract: async () => {},
    validate: async (p) => {
      calls.push(p)
    }
  })
  expect(got).toEqual(tools)
  expect(calls).toEqual(['/custom/whisper', '/custom/ffmpeg'])
})

test('sem CLI Mac embutida recusa instalação antes de baixar', async () => {
  await expect(
    installVoiceComponents({
      root: '/unused',
      platform: 'darwin',
      arch: 'arm64',
      bundledWhisper: null,
      tools: { whisper: null, ffmpeg: null, model: null },
      signal: new AbortController().signal,
      progress: () => {},
      download: async () => {
        throw new Error('não deve baixar')
      },
      extract: async () => {},
      validate: async () => {}
    })
  ).rejects.toThrow(/Whisper.*instalador/)
})

test('não retorna caminhos de programas que falham na validação', async () => {
  const root = mkdtempSync(join(tmpdir(), 'voice-'))
  const binary = join(root, 'whisper-cli')
  writeFileSync(binary, 'invalid')
  await expect(
    installVoiceComponents({
      root,
      platform: 'darwin',
      arch: 'arm64',
      bundledWhisper: binary,
      tools: { whisper: null, ffmpeg: '/custom/ffmpeg', model: '/custom/model' },
      signal: new AbortController().signal,
      progress: () => {},
      download: async () => binary,
      extract: async () => {},
      validate: async () => {
        throw new Error('programa inválido')
      }
    })
  ).rejects.toThrow('programa inválido')
})

test('cancelamento não retorna configuração parcial nem faz download adicional', async () => {
  const abort = new AbortController()
  abort.abort()
  await expect(
    installVoiceComponents({
      root: '/unused',
      platform: 'win32',
      arch: 'x64',
      bundledWhisper: null,
      tools: { whisper: null, ffmpeg: null, model: null },
      signal: abort.signal,
      progress: () => {},
      download: async () => {
        throw new Error('não deve baixar')
      },
      extract: async () => {},
      validate: async () => {}
    })
  ).rejects.toThrow()
})

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { downloadVerified } from '../src/main/ai/local/download'

test.skipIf(process.env.NEXU_VOICE_SMOKE !== '1' || process.platform !== 'darwin')(
  'configura componentes Mac embutidos em perfil temporário e transcreve português',
  async () => {
    const run = promisify(execFile)
    const root = mkdtempSync(join(tmpdir(), 'nexu-voice-smoke-'))
    const model = join(homedir(), '.cache/marketing-melvin/modelos/ggml-small.bin')
    const tools = await installVoiceComponents({
      root,
      platform: process.platform,
      arch: process.arch,
      bundledWhisper: join(process.cwd(), 'resources/transcribe', `darwin-${process.arch}`, 'whisper-cli'),
      bundledFfmpeg: join(process.cwd(), 'resources/transcribe', `darwin-${process.arch}`, 'ffmpeg'),
      tools: { whisper: null, ffmpeg: null, model },
      signal: new AbortController().signal,
      progress: () => {},
      download: downloadVerified,
      extract: async () => {
        throw new Error('Mac não deve extrair pacote')
      },
      validate: async (file, kind, signal) => {
        await run(file, [kind === 'whisper' ? '-h' : '-version'], { signal })
      }
    })
    expect(tools.ffmpeg).toBe(join(process.cwd(), 'resources/transcribe', `darwin-${process.arch}`, 'ffmpeg'))
    expect(tools.model).toBe(model)
    const wav = join(root, 'voz.wav')
    await run(tools.ffmpeg!, [
      '-y',
      '-loglevel',
      'error',
      '-i',
      join(__dirname, 'fixtures/voz-pt.ogg'),
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      wav
    ])
    const result = await run(tools.whisper!, ['-m', model, '-f', wav, '-l', 'pt', '-nt', '-np', '-t', '4'])
    expect(result.stdout.toLowerCase()).toContain('óculos')
    expect(result.stdout.toLowerCase()).toContain('pronto')
  },
  120_000
)

test('Windows mantém DLLs extraídas e só retorna configuração depois de validar ferramentas', async () => {
  const { mkdirSync, existsSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'voice-win-'))
  const validated: string[] = []
  const tools = await installVoiceComponents({
    root,
    platform: 'win32',
    arch: 'x64',
    bundledWhisper: null,
    tools: { whisper: null, ffmpeg: null, model: null },
    signal: new AbortController().signal,
    progress: () => {},
    download: async (o) => {
      if (o.dest.endsWith('.bin')) {
        writeFileSync(o.dest, 'lmgg')
        truncateSync(o.dest, 1_000_000)
      } else writeFileSync(o.dest, 'archive')
      return o.dest
    },
    extract: async (archive, dest) => {
      const bin = join(dest, 'package', 'bin')
      mkdirSync(bin, { recursive: true })
      const name = archive.includes('whisper-bin') ? 'whisper-cli.exe' : 'ffmpeg.exe'
      writeFileSync(join(bin, name), 'executable')
      writeFileSync(join(bin, 'dependency.dll'), 'dll')
    },
    validate: async (file) => {
      expect(file.endsWith('.exe')).toBe(true)
      validated.push(file)
    }
  })
  expect(validated).toEqual([tools.whisper, tools.ffmpeg])
  expect(existsSync(join(tools.ffmpeg!, '..', 'dependency.dll'))).toBe(true)
  expect(tools.model).toBe(join(root, 'ggml-small.bin'))
})

test('Windows com runtime ausente falha antes de baixar FFmpeg ou modelo', async () => {
  const { mkdirSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'voice-win-missing-'))
  const downloaded: string[] = []
  await expect(
    installVoiceComponents({
      root,
      platform: 'win32',
      arch: 'x64',
      bundledWhisper: null,
      tools: { whisper: null, ffmpeg: null, model: null },
      signal: new AbortController().signal,
      progress: () => {},
      download: async (o) => {
        downloaded.push(o.url)
        return o.dest
      },
      extract: async (_archive, dest) => {
        mkdirSync(dest, { recursive: true })
        writeFileSync(join(dest, 'whisper-cli.exe'), 'exe')
      },
      validate: async () => {
        throw new Error('VC runtime ausente')
      }
    })
  ).rejects.toThrow('VC runtime ausente')
  expect(downloaded).toHaveLength(1)
  expect(downloaded[0]).toContain('whisper-bin-x64.zip')
})
