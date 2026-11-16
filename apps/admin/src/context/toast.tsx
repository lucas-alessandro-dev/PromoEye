import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Tone = 'good' | 'warn' | 'danger' | 'info'

interface Toast {
  id: number
  text: string
  tone: Tone
}

interface ToastValue {
  toast: (text: string, tone?: Tone) => void
}

const ToastContext = createContext<ToastValue | null>(null)

/**
 * Avisos curtos ("Mensagem copiada"). A região é `aria-live="polite"`: leitor
 * de tela anuncia sem interromper o que a pessoa está fazendo.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const toast = useCallback(
    (text: string, tone: Tone = 'good') => {
      const id = ++seq.current
      setItems((list) => [...list.slice(-3), { id, text, tone }])
      setTimeout(() => dismiss(id), tone === 'danger' ? 8000 : 4500)
    },
    [dismiss]
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.text}</span>
            <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast fora do ToastProvider')
  return ctx
}
