import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RunDTO } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useToast } from './toast'

type Phase = 'idle' | 'starting' | 'running' | 'finished' | 'error'

interface RunValue {
  phase: Phase
  run: RunDTO | null
  runId: string | null
  /** Quando a coleta acompanhada começou (ms), para o cronômetro. */
  startedAt: number | null
  error: string | null
  /** Sobe 1 a cada coleta terminada: telas usam como dependência para recarregar. */
  version: number
  start: (itemIds?: string[]) => Promise<void>
}

const RunContext = createContext<RunValue | null>(null)

const POLL_MS = 3000

/**
 * Acompanha a coleta. "Buscar agora" dispara POST /runs e depois consulta
 * GET /runs/:id a cada 3 s até o status deixar de ser RUNNING. Se já havia
 * uma coleta rodando (409), passa a acompanhar aquela.
 */
export function RunProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const [phase, setPhase] = useState<Phase>('idle')
  const [runId, setRunId] = useState<string | null>(null)
  const [run, setRun] = useState<RunDTO | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const announced = useRef<string | null>(null)

  const follow = useCallback((id: string, since?: string) => {
    setRunId(id)
    setPhase('running')
    setStartedAt(since ? new Date(since).getTime() : Date.now())
    setError(null)
  }, [])

  // Ao abrir o painel com uma coleta já em andamento (agendada), acompanha.
  useEffect(() => {
    api
      .runs(1)
      .then(([last]) => {
        if (last && last.status === 'RUNNING') {
          setRun(last)
          follow(last.id, last.startedAt)
        }
      })
      .catch(() => undefined)
  }, [follow])

  useEffect(() => {
    if (phase !== 'running' || !runId) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const r = await api.run(runId)
        if (stop) return
        setRun(r)
        if (r.status !== 'RUNNING') {
          setPhase('finished')
          setVersion((v) => v + 1)
          if (announced.current !== r.id) {
            announced.current = r.id
            if (r.status === 'FAILED') {
              toast(`A coleta falhou: ${r.errors[0]?.message ?? 'erro desconhecido'}`, 'danger')
            } else {
              const deals = r.newDeals === 1 ? '1 promoção nova' : `${r.newDeals} promoções novas`
              toast(
                `Coleta concluída: ${r.offersSeen} anúncios, ${deals}${r.status === 'PARTIAL' ? ' (algumas lojas falharam)' : ''}.`,
                r.status === 'PARTIAL' ? 'warn' : 'good'
              )
            }
          }
          return
        }
      } catch (err) {
        if (stop) return
        // Falha de rede momentânea: tenta de novo no próximo ciclo.
        if (err instanceof ApiError && err.status === 404) {
          setPhase('error')
          setError('A coleta acompanhada não foi encontrada.')
          return
        }
      }
      timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 800)
    return () => {
      stop = true
      if (timer) clearTimeout(timer)
    }
  }, [phase, runId, toast])

  const start = useCallback(
    async (itemIds?: string[]) => {
      if (phase === 'running' || phase === 'starting') return
      setPhase('starting')
      setError(null)
      try {
        const { runId: id } = await api.startRun(itemIds)
        setRun(null)
        follow(id)
        toast(itemIds?.length ? 'Buscando este item nas lojas…' : 'Buscando em todas as lojas…', 'info')
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const other = (err.data as { runId?: string } | null)?.runId
          if (other) {
            follow(other)
            toast('Já havia uma coleta rodando. Acompanhando ela.', 'info')
            return
          }
        }
        setPhase('error')
        setError(errorMessage(err))
        toast(`Não deu para iniciar a coleta: ${errorMessage(err)}`, 'danger')
      }
    },
    [phase, follow, toast]
  )

  const value = useMemo(
    () => ({ phase, run, runId, startedAt, error, version, start }),
    [phase, run, runId, startedAt, error, version, start]
  )
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>
}

export function useRun(): RunValue {
  const ctx = useContext(RunContext)
  if (!ctx) throw new Error('useRun fora do RunProvider')
  return ctx
}
