import { useEffect, useState } from 'react'
import { FolderOpen, History, Lock, RefreshCw, Save } from 'lucide-react'
import {
  MODULE_INFO,
  MODULE_KEYS,
  type AppInfo,
  type BackupFile,
  type BackupSettings,
  type ModuleKey
} from '@shared/types'
import { useActiveAccount, useApp } from '../lib/store'
import { Button, Field, Input, Notice, PageHeader, Section, Switch } from '../components/ui'
import { useUpdateStatus } from '../lib/useUpdateStatus'
import { formatBytes, formatDateTime, timeAgo } from '../lib/format'
import { cn } from '../lib/cn'

type Tab = 'backup' | 'modulos' | 'sistema'

const FREQ: Array<{ id: BackupSettings['frequency']; label: string }> = [
  { id: 'daily', label: 'Todo dia' },
  { id: 'weekly', label: 'Toda semana' },
  { id: 'on_close', label: 'Ao fechar o app' },
  { id: 'off', label: 'Só manual' }
]

function BackupTab(): React.JSX.Element {
  const [s, setS] = useState<BackupSettings | null>(null)
  const [files, setFiles] = useState<BackupFile[]>([])
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [restore, setRestore] = useState<{ name?: string } | null>(null)
  const [restorePw, setRestorePw] = useState('')

  const refresh = async (): Promise<void> => {
    const [settings, list] = await Promise.all([window.api.invoke('backup:get'), window.api.invoke('backup:list')])
    setS(settings)
    setFiles(list)
  }
  useEffect(() => {
    let alive = true
    void Promise.all([window.api.invoke('backup:get'), window.api.invoke('backup:list')]).then(([settings, list]) => {
      if (!alive) return
      setS(settings)
      setFiles(list)
    })
    return () => {
      alive = false
    }
  }, [])

  async function act(key: string, fn: () => Promise<unknown>, ok?: string): Promise<void> {
    setBusy(key)
    setMsg(null)
    try {
      await fn()
      if (ok) setMsg({ tone: 'ok', text: ok })
      await refresh()
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  if (!s) return <div className="h-40 animate-pulse rounded-xl bg-sunken" />

  const pwMismatch = pw2.length > 0 && pw !== pw2

  return (
    <div className="flex flex-col gap-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Section
        title="Pasta de backup"
        description="Escolha uma pasta do Google Drive, OneDrive ou um HD externo para guardar cópias fora do computador."
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-9 min-w-0 flex-1 items-center rounded-lg border border-line bg-sunken px-3 text-[13.5px]',
              !s.folder && 'text-ink-3'
            )}
            data-selectable
            title={s.folder ?? undefined}
          >
            <span className="truncate">{s.folder ?? 'Nenhuma pasta escolhida'}</span>
          </div>
          <Button
            loading={busy === 'folder'}
            onClick={() => void act('folder', () => window.api.invoke('backup:choose-folder'))}
          >
            <FolderOpen className="size-4" /> {s.folder ? 'Trocar' : 'Escolher pasta'}
          </Button>
        </div>
      </Section>

      <Section
        title="Senha do backup"
        description="Os backups são criptografados. Sem a senha não é possível restaurar, então guarde-a em lugar seguro."
        actions={
          s.passwordSet && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ok">
              <Lock className="size-3.5" /> Definida
            </span>
          )
        }
      >
        <form
          className="grid grid-cols-[1fr_1fr_auto] items-start gap-3 [&>button]:mt-[26px]"
          onSubmit={(e) => {
            e.preventDefault()
            void act(
              'pw',
              async () => {
                await window.api.invoke('backup:set-password', { password: pw })
                setPw('')
                setPw2('')
              },
              'Senha do backup salva.'
            )
          }}
        >
          <Field
            label={s.passwordSet ? 'Nova senha (mínimo 8 caracteres)' : 'Senha (mínimo 8 caracteres)'}
            htmlFor="bk-pw"
          >
            <Input
              id="bk-pw"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </Field>
          <Field label="Repita a senha" htmlFor="bk-pw2" error={pwMismatch ? 'As senhas não conferem' : null}>
            <Input
              id="bk-pw2"
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" loading={busy === 'pw'} disabled={pw.length < 8 || pw !== pw2}>
            Salvar senha
          </Button>
        </form>
      </Section>

      <Section
        title="Backup automático"
        description={
          s.lastBackupAt
            ? `Último backup ${timeAgo(s.lastBackupAt)} (${formatDateTime(s.lastBackupAt)}).`
            : 'Nenhum backup feito ainda.'
        }
        actions={
          <Button
            variant="primary"
            loading={busy === 'run'}
            disabled={!s.folder || !s.passwordSet}
            onClick={() => void act('run', () => window.api.invoke('backup:run'), 'Backup criado com sucesso.')}
          >
            <Save className="size-4" /> Fazer backup agora
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-6">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Frequência</legend>
            <div className="flex rounded-lg border border-line bg-sunken p-0.5" role="radiogroup">
              {FREQ.map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={s.frequency === f.id}
                  onClick={() => void act('freq', () => window.api.invoke('backup:update', { frequency: f.id }))}
                  className={cn(
                    'h-8 rounded-md px-3 text-[13.5px] text-ink-2 hover:text-ink',
                    s.frequency === f.id && 'bg-panel font-medium text-ink shadow-card'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Manter os últimos" htmlFor="bk-keep">
            <div className="flex items-center gap-2">
              <Input
                id="bk-keep"
                type="number"
                min={1}
                max={365}
                className="tabular w-20"
                defaultValue={s.keep}
                onBlur={(e) => {
                  const n = Math.max(1, Math.min(365, Number(e.target.value) || 10))
                  if (n !== s.keep) void act('keep', () => window.api.invoke('backup:update', { keep: n }))
                }}
              />
              <span className="text-[13.5px] text-ink-2">backups</span>
            </div>
          </Field>
        </div>
        {(!s.folder || !s.passwordSet) && (
          <p className="mt-3 text-[13px] text-ink-3">Escolha a pasta e defina a senha para ativar o backup.</p>
        )}
      </Section>

      <Section
        title="Restaurar"
        description="Volta os dados para um backup. Também serve para levar tudo para outro computador. Os números de WhatsApp precisarão ler o QR Code de novo."
        actions={
          <Button onClick={() => setRestore({})}>
            <History className="size-4" /> Restaurar de um arquivo…
          </Button>
        }
      >
        {files.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">Nenhum backup encontrado na pasta escolhida.</p>
        ) : (
          <ul className="divide-y divide-line">
            {files.slice(0, 8).map((f) => (
              <li key={f.name} className="flex items-center gap-4 py-2.5">
                <span className="tabular flex-1 text-[13.5px]">{formatDateTime(f.createdAt)}</span>
                <span className="tabular text-[13px] text-ink-3">{formatBytes(f.size)}</span>
                <Button size="sm" variant="ghost" onClick={() => setRestore({ name: f.name })}>
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>
        )}

        {restore && (
          <form
            className="mt-4 rounded-lg bg-warn-soft p-4"
            onSubmit={(e) => {
              e.preventDefault()
              void act('restore', () =>
                window.api.invoke('backup:restore', { name: restore.name, password: restorePw })
              )
            }}
          >
            <p className="text-[13.5px]">
              Os dados atuais serão substituídos e o app vai reiniciar. Uma cópia do estado atual fica guardada por
              segurança.
            </p>
            <div className="mt-3 flex items-end gap-3">
              <div className="w-72">
                <Field label="Senha do backup" htmlFor="rs-pw">
                  <Input
                    id="rs-pw"
                    type="password"
                    autoFocus
                    value={restorePw}
                    onChange={(e) => setRestorePw(e.target.value)}
                  />
                </Field>
              </div>
              <Button type="button" variant="ghost" onClick={() => setRestore(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={busy === 'restore'} disabled={!restorePw}>
                Restaurar e reiniciar
              </Button>
            </div>
          </form>
        )}
      </Section>
    </div>
  )
}

function ModulosTab(): React.JSX.Element {
  const active = useActiveAccount()
  const { reloadAccounts } = useApp()
  if (!active) return <Notice>Crie uma conta para escolher os módulos.</Notice>

  const groups = [...new Set(MODULE_KEYS.map((k) => MODULE_INFO[k].group))]

  async function toggle(k: ModuleKey, v: boolean): Promise<void> {
    await window.api.invoke('accounts:update', { id: active!.id, modules: { [k]: v } })
    await reloadAccounts()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-ink-2">
        Ligue só o que <b className="text-ink">{active.name}</b> usa. O menu mostra apenas os módulos ligados.
      </p>
      {groups.map((g) => (
        <Section key={g} title={g}>
          <ul className="-my-1 divide-y divide-line">
            {MODULE_KEYS.filter((k) => MODULE_INFO[k].group === g).map((k) => (
              <li key={k} className="flex items-center gap-4 py-3">
                <div className="flex-1">
                  <div className="text-[14px] font-medium">{MODULE_INFO[k].label}</div>
                  <div className="text-[13px] text-ink-2">{MODULE_INFO[k].description}</div>
                </div>
                <Switch label={MODULE_INFO[k].label} checked={active.modules[k]} onChange={(v) => void toggle(k, v)} />
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  )
}

function SistemaTab(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const { waVersion } = useApp()
  const update = useUpdateStatus()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void window.api.invoke('app:info').then(setInfo)
  }, [])

  async function act(k: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(k)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const updateText = (() => {
    if (!update) return ''
    switch (update.state) {
      case 'checking':
        return 'Verificando…'
      case 'none':
        return `Você está na versão mais recente${update.checkedAt ? ` (verificado ${timeAgo(update.checkedAt)})` : ''}.`
      case 'available':
        return `Versão ${update.version} disponível.`
      case 'downloading':
        return `Baixando ${update.percent ?? 0}%…`
      case 'ready':
        return `Versão ${update.version} pronta para instalar.`
      case 'error':
        return update.error ?? 'Erro ao verificar.'
      default:
        return 'Ainda não verificado.'
    }
  })()

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Atualizações do app"
        description={`Versão instalada: ${info?.version ?? '…'}. O app verifica sozinho toda vez que abre.`}
        actions={
          <>
            {update?.state === 'available' && (
              <Button variant="primary" onClick={() => void window.api.invoke('update:download')}>
                Baixar
              </Button>
            )}
            {update?.state === 'ready' && (
              <Button variant="primary" onClick={() => void window.api.invoke('update:install')}>
                Reiniciar e instalar
              </Button>
            )}
            <Button loading={busy === 'upd'} onClick={() => void act('upd', () => window.api.invoke('update:check'))}>
              <RefreshCw className="size-4" /> Verificar agora
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">{updateText}</p>
        {update?.notes && update.state === 'available' && (
          <pre
            className="mt-3 max-h-48 overflow-auto rounded-lg bg-sunken p-3 font-sans text-[13px] whitespace-pre-wrap text-ink-2"
            data-selectable
          >
            {update.notes}
          </pre>
        )}
      </Section>

      <Section
        title="Versão do WhatsApp Web"
        description="Buscada no site da WPPConnect ao abrir o app e a cada 6 horas, para evitar erros de conexão."
        actions={
          <Button loading={busy === 'wa'} onClick={() => void act('wa', () => window.api.invoke('wa:refresh-version'))}>
            <RefreshCw className="size-4" /> Buscar agora
          </Button>
        }
      >
        <p className="tabular text-[14px]">
          {waVersion ? waVersion.version.join('.') : '…'}
          {waVersion && <span className="text-ink-3"> · verificada {timeAgo(waVersion.checkedAt)}</span>}
        </p>
      </Section>

      <Section
        title="Dados do app"
        description="Banco de dados, sessões criptografadas e registros ficam nesta pasta."
        actions={
          <Button onClick={() => void window.api.invoke('app:open-data-folder')}>
            <FolderOpen className="size-4" /> Abrir pasta
          </Button>
        }
      >
        <p className="truncate text-[13.5px] text-ink-2" data-selectable>
          {info?.dataPath}
        </p>
      </Section>
    </div>
  )
}

export function Configuracoes(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('backup')
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'backup', label: 'Backup' },
    { id: 'modulos', label: 'Módulos' },
    { id: 'sistema', label: 'Sistema' }
  ]
  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px h-10 border-b-2 px-3 text-[14px] transition-colors',
              tab === t.id ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'backup' && <BackupTab />}
      {tab === 'modulos' && <ModulosTab />}
      {tab === 'sistema' && <SistemaTab />}
    </div>
  )
}
