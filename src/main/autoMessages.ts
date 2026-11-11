/**
 * Mensagens que a loja enviou sozinha (boas-vindas, fora do horário, confirmação de SAIR).
 * Elas aparecem na conversa como "da loja", mas não respondem a pergunta do cliente:
 * o robô de atendimento precisa ignorá-las ao decidir se ainda há algo a responder.
 */
const autoIds = new Map<string, number>()
const TTL_MS = 6 * 3600_000

export function markAutoMessage(accountId: string, id: string): void {
  const now = Date.now()
  if (autoIds.size > 1000) for (const [k, t] of autoIds) if (now - t > TTL_MS) autoIds.delete(k)
  autoIds.set(`${accountId}:${id}`, now)
}

export function isAutoMessage(accountId: string, id: string): boolean {
  const t = autoIds.get(`${accountId}:${id}`)
  return t != null && Date.now() - t < TTL_MS
}
