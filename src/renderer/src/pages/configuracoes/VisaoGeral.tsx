import { ArrowRight, DatabaseBackup, ShieldCheck, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BackupSettings } from '@shared/types'
import { useApp, type SettingsTab } from '../../lib/store'
import { Button, Notice } from '../../components/ui'
import { StatusPill } from '../../components/StatusPill'
import { formatPhone, timeAgo } from '../../lib/format'

const SOURCE_LABEL = {
  wppconnect: 'WPPConnect',
  'whatsapp-web': 'WhatsApp Web',
  cache: 'última versão salva',
  padrao: 'versão padrão'
} as const

export function VisaoGeral({ setTab }: { setTab: (t: SettingsTab) => void }): React.JSX.Element {
  const { accounts, states, go, waVersion } = useApp()
  const [backup, setBackup] = useState<BackupSettings | null>(null)

  useEffect(() => {
    void window.api.invoke('backup:get').then(setBackup)
    return window.api.on('backup:done', setBackup)
  }, [])

  const backupOk = backup?.folder && backup.passwordSet && backup.frequency !== 'off'

  return (
    <div>
      {accounts.length === 0 ? (
        <div className="flex items-center gap-5 rounded-xl border border-line bg-panel p-6 shadow-card">
          <Smartphone className="size-8 shrink-0 text-accent" strokeWidth={1.6} />
          <div className="flex-1">
            <h2 className="text-[16px] font-semibold">Comece conectando o WhatsApp da loja</h2>
            <p className="mt-0.5 text-[14px] text-ink-2">Leva menos de um minuto: crie a conta e leia o QR Code.</p>
          </div>
          <Button variant="primary" onClick={() => go('contas')}>
            Conectar número <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-[1.4fr_1fr] gap-4">
          <section className="rounded-xl border border-line bg-panel shadow-card">
            <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[15px] font-semibold">Números conectados</h2>
              <Button size="sm" variant="ghost" onClick={() => go('contas')}>
                Gerenciar <ArrowRight className="size-3.5" />
              </Button>
            </header>
            <ul className="divide-y divide-line">
              {accounts.map((a) => {
                const st = states[a.id]
                return (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="size-2.5 rounded-sm" style={{ background: a.color }} aria-hidden />
                    <span className="flex-1 truncate text-[14px] font-medium">{a.name}</span>
                    <span className="tabular text-[13px] text-ink-2">{formatPhone(st?.phone ?? a.phone)}</span>
                    <StatusPill status={st?.status ?? 'disconnected'} />
                  </li>
                )
              })}
            </ul>
          </section>

          <div className="flex flex-col gap-4">
            <section className="rounded-xl border border-line bg-panel p-5 shadow-card">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="size-[18px] text-ink-3" />
                <h2 className="text-[15px] font-semibold">Backup</h2>
              </div>
              {backupOk ? (
                <p className="mt-2 text-[14px] text-ink-2">
                  Último backup: <span className="text-ink">{timeAgo(backup?.lastBackupAt)}</span>
                </p>
              ) : (
                <p className="mt-2 text-[14px] text-ink-2">
                  Ainda não configurado. Seus dados ficam só neste computador.
                </p>
              )}
              {backup?.lastError && (
                <div className="mt-3">
                  <Notice tone="bad">{backup.lastError}</Notice>
                </div>
              )}
              {!backupOk && (
                <Button size="sm" className="mt-3" onClick={() => setTab('backup')}>
                  Configurar backup
                </Button>
              )}
            </section>

            <section className="rounded-xl border border-line bg-panel p-5 shadow-card">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-[18px] text-ink-3" />
                <h2 className="text-[15px] font-semibold">WhatsApp Web</h2>
              </div>
              <p className="mt-2 text-[14px] text-ink-2">
                Versão{' '}
                <span className="tabular text-ink">{waVersion ? waVersion.version.join('.') : 'verificando…'}</span>
                {waVersion && <> · fonte: {SOURCE_LABEL[waVersion.source]}</>}
              </p>
              <p className="mt-1 text-[13px] text-ink-3">Atualizada sozinha a cada abertura e a cada 6 horas.</p>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
