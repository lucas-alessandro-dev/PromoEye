import { useState } from 'react'
import { loginInput } from '@promoeye/shared'
import { api, errorMessage } from '../api'
import { useAuth } from '../context/auth'
import { TextField } from '../components/Fields'
import { useTitle } from '../lib/hooks'

export function Login() {
  useTitle('Entrar')
  const { setUser, expired } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const parsed = loginInput.safeParse({ email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira e-mail e senha.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setUser(await api.login(parsed.data))
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <main className="login-card">
        <p className="login-brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <ellipse cx="16" cy="16" rx="13" ry="8" fill="#072C2C" />
            <circle cx="16" cy="16" r="5" fill="#FF5F03" />
            <circle cx="16" cy="16" r="2" fill="#EDEADE" />
          </svg>
          PromoEye
        </p>
        <h1>Entrar no painel</h1>
        {expired && (
          <p className="notice notice-warn" role="status">
            Sua sessão expirou. Entre de novo para continuar.
          </p>
        )}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <TextField label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <TextField
            label="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <p className="muted small">
          Sem conta? Crie a primeira no servidor com <code>npm run create-admin</code>.
        </p>
      </main>
    </div>
  )
}
