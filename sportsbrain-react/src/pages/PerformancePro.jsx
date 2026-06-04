// ═══════════════════════════════════════════════════════════════════════════
// Performance Pro — dashboard consolidado de banca, picks, CLV, model health
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'

const API = 'https://sportsbrain-api.sportsbrain-api.workers.dev'

function fmtBRL(v) { return v == null ? '—' : 'R$ ' + (+v).toFixed(2).replace('.', ',') }

export default function PerformancePro() {
  const [history, setHistory] = useState([])
  const [clv, setClv] = useState([])
  const [health, setHealth] = useState({})
  const [backtest, setBacktest] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API}/v1/picks/history`).then(r => r.json()).catch(() => ({ picks: [] })),
      fetch(`${API}/v1/clv/summary`).then(r => r.json()).catch(() => ({ summary: [] })),
      fetch(`${API}/v1/intelligence/model-health`).then(r => r.json()).catch(() => ({ health: {} })),
      fetch(`${API}/v1/backtest/run?start=${new Date(Date.now() - 30*86400_000).toISOString().slice(0,10)}`).then(r => r.json()).catch(() => null),
    ]).then(([h, c, mh, bt]) => {
      if (cancelled) return
      setHistory(h.picks || [])
      setClv(c.summary || [])
      setHealth(mh.health || {})
      setBacktest(bt)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => {
    const resolved = history.filter(p => p.result === 'W' || p.result === 'L')
    const wins = resolved.filter(p => p.result === 'W').length
    const losses = resolved.filter(p => p.result === 'L').length
    const winRate = resolved.length ? +(wins / resolved.length * 100).toFixed(1) : null
    const avgOdd = resolved.length
      ? +(resolved.reduce((s, p) => s + (p.real_odd || 2), 0) / resolved.length).toFixed(2)
      : null
    const totalStaked = resolved.length // 1u por pick
    const totalReturn = resolved.filter(p => p.result === 'W').reduce((s, p) => s + (p.real_odd || 2), 0)
    const roiPct = totalStaked ? +((totalReturn - totalStaked) / totalStaked * 100).toFixed(1) : 0
    return { wins, losses, winRate, avgOdd, roiPct, totalResolved: resolved.length, totalAll: history.length }
  }, [history])

  const avgClv = useMemo(() => {
    if (!clv.length) return null
    const sum = clv.reduce((s, c) => s + (c.avg_clv || 0) * (c.n || 0), 0)
    const n = clv.reduce((s, c) => s + (c.n || 0), 0)
    return n ? +(sum / n).toFixed(2) : null
  }, [clv])

  if (loading) return <div className="page" style={{ padding: 30, textAlign: 'center', color: 'var(--mute)' }}>Carregando dashboard...</div>

  return (
    <div className="page page-padded">
      <PageHeader icon="📈" title="Performance Pro" subtitle="Dashboard consolidado: histórico, CLV, model health, backtest" />

      <KpiRow>
        <Kpi value={stats.totalResolved} label="Picks resolvidos" color="var(--soft)" />
        <Kpi value={stats.winRate ? `${stats.winRate}%` : '—'} label="Win rate" color={stats.winRate >= 55 ? 'var(--green)' : stats.winRate >= 45 ? 'var(--amber)' : 'var(--red)'} />
        <Kpi value={stats.avgOdd ? `@${stats.avgOdd}` : '—'} label="Odd média" color="var(--blue)" />
        <Kpi value={`${stats.roiPct >= 0 ? '+' : ''}${stats.roiPct}%`} label="ROI 1u flat" color={stats.roiPct >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Kpi value={avgClv != null ? `${avgClv >= 0 ? '+' : ''}${avgClv}%` : '—'} label="CLV avg" color={avgClv >= 0 ? 'var(--green)' : 'var(--red)'} />
      </KpiRow>

      {/* Backtest */}
      {backtest?.ok && (
        <section style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, color: 'var(--white)' }}>📊 Backtest últimos 30 dias</h3>
          <div style={{ fontSize: 11, color: 'var(--mute)', marginBottom: 8 }}>
            Total picks: {backtest.total_picks} · ROI global: <strong style={{color: backtest.global_roi_pct >= 0 ? 'var(--green)' : 'var(--red)'}}>{backtest.global_roi_pct}%</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {Object.entries(backtest.by_market || {}).slice(0, 12).map(([market, m]) => (
              <div key={market} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--mute)', textTransform: 'uppercase' }}>{market}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--white)', fontFamily: "'JetBrains Mono',monospace" }}>
                  {m.hit_rate}% <span style={{ fontSize: 10, color: 'var(--mute)' }}>n={m.sample}</span>
                </div>
                <div style={{ fontSize: 10, color: m.roi_pct >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "'JetBrains Mono',monospace" }}>
                  ROI {m.roi_pct >= 0 ? '+' : ''}{m.roi_pct}%
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Model health */}
      {!!Object.keys(health).length && (
        <section style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, color: 'var(--white)' }}>🩺 Saúde do modelo (calibração)</h3>
          <div style={{ fontSize: 10, color: 'var(--mute)', marginBottom: 8 }}>
            Compara confidence prevista vs hit rate real. Shift &gt; 8% = modelo descalibrado.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {Object.entries(health).map(([market, h]) => (
              <div key={market} style={{
                background: 'var(--card-bg)',
                border: `1px solid ${h.status === 'healthy' ? 'rgba(34,212,160,.3)' : h.status === 'underestimated' ? 'rgba(59,130,246,.3)' : 'rgba(239,68,68,.3)'}`,
                borderRadius: 8, padding: '8px 10px',
              }}>
                <div style={{ fontSize: 10, color: 'var(--mute)' }}>{market}</div>
                <div style={{ fontSize: 11, color: 'var(--white)', fontFamily: "'JetBrains Mono',monospace" }}>
                  prev {h.predicted_conf}% → real {h.actual_hit_rate}%
                </div>
                <div style={{ fontSize: 10, color: Math.abs(h.shift) > 8 ? 'var(--red)' : 'var(--green)' }}>
                  shift {h.shift >= 0 ? '+' : ''}{h.shift}% · {h.status}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CLV detalhado */}
      {!!clv.length && (
        <section style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, color: 'var(--white)' }}>📉 CLV por mercado/liga</h3>
          <table style={{ width: '100%', fontSize: 11 }}>
            <thead style={{ color: 'var(--mute)', fontFamily: "'JetBrains Mono',monospace" }}>
              <tr><th align="left">Mercado</th><th align="left">Liga</th><th align="right">CLV avg</th><th align="right">N</th></tr>
            </thead>
            <tbody>
              {clv.map((c, i) => (
                <tr key={i}>
                  <td style={{ padding: 4 }}>{c.stat}</td>
                  <td style={{ color: 'var(--mute)' }}>{c.league}</td>
                  <td align="right" style={{ color: c.avg_clv >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "'JetBrains Mono',monospace" }}>
                    {c.avg_clv >= 0 ? '+' : ''}{(+c.avg_clv).toFixed(2)}%
                  </td>
                  <td align="right" style={{ color: 'var(--mute)' }}>{c.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
