import { useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { useActiveAccount } from '../lib/store'
import { useAction, useLoad } from '../lib/useAsync'
import { timeAgo } from '../lib/format'
import { Badge, Button, Field, Input, Notice, Section, Select, Switch } from './ui'

/** Configurações → Integrações → Planilha de leads */
export function LeadsPlanilhaConfig(): React.JSX.Element {
  const account = useActiveAccount()
  const accountId = account?.id ?? ''
  const enabled = !!account?.modules.leadsPlanilha
  const cfg = useLoad(
    () => (accountId && enabled ? window.api.invoke('leads:config', { accountId }) : Promise.resolve(null)),
    [accountId, enabled]
  )
  const pipes = useLoad(
    () => (accountId && enabled ? window.api.invoke('pipelines:list', { accountId }) : Promise.resolve([])),
    [accountId, enabled]
  )
  const { busy, error, setError, run } = useAction()
  const [secret, setSecret] = useState('')
  const [edit, setEdit] = useState<{ url?: string; create?: boolean; pipelineId?: number | null }>({})
  const [info, setInfo] = useState<string | null>(null)

  if (!account) return <Notice>Crie uma conta para configurar a planilha de leads.</Notice>
  if (!enabled)
    return (
      <Notice>
        O módulo <b>Planilha de leads</b> está desligado (ou fora do seu plano). Ligue em Configurações → Módulos.
      </Notice>
    )
  const c = cfg.data
  // Mostra o que a pessoa digitou; enquanto não mexe, o que está salvo
  const url = edit.url ?? c?.url ?? ''
  const create = edit.create ?? c?.createContacts ?? false
  const pipelineId = edit.pipelineId === undefined ? (c?.pipelineId ?? null) : edit.pipelineId
  const setUrl = (v: string): void => setEdit((e) => ({ ...e, url: v }))
  const setCreate = (v: boolean): void => setEdit((e) => ({ ...e, create: v }))
  const setPipelineId = (v: number | null): void => setEdit((e) => ({ ...e, pipelineId: v }))

  async function save(): Promise<void> {
    setInfo(null)
    const r = await run('save', () =>
      window.api.invoke('leads:config-save', {
        accountId,
        url,
        secret,
        createContacts: create,
        pipelineId: create ? pipelineId : null
      })
    )
    if (r) {
      setSecret('')
      setEdit({})
      setInfo('Salvo.')
      await cfg.reload()
    }
  }

  async function sync(): Promise<void> {
    setInfo(null)
    const r = await run('sync', () => window.api.invoke('leads:sync', { accountId }))
    if (r) {
      setInfo(
        r.ok
          ? r.added
            ? `${r.added} lead${r.added > 1 ? 's' : ''} novo${r.added > 1 ? 's' : ''}.`
            : 'Nenhum lead novo.'
          : null
      )
      if (!r.ok) setError(r.error ?? 'Não foi possível atualizar.')
      await cfg.reload()
    }
  }

  return (
    <Section
      title="Planilha de leads"
      description="Traz para o app os leads que o formulário do site gravou na planilha, a cada 30 minutos. Nada fica público: o app pede com a senha do formulário."
      actions={
        c?.lastSyncAt ? (
          <Badge tone={c.lastError ? 'bad' : 'ok'}>
            {c.lastError ? 'Falhou' : 'Atualizado'} {timeAgo(c.lastSyncAt)}
          </Badge>
        ) : undefined
      }
    >
      <div className="flex max-w-[640px] flex-col gap-4">
        <Field
          label="Link do Apps Script"
          htmlFor="lp-url"
          hint="O endereço que termina em /exec, do script da planilha (começa com https://script.google.com/)."
        >
          <Input
            id="lp-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
          />
        </Field>
        <Field
          label="Senha do formulário"
          htmlFor="lp-secret"
          hint={
            c?.hasSecret
              ? 'Já há uma senha guardada (protegida neste computador). Deixe em branco para manter.'
              : 'A mesma senha do formulário do site (SEGREDO_FORMULARIO).'
          }
        >
          <Input
            id="lp-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={c?.hasSecret ? '••••••••' : ''}
          />
        </Field>
        <div className="flex items-start gap-3">
          <Switch label="Criar contato para cada lead novo" checked={create} onChange={setCreate} />
          <div>
            <div className="text-[14px] font-medium">Criar contato para cada lead novo</div>
            <div className="text-[13px] text-ink-2">
              O contato ganha a etiqueta “Lead site”. O lead preencheu o formulário, então há consentimento.
            </div>
          </div>
        </div>
        {create && (
          <Field label="Colocar um cartão na primeira coluna do funil" htmlFor="lp-pipe">
            <Select
              id="lp-pipe"
              value={pipelineId ?? ''}
              onChange={(e) => setPipelineId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Não colocar em funil</option>
              {(pipes.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        {c?.lastError && !error && <Notice tone="warn">Última atualização: {c.lastError}</Notice>}
        {info && <Notice tone="ok">{info}</Notice>}
        <div className="flex gap-2">
          <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
            <Save className="size-4" aria-hidden /> Salvar
          </Button>
          <Button loading={busy === 'sync'} disabled={!c?.url} onClick={() => void sync()}>
            <RefreshCw className="size-4" aria-hidden /> Atualizar agora
          </Button>
        </div>
      </div>
    </Section>
  )
}
