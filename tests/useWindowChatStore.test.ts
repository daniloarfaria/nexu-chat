import { afterEach, describe, expect, it, vi } from 'vitest'

// Sem DOM nos testes: um mini executor de hooks (uma renderização, efeitos rodados na mão).
const effects: Array<() => void | (() => void)> = []
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>()
  return {
    ...actual,
    useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => undefined],
    useEffect: (fn: () => void | (() => void)) => void effects.push(fn)
  }
})

const A = '5511999990001@s.whatsapp.net'
const calls: string[] = []
const focus: unknown[] = []
vi.stubGlobal('window', {
  api: {
    invoke: async (channel: string, args: Record<string, unknown>) => {
      calls.push(`${channel}:${String(args?.jid ?? '')}`)
      if (channel === 'messages:list') return []
      if (channel === 'chats:get') return []
      return undefined
    },
    on: () => () => undefined
  },
  ui: { setFocusedChat: (v: unknown) => void focus.push(v) }
})
vi.stubGlobal('document', { hasFocus: () => true })

import { useWindowChatStore } from '../src/renderer/src/lib/chatStore'
import { liveChatStores } from '../src/renderer/src/lib/chatStoreCore'

afterEach(() => {
  effects.length = 0
  calls.length = 0
  focus.length = 0
})

describe('useWindowChatStore', () => {
  it('abre a conversa da janela, se registra para eventos e limpa ao fechar', async () => {
    const before = liveChatStores()
    const store = useWindowChatStore('conta1', A)
    const cleanups = effects.map((e) => e())
    await vi.waitFor(() => expect(store.getState().selected).toBe(A))
    expect(liveChatStores()).toBe(before + 1)
    expect(calls).toContain(`messages:list:${A}`)
    expect(focus.at(-1)).toEqual({ accountId: 'conta1', jid: A })

    cleanups.forEach((c) => typeof c === 'function' && c())
    expect(liveChatStores()).toBe(before)
    await vi.waitFor(() => expect(store.getState().selected).toBeNull())
    expect(focus.at(-1)).toBeNull()
  })

  it('sem conversa (contato sem jid ainda), não abre nada', async () => {
    const store = useWindowChatStore('conta1', null)
    effects.map((e) => e())
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getState().selected).toBeNull()
    expect(calls).toEqual([])
  })
})
