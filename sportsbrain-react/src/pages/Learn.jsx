// ═══════════════════════════════════════════════════════════
// Aprendizado IA — Auto-avaliação de picks vs resultados reais
// Roda o mesmo modelo do Análise 365 sobre jogos encerrados
// e calcula acerto/erro automaticamente.
// ═══════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import { fetchMatches } from '../api/client'

// ── Mesmo seededRng da Análise 365 ────────────────────────
function seededRng(seed) {
  let s = 0
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return ((s >>> 0) / 0xFFFFFFFF) }
}

function genMarketOdds(fairProb, rng) {
  const juice = 1.04 + rng() * 0.03
  const impliedOdd = 1 / (fairProb * juice)
  const ineff = 0.96 + rng() * 0.16
  return Number((impliedOdd * ineff).toFixed(2))
}

function calcEV(conf, marketOdd) {
  const p = conf / 100
  const ev = Number((((p * marketOdd) - 1) * 100).toFixed(1))
  return ev
}

// ── Gera os mesmos picks que a Análise 365 geraria ────────
function generatePicksForGame(g) {
  const rng = seededRng(g.id || (g.home_team + g.away_team))
  const sport = g.sport || 'football'
  const isBball = sport === 'basketball'
  const baseConf = g.confidence_score ? Math.round(g.confidence_score * 100) : Math.round(45 + rng() * 25)

  const picks = []

  // H2H
  const homeProb = Math.max(0.18, Math.min(0.72, (baseConf / 100) * (0.55 + rng() * 0.3)))
  const drawProb = isBball ? 0 : Math.max(0.12, Math.min(0.35, 0.27 + rng() * 0.12))
  const awayProb = isBball ? 1 - homeProb : Math.max(0.08, 1 - homeProb - drawProb)

  const h2hDefs = isBball
    ? [{ key: 'home', label: 'Vitória Casa', prob: homeProb }, { key: 'away', label: 'Vitória Fora', prob: awayProb }]
    : [{ key: 'home', label: 'Vitória Casa', prob: homeProb }, { key: 'draw', label: 'Empate', prob: drawProb }, { key: 'away', label: 'Vitória Fora', prob: awayProb }]

  h2hDefs.forEach(def => {
    const conf = Math.round(def.prob * 100)
    if (conf < 35) return
    const odd = genMarketOdds(def.prob, rng)
    const ev = calcEV(conf, odd)
    picks.push({ market: 'H2H', key: def.key, label: def.label, conf, odd, ev })
  })

  // Over/Under 2.5 (futebol) ou Over/Under Total (basquete)
  const overProb = isBball
    ? (0.45 + rng() * 0.20)
    : (0.35 + rng() * 0.30)
  const overConf = Math.round(overProb * 100)
  const underConf = 100 - overConf

  if (overConf >= 40) {
    picks.push({ market: isBball ? 'OverTotal' : 'Over25', key: 'over', label: isBball ? 'Over Total' : 'Over 2.5 Gols', conf: overConf, odd: genMarketOdds(overProb, rng), ev: calcEV(overConf, genMarketOdds(overProb, rng)) })
  }
  if (underConf >= 40) {
    picks.push({ market: isBball ? 'UnderTotal' : 'Under25', key: 'under', label: isBball ? 'Under Total' : 'Under 2.5 Gols', conf: underConf, odd: genMarketOdds(1 - overProb, rng), ev: calcEV(underConf, genMarketOdds(1 - overProb, rng)) })
  }

  // BTTS (só futebol)
  if (!isBball) {
    const bttsProb = 0.35 + rng() * 0.35
    const bttsConf = Math.round(bttsProb * 100)
    const nbttsConf = 100 - bttsConf
    if (bttsConf >= 40) picks.push({ market: 'BTTS', key: 'btts_yes', label: 'BTTS (Sim)', conf: bttsConf, odd: genMarketOdds(bttsProb, rng), ev: calcEV(bttsConf, genMarketOdds(bttsProb, rng)) })
    if (nbttsConf >= 40) picks.push({ market: 'BTTS', key: 'btts_no', label: 'BTTS (Não)', conf: nbttsConf, odd: genMarketOdds(1 - bttsProb, rng), ev: calcEV(nbttsConf, genMarketOdds(1 - bttsProb, rng)) })
  }

  return picks
}

// ── Avalia pick vs resultado real ────────────────────────
function evaluatePick(pick, g) {
  const gh = g.ft_goals_home ?? null
  const ga = g.ft_goals_away ?? null
  if (gh === null || ga === null) return null // resultado não disponível

  const total = gh + ga
  switch (pick.key) {
    case 'home':    return gh > ga ? 'W' : 'L'
    case 'draw':    return gh === ga ? 'W' : 'L'
    case 'away':    return ga > gh ? 'W' : 'L'
    case 'over':    return total > 2.5 ? 'W' : 'L'
    case 'under':   return total < 2.5 ? 'W' : 'L'
    case 'btts_yes': return (gh > 0 && ga > 0) ? 'W' : 'L'
    case 'btts_no':  return (gh === 0 || ga === 0) ? 'W' : 'L'
    default: return null
  }
}

// ── Componentes UI ────────────────────────────────────────
function CalibBar({ min, max, wr, total }) {
  const mid = (min + max) / 2
  const color = wr >= (mid / 100) - 0.03 ? 'var(--green)' : wr >= 0.42 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--soft)', minWidth: 46 }}>{min}-{max}%</div>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--line)', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: `${mid}%`, top: 0, bottom: 0, width: 1.5, background: 'var(--mute)', zIndex: 1 }} />
        <div style={{ width: `${Math.round(wr * 100)}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color, minWidth: 44, textAlign: 'right' }}>
        {Math.round(wr * 100)}% <span style={{ color: 'var(--dim)', fontSize: 11 }}>({total})</span>
      </div>
    </div>
  )
}

function ResultRow({ pick, game, result }) {
  const icon = result === 'W' ? '✅' : '❌'
  const col = result === 'W' ? 'var(--green)' : 'var(--red)'
  const home = game.home_team || game.home_team_name || '?'
  const away = game.away_team || game.away_team_name || '?'
  const score = `${game.ft_goals_home ?? '?'}–${game.ft_goals_away ?? '?'}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 11 }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--soft)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {home} vs {away}
        </div>
        <div style={{ color: 'var(--white)', fontWeight: 600 }}>{pick.label}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)' }}>{score}</div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: col, fontWeight: 700 }}>{result}</div>
      </div>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: pick.ev >= 3 ? 'var(--green)' : 'var(--mute)', textAlign: 'right', minWidth: 38 }}>
        EV {pick.ev > 0 ? '+' : ''}{pick.ev}%
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────
export default function Learn() {
  const [evaluated, setEvaluated] = useState([])   // [{game, pick, result}]
  const [loading, setLoading]     = useState(false)
  const [status, setStatus]       = useState('')
  const [filter, setFilter]       = useState('all') // all | W | L

  const load = useCallback(async () => {
    setLoading(true)
    setStatus('⏳ Buscando jogos encerrados…')
    try {
      const res = await fetchMatches({ per_page: 200 })
      const all = res.matches || res.data || res || []
      const games = Array.isArray(all) ? all : []

      // Só jogos já encerrados com placar final
      const finished = games.filter(g =>
        (g.status_raw === 'FT' || g.status === 'FT' || g.status === 'finished') &&
        g.ft_goals_home !== null && g.ft_goals_away !== null
      )

      if (!finished.length) {
        setStatus('ℹ Nenhum jogo encerrado com placar disponível ainda. Tente novamente mais tarde.')
        setLoading(false)
        return
      }

      // Para cada jogo encerrado, gera picks e avalia
      const rows = []
      finished.forEach(g => {
        const picks = generatePicksForGame(g)
        picks.forEach(pick => {
          const result = evaluatePick(pick, g)
          if (result !== null) rows.push({ game: g, pick, result })
        })
      })

      setEvaluated(rows)
      const wins = rows.filter(r => r.result === 'W').length
      const evPlusPicks = rows.filter(r => r.pick.ev >= 3)
      const evPlusWins = evPlusPicks.filter(r => r.result === 'W').length
      setStatus(`✅ ${finished.length} jogos encerrados · ${rows.length} mercados avaliados · ${wins}/${rows.length} acertos · EV+ (≥3%): ${evPlusWins}/${evPlusPicks.length}`)
    } catch (e) {
      setStatus(`❌ Erro: ${e.message}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = evaluated.filter(r => filter === 'all' || r.result === filter)

  const wins    = evaluated.filter(r => r.result === 'W').length
  const total   = evaluated.length
  const wr      = total ? (wins / total * 100).toFixed(1) : null
  const wrN     = total ? wins / total : null

  // EV+ picks (ev >= 3%)
  const evPlus      = evaluated.filter(r => r.pick.ev >= 3)
  const evPlusWins  = evPlus.filter(r => r.result === 'W').length
  const evPlusWr    = evPlus.length ? (evPlusWins / evPlus.length * 100).toFixed(1) : null

  // Calibração
  const confBands = [[40,50],[50,60],[60,70],[70,80],[80,100]]
  const calibration = confBands.map(([min, max]) => {
    const band = evaluated.filter(r => r.pick.conf >= min && r.pick.conf < max)
    const bw = band.filter(r => r.result === 'W').length
    return { min, max, total: band.length, wr: band.length ? bw / band.length : null }
  }).filter(b => b.total >= 2)

  // Por mercado
  const byMkt = {}
  evaluated.forEach(r => {
    const m = r.pick.market
    if (!byMkt[m]) byMkt[m] = { w: 0, t: 0 }
    byMkt[m].t++
    if (r.result === 'W') byMkt[m].w++
  })

  const wrColor = w => Number(w) >= 55 ? 'var(--green)' : Number(w) >= 45 ? 'var(--amber)' : 'var(--red)'

  return (
    <div className="page">
      <PageHeader
        icon="🧠" title="Aprendizado IA"
        subtitle="Avaliação automática dos picks do modelo vs resultados reais"
        actions={
          <button onClick={load} disabled={loading} className="btn" style={{ padding: '4px 10px', fontSize: 11 }}>
            {loading ? '⏳' : '↺ Atualizar'}
          </button>
        }
      />

      <KpiRow>
        <Kpi value={total || '-'} label="Mercados Avaliados" color="var(--soft)" />
        <Kpi value={wr ? `${wr}%` : '-'} label="Win Rate Geral" color={wr ? wrColor(wr) : 'var(--mute)'} />
        <Kpi value={evPlusWr ? `${evPlusWr}%` : '-'} label="Win Rate EV+" color={evPlusWr ? wrColor(evPlusWr) : 'var(--mute)'} />
        <Kpi value={evPlus.length || '-'} label="Picks com EV≥3%" color="var(--green)" />
      </KpiRow>

      {/* Status */}
      {status && (
        <div style={{ fontSize: 11, color: 'var(--soft)', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r)', padding: '8px 12px', marginBottom: 16 }}>
          {status}
        </div>
      )}

      {evaluated.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12, marginBottom: 20 }}>

          {/* Calibração */}
          {calibration.length > 0 && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 14 }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>
                Calibração por Confiança
              </div>
              {calibration.map((b, i) => <CalibBar key={i} min={b.min} max={b.max} wr={b.wr} total={b.total} />)}
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, fontFamily: "'JetBrains Mono',monospace" }}>
                Barra = win rate real · Linha = confiança esperada
              </div>
            </div>
          )}

          {/* Por mercado */}
          {Object.keys(byMkt).length > 0 && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 14 }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>
                Por Mercado
              </div>
              {Object.entries(byMkt).sort((a, b) => b[1].w / b[1].t - a[1].w / a[1].t).map(([m, v], i) => {
                const mwr = (v.w / v.t * 100).toFixed(0)
                const c = wrColor(mwr)
                const labels = { H2H: 'Resultado Final', Over25: 'Over 2.5', Under25: 'Under 2.5', BTTS: 'BTTS', OverTotal: 'Over Total', UnderTotal: 'Under Total' }
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--soft)', marginBottom: 3 }}>{labels[m] || m}</div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
                        <div style={{ width: `${mwr}%`, height: '100%', background: c, borderRadius: 3 }} />
                      </div>
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: c, minWidth: 54, textAlign: 'right' }}>
                      {mwr}% <span style={{ color: 'var(--dim)', fontSize: 11 }}>{v.w}/{v.t}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* EV+ Performance */}
          {evPlus.length > 0 && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 14 }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>
                Performance EV+ (≥3%)
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: evPlusWr ? wrColor(evPlusWr) : 'var(--mute)' }}>
                    {evPlusWr ? `${evPlusWr}%` : '-'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--dim)' }}>Win Rate</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--soft)', marginBottom: 4 }}>
                    {evPlusWins} acertos em {evPlus.length} picks com edge positivo
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--dim)' }}>
                    {evPlus.length > 0 && Number(evPlusWr) > Number(wr) ? '📈 EV+ performa melhor que a média' : ''}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lista de picks avaliados */}
      {evaluated.length > 0 && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--r2)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              Picks Avaliados
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['all', 'W', 'L'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid', cursor: 'pointer', fontWeight: filter === f ? 700 : 400,
                    background: filter === f ? (f === 'W' ? 'rgba(0,214,143,.15)' : f === 'L' ? 'rgba(255,79,106,.15)' : 'var(--b3)') : 'transparent',
                    borderColor: filter === f ? (f === 'W' ? 'var(--green)' : f === 'L' ? 'var(--red)' : 'var(--blue)') : 'var(--line)',
                    color: filter === f ? (f === 'W' ? 'var(--green)' : f === 'L' ? 'var(--red)' : 'var(--blue)') : 'var(--soft)',
                  }}>
                  {f === 'all' ? `Todos (${evaluated.length})` : f === 'W' ? `✅ Acertos (${wins})` : `❌ Erros (${total - wins})`}
                </button>
              ))}
            </div>
          </div>
          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            {filtered.slice(0, 100).map((r, i) => (
              <ResultRow key={i} pick={r.pick} game={r.game} result={r.result} />
            ))}
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--dim)', fontSize: 11 }}>Nenhum resultado neste filtro</div>
            )}
          </div>
        </div>
      )}

      {/* Estado vazio — aguardando jogos encerrarem */}
      {!loading && evaluated.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--mute)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--soft)', marginBottom: 6 }}>Aguardando jogos encerrarem</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', maxWidth: 340, margin: '0 auto' }}>
            Os picks são avaliados automaticamente assim que o placar final fica disponível. Jogos ao vivo ou agendados não entram no cálculo.
          </div>
        </div>
      )}
    </div>
  )
}
