import { useEffect, useState } from 'react'
import type { LicenseStatus } from '@shared/types'

export function useLicense(): [LicenseStatus | null, (s: LicenseStatus) => void] {
  const [st, setSt] = useState<LicenseStatus | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.invoke('license:status').then((s) => alive && setSt(s))
    return () => {
      alive = false
    }
  }, [])
  return [st, setSt]
}
