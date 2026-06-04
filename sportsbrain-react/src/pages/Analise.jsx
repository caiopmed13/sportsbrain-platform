// ═══════════════════════════════════════════════════════════════════════════
// Análise — Mega-página unificada com TODAS as ferramentas em tabs
// ═══════════════════════════════════════════════════════════════════════════
// Consolida: Picks, Markets, Aumentadas, Comparar Odds, Radar Mercado,
// CLV Tracker, ML Quality, Jogos Bet365, Boost Scanner.
// Sidebar fica com 1 entry só. Tab persiste em localStorage.
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, useState } from 'react'

const Picks365      = lazy(() => import('./Picks365'))
const Markets365    = lazy(() => import('./Markets365'))
const Aumentadas    = lazy(() => import('./Aumentadas'))
const OddsCompare   = lazy(() => import('./OddsCompare'))
const Radar         = lazy(() => import('./Radar'))
const CLVTracker    = lazy(() => import('./CLVTracker'))
const MLQuality     = lazy(() => import('./MLQuality'))
const Bet365Matches = lazy(() => import('./Bet365Matches'))
const BoostScanner  = lazy(() => import('./BoostScanner'))

// Grupos de tabs com emoji + label + desc + componente
const GROUPS = [
  {
    id: 'bet365',
    label: '🚀 Bet365',
    color: '#00d68f',
    tabs: [
      { id: 'picks',      label: 'Picks +EV',     desc: 'EV+, Kelly, Combos',   Comp: Picks365 },
      { id: 'markets',    label: 'Markets',       desc: '487+ mercados',         Comp: Markets365 },
      { id: 'aument',     label: 'Aumentadas',    desc: 'Boost spotlights',      Comp: Aumentadas },
      { id: 'jogos',      label: 'Jogos',         desc: '1X2 schedule',          Comp: Bet365Matches },
      { id: 'scanner',    label: 'Boost Scanner', desc: 'Paste manual',          Comp: BoostScanner },
    ],
  },
  {
    id: 'analise',
    label: '📊 Análise',
    color: '#5ecbff',
    tabs: [
      { id: 'compare',  label: 'Comparar Odds', desc: 'Multi-book',          Comp: OddsCompare },
      { id: 'radar',    label: 'Radar Mercado', desc: 'Movimento de linha',  Comp: Radar },
      { id: 'clv',      label: 'CLV Tracker',   desc: 'Closing Line Value',  Comp: CLVTracker },
      { id: 'ml',       label: 'ML Quality',    desc: 'Modelos preditivos',  Comp: MLQuality },
    ],
  },
]

// Flat list pra lookup
const ALL_TABS = GROUPS.flatMap(g => g.tabs.map(t => ({ ...t, groupId: g.id, groupColor: g.color })))

export default function Analise() {
  const [tabId, setTabId] = useState(() => localStorage.getItem('sb_analise_tab') || 'picks')
  const activeTab = ALL_TABS.find(t => t.id === tabId) || ALL_TABS[0]
  const ActiveComp = activeTab.Comp

  function changeTab(id) {
    setTabId(id)
    localStorage.setItem('sb_analise_tab', id)
  }

  return (
    <div className="page-container" style={{ paddingTop: 0 }}>
      {/* Tab strip — sticky no topo, agrupado por seção */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', borderBottom: '2px solid var(--line)',
        padding: '8px 0', marginBottom: 12,
      }}>
        {GROUPS.map(g => (
          <div key={g.id} style={{ marginBottom: 6 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.08em',
              color: g.color, marginBottom: 4, marginLeft: 2,
            }}>
              {g.label}
            </div>
            <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
              {g.tabs.map(t => {
                const active = tabId === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => changeTab(t.id)}
                    style={{
                      padding: '6px 12px', minWidth: 100,
                      background: active ? `${g.color}20` : 'transparent',
                      border: active ? `1px solid ${g.color}` : '1px solid var(--line)',
                      borderRadius: 4, cursor: 'pointer',
                      color: active ? g.color : 'var(--soft)',
                      fontWeight: active ? 700 : 500,
                      fontSize: 11,
                      textAlign: 'left',
                      transition: 'all 0.15s',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div>{t.label}</div>
                    <div style={{ fontSize: 8, color: 'var(--mute)', fontWeight: 400, marginTop: 1 }}>{t.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Página ativa */}
      <Suspense fallback={<div className="loading-center"><div className="spinner" /></div>}>
        <ActiveComp />
      </Suspense>
    </div>
  )
}
