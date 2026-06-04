/* ═══════════════════════════════════════════════════════════════════════════
   SportsBrain — TopBar v8 "Aragão"
   ─────────────────────────────────────────────────────────────────────
   Glass backdrop. Breadcrumb. Cmd+K search. Status, notif, theme.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Sun, Moon, Search, Menu } from 'lucide-react'
import { useUIStore } from '../../store'
import NotifyBell from '../ui/NotifyBell'

export default function TopBar({ onSearch }) {
  const {
    toggleSidebar, toggleTheme, theme, pageTitle,
    searchQuery, setSearch, apiStatus,
  } = useUIStore()

  const statusLabel =
    apiStatus === 'ok'      ? 'Online'   :
    apiStatus === 'err'     ? 'Offline'  :
    'Conectando'
  const statusVariant =
    apiStatus === 'ok'      ? 'edge'  :
    apiStatus === 'err'     ? 'neg'   :
    'risk'

  return (
    <header className="topbar">
      {/* Mobile menu */}
      <button
        className="btn btn--ghost btn--icon btn--sm topbar__menu-toggle"
        onClick={toggleSidebar}
        aria-label="Abrir menu"
      >
        <Menu size={18} strokeWidth={1.5} />
      </button>

      {/* Breadcrumb */}
      <div className="topbar__crumb">
        <span className="t-caption">SportsBrain</span>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">{pageTitle}</span>
      </div>

      {/* Search (modal-ready, cmd+k hint) */}
      <label className="topbar__search">
        <Search size={14} strokeWidth={1.5} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        <input
          type="search"
          placeholder="Buscar jogo, time, liga…"
          value={searchQuery}
          onChange={(e) => {
            setSearch(e.target.value)
            onSearch?.(e.target.value)
          }}
        />
        <kbd className="topbar__search-key">⌘K</kbd>
      </label>

      {/* Actions */}
      <div className="topbar__actions">
        {/* API status pill */}
        <span className={`pill pill--status pill--${statusVariant}`}>
          <span
            className="status-dot"
            style={{
              background:
                statusVariant === 'edge' ? 'var(--edge-500)' :
                statusVariant === 'neg'  ? 'var(--neg-500)'  :
                'var(--risk-500)',
              animation: apiStatus !== 'ok' ? 'live-pulse 1.6s infinite' : 'none',
            }}
          />
          {statusLabel}
        </span>

        <NotifyBell />

        <button
          className="btn btn--ghost btn--icon btn--sm"
          onClick={toggleTheme}
          aria-label="Alternar tema"
          title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        >
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
        </button>
      </div>
    </header>
  )
}
