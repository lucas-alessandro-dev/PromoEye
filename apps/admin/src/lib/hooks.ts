import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export interface Loaded<T> {
  data: T | null
  error: unknown
  loading: boolean
  reload: () => void
  setData: (updater: T | ((prev: T | null) => T | null)) => void
}

/**
 * Carrega dados e refaz quando as dependências mudam. Resposta atrasada de
 * uma chamada anterior nunca sobrescreve a mais nova.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList): Loaded<T> {
  const [data, setDataState] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    fn()
      .then((d) => {
        if (mine === seq.current) setDataState(d)
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(e)
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  const setData = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater
    )
  }, [])

  return { data, error, loading, reload, setData }
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · PromoEye`
  }, [title])
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Relógio que bate a cada `ms` enquanto `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
