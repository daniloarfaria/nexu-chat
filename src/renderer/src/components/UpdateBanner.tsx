import { useState } from 'react'
import { useUpdateStatus } from '../lib/useUpdateStatus'
import { ArrowDownToLine, RotateCw, X } from 'lucide-react'
import { Button } from './ui'

/** Faixa no topo quando há versão nova do app. */
export function UpdateBanner(): React.JSX.Element | null {
  const s = useUpdateStatus()
  const [hidden, setHidden] = useState<string | null>(null)
  const isMac = navigator.userAgent.includes('Mac')

  if (!s || !s.version || hidden === s.version) return null
  if (s.state !== 'available' && s.state !== 'downloading' && s.state !== 'ready') return null

  return (
    <div
      className="flex items-center gap-3 border-b border-line bg-accent-soft px-6 py-2.5 text-[13.5px]"
      role="status"
    >
      <ArrowDownToLine className="size-4 shrink-0 text-accent-ink" />
      <p className="flex-1">
        {s.state === 'ready' ? (
          <>
            A versão <b>{s.version}</b> está pronta. Reinicie para instalar.
          </>
        ) : s.state === 'downloading' ? (
          <>
            Baixando a versão <b>{s.version}</b>… <span className="tabular">{s.percent ?? 0}%</span>
          </>
        ) : (
          <>
            Nova versão disponível: <b>{s.version}</b> (você usa a {s.currentVersion}).
          </>
        )}
      </p>
      {s.state === 'available' && (
        <Button size="sm" variant="primary" onClick={() => void window.api.invoke('update:download')}>
          {isMac ? 'Baixar instalador' : 'Baixar atualização'}
        </Button>
      )}
      {s.state === 'ready' && (
        <Button size="sm" variant="primary" onClick={() => void window.api.invoke('update:install')}>
          <RotateCw className="size-4" /> Reiniciar e instalar
        </Button>
      )}
      {s.state !== 'downloading' && (
        <button
          aria-label="Lembrar depois"
          title="Lembrar depois"
          onClick={() => setHidden(s.version ?? null)}
          className="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-panel hover:text-ink"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
