import { useEffect } from 'react'
import { create } from 'zustand'

/** Cache das fotos de perfil, com pedidos agrupados (vários avatares na tela = uma chamada). */
interface AvatarState {
  byKey: Record<string, string | null> // `${accountId}|${jid}` → url ou null (sem foto)
  set: (accountId: string, map: Record<string, string | null>) => void
}

export const useAvatars = create<AvatarState>((set) => ({
  byKey: {},
  set: (accountId, map) =>
    set((s) => {
      const next = { ...s.byKey }
      for (const [jid, url] of Object.entries(map)) next[`${accountId}|${jid}`] = url
      return { byKey: next }
    })
}))

const pending = new Map<string, Set<string>>()
const asked = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function request(accountId: string, jid: string): void {
  const k = `${accountId}|${jid}`
  if (asked.has(k)) return
  asked.add(k)
  let set = pending.get(accountId)
  if (!set) pending.set(accountId, (set = new Set()))
  set.add(jid)
  if (!timer)
    timer = setTimeout(() => {
      timer = null
      for (const [acc, jids] of pending) {
        const list = [...jids]
        for (let i = 0; i < list.length; i += 200) {
          void window.api
            .invoke('avatars:get', { accountId: acc, jids: list.slice(i, i + 200) })
            .then((m) => useAvatars.getState().set(acc, m))
            .catch(() => undefined)
        }
      }
      pending.clear()
    }, 60)
}

const VALID = /^[\w.:-]+@(s\.whatsapp\.net|lid|g\.us)$/

export function useAvatar(accountId: string | null | undefined, jid: string | null | undefined): string | null {
  const url = useAvatars((s) => (accountId && jid ? (s.byKey[`${accountId}|${jid}`] ?? null) : null))
  useEffect(() => {
    if (accountId && jid && VALID.test(jid)) request(accountId, jid)
  }, [accountId, jid])
  return url
}

export function subscribeAvatarEvents(): () => void {
  return window.api.on('avatars:changed', ({ accountId, avatars }) => useAvatars.getState().set(accountId, avatars))
}
