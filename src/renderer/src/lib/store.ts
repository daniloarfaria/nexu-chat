import { create } from 'zustand'
import type { Account, AccountState, WaVersionInfo } from '@shared/types'

export type PageId =
  | 'inicio'
  | 'conversas'
  | 'contatos'
  | 'campanhas'
  | 'grupos'
  | 'automacoes'
  | 'lembretes'
  | 'vendas'
  | 'ia'
  | 'contas'
  | 'configuracoes'

export type Theme = 'light' | 'dark' | 'system'

interface AppState {
  page: PageId
  accounts: Account[]
  states: Record<string, AccountState>
  activeAccountId: string | null
  waVersion: WaVersionInfo | null
  theme: Theme
  loaded: boolean
  go: (p: PageId) => void
  setActive: (id: string | null) => void
  setTheme: (t: Theme) => void
  reloadAccounts: () => Promise<void>
  init: () => Promise<() => void>
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('theme')
    if (t === 'light' || t === 'dark' || t === 'system') return t
  } catch {
    /* ignora */
  }
  return 'system'
}

export function applyTheme(t: Theme): void {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export const useApp = create<AppState>((set, get) => ({
  page: 'inicio',
  accounts: [],
  states: {},
  activeAccountId: null,
  waVersion: null,
  theme: readTheme(),
  loaded: false,

  go: (page) => set({ page }),
  setActive: (activeAccountId) => {
    set({ activeAccountId })
    try {
      if (activeAccountId) localStorage.setItem('activeAccount', activeAccountId)
    } catch {
      /* ignora */
    }
  },
  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* ignora */
    }
  },

  reloadAccounts: async () => {
    const accounts = await window.api.invoke('accounts:list')
    let active = get().activeAccountId
    if (!active || !accounts.some((a) => a.id === active)) {
      let saved: string | null = null
      try {
        saved = localStorage.getItem('activeAccount')
      } catch {
        /* ignora */
      }
      active = accounts.find((a) => a.id === saved)?.id ?? accounts[0]?.id ?? null
    }
    set({ accounts, activeAccountId: active })
  },

  init: async () => {
    applyTheme(get().theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = (): void => applyTheme(get().theme)
    mq.addEventListener('change', onMq)

    const offState = window.api.on('account:state', (s) =>
      set((st) => ({ states: { ...st.states, [s.accountId]: s } }))
    )
    const offVersion = window.api.on('wa:version', (v) => set({ waVersion: v }))

    await get().reloadAccounts()
    const [states, waVersion] = await Promise.all([
      window.api.invoke('accounts:states'),
      window.api.invoke('wa:version')
    ])
    set({ states: Object.fromEntries(states.map((s) => [s.accountId, s])), waVersion, loaded: true })

    return () => {
      offState()
      offVersion()
      mq.removeEventListener('change', onMq)
    }
  }
}))

export function useActiveAccount(): Account | null {
  return useApp((s) => s.accounts.find((a) => a.id === s.activeAccountId) ?? null)
}
