/** FFmpeg mínimo LGPL: build no computador de desenvolvimento, nunca no cliente.
 * node scripts/build-ffmpeg-mac.mjs [arm64|x64|all]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream, mkdirSync, copyFileSync, chmodSync } from 'node:fs'
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
const work = await mkdtemp(join(tmpdir(), 'nexu-ffmpeg-build-'))
const archive = join(work, 'ffmpeg-8.0.1.tar.xz')
const response = await fetch('https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz', { signal: AbortSignal.timeout(300000) })
if (!response.ok || !response.body) throw new Error(`Download respondeu ${response.status}`)
await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
const hash = createHash('sha256')
await pipeline(createReadStream(archive), hash)
if (hash.digest('hex') !== '05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41')
  throw new Error('SHA-256 inválido da fonte FFmpeg')
execFileSync('/usr/bin/tar', ['-xf', archive, '-C', work])
const source = join(work, 'ffmpeg-8.0.1')
for (const arch of arg === 'all' ? ['arm64', 'x64'] : [arg]) {
  const cpu = arch === 'x64' ? 'x86_64' : 'arm64'
  const build = join(work, `build-${arch}`)
  mkdirSync(build, { recursive: true })
  const args = [
    '--cc=clang',
    `--arch=${cpu}`,
    '--target-os=darwin',
    `--extra-cflags=-arch ${cpu} -mmacosx-version-min=12.0`,
    `--extra-ldflags=-arch ${cpu} -mmacosx-version-min=12.0`,
    '--disable-everything',
    '--disable-autodetect',
    '--disable-network',
    '--disable-doc',
    '--disable-debug',
    '--disable-x86asm',
    '--disable-programs',
    '--enable-ffmpeg',
    '--enable-protocol=file,pipe',
    '--enable-demuxer=ogg,matroska,mov,mp3,wav,aac,flac',
    '--enable-decoder=opus,vorbis,mp3,mp3float,aac,flac,alac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le',
    '--enable-encoder=pcm_s16le',
    '--enable-muxer=wav',
    '--enable-filter=aresample,aformat,anull'
  ]
  if (cpu !== process.arch.replace('x64', 'x86_64')) args.push('--enable-cross-compile')
  execFileSync(join(source, 'configure'), args, { cwd: build, stdio: 'inherit' })
  execFileSync('/usr/bin/make', ['-j', '6', 'ffmpeg'], { cwd: build, stdio: 'inherit' })
  const dest = join(repo, 'resources/transcribe', `darwin-${arch}`)
  mkdirSync(dest, { recursive: true })
  copyFileSync(join(build, 'ffmpeg'), join(dest, 'ffmpeg'))
  chmodSync(join(dest, 'ffmpeg'), 0o755)
  execFileSync('/usr/bin/otool', ['-L', join(dest, 'ffmpeg')], { stdio: 'inherit' })
}
copyFileSync(join(source, 'COPYING.LGPLv2.1'), join(repo, 'resources/transcribe/FFMPEG-LICENSE.txt'))
await import('./write-transcribe-manifest.mjs')
console.log('FFmpeg mínimo salvo. Sem GPL, nonfree ou bibliotecas externas.')
