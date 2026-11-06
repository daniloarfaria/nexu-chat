import { useApp } from './store'
import { useChats } from './chatStore'

/** Descobre a conversa do contato. Sem conversa ainda, cria pelo número (ou usa o número direto, se estiver sem conexão). */
export async function resolveChatJid(accountId: string, jid: string | null, phone: string): Promise<string> {
  if (jid) return jid
  try {
    return await window.api.invoke('chats:new', { accountId, phone })
  } catch {
    return `${phone}@s.whatsapp.net` // sem conexão: abre pelo número mesmo
  }
}

/** Abre a conversa do contato na página Conversas. */
export async function openChat(accountId: string, jid: string | null, phone: string): Promise<void> {
  const target = await resolveChatJid(accountId, jid, phone)
  useApp.getState().go('conversas')
  await useChats.getState().setAccount(accountId)
  await useChats.getState().select(target)
}
