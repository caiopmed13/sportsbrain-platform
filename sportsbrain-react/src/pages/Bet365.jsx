// ═══════════════════════════════════════════════════════════════════════════
// Bet365 Pro — Página unificada com tabs (Picks | Markets | Aumentadas | History)
// ═══════════════════════════════════════════════════════════════════════════
// Consolida 3 páginas anteriores numa só pra economizar espaço e contexto.
// Compartilha header de KPIs, filtros e dados entre tabs.
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, useState } from 'react'
import PageHeader from '../components/ui/PageHeader'

const Picks365   = lazy(() => import('./Picks365'))
const Markets365 = lazy(() => import('./Markets365'))
const Aumentadas = lazy(() => import('./Aumentadas'))

const TABS = [
  { id: 'picks',   label: '🎯 Picks +EV', desc: 'EV+, Kelly, Combos' },
  { id: 'markets', label: '📊 Markets',   desc: '487+ mercados' },
  { id: 'aument',  label: '🚀 Aumentadas', desc: 'Boosts Bet365' },
]

export default function Bet365Pro() {
  const [tab, setTab] = useState(() => localStorage.getItem('sb_bet365_tab') || 'picks')

  function changeTab(id) {
    setTab(id)
    localStorage.setItem('sb_bet365_tab', id)
  }

  const ActivePage = tab === 'markets' ? Markets365 : tab === 'aument' ? Aumentadas : Picks365

  return (
    <div className="page-container" style={{ paddingTop: 0 }}>
      {/* Tab strip — sticky no topo */}
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
              padding: '10px 16px', minWidth: 130,
              background: tab === t.id ? 'rgba(94,203,255,.12)' : 'transparent',
              border: tab === t.id ? '1px solid #5ecbff' : '1px solid var(--line)',
              borderRadius: 6, cursor: 'pointer',
              color: tab === t.id ? '#5ecbff' : 'var(--soft)',
              fontWeight: tab === t.id ? 700 : 500,
              fontSize: 12,
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <div>{t.label}</div>
            <div style={{ fontSize: 9, color: 'var(--mute)', fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Página ativa */}
      <Suspense fallback={<div className="loading-center"><div className="spinner" /></div>}>
        <ActivePage />
      </Suspense>
    </div>
  )
}
