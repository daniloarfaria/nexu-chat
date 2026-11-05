import { useCallback, useEffect, useState } from 'react'

/** Carrega dados do processo principal e recarrega quando as dependências mudam. */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[]
): { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true
  })
  useEffect(() => {
    let alive = true
    fn()
      .then((d) => alive && setState({ data: d, error: null, loading: false }))
      .catch((e: Error) => alive && setState((s) => ({ ...s, error: e.message, loading: false })))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const reload = async (): Promise<void> => {
    try {
      setState({ data: await fn(), error: null, loading: false })
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, loading: false }))
    }
  }
  return { ...state, reload }
}

/** Executa uma ação com estado de carregamento e erro. */
export function useAction(): {
  busy: string | null
  error: string | null
  setError: (e: string | null) => void
  run: <T>(key: string, fn: () => Promise<T>) => Promise<T | undefined>
} {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError((e as Error).message)
      return undefined
    } finally {
      setBusy(null)
    }
  }, [])
  return { busy, error, setError, run }
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '—'
}

export async function fileBytes(f: File): Promise<{ name: string; mime: string; data: Uint8Array }> {
  return { name: f.name, mime: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) }
}
