import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BridgeApi } from '@shared/api'
import type { ChatFilter, ChatItem, MessageItem, SyncState } from '@shared/types'

// Núcleo do estado das conversas, sem React e sem `window`: dá para testar fora do app.
// O app cria uma instância principal (tela Conversas) e instâncias avulsas (janela do funil).

const PAGE = 80
const MSG_PAGE = 60

export interface ChatState {
  accountId: string | null
  filter: ChatFilter
  search: string
  chats: ChatItem[]
  hasMore: boolean
  loadingChats: boolean
  selected: string | null
  messages: Record<string, MessageItem[]>
  hasOlder: Record<string, boolean>
  sync: SyncState | null
  replyTo: MessageItem | null
  editing: MessageItem | null
  /** A conversa selecionada está realmente na tela? Oculta (ex.: fora de Conversas), não marca como lida. */
  active: boolean

  setActive: (v: boolean) => void
  setAccount: (id: string | null) => Promise<void>
  setFilter: (f: ChatFilter) => Promise<void>
  setSearch: (s: string) => Promise<void>
  loadChats: (reset?: boolean) => Promise<void>
  select: (jid: string | null) => Promise<void>
  loadOlder: (jid: string) => Promise<boolean>
  setReply: (m: MessageItem | null) => void
  setEditing: (m: MessageItem | null) => void
  applyChats: (accountId: string, chats: ChatItem[]) => void
  applyMessages: (accountId: string, chatJid: string, msgs: MessageItem[]) => void
  reloadMessages: (accountId: string, chatJid: string) => Promise<void>
  applyMerged: (accountId: string, from: string, to: string) => void
  applySync: (s: SyncState) => void
}

export type ChatStoreApi = StoreApi<ChatState>

/** O que o estado precisa do mundo de fora (no app vem de `window`; nos testes, de simulações). */
export interface ChatDeps {
  invoke: BridgeApi['invoke']
  setFocusedChat: (v: { accountId: string; jid: string } | null) => void
  hasFocus: () => boolean
}

export interface ChatStoreOptions {
  /**
   * true (padrão): carrega e mantém a lista de conversas, como na tela Conversas.
   * false: acompanha só a conversa aberta (janela do funil), sem buscar a lista inteira.
   */
  list?: boolean
  /** A conversa começa visível? (padrão true; o estado principal começa oculto até a tela Conversas abrir) */
  active?: boolean
}

/** Quem é o dono do foco da conversa no processo principal (só o dono pode limpá-lo). */
let focusOwner: object | null = null

function sortChats(list: ChatItem[]): ChatItem[] {
  return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastTs - a.lastTs)
}

const fold = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

function matches(c: ChatItem, filter: ChatFilter, search: string): boolean {
  if (filter === 'archived' ? !c.archived : c.archived) return false
  if (filter === 'unread' && c.unread === 0) return false
  if (filter === 'groups' && !c.isGroup) return false
  if (!c.lastTs) return false
  const q = fold(search)
  if (q && !fold(c.name).includes(q) && !(c.phone ?? '').includes(search.replace(/\D/g, '') || '§')) return false
  return true
}

/** Junta listas sem repetir mensagem (o mesmo id fica uma vez só, com a versão mais nova) e ordena. */
export function mergeMsgs(...lists: MessageItem[][]): MessageItem[] {
  const byId = new Map<string, MessageItem>()
  for (const l of lists) for (const m of l) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.ts - b.ts || (a.rid ?? 0) - (b.rid ?? 0))
}

export function createChatStoreCore(deps: ChatDeps, opts: ChatStoreOptions = {}): ChatStoreApi {
  const withList = opts.list !== false
  // Por instância: duas janelas não podem dividir o controle de "já está buscando"
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  const loadingOlder = new Set<string>()
  const owner = {}
  const setFocus = (v: { accountId: string; jid: string } | null): void => {
    if (v) {
      focusOwner = owner
      deps.setFocusedChat(v)
    } else if (focusOwner === owner) {
      focusOwner = null
      deps.setFocusedChat(null)
    }
  }

  return createStore<ChatState>((set, get) => ({
    accountId: null,
    filter: 'all',
    search: '',
    chats: [],
    hasMore: true,
    loadingChats: false,
    selected: null,
    messages: {},
    hasOlder: {},
    sync: null,
    replyTo: null,
    editing: null,
    active: opts.active !== false,

    setActive: (active) => {
      set({ active })
      const { selected, accountId } = get()
      if (!active) setFocus(null)
      else if (selected && accountId) setFocus({ accountId, jid: selected })
    },

    setAccount: async (id) => {
      if (get().accountId === id) return
      set({
        accountId: id,
        chats: [],
        selected: null,
        messages: {},
        hasOlder: {},
        sync: null,
        replyTo: null,
        editing: null
      })
      setFocus(null)
      if (!id || !withList) return
      const [sync] = await Promise.all([deps.invoke('sync:state', { accountId: id }), get().loadChats(true)])
      if (get().accountId === id) set({ sync })
    },

    setFilter: async (filter) => {
      set({ filter })
      await get().loadChats(true)
    },

    setSearch: async (search) => {
      set({ search })
      if (searchTimer) clearTimeout(searchTimer)
      await new Promise<void>((r) => (searchTimer = setTimeout(r, 180)))
      if (get().search === search) await get().loadChats(true)
    },

    loadChats: async (reset = false) => {
      const { accountId, filter, search, chats } = get()
      if (!accountId || !withList) return
      set({ loadingChats: true })
      try {
        const offset = reset ? 0 : chats.length
        const page = await deps.invoke('chats:list', { accountId, filter, search, limit: PAGE, offset })
        // Resposta antiga (conta, filtro ou busca mudaram enquanto carregava): descarta
        const now = get()
        if (now.accountId !== accountId || now.filter !== filter || now.search !== search) return
        const merged = reset ? page : [...chats, ...page.filter((p) => !chats.some((c) => c.jid === p.jid))]
        set({ chats: merged, hasMore: page.length === PAGE })
      } finally {
        set({ loadingChats: false })
      }
    },

    select: async (jid) => {
      const { accountId } = get()
      set({ selected: jid, replyTo: null, editing: null })
      if (get().active) setFocus(jid && accountId ? { accountId, jid } : null)
      if (!jid || !accountId) return
      if (!withList) {
        // Sem a lista: busca só os dados desta conversa (nome, grupo, só leitura)
        const found = await deps.invoke('chats:get', { accountId, jids: [jid] }).catch(() => [] as ChatItem[])
        if (get().accountId === accountId && get().selected === jid) set({ chats: found })
      }
      if (!get().messages[jid]) {
        const msgs = await deps.invoke('messages:list', { accountId, jid, before: null, limit: MSG_PAGE })
        if (get().accountId !== accountId) return // trocou de conta enquanto carregava
        set((s) => ({
          messages: { ...s.messages, [jid]: mergeMsgs(msgs, s.messages[jid] ?? []) },
          hasOlder: { ...s.hasOlder, [jid]: msgs.length === MSG_PAGE }
        }))
      }
      const c = get().chats.find((x) => x.jid === jid)
      if (!c || c.unread > 0) void deps.invoke('chats:read', { accountId, jid }).catch(() => undefined)
    },

    loadOlder: async (jid) => {
      const { accountId, messages, hasOlder } = get()
      const cur = messages[jid]
      // Só busca antigas depois que a primeira página chegou, e uma busca por vez:
      // sem isso, a página mais recente era somada de novo e as mensagens apareciam em dobro.
      if (!accountId || !cur?.length || hasOlder[jid] === false || loadingOlder.has(jid)) return false
      loadingOlder.add(jid)
      try {
        const oldest = cur[0]
        const older = await deps.invoke('messages:list', {
          accountId,
          jid,
          before: oldest.ts,
          beforeRid: oldest.rid ?? null,
          limit: MSG_PAGE
        })
        if (get().accountId !== accountId) return false // trocou de conta enquanto carregava
        const known = new Set((get().messages[jid] ?? []).map((m) => m.id))
        const fresh = older.filter((m) => !known.has(m.id))
        set((s) => ({
          messages: { ...s.messages, [jid]: mergeMsgs(older, s.messages[jid] ?? []) },
          hasOlder: { ...s.hasOlder, [jid]: older.length === MSG_PAGE }
        }))
        return fresh.length > 0
      } finally {
        loadingOlder.delete(jid)
      }
    },

    setReply: (replyTo) => set({ replyTo, editing: null }),
    setEditing: (editing) => set({ editing, replyTo: null }),

    applyChats: (accountId, incoming) => {
      const st = get()
      if (st.accountId !== accountId) return
      if (!withList) {
        // Só interessa a conversa aberta
        const mine = incoming.find((c) => c.jid === st.selected)
        if (mine) set({ chats: [mine] })
        return
      }
      const map = new Map(st.chats.map((c) => [c.jid, c]))
      for (const c of incoming) {
        if (matches(c, st.filter, st.search)) map.set(c.jid, c)
        else map.delete(c.jid)
      }
      set({ chats: sortChats([...map.values()]) })
    },

    applyMessages: (accountId, chatJid, msgs) => {
      const st = get()
      if (st.accountId !== accountId || !st.messages[chatJid]) return
      set({ messages: { ...st.messages, [chatJid]: mergeMsgs(st.messages[chatJid], msgs) } })
      if (st.selected === chatJid && st.active && msgs.some((m) => !m.fromMe) && deps.hasFocus()) {
        void deps.invoke('chats:read', { accountId, jid: chatJid }).catch(() => undefined)
      }
    },

    reloadMessages: async (accountId, chatJid) => {
      if (get().accountId !== accountId || !get().messages[chatJid]) return
      const msgs = await deps.invoke('messages:list', { accountId, jid: chatJid, before: null, limit: MSG_PAGE })
      if (get().accountId !== accountId) return
      set((s) => ({ messages: { ...s.messages, [chatJid]: msgs } }))
    },

    applyMerged: (accountId, from, to) => {
      const st = get()
      if (st.accountId !== accountId) return
      set({ chats: st.chats.filter((c) => c.jid !== from) })
      if (st.selected === from) void get().select(to)
    },

    applySync: (s) => {
      if (withList && get().accountId === s.accountId) set({ sync: s })
    }
  }))
}

// ---------- Eventos em tempo real ----------

export type ChatEvent =
  | { type: 'chats:changed'; accountId: string; chats: ChatItem[] }
  | { type: 'messages:changed'; accountId: string; chatJid: string; messages: MessageItem[] }
  | { type: 'messages:reload'; accountId: string; chatJid: string }
  | { type: 'chats:merged'; accountId: string; from: string; to: string }
  | { type: 'sync:changed'; state: SyncState }

/** Instâncias vivas que recebem os eventos. O app escuta o processo principal uma vez só e repassa a todas. */
const live = new Set<ChatStoreApi>()

/** Passa a entregar os eventos a esta instância. Devolve a função que desliga (chamar ao fechar a janela). */
export function registerChatStore(store: ChatStoreApi): () => void {
  live.add(store)
  return () => {
    live.delete(store)
  }
}

export function liveChatStores(): number {
  return live.size
}

export function applyChatEvent(store: ChatStoreApi, ev: ChatEvent): void {
  const st = store.getState()
  switch (ev.type) {
    case 'chats:changed':
      return st.applyChats(ev.accountId, ev.chats)
    case 'messages:changed':
      return st.applyMessages(ev.accountId, ev.chatJid, ev.messages)
    case 'messages:reload':
      return void st.reloadMessages(ev.accountId, ev.chatJid)
    case 'chats:merged':
      return st.applyMerged(ev.accountId, ev.from, ev.to)
    case 'sync:changed':
      return st.applySync(ev.state)
  }
}

/** Entrega um evento a todas as instâncias vivas. Cada uma junta por id, então nada aparece em dobro. */
export function dispatchChatEvent(ev: ChatEvent): void {
  for (const s of live) applyChatEvent(s, ev)
}
