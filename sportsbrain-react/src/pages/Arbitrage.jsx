// ══════════════════════════════════════════════════════════════════════
// Arbitrage Finder — lucro garantido cross-book
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { sbOddsArbitrage } from '../api/client'

export default function Arbitrage() {
  const [sport, setSport] = useState(null)
  const [data, setData] = useState({ arbs: [], count: 0 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await sbOddsArbitrage(sport)) } catch {}
    setLoading(false)
  }, [sport])

  useEffect(() => { load() }, [load])
  const arbs = data.arbs || []
  const maxProfit = arbs[0]?.profit_pct ?? 0

  return (
    <div>
      <PageHeader title="Arbitragem" subtitle="Lucro garantido apostando em todos os resultados cross-book" />
      <KpiRow>
        <Kpi label="Arbs ativos" value={arbs.length} />
        <Kpi label="Melhor margem" value={`${maxProfit}%`} />
        <Kpi label="Última varredura" value={loading ? '…' : 'agora'} />
      </KpiRow>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        {[{k:null,l:'Todos'},{k:'soccer',l:'Futebol'},{k:'basketball',l:'NBA'}].map(s => (
          <button key={s.k || 'all'} onClick={() => setSport(s.k)}
            style={{
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
              background: sport === s.k ? 'rgba(59,130,246,.25)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${sport === s.k ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.1)'}`,
              color: 'var(--white)',
            }}>{s.l}</button>
        ))}
      </div>

      {!arbs.length && !loading ? (
        <EmptyState title="Sem arbs no momento" sub="Arbs são raros. Com mais books ingerindo (GH Actions + VPS), a taxa sobe." />
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {arbs.map((a, i) => (
            <div key={i} style={{
              background: 'var(--card-bg)', border: '1px solid rgba(34,212,160,.25)', borderRadius: 12, padding: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--dim)' }}>{a.event_id} · {a.market}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }}>+{a.profit_pct}%</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${a.legs.length}, 1fr)`, gap: 8 }}>
                {a.legs.map((leg, j) => (
                  <div key={j} style={{
                    background: 'rgba(34,212,160,.08)', border: '1px solid rgba(34,212,160,.2)',
                    borderRadius: 8, padding: 10, textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--dim)' }}>{leg.outcome}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)' }}>{leg.book}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--green)' }}>{leg.price}</div>
                    <div style={{ fontSize: 11, color: 'var(--soft)', marginTop: 3 }}>stake: {leg.stake}u</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
