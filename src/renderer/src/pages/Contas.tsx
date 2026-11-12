import { useState } from 'react'
import { History, KeyRound, LogOut, Plug, PlugZap, QrCode, Trash2, Smartphone, Plus } from 'lucide-react'
import type { Account, AccountState } from '@shared/types'
import { useApp } from '../lib/store'
import { Button, Field, Input, Notice, PageHeader, Switch } from '../components/ui'
import { StatusPill } from '../components/StatusPill'
import { formatPhone } from '../lib/format'
import { AccountMark } from '../components/AccountMark'
import { cn } from '../lib/cn'

const COLORS = ['#D9481F', '#2563EB', '#0F8A5F', '#9333EA', '#C2410C', '#0E7490', '#BE185D', '#4D5562']

function NewAccount({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { reloadAccounts, setActive } = useApp()
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const acc = await window.api.invoke('accounts:create', { name: name.trim(), color })
      await reloadAccounts()
      setActive(acc.id)
      await window.api.invoke('accounts:connect', { id: acc.id })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-panel p-5 shadow-card">
      <h2 className="text-[15px] font-semibold">Nova conta de WhatsApp</h2>
      <p className="mt-0.5 text-[13px] text-ink-2">Uma conta por número. Ex.: “Ótica Centro”, “Ótica Shopping”.</p>
      <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4">
        <Field label="Nome da conta" htmlFor="acc-name" error={error}>
          <Input
            id="acc-name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ótica Centro"
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Cor</legend>
          <div className="flex h-9 items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn(
                  'size-6 rounded-md transition-transform duration-150',
                  color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel' : 'hover:scale-110'
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
          Criar e conectar
        </Button>
      </div>
    </form>
  )
}

function ConnectPanel({ account, state }: { account: Account; state: AccountState }): React.JSX.Element {
  const [mode, setMode] = useState<'qr' | 'code'>('qr')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestCode(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.api.invoke('accounts:connect', { id: account.id, pairingPhone: phone })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 grid grid-cols-[auto_1fr] gap-6 rounded-lg bg-sunken p-5">
      <div className="grid size-[220px] place-items-center rounded-lg border border-line bg-white p-2.5">
        {mode === 'qr' && state.qr ? (
          <img src={state.qr} alt="QR Code para conectar o WhatsApp" className="size-full" />
        ) : mode === 'code' && state.pairingCode ? (
          <div className="text-center">
            <div
              className="tabular font-mono text-[28px] font-semibold tracking-[0.18em] text-neutral-900"
              data-selectable
            >
              {state.pairingCode.slice(0, 4)}-{state.pairingCode.slice(4)}
            </div>
            <div className="mt-1 text-[12px] text-neutral-500">Código de pareamento</div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-[13px] text-neutral-500">
            <QrCode className="size-8 animate-pulse" />
            Gerando…
          </div>
        )}
      </div>
      <div className="flex flex-col">
        <div className="flex gap-1 self-start rounded-lg border border-line bg-panel p-0.5" role="tablist">
          {(['qr', 'code'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'h-7 rounded-md px-3 text-[13px] text-ink-2',
                mode === m && 'bg-sunken font-medium text-ink'
              )}
            >
              {m === 'qr' ? 'QR Code' : 'Código pelo número'}
            </button>
          ))}
        </div>
        {mode === 'qr' ? (
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[14px] text-ink-2">
            <li>Abra o WhatsApp no celular da loja.</li>
            <li>
              Toque em <b className="text-ink">Mais opções</b> ou <b className="text-ink">Configurações</b> e depois em{' '}
              <b className="text-ink">Aparelhos conectados</b>.
            </li>
            <li>
              Toque em <b className="text-ink">Conectar um aparelho</b> e aponte a câmera para o código.
            </li>
          </ol>
        ) : (
          <div className="mt-4 flex max-w-[360px] flex-col gap-3">
            <Field label="Número do WhatsApp (com DDD)" htmlFor="pair-phone" error={error}>
              <Input
                id="pair-phone"
                inputMode="tel"
                placeholder="(11) 98765-4321"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              className="self-start"
              loading={busy}
              disabled={phone.replace(/\D/g, '').length < 10}
              onClick={() => void requestCode()}
            >
              <KeyRound className="size-4" /> Gerar código
            </Button>
            <p className="text-[13px] text-ink-3">
              No celular: Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function AccountRow({ account }: { account: Account }): React.JSX.Element {
  const { states, reloadAccounts } = useApp()
  const state = states[account.id] ?? { accountId: account.id, status: 'disconnected' as const }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(key)
    try {
      await fn()
      await reloadAccounts()
    } finally {
      setBusy(null)
    }
  }

  const connected = state.status === 'connected'
  const working = state.status === 'connecting' || state.status === 'qr'

  return (
    <li className="rounded-xl border border-line bg-panel p-5 shadow-card">
      <div className="flex items-center gap-4">
        <AccountMark account={account} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h3 className="truncate text-[15px] font-semibold">{account.name}</h3>
            <StatusPill status={state.status} />
          </div>
          <p className="tabular mt-0.5 text-[13px] text-ink-2">
            {state.phone || account.phone ? formatPhone(state.phone ?? account.phone) : 'Nenhum número vinculado'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Conectar ao abrir
          <Switch
            label="Conectar ao abrir o app"
            disabled={account.licenseBlocked}
            checked={account.autoConnect}
            onChange={(v) =>
              void run('auto', () => window.api.invoke('accounts:update', { id: account.id, autoConnect: v }))
            }
          />
        </label>
        <div className="flex items-center gap-2">
          {connected || working ? (
            <Button
              size="sm"
              loading={busy === 'disc'}
              onClick={() => void run('disc', () => window.api.invoke('accounts:disconnect', { id: account.id }))}
            >
              <Plug className="size-4" /> {working ? 'Cancelar' : 'Desconectar'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={account.licenseBlocked}
              loading={busy === 'conn'}
              onClick={() => void run('conn', () => window.api.invoke('accounts:connect', { id: account.id }))}
            >
              <PlugZap className="size-4" /> Conectar
            </Button>
          )}
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              title="Desvincula e vincula de novo para receber o histórico completo de conversas"
              loading={busy === 'hist'}
              onClick={() => {
                if (
                  confirm(
                    'Para trazer o histórico completo, o WhatsApp precisa ser vinculado de novo. O app vai desconectar e mostrar um novo QR Code. As conversas já salvas são mantidas. Continuar?'
                  )
                )
                  void run('hist', async () => {
                    await window.api.invoke('accounts:logout', { id: account.id })
                    await window.api.invoke('accounts:connect', { id: account.id })
                  })
              }}
            >
              <History className="size-4" /> Reimportar histórico
            </Button>
          )}
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              title="Desvincula este computador do WhatsApp"
              loading={busy === 'out'}
              onClick={() => void run('out', () => window.api.invoke('accounts:logout', { id: account.id }))}
            >
              <LogOut className="size-4" /> Sair
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Excluir ${account.name}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {account.licenseBlocked && (
        <div className="mt-3">
          <Notice tone="warn">
            Esta conta excede a quantidade de números da licença ativa. Os dados foram preservados. Amplie a licença ou
            ajuste os cadastros para voltar a usar.
          </Notice>
        </div>
      )}
      {state.error && state.status !== 'connected' && (
        <div className="mt-3">
          <Notice tone={state.status === 'connecting' ? 'info' : 'warn'}>{state.error}</Notice>
        </div>
      )}

      {state.status === 'qr' && <ConnectPanel account={account} state={state} />}

      {confirmDelete && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-bad-soft px-4 py-3">
          <p className="text-[13.5px]">
            Excluir <b>{account.name}</b>? O WhatsApp será desvinculado deste computador e os dados desta conta serão
            apagados.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Manter
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={busy === 'del'}
              onClick={() => void run('del', () => window.api.invoke('accounts:delete', { id: account.id }))}
            >
              Excluir conta
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

export function Contas(): React.JSX.Element {
  const { accounts } = useApp()
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <PageHeader
        title="Contas de WhatsApp"
        description="Cada conta é um número conectado. Você pode ter várias lojas ou negócios no mesmo app."
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Nova conta
            </Button>
          )
        }
      />
      {adding && (
        <div className="mb-5">
          <NewAccount onDone={() => setAdding(false)} />
        </div>
      )}
      {accounts.length === 0 && !adding ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
          <Smartphone className="size-9 text-ink-3" strokeWidth={1.5} />
          <h2 className="mt-3 text-[16px] font-semibold">Conecte o primeiro número</h2>
          <p className="mt-1 max-w-[46ch] text-[14px] text-ink-2">
            Crie uma conta e leia o QR Code com o celular da loja. A sessão fica guardada e criptografada neste
            computador.
          </p>
          <Button variant="primary" className="mt-5" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Nova conta
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </ul>
      )}
    </div>
  )
}
