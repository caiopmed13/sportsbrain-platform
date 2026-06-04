// ══════════════════════════════════════════════════════════════════════
// Value Scanner v2 — REAL engine proprietário
// Usa /v1/odds/value do Worker (Pinnacle no-vig como fair anchor)
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { sbOddsValue } from '../api/client'

const SPORTS = [
  { key: null,         label: 'Todos' },
  { key: 'soccer',     label: 'Futebol' },
  { key: 'basketball', label: 'NBA' },
]

export default function ValueScanner() {
  const [sport, setSport] = useState(null)
  const [minEdge, setMinEdge] = useState(1.5)
  const [data, setData] = useState({ bets: [], count: 0 })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await sbOddsValue(sport, minEdge)
      setData(r)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }, [sport, minEdge])

  useEffect(() => { load() }, [load])

  const bets = data.bets || []
  const avgEdge = bets.length ? (bets.reduce((s, b) => s + b.edge_pct, 0) / bets.length).toFixed(2) : 0
  const topEdge = bets[0]?.edge_pct ?? 0

  return (
    <div>
      <PageHeader title="Value Scanner" subtitle="Sinais de EV teórico positivo vs Pinnacle no-vig (modo LAB · não validado em produção)" />

      <KpiRow>
        <Kpi label="EV teórico" value={data.count || 0} />
        <Kpi label="Edge teórico médio" value={`${avgEdge}%`} />
        <Kpi label="Top edge teórico" value={`${topEdge}%`} />
        <Kpi label="Min edge filter" value={`${minEdge}%`} />
      </KpiRow>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
        {SPORTS.map(s => (
          <button key={s.key || 'all'} onClick={() => setSport(s.key)}
            style={{
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
              background: sport === s.key ? 'rgba(59,130,246,.25)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${sport === s.key ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.1)'}`,
              color: 'var(--white)',
            }}>{s.label}</button>
        ))}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--soft)', fontSize: 12 }}>
          Min edge %:
          <input type="number" value={minEdge} step="0.5" min="0" onChange={e => setMinEdge(parseFloat(e.target.value) || 0)}
            style={{ width: 60, padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'var(--white)' }} />
        </label>
        <button onClick={load} disabled={loading} style={{
          padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
          background: 'rgba(34,212,160,.2)', border: '1px solid rgba(34,212,160,.5)', color: 'var(--green)',
        }}>{loading ? '…' : '↻ Atualizar'}</button>
      </div>

      {err && <div style={{ color: 'var(--red)', padding: 12 }}>⚠ {err}</div>}

      {!bets.length && !loading ? (
        <EmptyState title="Nenhum value bet agora" sub={`Sem edge ≥ ${minEdge}% no momento. Engine varre todos books a cada 5min.`} />
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {bets.map((b, i) => (
            <div key={i} style={{
              background: 'var(--card-bg)', border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 12, padding: '14px 16px',
              display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 14, alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--dim)', letterSpacing: '.04em' }}>{b.event_id}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)', marginTop: 3 }}>
                  {b.market.toUpperCase()} · <span style={{ color: 'var(--blue)' }}>{b.outcome}</span>
                  {b.line != null && <span style={{ color: 'var(--amber)' }}> {b.line > 0 ? '+' : ''}{b.line}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--soft)', marginTop: 2 }}>Book: <b>{b.book}</b> · Kelly: {(b.kelly_frac * 100).toFixed(2)}u</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--dim)' }}>ODD</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--white)' }}>{b.price}</div>
                <div style={{ fontSize: 10, color: 'var(--soft)' }}>fair: {b.fair_price}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--dim)' }}>EV</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)' }}>{b.ev_pct}%</div>
              </div>
              <div style={{ textAlign: 'center', padding: '4px 12px', background: 'rgba(34,212,160,.15)', border: '1px solid rgba(34,212,160,.4)', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--green)' }}>EDGE</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--green)' }}>{b.edge_pct}%</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
