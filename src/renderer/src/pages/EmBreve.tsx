import { Hammer } from 'lucide-react'
import { PageHeader } from '../components/ui'

export function EmBreve({
  title,
  phase,
  description
}: {
  title: string
  phase: number
  description: string
}): React.JSX.Element {
  return (
    <div>
      <PageHeader title={title} />
      <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
        <Hammer className="size-8 text-ink-3" strokeWidth={1.5} />
        <h2 className="mt-3 text-[16px] font-semibold">Em construção (fase {phase})</h2>
        <p className="mt-1 max-w-[52ch] text-[14px] text-ink-2">{description}</p>
      </div>
    </div>
  )
}
