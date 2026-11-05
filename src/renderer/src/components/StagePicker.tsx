import { useEffect, useState } from 'react'
import type { Pipeline } from '@shared/types'
import { useLoad } from '../lib/useAsync'
import { Field, Select } from './ui'

/** Escolha de funil + coluna. Chama `onChange(stageId)`; null quando não há funis. */
export function StagePicker({
  accountId,
  value,
  onChange,
  idPrefix = 'sp'
}: {
  accountId: string
  value: number | null
  onChange: (stageId: number | null, pipeline: Pipeline | null) => void
  idPrefix?: string
}): React.JSX.Element {
  const list = useLoad(() => window.api.invoke('pipelines:list', { accountId }), [accountId])
  const pipes = list.data ?? []
  const [pid, setPid] = useState<number | null>(null)
  const current = pipes.find((p) => p.id === pid) ?? pipes.find((p) => p.stages.some((s) => s.id === value)) ?? pipes[0]

  // Coluna escolhida não pertence ao funil mostrado: avisa o pai com a primeira coluna aberta
  useEffect(() => {
    if (!current || current.stages.some((s) => s.id === value)) return
    const first = current.stages.find((s) => s.kind === 'open') ?? current.stages[0]
    onChange(first?.id ?? null, current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, value])

  if (list.data && !pipes.length)
    return <p className="text-[13px] text-ink-2">Nenhum funil ainda. Crie um na página Funis.</p>

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Funil" htmlFor={`${idPrefix}-p`}>
        <Select
          id={`${idPrefix}-p`}
          className="w-full"
          value={current?.id ?? ''}
          onChange={(e) => {
            const p = pipes.find((x) => x.id === Number(e.target.value)) ?? null
            setPid(p?.id ?? null)
            const first = p?.stages.find((s) => s.kind === 'open') ?? p?.stages[0]
            onChange(first?.id ?? null, p)
          }}
        >
          {pipes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Coluna" htmlFor={`${idPrefix}-s`}>
        <Select
          id={`${idPrefix}-s`}
          className="w-full"
          value={value ?? ''}
          onChange={(e) => onChange(Number(e.target.value), current ?? null)}
        >
          {(current?.stages ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}
