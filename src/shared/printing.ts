import type { MediaInfo } from './types'

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/tiff'
])
export function printableMediaKind(media: MediaInfo | null): 'image' | 'pdf' | null {
  if (!media || media.viewOnce) return null
  const mime = media.mimetype?.split(';')[0].trim().toLowerCase() ?? ''
  if (IMAGE_TYPES.has(mime)) return 'image'
  if (
    mime === 'application/pdf' ||
    ((!mime || mime === 'application/octet-stream') && /\.pdf$/i.test(media.fileName ?? ''))
  )
    return 'pdf'
  return null
}
