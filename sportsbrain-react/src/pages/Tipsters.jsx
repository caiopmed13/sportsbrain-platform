// ═══════════════════════════════════════════════════════════════════════════
// Tipsters.jsx — Leaderboard tipsters Telegram + jackpots + filtros
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { Trophy, Filter, TrendingUp, Activity, Zap } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://sportsbrain-api.sportsbrain-api.workers.dev'

function fmt(n) { return (n == null || isNaN(n)) ? '—' : (typeof n === 'number' ? n.toFixed(1) : n) }
function pct(n) { return (n == null || isNaN(n)) ? '—' : `${n.toFixed(1)}%` }

export default function Tipsters() {
  const [tab, setTab] = useState('leaderboard')   // 'leaderboard' | 'follow'
  const [tipsters, setTipsters] = useState([])
  const [scores, setScores] = useState([])
  const [report, setReport] = useState(null)
  const [followTips, setFollowTips] = useState([])
  const [followLoading, setFollowLoading] = useState(false)
  const [followChannel, setFollowChannel] = useState('FAIXA VIP')
  const [followMinOdd, setFollowMinOdd] = useState(5)
  const [followHours, setFollowHours] = useState(12)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [days, setDays] = useState(180)
  const [sortBy, setSortBy] = useState('tips')

  // Carrega tips do tipster selecionado
  function loadFollowTips() {
    setFollowLoading(true)
    fetch(`${API_BASE}/v1/telegram/follow-tipster?channel=${encodeURIComponent(followChannel)}&min_odd=${followMinOdd}&hours=${followHours}`)
      .then(r => r.json())
      .then(d => { setFollowTips(d.tips || []); setFollowLoading(false) })
      .catch(() => setFollowLoading(false))
  }

  useEffect(() => {
    if (tab === 'follow') loadFollowTips()
  }, [tab, followChannel, followMinOdd, followHours])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/v1/telegram/tipsters?days=${days}`).then(r => r.json()),
      fetch(`${API_BASE}/v1/telegram/tipster-quality-score`).then(r => r.json()),
      fetch(`${API_BASE}/v1/telegram/report?days=${days}`).then(r => r.json()),
    ]).then(([t, s, r]) => {
      setTipsters(t.tipsters || [])
      setScores(s.scores || [])
      setReport(r)
      setLoading(false)
    }).catch(e => { console.error(e); setLoading(false) })
  }, [days])

  const filtered = useMemo(() => {
    let arr = [...tipsters]
    if (filter === 'resolved') arr = arr.filter(t => t.wins + t.losses > 0)
    if (filter === 'high_volume') arr = arr.filter(t => t.total_tips >= 10)
    if (filter === 'profitable') arr = arr.filter(t => (t.roi_pct || -100) > 0)
    arr.sort((a, b) => {
      if (sortBy === 'tips') return (b.total_tips || 0) - (a.total_tips || 0)
      if (sortBy === 'wr') return (b.win_rate || 0) - (a.win_rate || 0)
      if (sortBy === 'roi') return (b.roi_pct || -1000) - (a.roi_pct || -1000)
      if (sortBy === 'odd') return (b.avg_odd || 0) - (a.avg_odd || 0)
      return 0
    })
    return arr
  }, [tipsters, filter, sortBy])

  const overall = report?.overall || {}
  const profitableScores = scores.filter(s => s.tqs >= 55 && s.ev_pct > 0).slice(0, 15)

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Trophy size={24} style={{ color: 'var(--green)' }} />
        <h1 style={{ margin: 0, fontSize: 22 }}>Tipsters Telegram</h1>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--t3)' }}>
          {tipsters.length} canais · {overall.total_tips || 0} tips · {overall.resolved || 0} resolvidas
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'leaderboard', label: '🏆 Leaderboard' },
          { id: 'follow',      label: '🔥 Follow Tipster' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px', background: 'none',
              border: 'none', borderBottom: tab === t.id ? '2px solid var(--green)' : '2px solid transparent',
              color: tab === t.id ? 'var(--t1)' : 'var(--t3)',
              cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
            }}>{t.label}</button>
        ))}
      </div>

      {/* TAB FOLLOW TIPSTER */}
      {tab === 'follow' && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" value={followChannel} onChange={e => setFollowChannel(e.target.value)} placeholder="Canal (ex: FAIXA VIP)"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--t1)', padding: '7px 10px', borderRadius: 6, fontSize: 13, width: 200 }} />
            <label style={{ fontSize: 12, color: 'var(--t3)' }}>Odd ≥ </label>
            <input type="number" step="0.5" value={followMinOdd} onChange={e => setFollowMinOdd(parseFloat(e.target.value) || 0)}
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--t1)', padding: '7px 10px', borderRadius: 6, fontSize: 13, width: 80 }} />
            <select value={followHours} onChange={e => setFollowHours(parseInt(e.target.value, 10))}
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--t1)', padding: '7px 10px', borderRadius: 6, fontSize: 13 }}>
              <option value={6}>6h</option>
              <option value={12}>12h</option>
              <option value={24}>24h</option>
              <option value={48}>48h</option>
            </select>
            <button onClick={loadFollowTips} style={{ padding: '7px 14px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              Atualizar
            </button>
          </div>

          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
            {followLoading ? (
              <div style={{ color: 'var(--t3)' }}>Carregando…</div>
            ) : followTips.length === 0 ? (
              <div style={{ color: 'var(--t3)', textAlign: 'center', padding: 30 }}>
                Sem tips nos últimos {followHours}h pra "{followChannel}" com odd ≥ {followMinOdd}
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--t3)' }}>
                  📋 {followTips.length} tips · odd média {(followTips.reduce((s, t) => s + (t.odd || 0), 0) / followTips.length).toFixed(2)}
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {followTips.map((t, i) => (
                    <div key={i} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <strong style={{ fontSize: 13, color: 'var(--t1)' }}>{t.channel_name?.slice(0, 35)}</strong>
                        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                          {new Date(t.posted_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {t.ocr_extracted ? <span style={{ fontSize: 10, padding: '2px 6px', background: 'var(--blue-dim)', color: 'var(--blue)', borderRadius: 3 }}>OCR</span> : null}
                        <span style={{ marginLeft: 'auto', fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>@{t.odd}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--t2)', marginBottom: 6 }}>
                        <span><strong>{t.market}</strong> {t.market_tag} {t.line ? `(L=${t.line})` : ''}</span>
                        {t.teams && t.teams.length > 0 && <span style={{ color: 'var(--t3)' }}>{t.teams.join(' x ')}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>
                        {(t.raw_text || '').slice(0, 200)}{(t.raw_text || '').length > 200 ? '…' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'leaderboard' && (
      <>
      {/* leaderboard content abaixo */}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Tips', val: overall.total_tips || 0, color: 'var(--blue)' },
          { label: 'WR Geral', val: pct(overall.overall_win_rate), color: 'var(--green)' },
          { label: 'ROI Médio', val: pct(overall.overall_roi), color: overall.overall_roi > 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'Tipsters', val: tipsters.length, color: 'var(--amber)' },
        ].map((k, i) => (
          <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color, marginTop: 4 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Filter size={16} style={{ color: 'var(--t3)' }} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--t1)', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
          <option value="all">Todos</option>
          <option value="resolved">Com W/L</option>
          <option value="high_volume">10+ tips</option>
          <option value="profitable">ROI &gt; 0</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--t1)', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
          <option value="tips">Volume</option>
          <option value="wr">WR</option>
          <option value="roi">ROI</option>
          <option value="odd">Avg Odd</option>
        </select>
        <select value={days} onChange={e => setDays(parseInt(e.target.value, 10))} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--t1)', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
          <option value={180}>180 dias</option>
          <option value={365}>1 ano</option>
        </select>
      </div>

      {loading && <div style={{ color: 'var(--t3)', padding: 20 }}>Carregando…</div>}

      {/* Buckets profitáveis (Top TQS) */}
      {!loading && profitableScores.length > 0 && (
        <div style={{ background: 'rgba(34, 212, 160, 0.05)', border: '1px solid var(--green)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Zap size={16} style={{ color: 'var(--green)' }} />
            <strong style={{ color: 'var(--green)' }}>BUCKETS PROFITÁVEIS</strong>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>(TQS ≥ 55% + EV positivo)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {profitableScores.map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', marginBottom: 4 }}>
                  {s.channel_name?.slice(0, 30)}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--t3)' }}>
                  <span>{s.market} · {s.odd_band}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--green)' }}>TQS {s.tqs}%</span>
                  <span style={{ color: s.ev_pct > 0 ? 'var(--green)' : 'var(--red)' }}>EV {s.ev_pct > 0 ? '+' : ''}{s.ev_pct}%</span>
                  <span style={{ color: 'var(--t3)' }}>N={s.n}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: 10, textAlign: 'left' }}>#</th>
              <th style={{ padding: 10, textAlign: 'left' }}>Canal</th>
              <th style={{ padding: 10, textAlign: 'right' }}>Tips</th>
              <th style={{ padding: 10, textAlign: 'right' }}>W</th>
              <th style={{ padding: 10, textAlign: 'right' }}>L</th>
              <th style={{ padding: 10, textAlign: 'right' }}>Pend</th>
              <th style={{ padding: 10, textAlign: 'right' }}>WR</th>
              <th style={{ padding: 10, textAlign: 'right' }}>ROI</th>
              <th style={{ padding: 10, textAlign: 'right' }}>Avg Odd</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => {
              const wr = t.win_rate
              const roi = t.roi_pct
              return (
                <tr key={t.channel_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 10, color: 'var(--t3)' }}>{i + 1}</td>
                  <td style={{ padding: 10, fontWeight: 500 }}>{t.channel_name}</td>
                  <td style={{ padding: 10, textAlign: 'right', fontWeight: 600 }}>{t.total_tips}</td>
                  <td style={{ padding: 10, textAlign: 'right', color: 'var(--green)' }}>{t.wins}</td>
                  <td style={{ padding: 10, textAlign: 'right', color: 'var(--red)' }}>{t.losses}</td>
                  <td style={{ padding: 10, textAlign: 'right', color: 'var(--t3)' }}>{t.pending}</td>
                  <td style={{ padding: 10, textAlign: 'right', color: wr >= 50 ? 'var(--green)' : 'var(--t3)' }}>
                    {pct(wr)}
                  </td>
                  <td style={{ padding: 10, textAlign: 'right', color: roi > 0 ? 'var(--green)' : roi < 0 ? 'var(--red)' : 'var(--t3)' }}>
                    {pct(roi)}
                  </td>
                  <td style={{ padding: 10, textAlign: 'right' }}>{fmt(t.avg_odd)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Análise por odd_band */}
      {report?.by_odd_band && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>📊 Por Faixa de Odd</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {report.by_odd_band.map((b, i) => (
              <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase' }}>Odd {b.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: b.win_rate > 50 ? 'var(--green)' : 'var(--t1)', marginTop: 4 }}>
                  {pct(b.win_rate)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                  {b.wins}W · {b.losses}L · {b.total} total
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}
