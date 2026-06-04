// ═══════════════════════════════════════════════════════════════════════════
// Markets Bet365 — Análise de mercados completos extraídos do scraper API
// ═══════════════════════════════════════════════════════════════════════════
// Mostra TODOS os mercados (1X2, BTTS, Total Goals, Player Props, etc.) que
// o scraper captura por match — com devig (no-vig prob) e EV vs cross-book
// (Bovada). Permite filtrar por esporte, match, tipo de mercado, EV mínimo.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'

const API_URL = 'https://sportsbrain-api.sportsbrain-api.workers.dev/v1/bet365/markets/analyzed'

const MARKET_LABELS = {
  '1X2':                'Resultado Final (1X2)',
  '1X2_ADJ':            'Resultado — Preços Ajustados',
  'BTTS':               'Ambos Marcam',
  'DOUBLE_CHANCE':      'Chance Dupla',
  'DRAW_NO_BET':        'Empate Anula Aposta',
  'TOTAL_GOALS':        'Total Gols (Mais/Menos)',
  'TOTAL_POINTS':       'Total Pontos (Mais/Menos)',
  'TOTAL_POINTS_ALT':   'Total Pontos Alternativo',
  'CORNERS_OU':         'Escanteios (Mais/Menos)',
  'CARDS_OU':           'Cartões (Mais/Menos)',
  'CORRECT_SCORE':      'Resultado Correto',
  'CORRECT_SCORE_HT':   'Resultado Correto Intervalo',
  'HT_FT':              'Intervalo / Final do Jogo',
  'GOALS_RANGE':        'Faixa de Gols',
  'GOALS_RANGE_HT1':    'Faixa de Gols 1º Tempo',
  'GOALS_RANGE_HT2':    'Faixa de Gols 2º Tempo',
  'TEAM_GOALS_RANGE':   'Faixa de Gols por Time',
  'RESULT_GOALS_RANGE': 'Resultado / Faixa de Gols',
  'DOUBLE_CHANCE_GOALS_RANGE': 'Chance Dupla / Faixa de Gols',
  'RESULT_BTTS':        'Resultado / Ambos Marcam',
  'BOTH_TEAMS_CARDED':  'Ambos Times Receberem Cartões',
  'PLAYER_SCORE':       'Marcador a Qualquer Momento',
  'PLAYER_SCORE_OR_ASSIST': 'Jogador: Gol ou Assistência',
  'PLAYER_CARDS':       'Jogador: Cartão',
  'PLAYER_SHOTS':       'Jogador: Chutes',
  'PLAYER_SHOTS_ON_TARGET': 'Jogador: Chutes ao Gol',
  'PLAYER_HEADERS':     'Jogador: Cabeçadas',
  'PLAYER_FOULS':       'Jogador: Faltas',
  'PLAYER_TACKLES':     'Jogador: Desarmes',
  'HANDICAP_RESULT':    'Handicap',
  'HANDICAP_ALT':       'Handicap Alternativo',
  'NBA_GAME_LINES':     'NBA: Linhas do Jogo',
  'NBA_PLAYER_POINTS':  'NBA: Pontos por Jogador',
  'NBA_PLAYER_REBOUNDS':'NBA: Rebotes por Jogador',
  'NBA_PLAYER_ASSISTS': 'NBA: Assistências por Jogador',
  'NBA_PLAYER_3PT':     'NBA: Cestas de 3 por Jogador',
  'NBA_PLAYER_PRA':     'NBA: PTS+REB+AST',
  'NBA_DOUBLE_DOUBLE':  'NBA: Duplo-Duplo',
  'NBA_TRIPLE_DOUBLE':  'NBA: Triplo-Duplo',
  'NBA_FIRST_BASKET':   'NBA: Primeira Cesta',
  'NBA_QUARTER':        'NBA: Quarto',
  'NBA_HALF1':          'NBA: 1º Tempo',
  'NBA_TEAM_TOTALS':    'NBA: Total por Time',
  'NBA_DOUBLE_RESULT':  'NBA: Resultado Duplo',
  'NBA_WINNING_MARGIN': 'NBA: Margem de Vitória',
  'OTHER':              'Outros',
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

function evColor(ev) {
  if (ev == null) return 'var(--mute)'
  if (ev >= 5)  return 'var(--green)'
  if (ev >= 0)  return '#5ecbff'
  if (ev >= -3) return 'var(--amber)'
  return 'var(--red)'
}

function MarketRow({ row, marketKey }) {
  // Renderização adaptada por tipo
  if (marketKey === 'TOTAL_GOALS' || marketKey === 'TOTAL_POINTS' || marketKey === 'CORNERS_OU' || marketKey === 'CARDS_OU') {
    return (
      <tr>
        <td style={{ fontFamily: 'monospace' }}>{row.line}</td>
        <td>
          <span style={{ color: 'var(--soft)' }}>over </span>
          <strong>{row.over}</strong>
          <span style={{ color: evColor(row.overEV), marginLeft: 6, fontSize: 11 }}>
            {row.overEV != null ? `${row.overEV > 0 ? '+' : ''}${row.overEV}%` : ''}
          </span>
        </td>
        <td>
          <span style={{ color: 'var(--soft)' }}>under </span>
          <strong>{row.under}</strong>
          <span style={{ color: evColor(row.underEV), marginLeft: 6, fontSize: 11 }}>
            {row.underEV != null ? `${row.underEV > 0 ? '+' : ''}${row.underEV}%` : ''}
          </span>
        </td>
        <td style={{ color: 'var(--mute)', fontSize: 10 }}>
          fair: {((row.overProb||0)*100).toFixed(0)}% / {((row.underProb||0)*100).toFixed(0)}%
        </td>
      </tr>
    )
  }
  // 1X2 / BTTS / DOUBLE_CHANCE / etc com selection + odd + ev
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>
        {row.player || row.maName || row.selection || row.n2 || '?'}
        {row.line != null && <span style={{ color: 'var(--mute)', fontSize: 10, marginLeft: 4 }}>L{row.line}</span>}
        {row.side && <span style={{ color: 'var(--mute)', fontSize: 10, marginLeft: 4 }}>{row.side}</span>}
      </td>
      <td><strong>{row.odd}</strong></td>
      <td style={{ color: 'var(--mute)', fontSize: 11 }}>
        {row.fairProb != null ? `${(row.fairProb * 100).toFixed(1)}%` : (row.impliedPct != null ? `${row.impliedPct}%` : '—')}
      </td>
      <td style={{ color: evColor(row.ev), fontWeight: 700 }}>
        {row.ev != null ? `${row.ev > 0 ? '+' : ''}${row.ev}%` : '—'}
      </td>
    </tr>
  )
}

function MarketGroup({ name, rows }) {
  const [open, setOpen] = useState(name === '1X2' || name === 'BTTS' || name === 'TOTAL_GOALS')
  if (!rows?.length) return null
  return (
    <div style={{ marginBottom: 8, border: '1px solid var(--line)', borderRadius: 6 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '8px 12px', background: 'rgba(255,255,255,.03)', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 12, fontWeight: 600, color: 'var(--soft)',
        }}
      >
        <span>{MARKET_LABELS[name] || name} <span style={{ color: 'var(--mute)', fontWeight: 400 }}>({rows.length})</span></span>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <table style={{ width: '100%', fontSize: 12 }}>
          <tbody>
            {rows.slice(0, 30).map((r, i) => <MarketRow key={i} row={r} marketKey={name} />)}
            {rows.length > 30 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 8, color: 'var(--mute)' }}>
                + {rows.length - 30} mais
              </td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

function MatchCard({ match, marketFilter }) {
  const [expanded, setExpanded] = useState(false)
  const filteredKeys = Object.keys(match.markets).filter(k => !marketFilter || k === marketFilter)
  const ko = match.commenceTime ? fmtTime(match.commenceTime) : ''

  return (
    <div className="pick-card" style={{ padding: '12px 14px', marginBottom: 10 }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)' }}>
            {match.home} <span style={{ color: 'var(--mute)' }}>×</span> {match.away}
          </div>
          <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 2 }}>
            {match.competition || '?'} · {ko ? `kickoff ${ko}` : 'horário ?'}
            {match.crossBook && <span style={{ marginLeft: 8, color: '#5ecbff' }}>+ {match.crossBook}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
            background: 'rgba(94,203,255,.15)', color: '#5ecbff',
            padding: '3px 8px', borderRadius: 3,
          }}>
            {match.marketCount} mercados
          </span>
          <span style={{ color: 'var(--mute)' }}>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          {filteredKeys.length === 0 ? (
            <div style={{ color: 'var(--mute)', fontSize: 12 }}>Sem mercados nesse filtro.</div>
          ) : filteredKeys.map(k => (
            <MarketGroup key={k} name={k} rows={match.markets[k]} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Markets365() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sportFilt, setSportFilt] = useState('all')
  const [marketFilt, setMarketFilt] = useState('all')
  const [minEdge, setMinEdge] = useState(0)
  const [search, setSearch] = useState('')

  async function fetchData() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (sportFilt !== 'all') params.set('sport', sportFilt)
      if (marketFilt !== 'all') params.set('market', marketFilt)
      if (minEdge > 0) params.set('minEdge', String(minEdge))
      const url = API_URL + (params.toString() ? '?' + params.toString() : '')
      const res = await fetch(url, { cache: 'no-store' })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error)
      setData(j)
      setErr(null)
    } catch (e) {
      setErr(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [sportFilt, marketFilt, minEdge])

  const filtered = useMemo(() => {
    if (!data?.matches) return []
    if (!search) return data.matches
    const s = search.toLowerCase()
    return data.matches.filter(m =>
      (m.home + ' ' + m.away + ' ' + (m.competition || '')).toLowerCase().includes(s)
    )
  }, [data, search])

  const allMarketTypes = useMemo(() => {
    const set = new Set()
    for (const m of data?.matches || []) {
      for (const k of Object.keys(m.markets || {})) set.add(k)
    }
    return Array.from(set).sort()
  }, [data])

  return (
    <div className="page-container">
      <PageHeader
        title="Markets Bet365"
        subtitle={data ? `${data.totalMatches} jogos · ${data.totalMarkets} mercados · atualizado ${fmtTime(data.capturedAt)}` : 'carregando...'}
        right={<button onClick={fetchData} className="btn-primary">↻ Atualizar</button>}
      />

      <KpiRow>
        <Kpi value={data?.totalMatches || 0} label="Jogos" color="var(--soft)"/>
        <Kpi value={data?.totalMarkets || 0} label="Mercados" color="#5ecbff"/>
        <Kpi value={data?.matches?.filter(m => m.crossBook).length || 0} label="Com Cross-book" color="var(--green)"/>
        <Kpi value={Object.keys(allMarketTypes || {}).length || allMarketTypes.length} label="Tipos" color="var(--amber)"/>
      </KpiRow>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search" placeholder="🔍 buscar time/liga..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--white)' }}
        />
        <select value={sportFilt} onChange={e => setSportFilt(e.target.value)} style={{ padding: '6px 10px' }}>
          <option value="all">Todos esportes</option>
          <option value="futebol">Futebol</option>
          <option value="nba">NBA</option>
          <option value="nbb">NBB</option>
        </select>
        <select value={marketFilt} onChange={e => setMarketFilt(e.target.value)} style={{ padding: '6px 10px' }}>
          <option value="all">Todos mercados</option>
          {allMarketTypes.map(k => <option key={k} value={k}>{MARKET_LABELS[k] || k}</option>)}
        </select>
        <select value={minEdge} onChange={e => setMinEdge(parseFloat(e.target.value))} style={{ padding: '6px 10px' }}>
          <option value={0}>Qualquer EV</option>
          <option value={2}>EV ≥ +2%</option>
          <option value={5}>EV ≥ +5%</option>
          <option value={10}>EV ≥ +10%</option>
        </select>
      </div>

      {err && <div style={{ color: 'var(--red)', marginTop: 12 }}>Erro: {err}</div>}

      {loading && <div style={{ marginTop: 20, color: 'var(--mute)' }}>Carregando...</div>}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon="📊"
          title="Sem mercados disponíveis"
          message="Aguarde o cron rodar (a cada 4h) ou rode 'Rodar cron agora' na página Aumentadas."
        />
      )}

      <div style={{ marginTop: 16 }}>
        {filtered.map(m => (
          <MatchCard key={m.fixtureId} match={m} marketFilter={marketFilt === 'all' ? null : marketFilt} />
        ))}
      </div>
    </div>
  )
}
