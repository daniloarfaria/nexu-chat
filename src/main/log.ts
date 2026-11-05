import pino from 'pino'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Mascara telefones e JIDs nos logs (LGPD): 5511987654321 → 5511*****4321
export function maskPhone(text: string): string {
  return text
    .replace(/\d{10,15}/g, (m) => m.slice(0, 4) + '*'.repeat(m.length - 8) + m.slice(-4))
    .replace(/\+?\d[\d ()-]{9,}\d/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[telefone]' : m))
}

/** Aplica a máscara em todas as strings de um objeto (até 4 níveis). */
export function maskDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return maskPhone(v)
  if (!v || typeof v !== 'object' || depth > 4) return v
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v))
    out[k] = /^(pushName|notify|verifiedName|name|text|conversation|caption)$/.test(k)
      ? '[oculto]'
      : maskDeep(x, depth + 1)
  return out
}

let logger: pino.Logger = pino({ level: 'info' })

export function initLog(dir: string): void {
  mkdirSync(dir, { recursive: true })
  // Rotação simples: mantém o atual + 1 anterior, até ~5 MB cada
  const file = join(dir, 'app.log')
  try {
    if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, join(dir, 'app.1.log'))
  } catch {
    /* segue sem rotacionar */
  }
  const dest = pino.destination({ dest: join(dir, 'app.log'), sync: false, mkdir: true })
  logger = pino(
    {
      level: 'info',
      hooks: {
        logMethod(args, method) {
          method.apply(this, args.map((a) => maskDeep(a)) as Parameters<typeof method>)
        }
      },
      // Também o que o Baileys registra (erros com nós do protocolo, chaves de mensagem…)
      formatters: { log: (obj) => maskDeep(obj) as Record<string, unknown> },
      // Baileys coloca jids em campos variados; remove os mais comuns
      redact: {
        paths: [
          'jid',
          'remoteJid',
          'participant',
          'from',
          'to',
          'phone',
          'pushName',
          '*.jid',
          '*.remoteJid',
          '*.participant',
          '*.pushName',
          'attrs.from',
          'attrs.participant',
          '*.attrs.from',
          '*.attrs.participant'
        ],
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
    logger.error({ err: err instanceof Error ? { message: maskPhone(err.message) } : maskPhone(String(err)) }, msg),
  /** Logger para o Baileys: só erros, para não encher o disco */
  baileys: (): pino.Logger => logger.child({ mod: 'baileys' }, { level: 'error' })
}
