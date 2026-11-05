import { useState } from 'react'
import { BadgeCheck, ExternalLink, KeyRound, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { MODULE_INFO, PLANS } from '@shared/types'
import { useLicense } from '../lib/useLicense'
import { useApp } from '../lib/store'
import { useAction } from '../lib/useAsync'
import { Badge, Button, Field, Input, Notice, Section, Textarea } from '../components/ui'

const br = (d: string): string => d.split('-').reverse().join('/')

export function Licenca(): React.JSX.Element {
  const [st, setSt] = useLicense()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [key, setKey] = useState('')
  const [manual, setManual] = useState(false)
  const { busy, error, run } = useAction()
  const reloadAccounts = useApp((s) => s.reloadAccounts)
  if (!st) return <div className="h-40 animate-pulse rounded-xl bg-sunken" />
  const p = st.payload
  const tone = st.state === 'active' || st.state === 'dev' ? 'ok' : st.state === 'grace' ? 'warn' : 'bad'
  const site = (page: 'recuperar' | 'teste' | 'planos' | 'conta'): void =>
    void window.api.invoke('app:open-site', { page })

  async function apply(fn: () => Promise<typeof st>): Promise<void> {
    const r = await fn()
    if (r) {
      setSt(r)
      await reloadAccounts()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice tone={tone} icon={<BadgeCheck className="size-4" />}>
        {st.message}
      </Notice>
      {st.notice && st.state !== 'active' && <Notice tone="warn">{st.notice}</Notice>}

      {st.online ? (
        <Section title="Conta conectada" description={st.online.email}>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy === 'r'}
              onClick={() => void run('r', () => apply(() => window.api.invoke('license:refresh')))}
            >
              <RefreshCw className="size-4" /> Verificar agora
            </Button>
            <Button onClick={() => site('conta')}>
              <ExternalLink className="size-4" /> Minha conta no site
            </Button>
            <Button
              variant="ghost"
              loading={busy === 'o'}
              onClick={() =>
                confirm('Sair desta conta neste computador? Os módulos pagos ficam bloqueados até entrar de novo.') &&
                void run('o', () => apply(() => window.api.invoke('license:logout')))
              }
            >
              <LogOut className="size-4" /> Sair
            </Button>
          </div>
        </Section>
      ) : (
        <Section title="Entrar com sua conta" description="Use o e-mail e a senha da compra ou do teste grátis.">
          <form
            className="flex max-w-md flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void run('l', () =>
                apply(async () => {
                  const r = await window.api.invoke('license:login', { email, password: senha })
                  setSenha('')
                  return r
                })
              )
            }}
          >
            <Field label="E-mail" htmlFor="lic-email">
              <Input
                id="lic-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Senha" htmlFor="lic-senha" error={busy === null ? error : null}>
              <Input
                id="lic-senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" loading={busy === 'l'} disabled={!email || !senha}>
                <LogIn className="size-4" /> Entrar
              </Button>
              <button
                type="button"
                onClick={() => site('recuperar')}
                className="text-[13.5px] text-accent hover:underline"
              >
                Esqueci minha senha / criar senha
              </button>
            </div>
            <p className="text-[13px] text-ink-2">
              Ainda não tem conta?{' '}
              <button type="button" onClick={() => site('teste')} className="font-medium text-accent hover:underline">
                Teste grátis
              </button>{' '}
              ou{' '}
              <button type="button" onClick={() => site('planos')} className="font-medium text-accent hover:underline">
                veja os planos
              </button>
              .
            </p>
          </form>
        </Section>
      )}

      {p && (
        <Section title={p.cliente} description={`Licença ${p.id}${p.documento ? ` · ${p.documento}` : ''}`}>
          <dl className="grid grid-cols-4 gap-4 text-[13.5px]">
            <div>
              <dt className="text-ink-2">Plano</dt>
              <dd className="flex items-center gap-1.5 font-semibold">
                {PLANS[p.plano]?.nome ?? p.plano} {p.teste && <Badge tone="accent">teste</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Números de WhatsApp</dt>
              <dd className="tabular font-semibold">{p.contas}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Válida até</dt>
              <dd className="tabular font-semibold">
                {p.online ? (p.fim ? br(p.fim) : 'vitalícia') : p.validade ? br(p.validade) : 'sem vencimento'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">{p.online ? 'Verificada em' : 'Emitida em'}</dt>
              <dd className="tabular font-semibold">{br(p.emitida)}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {p.modulos.map((m) => (
              <Badge key={m} tone="accent">
                {MODULE_INFO[m].label}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {!st.online && (
        <div>
          <button onClick={() => setManual((v) => !v)} className="text-[13px] text-ink-2 hover:text-ink">
            {manual ? '▾' : '▸'} Tenho uma chave de licença
          </button>
          {manual && (
            <Section title="Ativar com chave" description="Para chaves enviadas pela agência. Funciona sem internet.">
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run('a', () =>
                    apply(async () => {
                      const r = await window.api.invoke('license:activate', { key })
                      setKey('')
                      return r
                    })
                  )
                }}
              >
                <Field label="Chave de licença" htmlFor="lic-key">
                  <Textarea
                    id="lic-key"
                    rows={4}
                    className="font-mono text-[12px]"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="DSP1.…"
                    spellCheck={false}
                  />
                </Field>
                <Button type="submit" className="self-start" loading={busy === 'a'} disabled={key.trim().length < 20}>
                  <KeyRound className="size-4" /> Ativar
                </Button>
              </form>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
