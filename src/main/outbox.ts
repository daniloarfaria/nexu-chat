import { randomBetween } from '@shared/rules'

/**
 * Fila de envios automáticos por conta (respostas automáticas, boas-vindas, moderação).
 * Um envio por vez, com intervalo de 3 a 7 s, para nunca sair uma rajada de mensagens.
 * Campanhas têm o próprio motor, com regras mais rígidas.
 */
const chains = new Map<string, Promise<void>>()
const sizes = new Map<string, number>()
const MAX_PENDING = 50

export function enqueueSend(accountId: string, job: () => Promise<unknown>): boolean {
  const n = sizes.get(accountId) ?? 0
  if (n >= MAX_PENDING) return false // fila cheia: descarta (evita acumular respostas atrasadas)
  sizes.set(accountId, n + 1)
  const prev = chains.get(accountId) ?? Promise.resolve()
  const next = prev
    .then(() => job())
    .catch(() => undefined)
    .then(() => new Promise<void>((r) => setTimeout(r, randomBetween(3000, 7000))))
    .finally(() => sizes.set(accountId, (sizes.get(accountId) ?? 1) - 1))
  chains.set(accountId, next)
  return true
}
