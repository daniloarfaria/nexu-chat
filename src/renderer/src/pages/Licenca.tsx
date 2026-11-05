import { useState } from 'react'
import { useLicense } from '../lib/useLicense'
import { BadgeCheck, KeyRound } from 'lucide-react'
import { MODULE_INFO, PLANS } from '@shared/types'
import { useApp } from '../lib/store'
import { useAction } from '../lib/useAsync'
import { Badge, Button, Field, Notice, Section, Textarea } from '../components/ui'

export function Licenca(): React.JSX.Element {
  const [st, setSt] = useLicense()
  const [key, setKey] = useState('')
  const { busy, error, run } = useAction()
  const reloadAccounts = useApp((s) => s.reloadAccounts)
  if (!st) return <div className="h-40 animate-pulse rounded-xl bg-sunken" />
  const p = st.payload
  const tone = st.state === 'active' || st.state === 'dev' ? 'ok' : st.state === 'grace' ? 'warn' : 'bad'

  return (
    <div className="flex flex-col gap-4">
      <Notice tone={tone} icon={<BadgeCheck className="size-4" />}>
        {st.message}
      </Notice>
      {p && (
        <Section title={p.cliente} description={`Licença ${p.id}${p.documento ? ` · ${p.documento}` : ''}`}>
          <dl className="grid grid-cols-4 gap-4 text-[13.5px]">
            <div>
              <dt className="text-ink-2">Plano</dt>
              <dd className="font-semibold">{PLANS[p.plano]?.nome ?? p.plano}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Números de WhatsApp</dt>
              <dd className="tabular font-semibold">{p.contas}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Válida até</dt>
              <dd className="tabular font-semibold">
                {p.validade ? p.validade.split('-').reverse().join('/') : 'sem vencimento'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Emitida em</dt>
              <dd className="tabular font-semibold">{p.emitida.split('-').reverse().join('/')}</dd>
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
      <Section
        title={p ? 'Trocar ou renovar a licença' : 'Ativar licença'}
        description="Cole a chave enviada pela agência. Funciona sem internet."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await run('a', () => window.api.invoke('license:activate', { key }))
            if (r) {
              setSt(r)
              setKey('')
              await reloadAccounts()
            }
          }}
        >
          <Field label="Chave de licença" htmlFor="lic-key" error={error}>
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
            variant="primary"
            className="self-start"
            loading={busy === 'a'}
            disabled={key.trim().length < 20}
          >
            <KeyRound className="size-4" /> Ativar
          </Button>
        </form>
      </Section>
    </div>
  )
}
