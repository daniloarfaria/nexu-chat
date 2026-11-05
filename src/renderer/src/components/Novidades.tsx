import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from './ui'

type Item = { versao: string; data: string; titulo: string; resumo: string; destaques: string[]; url: string }

/** Depois de uma atualização importante: mostra as novidades uma vez. */
export function Novidades(): React.JSX.Element | null {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    const t = setTimeout(
      () =>
        void window.api
          .invoke('novidades:pendentes')
          .then(setItems)
          .catch(() => undefined),
      2500
    )
    return () => clearTimeout(t)
  }, [])
  if (!items.length) return null
  const close = (): void => {
    setItems([])
    void window.api.invoke('novidades:vistas')
  }
  const top = items[0]
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nov-t"
    >
      <button aria-label="Fechar" className="absolute inset-0 bg-black/35" onClick={close} />
      <div className="relative w-[min(560px,94vw)] overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
        <div className="bg-accent px-6 pt-6 pb-5 text-on-accent">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold tracking-wide uppercase opacity-90">
            <Sparkles className="size-4" /> Novidades da versão {top.versao}
          </div>
          <h2 id="nov-t" className="mt-2 text-[21px] leading-snug font-bold">
            {top.titulo}
          </h2>
        </div>
        <div className="max-h-[50vh] overflow-y-auto px-6 py-5">
          <p className="text-[14.5px] text-ink-2">{top.resumo}</p>
          <ul className="mt-4 flex flex-col gap-2">
            {top.destaques.map((d) => (
              <li key={d} className="flex gap-2.5 text-[14px]">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {d}
              </li>
            ))}
          </ul>
          {items.length > 1 && (
            <p className="mt-4 text-[13px] text-ink-3">
              E mais:{' '}
              {items
                .slice(1)
                .map((i) => `v${i.versao}`)
                .join(', ')}
              .
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-3">
          <Button variant="ghost" onClick={() => void window.api.invoke('app:open-site', { page: 'novidades' })}>
            Ver tudo no site
          </Button>
          <Button variant="primary" onClick={close} autoFocus>
            Entendi
          </Button>
        </div>
      </div>
    </div>
  )
}
