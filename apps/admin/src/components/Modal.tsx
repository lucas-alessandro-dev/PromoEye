import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Modal sobre o `<dialog>` nativo com `showModal()`: o navegador deixa o
 * resto da página inerte (o Tab não sai do modal) e Esc dispara `cancel`.
 * Renderize só quando aberto — `{open && <Modal …/>}`; ao desmontar, o foco
 * volta para quem abriu.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement as HTMLElement | null
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  )
}

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
