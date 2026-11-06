import { useEffect } from 'react'
import { useActiveAccount, useApp } from './lib/store'
import { homePage } from './lib/home'
import { Sidebar } from './components/Sidebar'
import { UpdateBanner } from './components/UpdateBanner'
import { LicenseBanner } from './components/LicenseBanner'
import { Contas } from './pages/Contas'
import { Configuracoes } from './pages/Configuracoes'
import { Conversas } from './pages/Conversas'
import { Contatos } from './pages/Contatos'
import { Campanhas } from './pages/Campanhas'
import { Automacoes } from './pages/Automacoes'
import { Grupos } from './pages/Grupos'
import { Lembretes } from './pages/Lembretes'
import { Status } from './pages/Status'
import { Vendas } from './pages/Vendas'
import { IA } from './pages/IA'
import { Funis } from './pages/Funis'
import { subscribeChatEvents, useChats } from './lib/chatStore'
import { subscribeAvatarEvents } from './lib/avatars'
import { Novidades } from './components/Novidades'

function Page(): React.JSX.Element {
  const page = useApp((s) => s.page)
  switch (page) {
    case 'contas':
      return <Contas />
    case 'configuracoes':
      return <Configuracoes />
    case 'conversas':
      return <Conversas />
    case 'contatos':
      return <Contatos />
    case 'campanhas':
      return <Campanhas />
    case 'automacoes':
      return <Automacoes />
    case 'grupos':
      return <Grupos />
    case 'lembretes':
      return <Lembretes />
    case 'status':
      return <Status />
    case 'vendas':
      return <Vendas />
    case 'ia':
      return <IA />
    case 'funis':
      return <Funis />
  }
}

export default function App(): React.JSX.Element {
  const { init, loaded, page, settingsTab } = useApp()
  const active = useActiveAccount()
  const conversasLiberado = active?.modules.conversas ?? true

  // Tela inicial é Conversas; se o módulo ou a licença a desligou, cai numa página permitida
  useEffect(() => {
    if (loaded && page === 'conversas' && !conversasLiberado) useApp.getState().go(homePage(active?.modules))
  }, [loaded, page, conversasLiberado, active?.modules])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    void init().then((c) => (cleanup = c))
    const offChats = subscribeChatEvents()
    const offAvatars = subscribeAvatarEvents()
    // Licença mudou (login, renovação, fim): os módulos liberados mudam junto
    const offLicense = window.api.on('license:changed', () => void useApp.getState().reloadAccounts())
    const offNav = window.api.on('nav:open-chat', async ({ accountId, jid }) => {
      useApp.getState().setActive(accountId)
      useApp.getState().go('conversas')
      await useChats.getState().setAccount(accountId)
      await useChats.getState().select(jid)
    })
    return () => {
      cleanup?.()
      offChats()
      offAvatars()
      offNav()
      offLicense()
    }
  }, [init])

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-3 shrink-0" />
        <UpdateBanner />
        <LicenseBanner />
        {loaded && <Novidades />}
        {page === 'conversas' || page === 'funis' ? (
          <main className="min-h-0 flex-1 border-t border-line">{loaded && <Page />}</main>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div key={`${page}:${settingsTab ?? ''}`} className="mx-auto w-full max-w-[1080px] px-8 pt-6 pb-12">
              {loaded ? <Page /> : <div className="h-40 animate-pulse rounded-xl bg-sunken" />}
            </div>
          </main>
        )}
      </div>
    </div>
  )
}
