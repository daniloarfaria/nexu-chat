import { useApp } from './store'
import { useChats } from './chatStore'

/** Abre a conversa do contato na página Conversas. */
export async function openChat(accountId: string, jid: string | null, phone: string): Promise<void> {
  let target = jid ?? `${phone}@s.whatsapp.net`
  if (!jid) {
    try {
      target = await window.api.invoke('chats:new', { accountId, phone })
    } catch {
      /* sem conexão: abre pelo número mesmo */
    }
  }
  useApp.getState().go('conversas')
  await useChats.getState().setAccount(accountId)
  await useChats.getState().select(target)
}
