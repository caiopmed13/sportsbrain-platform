// ═══════════════════════════════════════════════════════════════════════════
// Jogos & Stats — Combina Hoje (jogos do dia) + Standings (tabelas)
// ═══════════════════════════════════════════════════════════════════════════
// Tabs: Jogos do Dia | Tabelas
// Visão tipo Sofascore/R10 — partidas do dia c/ stats + ligas com classificação
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, useState } from 'react'

const Hoje      = lazy(() => import('./Hoje'))
const Standings = lazy(() => import('./Standings'))

const TABS = [
  { id: 'jogos', label: '📅 Jogos do Dia', desc: 'Live + agendados' },
  { id: 'tabelas', label: '🏆 Tabelas', desc: 'Classificação ligas' },
]

export default function JogosStats() {
  const [tab, setTab] = useState(() => localStorage.getItem('sb_jogosstats_tab') || 'jogos')

  function changeTab(id) {
    setTab(id)
    localStorage.setItem('sb_jogosstats_tab', id)
  }

  const ActivePage = tab === 'tabelas' ? Standings : Hoje

  return (
    <div className="page-container" style={{ paddingTop: 0 }}>
      {/* Tab strip — mobile-friendly */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)', borderBottom: '2px solid var(--line)',
        padding: '8px 0', marginBottom: 12,
        display: 'flex', gap: 6, overflowX: 'auto',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => changeTab(t.id)}
            style={{
              padding: '10px 16px',
              minWidth: 130, flex: 1,
              maxWidth: 200,
              background: tab === t.id ? 'rgba(94,203,255,.12)' : 'transparent',
              border: tab === t.id ? '1px solid #5ecbff' : '1px solid var(--line)',
              borderRadius: 6, cursor: 'pointer',
              color: tab === t.id ? '#5ecbff' : 'var(--soft)',
              fontWeight: tab === t.id ? 700 : 500,
              fontSize: 12, textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <div>{t.label}</div>
            <div style={{ fontSize: 9, color: 'var(--mute)', fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
          </button>
        ))}
      </div>

      <Suspense fallback={<div className="loading-center"><div className="spinner" /></div>}>
        <ActivePage />
      </Suspense>
    </div>
  )
}
