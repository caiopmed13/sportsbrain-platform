// ════════════════════════════════════════════════════════════════════
// Market Radar — unifica Value Scanner, Arbitragem, Middles, Steam
// ════════════════════════════════════════════════════════════════════
import { useState, lazy, Suspense } from 'react'
import { Telescope, GitCompare, Scissors, Flame } from 'lucide-react'

const ValueScanner = lazy(() => import('./ValueScanner'))
const Arbitrage    = lazy(() => import('./Arbitrage'))
const Middles      = lazy(() => import('./Middles'))
const SteamRadar   = lazy(() => import('./SteamRadar'))

const TABS = [
  { id: 'value', label: 'Value',      Icon: Telescope,  Comp: ValueScanner },
  { id: 'arb',   label: 'Arbitragem', Icon: GitCompare, Comp: Arbitrage    },
  { id: 'mids',  label: 'Middles',    Icon: Scissors,   Comp: Middles      },
  { id: 'steam', label: 'Steam',      Icon: Flame,      Comp: SteamRadar   },
]

export default function MarketRadar() {
  const [tab, setTab] = useState('value')
  const Active = TABS.find(t => t.id === tab)?.Comp || ValueScanner

  return (
    <div>
      <div style={{
        display:'flex', gap:6, padding:'4px', background:'var(--c-card,#0d1117)',
        border:'1px solid var(--border,rgba(255,255,255,.07))', borderRadius:10,
        marginBottom:16, overflowX:'auto', flexWrap:'wrap',
      }}>
        {TABS.map(t => {
          const active = t.id === tab
          const Icon = t.Icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex:'1 1 auto', minWidth:110, padding:'10px 14px',
                background: active ? 'var(--accent-gradient,linear-gradient(135deg,#4a9eff,#00e08f))' : 'transparent',
                color: active ? '#fff' : 'var(--t2,#94a3b8)',
                border:'none', borderRadius:8, cursor:'pointer',
                fontSize:13, fontWeight:600, display:'flex',
                alignItems:'center', justifyContent:'center', gap:8,
                transition:'all .15s',
              }}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      <Suspense fallback={<div style={{padding:40,textAlign:'center',color:'var(--t3,#64748b)'}}>Carregando…</div>}>
        <Active />
      </Suspense>
    </div>
  )
}
