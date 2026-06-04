// ═══════════════════════════════════════════════════════════════════════════
// Picks 365 — Picks acionáveis baseado em EV+ vs cross-book / no-vig
// ═══════════════════════════════════════════════════════════════════════════
// Fluxo:
//   1. Lê /v1/bet365/markets/analyzed (markets com EV calculado)
//   2. Achata em "picks" individuais (cada selection = 1 pick)
//   3. Filtra EV ≥ threshold, ordena desc
//   4. Calcula Kelly stake por pick (input: banca + % máximo Kelly)
//   5. Combo builder: usuário seleciona N legs → joint prob + total odd + EV
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import Sparkline from '../components/ui/Sparkline'

const API_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'
const API_URL = API_BASE + '/v1/bet365/markets/analyzed'
const COMBOS_URL = API_BASE + '/v1/bet365/markets/suggested-combos'
const HISTORY_URL = API_BASE + '/v1/bet365/markets/history'

// User ID — gera uma vez por device, usado como X-User-Id em todas as chamadas
function getUserId() {
  let uid = localStorage.getItem('sb_uid')
  if (!uid) {
    uid = `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem('sb_uid', uid)
  }
  return uid
}

const MARKET_LABEL = {
  '1X2': 'Resultado',
  '1X2_ADJ': 'Resultado Adj',
  'BTTS': 'Ambos Marcam',
  'DOUBLE_CHANCE': 'Chance Dupla',
  'TOTAL_GOALS': 'Total Gols',
  'TOTAL_POINTS': 'Total Pontos',
  'CORNERS_OU': 'Escanteios',
  'CARDS_OU': 'Cartões',
  'CORRECT_SCORE': 'Resultado Correto',
  'HT_FT': 'HT/FT',
  'GOALS_RANGE': 'Faixa Gols',
  'PLAYER_SCORE': 'Marcador',
  'PLAYER_SCORE_OR_ASSIST': 'Gol ou Assist',
  'NBA_GAME_LINES': 'NBA Linha',
  'NBA_PLAYER_POINTS': 'NBA Pontos',
  'NBA_PLAYER_REBOUNDS': 'NBA Rebotes',
  'NBA_PLAYER_ASSISTS': 'NBA Assists',
  'NBA_DOUBLE_RESULT': 'NBA Dupla',
  'NBA_WINNING_MARGIN': 'NBA Margem',
}

// Kelly criterion: stake fraction = (bp - q) / b, onde b=odd-1, p=prob, q=1-p
function kellyFraction(odd, prob) {
  if (!odd || !prob || odd <= 1 || prob <= 0 || prob >= 1) return 0
  const b = odd - 1
  const q = 1 - prob
  const f = (b * prob - q) / b
  return Math.max(0, f)
}

// Achata markets em picks individuais (inclui picks com ev=null pra exibição)
function flattenPicks(matches) {
  const picks = []
  for (const M of matches || []) {
    for (const [mk, rows] of Object.entries(M.markets || {})) {
      for (const r of rows) {
        // Mercados O/U têm over/under em mesma row
        if (r.over != null && r.under != null) {
          picks.push({
            fixtureId: M.fixtureId, home: M.home, away: M.away,
            competition: M.competition, commenceTime: M.commenceTime,
            market: mk, selection: `Over ${r.line}`, line: r.line,
            odd: r.over, fairProb: r.overProb, ev: r.overEV ?? null,
          })
          picks.push({
            fixtureId: M.fixtureId, home: M.home, away: M.away,
            competition: M.competition, commenceTime: M.commenceTime,
            market: mk, selection: `Under ${r.line}`, line: r.line,
            odd: r.under, fairProb: r.underProb, ev: r.underEV ?? null,
          })
        } else if (r.odd != null) {
          picks.push({
            fixtureId: M.fixtureId, home: M.home, away: M.away,
            competition: M.competition, commenceTime: M.commenceTime,
            market: mk,
            selection: r.selection || r.player || r.maName || r.n2 || '?',
            line: r.line ?? null,
            odd: r.odd, fairProb: r.fairProb, ev: r.ev ?? null,
          })
        }
      }
    }
  }
  return picks
}

function pickKey(p) {
  return `${p.fixtureId}|${p.market}|${p.selection}|${p.line ?? ''}`
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

function evColor(ev) {
  if (ev >= 8)  return 'var(--green)'
  if (ev >= 3)  return '#5ecbff'
  if (ev >= 0)  return 'var(--amber)'
  return 'var(--red)'
}

function PickRow({ pick, selected, onToggle, bankroll, kellyMult }) {
  const f = kellyFraction(pick.odd, pick.fairProb || 0)
  const stake = bankroll && f > 0 ? (bankroll * f * kellyMult).toFixed(2) : null
  const ko = pick.commenceTime ? fmtTime(pick.commenceTime) : ''
  const [trajectory, setTrajectory] = useState(null)
  const [trajectoryLoaded, setTrajectoryLoaded] = useState(false)

  // Lazy-load trajectory ao expandir/hover (reduz custo)
  async function loadTrajectory() {
    if (trajectoryLoaded) return
    setTrajectoryLoaded(true)
    try {
      const params = new URLSearchParams({
        fid: String(pick.fixtureId),
        market: pick.market,
        selection: pick.selection || '',
      })
      if (pick.line != null) params.set('line', String(pick.line))
      const r = await fetch(HISTORY_URL + '?' + params.toString())
      const j = await r.json()
      if (j.ok) setTrajectory(j.points)
    } catch {}
  }

  return (
    <tr
      style={{ background: selected ? 'rgba(94,203,255,.08)' : 'transparent' }}
      onMouseEnter={loadTrajectory}
    >
      <td style={{ padding: '6px 8px' }}>
        <input type="checkbox" checked={selected} onChange={() => onToggle(pick)} />
      </td>
      <td style={{ padding: '6px 8px', fontSize: 11 }}>
        <div style={{ fontWeight: 600 }}>{pick.home} <span style={{ color: 'var(--mute)' }}>×</span> {pick.away}</div>
        <div style={{ color: 'var(--mute)', fontSize: 10 }}>{pick.competition || '?'} {ko && '· ' + ko}</div>
      </td>
      <td style={{ padding: '6px 8px', fontSize: 11, color: '#5ecbff' }}>{MARKET_LABEL[pick.market] || pick.market}</td>
      <td style={{ padding: '6px 8px', fontSize: 12, fontWeight: 600 }}>{pick.selection}</td>
      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{pick.odd?.toFixed(2)}</td>
      <td style={{ padding: '6px 8px' }}>
        {trajectory && trajectory.length >= 2 ? <Sparkline data={trajectory} width={60} height={18}/> : <span style={{ fontSize: 9, color: 'var(--mute)' }}>—</span>}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--mute)' }}>
        {pick.fairProb ? `${(pick.fairProb * 100).toFixed(1)}%` : '—'}
      </td>
      <td style={{ padding: '6px 8px', fontWeight: 700, color: pick.ev != null ? evColor(pick.ev) : 'var(--mute)' }}>
        {pick.ev != null ? `${pick.ev > 0 ? '+' : ''}${pick.ev.toFixed(1)}%` : <span style={{ fontSize: 10, fontStyle: 'italic' }}>sem ref</span>}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 11 }}>
        {stake != null && stake > 0 ? <span style={{ color: 'var(--green)' }}>R$ {stake}</span> : <span style={{ color: 'var(--mute)' }}>—</span>}
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Suggested Combos — gerados pelo backend, top 15 por EV
// ─────────────────────────────────────────────────────────────────────────
function SuggestedCombos({ combos, onLoad }) {
  if (!combos?.length) return null
  return (
    <div className="pick-card" style={{ padding: 14, marginTop: 16 }}>
      <h3 style={{ margin: 0, marginBottom: 12, fontSize: 13 }}>
        🤖 Combos Sugeridos <span style={{ fontWeight: 400, color: 'var(--mute)', fontSize: 11 }}>({combos.length} top combos +EV)</span>
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {combos.slice(0, 9).map((c, i) => (
          <div key={i} style={{
            padding: 10, background: 'rgba(168,85,247,.06)',
            border: '1px solid rgba(168,85,247,.25)', borderRadius: 6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#c084fc', fontWeight: 700 }}>{c.size}-leg combo</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: evColor(c.ev) }}>{c.ev > 0 ? '+' : ''}{c.ev}%</span>
            </div>
            {c.legs.map((l, j) => (
              <div key={j} style={{ fontSize: 10, color: 'var(--soft)', marginBottom: 3 }}>
                <span style={{ color: '#5ecbff' }}>{MARKET_LABEL[l.market] || l.market}</span>: <strong>{l.selection}</strong>
                <div style={{ color: 'var(--mute)', fontSize: 9 }}>{l.home} × {l.away} · odd {l.odd?.toFixed(2)}</div>
              </div>
            ))}
            <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--line)' }}>
              odd total <strong style={{ color: 'var(--white)' }}>{c.totalOdd?.toFixed(2)}</strong> · prob {(c.joint * 100).toFixed(1)}%
            </div>
            <button onClick={() => onLoad(c)} style={{
              width: '100%', marginTop: 6, padding: '4px',
              background: 'rgba(168,85,247,.15)', color: '#c084fc',
              border: '1px solid rgba(168,85,247,.4)', borderRadius: 3,
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
            }}>↑ Carregar combo</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// Calcula correlação entre 2 legs do mesmo jogo
// Retorna multiplicador da prob conjunta (>1 = positiva, <1 = negativa)
function pairCorrelation(a, b) {
  if (a.fixtureId !== b.fixtureId) return 1.0   // jogos diferentes = independente
  const ma = a.market, mb = b.market
  const sa = (a.selection || '').toLowerCase()
  const sb = (b.selection || '').toLowerCase()
  // Mesmo selection no mesmo mercado = mesma aposta (não soma)
  if (ma === mb && sa === sb) return 0
  // Resultado + BTTS Sim → casa marca implica BTTS Sim parcialmente
  if ((ma === '1X2' && mb === 'BTTS') || (ma === 'BTTS' && mb === '1X2')) {
    if (sa === 'yes' || sb === 'yes') return 1.15
    if (sa === 'no' || sb === 'no') return 0.85
  }
  // Resultado + Over 2.5 → time vencedor + over (correlação positiva forte)
  if ((ma === '1X2' && mb === 'TOTAL_GOALS') || (ma === 'TOTAL_GOALS' && mb === '1X2')) {
    const overUnder = sa.startsWith('over') || sb.startsWith('over') ? 'over' : (sa.startsWith('under') || sb.startsWith('under') ? 'under' : null)
    if (overUnder === 'over') return 1.10
    if (overUnder === 'under') return 0.95
  }
  // BTTS Sim + Over 2.5 → muito correlacionado positivo
  if ((ma === 'BTTS' && mb === 'TOTAL_GOALS') || (ma === 'TOTAL_GOALS' && mb === 'BTTS')) {
    const isYes = sa === 'yes' || sb === 'yes'
    const isOver = sa.startsWith('over') || sb.startsWith('over')
    if (isYes && isOver) return 1.20
    if (!isYes && !isOver) return 1.10  // Não BTTS + Under
  }
  // Player Score + Resultado do time dele → correlação leve
  if ((ma === 'PLAYER_SCORE' || ma === 'PLAYER_SCORE_OR_ASSIST') && mb === '1X2') return 1.05
  if (ma === '1X2' && (mb === 'PLAYER_SCORE' || mb === 'PLAYER_SCORE_OR_ASSIST')) return 1.05
  // Default: dentro do mesmo jogo, ~10% de correlação positiva genérica
  return 1.05
}

// Joint prob com correção de correlação (multiplicação iterativa)
function jointProbWithCorrelation(legs) {
  if (!legs.length) return 0
  let joint = legs[0].fairProb || 0
  for (let i = 1; i < legs.length; i++) {
    const leg = legs[i]
    let mult = leg.fairProb || 0
    // Aplica correlação contra cada leg anterior
    let corrBonus = 1.0
    for (let j = 0; j < i; j++) {
      corrBonus *= pairCorrelation(legs[j], leg)
    }
    joint *= mult * corrBonus
  }
  return Math.max(0, Math.min(1, joint))
}

function ComboPanel({ legs, onRemove, onClear, onSave }) {
  const sameMatchCount = useMemo(() => {
    const fids = legs.map(l => l.fixtureId)
    const uniq = new Set(fids).size
    return legs.length - uniq
  }, [legs])
  // Joint prob com correlação
  const jointIndep = legs.reduce((p, l) => p * (l.fairProb || 0), 1)
  const joint = jointProbWithCorrelation(legs)
  const totalOdd = legs.reduce((p, l) => p * (l.odd || 1), 1)
  const ev = joint > 0 && totalOdd > 1 ? +((joint * totalOdd - 1) * 100).toFixed(2) : 0
  const evIndep = jointIndep > 0 && totalOdd > 1 ? +((jointIndep * totalOdd - 1) * 100).toFixed(2) : 0
  const fairOdd = joint > 0 ? +(1 / joint).toFixed(2) : null

  return (
    <div className="pick-card" style={{ padding: 14, position: 'sticky', top: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>🎰 Combo ({legs.length} {legs.length === 1 ? 'leg' : 'legs'})</strong>
        {legs.length > 0 && (
          <button onClick={onClear} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--bg2)', border: '1px solid var(--line)', color: 'var(--soft)', borderRadius: 3, cursor: 'pointer' }}>
            limpar
          </button>
        )}
      </div>
      {legs.length === 0 ? (
        <div style={{ color: 'var(--mute)', fontSize: 12 }}>Selecione legs ↖</div>
      ) : (
        <>
          {legs.map((l, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--mute)' }}>{MARKET_LABEL[l.market] || l.market}</span>
                <button onClick={() => onRemove(l)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 0 }}>×</button>
              </div>
              <div style={{ fontWeight: 600 }}>{l.selection}</div>
              <div style={{ color: 'var(--mute)', fontSize: 10 }}>
                {l.home} × {l.away} · odd <strong>{l.odd?.toFixed(2)}</strong> · {(l.fairProb * 100).toFixed(0)}%
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '2px solid var(--line)' }}>
            {sameMatchCount > 0 && (
              <div style={{ background: 'rgba(168,85,247,.12)', border: '1px solid rgba(168,85,247,.3)', borderRadius: 4, padding: '4px 8px', marginBottom: 6, fontSize: 10, color: '#c084fc' }}>
                ⚡ {sameMatchCount + 1} legs same-game · correlação aplicada
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--mute)' }}>Odd total:</span>
              <strong style={{ fontFamily: 'monospace' }}>{totalOdd.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--mute)' }}>Prob (corr.):</span>
              <strong>{(joint * 100).toFixed(2)}%</strong>
            </div>
            {Math.abs(joint - jointIndep) > 0.001 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--mute)' }}>
                <span>indep:</span>
                <span>{(jointIndep * 100).toFixed(2)}%</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--mute)' }}>Fair odd:</span>
              <strong style={{ fontFamily: 'monospace' }}>{fairOdd}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
              <span style={{ color: 'var(--mute)' }}>EV:</span>
              <strong style={{ color: evColor(ev) }}>{ev > 0 ? '+' : ''}{ev}%</strong>
            </div>
            <button onClick={() => onSave({ legs, joint, totalOdd, ev, fairOdd })}
              disabled={legs.length === 0}
              style={{
                width: '100%', marginTop: 10, padding: '8px',
                background: 'var(--green)', color: 'var(--bg)', border: 'none',
                borderRadius: 4, fontWeight: 700, cursor: 'pointer', fontSize: 11,
              }}>
              💾 Salvar pick
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Pick History — sincronizado com D1 via /v1/picks/* (fallback localStorage)
// ─────────────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'sb_picks_history_v1'
function loadHistoryLocal() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveHistoryLocal(items) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)) } catch {}
}
async function fetchHistoryRemote() {
  try {
    const r = await fetch(API_BASE + '/v1/picks/list', {
      headers: { 'X-User-Id': getUserId() },
      cache: 'no-store',
    })
    const j = await r.json()
    return j.ok ? j.picks : null
  } catch { return null }
}
async function saveHistoryRemote(item) {
  try {
    await fetch(API_BASE + '/v1/picks/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': getUserId() },
      body: JSON.stringify(item),
    })
  } catch {}
}
async function updateHistoryRemote(id, patch) {
  try {
    await fetch(API_BASE + '/v1/picks/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': getUserId() },
      body: JSON.stringify({ id, ...patch }),
    })
  } catch {}
}
async function deleteHistoryRemote(opts) {
  try {
    await fetch(API_BASE + '/v1/picks/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': getUserId() },
      body: JSON.stringify(opts),
    })
  } catch {}
}

function HistoryPanel({ history, onUpdate, onClear }) {
  if (!history.length) return null
  const totalStake = history.reduce((a, h) => a + (h.stake || 0), 0)
  const won = history.filter(h => h.result === 'won')
  const lost = history.filter(h => h.result === 'lost')
  const pending = history.filter(h => !h.result)
  const wonProfit = won.reduce((a, h) => a + (h.stake * (h.totalOdd - 1) || 0), 0)
  const lostLoss = lost.reduce((a, h) => a + (h.stake || 0), 0)
  const netProfit = wonProfit - lostLoss
  const roi = totalStake > 0 ? (netProfit / totalStake * 100) : 0

  return (
    <div className="pick-card" style={{ padding: 14, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>📊 Histórico de Picks ({history.length})</h3>
        <button onClick={onClear} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--bg2)', border: '1px solid var(--line)', color: 'var(--soft)', borderRadius: 3, cursor: 'pointer' }}>limpar tudo</button>
      </div>
      <KpiRow>
        <Kpi value={pending.length} label="Pendentes" color="var(--amber)"/>
        <Kpi value={won.length} label="Ganhos" color="var(--green)"/>
        <Kpi value={lost.length} label="Perdidos" color="var(--red)"/>
        <Kpi value={`R$ ${netProfit.toFixed(2)}`} label="Lucro líq." color={netProfit >= 0 ? 'var(--green)' : 'var(--red)'}/>
        <Kpi value={`${roi.toFixed(1)}%`} label="ROI" color={roi >= 0 ? '#5ecbff' : 'var(--red)'}/>
      </KpiRow>
      <table style={{ width: '100%', marginTop: 12, fontSize: 11 }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,.04)', textAlign: 'left' }}>
            <th style={{ padding: 6 }}>Salvo</th>
            <th style={{ padding: 6 }}>Legs</th>
            <th style={{ padding: 6 }}>Odd</th>
            <th style={{ padding: 6 }}>Prob</th>
            <th style={{ padding: 6 }}>EV</th>
            <th style={{ padding: 6 }}>Stake</th>
            <th style={{ padding: 6 }}>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {history.slice().reverse().map((h, idx) => {
            const realIdx = history.length - 1 - idx
            return (
              <tr key={h.id} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: 6, fontSize: 10, color: 'var(--mute)' }}>{fmtTime(h.savedAt)}</td>
                <td style={{ padding: 6 }}>
                  {h.legs.map((l, i) => (
                    <div key={i} style={{ fontSize: 10 }}>
                      <span style={{ color: '#5ecbff' }}>{MARKET_LABEL[l.market] || l.market}</span> · {l.selection} <span style={{ color: 'var(--mute)' }}>({l.home} × {l.away})</span>
                    </div>
                  ))}
                </td>
                <td style={{ padding: 6, fontFamily: 'monospace' }}>{h.totalOdd?.toFixed(2)}</td>
                <td style={{ padding: 6 }}>{(h.joint * 100).toFixed(1)}%</td>
                <td style={{ padding: 6, fontWeight: 700, color: evColor(h.ev) }}>{h.ev > 0 ? '+' : ''}{h.ev?.toFixed(1)}%</td>
                <td style={{ padding: 6 }}>R$ {(h.stake || 0).toFixed(2)}</td>
                <td style={{ padding: 6 }}>
                  {!h.result ? (
                    <>
                      <button onClick={() => onUpdate(realIdx, { result: 'won' })} style={{ fontSize: 10, padding: '2px 6px', marginRight: 4, background: 'var(--green)', color: 'var(--bg)', border: 'none', borderRadius: 3, cursor: 'pointer' }}>W</button>
                      <button onClick={() => onUpdate(realIdx, { result: 'lost' })} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--red)', color: 'var(--white)', border: 'none', borderRadius: 3, cursor: 'pointer' }}>L</button>
                    </>
                  ) : (
                    <span style={{ color: h.result === 'won' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                      {h.result === 'won' ? '✓ Ganhou' : '✗ Perdeu'}
                      <button onClick={() => onUpdate(realIdx, { result: null })} style={{ marginLeft: 6, fontSize: 9, background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer' }}>↺</button>
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Picks365() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [bankroll, setBankroll] = useState(() => parseFloat(localStorage.getItem('sb_bankroll') || '1000'))
  const [kellyMult, setKellyMult] = useState(0.25)  // 1/4 Kelly default (conservador)
  const [minEV, setMinEV] = useState(2)
  const [sportFilt, setSportFilt] = useState('all')
  const [marketFilt, setMarketFilt] = useState('all')
  const [search, setSearch] = useState('')
  const [combo, setCombo] = useState([])
  const [history, setHistory] = useState(loadHistoryLocal())
  const [suggestedCombos, setSuggestedCombos] = useState([])

  useEffect(() => { localStorage.setItem('sb_bankroll', String(bankroll)) }, [bankroll])
  useEffect(() => { saveHistoryLocal(history) }, [history])

  // Sync com D1 no mount
  useEffect(() => {
    fetchHistoryRemote().then(remote => {
      if (remote) setHistory(remote)
    })
  }, [])

  // Fetch suggested combos
  useEffect(() => {
    fetch(COMBOS_URL + `?minLegEV=${Math.max(0, minEV - 1)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j.ok) setSuggestedCombos(j.combos || []) })
      .catch(() => {})
  }, [data, minEV])

  function handleSaveCombo(payload) {
    if (!payload.legs.length) return
    const stake = bankroll && payload.joint > 0
      ? +(bankroll * kellyFraction(payload.totalOdd, payload.joint) * kellyMult).toFixed(2)
      : 0
    const item = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      savedAt: Date.now(),
      legs: payload.legs.map(l => ({
        fixtureId: l.fixtureId, home: l.home, away: l.away,
        competition: l.competition, commenceTime: l.commenceTime,
        market: l.market, selection: l.selection, line: l.line,
        odd: l.odd, fairProb: l.fairProb, ev: l.ev,
      })),
      joint: payload.joint, totalOdd: payload.totalOdd, ev: payload.ev,
      fairOdd: payload.fairOdd, stake,
      result: null,
    }
    setHistory(h => [...h, item])
    saveHistoryRemote(item)  // sync D1
    setCombo([])
  }
  function updateHistoryItem(idx, patch) {
    setHistory(h => {
      const item = h[idx]
      if (item?.id) updateHistoryRemote(item.id, patch)
      return h.map((x, i) => i === idx ? { ...x, ...patch } : x)
    })
  }
  function clearHistory() {
    if (confirm('Limpar todo histórico?')) {
      setHistory([])
      deleteHistoryRemote({ all: true })
    }
  }
  function loadSuggestedCombo(combo) {
    setCombo(combo.legs)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch(API_URL, { cache: 'no-store' })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error)
      setData(j); setErr(null)
    } catch (e) { setErr(e.message) }
    setLoading(false)
  }
  useEffect(() => { fetchData() }, [])

  const allPicks = useMemo(() => flattenPicks(data?.matches), [data])

  const filteredPicks = useMemo(() => {
    // Se minEV > 0, filtra por EV. Se = 0, mostra TODOS os picks (incluindo
    // sem cross-book onde ev é null) ordenados por odd desc.
    let list = minEV > 0
      ? allPicks.filter(p => p.ev != null && p.ev >= minEV)
      : allPicks.filter(p => p.odd > 1)
    if (sportFilt !== 'all') {
      list = list.filter(p => {
        const c = (p.competition || '').toLowerCase()
        if (sportFilt === 'nba') return /\bnba\b/.test(c)
        if (sportFilt === 'nbb') return /\bnbb\b|basquete/.test(c)
        if (sportFilt === 'futebol') return !/\bnba\b|\bnbb\b|basquete/.test(c)
        return true
      })
    }
    if (marketFilt !== 'all') list = list.filter(p => p.market === marketFilt)
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(p =>
        (p.home + ' ' + p.away + ' ' + (p.competition || '') + ' ' + p.selection).toLowerCase().includes(s)
      )
    }
    // Sort: picks com EV+ primeiro (desc), depois picks sem EV por odd desc
    return list.sort((a, b) => {
      if (a.ev != null && b.ev != null) return b.ev - a.ev
      if (a.ev != null) return -1
      if (b.ev != null) return 1
      return (b.fairProb || 0) - (a.fairProb || 0)  // mais prováveis primeiro
    })
  }, [allPicks, minEV, sportFilt, marketFilt, search])

  const allMarketTypes = useMemo(() => {
    const set = new Set()
    for (const p of allPicks) if (p.market) set.add(p.market)
    return Array.from(set).sort()
  }, [allPicks])

  const togglePick = (p) => {
    const k = pickKey(p)
    const idx = combo.findIndex(x => pickKey(x) === k)
    if (idx >= 0) setCombo(c => c.filter((_, i) => i !== idx))
    else if (combo.length < 8) setCombo(c => [...c, p])
  }
  const removePick = (p) => setCombo(c => c.filter(x => pickKey(x) !== pickKey(p)))
  const selectedKeys = new Set(combo.map(pickKey))

  const stats = useMemo(() => {
    const withEv = allPicks.filter(p => p.ev != null)
    return {
      total: allPicks.length,
      withEv: withEv.length,
      positive: withEv.filter(p => p.ev > 0).length,
      gold: withEv.filter(p => p.ev >= 8).length,
      avgEv: withEv.length ? withEv.reduce((a, p) => a + p.ev, 0) / withEv.length : 0,
    }
  }, [allPicks])

  return (
    <div className="page-container">
      <PageHeader
        title="Picks Bet365"
        subtitle={data ? `${stats.total} picks · ${stats.positive} +EV · atualizado ${fmtTime(data.capturedAt)}` : 'carregando...'}
        right={<button onClick={fetchData} className="btn-primary">↻ Atualizar</button>}
      />

      <KpiRow>
        <Kpi value={stats.total} label="Total picks" color="var(--soft)"/>
        <Kpi value={stats.withEv} label="Com EV ref" color="#5ecbff"/>
        <Kpi value={stats.positive} label="EV positivo" color="var(--green)"/>
        <Kpi value={stats.gold} label="🏆 Ouro (≥+8%)" color="var(--amber)"/>
        <Kpi value={stats.withEv ? `${stats.avgEv.toFixed(1)}%` : '—'} label="EV médio" color="var(--mute)"/>
      </KpiRow>
      {stats.total > 0 && stats.withEv === 0 && (
        <div style={{
          padding: 10, marginTop: 8,
          background: 'rgba(255,184,48,.08)', border: '1px solid rgba(255,184,48,.3)',
          borderRadius: 4, fontSize: 11, color: 'var(--amber)',
        }}>
          ⚠ Nenhum match cruzou com Bovada/cross-book pra calcular EV real. Picks ordenados por probabilidade no-vig.
          Pra obter EV+, precisa de fonte sharp (Pinnacle).
        </div>
      )}

      {/* Filtros + Bankroll */}
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" placeholder="🔍 buscar..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--white)' }} />
        <select value={sportFilt} onChange={e => setSportFilt(e.target.value)} style={{ padding: '6px 10px' }}>
          <option value="all">Todos esportes</option>
          <option value="futebol">Futebol</option>
          <option value="nba">NBA</option>
          <option value="nbb">NBB</option>
        </select>
        <select value={marketFilt} onChange={e => setMarketFilt(e.target.value)} style={{ padding: '6px 10px' }}>
          <option value="all">Todos mercados</option>
          {allMarketTypes.map(k => <option key={k} value={k}>{MARKET_LABEL[k] || k}</option>)}
        </select>
        <select value={minEV} onChange={e => setMinEV(parseFloat(e.target.value))} style={{ padding: '6px 10px' }}>
          <option value={0}>EV ≥ 0%</option>
          <option value={2}>EV ≥ +2%</option>
          <option value={5}>EV ≥ +5%</option>
          <option value={8}>EV ≥ +8%</option>
        </select>
        <span style={{ fontSize: 11, color: 'var(--mute)' }}>Banca:</span>
        <input type="number" value={bankroll} onChange={e => setBankroll(parseFloat(e.target.value) || 0)}
          style={{ width: 90, padding: '6px 8px', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--white)' }} />
        <select value={kellyMult} onChange={e => setKellyMult(parseFloat(e.target.value))} style={{ padding: '6px 10px' }}>
          <option value={1}>Full Kelly</option>
          <option value={0.5}>Half Kelly</option>
          <option value={0.25}>Quarter Kelly (rec.)</option>
          <option value={0.1}>1/10 Kelly</option>
        </select>
      </div>

      {err && <div style={{ color: 'var(--red)', marginTop: 12 }}>Erro: {err}</div>}
      {loading && <div style={{ marginTop: 20, color: 'var(--mute)' }}>Carregando...</div>}

      {!loading && filteredPicks.length === 0 && (
        <EmptyState icon="🎯" title="Sem picks com EV+" message="Aumente o threshold ou aguarde próximo cron." />
      )}

      {/* Layout: tabela + painel combo lado a lado */}
      <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,.04)', textAlign: 'left' }}>
                <th style={{ padding: 8, width: 30 }}></th>
                <th style={{ padding: 8 }}>Jogo</th>
                <th style={{ padding: 8 }}>Mercado</th>
                <th style={{ padding: 8 }}>Pick</th>
                <th style={{ padding: 8 }}>Odd</th>
                <th style={{ padding: 8 }}>Trend</th>
                <th style={{ padding: 8 }}>Prob</th>
                <th style={{ padding: 8 }}>EV</th>
                <th style={{ padding: 8 }}>Stake</th>
              </tr>
            </thead>
            <tbody>
              {filteredPicks.slice(0, 200).map(p => (
                <PickRow
                  key={pickKey(p)} pick={p}
                  selected={selectedKeys.has(pickKey(p))}
                  onToggle={togglePick}
                  bankroll={bankroll} kellyMult={kellyMult}
                />
              ))}
            </tbody>
          </table>
          {filteredPicks.length > 200 && (
            <div style={{ textAlign: 'center', padding: 12, color: 'var(--mute)' }}>
              + {filteredPicks.length - 200} picks (refine os filtros)
            </div>
          )}
        </div>
        <div style={{ width: 280, flexShrink: 0 }}>
          <ComboPanel legs={combo} onRemove={removePick} onClear={() => setCombo([])} onSave={handleSaveCombo} />
        </div>
      </div>

      <SuggestedCombos combos={suggestedCombos} onLoad={loadSuggestedCombo} />
      <HistoryPanel history={history} onUpdate={updateHistoryItem} onClear={clearHistory} />
    </div>
  )
}
