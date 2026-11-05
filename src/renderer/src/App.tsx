import { useEffect } from 'react'
import { useApp } from './lib/store'
import { Sidebar } from './components/Sidebar'
import { UpdateBanner } from './components/UpdateBanner'
import { Inicio } from './pages/Inicio'
import { Contas } from './pages/Contas'
import { Configuracoes } from './pages/Configuracoes'
import { EmBreve } from './pages/EmBreve'

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
      return (
        <EmBreve
          title="Conversas"
          phase={2}
          description="Todas as conversas do WhatsApp, com histórico sincronizado e envio de qualquer tipo de mídia."
        />
      )
    case 'contatos':
      return (
        <EmBreve
          title="Contatos"
          phase={3}
          description="Importação de planilhas, etiquetas, campos personalizados e lista de quem pediu para sair."
        />
      )
    case 'campanhas':
      return (
        <EmBreve
          title="Campanhas"
          phase={3}
          description="Disparos com variação de texto, agendamento, proteção anti-bloqueio e relatórios."
        />
      )
    case 'automacoes':
      return (
        <EmBreve
          title="Respostas automáticas"
          phase={4}
          description="Respostas por palavra-chave, fora do horário e opt-out automático."
        />
      )
    case 'grupos':
      return (
        <EmBreve
          title="Grupos"
          phase={5}
          description="Envio para grupos, extração de membros, criação de grupos e moderação."
        />
      )
    case 'lembretes':
      return (
        <EmBreve title="Lembretes" phase={6} description="Aniversário, pós-venda, óculos pronto e revisão anual." />
      )
    case 'vendas':
      return (
        <EmBreve title="Vendas" phase={7} description="Marque o que virou venda e veja o retorno de cada campanha." />
      )
    case 'ia':
      return (
        <EmBreve
          title="Assistente de IA"
          phase={8}
          description="Análise das conversas, playbook de vendas e mensagens personalizadas."
        />
      )
  }
}

export default function App(): React.JSX.Element {
  const { init, loaded, page } = useApp()

  useEffect(() => {
    let cleanup: (() => void) | undefined
    void init().then((c) => (cleanup = c))
    return () => cleanup?.()
  }, [init])

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag h-3 shrink-0" />
        <UpdateBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div key={page} className="mx-auto w-full max-w-[1080px] px-8 pt-6 pb-12">
            {loaded ? <Page /> : <div className="h-40 animate-pulse rounded-xl bg-sunken" />}
          </div>
        </main>
      </div>
    </div>
  )
}
