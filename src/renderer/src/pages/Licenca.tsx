import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, ExternalLink, KeyRound, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { MODULE_INFO, PLANS, type LicenseSelection } from '@shared/types'
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
  const [switching, setSwitching] = useState(false)
  const [selection, setSelection] = useState<LicenseSelection | null>(null)
  const [licenseId, setLicenseId] = useState('')
  const loginLock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const { busy, error, setError, run } = useAction()
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

  function cancelLogin(): void {
    if (loginLock.current) return
    setSenha('')
    setSelection(null)
    setLicenseId('')
    setSwitching(false)
    setError(null)
  }

  function login(): void {
    if (loginLock.current || busy || !senha || (selection && !licenseId)) return
    loginLock.current = true
    void run('l', async () => {
      try {
        const result = await window.api.invoke('license:login', {
          email,
          password: senha,
          ...(selection ? { licenseId } : {})
        })
        if (!mounted.current) return
        if ('selectionRequired' in result) {
          setSelection(result)
          setLicenseId('')
        } else {
          setSenha('')
          setSelection(null)
          setLicenseId('')
          setSwitching(false)
          setSt(result)
          await reloadAccounts()
        }
      } catch (e) {
        if (mounted.current) {
          setSenha('')
          setSelection(null)
          setLicenseId('')
        }
        throw e
      } finally {
        loginLock.current = false
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice tone={tone} icon={<BadgeCheck className="size-4" />}>
        {st.message}
      </Notice>
      {st.notice && st.state !== 'active' && <Notice tone="warn">{st.notice}</Notice>}

      {st.online && (
        <Section title="Conta conectada" description={st.online.email}>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null}
              loading={busy === 'r'}
              onClick={() => void run('r', () => apply(() => window.api.invoke('license:refresh')))}
            >
              <RefreshCw className="size-4" /> Verificar agora
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => {
                setEmail(st.online?.email ?? '')
                setSenha('')
                setSelection(null)
                setLicenseId('')
                setError(null)
                setSwitching(true)
              }}
            >
              Trocar licença
            </Button>
            <Button onClick={() => site('conta')}>
              <ExternalLink className="size-4" /> Minha conta no site
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
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
      )}
      {(!st.online || switching) && (
        <Section
          title={
            selection ? 'Escolha a licença deste computador' : switching ? 'Trocar licença' : 'Entrar com sua conta'
          }
          description={
            selection
              ? `Conta ${email}. Cada licença tem seu próprio plano e limite de números.`
              : switching
                ? 'Entre novamente para escolher. A licença atual continua em uso até confirmar a troca.'
                : 'Use o e-mail e a senha da compra ou do teste grátis.'
          }
        >
          <form
            className="flex max-w-md flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              login()
            }}
          >
            {error && <Notice tone="bad">{error}</Notice>}
            {selection ? (
              <fieldset className="flex flex-col gap-2" disabled={busy !== null}>
                <legend className="mb-2 text-[13px] text-ink-2">Selecione uma licença para ativar aqui.</legend>
                {selection.licenses.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3"
                  >
                    <input
                      type="radio"
                      name="license"
                      className="mt-1"
                      checked={licenseId === option.id}
                      onChange={() => setLicenseId(option.id)}
                    />
                    <span className="flex min-w-0 flex-col gap-1 text-[13px]">
                      <span className="font-semibold">
                        {PLANS[option.plano].nome} · {option.contas} número(s) de WhatsApp{' '}
                        {option.teste ? '· teste' : ''}
                      </span>
                      <span className="break-all text-ink-2">Licença {option.id}</span>
                      <span className="text-ink-2">
                        {option.fim ? `Válida até ${br(option.fim.slice(0, 10))}` : 'Sem vencimento'}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <>
                <Field label="E-mail" htmlFor="lic-email">
                  <Input
                    id="lic-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    disabled={busy !== null}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setSenha('')
                      setError(null)
                    }}
                    required
                  />
                </Field>
                <Field label="Senha" htmlFor="lic-senha">
                  <Input
                    id="lic-senha"
                    type="password"
                    autoComplete="current-password"
                    value={senha}
                    disabled={busy !== null}
                    onChange={(e) => setSenha(e.target.value)}
                    required
                  />
                </Field>
              </>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                loading={busy === 'l'}
                disabled={busy !== null || !email || !senha || (!!selection && !licenseId)}
              >
                <LogIn className="size-4" /> {selection ? 'Usar esta licença' : 'Entrar'}
              </Button>
              {(selection || switching) && (
                <Button type="button" disabled={busy !== null} onClick={cancelLogin}>
                  {selection && !switching ? 'Usar outra conta' : 'Cancelar'}
                </Button>
              )}
              {!selection && (
                <button
                  type="button"
                  onClick={() => site('recuperar')}
                  className="text-[13.5px] text-accent hover:underline"
                >
                  Esqueci minha senha / criar senha
                </button>
              )}
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
                <Button
                  type="submit"
                  className="self-start"
                  loading={busy === 'a'}
                  disabled={busy !== null || key.trim().length < 20}
                >
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
