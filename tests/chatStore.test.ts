import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, MessageItem } from '@shared/types'
import {
  createChatStoreCore,
  dispatchChatEvent,
  liveChatStores,
  mergeMsgs,
  registerChatStore,
  type ChatDeps
} from '../src/renderer/src/lib/chatStoreCore'

const ACC = 'conta1'
const A = '5511999990001@s.whatsapp.net'
const B = '5511999990002@s.whatsapp.net'

function msg(id: string, ts: number, extra: Partial<MessageItem> = {}): MessageItem {
  return { id, ts, fromMe: false, text: id, type: 'text', ...extra } as MessageItem
}
function chat(jid: string, extra: Partial<ChatItem> = {}): ChatItem {
  return { jid, name: jid, lastTs: 1, unread: 0, archived: false, pinned: false, isGroup: false, ...extra } as ChatItem
}

/** Simula o processo principal: cada conversa tem suas mensagens salvas. */
function fakeDeps(db: Record<string, MessageItem[]>, chats: ChatItem[] = []): ChatDeps & { focus: unknown[] } {
  const focus: unknown[] = []
  const invoke = vi.fn(async (channel: string, args: Record<string, unknown>) => {
    switch (channel) {
      case 'messages:list': {
        const all = db[args.jid as string] ?? []
        const before = args.before as number | null
        const list = before == null ? all : all.filter((m) => m.ts < before)
        return list.slice(-(args.limit as number))
      }
      case 'chats:list':
        return chats
      case 'chats:get':
        return chats.filter((c) => (args.jids as string[]).includes(c.jid))
      case 'sync:state':
        return null
      default:
        return undefined
    }
  })
  return {
    invoke: invoke as unknown as ChatDeps['invoke'],
    setFocusedChat: (v) => focus.push(v),
    hasFocus: () => false,
    focus
  }
}

const offs: Array<() => void> = []
afterEach(() => {
  while (offs.length) offs.pop()!()
})

describe('mergeMsgs', () => {
  it('não repete a mesma mensagem e fica com a versão mais nova', () => {
    const r = mergeMsgs([msg('a', 1), msg('b', 2)], [msg('b', 2, { text: 'editada' }), msg('c', 3)])
    expect(r.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(r[1].text).toBe('editada')
  })
})

describe('duas instâncias de conversa', () => {
  it('a janela do funil não muda a conversa selecionada da tela principal', async () => {
    const deps = fakeDeps({ [A]: [msg('a1', 1)], [B]: [msg('b1', 1)] }, [chat(A), chat(B)])
    const main = createChatStoreCore(deps)
    const win = createChatStoreCore(deps, { list: false })
    await main.getState().setAccount(ACC)
    await main.getState().select(A)
    await win.getState().setAccount(ACC)
    await win.getState().select(B)
    expect(main.getState().selected).toBe(A)
    expect(win.getState().selected).toBe(B)
    // A janela não busca a lista inteira, só a conversa aberta
    expect(win.getState().chats.map((c) => c.jid)).toEqual([B])
  })

  it('mensagem nova chega às duas instâncias, sem duplicar', async () => {
    const deps = fakeDeps({ [A]: [msg('a1', 1)] }, [chat(A)])
    const main = createChatStoreCore(deps)
    const win = createChatStoreCore(deps, { list: false })
    offs.push(registerChatStore(main), registerChatStore(win))
    for (const s of [main, win]) {
      await s.getState().setAccount(ACC)
      await s.getState().select(A)
    }
    const nova = msg('a2', 2)
    dispatchChatEvent({ type: 'messages:changed', accountId: ACC, chatJid: A, messages: [nova] })
    // O mesmo evento repetido (ex.: status de entrega) não pode criar outra bolha
    dispatchChatEvent({ type: 'messages:changed', accountId: ACC, chatJid: A, messages: [{ ...nova, status: 3 }] })
    for (const s of [main, win]) {
      expect(s.getState().messages[A].map((m) => m.id)).toEqual(['a1', 'a2'])
      expect(s.getState().messages[A][1].status).toBe(3)
    }
  })

  it('edição e apagamento atualizam a mensagem no lugar nas duas', async () => {
    const deps = fakeDeps({ [A]: [msg('a1', 1), msg('a2', 2)] }, [chat(A)])
    const main = createChatStoreCore(deps)
    const win = createChatStoreCore(deps, { list: false })
    offs.push(registerChatStore(main), registerChatStore(win))
    for (const s of [main, win]) {
      await s.getState().setAccount(ACC)
      await s.getState().select(A)
    }
    dispatchChatEvent({
      type: 'messages:changed',
      accountId: ACC,
      chatJid: A,
      messages: [msg('a1', 1, { text: 'novo texto' }), msg('a2', 2, { deleted: true })]
    })
    for (const s of [main, win]) {
      const l = s.getState().messages[A]
      expect(l).toHaveLength(2)
      expect(l[0].text).toBe('novo texto')
      expect(l[1].deleted).toBe(true)
    }
  })

  it('a janela fechada deixa de receber eventos (sem vazamento)', async () => {
    const deps = fakeDeps({ [A]: [msg('a1', 1)] }, [chat(A)])
    const win = createChatStoreCore(deps, { list: false })
    const before = liveChatStores()
    const off = registerChatStore(win)
    expect(liveChatStores()).toBe(before + 1)
    await win.getState().setAccount(ACC)
    await win.getState().select(A)
    off()
    expect(liveChatStores()).toBe(before)
    dispatchChatEvent({ type: 'messages:changed', accountId: ACC, chatJid: A, messages: [msg('a2', 2)] })
    expect(win.getState().messages[A].map((m) => m.id)).toEqual(['a1'])
  })

  it('mudança de outra conversa não troca a conversa da janela', async () => {
    const deps = fakeDeps({ [A]: [msg('a1', 1)] }, [chat(A)])
    const win = createChatStoreCore(deps, { list: false })
    offs.push(registerChatStore(win))
    await win.getState().setAccount(ACC)
    await win.getState().select(A)
    dispatchChatEvent({ type: 'chats:changed', accountId: ACC, chats: [chat(B, { name: 'Outro' })] })
    expect(win.getState().chats.map((c) => c.jid)).toEqual([A])
    dispatchChatEvent({ type: 'chats:changed', accountId: ACC, chats: [chat(A, { name: 'Maria' })] })
    expect(win.getState().chats[0].name).toBe('Maria')
  })

  it('carregar antigas em uma instância não afeta a outra e não duplica', async () => {
    const all = Array.from({ length: 70 }, (_, i) => msg(`m${i}`, i + 1))
    const deps = fakeDeps({ [A]: all }, [chat(A)])
    const main = createChatStoreCore(deps)
    const win = createChatStoreCore(deps, { list: false })
    for (const s of [main, win]) {
      await s.getState().setAccount(ACC)
      await s.getState().select(A)
    }
    // Duas buscas seguidas na janela: só uma roda por vez
    const [r1, r2] = await Promise.all([win.getState().loadOlder(A), win.getState().loadOlder(A)])
    expect([r1, r2]).toEqual([true, false])
    expect(win.getState().messages[A]).toHaveLength(70)
    expect(new Set(win.getState().messages[A].map((m) => m.id)).size).toBe(70)
    expect(main.getState().messages[A]).toHaveLength(60)
  })

  it('conversa sem mensagens abre vazia e pronta para a primeira', async () => {
    const deps = fakeDeps({}, [])
    const win = createChatStoreCore(deps, { list: false })
    await win.getState().setAccount(ACC)
    await win.getState().select(A)
    expect(win.getState().messages[A]).toEqual([])
    expect(win.getState().selected).toBe(A)
  })

  it('fechar a janela avisa que nenhuma conversa está na tela', async () => {
    const deps = fakeDeps({ [A]: [] }, [])
    const win = createChatStoreCore(deps, { list: false })
    await win.getState().setAccount(ACC)
    await win.getState().select(A)
    await win.getState().select(null)
    expect(deps.focus.at(-1)).toBeNull()
  })
})
