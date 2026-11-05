import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

export function useUpdateStatus(): UpdateStatus | null {
  const [s, setS] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.api.invoke('update:status').then(setS)
    return window.api.on('update:changed', setS)
  }, [])
  return s
}
