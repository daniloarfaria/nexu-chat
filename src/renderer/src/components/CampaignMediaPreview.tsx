import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import type { CampaignMedia } from '@shared/types'

type Source = {
  file: File | null
  saved: CampaignMedia | null
  campaignId?: number
  accountId: string
  sourceIndex: number | null
}
export function CampaignMediaPreview({
  file,
  saved,
  campaignId,
  accountId,
  sourceIndex
}: Source): React.JSX.Element | null {
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let canceled = false
    let url: string | null = null
    async function load(): Promise<void> {
      await Promise.resolve()
      if (canceled) return
      setPreview(null)
      setError(false)
      let blob: Blob
      let name: string
      if (file) {
        blob = file
        name = file.name
      } else if (saved && campaignId && sourceIndex !== null) {
        const result = await window.api.invoke('campaigns:media-preview', {
          id: campaignId,
          accountId,
          variantIndex: sourceIndex
        })
        if (!result) return
        blob = new Blob([new Uint8Array(result.data)], { type: result.mime })
        name = result.name
      } else return
      if (canceled) return
      url = URL.createObjectURL(blob)
      setPreview({ url, mime: blob.type, name })
    }
    void load().catch(() => {
      if (!canceled) setError(true)
    })
    return () => {
      canceled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file, saved, campaignId, accountId, sourceIndex])
  if (!file && !saved) return null
  if (error)
    return (
      <p role="alert" className="mb-2 text-[12px]">
        Não foi possível abrir a mídia. Escolha o arquivo novamente.
      </p>
    )
  if (!preview)
    return (
      <p role="status" className="mb-2 text-[12px]">
        Carregando mídia…
      </p>
    )
  const fail = (): void => setError(true)
  if (preview.mime.startsWith('image/'))
    return (
      <img
        src={preview.url}
        alt={preview.name}
        onError={fail}
        className="mb-2 max-h-64 w-full rounded-lg object-contain"
      />
    )
  if (preview.mime.startsWith('video/'))
    return (
      <video
        src={preview.url}
        controls
        preload="metadata"
        onError={fail}
        className="mb-2 max-h-64 w-full rounded-lg"
        aria-label={preview.name}
      />
    )
  if (preview.mime.startsWith('audio/'))
    return (
      <audio
        src={preview.url}
        controls
        preload="metadata"
        onError={fail}
        className="mb-2 w-full min-w-0"
        aria-label={preview.name}
      />
    )
  return (
    <a
      href={preview.url}
      download={preview.name}
      className="mb-2 flex items-center gap-2 rounded-lg bg-black/10 p-3 text-[13px] underline underline-offset-2"
    >
      <FileText className="size-5 shrink-0" />
      <span className="break-all">{preview.name}</span>
    </a>
  )
}
