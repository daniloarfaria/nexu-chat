import { useState } from 'react'
import { BadgeCheck, CircleSlash } from 'lucide-react'
import { LOST_REASONS, PAYMENT_METHODS, type Deal } from '@shared/types'
import { money, useAction, useLoad } from '../../lib/useAsync'
import { Badge, Button, Field, Input, Notice, Select } from '../ui'

/** Botões “Virou venda” / “Perdida” no topo da conversa. */
export function DealBar({ accountId, jid }: { accountId: string; jid: string }): React.JSX.Element {
  const [mode, setMode] = useState<'won' | 'lost' | null>(null)
  const [amount, setAmount] = useState('')
  const [product, setProduct] = useState('')
  const [payment, setPayment] = useState<string>(PAYMENT_METHODS[0])
  const [reason, setReason] = useState<string>(LOST_REASONS[0])
  const [note, setNote] = useState('')
  const deals = useLoad<Deal[]>(() => window.api.invoke('deals:list', { accountId, chatJid: jid }), [accountId, jid])
  const { busy, error, run } = useAction()
  const last = deals.data?.[0]

  async function save(): Promise<void> {
    if (!mode) return
    const cents = Math.round(Number(amount.replace(/\./g, '').replace(',', '.')) * 100) || 0
    const ok = await run('s', () =>
      window.api.invoke('deals:save', {
        accountId,
        chatJid: jid,
        status: mode,
        amountCents: cents,
        product: product || undefined,
        payment: mode === 'won' ? payment : undefined,
        reason: mode === 'lost' ? reason : undefined,
        note: note || undefined
      })
    )
    if (ok) {
      setMode(null)
      setAmount('')
      setProduct('')
      setNote('')
      void deals.reload()
    }
  }

  return (
    <>
      <div className="ml-auto flex items-center gap-2">
        {last && (
          <span title={`Último registro: ${new Date(last.createdAt).toLocaleDateString('pt-BR')}`}>
            {last.status === 'won' ? (
              <Badge tone="ok">venda {money(last.amountCents)}</Badge>
            ) : (
              <Badge tone="bad">perdida</Badge>
            )}
          </span>
        )}
        <Button size="sm" onClick={() => setMode(mode === 'won' ? null : 'won')}>
          <BadgeCheck className="size-4 text-ok" /> Virou venda
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'lost' ? null : 'lost')}>
          <CircleSlash className="size-4" /> Perdida
        </Button>
      </div>
      {mode && (
        <div className="absolute top-14 right-0 left-0 z-20 border-b border-line bg-panel px-4 py-3 shadow-pop">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            {mode === 'won' ? (
              <>
                <Field label="Valor (R$)" htmlFor="d-val">
                  <Input
                    id="d-val"
                    autoFocus
                    inputMode="decimal"
                    className="tabular w-32"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="259,90"
                  />
                </Field>
                <Field label="Produto" htmlFor="d-prod">
                  <Input
                    id="d-prod"
                    className="w-56"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    placeholder="Óculos de grau, relógio…"
                  />
                </Field>
                <Field label="Pagamento" htmlFor="d-pay">
                  <Select id="d-pay" value={payment} onChange={(e) => setPayment(e.target.value)}>
                    {PAYMENT_METHODS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : (
              <Field label="Motivo" htmlFor="d-reason">
                <Select id="d-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)}>
                  {LOST_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Observação" htmlFor="d-note">
              <Input id="d-note" className="w-56" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setMode(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={busy === 's'} disabled={mode === 'won' && !amount}>
                Registrar
              </Button>
            </div>
            {error && (
              <div className="w-full">
                <Notice tone="bad">{error}</Notice>
              </div>
            )}
          </form>
        </div>
      )}
    </>
  )
}
