import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Carrega dados do processo principal e recarrega quando as dependências mudam.
 * Só vale a resposta da última requisição (uma resposta lenta e antiga nunca sobrescreve a nova).
 * Com `resetOnChange`, os dados antigos são descartados assim que as dependências mudam.
 */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  opts: { resetOnChange?: boolean } = {}
): { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true
  })
  const fnRef = useRef(fn)
  const seq = useRef(0)
  useEffect(() => {
    fnRef.current = fn
  })
  const resetOnChange = !!opts.resetOnChange
  const run = useCallback(async (reset: boolean, showLoading: boolean): Promise<void> => {
    const mine = ++seq.current
    if (reset) setState({ data: null, error: null, loading: true })
    else if (showLoading) setState((s) => ({ ...s, loading: true }))
    try {
      const d = await fnRef.current()
      if (mine === seq.current) setState({ data: d, error: null, loading: false })
    } catch (e) {
      if (mine === seq.current) setState((s) => ({ ...s, error: (e as Error).message, loading: false }))
    }
  }, [])
  useEffect(() => {
    void run(resetOnChange, false)
    const counter = seq
    return () => {
      // invalida a requisição em andamento quando as dependências mudam ou a tela fecha
      counter.current++
    }
    // As dependências são as informadas por quem chama; fn é lida pela ref, sempre a mais nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const reload = useCallback((): Promise<void> => run(false, false), [run])
  return { ...state, reload }
}

/** Executa uma ação com estado de carregamento e erro. */
/**
 * Executa e diz explicitamente se deu certo. Chamadas que não devolvem nada (IPC `void`) dão `undefined`
 * tanto no sucesso quanto no erro; por isso quem precisa saber do sucesso usa isto, não `!== undefined`.
 */
export async function settle<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function useAction(): {
  busy: string | null
  error: string | null
  setError: (e: string | null) => void
  run: <T>(key: string, fn: () => Promise<T>) => Promise<T | undefined>
  /** Como `run`, mas devolve true só se deu certo (serve para chamadas que não devolvem valor). */
  attempt: (key: string, fn: () => Promise<unknown>) => Promise<boolean>
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
  const attempt = useCallback(async (key: string, fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(key)
    setError(null)
    const r = await settle(fn)
    if (!r.ok) setError(r.error)
    setBusy(null)
    return r.ok
  }, [])
  return { busy, error, setError, run, attempt }
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
