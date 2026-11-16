import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MeDTO } from '@promoeye/shared'
import { api, setUnauthorizedHandler } from '../api'

interface AuthValue {
  user: MeDTO | null
  loading: boolean
  /** true quando a sessão caiu no meio do uso (mostra aviso no login). */
  expired: boolean
  setUser: (u: MeDTO | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<MeDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUserState(null)
      setExpired(true)
    })
    api
      .me()
      .then((me) => setUserState(me))
      .catch(() => setUserState(null))
      .finally(() => setLoading(false))
    return () => setUnauthorizedHandler(null)
  }, [])

  const setUser = useCallback((u: MeDTO | null) => {
    setUserState(u)
    if (u) setExpired(false)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUserState(null)
      setExpired(false)
    }
  }, [])

  const value = useMemo(() => ({ user, loading, expired, setUser, logout }), [user, loading, expired, setUser, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
