import pino from 'pino'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Mascara telefones e JIDs nos logs (LGPD): 5511987654321 → 5511*****4321
export function maskPhone(text: string): string {
  return text.replace(/\d{10,15}/g, (m) => m.slice(0, 4) + '*'.repeat(m.length - 8) + m.slice(-4))
}

let logger: pino.Logger = pino({ level: 'info' })

export function initLog(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const dest = pino.destination({ dest: join(dir, 'app.log'), sync: false, mkdir: true })
  logger = pino(
    {
      level: 'info',
      hooks: {
        logMethod(args, method) {
          method.apply(this, args.map((a) => (typeof a === 'string' ? maskPhone(a) : a)) as Parameters<typeof method>)
        }
      },
      // Baileys coloca jids em campos variados; remove os mais comuns
      redact: {
        paths: ['jid', 'remoteJid', 'participant', 'from', 'to', 'phone', '*.jid', '*.remoteJid'],
        censor: '[oculto]'
      }
    },
    dest
  )
}

export const log = {
  info: (msg: string, extra?: object): void => logger.info(extra ?? {}, msg),
  warn: (msg: string, extra?: object): void => logger.warn(extra ?? {}, msg),
  error: (msg: string, err?: unknown): void =>
    logger.error({ err: err instanceof Error ? { message: maskPhone(err.message) } : String(err) }, msg),
  /** Logger para o Baileys: só erros, para não encher o disco */
  baileys: (): pino.Logger => logger.child({ mod: 'baileys' }, { level: 'error' })
}
