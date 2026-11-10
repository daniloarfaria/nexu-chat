import { create } from 'zustand'
import type { Account, AccountState, CampaignAudience, WaVersionInfo } from '@shared/types'

export type PageId =
  | 'conversas'
  | 'contatos'
  | 'campanhas'
  | 'grupos'
  | 'automacoes'
  | 'lembretes'
  | 'status'
  | 'painel'
  | 'funis'
  | 'leads'
  | 'ia'
  | 'contas'
  | 'configuracoes'

export type SettingsTab =
  'visao' | 'licenca' | 'backup' | 'modulos' | 'protecao' | 'transcricao' | 'integracoes' | 'sistema'

export type Theme = 'light' | 'dark' | 'system'

interface AppState {
  page: PageId
  accounts: Account[]
  states: Record<string, AccountState>
  activeAccountId: string | null
  waVersion: WaVersionInfo | null
  theme: Theme
  loaded: boolean
  /** Campanha pré-preenchida (ex.: disparo por coluna do funil); a página Campanhas consome e limpa */
  campaignDraft: { name: string; audience: CampaignAudience } | null
  /** Funil a abrir na página Funis */
  openPipelineId: number | null
  /** Aba das Configurações pedida por quem navegou (a página consome e limpa) */
  settingsTab: SettingsTab | null
  go: (p: PageId) => void
  goSettings: (tab: SettingsTab) => void
  draftCampaign: (d: { name: string; audience: CampaignAudience }) => void
  openPipeline: (id: number) => void
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
  page: 'conversas',
  accounts: [],
  states: {},
  activeAccountId: null,
  waVersion: null,
  theme: readTheme(),
  loaded: false,
  campaignDraft: null,
  openPipelineId: null,
  settingsTab: null,

  go: (page) => set({ page, settingsTab: null }),
  goSettings: (settingsTab) => set({ settingsTab, page: 'configuracoes' }),
  draftCampaign: (campaignDraft) => set({ campaignDraft, page: 'campanhas' }),
  openPipeline: (openPipelineId) => set({ openPipelineId, page: 'funis' }),
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
