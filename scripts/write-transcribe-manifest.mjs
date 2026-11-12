import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/transcribe')
const artifacts = {}
for (const arch of ['arm64', 'x64'])
  for (const exe of ['whisper-cli', 'ffmpeg']) {
    const file = `darwin-${arch}/${exe}`
    if (existsSync(join(dir, file)))
      artifacts[file] = createHash('sha256')
        .update(readFileSync(join(dir, file)))
        .digest('hex')
  }
writeFileSync(
  join(dir, 'BUILD-MANIFEST.json'),
  JSON.stringify(
    {
      whisper: 'v1.8.2 (4979e04f5dcaccb36057e059bbaed8a2f5288315)',
      ffmpeg: '8.0.1 (mínimo LGPL, sem GPL/nonfree)',
      artifacts
    },
    null,
    2
  ) + '\n'
)
