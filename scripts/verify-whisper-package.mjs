/** electron-builder beforePack: impede publicar Mac sem a CLI da arquitetura correta. */
import { readFileSync, accessSync, constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
export default async (context) => {
  if (context.electronPlatformName !== 'darwin') return
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!arch) throw new Error('Whisper: arquitetura Mac não suportada; empacote arm64 ou x64 separadamente.')
  const root = context.packager.projectDir
  const base = join(root, 'resources/transcribe')
  const manifest = JSON.parse(readFileSync(join(base, 'BUILD-MANIFEST.json'), 'utf8'))
  const cpu = arch === 'arm64' ? 0x100000c : 0x1000007
  for (const name of ['whisper-cli', 'ffmpeg']) {
    const file = join(base, `darwin-${arch}`, name)
    accessSync(file, constants.X_OK)
    const bytes = readFileSync(file)
    if (bytes.length < 100000 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu)
      throw new Error(`Voz: ${name} inválido para ${arch}. Recompile os componentes Mac.`)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== manifest.artifacts[`darwin-${arch}/${name}`])
      throw new Error(`Voz: SHA-256 inválido: ${name} ${arch}`)
  }
  accessSync(join(base, 'WHISPER-LICENSE'))
  accessSync(join(base, 'FFMPEG-LICENSE.txt'))
}
