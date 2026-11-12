/** Compile antes de empacotar o Mac. Não roda no computador do cliente.
 * Uso: node scripts/build-whisper-mac.mjs [arm64|x64|all]
 * Requer macOS + ferramentas Apple já instaladas. Não instala pacotes do sistema.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, mkdirSync, copyFileSync, chmodSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv[2] ?? 'all'
if (!['arm64', 'x64', 'all'].includes(arg) || process.platform !== 'darwin')
  throw new Error('Use arm64, x64 ou all em um Mac com ferramentas Apple.')
const work = await mkdtemp(join(tmpdir(), 'nexu-whisper-build-'))
const commit = '4979e04f5dcaccb36057e059bbaed8a2f5288315'
async function download(url, file, sha256) {
  const dest = join(work, file)
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) })
  if (!response.ok || !response.body) throw new Error(`Download respondeu ${response.status}`)
  const { createWriteStream } = await import('node:fs')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest))
  const hash = createHash('sha256')
  await pipeline(createReadStream(dest), hash)
  if (hash.digest('hex') !== sha256) throw new Error(`SHA-256 inválido: ${file}`)
  execFileSync('/usr/bin/tar', ['-xzf', dest, '-C', work])
}
await download(
  `https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/${commit}`,
  'source.tar.gz',
  'ec8e33f4c838ed459ad0a23da255c0262f150a6f54839a17e504ddf1495305d5'
)
await download(
  'https://github.com/Kitware/CMake/releases/download/v3.31.8/cmake-3.31.8-macos-universal.tar.gz',
  'cmake.tar.gz',
  'd1449f969c54d5c00886d5b643340d493dfb3c81cb39ee29b35453395c11ebf7'
)
const cmake = join(work, 'cmake-3.31.8-macos-universal/CMake.app/Contents/bin/cmake')
const source = join(work, `whisper.cpp-${commit}`)
for (const arch of arg === 'all' ? ['arm64', 'x64'] : [arg]) {
  const build = join(work, `build-${arch}`)
  execFileSync(
    cmake,
    [
      '-S',
      source,
      '-B',
      build,
      '-DCMAKE_BUILD_TYPE=Release',
      `-DCMAKE_OSX_ARCHITECTURES=${arch === 'x64' ? 'x86_64' : 'arm64'}`,
      '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DGGML_NATIVE=OFF',
      '-DGGML_METAL=OFF',
      '-DGGML_OPENMP=OFF',
      '-DGGML_AVX=OFF',
      '-DGGML_AVX2=OFF',
      '-DGGML_FMA=OFF',
      '-DGGML_F16C=OFF',
      '-DWHISPER_BUILD_TESTS=OFF',
      '-DWHISPER_BUILD_EXAMPLES=ON'
    ],
    { stdio: 'inherit' }
  )
  execFileSync(cmake, ['--build', build, '--target', 'whisper-cli', '-j', '6'], { stdio: 'inherit' })
  const dest = join(repo, 'resources/transcribe', `darwin-${arch}`)
  mkdirSync(dest, { recursive: true })
  copyFileSync(join(build, 'bin/whisper-cli'), join(dest, 'whisper-cli'))
  chmodSync(join(dest, 'whisper-cli'), 0o755)
  execFileSync('/usr/bin/otool', ['-L', join(dest, 'whisper-cli')], { stdio: 'inherit' })
}
copyFileSync(join(source, 'LICENSE'), join(repo, 'resources/transcribe/WHISPER-LICENSE'))
await import('./write-transcribe-manifest.mjs')
console.log('CLIs salvas em resources/transcribe. Empacote com npm run build:mac ou build:mac-intel.')
