// ══════════════════════════════════════════════════════════════════════
// Middles — diferença de linha entre books (ganhar as duas pontas)
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { sbOddsMiddles } from '../api/client'

export default function Middles() {
  const [data, setData] = useState({ middles: [], count: 0 })
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await sbOddsMiddles()) } catch {}
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const mids = data.middles || []

  return (
    <div>
      <PageHeader title="Middles" subtitle="Gaps de linha entre books — resultado no meio ganha ambas" />
      <KpiRow>
        <Kpi label="Middles ativos" value={mids.length} />
        <Kpi label="Maior gap" value={mids[0]?.gap ?? '—'} />
      </KpiRow>

      {!mids.length && !loading ? (
        <EmptyState title="Sem middles no momento" sub="Middles aparecem quando dois books discordam por ≥1 ponto. Mais books ingerindo = mais middles." />
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {mids.map((m, i) => (
            <div key={i} style={{
              background: 'var(--card-bg)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 12, padding: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--dim)' }}>{m.event_id} · {m.market}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--amber)' }}>gap {m.gap}</div>
              </div>
              {m.market === 'totals' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ padding: 10, background: 'rgba(59,130,246,.08)', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--dim)' }}>OVER em {m.over.book}</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{m.over.line}</div>
                    <div style={{ fontSize: 14, color: 'var(--green)' }}>{m.over.price}</div>
                  </div>
                  <div style={{ padding: 10, background: 'rgba(239,68,68,.08)', borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--dim)' }}>UNDER em {m.under.book}</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{m.under.line}</div>
                    <div style={{ fontSize: 14, color: 'var(--red)' }}>{m.under.price}</div>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--soft)', fontSize: 13 }}>Spread middle · {JSON.stringify(m)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
