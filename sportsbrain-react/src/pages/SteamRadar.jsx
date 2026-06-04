// ══════════════════════════════════════════════════════════════════════
// Steam Radar — detecta movimentos sincronizados de sharp money
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { sbOddsAll, sbOddsSteam, sbOddsHold, sbOddsWidest } from '../api/client'

export default function SteamRadar() {
  const [events, setEvents] = useState([])
  const [alerts, setAlerts] = useState([])
  const [widest, setWidest] = useState([])
  const [hold, setHold] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [all, w, h] = await Promise.all([sbOddsAll(), sbOddsWidest(), sbOddsHold()])
      setEvents(all.events || [])
      setWidest((w.spreads || []).slice(0, 20))
      setHold(h.by_book || [])

      // Para cada evento, pega steam h2h home (em paralelo, max 10 pra não estourar)
      const ids = (all.events || []).slice(0, 10).map(e => e.id)
      const steams = await Promise.all(ids.map(id => sbOddsSteam(id, 'h2h', 'home').catch(() => null)))
      const active = []
      for (const s of steams) {
        if (s?.steam?.steam) active.push(s)
      }
      setAlerts(active)
    } catch {}
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <PageHeader title="Steam Radar" subtitle="Movimentos sincronizados 2h window · hold % · widest spreads" />
      <KpiRow>
        <Kpi label="Eventos varridos" value={events.length} />
        <Kpi label="🔥 Steam ativos" value={alerts.length} />
        <Kpi label="Spreads largos" value={widest.length} />
        <Kpi label="Books c/ vig calc" value={hold.length} />
      </KpiRow>

      <h3 style={{ color: 'var(--white)', marginTop: 22, fontSize: 13, letterSpacing: '.06em' }}>🔥 STEAM MOVES ATIVOS</h3>
      {!alerts.length && !loading && <EmptyState title="Nenhum steam agora" sub="Steam = ≥2 books moveram mesma direção em 10min" />}
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {alerts.map((a, i) => (
          <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid rgba(239,68,68,.4)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--dim)' }}>{a.event_id} · {a.market}/{a.outcome}</div>
            <div style={{ color: 'var(--red)', fontWeight: 700 }}>{a.steam.alert}</div>
          </div>
        ))}
      </div>

      <h3 style={{ color: 'var(--white)', marginTop: 22, fontSize: 13, letterSpacing: '.06em' }}>📊 HOLD % POR BOOK (menor = melhor pra apostador)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
        {hold.map((h, i) => (
          <div key={i} style={{ background: 'var(--card-bg)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--dim)' }}>{h.book}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: h.avg_hold_pct < 3 ? 'var(--green)' : h.avg_hold_pct < 6 ? 'var(--amber)' : 'var(--red)' }}>
              {h.avg_hold_pct}%
            </div>
            <div style={{ fontSize: 10, color: 'var(--soft)' }}>n={h.n} mercados</div>
          </div>
        ))}
      </div>

      <h3 style={{ color: 'var(--white)', marginTop: 22, fontSize: 13, letterSpacing: '.06em' }}>🎯 WIDEST SPREADS (melhor preço vs pior, cross-book)</h3>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {widest.map((w, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10,
            background: 'var(--card-bg)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 8, padding: '8px 12px', fontSize: 12,
          }}>
            <span style={{ color: 'var(--soft)' }}>{w.event_id.split('|').slice(0,2).join(' × ')} · {w.outcome}</span>
            <span style={{ color: 'var(--green)' }}>{w.best.book} <b>{w.best.price}</b></span>
            <span style={{ color: 'var(--red)' }}>{w.worst.book} {w.worst.price}</span>
            <span style={{ color: 'var(--amber)', fontWeight: 700 }}>+{w.spread_pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
