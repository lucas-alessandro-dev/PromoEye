import { useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface FieldShell {
  label: string
  hint?: ReactNode
  error?: string | null
}

function describedBy(id: string, hint?: ReactNode, error?: string | null): string | undefined {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}

function Shell({ id, label, hint, error, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextField({ label, hint, error, id: idProp, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Shell>
  )
}

export function TextArea({ label, hint, error, id: idProp, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <textarea id={id} className="input textarea" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Shell>
  )
}

export function SelectField({
  label,
  hint,
  error,
  id: idProp,
  children,
  ...rest
}: FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <select id={id} className="input select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>
        {children}
      </select>
    </Shell>
  )
}

/** Interruptor liga/desliga: um checkbox com `role="switch"` e rótulo visível. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="switch-field">
      <label className="switch" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-track" aria-hidden="true" />
        <span className="switch-label">{label}</span>
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * Lista de termos como "chips". Enter ou vírgula adiciona; Backspace com o
 * campo vazio remove o último; colar "a, b, c" adiciona os três.
 */
export function ChipsInput({
  label,
  hint,
  error,
  values,
  onChange,
  placeholder,
  lowercase = true,
}: FieldShell & {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  lowercase?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .map((s) => (lowercase ? s.toLowerCase() : s))
      .filter(Boolean)
    if (!parts.length) {
      setDraft('')
      return
    }
    const next = [...values]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="chips">
        {values.length > 0 && (
          <ul className="chip-list" aria-label={`${label}: ${values.length} termos`}>
            {values.map((v) => (
              <li key={v} className="chip">
                <span>{v}</span>
                <button type="button" className="chip-x" aria-label={`Remover ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id={id}
          className="chip-input"
          value={draft}
          placeholder={placeholder ?? 'Digite e aperte Enter'}
          aria-describedby={describedBy(id, hint, error)}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const v = e.target.value
            if (v.includes(',')) add(v)
            else setDraft(v)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}
