import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import {
  createChatStoreCore,
  dispatchChatEvent,
  registerChatStore,
  type ChatDeps,
  type ChatState,
  type ChatStoreApi,
  type ChatStoreOptions
} from './chatStoreCore'

export type { ChatState, ChatStoreApi } from './chatStoreCore'

const deps: ChatDeps = {
  invoke: (channel, ...args) => window.api.invoke(channel, ...args),
  setFocusedChat: (v) => window.ui.setFocusedChat(v),
  hasFocus: () => document.hasFocus()
}

/** Cria um estado de conversa independente (cada janela de conversa tem o seu). */
export function createChatStore(opts?: ChatStoreOptions): ChatStoreApi {
  return createChatStoreCore(deps, opts)
}

const identity = (s: ChatState): ChatState => s

type BoundStore = {
  (): ChatState
  <U>(selector: (s: ChatState) => U): U
} & ChatStoreApi

function bind(api: ChatStoreApi): BoundStore {
  const useBound = (selector?: (s: ChatState) => unknown): unknown => useStore(api, selector ?? identity)
  return Object.assign(useBound, api) as BoundStore
}

/** Instância principal: a da tela Conversas (e de quem abre uma conversa nela). */
const mainChatStore = createChatStore({ active: false })
registerChatStore(mainChatStore)
export const useChats = bind(mainChatStore)

// ---------- Contexto: qual instância os componentes de conversa usam ----------

const ChatStoreContext = createContext<ChatStoreApi>(mainChatStore)

/** Faz os componentes de conversa dentro dele usarem a instância indicada. Sem ele, usam a principal. */
export function ChatStoreProvider({ store, children }: { store: ChatStoreApi; children: ReactNode }): ReactNode {
  return createElement(ChatStoreContext.Provider, { value: store }, children)
}

export function useChatStoreApi(): ChatStoreApi {
  return useContext(ChatStoreContext)
}

/** Lê o estado da conversa da instância do contexto (principal ou de uma janela). */
export function useChatStore(): ChatState
export function useChatStore<U>(selector: (s: ChatState) => U): U
export function useChatStore(selector?: (s: ChatState) => unknown): unknown {
  return useStore(useChatStoreApi(), selector ?? identity)
}

/**
 * Instância própria para uma janela de conversa (ex.: a do funil). Não mexe na conversa
 * selecionada na tela Conversas. Recebe os eventos em tempo real enquanto está aberta e
 * deixa de recebê-los ao fechar.
 */
export function useWindowChatStore(accountId: string, jid: string | null): ChatStoreApi {
  const [store] = useState(() => createChatStore({ list: false }))

  useEffect(() => {
    const off = registerChatStore(store)
    return () => {
      off()
      void store.getState().select(null) // avisa que a conversa saiu da tela
    }
  }, [store])

  useEffect(() => {
    if (!jid) return
    let alive = true
    void (async () => {
      await store.getState().setAccount(accountId)
      if (alive) await store.getState().select(jid)
    })()
    return () => {
      alive = false
    }
  }, [store, accountId, jid])

  return store
}

/**
 * A conversa que a janela mostra de fato. Depois da fusão LID/número o store passa a apontar para o número;
 * quem renderiza pelo JID guardado antes (ChatView, controles do robô) ficaria olhando o LID que não existe mais.
 */
export function useShownJid(store: ChatStoreApi, fallback: string | null): string | null {
  return useStore(store, (s) => s.selected) ?? fallback
}

/** Liga os eventos do processo principal a todas as instâncias de conversa abertas. */
export function subscribeChatEvents(): () => void {
  const offs = [
    window.api.on('chats:changed', ({ accountId, chats }) =>
      dispatchChatEvent({ type: 'chats:changed', accountId, chats })
    ),
    window.api.on('messages:changed', ({ accountId, chatJid, messages }) =>
      dispatchChatEvent({ type: 'messages:changed', accountId, chatJid, messages })
    ),
    window.api.on('messages:reload', ({ accountId, chatJid }) =>
      dispatchChatEvent({ type: 'messages:reload', accountId, chatJid })
    ),
    window.api.on('chats:merged', ({ accountId, from, to }) =>
      dispatchChatEvent({ type: 'chats:merged', accountId, from, to })
    ),
    window.api.on('sync:changed', (state) => dispatchChatEvent({ type: 'sync:changed', state }))
  ]
  return () => offs.forEach((o) => o())
}
