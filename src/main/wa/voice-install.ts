import { closeSync, mkdirSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadOptions } from '../ai/local/download'
import { voiceAssetsFor, WHISPER_MODEL, WHISPER_VERSION } from './voice-catalog'

export interface VoiceTools {
  whisper: string | null
  model: string | null
  ffmpeg: string | null
}
export interface VoiceInstallOptions {
  root: string
  platform: string
  arch: string
  bundledWhisper: string | null
  bundledFfmpeg?: string | null
  tools: VoiceTools
  signal: AbortSignal
  progress: (label: string, received: number, total: number) => void
  download: (options: DownloadOptions) => Promise<string>
  extract: (archive: string, dest: string, signal: AbortSignal) => Promise<void>
  validate: (file: string, kind: 'whisper' | 'ffmpeg', signal: AbortSignal) => Promise<void>
}
/** Whisper.cpp GGML: evita aceitar modelo truncado ou um HTML salvo como .bin. */
export function isWhisperModel(path: string): boolean {
  let fd: number | undefined
  try {
    if (!statSync(path).isFile() || statSync(path).size < 1_000_000) return false
    fd = openSync(path, 'r')
    const header = Buffer.alloc(4)
    return readSync(fd, header, 0, 4, 0) === 4 && header.toString('ascii') === 'lmgg'
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function findBinary(dir: string, name: string): string | null {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isFile() && item.name === name) return path
    if (item.isDirectory()) {
      const found = findBinary(path, name)
      if (found) return found
    }
  }
  return null
}

/** Só devolve caminhos após validar os programas; o chamador salva as configurações atomicamente. */
export async function installVoiceComponents(o: VoiceInstallOptions): Promise<VoiceTools> {
  const assets = voiceAssetsFor(o.platform, o.arch)
  if (!assets) throw new Error('Instalação automática indisponível para este sistema e processador.')
  if (!o.tools.whisper && o.platform === 'darwin' && !o.bundledWhisper)
    throw new Error('O Whisper não está incluído neste instalador. Atualize o Nexu Chat ou use as opções avançadas.')
  const tools = { ...o.tools }
  const check = (): void => {
    o.signal.throwIfAborted()
  }
  const download = async (
    asset: typeof WHISPER_MODEL,
    label: string,
    dest = join(o.root, asset.file)
  ): Promise<string> => {
    check()
    o.progress(label, 0, asset.size)
    return o.download({ ...asset, dest, signal: o.signal, onProgress: (r, t) => o.progress(label, r, t) })
  }
  if (!tools.whisper) {
    if (o.bundledWhisper) tools.whisper = o.bundledWhisper
    else {
      const archive = await download(assets.binary!, 'Baixando Whisper')
      const dir = join(o.root, 'whisper', WHISPER_VERSION)
      o.progress('Preparando Whisper', 0, 0)
      mkdirSync(dir, { recursive: true })
      await o.extract(archive, dir, o.signal)
      tools.whisper = findBinary(dir, 'whisper-cli.exe')
      if (!tools.whisper) throw new Error('O pacote não contém o executável whisper-cli.')
    }
  }
  check()
  o.progress('Verificando Whisper', 0, 0)
  await o.validate(tools.whisper, 'whisper', o.signal)
  if (!tools.ffmpeg) {
    if (o.bundledFfmpeg) tools.ffmpeg = o.bundledFfmpeg
    else if (assets.ffmpeg) {
      const archive = await download(assets.ffmpeg, 'Baixando conversor de áudio')
      const dir = join(o.root, 'ffmpeg', '8.1.3-35')
      mkdirSync(dir, { recursive: true })
      o.progress('Preparando conversor de áudio', 0, 0)
      await o.extract(archive, dir, o.signal)
      tools.ffmpeg = findBinary(dir, 'ffmpeg.exe')
      if (!tools.ffmpeg) throw new Error('O pacote não contém o executável ffmpeg.')
    } else throw new Error('O conversor de áudio não está incluído neste instalador. Atualize o Nexu Chat.')
  }
  check()
  o.progress('Verificando conversor de áudio', 0, 0)
  await o.validate(tools.ffmpeg, 'ffmpeg', o.signal)
  if (!tools.model) tools.model = await download(WHISPER_MODEL, 'Baixando modelo de voz')
  check()
  if (!tools.model || !isWhisperModel(tools.model)) {
    // Caminhos reaproveitados também precisam continuar existindo ao fim da instalação.
    throw new Error('O modelo de voz não está disponível.')
  }
  return tools
}
