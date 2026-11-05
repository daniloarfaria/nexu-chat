import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ANTIBAN_PRESETS, type AntiBanSettings } from '@shared/types'
import { effectiveDailyLimit } from '@shared/rules'
import { useActiveAccount } from '../lib/store'
import { useAction } from '../lib/useAsync'
import { Button, Field, Input, Notice, Section, Switch } from '../components/ui'
import { cn } from '../lib/cn'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function Num({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max = 9999
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  min?: number
  max?: number
}): React.JSX.Element {
  const id = `ab-${label}`
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          className="tabular w-24"
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        />
        {suffix && <span className="text-[13px] text-ink-2">{suffix}</span>}
      </div>
    </Field>
  )
}

export function Protecao(): React.JSX.Element {
  const account = useActiveAccount()
  const [s, setS] = useState<AntiBanSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const { busy, error, run } = useAction()

  useEffect(() => {
    if (!account) return
    let alive = true
    void window.api.invoke('antiban:get', { accountId: account.id }).then((v) => alive && setS(v))
    return () => {
      alive = false
    }
  }, [account])

  if (!account) return <Notice>Crie uma conta primeiro.</Notice>
  if (!s) return <div className="h-40 animate-pulse rounded-xl bg-sunken" />
  const set = (p: Partial<AntiBanSettings>): void => {
    setS({ ...s, ...p })
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (!account || !s) return
    const { warmupStartedAt: _w, ...patch } = s
    void _w
    const r = await run('save', () => window.api.invoke('antiban:set', { accountId: account.id, patch }))
    if (r) {
      setS(r)
      setSaved(true)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={<ShieldCheck className="size-4" />}>
        Estas regras valem para campanhas e lembretes de <b>{account.name}</b>. Nenhuma configuração elimina o risco de
        bloqueio. O que mais protege é mandar só para quem já é cliente, com mensagens que convidam a responder.
      </Notice>
      {error && <Notice tone="bad">{error}</Notice>}
      <Section title="Ritmo" description="Escolha um modelo pronto ou ajuste os números.">
        <div className="mb-4 flex gap-2">
          {(Object.keys(ANTIBAN_PRESETS) as Array<keyof typeof ANTIBAN_PRESETS>).map((k) => (
            <Button key={k} size="sm" onClick={() => set(ANTIBAN_PRESETS[k])}>
              {k === 'seguro' ? 'Mais seguro' : k === 'equilibrado' ? 'Equilibrado' : 'Mais rápido'}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <Num
            label="Intervalo mínimo"
            suffix="seg"
            min={10}
            max={3600}
            value={s.minDelay}
            onChange={(v) => set({ minDelay: v })}
          />
          <Num
            label="Intervalo máximo"
            suffix="seg"
            min={10}
            max={7200}
            value={s.maxDelay}
            onChange={(v) => set({ maxDelay: v })}
          />
          <Num
            label="Pausa longa a cada"
            suffix="envios"
            min={0}
            max={500}
            value={s.pauseEvery}
            onChange={(v) => set({ pauseEvery: v })}
          />
          <Num
            label="Limite por dia"
            suffix="mensagens"
            min={1}
            max={2000}
            value={s.dailyLimit}
            onChange={(v) => set({ dailyLimit: v })}
          />
          <Num
            label="Pausa longa mínima"
            suffix="min"
            min={1}
            max={240}
            value={s.pauseMin}
            onChange={(v) => set({ pauseMin: v })}
          />
          <Num
            label="Pausa longa máxima"
            suffix="min"
            min={1}
            max={480}
            value={s.pauseMax}
            onChange={(v) => set({ pauseMax: v })}
          />
        </div>
      </Section>
      <Section
        title="Horário de envio"
        description="Fora deste horário as campanhas esperam e continuam sozinhas depois."
      >
        <div className="flex flex-wrap items-end gap-6">
          <Num label="Das" suffix="h" min={0} max={23} value={s.hourStart} onChange={(v) => set({ hourStart: v })} />
          <Num label="Até" suffix="h" min={1} max={24} value={s.hourEnd} onChange={(v) => set({ hourEnd: v })} />
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Dias</legend>
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  aria-pressed={s.days.includes(i)}
                  onClick={() =>
                    set({ days: s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort() })
                  }
                  className={cn(
                    'h-9 w-11 rounded-lg border text-[13px]',
                    s.days.includes(i)
                      ? 'border-accent bg-accent-soft font-medium text-accent-ink'
                      : 'border-line-strong text-ink-2'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </Section>
      <Section title="Proteções automáticas">
        <ul className="-my-1 divide-y divide-line">
          <li className="flex items-center gap-4 py-3">
            <div className="flex-1">
              <div className="text-[14px] font-medium">Simular “digitando…”</div>
              <div className="text-[13px] text-ink-2">Mostra digitando por alguns segundos antes de cada mensagem.</div>
            </div>
            <Switch label="Simular digitando" checked={s.typing} onChange={(v) => set({ typing: v })} />
          </li>
          <li className="flex items-center gap-4 py-3">
            <div className="flex-1">
              <div className="text-[14px] font-medium">Aquecimento de número novo</div>
              <div className="text-[13px] text-ink-2">
                Começa com 20 mensagens por dia e aumenta 15 por dia até o limite.
                {s.warmup && (
                  <>
                    {' '}
                    Hoje: <b className="tabular">{effectiveDailyLimit(s)}</b>.
                  </>
                )}
              </div>
            </div>
            <Switch label="Aquecimento" checked={s.warmup} onChange={(v) => set({ warmup: v })} />
          </li>
          <li className="flex items-center gap-4 py-3">
            <div className="flex-1">
              <div className="text-[14px] font-medium">Pausar se poucos responderem</div>
              <div className="text-[13px] text-ink-2">
                Depois de 30 envios, pausa a campanha se a taxa de resposta ficar abaixo do mínimo (0 = desligado).
              </div>
            </div>
            <Num
              label="Mínimo"
              suffix="%"
              min={0}
              max={100}
              value={s.minReplyRate}
              onChange={(v) => set({ minReplyRate: v })}
            />
          </li>
          <li className="flex items-center gap-4 py-3">
            <div className="flex-1">
              <div className="text-[14px] font-medium">Pausar após falhas seguidas</div>
              <div className="text-[13px] text-ink-2">
                Evita insistir quando algo está errado com a conexão ou com o número.
              </div>
            </div>
            <Num label="Falhas" min={1} max={50} value={s.maxFailStreak} onChange={(v) => set({ maxFailStreak: v })} />
          </li>
        </ul>
      </Section>
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-[13px] text-ok">Salvo.</span>}
        <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>
          Salvar proteção
        </Button>
      </div>
    </div>
  )
}
