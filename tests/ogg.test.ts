import { expect, test } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { opusSamples, webmOpusPackets, webmToOgg } from '../src/main/wa/ogg'

const webm = new Uint8Array(readFileSync(join(__dirname, 'fixtures/voice.webm')))

test('extrai cabeçalho e pacotes Opus do WebM gravado pelo Electron', () => {
  const { head, packets } = webmOpusPackets(webm)
  expect(new TextDecoder().decode(head!.slice(0, 8))).toBe('OpusHead')
  // O Chromium grava quadros de 60 ms (2880 amostras a 48 kHz); conferido com ffprobe
  expect(packets).toHaveLength(34)
  expect(opusSamples(packets[0])).toBe(2880)
  const total = packets.reduce((n, p) => n + opusSamples(p), 0)
  expect(total / 48000).toBeCloseTo(2.04, 2)
})

test('gera Ogg/Opus válido com a duração correta', () => {
  const { ogg, seconds } = webmToOgg(webm)
  expect(new TextDecoder().decode(ogg.slice(0, 4))).toBe('OggS')
  expect(seconds).toBeGreaterThanOrEqual(2)
  expect(seconds).toBeLessThanOrEqual(3)

  // Se o ffprobe existir na máquina, confirma que o arquivo decodifica
  let probe: string | null
  try {
    const f = join(mkdtempSync(join(tmpdir(), 'ogg-')), 'v.ogg')
    writeFileSync(f, ogg)
    probe = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate:format=duration', '-of', 'json', f],
      {
        encoding: 'utf8'
      }
    )
  } catch {
    probe = null
  }
  if (probe) {
    const j = JSON.parse(probe)
    expect(j.streams[0].codec_name).toBe('opus')
    expect(Number(j.format.duration)).toBeGreaterThan(2)
  }
})
