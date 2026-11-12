import type { PinnedFile } from '../ai/local/catalog'

// Verificados em 12/11/2026: digest da API GitHub; modelo lfs.oid do Hugging Face.
// A fonte foi baixada e seu SHA-256 calculado localmente. Não há CLI oficial pronta para Mac.
export const WHISPER_VERSION = 'v1.8.2'
const gh = 'https://github.com'
export const WHISPER_MODEL: PinnedFile = {
  file: 'ggml-small.bin',
  size: 487601967,
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin',
  sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
}
export const WHISPER_SOURCE: PinnedFile = {
  file: 'whisper-v1.8.2.tar.gz',
  size: 7587024,
  url: 'https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/4979e04f5dcaccb36057e059bbaed8a2f5288315',
  sha256: 'ec8e33f4c838ed459ad0a23da255c0262f150a6f54839a17e504ddf1495305d5'
}
export const BUILD_CMAKE: PinnedFile = {
  file: 'cmake-3.31.8-macos-universal.tar.gz',
  size: 78373419,
  url: `${gh}/Kitware/CMake/releases/download/v3.31.8/cmake-3.31.8-macos-universal.tar.gz`,
  sha256: 'd1449f969c54d5c00886d5b643340d493dfb3c81cb39ee29b35453395c11ebf7'
}
interface VoiceAssets {
  ffmpeg?: PinnedFile
  binary?: PinnedFile
}
export function voiceAssetsFor(platform: string, arch: string): VoiceAssets | null {
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return {}
  if (platform !== 'win32' || arch !== 'x64') return null
  return {
    ffmpeg: {
      file: 'ffmpeg-n8.1.3-35-gf1acb0a266-win64-lgpl-shared-8.1.zip',
      size: 80313217,
      url: `${gh}/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-11-12-39/ffmpeg-n8.1.3-35-gf1acb0a266-win64-lgpl-shared-8.1.zip`,
      sha256: 'f7697c270197c04bf72759c65ada64fcaea663bcb80767c390752d2412ea2dcf'
    },
    binary: {
      file: 'whisper-bin-x64.zip',
      size: 3832432,
      url: `${gh}/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`,
      sha256: 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732'
    }
  }
}

export const FFMPEG_SOURCE: PinnedFile = {
  file: 'ffmpeg-8.0.1.tar.xz',
  size: 11388848,
  url: 'https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz',
  sha256: '05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41'
}
