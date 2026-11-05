import { useEffect } from 'react'
import { useApp } from './lib/store'
import { Sidebar } from './components/Sidebar'
import { UpdateBanner } from './components/UpdateBanner'
import { LicenseBanner } from './components/LicenseBanner'
import { Inicio } from './pages/Inicio'
import { Contas } from './pages/Contas'
import { Configuracoes } from './pages/Configuracoes'
import { Conversas } from './pages/Conversas'
import { Contatos } from './pages/Contatos'
import { Campanhas } from './pages/Campanhas'
import { Automacoes } from './pages/Automacoes'
import { Grupos } from './pages/Grupos'
import { Lembretes } from './pages/Lembretes'
import { Vendas } from './pages/Vendas'
import { IA } from './pages/IA'
import { subscribeChatEvents, useChats } from './lib/chatStore'
import { subscribeAvatarEvents } from './lib/avatars'

function Page(): React.JSX.Element {
  const page = useApp((s) => s.page)
  switch (page) {
    case 'inicio':
      return <Inicio />
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
    case 'vendas':
      return <Vendas />
    case 'ia':
      return <IA />
  }
}

export default function App(): React.JSX.Element {
  const { init, loaded, page } = useApp()

  useEffect(() => {
    let cleanup: (() => void) | undefined
    void init().then((c) => (cleanup = c))
    const offChats = subscribeChatEvents()
    const offAvatars = subscribeAvatarEvents()
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
    }
  }, [init])

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-3 shrink-0" />
        <UpdateBanner />
        <LicenseBanner />
        {page === 'conversas' ? (
          <main className="min-h-0 flex-1 border-t border-line">{loaded && <Page />}</main>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div key={page} className="mx-auto w-full max-w-[1080px] px-8 pt-6 pb-12">
              {loaded ? <Page /> : <div className="h-40 animate-pulse rounded-xl bg-sunken" />}
            </div>
          </main>
        )}
      </div>
    </div>
  )
}
