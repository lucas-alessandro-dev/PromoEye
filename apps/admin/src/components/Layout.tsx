import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { daysUntilBlackFriday } from '@promoeye/shared'
import { useAuth } from '../context/auth'
import { useRun } from '../context/run'
import { useNow } from '../lib/hooks'
import { formatClock } from '../lib/format'

const NAV = [
  { to: '/', label: 'Painel', end: true },
  { to: '/itens', label: 'Itens' },
  { to: '/ofertas', label: 'Ofertas' },
  { to: '/lojas', label: 'Lojas' },
  { to: '/whatsapp', label: 'WhatsApp' },
  { to: '/configuracoes', label: 'Configurações' },
]

function Brand() {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <ellipse cx="16" cy="16" rx="13" ry="8" fill="#EDEADE" />
        <circle cx="16" cy="16" r="5" fill="#FF5F03" />
        <circle cx="16" cy="16" r="2" fill="#072C2C" />
      </svg>
      <span className="brand-name">PromoEye</span>
    </span>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="nav-list">
      {NAV.map((n) => (
        <li key={n.to}>
          <NavLink to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`} onClick={onNavigate}>
            {n.label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

function BlackFridayCountdown() {
  const { days, date } = daysUntilBlackFriday()
  const when = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' })
  return (
    <p className="bf-countdown">
      {days === 0 ? (
        <strong>Hoje é Black Friday</strong>
      ) : (
        <>
          Black Friday em <strong>{days === 1 ? '1 dia' : `${days} dias`}</strong>
          <span className="bf-date"> · {when}</span>
        </>
      )}
    </p>
  )
}

export function RunButton() {
  const { phase, start, startedAt } = useRun()
  const running = phase === 'running' || phase === 'starting'
  const now = useNow(running)
  const elapsed = startedAt ? now - startedAt : 0

  return (
    <div className="run-control">
      <button type="button" className="btn btn-accent" onClick={() => void start()} disabled={running} aria-describedby="run-status">
        {running ? (
          <>
            <span className="spinner spinner-dark" aria-hidden="true" />
            Buscando… {phase === 'running' ? formatClock(elapsed) : ''}
          </>
        ) : (
          'Buscar agora'
        )}
      </button>
      <span id="run-status" className="sr-only" aria-live="polite">
        {phase === 'running' ? 'Coleta em andamento.' : phase === 'finished' ? 'Coleta concluída.' : ''}
      </span>
    </div>
  )
}

export function Layout() {
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>

      <aside className="sidebar" aria-label="Navegação principal">
        <div className="sidebar-top">
          <Brand />
        </div>
        <nav aria-label="Seções do painel">
          <NavLinks />
        </nav>
        <div className="sidebar-bottom">
          <p className="sidebar-user" title={user?.email}>
            {user?.name}
          </p>
          <a className="sidebar-link" href="/" target="_blank" rel="noopener">
            Ver vitrine
          </a>
          <button type="button" className="sidebar-link" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="menu-icon" aria-hidden="true" />
            <span className="sr-only">{menuOpen ? 'Fechar menu' : 'Abrir menu'}</span>
          </button>
          <span className="topbar-brand">
            <Brand />
          </span>
          <BlackFridayCountdown />
          <RunButton />
        </header>

        {menuOpen && (
          <nav id="mobile-nav" className="mobile-nav" aria-label="Seções do painel">
            <NavLinks onNavigate={() => setMenuOpen(false)} />
            <div className="mobile-nav-foot">
              <a className="nav-link" href="/" target="_blank" rel="noopener">
                Ver vitrine
              </a>
              <button type="button" className="nav-link" onClick={() => void logout()}>
                Sair ({user?.name})
              </button>
            </div>
          </nav>
        )}

        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
