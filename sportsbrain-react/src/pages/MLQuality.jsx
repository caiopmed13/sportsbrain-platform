// ═══ ML Quality — dashboard do pipeline de training + calibração ═══
// Consome:
//   GET  /v1/admin/ml/quality/baseline     → Brier/log-loss/acc por (sport,market)
//   GET  /v1/admin/ml/quality/calibration  → curva (avg_p vs win_rate) em bins
//   POST /v1/admin/ml/calibration/fit      → Platt scaling fit (salva em KV)
//   GET  /v1/admin/ml/training/stats       → contagem de samples por mercado
//
// Precisa admin key (mesma do banca365/settings).
import { useEffect, useState } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'

const API = 'https://sportsbrain-api.sportsbrain-api.workers.dev'
const ADMIN_KEY_STORAGE = 'sb_admin_key'

async function adminGet(path, key) {
  const r = await fetch(`${API}${path}`, { headers: { 'X-Admin-Key': key } })
  return r.json()
}
async function adminPost(path, body, key) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
    body: JSON.stringify(body || {}),
  })
  return r.json()
}

// Mini chart barra: aceita [{label, value, max, color}]
function MiniBars({ rows, valueFmt = v => v?.toFixed(3) }) {
  const max = Math.max(...rows.map(r => r.value || 0), 0.01)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 70px', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <div style={{ color: 'var(--t2)', fontFamily: "'JetBrains Mono', monospace" }}>{r.label}</div>
          <div style={{ background: 'var(--b3)', height: 14, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (r.value / max) * 100)}%`,
              height: '100%',
              background: r.color || 'var(--blue)',
            }} />
          </div>
          <div style={{ color: r.color || 'var(--blue)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, textAlign: 'right' }}>
            {valueFmt(r.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

// Reliability diagram — compara avg_p vs win_rate por bin
function ReliabilityDiagram({ curve }) {
  const W = 380, H = 220, P = 30
  const points = curve.filter(c => c.avg_p != null && c.win_rate != null)
  if (points.length === 0) return <EmptyState title="Sem dados suficientes" />
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto' }}>
      {/* eixos */}
      <line x1={P} y1={H - P} x2={W - 10} y2={H - P} stroke="var(--border)" />
      <line x1={P} y1={10} x2={P} y2={H - P} stroke="var(--border)" />
      {/* diagonal perfeita */}
      <line x1={P} y1={H - P} x2={W - 10} y2={10} stroke="var(--green)" strokeDasharray="4 4" opacity="0.5" />
      {/* pontos */}
      {points.map((p, i) => {
        const x = P + p.avg_p * (W - 10 - P)
        const y = (H - P) - p.win_rate * (H - P - 10)
        const size = Math.max(3, Math.min(10, Math.sqrt(p.n) * 2))
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={size} fill="var(--blue)" opacity="0.7" />
            <title>{`p=${p.avg_p.toFixed(2)} win=${(p.win_rate * 100).toFixed(0)}% n=${p.n}`}</title>
          </g>
        )
      })}
      {/* labels */}
      <text x={P} y={H - 6} fontSize="10" fill="var(--mute)" fontFamily="monospace">0</text>
      <text x={W - 20} y={H - 6} fontSize="10" fill="var(--mute)" fontFamily="monospace">1</text>
      <text x={4} y={14} fontSize="10" fill="var(--mute)" fontFamily="monospace">1</text>
      <text x={W / 2 - 40} y={H - 5} fontSize="10" fill="var(--t2)" fontFamily="monospace">prob prevista</text>
      <text x={8} y={H / 2} fontSize="10" fill="var(--t2)" fontFamily="monospace" transform={`rotate(-90 8 ${H / 2})`}>win rate real</text>
    </svg>
  )
}

const MARKETS = [
  { v: '',        label: 'Todos' },
  { v: 'spread',  label: 'Spread' },
  { v: 'total',   label: 'Total' },
  { v: 'h2h',     label: 'H2H' },
]
const SPORTS = [
  { v: '',           label: 'Todos' },
  { v: 'basketball', label: 'Basquete' },
  { v: 'soccer',     label: 'Futebol' },
]

export default function MLQuality() {
  const [adminKey, setAdminKey]   = useState(() => localStorage.getItem(ADMIN_KEY_STORAGE) || '')
  const [sport, setSport]         = useState('')
  const [market, setMarket]       = useState('')
  const [baseline, setBaseline]   = useState(null)
  const [curve, setCurve]         = useState(null)
  const [stats, setStats]         = useState(null)
  const [calibration, setCalibration] = useState(null)
  const [loading, setLoading]     = useState(false)
  const [err, setErr]             = useState('')

  async function loadAll() {
    if (!adminKey) { setErr('Admin key obrigatória'); return }
    setLoading(true); setErr('')
    localStorage.setItem(ADMIN_KEY_STORAGE, adminKey)
    try {
      const qs = new URLSearchParams({ ...(sport && { sport }), ...(market && { market }) }).toString()
      const [b, c, s] = await Promise.all([
        adminGet(`/v1/admin/ml/quality/baseline?min_resulted=5&${qs}`, adminKey),
        adminGet(`/v1/admin/ml/quality/calibration?bins=10&${qs}`, adminKey),
        adminGet(`/v1/admin/ml/training/stats`, adminKey),
      ])
      setBaseline(b); setCurve(c); setStats(s)
    } catch (e) {
      setErr(String(e.message || e))
    } finally { setLoading(false) }
  }

  async function fitCalibration() {
    if (!adminKey) return
    setLoading(true)
    try {
      const r = await adminPost('/v1/admin/ml/calibration/fit', { sport, market }, adminKey)
      setCalibration(r)
    } finally { setLoading(false) }
  }

  useEffect(() => { if (adminKey) loadAll() /* eslint-disable-line */ }, [])

  const breakdown = baseline?.breakdown || {}
  const breakdownRows = Object.entries(breakdown).map(([k, v]) => ({
    label: k, n: v.n, brier: v.brier, ll: v.log_loss, acc: v.accuracy,
  }))

  return (
    <div>
      <PageHeader
        title="🧪 ML Quality"
        subtitle="Baseline (no-vig), calibração, Platt scaling — Fases 2/3 do roadmap"
      />

      {/* Admin key input */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: 'var(--r2)', padding: 14, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="password"
            placeholder="Admin key (X-Admin-Key)"
            value={adminKey}
            onChange={e => setAdminKey(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--t1)' }}
          />
          <select value={sport} onChange={e => setSport(e.target.value)} style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
            {SPORTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <select value={market} onChange={e => setMarket(e.target.value)} style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--bg)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
            {MARKETS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <button onClick={loadAll} disabled={loading} className="btn btn-primary" style={{ padding: '8px 14px' }}>
            {loading ? 'Carregando…' : '🔄 Atualizar'}
          </button>
          <button onClick={fitCalibration} disabled={loading || !adminKey} className="btn" style={{ padding: '8px 14px' }}>
            🎯 Fit Platt
          </button>
        </div>
        {err && <div style={{ color: 'var(--red)', marginTop: 8, fontSize: 12 }}>{err}</div>}
      </div>

      {/* KPIs topo */}
      {baseline?.overall && (
        <KpiRow>
          <Kpi label="Samples" value={baseline.n} color="var(--blue)" />
          <Kpi label="Brier" value={baseline.overall.brier?.toFixed(3)} color="var(--amber)" sub="< 0.25 = bom" />
          <Kpi label="Log-loss" value={baseline.overall.log_loss?.toFixed(3)} color="var(--purple)" sub="< 0.69 = melhor q random" />
          <Kpi label="Accuracy" value={(baseline.overall.accuracy * 100).toFixed(1) + '%'} color="var(--green)" />
        </KpiRow>
      )}

      {/* Insufficient data */}
      {baseline?.status === 'insufficient_data' && (
        <EmptyState
          title={`Dados insuficientes — ${baseline.n || 0} samples (precisa ${baseline.required || 20})`}
          subtitle="Deixa o coletor automático rodar mais dias. Cada partida finalizada vira 1 sample."
        />
      )}

      {/* Breakdown por mercado */}
      {breakdownRows.length > 0 && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 16, marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: 'var(--t1)' }}>
            Brier por mercado <span style={{ color: 'var(--mute)', fontSize: 11 }}>(menor = melhor)</span>
          </h3>
          <MiniBars rows={breakdownRows.map(r => ({ label: r.label, value: r.brier, color: r.brier < 0.22 ? 'var(--green)' : r.brier < 0.25 ? 'var(--amber)' : 'var(--red)' }))} />
          <h3 style={{ margin: '18px 0 12px', fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: 'var(--t1)' }}>
            Accuracy por mercado
          </h3>
          <MiniBars
            rows={breakdownRows.map(r => ({ label: r.label, value: r.acc, color: r.acc >= 0.55 ? 'var(--green)' : 'var(--amber)' }))}
            valueFmt={v => (v * 100).toFixed(1) + '%'}
          />
        </div>
      )}

      {/* Reliability diagram */}
      {curve?.curve && curve.n >= 10 && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 16, marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: 'var(--t1)' }}>
            Curva de calibração <span style={{ color: 'var(--mute)', fontSize: 11 }}>(pontos próximos da diagonal = bem calibrado)</span>
          </h3>
          <ReliabilityDiagram curve={curve.curve} />
          <div style={{ fontSize: 11, color: 'var(--mute)', fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
            n={curve.n} · bins={curve.bins}
          </div>
        </div>
      )}

      {/* Platt scaling resultado */}
      {calibration?.params && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 16, marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: 'var(--t1)' }}>
            🎯 Platt scaling fitado
          </h3>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.7, color: 'var(--t2)' }}>
            <div>a = <span style={{ color: 'var(--blue)' }}>{calibration.params.a?.toFixed(4)}</span>, b = <span style={{ color: 'var(--blue)' }}>{calibration.params.b?.toFixed(4)}</span></div>
            <div>n = {calibration.params.n} samples</div>
            <div>
              Log-loss antes: <span style={{ color: 'var(--red)' }}>{calibration.params.log_loss_before?.toFixed(4)}</span> →
              depois: <span style={{ color: 'var(--green)' }}>{calibration.params.log_loss_after?.toFixed(4)}</span>
              {calibration.params.log_loss_before > calibration.params.log_loss_after && <span style={{ color: 'var(--green)', marginLeft: 6 }}>✓ melhorou</span>}
            </div>
            <div style={{ marginTop: 6, color: 'var(--mute)' }}>Aplica via: <code>GET /v1/admin/ml/calibration/apply?p=0.65</code></div>
          </div>
        </div>
      )}

      {/* Training stats volume */}
      {stats?.stats?.length > 0 && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: 'var(--t1)' }}>
            Volume de training samples
          </h3>
          <table style={{ width: '100%', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--mute)', textAlign: 'left' }}>
                <th style={{ padding: 6 }}>Sport</th>
                <th style={{ padding: 6 }}>Market</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Total</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Finalizado</th>
                <th style={{ padding: 6, textAlign: 'right' }}>% label</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Gate XGB (500)</th>
              </tr>
            </thead>
            <tbody>
              {stats.stats.map((s, i) => {
                const pct = s.total ? (s.resulted / s.total * 100) : 0
                const gatePct = Math.min(100, (s.resulted / 500) * 100)
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 6 }}>{s.sport}</td>
                    <td style={{ padding: 6 }}>{s.market}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{s.total}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: 'var(--green)' }}>{s.resulted}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: 'var(--t2)' }}>{pct.toFixed(0)}%</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>
                      <div style={{ background: 'var(--b3)', height: 10, borderRadius: 2, overflow: 'hidden', width: 80, marginLeft: 'auto' }}>
                        <div style={{ width: `${gatePct}%`, height: '100%', background: gatePct >= 100 ? 'var(--green)' : 'var(--amber)' }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
