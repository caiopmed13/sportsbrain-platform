/* ═══════════════════════════════════════════════════════════════════════════
   SportsBrain — Sidebar v8 "Aragão"
   ─────────────────────────────────────────────────────────────────────
   Editorial trading floor. Icon-only collapsible. Edge accent active state.
   Mobile drawer overlay with backdrop.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect } from 'react'
import {
  Zap, CalendarDays, Trophy, Bell, CircleDot, Bike, Radar, LayoutDashboard,
  TrendingUp, BarChart2, Brain, Camera, Telescope, LineChart, Dice5, Database,
  Settings, ChevronsLeft, ChevronsRight, Activity, ShieldCheck, Wallet,
  ClipboardList, Sparkles, GitCompare, Flame, Scissors, Rocket, Crown,
} from 'lucide-react'
import { useUIStore } from '../../store'

const ICON_MAP = {
  hub:        Zap,
  garantido:  ShieldCheck,
  hoje:       CalendarDays,
  jogosstats: CalendarDays,
  standings:  Trophy,
  alerts:     Bell,
  bkprops:    CircleDot,
  ftprops:    Bike,
  radar:      Radar,
  dash:       LayoutDashboard,
  perf:       TrendingUp,
  perfpro:    TrendingUp,
  stats:      BarChart2,
  lrn:        Brain,
  prints:     Camera,
  value:      Telescope,
  clv:        LineChart,
  a365:       Dice5,
  bk:         Database,
  settings:   Settings,
  banca365:   Wallet,
  boletim:    ClipboardList,
  palpites:   Sparkles,
  arb:        GitCompare,
  mids:       Scissors,
  steam:      Flame,
  mktradar:   Radar,
  compare:    GitCompare,
  mlq:        Activity,
  shadowmon:  Activity,
  boost:      Rocket,
  aument:     Rocket,
  bet365m:    Rocket,
  markets365: Activity,
  picks365:   Rocket,
  bet365pro:  Rocket,
  analise:    Activity,
  tipsters:   Trophy,
  combos:     Sparkles,
  premium:    Crown,
}

// Nav reorganizada — labels limpos, sem emoji em section
const NAV_GROUPS = [
  {
    label: 'Banca',
    items: [
      { id: 'banca365', label: 'Plano do dia', badge: 'nbPicksEV' },
    ],
  },
  {
    label: 'Jogos & Mercado',
    items: [
      { id: 'jogosstats', label: 'Jogos & Tabelas', badge: 'nbHoje', liveBadge: true },
      { id: 'bkprops',    label: 'NBA Props',       badge: 'nbBkProps' },
      { id: 'ftprops',    label: 'Futebol Props',   badge: 'nbFtProps' },
      { id: 'palpites',   label: 'Palpites do dia' },
      { id: 'aument',     label: 'Aumentadas Bet365' },
    ],
  },
  {
    label: 'Análise',
    items: [
      { id: 'analise',   label: 'Bet365 Pro',         badge: 'nbPicksEV' },
      { id: 'perfpro',   label: 'Performance' },
      { id: 'tipsters',  label: 'Tipsters Telegram' },
      { id: 'premium',   label: 'Premium VIP' },
      { id: 'combos',    label: 'Combos Multi-Legs' },
      { id: 'a365',      label: 'Análise 365 AI' },
      { id: 'alerts',    label: 'Alertas',            badge: 'nbAlerts' },
      { id: 'shadowmon', label: 'Shadow Monitor' },
    ],
  },
]

const BOTTOM_NAV = [
  { id: 'banca365',   label: 'Banca' },
  { id: 'jogosstats', label: 'Jogos' },
  { id: 'analise',    label: 'Análise' },
  { id: 'premium',    label: 'Premium' },
]

export const PAGE_TITLES = {
  hub:        'Picks de Hoje',
  garantido:  'Garantido',
  hoje:       'Jogos do Dia',
  jogosstats: 'Jogos & Tabelas',
  standings:  'Liga & Tabela',
  alerts:     'Alertas',
  bkprops:    'NBA Props',
  ftprops:    'Futebol Props',
  radar:      'Player Radar',
  dash:       'Dashboard',
  perf:       'Performance',
  perfpro:    'Performance',
  stats:      'Estatísticas',
  lrn:        'Aprendizado IA',
  prints:     'Print Analyzer',
  bk:         'Backup & Dados',
  log:        'Log API',
  value:      'Value Scanner',
  clv:        'CLV Tracker',
  a365:       'Análise 365 AI',
  settings:   'Configurações',
  banca365:   'Plano do Dia',
  boletim:    'Boletim do Dia',
  palpites:   'Palpites do Dia',
  boost:      'Boost Scanner',
  aument:     'Aumentadas Bet365',
  markets365: 'Markets Bet365',
  picks365:   'Picks Bet365',
  bet365pro:  'Bet365 Pro',
  analise:    'Bet365 Pro',
  bet365m:    'Jogos Bet365',
  arb:        'Arbitragem',
  mids:       'Middles',
  steam:      'Steam Radar',
  mktradar:   'Radar de Mercado',
  compare:    'Comparar Odds',
  mlq:        'ML Quality',
  shadowmon:  'Shadow Monitor',
  tipsters:   'Tipsters Telegram',
  premium:    'Premium VIP',
  combos:     'Combos Multi-Legs',
}

export default function Sidebar({ badges = {}, onNavigate }) {
  const {
    sidebarOpen, sidebarCollapsed, currentPage, apiStatus,
    toggleSidebar, toggleSidebarCollapse,
  } = useUIStore()
  const isIconOnly = sidebarCollapsed

  function handleNav(id) {
    onNavigate(id)
    if (window.innerWidth <= 768) toggleSidebar()
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && sidebarOpen && window.innerWidth <= 768) toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen, toggleSidebar])

  const statusDot = (
    <span
      className="sidebar-user__status-dot"
      style={{
        background: apiStatus === 'ok' ? 'var(--edge-500)'
                  : apiStatus === 'err' ? 'var(--neg-500)'
                  : 'var(--risk-500)',
      }}
    />
  )

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop${sidebarOpen ? ' visible' : ''}`}
        onClick={toggleSidebar}
        aria-hidden="true"
      />

      <aside
        className={`sidebar${sidebarOpen ? ' open' : ''}${isIconOnly ? ' icon-only' : ''}`}
      >
        {/* ─── Logo ─── */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">SB</div>
          {!isIconOnly && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sidebar-logo-title">SportsBrain</div>
                <div className="sidebar-logo-sub">v8 · Aragão</div>
              </div>
              <button
                onClick={toggleSidebarCollapse}
                aria-label="Colapsar sidebar"
                className="sidebar-collapse-btn"
                title="Colapsar (icon-only)"
              >
                <ChevronsLeft size={14} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>

        {isIconOnly && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-2) 0' }}>
            <button
              onClick={toggleSidebarCollapse}
              aria-label="Expandir sidebar"
              className="sidebar-collapse-btn"
              title="Expandir"
            >
              <ChevronsRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* ─── Nav ─── */}
        <nav className="nav">
          {NAV_GROUPS.map((group, gIdx) => (
            <div key={group.label}>
              {!isIconOnly && (
                <div className="nav-section-label">{group.label}</div>
              )}
              {isIconOnly && gIdx > 0 && (
                <div className="nav-section-divider" />
              )}
              {group.items.map((item) => {
                const IconComp = ICON_MAP[item.id] || Activity
                const isActive = currentPage === item.id
                const badgeCount = item.badge ? badges[item.badge] : 0
                return (
                  <button
                    key={item.id}
                    className={`nav-item${isActive ? ' active' : ''}`}
                    onClick={() => handleNav(item.id)}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    title={isIconOnly ? item.label : undefined}
                  >
                    <span className="nav-item__icon">
                      <IconComp size={18} strokeWidth={1.5} />
                    </span>
                    {!isIconOnly && (
                      <>
                        <span className="nav-item__label">{item.label}</span>
                        {item.liveBadge && badgeCount > 0 && (
                          <span className="nav-item__badge nav-item__badge--live">
                            <span className="live-dot" /> AO VIVO
                          </span>
                        )}
                        {!item.liveBadge && badgeCount > 0 && (
                          <span className="nav-item__badge">{badgeCount}</span>
                        )}
                      </>
                    )}
                    {isIconOnly && badgeCount > 0 && (
                      <span className="nav-item__dot" aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* ─── User (footer) ─── */}
        <div
          className="sidebar-user"
          onClick={() => handleNav('settings')}
          role="button"
          tabIndex={0}
        >
          <div className="sidebar-user__avatar">C</div>
          {!isIconOnly && (
            <>
              <div className="sidebar-user__meta">
                <div className="sidebar-user__name">Caio</div>
                <div className="sidebar-user__role">
                  {statusDot}
                  {apiStatus === 'ok' ? 'Pro · Online' : apiStatus === 'err' ? 'Offline' : 'Conectando'}
                </div>
              </div>
              <button
                className="btn btn--ghost btn--icon btn--sm"
                onClick={(e) => { e.stopPropagation(); handleNav('settings') }}
                aria-label="Configurações"
                title="Configurações"
              >
                <Settings size={14} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* ─── Mobile bottom nav ─── */}
      <nav className="bottom-nav" role="navigation" aria-label="Navegação rápida">
        {BOTTOM_NAV.map((item) => {
          const IconComp = ICON_MAP[item.id] || Activity
          const isActive = currentPage === item.id
          return (
            <button
              key={item.id}
              className={`bottom-nav-item${isActive ? ' active' : ''}`}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="bottom-nav-item__icon">
                <IconComp size={20} strokeWidth={isActive ? 2 : 1.5} />
              </span>
              <span className="bottom-nav-item__label">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
