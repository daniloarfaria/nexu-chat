import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'

/**
 * Identificador do computador para prender a licença à máquina.
 * Usa o UUID do hardware (Mac), o MachineGuid (Windows) ou /etc/machine-id (Linux) e só guarda o hash.
 */
let cached: string | null = null

function rawId(): string {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        timeout: 5000
      })
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)
      if (m) return m[1]
    } else if (process.platform === 'win32') {
      const out = execFileSync(
        'reg',
        ['query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      )
      const m = /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(out)
      if (m) return m[1]
    } else {
      return readFileSync('/etc/machine-id', 'utf8').trim()
    }
  } catch {
    /* cai no plano B */
  }
  return `host:${hostname()}`
}

export function machineHash(): string {
  if (!cached) cached = createHash('sha256').update(`nexu-chat:${rawId()}`).digest('hex')
  return cached
}

export function machineName(): string {
  return hostname()
    .replace(/\.local$/, '')
    .slice(0, 120)
}
