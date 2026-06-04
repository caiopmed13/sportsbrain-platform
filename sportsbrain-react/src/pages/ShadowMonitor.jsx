import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://sportsbrain-api.sportsbrain-api.workers.dev'

const STATUS_COLORS = {
  not_ready:            '#ef4444',
  lab_ready:            '#f97316',
  micro_test_ready:     '#eab308',
  beta_ready:           '#22c55e',
  sell_ready_candidate: '#3b82f6',
}

const STATUS_LABELS = {
  not_ready:            'Lab Only — Acumulando dados',
  lab_ready:            'Lab Ready — Continuando acúmulo',
  micro_test_ready:     'Micro Test Ready',
  beta_ready:           'Beta Ready',
  sell_ready_candidate: 'Sell Ready',
}

function ProgressBar({ pct, color = '#3b82f6' }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.08)', borderRadius: 6, height: 12, overflow: 'hidden', margin: '6px 0' }}>
      <div style={{
        width: `${Math.min(100, pct)}%`,
        height: '100%',
        background: color,
        borderRadius: 6,
        transition: 'width .5s ease',
      }} />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.04)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 16,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, mono = false, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,.6)' }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: mono ? "'JetBrains Mono', monospace" : undefined, fontWeight: 600, color: valueColor || 'rgba(255,255,255,.9)' }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

export default function ShadowMonitor() {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('sb_shadow_monitor_key') || '')
  const [days, setDays]         = useState(7)

  const fetchData = async () => {
    if (!adminKey.trim()) { setError('Admin key required'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/v1/admin/shadow-monitor?days=${days}`, {
        headers: { 'X-Admin-Key': adminKey.trim() },
      })
      if (res.status === 401) { setError('Invalid admin key'); setLoading(false); return }
      const json = await res.json()
      setData(json)
      localStorage.setItem('sb_shadow_monitor_key', adminKey.trim())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (adminKey.trim()) fetchData()
  }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateKey = (k) => {
    setAdminKey(k)
  }

  // ── Key input ──────────────────────────────────────────────────────────────
  if (!adminKey.trim() || error === 'Invalid admin key') {
    return (
      <div style={{ padding: 24, maxWidth: 480 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--white)', marginBottom: 8 }}>🔬 Shadow Monitor</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 20 }}>
          Monitoramento interno de shadow bets e progresso de readiness.
        </div>
        <input
          type="password"
          placeholder="Admin key (SB_MASTER_KEY)"
          value={adminKey}
          onChange={e => updateKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && fetchData()}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.15)',
            color: 'var(--white)', fontSize: 14, marginBottom: 12, boxSizing: 'border-box',
          }}
        />
        <button onClick={fetchData} style={{
          padding: '10px 24px', borderRadius: 8, background: '#3b82f6',
          color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
        }}>
          Carregar Monitor
        </button>
        {error && <div style={{ marginTop: 12, color: '#ef4444', fontSize: 13 }}>{error}</div>}
      </div>
    )
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'rgba(255,255,255,.5)', fontSize: 14 }}>Carregando shadow monitor…</div>
  }

  if (error && error !== 'Invalid admin key') {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 12 }}>Erro: {error}</div>
        <button onClick={fetchData} style={{ padding: '8px 20px', borderRadius: 8, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}>
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!data) return null

  const { readiness, accumulation, performance, clv, health, micro_test_progress: mtp, calibration_debug, resolution_health } = data

  const statusColor = STATUS_COLORS[readiness?.status] || '#6b7280'
  const pct = mtp?.sample_progress_pct ?? 0

  return (
    <div style={{ padding: '16px 20px', maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--white)' }}>🔬 Shadow Monitor</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
            Gerado: {data.generated_at?.slice(0, 19).replace('T', ' ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={days} onChange={e => setDays(+e.target.value)} style={{
            padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.15)', color: 'var(--white)', fontSize: 12,
          }}>
            {[3, 7, 14, 30].map(d => <option key={d} value={d}>{d}d</option>)}
          </select>
          <button onClick={fetchData} style={{
            padding: '6px 16px', borderRadius: 8, background: '#3b82f6',
            color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', border: 'none',
          }}>↺</button>
        </div>
      </div>

      {/* Status badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: `${statusColor}18`, border: `1px solid ${statusColor}50`,
        borderRadius: 10, padding: '10px 18px', marginBottom: 20,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor }} />
        <span style={{ fontWeight: 700, fontSize: 15, color: statusColor }}>
          {STATUS_LABELS[readiness?.status] || readiness?.status}
        </span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)' }}>Score: {readiness?.score}/100</span>
      </div>

      {/* Progress to micro_test */}
      <Section title="Progresso → Micro Test">
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.7)', marginBottom: 8 }}>
          <b style={{ color: 'var(--white)' }}>{accumulation?.resolved_valid ?? 0}</b> / 30 picks válidas resolvidas
          {(mtp?.missing_resolved_valid ?? 0) > 0 && (
            <span style={{ color: 'rgba(255,255,255,.4)', marginLeft: 8 }}>
              (faltam {mtp.missing_resolved_valid})
            </span>
          )}
        </div>
        <ProgressBar pct={pct} color={pct >= 100 ? '#22c55e' : '#3b82f6'} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
          {[
            { label: 'ROI ≥ -2%', met: mtp?.roi_requirement_met },
            { label: 'Unknown ≤ 20%', met: mtp?.unknown_requirement_met },
            { label: 'Market coverage ≥ 70%', met: mtp?.market_coverage_requirement_met },
            { label: 'Snapshot coverage ≥ 70%', met: mtp?.odds_snapshot_requirement_met },
          ].map(({ label, met }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: met === false ? '#ef4444' : '#22c55e' }}>{met === false ? '✗' : '✓'}</span>
              <span style={{ color: met === false ? '#ef4444' : 'rgba(255,255,255,.6)' }}>{label}</span>
            </div>
          ))}
        </div>

        {!readiness?.can_micro_test && (readiness?.blockers?.length ?? 0) > 0 && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,.08)', borderRadius: 8, borderLeft: '3px solid #ef4444' }}>
            {readiness.blockers.map((b, i) => (
              <div key={i} style={{ fontSize: 12, color: '#fca5a5' }}>⚠ {b}</div>
            ))}
          </div>
        )}
      </Section>

      {/* Accumulation */}
      <Section title="Acumulação">
        <Row label="Total shadow bets" value={accumulation?.shadow_bets_total} mono />
        <Row label="Main bets (training_eligible)" value={accumulation?.main_shadow_bets} mono />
        <Row label="Lab bets (observation)" value={accumulation?.lab_shadow_bets} mono />
        <Row label="Resolvidas válidas" value={accumulation?.resolved_valid} mono />
        <Row label="Pendentes válidas" value={accumulation?.pending_valid} mono />
      </Section>

      {/* Performance */}
      <Section title="Performance (valid-only)">
        <Row label="ROI" value={performance?.roi_valid_only !== null && performance?.roi_valid_only !== undefined ? `${Number(performance.roi_valid_only).toFixed(2)}%` : null} />
        <Row label="Win rate" value={performance?.win_rate_valid !== null && performance?.win_rate_valid !== undefined ? `${Number(performance.win_rate_valid).toFixed(1)}%` : null} />
        <Row label="Unknown rate" value={performance?.unknown_pct_valid !== null && performance?.unknown_pct_valid !== undefined ? `${Number(performance.unknown_pct_valid).toFixed(0)}%` : null} />
        <Row label="Avg odd" value={performance?.avg_odd_valid !== null && performance?.avg_odd_valid !== undefined ? Number(performance.avg_odd_valid).toFixed(2) : null} />
      </Section>

      {/* CLV */}
      <Section title="CLV">
        <Row label="CLV known" value={clv?.clv_known_pct !== null && clv?.clv_known_pct !== undefined ? `${(Number(clv.clv_known_pct) * 100).toFixed(0)}%` : '0%'} />
        <Row label="Positive CLV rate" value={clv?.positive_clv_rate !== null && clv?.positive_clv_rate !== undefined ? `${(Number(clv.positive_clv_rate) * 100).toFixed(0)}%` : null} />
        <Row label="Avg CLV %" value={clv?.avg_clv_pct !== null && clv?.avg_clv_pct !== undefined ? Number(clv.avg_clv_pct).toFixed(2) : null} />
        <Row label="CLV unknown count" value={clv?.clv_unknown_count} mono />
      </Section>

      {/* Calibration */}
      <Section title="Calibração (bet_confidence_tier)">
        <Row label="no_bet" value={calibration_debug?.tier_distribution?.no_bet} mono />
        <Row label="lab_only" value={calibration_debug?.tier_distribution?.lab_only} mono />
        <Row label="micro_test" value={calibration_debug?.tier_distribution?.micro_test} mono />
        <Row label="valid_bet" value={calibration_debug?.tier_distribution?.valid_bet} mono />
        <Row label="premium_bet" value={calibration_debug?.tier_distribution?.premium_bet} mono />
        <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 6, fontSize: 12, color: 'rgba(255,255,255,.5)' }}>
          Recomendação: <b style={{ color: 'var(--white)' }}>{calibration_debug?.recommendation}</b>
        </div>
      </Section>

      {/* Resolution health */}
      <Section title="Resolution Health">
        <Row label="Pending" value={resolution_health?.pending} mono />
        <Row label="Resolved" value={resolution_health?.resolved} mono />
        <Row label="Green ✓" value={resolution_health?.green} mono valueColor="#22c55e" />
        <Row label="Red ✗" value={resolution_health?.red} mono valueColor="#ef4444" />
        <Row label="Unknown (neutral)" value={resolution_health?.unknown} mono />
        <Row label="Void" value={resolution_health?.void} mono />
        <Row label="Avg settlement" value={resolution_health?.avg_settlement_delay_hours !== null && resolution_health?.avg_settlement_delay_hours !== undefined ? `${resolution_health.avg_settlement_delay_hours}h` : null} />
        {(resolution_health?.warnings?.length ?? 0) > 0 && (
          <div style={{ marginTop: 8 }}>
            {resolution_health.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: '#fbbf24', padding: '3px 0' }}>⚠ {w}</div>
            ))}
          </div>
        )}
      </Section>

      {/* Pipeline warnings */}
      {(data.pipeline_warnings?.length ?? 0) > 0 && (
        <Section title="⚠ Pipeline Warnings">
          {data.pipeline_warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#fbbf24', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              {w}
            </div>
          ))}
        </Section>
      )}

      {/* Disclaimer */}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.25)', padding: '12px 0', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,.05)' }}>
        {data.safety_disclaimer} {data.note}
      </div>
    </div>
  )
}
