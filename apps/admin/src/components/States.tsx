import type { ReactNode } from 'react'
import { errorMessage } from '../api'

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorBox({ error, onRetry, title = 'Não deu para carregar' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">{title}</p>
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children && <div className="state-text">{children}</div>}
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}

export function FullPageLoading() {
  return (
    <div className="fullpage">
      <Loading label="Abrindo o painel…" />
    </div>
  )
}
