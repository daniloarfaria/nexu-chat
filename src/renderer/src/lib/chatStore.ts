import { create } from 'zustand'
import type { ChatFilter, ChatItem, MessageItem, SyncState } from '@shared/types'

const PAGE = 80
const MSG_PAGE = 60

interface ChatState {
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
}

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

let searchTimer: ReturnType<typeof setTimeout> | null = null
const loadingOlder = new Set<string>()

/** Junta listas sem repetir mensagem (o mesmo id fica uma vez só, com a versão mais nova) e ordena. */
function mergeMsgs(...lists: MessageItem[][]): MessageItem[] {
  const byId = new Map<string, MessageItem>()
  for (const l of lists) for (const m of l) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.ts - b.ts || (a.rid ?? 0) - (b.rid ?? 0))
}

export const useChats = create<ChatState>((set, get) => ({
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
    window.ui.setFocusedChat(null)
    if (!id) return
    const [sync] = await Promise.all([window.api.invoke('sync:state', { accountId: id }), get().loadChats(true)])
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
    if (!accountId) return
    set({ loadingChats: true })
    try {
      const offset = reset ? 0 : chats.length
      const page = await window.api.invoke('chats:list', { accountId, filter, search, limit: PAGE, offset })
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
    window.ui.setFocusedChat(jid && accountId ? { accountId, jid } : null)
    if (!jid || !accountId) return
    if (!get().messages[jid]) {
      const msgs = await window.api.invoke('messages:list', { accountId, jid, before: null, limit: MSG_PAGE })
      if (get().accountId !== accountId) return // trocou de conta enquanto carregava
      set((s) => ({
        messages: { ...s.messages, [jid]: mergeMsgs(msgs, s.messages[jid] ?? []) },
        hasOlder: { ...s.hasOlder, [jid]: msgs.length === MSG_PAGE }
      }))
    }
    const c = get().chats.find((x) => x.jid === jid)
    if (!c || c.unread > 0) void window.api.invoke('chats:read', { accountId, jid }).catch(() => undefined)
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
      const older = await window.api.invoke('messages:list', {
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
    if (st.selected === chatJid && msgs.some((m) => !m.fromMe) && document.hasFocus()) {
      void window.api.invoke('chats:read', { accountId, jid: chatJid }).catch(() => undefined)
    }
  },

  reloadMessages: async (accountId, chatJid) => {
    if (get().accountId !== accountId || !get().messages[chatJid]) return
    const msgs = await window.api.invoke('messages:list', { accountId, jid: chatJid, before: null, limit: MSG_PAGE })
    if (get().accountId !== accountId) return
    set((s) => ({ messages: { ...s.messages, [chatJid]: msgs } }))
  }
}))

/** Liga os eventos do processo principal ao estado das conversas. */
export function subscribeChatEvents(): () => void {
  const offs = [
    window.api.on('chats:changed', ({ accountId, chats }) => useChats.getState().applyChats(accountId, chats)),
    window.api.on('messages:changed', ({ accountId, chatJid, messages }) =>
      useChats.getState().applyMessages(accountId, chatJid, messages)
    ),
    window.api.on(
      'messages:reload',
      ({ accountId, chatJid }) => void useChats.getState().reloadMessages(accountId, chatJid)
    ),
    window.api.on('chats:merged', ({ accountId, from, to }) => {
      const st = useChats.getState()
      if (st.accountId !== accountId) return
      useChats.setState({ chats: st.chats.filter((c) => c.jid !== from) })
      if (st.selected === from) void st.select(to)
    }),
    window.api.on('sync:changed', (s) => {
      if (useChats.getState().accountId === s.accountId) useChats.setState({ sync: s })
    })
  ]
  return () => offs.forEach((o) => o())
}
