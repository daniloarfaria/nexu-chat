import { KeyRound } from 'lucide-react'
import { useApp } from '../lib/store'
import { useLicense } from '../lib/useLicense'
import { Button } from './ui'

/** Aviso no topo quando falta licença, ela está vencendo ou venceu. */
export function LicenseBanner(): React.JSX.Element | null {
  const [st] = useLicense()
  const goSettings = useApp((s) => s.goSettings)
  if (!st || st.state === 'dev') return null
  const soon = st.state === 'active' && st.daysLeft != null && st.daysLeft <= 7
  if (st.state === 'active' && !soon) return null
  const bad = st.state === 'expired' || st.state === 'invalid' || st.state === 'none'
  return (
    <div
      className={`flex items-center gap-3 border-b border-line px-6 py-2.5 text-[13.5px] ${bad ? 'bg-bad-soft' : 'bg-warn-soft'}`}
      role="status"
    >
      <KeyRound className="size-4 shrink-0" />
      <p className="flex-1">{st.message}</p>
      <Button size="sm" onClick={() => goSettings('licenca')}>
        {st.state === 'none' ? 'Ativar licença' : 'Ver licença'}
      </Button>
    </div>
  )
}
