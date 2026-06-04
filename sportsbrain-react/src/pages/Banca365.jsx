// ══════════════════════════════════════════════════════════
// Banca365 — Planner de Banca + Análise da conta Bet365
// Registre seu saldo, planeje o crescimento e receba
// dicas de gestão de banca baseadas em Kelly.
// ══════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'

const PerformancePage = lazy(() => import('./Performance'))

const API_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'

const SK_365    = 'sb_banca365'        // { balance, deposited, withdrawn, history }
const SK_GOALS  = 'sb_banca365_goals'  // [{ target, label }]

function load365() {
  try {
    return {
      balance:    0,
      deposited:  0,
      withdrawn:  0,
      history:    [],
      ...JSON.parse(localStorage.getItem(SK_365) || '{}'),
    }
  } catch {
    return { balance: 0, deposited: 0, withdrawn: 0, history: [] }
  }
}

function save365(obj) {
  try { localStorage.setItem(SK_365, JSON.stringify(obj)) } catch {}
}

function loadGoals() {
  try {
    const saved = JSON.parse(localStorage.getItem(SK_GOALS) || '[]')
    if (saved.length) return saved
  } catch {}
  return [
    { target: 500,   label: 'Meta Bronze 🥉' },
    { target: 1000,  label: 'Meta Prata 🥈' },
    { target: 2500,  label: 'Meta Ouro 🥇' },
    { target: 5000,  label: 'Meta Diamante 💎' },
  ]
}

function fmtBRL(v) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 })}`
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
}

// ─── Kelly Recommendation ─────────────────────────────────────────────────────
function kellyStake(balance, conf, odd) {
  const p = conf / 100
  const b = odd - 1
  const q = 1 - p
  const f = (p * b - q) / b
  if (f <= 0) return 0
  return +(f / 4 * balance).toFixed(2)  // ¼ Kelly
}

// ─── Tradutor EN → PT de nomes de mercado (Bet365 br é em português) ─────────
const MARKET_PT = {
  'Score or Assist':         'Marca ou Assistência',
  'To Score':                'A Marcar',
  'Anytime Goalscorer':      'A Marcar (Qualquer Momento)',
  'First Goalscorer':        'Primeiro a Marcar',
  'Last Goalscorer':         'Último a Marcar',
  'Total Shots FT':          'Total de Chutes (90min)',
  'Total Shots HT':          'Total de Chutes (1º Tempo)',
  'Total Shots on Target':   'Total de Chutes ao Gol',
  'Total Corners FT':        'Total de Escanteios (90min)',
  'Total Corners HT':        'Total de Escanteios (1º Tempo)',
  'Total Cards':             'Total de Cartões',
  'Total Cards FT':          'Total de Cartões (90min)',
  'Total Goals':             'Total de Gols',
  'Total Offsides':          'Total de Impedimentos',
  'Total Fouls':             'Total de Faltas',
  'Spread':                  'Handicap',
  'Money Line':              'Vencedor (Money Line)',
  'Total':                   'Total',
  'Player Goals':            'Gols do Jogador',
  'Player Shots':            'Chutes do Jogador',
  'Player Assists':          'Assistências do Jogador',
  'Both Teams to Score':     'Ambos Marcam',
  'Match Result':            'Resultado',
  'Half Time Result':        'Resultado 1º Tempo',
  'Full Time Result':        'Resultado Final',
  'Double Chance':           'Chance Dupla',
  'Draw No Bet':             'Empate Anula Aposta',
  'Correct Score':           'Placar Exato',
  'Half Time / Full Time':   'Intervalo / Final',
  'First Half Goals':        'Gols 1º Tempo',
  'Second Half Goals':       'Gols 2º Tempo',
  'Team Total':              'Total do Time',
  'Player Points':           'Pontos do Jogador',
  'Player Rebounds':         'Rebotes do Jogador',
  'Player 3-Pointers':       'Cestas de 3 do Jogador',
  'Game Lines':              'Apostas no Jogo',
  'over':                    'Mais de',
  'under':                   'Menos de',
}
function ptMarket(en) {
  if (!en) return en
  const direct = MARKET_PT[en]
  if (direct) return direct
  // Fuzzy: tenta começo da string
  for (const [k, v] of Object.entries(MARKET_PT)) {
    if (en.toLowerCase().startsWith(k.toLowerCase())) return v + en.slice(k.length)
  }
  return en
}
function ptDirection(d) {
  if (d === 'over') return 'Mais de'
  if (d === 'under') return 'Menos de'
  return d
}

// ─── Plano Hoje — conecta picks engine à banca Bet365 ────────────────────────
// Puxa /v1/picks/daily (Elo/Poisson + ensemble), calcula stake Kelly por pick
// e sugere combos 2-pick ranqueados por EV conjunto. NUNCA promete certeza —
// exibe edge, confidence e stake recomendada pra tu executar manual no Bet365.
function PlanoHoje({ balance }) {
  const [picks, setPicks]     = useState([])
  const [matches, setMatches] = useState([])             // /v1/bet365/matches/latest
  const [analyzed, setAnalyzed] = useState({ matches: [] }) // /v1/bet365/markets/analyzed (cross-book)
  const [mispriced, setMispriced] = useState({ alerts: [] }) // /v1/bet365/markets/mispriced (steam + cross-book)
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState(null)
  const [minEdge, setMinEdge] = useState(2.5)
  const [kellyMult, setKellyMult] = useState(0.25) // ¼ Kelly default
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('sb_plano_view')
    return (saved === 'singles' || saved === 'multis') ? saved : 'singles'
  })
  const [marketFilter, setMarketFilter] = useState('all')   // all | goals | btts | result | corners | cards | player
  const [diversify, setDiversify] = useState(() => localStorage.getItem('sb_plano_diversify') === '1')  // max 2 picks por jogo
  const [leagueFilter, setLeagueFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('all')      // all | 3h | 6h | today
  const [maxStakePct, setMaxStakePct] = useState(() => parseFloat(localStorage.getItem('sb_plano_max_stake_pct') || '5'))

  async function loadPicks() {
    setLoading(true); setErr(null)
    try {
      // 0. Carrega dados auxiliares pra cruzar com picks (mispriced + matches → vig + sinais)
      const [matchesRes, mispricedRes] = await Promise.all([
        fetch(`${API_BASE}/v1/bet365/matches/latest`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/bet365/markets/mispriced`).then(r => r.json()).catch(() => ({})),
      ])
      const matchesByFid = {}
      for (const m of (matchesRes.matches || [])) matchesByFid[m.fixtureId] = m
      const steamByFid = {}
      for (const a of (mispricedRes.alerts || [])) {
        if (!steamByFid[a.fixtureId]) steamByFid[a.fixtureId] = []
        steamByFid[a.fixtureId].push(a)
      }
      // Calcula vig do 1X2 por fixture
      const vigByFid = {}
      for (const m of (matchesRes.matches || [])) {
        const o = m.odds || {}
        if (o.home && o.draw && o.away) {
          const sumImpl = 1/o.home + 1/o.draw + 1/o.away
          vigByFid[m.fixtureId] = +((sumImpl - 1) * 100).toFixed(1)
        }
      }

      // 0. BET365 MATCHES — fonte primária de cobertura (TODAS as ligas que Bet365 lista)
      // O backend props endpoint depende de API-Football/football-data.org com ligas limitadas.
      // Bet365 lista TUDO que aceita aposta hoje (Brasileirão, Libertadores, Copa BR, ATP, etc)
      // Vamos cruzar markets/analyzed (que tem 38 fixtures) com props pra cobertura ampla.

      // 1. PROPS — fonte primária ENRIQUECIDA com tudo que construímos
      // Backend retorna props baseados em projeções estatísticas (shots, corners, etc)
      // Aqui no client cruzamos com:
      //   a) Bet365 odds REAIS (markets/analyzed)  → substitui fair_odds sintético
      //   b) Mispriced/steam moves                  → ajusta confidence
      //   c) AI learning history                    → multiplicador por (sport, market)
      //   d) Recalcula EV final com Kelly real
      let out = []
      const [ftPropsRes, bkPropsRes, marketsRes, mispRes, aiRes] = await Promise.all([
        fetch(`${API_BASE}/v1/football/props/today`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/basketball/props/today`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/bet365/markets/analyzed?minEdge=0`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/bet365/markets/mispriced`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/ai/learning`).then(r => r.json()).catch(() => ({})),
      ])

      // ── Indexa Bet365 markets por (home,away) pra match fuzzy ──
      const normTeam = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
      const bet365ByMatch = {}
      for (const M of (marketsRes.matches || [])) {
        const k = `${normTeam(M.home)}|${normTeam(M.away)}`
        bet365ByMatch[k] = M
      }
      // Indexa mispriced por match
      const steamByMatch = {}
      for (const a of (mispRes.alerts || [])) {
        if (a.severity !== 'high') continue
        const k = `${normTeam(a.home)}|${normTeam(a.away)}`
        if (!steamByMatch[k]) steamByMatch[k] = []
        steamByMatch[k].push(a)
      }
      // AI learning: multiplicadores por bucket (sport|market|ev)
      const aiMult = aiRes?.data?.multipliers || aiRes?.multipliers || {}

      // ── Procura odd REAL Bet365 pra um prop usando fuzzy match de market+line+side ──
      function findRealOdd(prop, M) {
        if (!M?.markets) return null
        const s = (prop.stat || '').toLowerCase()
        // Mapping prop.stat → mgKey + keyword pra mgName/maName
        const buckets = (() => {
          if (s === 'goals')   return { keys: ['TOTAL_GOALS', 'GOALS_RANGE'], kw: /gol|goal/i }
          if (s === 'corners') return { keys: ['CORNERS_OU'], kw: /corner|escanteio/i }
          if (s === 'cards')   return { keys: ['CARDS_OU'], kw: /card|cart/i }
          if (s === 'shots')   return { keys: ['OTHER'], kw: /shot|chute|finaliz/i }
          if (s === 'sot')     return { keys: ['OTHER'], kw: /shot.*target|chute.*alvo/i }
          return { keys: ['OTHER'], kw: null }
        })()
        for (const mk of buckets.keys) {
          for (const r of (M.markets[mk] || [])) {
            // Pra OTHER: filtra por mgName matching keyword
            if (mk === 'OTHER' && buckets.kw && !buckets.kw.test(r.mgName || '')) continue
            // Match por linha (tolerância 1.0) + side
            if (r.line == null || prop.line == null) continue
            // Tolerance 0.51: aceita 1.5 ↔ 1.25/1.5/1.75/2.0 (asian halves) mas não 1.5 ↔ 2.5
            if (Math.abs(r.line - prop.line) > 0.51) continue
            const side = r.side || (r.over != null ? 'over' : r.under != null ? 'under' : null)
            if (prop.direction && side && prop.direction !== side) continue
            const odd = (r.over && prop.direction === 'over') ? r.over
                      : (r.under && prop.direction === 'under') ? r.under
                      : r.odd
            if (odd && odd >= 1.3) return +odd.toFixed(2)
          }
        }
        return null
      }

      const allProps = []
      for (const src of [ftPropsRes?.data, bkPropsRes?.data]) {
        if (src?.top_props) allProps.push(...src.top_props.map(p => ({ ...p, _src: src === bkPropsRes?.data ? 'basketball' : 'football' })))
      }

      for (const p of allProps) {
        const matchKey = `${normTeam(p.home_team)}|${normTeam(p.away_team)}`
        const M = bet365ByMatch[matchKey]
        // Backend já matched book_odds via findBet365RealOdd — usa essa primeiro
        const realOdd = p.book_odds || findRealOdd(p, M)
        // Probabilidade do modelo: PRIORIZA p.model_prob (Poisson real do backend).
        // Fallback: tanh-suavizado do ratio avg/line (só pra player props sem model_prob).
        let modelProb = 0.5
        if (p.model_prob != null && Number.isFinite(p.model_prob) && p.model_prob > 0 && p.model_prob < 1) {
          modelProb = p.model_prob
        } else if (p.projected_avg != null && p.line != null && p.line > 0) {
          const ratio = p.projected_avg / p.line
          const z = (ratio - 1) * 1.4
          const tanh = Math.tanh(z)
          if (p.direction === 'over') modelProb = 0.5 + 0.5 * tanh
          else if (p.direction === 'under') modelProb = 0.5 - 0.5 * tanh
        }
        // Aplica AI learning multiplier se houver histórico relevante
        const aiKey = `${p._src}|${(p.stat || '').toLowerCase()}`
        const mult = aiMult[aiKey]?.multiplier ?? 1
        if (Number.isFinite(mult) && mult > 0.5 && mult < 1.5) modelProb *= mult
        modelProb = Math.min(0.92, Math.max(0.08, modelProb))
        // Odds: prioridade real Bet365 → senão estima com 7% vig (média mercado prop)
        let oddsUsed = realOdd
        if (!oddsUsed) {
          oddsUsed = +((1 / modelProb) * 0.93).toFixed(2)
        }
        if (!oddsUsed || oddsUsed < 1.25 || oddsUsed > 12) continue
        const conv = (p.conviction || '').toUpperCase()
        // EV REAL com odd real e modelo prob
        const edge = +((modelProb * oddsUsed - 1) * 100).toFixed(1)
        if (edge < 1.5) continue   // sem edge real, descarta

        // Steam alignment: alerta na mesma fixture na mesma direction = sinal forte
        const steams = steamByMatch[matchKey] || []
        const steamAligned = steams.some(s => s.direction === 'down')
        const steamConflict = steams.length >= 2 && steams.every(s => s.direction === 'up')
        if (steamConflict && conv !== 'PREMIUM') continue   // sinal contrário forte

        // Confidence final: combina modelProb + edge + sinais externos.
        // Mais permissivo agora pra ter variedade de mercados por jogo.
        let conf = 'low'
        if (modelProb >= 0.62 && edge >= 4) conf = 'high'
        else if (modelProb >= 0.55 && edge >= 2) conf = 'high'
        else if (steamAligned && edge >= 2) conf = 'high'
        else if (modelProb >= 0.50 && edge >= 1) conf = 'medium'
        else if (edge >= 2) conf = 'medium'
        else if (modelProb >= 0.55) conf = 'medium'   // prob alta mesmo sem edge → válido
        else continue

        const lineLabel = p.line != null ? ` ${p.line}` : ''
        const dirLabel = ptDirection(p.direction) || ''
        const marketPt = ptMarket(p.market || p.stat || '')
        // Mercados match-level (do jogo todo) NÃO devem exibir time como sujeito.
        // Só player props ou mercados team-specific (team_goals, team_corners, team_cards) mostram.
        const rawStat = String(p.market || p.stat || '').toLowerCase()
        const isTeamSpecific = /^team_/.test(rawStat) || rawStat.includes('team_goals') || rawStat.includes('team_corners') || rawStat.includes('team_cards') || rawStat.includes('team_shots') || rawStat.includes('clean_sheet') || rawStat.includes('win_to_nil') || rawStat.includes('first_team_score')
        const isPlayerProp = !!p.player_name
        const subject = isPlayerProp ? p.player_name : (isTeamSpecific ? (p.team || (p.type === 'team' ? p.home_team : '')) : '')
        const outcome = `${p.home_team} v ${p.away_team}${subject ? ' · ' + subject : ''} · ${marketPt}${dirLabel ? ' ' + dirLabel : ''}${lineLabel}`

        const explainParts = [
          `proj ${p.projected_avg?.toFixed(1) || '?'}`,
          `tier ${p.tier || '?'}`,
          realOdd ? `✓ odd Bet365 real ${realOdd}` : 'odd estimada',
          mult !== 1 ? `🤖 IA mult ${mult.toFixed(2)}x` : null,
          steamAligned ? '⚡ steam alinhado' : null,
        ].filter(Boolean).join(' · ')

        out.push({
          event_id: p.match_id || p.id,
          sport: p._src,
          league: p.league || (p._src === 'football' ? 'Futebol' : 'NBA'),
          market: marketPt,
          outcome,
          book: realOdd ? 'Bet365 (real)' : 'Bet365',
          price_at_pick: oddsUsed, fair_price: +(1/modelProb).toFixed(2),
          edge_pct: edge, model_prob: modelProb, ensemble_prob: modelProb,
          confidence: conf,
          explain: `📊 ${explainParts}`,
          commence_time: null,
          kelly_frac: Math.max(0, (modelProb * (oddsUsed - 1) - (1 - modelProb)) / (oddsUsed - 1)),
          _isProp: true,
          _realOdd: !!realOdd,
          _steamAligned: steamAligned,
        })
      }

      // 2. Tenta engine ensemble (modelo + sharp books) como complemento
      const r = await fetch(`${API_BASE}/v1/picks/daily?min_edge=${minEdge}&persist=0&push=0&max=15`)
      const j = await r.json()
      if (j.ok && j.picks?.length) out.push(...j.picks)

      // 3. EXPANSÃO MASSIVA — varre TODOS os markets capturados Bet365 (614 ativos)
      // Cobre: 1X2, BTTS, Double Chance, Draw No Bet, Total Goals, Goals Range,
      // Player Score/Assist, NBA Game Lines, NBA Team Totals, NBA Double Result, etc.
      // Pra cada market, computa prob via self-devig dentro do grupo + ajuste por vig.
      try {
        const all1X2Cap = marketsRes?.matches || []
        for (const M of all1X2Cap) {
          const matchKey = `${normTeam(M.home)}|${normTeam(M.away)}`
          const fidSteams = steamByMatch[matchKey] || []
          const steamUp = fidSteams.filter(s => s.direction === 'up').length
          // Função util: emite pick a partir de market+selection com prob calculada
          const emit = (mk, sel, odd, prob, line, dir) => {
            if (!odd || odd < 1.4 || odd > 12) return
            if (!Number.isFinite(prob) || prob < 0.1 || prob > 0.92) return
            const edge = +((prob * odd - 1) * 100).toFixed(1)
            if (edge < 1.5) return
            const conf = (prob >= 0.65 && edge >= 4) ? 'high'
                       : (prob >= 0.55 && edge >= 2.5) ? 'medium'
                       : 'low'
            const lineLbl = line != null ? ` ${line}` : ''
            const dirLbl  = dir === 'over' ? 'Over' : dir === 'under' ? 'Under' : ''
            out.push({
              event_id: M.fixtureId,
              sport: M.competition?.toLowerCase().includes('nba') ? 'basketball' : 'football',
              league: M.competition || 'Bet365',
              market: mk,
              outcome: `${M.home} v ${M.away} · ${sel}${dirLbl ? ' ' + dirLbl : ''}${lineLbl}`,
              book: 'Bet365 (real)',
              price_at_pick: +odd.toFixed(2), fair_price: +(1/prob).toFixed(2),
              edge_pct: edge, model_prob: prob, ensemble_prob: prob,
              confidence: conf,
              explain: `📊 ${mk} · prob ${(prob*100).toFixed(0)}% · vig descontado`,
              commence_time: M.commenceTime,
              kelly_frac: Math.max(0, (prob * (odd - 1) - (1 - prob)) / (odd - 1)),
              _isMarketReal: true,
            })
          }
          // Self-devig helper: toma rows do mesmo grupo e retorna prob no-vig
          const devigGroup = (rows) => {
            const sumImpl = rows.reduce((s, r) => s + (r.impliedProb || 1/r.odd), 0)
            return rows.map(r => ({ ...r, fairProb: (r.impliedProb || 1/r.odd) / sumImpl }))
          }

          // ── 1X2 (3-way) ─────────────────────────────────
          const oneXtwo = M.markets?.['1X2'] || []
          if (oneXtwo.length === 3) {
            for (const r of devigGroup(oneXtwo)) {
              if (!r.selection || !r.odd) continue
              const sel = r.selection === 'home' ? M.home
                        : r.selection === 'away' ? M.away
                        : 'Empate'
              emit('1X2', sel, r.odd, r.fairProb)
            }
          }

          // ── BTTS ──────────────────────────────────
          const btts = M.markets?.['BTTS'] || []
          if (btts.length === 2) {
            for (const r of devigGroup(btts)) {
              if (!r.selection) continue
              emit('BTTS', `Ambos marcam: ${r.selection === 'yes' ? 'Sim' : 'Não'}`, r.odd, r.fairProb)
            }
          }

          // ── Double Chance ─────────────────────────
          const dc = M.markets?.['DOUBLE_CHANCE'] || []
          if (dc.length >= 2) {
            for (const r of devigGroup(dc)) {
              const lbl = r.selection === '1X' ? `${M.home} ou Empate`
                        : r.selection === '12' ? `${M.home} ou ${M.away}`
                        : r.selection === 'X2' ? `Empate ou ${M.away}` : r.selection
              emit('DOUBLE_CHANCE', lbl, r.odd, r.fairProb)
            }
          }

          // ── Draw No Bet ───────────────────────────
          const dnb = M.markets?.['DRAW_NO_BET'] || []
          if (dnb.length === 2) {
            for (const r of devigGroup(dnb)) {
              const sel = r.selection === 'home' ? M.home : r.selection === 'away' ? M.away : r.selection
              emit('DRAW_NO_BET', `Empate anula: ${sel}`, r.odd, r.fairProb)
            }
          }

          // ── Total Goals (O/U pairs por linha) ─────
          const totals = M.markets?.['TOTAL_GOALS'] || []
          for (const t of totals) {
            if (t.over && t.under) {
              const probOver = (1/t.over) / (1/t.over + 1/t.under)
              emit('TOTAL_GOALS', `Total Gols`, t.over, probOver, t.line, 'over')
              emit('TOTAL_GOALS', `Total Gols`, t.under, 1 - probOver, t.line, 'under')
            }
          }

          // ── Corners O/U ────────────────────────────
          const corners = M.markets?.['CORNERS_OU'] || []
          for (const c of corners) {
            if (c.over && c.under) {
              const probOver = (1/c.over) / (1/c.over + 1/c.under)
              emit('CORNERS_OU', 'Total Escanteios', c.over, probOver, c.line, 'over')
              emit('CORNERS_OU', 'Total Escanteios', c.under, 1 - probOver, c.line, 'under')
            }
          }

          // ── NBA Game Lines (após scraper fix com side+line) ─
          const nbaGl = M.markets?.['NBA_GAME_LINES'] || []
          // Agrupa por maName pra devig por sub-mercado
          const nbaGroups = {}
          for (const r of nbaGl) {
            const k = r.maName || 'main'
            if (!nbaGroups[k]) nbaGroups[k] = []
            nbaGroups[k].push(r)
          }
          for (const [groupName, rows] of Object.entries(nbaGroups)) {
            if (rows.length < 2) continue
            for (const r of devigGroup(rows)) {
              const sel = r.selection || (r.side === 'home' ? M.home : r.side === 'away' ? M.away : groupName)
              const isLine = groupName.toLowerCase().includes('total') || groupName.toLowerCase().includes('spread')
              emit(`NBA_${groupName.toUpperCase().replace(/\s+/g,'_')}`, sel, r.odd, r.fairProb, isLine ? r.line : null)
            }
          }

          // ── NBA Team Totals ──────────────────────
          const nbaTT = M.markets?.['NBA_TEAM_TOTALS'] || []
          for (const r of devigGroup(nbaTT)) {
            const sel = r.selection || (r.side === 'home' ? M.home : r.side === 'away' ? M.away : 'team')
            emit('NBA_TEAM_TOTALS', `${sel} Pontos`, r.odd, r.fairProb, r.line)
          }

          // ── Player Score/Assist (futebol) ────────
          const playerScore = M.markets?.['PLAYER_SCORE_OR_ASSIST'] || []
          // Pula self-devig (cada player é independente, vig vai inflar)
          // Filtra só os com odd 1.5–6 e prob estimada baseada na implied
          for (const r of playerScore.slice(0, 3)) {
            if (!r.player || !r.odd) continue
            // Valida que player parece um nome real (>=2 palavras OU >=1 palavra com 5+ chars)
            // Rejeita placeholders genéricos: "Score", "Marca", "Para Marcar", "Yes", "No", maName etc.
            const playerStr = String(r.player).trim()
            const genericTerms = /^(score|marca|para marcar|sim|n[aã]o|yes|no|over|under|home|away|main|all|none)$/i
            const looksReal = playerStr.length >= 4 && !genericTerms.test(playerStr) && /[a-zA-ZÀ-ÿ]/.test(playerStr)
            if (!looksReal) continue
            // Implied direta, ajusta com vig 5%
            const prob = (1/r.odd) * 1.04   // remove 4% vig do mercado
            emit('PLAYER_SCORE_OR_ASSIST', `${playerStr} Marca/Assistência`, r.odd, prob)
          }

          // Penaliza picks dessa fixture se tiver muito steam UP (mercado contra)
          if (steamUp >= 2) {
            // Volta e degrada confidence dos picks adicionados nesta fixture
            for (const p of out) {
              if (p.event_id === M.fixtureId && p._isMarketReal) {
                if (p.confidence === 'high') p.confidence = 'medium'
                else if (p.confidence === 'medium') p.confidence = 'low'
              }
            }
          }
        }
      } catch {}

      // 4. Pipeline antigo (boosts curated + steam standalone) como complemento
      {
        // 2a. Markets analyzed cruzados com Bovada
        const mar = await fetch(`${API_BASE}/v1/bet365/markets/analyzed`).then(r => r.json()).catch(() => ({}))
        if (mar.ok && mar.matches) {
          for (const M of mar.matches) {
            for (const [mkey, rows] of Object.entries(M.markets || {})) {
              for (const r of rows) {
                // O/U markets: over+under per linha
                if (r.over != null && r.under != null) {
                  if (r.overEV != null && r.overEV >= minEdge) {
                    out.push({
                      event_id: M.fixtureId, sport: M.competition?.toLowerCase().includes('nba') ? 'basketball' : 'football',
                      league: M.competition, market: mkey, outcome: `${M.home} v ${M.away} · Over ${r.line}`,
                      book: 'Bet365', price_at_pick: r.over, fair_price: +(1/r.overProb).toFixed(2),
                      edge_pct: r.overEV, model_prob: r.overProb, ensemble_prob: r.overProb,
                      confidence: r.overEV >= 5 ? 'high' : r.overEV >= 2 ? 'medium' : 'low',
                      explain: `📊 Bet365 odd ${r.over} vs Bovada no-vig prob ${(r.overProb*100).toFixed(1)}%`,
                      commence_time: M.commenceTime,
                      kelly_frac: Math.max(0, (r.overProb * (r.over - 1) - (1 - r.overProb)) / (r.over - 1)),
                    })
                  }
                  if (r.underEV != null && r.underEV >= minEdge) {
                    out.push({
                      event_id: M.fixtureId, sport: M.competition?.toLowerCase().includes('nba') ? 'basketball' : 'football',
                      league: M.competition, market: mkey, outcome: `${M.home} v ${M.away} · Under ${r.line}`,
                      book: 'Bet365', price_at_pick: r.under, fair_price: +(1/r.underProb).toFixed(2),
                      edge_pct: r.underEV, model_prob: r.underProb, ensemble_prob: r.underProb,
                      confidence: r.underEV >= 5 ? 'high' : r.underEV >= 2 ? 'medium' : 'low',
                      explain: `📊 Bet365 odd ${r.under} vs Bovada no-vig prob ${(r.underProb*100).toFixed(1)}%`,
                      commence_time: M.commenceTime,
                      kelly_frac: Math.max(0, (r.underProb * (r.under - 1) - (1 - r.underProb)) / (r.under - 1)),
                    })
                  }
                } else if (r.ev != null && r.ev >= minEdge) {
                  out.push({
                    event_id: M.fixtureId, sport: M.competition?.toLowerCase().includes('nba') ? 'basketball' : 'football',
                    league: M.competition, market: mkey,
                    outcome: `${M.home} v ${M.away} · ${r.selection || r.player || '?'}`,
                    book: 'Bet365', price_at_pick: r.odd, fair_price: +(1/r.fairProb).toFixed(2),
                    edge_pct: r.ev, model_prob: r.fairProb, ensemble_prob: r.fairProb,
                    confidence: r.ev >= 5 ? 'high' : r.ev >= 2 ? 'medium' : 'low',
                    explain: `📊 Cross-book ${M.crossBook || 'no-vig'} fair prob ${(r.fairProb*100).toFixed(1)}%`,
                    commence_time: M.commenceTime,
                    kelly_frac: Math.max(0, (r.fairProb * (r.odd - 1) - (1 - r.fairProb)) / (r.odd - 1)),
                  })
                }
              }
            }
          }
        }

        // 2b. CURADORIA INCISIVA: boosts passam por filtros de qualidade
        // e cruzamento com sinais externos (vig do fixture, steam moves) antes
        // de virarem picks reais. Lixo é descartado, top é ranqueado por evidência.
        const bar = await fetch(`${API_BASE}/v1/aumentadas/latest`).then(r => r.json()).catch(() => ({}))
        function normOdd(raw) {
          if (!raw || !Number.isFinite(raw)) return null
          let v = raw
          while (v > 1000) v /= 10
          return v >= 1.01 ? +v.toFixed(2) : null
        }
        const candidates = []
        if (bar.ok && bar.boosts) {
          for (const b of bar.boosts) {
            const rawBoost = normOdd(b.boostOdd)
            const rawOrig  = normOdd(b.origOdd)
            if (!rawBoost || !rawOrig) continue
            const boostOdd = Math.max(rawBoost, rawOrig)
            const origOdd  = Math.min(rawBoost, rawOrig)

            // ── FILTROS DE QUALIDADE (rejeita lixo) ───────────────────────
            // F1: boost real (não invertido nem igual)
            if (boostOdd <= origOdd) continue
            // F2: range de odd original (1.3–12 inclui acumuladores NBA/futebol)
            if (origOdd < 1.3 || origOdd > 12) continue
            // F3: boost odd realista (<= 100)
            if (boostOdd > 100) continue
            // F4: ganho mínimo (>=15%)
            const boostGain = (boostOdd / origOdd - 1) * 100
            if (boostGain < 15) continue
            // F5: fixture válido com 1X2 capturado (não é jogo fantasma)
            const fixture = matchesByFid[b.fixtureId]
            if (!fixture || !fixture.odds?.home) continue
            // F6: vig do fixture razoável (<=10%) — vig alto = mercado ineficiente p/ devig
            const vig = vigByFid[b.fixtureId]
            if (vig != null && vig > 10) continue

            // ── CÁLCULO DE EDGE ────────────────────────────────────────────
            // No-vig prob do origOdd usando o vig REAL do fixture (não chute 5%)
            const vigFactor = 1 + (vig != null ? vig / 100 : 0.05)
            const fairProb = 1 / (origOdd * vigFactor)
            const edge = +((fairProb * boostOdd - 1) * 100).toFixed(1)
            if (edge < 1.5) continue   // edge mín 1.5% pra entrar

            // ── CRUZAMENTO COM STEAM (mispriced) ───────────────────────────
            // Se houver steam HIGH UP na mesma fixture → mercado se moveu CONTRA esse boost (skip)
            // Se houver steam HIGH DOWN → confirma o lado, BOOST de confiança
            const fidSteams = steamByFid[b.fixtureId] || []
            const steamUp   = fidSteams.filter(s => s.severity === 'high' && s.direction === 'up').length
            const steamDown = fidSteams.filter(s => s.severity === 'high' && s.direction === 'down').length
            if (steamUp >= 2) continue  // muitos sinais contrários = passa
            const steamBoost = steamDown >= 1 ? 'aligned' : (steamUp >= 1 ? 'mixed' : 'neutral')

            // ── REASONING ──────────────────────────────────────────────────
            const reasoning = [
              `boost +${boostGain.toFixed(0)}% (${origOdd}→${boostOdd})`,
              `vig fixture ${vig != null ? vig + '%' : '~5%'}`,
              steamBoost === 'aligned' ? '✓ steam alinhado' : steamBoost === 'mixed' ? '⚠ steam misto' : null,
              `${b.legs?.length || 1} leg${(b.legs?.length || 1) > 1 ? 's' : ''}`,
            ].filter(Boolean).join(' · ')

            // Confiança: edge×evidências combinadas
            const confidence = (edge >= 8 && steamBoost !== 'mixed') ? 'high'
                             : (edge >= 5 || steamBoost === 'aligned') ? 'medium'
                             : 'low'

            const matchName = b.home && b.away && b.away !== '?' ? `${b.home} v ${b.away}` : (b.home || 'Acumulador')
            candidates.push({
              event_id: b.fixtureId,
              sport: b.competition?.toLowerCase().includes('nba') ? 'basketball' : 'football',
              league: b.competition || 'Bet365',
              market: 'BOOST',
              outcome: `${matchName}`,
              book: 'Bet365',
              price_at_pick: boostOdd, fair_price: +(1/fairProb).toFixed(2),
              edge_pct: edge, model_prob: fairProb, ensemble_prob: fairProb,
              confidence,
              explain: reasoning,
              commence_time: null,
              kelly_frac: Math.max(0, (fairProb * (boostOdd - 1) - (1 - fairProb)) / (boostOdd - 1)),
              _isBoost: true,
              _boostLegs: b.legs,
              _qualityScore: edge + (steamBoost === 'aligned' ? 5 : steamBoost === 'mixed' ? -3 : 0),
            })
          }
        }

        // Top 15 globalmente por qualityScore (não dedupa por fixture — diversidade
        // vem de jogos diferentes naturalmente, mas se um jogo tem 2 boosts bons, mostramos)
        const curated = candidates
          .sort((a, b) => b._qualityScore - a._qualityScore)
          .slice(0, 15)

        out.push(...curated)

        // 2c-bis. MARKETS CROSS-BOOK matched (Bovada) — surfacing main markets dos
        // jogos NBA/futebol que tiveram cross-book mesmo sem EV calculado pelo backend.
        // Marca como "manual review" (low conf) — user decide se aposta.
        try {
          const mktRes = await fetch(`${API_BASE}/v1/bet365/markets/analyzed?minEdge=0`).then(r => r.json()).catch(() => ({}))
          if (mktRes.ok && mktRes.matches?.length) {
            const fidsCovered = new Set(out.map(p => p.event_id))
            for (const M of mktRes.matches) {
              if (!M.crossBook) continue           // só com cross-book matched
              if (fidsCovered.has(M.fixtureId)) continue  // já tem boost desse jogo
              // Pega 1-2 markets principais do match
              const mainOrder = ['NBA_GAME_LINES', '1X2', 'TOTAL_GOALS', 'NBA_TEAM_TOTALS', 'BTTS', 'DRAW_NO_BET']
              const candidates = []
              for (const mk of mainOrder) {
                for (const r of (M.markets?.[mk] || [])) {
                  if (!r.odd || r.odd < 1.5 || r.odd > 5) continue
                  // ── ACIONÁVEL: precisa ter side+line (Spread) OU selection clara ──
                  // Sem isso o user não sabe se aposta no home/away ou linha qual.
                  const hasSelection = !!(r.selection && r.selection.trim() && r.selection !== 'main')
                  const hasSide      = !!r.side
                  const hasLine      = r.line != null
                  const isSpreadOrTotal = mk === 'NBA_GAME_LINES' || mk === 'TOTAL_GOALS' || mk === 'NBA_TEAM_TOTALS'
                  if (isSpreadOrTotal && !hasSide && !hasLine && !hasSelection) continue   // dado incompleto
                  if (!hasSelection && !hasSide && !hasLine && mk !== '1X2' && mk !== 'BTTS' && mk !== 'DRAW_NO_BET') continue
                  // Heurística "edge soft": cross-book existe → assume edge ~1% (margem mínima)
                  const fairProb = r.impliedProb * 1.04   // ~4% vig assumido
                  const estEdge = +((fairProb * r.odd - 1) * 100).toFixed(1)
                  if (estEdge < 0.5) continue
                  const sel = r.selection || r.maName || r.side || (mk === '1X2' ? 'home' : '?')
                  if (sel === '?') continue
                  candidates.push({
                    event_id: M.fixtureId,
                    sport: M.competition?.toLowerCase().includes('nba') ? 'basketball' : 'football',
                    league: M.competition || 'Bet365',
                    market: r.market,
                    outcome: `${M.home} v ${M.away} · ${sel}${r.line != null ? ` ${r.line}` : ''}`,
                    book: 'Bet365',
                    price_at_pick: r.odd, fair_price: +(1/fairProb).toFixed(2),
                    edge_pct: estEdge,
                    model_prob: fairProb, ensemble_prob: fairProb,
                    confidence: 'low',
                    explain: `📊 mercado main · cross-book ${M.crossBook} · prob ${(r.impliedProb*100).toFixed(1)}%`,
                    commence_time: M.commenceTime,
                    kelly_frac: Math.max(0, (fairProb * (r.odd - 1) - (1 - fairProb)) / (r.odd - 1)),
                    _isMarket: true,
                  })
                }
              }
              // 1 melhor por fixture pra não inundar
              if (candidates.length) {
                candidates.sort((a, b) => b.edge_pct - a.edge_pct)
                out.push(candidates[0])
              }
            }
          }
        } catch {}

        // 2c. ODDS DESAJUSTADAS (steam moves) — sinais de sharp money
        // Direction "down" + severity "high" = linha comprimida pelo mercado sharp
        // → o lado provavelmente vai bater. Stake especulativo (variance alta).
        for (const al of (mispricedRes.alerts || [])) {
          if (al.severity !== 'high') continue
          if (al.direction !== 'down') continue       // só backs do steam
          if (al.movePct == null || al.movePct < 8) continue
          if (!al.currentOdd || al.currentOdd < 1.4 || al.currentOdd > 15) continue
          // EV estimado: ~25% do movimento como edge real (heurística sharp)
          const estEdge = Math.min(al.movePct * 0.25, 8)
          const fairProb = (1 / al.currentOdd) * (1 + estEdge / 100)
          out.push({
            event_id: al.fixtureId,
            sport: al.competition?.toLowerCase().includes('nba') ? 'basketball' : 'football',
            league: al.competition || 'Bet365',
            market: al.market,
            outcome: `${al.home} v ${al.away} · ${al.selection}${al.line != null ? ` ${al.line}` : ''}`,
            book: 'Bet365',
            price_at_pick: al.currentOdd, fair_price: +(1/fairProb).toFixed(2),
            edge_pct: +estEdge.toFixed(1),
            model_prob: fairProb, ensemble_prob: fairProb,
            confidence: estEdge >= 5 ? 'medium' : 'low',
            explain: `⚡ STEAM: linha ${al.previousOdd?.toFixed(2)} → ${al.currentOdd?.toFixed(2)} (${al.movePct > 0 ? '+' : ''}${al.movePct.toFixed(1)}%, sharp money)`,
            commence_time: null,
            kelly_frac: Math.max(0, (fairProb * (al.currentOdd - 1) - (1 - fairProb)) / (al.currentOdd - 1)),
            _isSteam: true,
          })
        }

        // CORTE FINAL: só HIGH e MEDIUM entram no plano (LOW = pouca evidência,
        // não vale apostar pra subir banca — variance domina sobre edge fraco)
        out = out.filter(p => p.confidence === 'high' || p.confidence === 'medium')

        // FILTRO DE ACIONABILIDADE: descarta pick onde a seleção exata não é
        // identificável. Sem isso, user não sabe o que clicar no Bet365.
        out = out.filter(p => {
          // Boosts: precisam ter legs com text
          if (p._isBoost) {
            return Array.isArray(p._boostLegs) && p._boostLegs.some(l => (l.text || '').trim().length >= 3)
          }
          // Steams: precisam ter selection no outcome
          if (p._isSteam) {
            return p.outcome && p.outcome.length > 5 && !/·\s*\?$/.test(p.outcome)
          }
          // Markets cross-book: outcome precisa conter mais que "Home v Away · main"
          if (p._isMarket) {
            const tail = (p.outcome || '').split('·').slice(1).join('·').trim()
            return tail.length >= 2 && tail !== 'main' && tail !== '?' && !/^(Spread|Total)$/i.test(tail)
          }
          // Picks normais: precisam ter outcome não-vazio
          return !!(p.outcome && p.outcome.trim().length >= 3)
        })

        // Ordena: HIGH conf primeiro, depois por edge
        const confOrder = { high: 3, medium: 2 }
        out.sort((a, b) => (confOrder[b.confidence] || 0) - (confOrder[a.confidence] || 0) || b.edge_pct - a.edge_pct)
      }

      setPicks(out)
      if (!out.length) setErr('no_value_candidates')

      // ── AI LEARNING: salva TODOS os picks gerados em pick_history ──
      // Cada pick alimenta Bayesian + ML training quando finalizar (auto-verify resolve W/L)
      // Antes só FtProps/Garantido salvavam — Banca365 perdia esse sinal
      try {
        const today = new Date().toISOString().slice(0, 10)
        const picksToSave = out
          .filter(p => p.outcome && p.market && (p.confidence === 'high' || p.confidence === 'medium'))
          .slice(0, 30)  // top 30 picks da página
          .map(p => ({
            id: `banca|${today}|${(p.event_id || p.outcome).slice(0, 60).replace(/[^a-z0-9]/gi, '_')}|${p.market}`,
            pick_date: today,
            match: p.outcome.split('·')[0]?.trim() || p.outcome,
            league: p.league || '',
            sport: p.sport || 'football',
            stat: `${p.market} ${p.outcome.split('·').slice(1).join(' ').trim()}`.slice(0, 100),
            conf: Math.round((p.model_prob || 0) * 100),
            tier: p.confidence,
            real_odd: p.price_at_pick || null,
            ev_real: p.edge_pct || null,
            result: null,
            auto_verified: 0,
          }))
        if (picksToSave.length) {
          fetch(`${API_BASE}/v1/picks/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ picks: picksToSave }),
          }).catch(() => {})
        }
      } catch {}
    } catch (e) {
      setErr(e.message)
      setPicks([])
    } finally { setLoading(false) }
  }

  useEffect(() => { loadPicks() }, [])

  // Notificação push: alerta quando aparecer pick HIGH novo + edge ≥ 5%
  useEffect(() => {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    const seenIds = new Set(JSON.parse(localStorage.getItem('sb_seen_picks') || '[]'))
    let newAlerts = 0
    for (const p of picks) {
      const id = p.event_id + '|' + p.market + '|' + p.outcome
      if (seenIds.has(id)) continue
      if (p.confidence !== 'high') continue
      if ((p.edge_pct || 0) < 5) continue
      seenIds.add(id)
      try {
        new Notification('🎯 Pick HIGH +EV', {
          body: `${p.outcome} @${p.price_at_pick?.toFixed(2)} · edge ${p.edge_pct?.toFixed(1)}%`,
          icon: '/favicon.ico', tag: id,
        })
        newAlerts++
        if (newAlerts >= 3) break   // max 3 notificações por refresh
      } catch {}
    }
    if (newAlerts > 0) {
      try { localStorage.setItem('sb_seen_picks', JSON.stringify([...seenIds].slice(-200))) } catch {}
    }
  }, [picks])

  // Fetch paralelo das fontes que alimentam a aba "Por Jogo"
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_BASE}/v1/bet365/matches/latest`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/v1/bet365/markets/analyzed`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/v1/bet365/markets/mispriced`).then(r => r.json()).catch(() => ({})),
    ]).then(([m, a, mp]) => {
      if (cancelled) return
      if (m?.ok && Array.isArray(m.matches)) setMatches(m.matches)
      if (a?.ok) setAnalyzed(a)
      if (mp?.ok) setMispriced(mp)
    })
    return () => { cancelled = true }
  }, [])

  // Calcula stake por pick usando Kelly fracionado do ensemble_prob.
  // Min stake R$0,50 (Bet365 mínimo pra registrar a aposta).
  const MIN_STAKE = 0.50
  const enriched = useMemo(() => picks.map(p => {
    const prob = p.ensemble_prob ?? p.model_prob ?? (1 / p.fair_price)
    const b = (p.price_at_pick || 2) - 1
    const f = b > 0 ? (prob * b - (1 - prob)) / b : 0
    let stake = f > 0 && balance > 0 ? Math.min(f * kellyMult * balance, balance * 0.05) : 0
    // Clamp pro mínimo R$0,50 (se Kelly recomenda menos mas ainda é +EV, sobe pro mínimo apostável)
    if (stake > 0 && stake < MIN_STAKE) stake = MIN_STAKE
    stake = +stake.toFixed(2)
    const ev = stake > 0 ? +((prob * p.price_at_pick - 1) * stake).toFixed(2) : 0
    return { ...p, stake, ev, prob, kelly_pct: +(f * 100).toFixed(2) }
  }).filter(p => p.stake > 0), [picks, balance, kellyMult])

  // ─── Por Jogo: agrega matches + cross-book + mispriced + picks pro fixture ──
  const byGame = useMemo(() => {
    const ascByTime = (a, b) => (a.startTime || '').localeCompare(b.startTime || '')
    const out = []
    const analyzedByFid = {}
    for (const M of (analyzed?.matches || [])) analyzedByFid[M.fixtureId] = M
    const mispricedByFid = {}
    for (const al of (mispriced?.alerts || [])) {
      if (!mispricedByFid[al.fixtureId]) mispricedByFid[al.fixtureId] = []
      mispricedByFid[al.fixtureId].push(al)
    }
    const picksByFid = {}
    for (const p of enriched) {
      if (!picksByFid[p.event_id]) picksByFid[p.event_id] = []
      picksByFid[p.event_id].push(p)
    }
    for (const m of matches.sort(ascByTime)) {
      // Vig do Bet365 1X2
      const o = m.odds || {}
      let vigPct = null, fairs = null
      if (o.home && o.draw && o.away) {
        const i1 = 1/o.home, ix = 1/o.draw, i2 = 1/o.away
        const sum = i1 + ix + i2
        vigPct = +((sum - 1) * 100).toFixed(1)
        fairs = { home: +(1/(i1/sum)).toFixed(2), draw: +(1/(ix/sum)).toFixed(2), away: +(1/(i2/sum)).toFixed(2) }
      }
      // Best bet sugerida pro jogo: maior EV entre cross-book + picks já enriquecidos
      const fidPicks = picksByFid[m.fixtureId] || []
      const fidPicksSorted = fidPicks.sort((a, b) => (b.edge_pct || 0) - (a.edge_pct || 0))
      const bestBet = fidPicksSorted[0] || null
      // Conta alertas mispriced
      const alerts = mispricedByFid[m.fixtureId] || []
      const steamHigh = alerts.filter(a => a.severity === 'high').length
      // Ação score (heurística simples pra ranquear cards): high alerts + best edge
      const actionScore = (bestBet?.edge_pct || 0) + steamHigh * 5
      out.push({
        ...m, vigPct, fairs, alerts, bestBet,
        crossBook: analyzedByFid[m.fixtureId] || null,
        picks: fidPicks, actionScore,
      })
    }
    return out.sort((a, b) => b.actionScore - a.actionScore)
  }, [matches, analyzed, mispriced, enriched])

  // Filtro de mercado: agrupa por keyword no market field
  const marketMatches = (p, filter) => {
    if (filter === 'all') return true
    const m = (p.market || '').toLowerCase()
    if (filter === 'goals')   return /gol|goal|over|under|btts|ambos/.test(m)
    if (filter === 'btts')    return /btts|ambos/.test(m)
    if (filter === 'result')  return /1x2|result|chance|empate|handicap/.test(m)
    if (filter === 'corners') return /corner|escanteio/.test(m)
    if (filter === 'cards')   return /card|cart/.test(m)
    if (filter === 'player')  return /player|jogador|score|marca|chute|reb|ast/.test(m)
    return true
  }

  // Filtro de horário: kickoff dentro de janela
  const timeMatches = (p, filter) => {
    if (filter === 'all') return true
    if (!p.commence_time) return true
    const hoursAhead = (new Date(p.commence_time).getTime() - Date.now()) / 3600_000
    if (hoursAhead < 0) return false   // já começou
    if (filter === '3h')    return hoursAhead <= 3
    if (filter === '6h')    return hoursAhead <= 6
    if (filter === 'today') return hoursAhead <= 24
    return true
  }

  // Lista de ligas únicas pra dropdown
  const allLeagues = useMemo(() => {
    const set = new Set()
    enriched.forEach(p => p.league && set.add(p.league))
    return [...set].sort()
  }, [enriched])

  // Cap de stake por pick (% banca)
  const capStakePct = (p) => {
    if (balance > 0 && p.stake > balance * (maxStakePct/100)) {
      return { ...p, stake: +(balance * (maxStakePct/100)).toFixed(2), _capped: true }
    }
    return p
  }

  // Diversificação: max 2 picks por fixture
  const applyDiversification = (list) => {
    if (!diversify) return list
    const byFid = {}
    const out = []
    for (const p of list) {
      const fid = p.event_id || 'x'
      if (!byFid[fid]) byFid[fid] = 0
      if (byFid[fid] >= 2) continue
      byFid[fid]++
      out.push(p)
    }
    return out
  }

  // Separa por nº de legs: 1 leg = individual, 2+ legs = múltipla
  const enrichedSingles = useMemo(
    () => applyDiversification(
      enriched
        .filter(p => !p._isBoost || (p._boostLegs?.length || 1) <= 1)
        .filter(p => marketMatches(p, marketFilter))
        .filter(p => timeMatches(p, timeFilter))
        .filter(p => leagueFilter === 'all' || p.league === leagueFilter)
        .map(capStakePct)
    ),
    [enriched, marketFilter, diversify, timeFilter, leagueFilter, maxStakePct, balance]
  )
  const enrichedMultis = useMemo(
    () => enriched.filter(p => p._isBoost && (p._boostLegs?.length || 0) >= 2),
    [enriched]
  )


  // Sugere combos 2-leg e 3-leg: combina probabilidades (independência) e odds.
  // Usa pool maior (top 12 por edge) e diversifica: nunca duas legs do mesmo event.
  const { combos2, combos3 } = useMemo(() => {
    // Pool: top 12 picks por edge_pct (mais ampla pra ter variedade de jogos)
    const pool = [...enriched].sort((a, b) => b.edge_pct - a.edge_pct).slice(0, 12)
    // 2-leg
    const pairs = []
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i], b = pool[j]
        if (a.event_id === b.event_id) continue
        const comboProb = a.prob * b.prob
        const comboOdd  = a.price_at_pick * b.price_at_pick
        if (comboOdd > 50) continue                        // cap absurdo
        const comboEdge = +((comboProb * comboOdd - 1) * 100).toFixed(2)
        if (comboEdge < 5) continue
        const stake = +(Math.max(MIN_STAKE, Math.min(balance * 0.015, 30))).toFixed(2) // 1.5% banca ou R$30, min R$0,50
        pairs.push({ legs: [a, b], comboProb, comboOdd: +comboOdd.toFixed(2), comboEdge, stake,
          expected: +((comboProb * comboOdd - 1) * stake).toFixed(2) })
      }
    }
    // 3-leg
    const triples = []
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let k = j + 1; k < pool.length; k++) {
          const a = pool[i], b = pool[j], c = pool[k]
          if (a.event_id === b.event_id || a.event_id === c.event_id || b.event_id === c.event_id) continue
          const comboProb = a.prob * b.prob * c.prob
          const comboOdd  = a.price_at_pick * b.price_at_pick * c.price_at_pick
          if (comboOdd > 80 || comboOdd < 3) continue
          const comboEdge = +((comboProb * comboOdd - 1) * 100).toFixed(2)
          if (comboEdge < 8) continue
          const stake = +(Math.max(MIN_STAKE, Math.min(balance * 0.01, 20))).toFixed(2) // 1% ou R$20, min R$0,50
          triples.push({ legs: [a, b, c], comboProb, comboOdd: +comboOdd.toFixed(2), comboEdge, stake,
            expected: +((comboProb * comboOdd - 1) * stake).toFixed(2) })
        }
      }
    }
    return {
      combos2: pairs.sort((x, y) => y.expected - x.expected).slice(0, 5),
      combos3: triples.sort((x, y) => y.expected - x.expected).slice(0, 4),
    }
  }, [enriched, balance])

  const totalStake = enriched.reduce((s, p) => s + p.stake, 0)
  const totalEv    = enriched.reduce((s, p) => s + p.ev, 0)
  const pctBanca   = balance > 0 ? +(totalStake / balance * 100).toFixed(1) : 0

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Header + controles */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom:12, flexWrap:'wrap', gap:10,
      }}>
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:'var(--white)' }}>
            🎯 Plano do Dia — baseado na sua banca de {fmtBRL(balance)}
          </div>
          <div style={{ fontSize:11, color:'var(--mute)', marginTop:2 }}>
            Picks do engine ensemble (Elo + Poisson + sharp books), Kelly fracionado contra teu saldo.
            Execute manual no Bet365. <strong style={{color:'var(--amber)'}}>Nenhuma aposta é garantida.</strong>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <label style={{ fontSize:10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>
            MIN EDGE
            <input type="number" value={minEdge} min={1} max={10} step={0.5}
              onChange={e => setMinEdge(parseFloat(e.target.value))}
              style={{ marginLeft:6, width:52, padding:'4px 6px', background:'var(--card-bg)',
                border:'1px solid var(--card-border)', color:'var(--white)', borderRadius:6, fontSize:11 }} />
          </label>
          <label style={{ fontSize:10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>
            KELLY
            <select value={kellyMult} onChange={e => setKellyMult(parseFloat(e.target.value))}
              style={{ marginLeft:6, padding:'4px 6px', background:'var(--card-bg)',
                border:'1px solid var(--card-border)', color:'var(--white)', borderRadius:6, fontSize:11 }}>
              <option value={0.1}>0.1× (ultra-safe)</option>
              <option value={0.25}>0.25× (padrão pro)</option>
              <option value={0.5}>0.5× (agressivo)</option>
            </select>
          </label>
          <button onClick={loadPicks} disabled={loading} style={{
            padding:'6px 12px', background:'var(--blue)', border:'none', borderRadius:6,
            color:'#fff', fontWeight:700, fontSize:11, cursor:'pointer',
          }}>{loading ? '…' : '↻ Atualizar'}</button>
        </div>
      </div>

      {/* Resumo KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:8, marginBottom:14 }}>
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:10, padding:'10px 12px' }}>
          <div style={{ fontSize:10, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>Picks qualificados</div>
          <div style={{ fontSize:22, fontWeight:900, color:'var(--green)', fontFamily:"'JetBrains Mono',monospace" }}>{enriched.length}</div>
        </div>
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:10, padding:'10px 12px' }}>
          <div style={{ fontSize:10, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>Stake total</div>
          <div style={{ fontSize:22, fontWeight:900, color:'var(--blue)', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBRL(totalStake)}</div>
          <div style={{ fontSize:10, color:'var(--mute)' }}>{pctBanca}% da banca</div>
        </div>
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:10, padding:'10px 12px' }}>
          <div style={{ fontSize:10, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>EV esperado</div>
          <div style={{ fontSize:22, fontWeight:900, color:totalEv > 0 ? 'var(--green)' : 'var(--red)', fontFamily:"'JetBrains Mono',monospace" }}>
            {totalEv > 0 ? '+' : ''}{fmtBRL(totalEv)}
          </div>
          <div style={{ fontSize:10, color:'var(--mute)' }}>valor esperado matemático</div>
        </div>
      </div>

      {err && !loading && (
        <div style={{
          background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)',
          borderRadius:10, padding:'14px 16px', marginBottom:14, fontSize:12, color:'var(--amber)',
        }}>
          ⏳ <strong>Sem picks qualificados agora</strong> — engine não encontrou value ≥ {minEdge}% no pool atual.
          Tente reduzir o min edge ou volta mais tarde. O cron das 08:00 BRT gera picks automaticamente.
          {err && err !== 'no_value_candidates' && ` (${err})`}
        </div>
      )}

      {/* Separa enriched por número de legs:
            - 1 leg (single pick OU boost de 1 leg) → Individuais
            - 2+ legs (boost multi-leg)            → Múltiplas */}
      {(() => null)()}
      {/* Filtros: mercado + diversificação */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap', padding:'8px 10px',
        background:'rgba(255,255,255,.03)', border:'1px solid var(--card-border)', borderRadius:8, fontSize:11 }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>filtrar:</span>
        {[
          { id:'all',     l:'Todos' },
          { id:'goals',   l:'⚽ Gols/BTTS' },
          { id:'result',  l:'🏆 Resultado' },
          { id:'corners', l:'🚩 Escanteios' },
          { id:'cards',   l:'🟨 Cartões' },
          { id:'player',  l:'👤 Jogador' },
        ].map(f => (
          <button key={f.id} onClick={() => setMarketFilter(f.id)} style={{
            padding:'4px 8px', fontSize:10, fontWeight:700, borderRadius:5, cursor:'pointer',
            fontFamily:"'JetBrains Mono',monospace",
            background: marketFilter === f.id ? 'rgba(59,130,246,.18)' : 'transparent',
            border: `1px solid ${marketFilter === f.id ? 'var(--blue)' : 'var(--card-border)'}`,
            color: marketFilter === f.id ? 'var(--blue)' : 'var(--mute)',
          }}>{f.l}</button>
        ))}
        <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6 }}>
          <input type="checkbox" id="diversify" checked={diversify}
            onChange={e => { setDiversify(e.target.checked); try { localStorage.setItem('sb_plano_diversify', e.target.checked ? '1' : '0') } catch {} }} />
          <label htmlFor="diversify" style={{ fontSize:10, color:'var(--mute)', cursor:'pointer' }}>
            🎯 Diversificar
          </label>
        </span>
      </div>

      {/* Linha 2: Liga + Horário + Stake max */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap', padding:'6px 10px',
        background:'rgba(255,255,255,.02)', border:'1px solid var(--card-border)', borderRadius:8, fontSize:10 }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)' }}>liga:</span>
        <select value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)}
          style={{ fontSize:10, padding:'3px 6px', borderRadius:5, background:'var(--card-bg)', border:'1px solid var(--card-border)', color:'var(--soft)' }}>
          <option value="all">Todas ({allLeagues.length})</option>
          {allLeagues.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)' }}>horário:</span>
        {[
          { id:'all', l:'Todos' },
          { id:'3h', l:'≤3h' },
          { id:'6h', l:'≤6h' },
          { id:'today', l:'Hoje' },
        ].map(t => (
          <button key={t.id} onClick={() => setTimeFilter(t.id)} style={{
            padding:'3px 7px', fontSize:10, borderRadius:5, cursor:'pointer',
            background: timeFilter === t.id ? 'rgba(34,212,160,.15)' : 'transparent',
            border:`1px solid ${timeFilter === t.id ? 'var(--green)' : 'var(--card-border)'}`,
            color: timeFilter === t.id ? 'var(--green)' : 'var(--mute)',
          }}>{t.l}</button>
        ))}
        <span style={{ marginLeft:'auto', fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)' }}>
          exposição máx (LAB): <input type="number" value={maxStakePct} min={1} max={20} step={0.5}
            onChange={e => { const v = parseFloat(e.target.value); setMaxStakePct(v); try { localStorage.setItem('sb_plano_max_stake_pct', String(v)) } catch {} }}
            style={{ width:50, fontSize:10, padding:'3px 5px', marginLeft:4, borderRadius:4, background:'var(--card-bg)', border:'1px solid var(--card-border)', color:'var(--soft)' }} />% (simulado)
        </span>
      </div>

      {/* Segmented: Por Jogo / Individuais / Múltiplas */}
      <div style={{ display:'flex', gap:0, marginBottom:14, borderBottom:'1px solid var(--card-border)', overflowX:'auto' }}>
        {[
          { id:'singles', l:`🎯 Individuais (${enrichedSingles.length})` },
          { id:'multis',  l:`🔗 Múltiplas (${enrichedMultis.length + combos2.length + combos3.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => { setView(t.id); try { localStorage.setItem('sb_plano_view', t.id) } catch {} }} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
            padding:'10px 18px', background:'none', border:'none',
            borderBottom: view===t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: view===t.id ? 'var(--blue)' : 'var(--mute)',
            cursor:'pointer', marginBottom:-1, whiteSpace:'nowrap',
          }}>{t.l}</button>
        ))}
      </div>


      {/* Individuais */}
      {view === 'singles' && !!enrichedSingles.length && (
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:18 }}>
          {enrichedSingles.map((p, i) => (
            <PickCard key={i} p={p} />
          ))}
        </div>
      )}

      {/* Múltiplas: boosts multi-leg do Bet365 + combos sugeridos */}
      {view === 'multis' && (!!enrichedMultis.length || !!combos2.length || !!combos3.length) && (
        <div style={{ marginBottom: 18 }}>
          {!!enrichedMultis.length && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#22d3a0', marginBottom:6, textTransform:'uppercase', letterSpacing:'.5px' }}>
                Aumentadas Bet365 — multi-leg prontas
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {enrichedMultis.map((p, i) => (
                  <PickCard key={`bm${i}`} p={p} />
                ))}
              </div>
            </div>
          )}

          {(!!combos2.length || !!combos3.length) && (
            <div style={{ fontSize:10, color:'var(--mute)', marginBottom:10, marginTop:4, lineHeight:1.5 }}>
              Abaixo: combinações <strong>nossas</strong> de picks individuais de partidas diferentes (independência estatística), ranqueadas por EV.
              <strong style={{color:'var(--amber)'}}> Quanto mais legs, mais difícil.</strong>
            </div>
          )}

          {!!combos2.length && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#a5b4fc', marginBottom:6, textTransform:'uppercase', letterSpacing:'.5px' }}>
                Dupla (2-leg)
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {combos2.map((c, i) => (
                  <ComboCard key={`d${i}`} c={c} idx={i+1} accent="#818cf8" accentBg="rgba(99,102,241,.06)" accentBorder="rgba(99,102,241,.28)" />
                ))}
              </div>
            </div>
          )}

          {!!combos3.length && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#fbbf24', marginBottom:6, textTransform:'uppercase', letterSpacing:'.5px' }}>
                Tripla (3-leg) · alta variance, payout maior
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {combos3.map((c, i) => (
                  <ComboCard key={`t${i}`} c={c} idx={i+1} accent="#fbbf24" accentBg="rgba(251,191,36,.06)" accentBorder="rgba(251,191,36,.28)" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state pra view ativa */}
      {view === 'singles' && !enrichedSingles.length && !err && !loading && (
        <div style={{ padding:24, textAlign:'center', color:'var(--mute)', fontSize:12 }}>
          Sem picks individuais (single-leg) qualificados no momento.
        </div>
      )}
      {view === 'multis' && !enrichedMultis.length && !combos2.length && !combos3.length && !loading && (
        <div style={{ padding:24, textAlign:'center', color:'var(--mute)', fontSize:12 }}>
          Sem múltiplas +EV no momento.
        </div>
      )}

      {/* Disclaimer */}
      <div style={{
        marginTop:16, padding:'12px 14px', background:'rgba(239,68,68,.05)',
        border:'1px solid rgba(239,68,68,.25)', borderRadius:10, fontSize:11, color:'var(--mute)', lineHeight:1.6,
      }}>
        ⚠️ <strong style={{color:'var(--red)'}}>Disclaimer:</strong> nenhuma aposta individual é garantida —
        o engine só otimiza EV esperado a longo prazo. A recomendação de stake usa Kelly fracionado
        ({kellyMult}× do Kelly cheio) contra teu saldo atual, limitando cada aposta a no máximo 5% da banca.
        Variância é real: perder 3-4 picks seguidos é estatisticamente esperado mesmo com 60% win rate.
        Executa no Bet365 manualmente e registra o resultado em "Performance" pra alimentar o CLV tracker.
      </div>
    </div>
  )
}

// ─── Track Bet: marca pick como "user apostou" pra AI aprender com sinal real ──
async function trackBet(p) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const id = `banca|${today}|${(p.event_id || p.outcome).slice(0, 60).replace(/[^a-z0-9]/gi, '_')}|${p.market}`
    await fetch(`${API_BASE}/v1/picks/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ picks: [{
        id,
        pick_date: today,
        match: p.outcome.split('·')[0]?.trim() || p.outcome,
        league: p.league || '',
        sport: p.sport || 'football',
        stat: `${p.market} ${p.outcome.split('·').slice(1).join(' ').trim()}`.slice(0, 100),
        conf: Math.round((p.model_prob || 0) * 100),
        tier: p.confidence,
        real_odd: p.price_at_pick,
        ev_real: p.edge_pct,
        result: null,
        auto_verified: 0,
        // user_bet=1 marca como apostado de verdade — AI dá peso maior a estes
        user_bet: 1,
      }] }),
    })
    const toast = document.createElement('div')
    toast.textContent = '🎯 Aposta registrada! AI vai aprender com o resultado'
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(34,212,160,.95);color:#000;padding:10px 18px;border-radius:8px;font-weight:700;z-index:99999;font-size:13px'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 2400)
  } catch (e) {
    console.warn('[trackBet] erro:', e.message)
  }
}

// ─── Bet Builder: copia string formatada pro clipboard ──────────────────────
function copyBetToClipboard(p) {
  const isBoost = !!p._isBoost
  let txt = ''
  if (isBoost && p._boostLegs?.length) {
    txt = `🚀 ${p.outcome}\n`
    p._boostLegs.forEach((leg, i) => {
      txt += `${i+1}. ${leg.text}${leg.odd ? ` @${leg.odd}` : ''}\n`
    })
    txt += `\nOdd total: ${p.price_at_pick?.toFixed(2)} · Stake: R$ ${p.stake?.toFixed(2)}`
  } else {
    txt = `${p.outcome}\nMercado: ${p.market}\nOdd: ${p.price_at_pick?.toFixed(2)}\nStake: R$ ${p.stake?.toFixed(2)}\nEdge: ${p.edge_pct?.toFixed(1)}% · EV +R$ ${p.ev?.toFixed(2)}`
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(txt).then(() => {
      // Toast simples (alert efêmero)
      const toast = document.createElement('div')
      toast.textContent = '✓ Copiado! Cola no Bet365'
      toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(34,212,160,.95);color:#000;padding:10px 18px;border-radius:8px;font-weight:700;z-index:99999;font-size:13px'
      document.body.appendChild(toast)
      setTimeout(() => toast.remove(), 2200)
    }).catch(() => alert(txt))
  } else {
    alert(txt)
  }
}

// ─── Pick Card (single ou boost com legs explícitas) ─────────────────────────
function PickCard({ p }) {
  const [expanded, setExpanded] = useState(p._isBoost) // boost abre por padrão
  const confColor = p.confidence === 'high' ? 'var(--green)'
                  : p.confidence === 'medium' ? 'var(--amber)' : 'var(--mute)'
  const isBoost = !!p._isBoost
  const legs = p._boostLegs || []

  // Match name pra header (extrai do outcome ou usa league)
  const matchTitle = isBoost
    ? (p.outcome.replace(/^🚀\s*/, '').split(' · ')[0] || p.league)
    : p.outcome

  return (
    <div style={{
      background: isBoost ? 'rgba(99,102,241,.04)' : 'var(--card-bg)',
      border: `1px solid var(--card-border)`,
      borderLeft: `3px solid ${confColor}`,
      borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'flex-start' }}>
        <div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:4 }}>
            <span style={{ fontWeight:800, fontSize:13, color:'var(--white)' }}>
              {isBoost && '🚀 '}{matchTitle}
            </span>
            <span style={{
              fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4,
              background:`${confColor}22`, color:confColor, textTransform:'uppercase', letterSpacing:'.5px',
            }}>{p.confidence}</span>
            {isBoost && legs.length > 0 && (
              <span style={{
                fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4,
                background:'rgba(99,102,241,.15)', color:'#a5b4fc', textTransform:'uppercase', letterSpacing:'.5px',
              }}>{legs.length}-leg boost</span>
            )}
          </div>
          <div style={{ fontSize:11, color:'var(--mute)', marginBottom:4 }}>
            {p.sport} · {p.league} · book <strong style={{color:'var(--soft)'}}>{p.book}</strong> · odd total <strong style={{color:'var(--blue)'}}>{p.price_at_pick?.toFixed(2)}</strong>
          </div>
        </div>
        <div style={{ textAlign:'right', minWidth:100, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <div style={{ fontSize:10, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>Apostar</div>
          <div style={{ fontSize:20, fontWeight:900, color:'var(--green)', fontFamily:"'JetBrains Mono',monospace" }}>
            {fmtBRL(p.stake)}
          </div>
          <div style={{ fontSize:10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>
            edge {p.edge_pct?.toFixed(1)}% · EV +{fmtBRL(p.ev)}
          </div>
          <div style={{ display:'flex', gap:6, marginTop:4 }}>
            <button
              onClick={(e) => { e.stopPropagation(); copyBetToClipboard(p) }}
              title="Copiar pra colar no Bet365"
              style={{
                background:'rgba(255,255,255,.06)', border:'1px solid var(--card-border)',
                color:'var(--white)', cursor:'pointer', padding:'4px 8px', borderRadius:6,
                fontSize:10, fontWeight:700,
              }}
            >📋 Copiar</button>
            <button
              onClick={(e) => { e.stopPropagation(); trackBet(p) }}
              title="Registrar que apostei → AI aprende com o resultado"
              style={{
                background:'rgba(34,212,160,.15)', border:'1px solid rgba(34,212,160,.4)',
                color:'var(--green)', cursor:'pointer', padding:'4px 8px', borderRadius:6,
                fontSize:10, fontWeight:700,
              }}
            >🎯 Apostei</button>
          </div>
        </div>
      </div>

      {/* Legs do boost — explicita CADA seleção pra apostar no Bet365 */}
      {isBoost && legs.length > 0 && expanded && (
        <div style={{
          marginTop:10, padding:'10px 12px',
          background:'rgba(0,0,0,.25)', border:'1px dashed rgba(99,102,241,.3)',
          borderRadius:8,
        }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'#a5b4fc', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>
            📋 Seleções pra encontrar no Bet365 (todas precisam acertar)
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {legs.map((leg, k) => (
              <div key={k} style={{
                display:'flex', alignItems:'center', gap:8, padding:'5px 8px',
                background:'rgba(255,255,255,.03)', borderRadius:6, fontSize:11,
              }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'#818cf8', fontWeight:700, minWidth:20 }}>
                  {k+1}.
                </span>
                <span style={{ color:'var(--white)', flex:1 }}>{leg.text}</span>
                {leg.odd && (
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--amber)', fontWeight:700, fontSize:10 }}>
                    @{leg.odd}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, fontSize:10, color:'var(--mute)', fontStyle:'italic', lineHeight:1.5 }}>
            💡 Abre Bet365 → procura "{matchTitle}" → clica na aumentada de <strong>{legs.length} seleções</strong> {p.price_at_pick ? <>com odd total <strong style={{color:'var(--amber)'}}>{p.price_at_pick.toFixed(2)}</strong></> : null}.
          </div>
        </div>
      )}

      {!isBoost && (
        <div style={{ fontSize:10, color:'var(--mute)', fontStyle:'italic', marginTop:6 }}>{p.explain}</div>
      )}

      {isBoost && legs.length > 0 && (
        <button onClick={() => setExpanded(e => !e)} style={{
          marginTop:8, width:'100%', padding:'5px',
          background:'transparent', border:'1px dashed rgba(255,255,255,.12)',
          borderRadius:6, color:'var(--dim)', fontSize:10, cursor:'pointer',
          fontFamily:"'JetBrains Mono',monospace",
        }}>
          {expanded ? '▲ ocultar legs' : `▼ mostrar ${legs.length} seleções`}
        </button>
      )}
    </div>
  )
}

// ─── Action Plan Panel — sintetiza tudo num plano único acionável ────────────
function ActionPlanPanel({ balance, enriched, singles, multis, combos2, combos3, byGame, mispriced, analyzed, riskMode, setRiskMode, loading }) {
  // Risk profiles → quais picks entram + cap de stake total
  const profile = {
    conservative: { label: 'Conservador', minEdge: 5,   minConf: 'high',   maxLegs: 1, maxBetsTotal: 4, capPct: 5,  capAbs: balance * 0.05 },
    moderate:     { label: 'Moderado',    minEdge: 3,   minConf: 'medium', maxLegs: 2, maxBetsTotal: 6, capPct: 8,  capAbs: balance * 0.08 },
    aggressive:   { label: 'Agressivo',   minEdge: 1.5, minConf: 'low',    maxLegs: 3, maxBetsTotal: 9, capPct: 12, capAbs: balance * 0.12 },
  }[riskMode] || { label: 'Moderado', minEdge: 3, minConf: 'medium', maxLegs: 2, maxBetsTotal: 6, capPct: 8, capAbs: balance * 0.08 }

  const confRank = { high: 3, medium: 2, low: 1 }
  const minConfRank = confRank[profile.minConf]

  // 1. Filtra singles que passam no perfil
  const eligibleSingles = useMemo(() => {
    return singles
      .filter(p => (p.edge_pct || 0) >= profile.minEdge && confRank[p.confidence] >= minConfRank)
      .sort((a, b) => (b.edge_pct || 0) - (a.edge_pct || 0))
  }, [singles, profile.minEdge, minConfRank])

  // 2. Filtra múltiplas se perfil permite (maxLegs >= 2)
  const eligibleMultis = useMemo(() => {
    if (profile.maxLegs < 2) return []
    const list = []
    for (const c of combos2) list.push({ kind: '2-leg', ...c })
    if (profile.maxLegs >= 3) for (const c of combos3) list.push({ kind: '3-leg', ...c })
    return list.sort((a, b) => (b.expected || 0) - (a.expected || 0))
  }, [combos2, combos3, profile.maxLegs])

  // 3. Monta plano: pega top picks até atingir cap de stake total
  const plan = useMemo(() => {
    const items = []
    let cum = 0
    for (const p of eligibleSingles) {
      if (items.length >= profile.maxBetsTotal) break
      if (cum + p.stake > profile.capAbs) continue
      items.push({ kind: 'single', pick: p, stake: p.stake, ev: p.ev, odd: p.price_at_pick, edge: p.edge_pct, prob: p.prob })
      cum += p.stake
    }
    // Adiciona até 2 múltiplas se sobrou cap
    let mAdded = 0
    for (const m of eligibleMultis) {
      if (mAdded >= 2 || items.length >= profile.maxBetsTotal) break
      if (cum + m.stake > profile.capAbs) continue
      items.push({ kind: m.kind, multi: m, stake: m.stake, ev: m.expected, odd: m.comboOdd, edge: m.comboEdge, prob: m.comboProb })
      cum += m.stake
      mAdded++
    }
    return items
  }, [eligibleSingles, eligibleMultis, profile])

  const totalStake = plan.reduce((s, x) => s + (x.stake || 0), 0)
  const totalEV    = plan.reduce((s, x) => s + (x.ev    || 0), 0)
  const stakePct   = balance > 0 ? +(totalStake / balance * 100).toFixed(1) : 0

  // Probabilidade do plano render lucro: simulação simples — proba de >=N picks vencerem
  // Pra simplificar, calcula EV variance: se hit-rate médio for proba média, valor esperado é totalEV
  const avgProb = plan.length ? plan.reduce((s, x) => s + (x.prob || 0), 0) / plan.length : 0

  // Cenários de retorno (após apostar todo o plano)
  const scenarios = useMemo(() => {
    if (!plan.length) return null
    // Roi simulado: ganho se acertar TODOS, perda se errar TODOS, esperado = sum(prob*payout - stake)
    const winAll = plan.reduce((s, x) => s + (x.stake * x.odd), 0)
    const loseAll = -totalStake
    const expected = totalEV
    return {
      bestCase:   +(winAll - totalStake).toFixed(2),
      worstCase:  +loseAll.toFixed(2),
      expected:   +expected.toFixed(2),
      breakEvenWR: avgProb ? +(1 / avgProb * 100).toFixed(0) : null,
    }
  }, [plan, totalStake, totalEV, avgProb])

  const oppDiag = {
    singles: singles.length,
    multis: multis.length + combos2.length + combos3.length,
    matches: byGame.length,
    mispricedHigh: (mispriced.alerts || []).filter(a => a.severity === 'high').length,
    crossbook: (analyzed.matches || []).length,
  }

  if (loading) {
    return <div style={{ padding:30, textAlign:'center', color:'var(--mute)', fontSize:12 }}>Analisando dados...</div>
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:18 }}>
      {/* Risk selector */}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', padding:'10px 12px',
        background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:10 }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>Perfil de Risco:</span>
        {[
          { id:'conservative', l:'🛡️ Conservador', desc:'edge ≥5%, só HIGH' },
          { id:'moderate',     l:'⚖️ Moderado',    desc:'edge ≥3%, HIGH+MED' },
          { id:'aggressive',   l:'🚀 Agressivo',   desc:'edge ≥1.5%, todos +EV' },
        ].map(r => (
          <button key={r.id} onClick={() => setRiskMode(r.id)} title={r.desc}
            style={{
              padding:'6px 10px', fontSize:11, fontWeight:700, borderRadius:6, cursor:'pointer',
              fontFamily:"'JetBrains Mono',monospace",
              background: riskMode === r.id ? 'rgba(59,130,246,.15)' : 'transparent',
              border: `1px solid ${riskMode === r.id ? 'var(--blue)' : 'var(--card-border)'}`,
              color: riskMode === r.id ? 'var(--blue)' : 'var(--mute)',
            }}>{r.l}</button>
        ))}
      </div>

      {/* Diagnóstico */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:8 }}>
        {[
          { label:'Banca atual',  value: fmtBRL(balance), color:'var(--green)' },
          { label:'Picks +EV',    value: oppDiag.singles, color:'var(--blue)' },
          { label:'Múltiplas',    value: oppDiag.multis, color:'#a5b4fc' },
          { label:'Steam HIGH',   value: oppDiag.mispricedHigh, color:'var(--red)' },
          { label:'Jogos hoje',   value: oppDiag.matches, color:'var(--soft)' },
        ].map(k => (
          <div key={k.label} style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:10, padding:'10px 12px' }}>
            <div style={{ fontSize:9, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>{k.label}</div>
            <div style={{ fontSize:18, fontWeight:900, color:k.color, fontFamily:"'JetBrains Mono',monospace" }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Recomendação consolidada */}
      <div style={{
        background:'linear-gradient(135deg, rgba(34,212,160,.06), rgba(59,130,246,.04))',
        border:'1px solid rgba(34,212,160,.3)', borderRadius:12, padding:'14px 16px',
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, flexWrap:'wrap', marginBottom:10 }}>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--green)', textTransform:'uppercase', letterSpacing:'.5px' }}>
              Recomendação · perfil {profile.label}
            </div>
            <div style={{ fontSize:14, fontWeight:800, color:'var(--white)', marginTop:2 }}>
              {plan.length === 0 ? 'Sem apostas hoje — aguarda mais oportunidades' : `${plan.length} aposta${plan.length > 1 ? 's' : ''} selecionada${plan.length > 1 ? 's' : ''} pelo engine`}
            </div>
          </div>
          {plan.length > 0 && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:9, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>Stake total</div>
              <div style={{ fontSize:22, fontWeight:900, color:'var(--green)', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBRL(totalStake)}</div>
              <div style={{ fontSize:9, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>{stakePct}% da banca · EV {totalEV >= 0 ? '+' : ''}{fmtBRL(totalEV)}</div>
            </div>
          )}
        </div>

        {/* Cenários */}
        {scenarios && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:6, marginBottom:10 }}>
            <ScenarioBox label="Pior caso" value={scenarios.worstCase} sub="todas erram" color="var(--red)" />
            <ScenarioBox label="Esperado" value={scenarios.expected} sub={`hit ~${(avgProb*100).toFixed(0)}%`} color={scenarios.expected >= 0 ? 'var(--green)' : 'var(--amber)'} />
            <ScenarioBox label="Melhor caso" value={scenarios.bestCase} sub="todas acertam" color="var(--green)" />
          </div>
        )}

        {/* Lista de apostas pra executar */}
        {plan.length > 0 ? (
          <>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>
              ✅ Apostas — execute na ordem (cada uma é independente)
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {plan.map((it, i) => <PlanRow key={i} item={it} idx={i + 1} />)}
            </div>
            <div style={{ marginTop:10, paddingTop:10, borderTop:'1px dashed var(--card-border)', fontSize:10, color:'var(--mute)', lineHeight:1.5 }}>
              💡 <strong style={{color:'var(--soft)'}}>Como executar:</strong> abre Bet365 → encontra cada jogo → aplica a stake exata → registra resultado em Performance.
              Não pula picks pra "compensar perda" — variance é normal, o engine trabalha no longo prazo.
            </div>
          </>
        ) : (
          <div style={{ padding:'12px 0', fontSize:11, color:'var(--mute)', lineHeight:1.6 }}>
            Hoje o engine não encontrou apostas que satisfaçam o perfil <strong style={{color:'var(--soft)'}}>{profile.label}</strong>.
            <br/>Tente <strong style={{color:'var(--blue)'}}>{riskMode === 'conservative' ? 'Moderado' : 'Agressivo'}</strong>, ou volta mais tarde —
            o cron de 4h captura novas oportunidades. Não apostar é uma <strong style={{color:'var(--green)'}}>decisão válida</strong>.
          </div>
        )}
      </div>

      {/* Projeção — quanto a banca cresce se mantiver esse plano N dias */}
      {plan.length > 0 && totalEV > 0 && (
        <div style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:10, padding:'12px 14px' }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>
            📈 Projeção se manter esse plano diariamente
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
            {[7, 30, 90].map(days => {
              const projected = +(balance * Math.pow(1 + (totalEV / balance), days)).toFixed(2)
              const gain = +(projected - balance).toFixed(2)
              const gainPct = balance > 0 ? +(gain / balance * 100).toFixed(1) : 0
              return (
                <div key={days} style={{ background:'rgba(34,212,160,.04)', border:'1px solid rgba(34,212,160,.2)', borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ fontSize:9, color:'var(--mute)' }}>{days} dias</div>
                  <div style={{ fontSize:16, fontWeight:800, color:'var(--green)', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBRL(projected)}</div>
                  <div style={{ fontSize:9, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>+{gainPct}% (+{fmtBRL(gain)})</div>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize:9, color:'var(--dim)', marginTop:6, fontStyle:'italic' }}>
            * Crescimento composto, assume EV se materializa no longo prazo. Variance real flutua ±20% mês a mês.
          </div>
        </div>
      )}
    </div>
  )
}

function ScenarioBox({ label, value, sub, color }) {
  return (
    <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid var(--card-border)', borderRadius:8, padding:'8px 10px' }}>
      <div style={{ fontSize:9, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px' }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:800, color, fontFamily:"'JetBrains Mono',monospace" }}>
        {value > 0 ? '+' : ''}{fmtBRL(value)}
      </div>
      <div style={{ fontSize:9, color:'var(--dim)' }}>{sub}</div>
    </div>
  )
}

function PlanRow({ item, idx }) {
  const isMulti = item.kind !== 'single'
  const label = isMulti
    ? `Múltipla ${item.kind} (${item.multi.legs.map(l => l.outcome).join(' + ')})`
    : item.pick.outcome
  const market = isMulti ? `${item.multi.legs.length} legs` : (item.pick.market || '')
  const why = isMulti
    ? `prob conjunta ${(item.prob*100).toFixed(1)}% · edge ${item.edge.toFixed(1)}%`
    : (item.pick.explain || `edge ${item.edge.toFixed(1)}% · prob ${(item.prob*100).toFixed(1)}%`)

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'auto 1fr auto', gap:10, alignItems:'center',
      padding:'8px 10px', background:'rgba(255,255,255,.03)',
      border:'1px solid var(--card-border)', borderRadius:8,
    }}>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, color:'var(--green)', fontWeight:900, minWidth:24, textAlign:'center' }}>
        {idx}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'var(--white)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {isMulti && '🔗 '}{label}
        </div>
        <div style={{ fontSize:10, color:'var(--mute)', marginTop:2 }}>
          {market} @ <strong style={{color:'var(--amber)'}}>{item.odd?.toFixed(2)}</strong> · {why}
        </div>
      </div>
      <div style={{ textAlign:'right' }}>
        <div style={{ fontSize:9, color:'var(--mute)', textTransform:'uppercase' }}>Apostar</div>
        <div style={{ fontSize:16, fontWeight:900, color:'var(--green)', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBRL(item.stake)}</div>
      </div>
    </div>
  )
}

// ─── Match Analysis Card — visão integrada do jogo ───────────────────────────
function MatchAnalysisCard({ g, balance, kellyMult }) {
  const [expanded, setExpanded] = useState(false)
  const o = g.odds || {}
  const has1X2 = o.home && o.draw && o.away
  const startTimeFmt = (() => {
    const t = g.startTime || ''
    // Formato bet365 "20260427200000" → "20:00"
    const m = t.match(/^\d{8}(\d{2})(\d{2})/)
    if (m) return `${m[1]}:${m[2]}`
    return t
  })()
  const alertsHigh = (g.alerts || []).filter(a => a.severity === 'high')
  const alertsMed  = (g.alerts || []).filter(a => a.severity === 'medium')
  const score = g.actionScore || 0
  const heatColor = score >= 10 ? 'var(--green)' : score >= 5 ? 'var(--amber)' : score >= 1 ? 'var(--blue)' : 'var(--mute)'

  // Ações sugeridas: best bet (cross-book) + steam moves de alta severidade (top 2)
  const actions = []
  if (g.bestBet && g.bestBet.edge_pct >= 1) {
    actions.push({
      kind: 'value', label: g.bestBet.outcome, market: g.bestBet.market,
      odd: g.bestBet.price_at_pick, edge: g.bestBet.edge_pct,
      stake: g.bestBet.stake, ev: g.bestBet.ev,
      explain: g.bestBet.explain,
    })
  }
  for (const al of alertsHigh.slice(0, 2)) {
    const stake = +(Math.max(0.5, balance * 0.005)).toFixed(2) // 0.5% banca, mín R$0,50 (steam = especulativo)
    actions.push({
      kind: 'steam', label: `${al.market} · ${al.selection}${al.line != null ? ` ${al.line}` : ''}`,
      market: al.market, odd: al.currentOdd, edge: al.movePct,
      stake, ev: null, explain: al.message,
    })
  }
  const totalStake = actions.reduce((s, a) => s + (a.stake || 0), 0)
  const totalEV    = actions.reduce((s, a) => s + (a.ev || 0), 0)

  return (
    <div style={{
      background:'var(--card-bg)', border:`1px solid var(--card-border)`,
      borderLeft:`4px solid ${heatColor}`, borderRadius:10, padding:'12px 14px',
    }}>
      {/* Header */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:10, alignItems:'center' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <strong style={{ fontSize:14, color:'var(--white)' }}>{g.home} <span style={{color:'var(--mute)', fontWeight:500}}>v</span> {g.away}</strong>
            {g.hasBoostBadge && (
              <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4,
                background:'rgba(99,102,241,.15)', color:'#a5b4fc' }}>🚀 {g.badgeCount} aumentadas</span>
            )}
            {alertsHigh.length > 0 && (
              <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4,
                background:'rgba(239,68,68,.15)', color:'var(--red)' }}>⚡ {alertsHigh.length} steam HIGH</span>
            )}
            {g.bestBet && g.bestBet.edge_pct >= 2 && (
              <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:4,
                background:'rgba(34,212,160,.15)', color:'var(--green)' }}>+EV {g.bestBet.edge_pct.toFixed(1)}%</span>
            )}
          </div>
          <div style={{ fontSize:10, color:'var(--mute)', marginTop:3 }}>
            {startTimeFmt && <>🕐 {startTimeFmt} · </>}
            {g.competition || 'liga ?'}
            {g.crossBook?.crossBook && <> · cross-book vs <strong>{g.crossBook.crossBook}</strong></>}
          </div>
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{
          background:'rgba(255,255,255,.05)', border:'1px solid var(--card-border)',
          color:'var(--soft)', borderRadius:6, padding:'4px 10px', fontSize:10, cursor:'pointer',
          fontFamily:"'JetBrains Mono',monospace",
        }}>{expanded ? '▲ menos' : '▼ detalhes'}</button>
      </div>

      {/* Odds 1X2 + vig */}
      {has1X2 && (
        <div style={{ display:'flex', gap:10, marginTop:10, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ fontSize:9, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace", textTransform:'uppercase', letterSpacing:'.5px', minWidth:50 }}>BET365</div>
          {[['1', o.home], ['X', o.draw], ['2', o.away]].map(([k, v]) => (
            <div key={k} style={{ minWidth: 50, padding:'4px 8px', background:'rgba(255,255,255,.04)',
              border:'1px solid var(--card-border)', borderRadius:6, textAlign:'center' }}>
              <div style={{ fontSize:9, color:'var(--mute)' }}>{k}</div>
              <div style={{ fontSize:13, fontWeight:800, color:'var(--amber)', fontFamily:"'JetBrains Mono',monospace" }}>{v?.toFixed(2)}</div>
            </div>
          ))}
          {g.vigPct != null && (
            <div style={{ fontSize:10, color: g.vigPct > 8 ? 'var(--red)' : g.vigPct > 5 ? 'var(--amber)' : 'var(--green)',
              fontFamily:"'JetBrains Mono',monospace" }}>
              vig {g.vigPct}% {g.vigPct > 8 && '⚠'}
            </div>
          )}
        </div>
      )}

      {/* Plano de ação */}
      {actions.length > 0 && (
        <div style={{
          marginTop: 10, padding: '10px 12px',
          background:'rgba(34,212,160,.05)', border:'1px solid rgba(34,212,160,.25)',
          borderRadius: 8,
        }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--green)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>
            🎯 Plano de Ação · stake total {fmtBRL(totalStake)} {totalEV > 0 && <>· EV +{fmtBRL(totalEV)}</>}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {actions.map((a, k) => (
              <div key={k} style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'6px 8px', background:'rgba(255,255,255,.03)', borderRadius:6,
                fontSize:11,
              }}>
                <span style={{ fontSize:11 }}>
                  {a.kind === 'value' ? '💎' : '⚡'}
                </span>
                <span style={{ flex:1, color:'var(--white)' }}>
                  <strong>{a.label}</strong>
                  <span style={{ color:'var(--mute)' }}> · {a.market}</span>
                  {a.kind === 'steam' && <span style={{ color:'var(--amber)', marginLeft:6, fontSize:9 }}>STEAM</span>}
                </span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--amber)', fontWeight:700, fontSize:11 }}>@{a.odd?.toFixed(2)}</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--blue)', fontSize:10, minWidth:50, textAlign:'right' }}>
                  edge {a.edge?.toFixed(1)}%
                </span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--green)', fontWeight:800, fontSize:12, minWidth:60, textAlign:'right' }}>
                  {fmtBRL(a.stake)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detalhes expandidos */}
      {expanded && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:'1px dashed var(--card-border)', fontSize:11, color:'var(--mute)', lineHeight:1.6 }}>
          {has1X2 && g.fairs && (
            <div style={{ marginBottom:8 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>
                Fair odds (no-vig do próprio Bet365)
              </div>
              <div style={{ display:'flex', gap:14 }}>
                <span>{g.home}: <strong style={{color:'var(--white)'}}>{g.fairs.home}</strong> ({(100/g.fairs.home).toFixed(1)}%)</span>
                <span>Empate: <strong style={{color:'var(--white)'}}>{g.fairs.draw}</strong> ({(100/g.fairs.draw).toFixed(1)}%)</span>
                <span>{g.away}: <strong style={{color:'var(--white)'}}>{g.fairs.away}</strong> ({(100/g.fairs.away).toFixed(1)}%)</span>
              </div>
            </div>
          )}
          {(g.alerts || []).length > 0 && (
            <div style={{ marginBottom:8 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--red)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>
                Odd desajustada · {g.alerts.length} alerta(s)
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {g.alerts.slice(0, 8).map((a, k) => (
                  <div key={k} style={{ fontSize:10, color:'var(--soft)' }}>
                    <span style={{ color: a.severity === 'high' ? 'var(--red)' : 'var(--amber)', fontWeight:700 }}>[{a.type}-{a.severity.toUpperCase()}]</span>
                    {' '}{a.market} {a.selection}{a.line != null ? ` ${a.line}` : ''}: {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(g.picks || []).length > 1 && (
            <div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--blue)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>
                Outros mercados +EV nesse jogo
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {g.picks.slice(1, 6).map((p, k) => (
                  <div key={k} style={{ fontSize:10, color:'var(--soft)' }}>
                    {p.outcome} ({p.market}) @ <strong style={{color:'var(--amber)'}}>{p.price_at_pick?.toFixed(2)}</strong> · edge {p.edge_pct?.toFixed(1)}% · stake {fmtBRL(p.stake)}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(actions.length === 0 && !(g.alerts || []).length) && (
            <div style={{ color:'var(--dim)', fontStyle:'italic' }}>Nenhuma ação recomendada — odds dentro do esperado, sem movimento steam relevante.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Combo Card (multi-leg suggestion) ───────────────────────────────────────
function ComboCard({ c, idx, accent, accentBg, accentBorder }) {
  return (
    <div style={{
      background: accentBg, border: `1px solid ${accentBorder}`,
      borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
        <div style={{ fontWeight:700, fontSize:12, color: accent }}>
          Combo #{idx} · edge <strong>{c.comboEdge}%</strong> · prob {(c.comboProb*100).toFixed(1)}%
        </div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, color:'var(--green)', fontWeight:800 }}>
          {fmtBRL(c.stake)} @ {c.comboOdd.toFixed(2)}
        </div>
      </div>
      <div style={{ fontSize:11, color:'var(--mute)', lineHeight:1.7 }}>
        {c.legs.map((leg, k) => (
          <div key={k} style={{ display:'flex', gap:6 }}>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", color: accent, fontWeight:700, minWidth:18 }}>
              {['①','②','③','④'][k] || `${k+1}`}
            </span>
            <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis' }}>
              <strong style={{ color:'var(--white)' }}>{leg.outcome}</strong>
              <span style={{ color:'var(--dim)' }}> · {leg.market} · {leg.league}</span>
            </span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--amber)', fontWeight:700 }}>
              @{leg.price_at_pick?.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'center',
        marginTop:8, paddingTop:8, borderTop:`1px dashed ${accentBorder}`,
        fontSize:10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace",
      }}>
        <span>EV esperado <strong style={{color:'var(--green)'}}>+{fmtBRL(c.expected)}</strong></span>
        <span>retorno potencial <strong style={{color:'var(--white)'}}>{fmtBRL(c.stake * c.comboOdd)}</strong></span>
      </div>
    </div>
  )
}

// ─── Goal Progress Bar ────────────────────────────────────────────────────────
function GoalBar({ goal, balance, winRate, avgOdd, avgStakePct }) {
  const reached = balance >= goal.target
  const pct = Math.min(balance / goal.target * 100, 100)

  // Project sessions to reach goal (simplified Kelly growth model)
  let sessions = null
  if (!reached && winRate && avgOdd && avgStakePct) {
    const p = winRate / 100
    const b = avgOdd - 1
    const f = avgStakePct / 100
    // Expected growth per session: E = p*(1+b*f) + (1-p)*(1-f) - 1
    const g = p * (1 + b * f) + (1 - p) * (1 - f) - 1
    if (g > 0 && balance > 0) {
      sessions = Math.ceil(Math.log(goal.target / balance) / Math.log(1 + g))
    }
  }

  return (
    <div style={{
      background: reached ? 'rgba(34,212,160,.06)' : 'var(--card-bg)',
      border: `1px solid ${reached ? 'rgba(34,212,160,.3)' : 'var(--card-border)'}`,
      borderRadius: 'var(--r2)', padding: '12px 14px',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color: reached ? 'var(--green)' : 'var(--white)', marginBottom:2 }}>
            {reached ? '✅ ' : ''}{goal.label}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
            {reached ? 'Meta atingida!' : `Faltam ${fmtBRL(goal.target - balance)}`}
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:800,
            color: reached ? 'var(--green)' : 'var(--soft)' }}>
            {fmtBRL(goal.target)}
          </div>
          {!reached && sessions && (
            <div style={{ fontSize:10, color:'var(--dim)', fontFamily:"'JetBrains Mono',monospace", marginTop:2 }}>
              ~{sessions} apostas para chegar
            </div>
          )}
        </div>
      </div>
      <div style={{ height:8, background:'rgba(255,255,255,.06)', borderRadius:4, overflow:'hidden' }}>
        <div style={{
          height:'100%', width:`${pct}%`,
          background: reached ? 'var(--green)' : pct >= 75 ? '#60a5fa' : pct >= 50 ? '#fbbf24' : 'rgba(255,255,255,.2)',
          borderRadius:4, transition:'width .5s',
        }} />
      </div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', marginTop:4, textAlign:'right' }}>
        {pct.toFixed(1)}%
      </div>
    </div>
  )
}

// ─── Kelly Size Recommendations ───────────────────────────────────────────────
function KellyPanel({ balance }) {
  const SCENARIOS = [
    { label: '🟢 Conf 85% · Odd 1.90', conf:85, odd:1.90, tier:'safe'   },
    { label: '🔵 Conf 78% · Odd 2.10', conf:78, odd:2.10, tier:'median' },
    { label: '🟡 Conf 72% · Odd 2.40', conf:72, odd:2.40, tier:'agg'    },
    { label: '⚪ Conf 65% · Odd 2.80', conf:65, odd:2.80, tier:'risky'  },
  ]
  const TIER_COLOR = { safe:'var(--green)', median:'var(--blue)', agg:'var(--amber)', risky:'var(--mute)' }

  return (
    <div style={{ marginBottom:14 }}>
      <div className="section-label">📐 Tamanhos Kelly Recomendados (¼K)</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8 }}>
        {SCENARIOS.map(s => {
          const stake = kellyStake(balance, s.conf, s.odd)
          const pct   = balance ? +(stake / balance * 100).toFixed(1) : 0
          return (
            <div key={s.label} style={{
              background:'var(--card-bg)', border:'1px solid var(--card-border)',
              borderRadius:'var(--r)', padding:'10px 12px',
            }}>
              <div style={{ fontSize:11, color:TIER_COLOR[s.tier], fontWeight:600, marginBottom:6 }}>{s.label}</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:900,
                color: TIER_COLOR[s.tier] }}>
                {fmtBRL(stake)}
              </div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', marginTop:2 }}>
                {pct}% da banca · EV: {(((s.conf/100) * s.odd - 1) * 100).toFixed(1)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tips Section ─────────────────────────────────────────────────────────────
const TIPS = [
  { icon:'🎯', title:'Kelly Fracionado', body:'Use sempre ¼ ou ½ Kelly. O Kelly completo maximiza crescimento mas tem drawdowns brutais. ¼K é o padrão profissional.' },
  { icon:'📊', title:'Limite por Jogo', body:'Nunca aposte mais de 5% da banca em um único evento. Mesmo com 90% conf, bankroll variance pode destruir você.' },
  { icon:'🔄', title:'Recalcule Sempre', body:'Após cada aposta, recalcule a banca e ajuste o tamanho das apostas. A cada ciclo de 20 apostas, reavalie sua estratégia.' },
  { icon:'🛑', title:'Stop Loss Diário', body:'Defina um stop loss de 10-15% da banca por dia. Perdas emocionais são as piores. Se atingiu, pare e volte amanhã.' },
  { icon:'📈', title:'Growthacker Modo', body:'Com banca pequena (<R$500): foque em mercados com alta edge (EV≥8%). Com banca média (R$500-2k): diversifique. Com banca grande (>R$2k): priorize volume.' },
  { icon:'🎰', title:'Acumuladores', body:'Evite acumuladores com mais de 3 picks. O EV combinado cai exponencialmente. Use só quando cada pick tem EV≥5% individualmente.' },
  { icon:'💡', title:'ROI Meta', body:'ROI de 5-8% ao mês é excelente para apostas esportivas. Desconfie de quem promete mais. Compostos: R$1.000 com 6%/mês = R$2.000 em 12 meses.' },
  { icon:'📱', title:'Bet365 Tracking', body:'Use esta página para registrar manualmente seu saldo Bet365. Compare com sua banca rastreada para detectar diferenças e vazamentos.' },
]

// ─── Upgrade Planner ─────────────────────────────────────────────────────────
function UpgradePlanner({ balance }) {
  const [winRate,     setWinRate]     = useState(55)
  const [avgOdd,      setAvgOdd]      = useState(1.90)
  const [stakePct,    setStakePct]    = useState(2)
  const [months,      setMonths]      = useState(12)

  // Monte Carlo simplified: compound growth over N bets/month (30 bets assumed)
  const projection = useMemo(() => {
    const p = winRate / 100
    const b = avgOdd - 1
    const f = stakePct / 100
    const betsPerMonth = 30

    const points = []
    let bal = balance || 1000
    points.push({ month: 0, bal: +bal.toFixed(2) })

    for (let m = 1; m <= months; m++) {
      for (let bet = 0; bet < betsPerMonth; bet++) {
        const stake = bal * f
        const won   = Math.random() < p  // simplified expected
        if (won) bal += stake * b
        else     bal -= stake
        if (bal < 1) { bal = 1; break }
      }
      // Expected value formula instead of random: E[bal] = bal * (1 + f*(p*b - (1-p)))^bets
      // We use the deterministic expected path
      points.push({ month: m, bal: +bal.toFixed(2) })
    }

    // Deterministic expected path (for display)
    const g = p * b * f - (1 - p) * f  // expected gain per unit per bet
    const expectedPath = []
    let eb = balance || 1000
    expectedPath.push({ month: 0, bal: +eb.toFixed(2), min: +eb.toFixed(2), max: +eb.toFixed(2) })
    for (let m = 1; m <= months; m++) {
      eb = eb * Math.pow(1 + g, betsPerMonth)
      const variance = eb * 0.15 * Math.sqrt(m)
      expectedPath.push({ month: m, bal: +eb.toFixed(2), min: +(eb - variance).toFixed(2), max: +(eb + variance).toFixed(2) })
    }

    return expectedPath
  }, [balance, winRate, avgOdd, stakePct, months])

  const finalBal = projection[projection.length - 1]?.bal || 0
  const growthPct = balance > 0 ? +((finalBal - balance) / balance * 100).toFixed(1) : 0
  const maxBar = Math.max(...projection.map(p => p.max), 1)

  return (
    <div style={{ marginBottom:14 }}>
      <div className="section-label">🚀 Projeção de Crescimento de Banca</div>
      <div style={{
        background:'var(--card-bg)', border:'1px solid var(--card-border)',
        borderRadius:'var(--r2)', padding:'14px',
      }}>
        {/* Inputs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:10, marginBottom:16 }}>
          {[
            { label:'Win Rate (%)',     value:winRate,  setter:setWinRate,  min:30, max:70, step:1   },
            { label:'Odd Média',        value:avgOdd,   setter:setAvgOdd,   min:1.3, max:5.0, step:0.05 },
            { label:'Stake / Banca (%)',value:stakePct, setter:setStakePct, min:0.5, max:10,  step:0.5  },
            { label:'Horizonte (meses)',value:months,   setter:setMonths,   min:1,   max:36,  step:1    },
          ].map(inp => (
            <div key={inp.label}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', marginBottom:4 }}>
                {inp.label}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <input
                  type="range"
                  min={inp.min} max={inp.max} step={inp.step} value={inp.value}
                  onChange={e => inp.setter(parseFloat(e.target.value))}
                  style={{ flex:1, accentColor:'var(--blue)' }}
                />
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
                  color:'var(--blue)', minWidth:42, textAlign:'right' }}>
                  {inp.value}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Summary badges */}
        <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:120, background:'rgba(34,212,160,.08)', border:'1px solid rgba(34,212,160,.2)', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:900, color:'var(--green)' }}>
              {fmtBRL(finalBal)}
            </div>
            <div style={{ fontSize:10, color:'var(--mute)', marginTop:2 }}>Banca projetada ({months}m)</div>
          </div>
          <div style={{ flex:1, minWidth:120, background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:900, color: growthPct >= 0 ? 'var(--blue)' : 'var(--red)' }}>
              {growthPct >= 0 ? '+' : ''}{growthPct}%
            </div>
            <div style={{ fontSize:10, color:'var(--mute)', marginTop:2 }}>Crescimento total</div>
          </div>
          <div style={{ flex:1, minWidth:120, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:900, color:'var(--amber)' }}>
              {(growthPct / months).toFixed(1)}%
            </div>
            <div style={{ fontSize:10, color:'var(--mute)', marginTop:2 }}>ROI médio / mês</div>
          </div>
        </div>

        {/* Chart */}
        <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
          {projection.filter((_, i) => i % Math.max(1, Math.floor(months / 12)) === 0 || i === projection.length - 1).map(p => {
            const barW = p.bal / maxBar * 100
            const minW = Math.max(0, p.min) / maxBar * 100
            const maxW = p.max / maxBar * 100
            const isGrowth = p.bal >= (balance || 0)
            return (
              <div key={p.month} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--dim)', minWidth:42 }}>
                  {p.month === 0 ? 'Hoje' : `${p.month}m`}
                </span>
                <div style={{ flex:1, height:14, background:'rgba(255,255,255,.04)', borderRadius:3, position:'relative', overflow:'hidden' }}>
                  {/* range band */}
                  <div style={{ position:'absolute', left:`${minW}%`, width:`${Math.max(0, maxW - minW)}%`, height:'100%', background:'rgba(255,255,255,.04)' }} />
                  {/* expected bar */}
                  <div style={{
                    position:'absolute', left:0, height:'100%', width:`${barW}%`,
                    background: isGrowth ? 'rgba(34,212,160,.5)' : 'rgba(255,79,106,.5)',
                    borderRadius:3, transition:'width .3s',
                  }} />
                </div>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                  color: isGrowth ? 'var(--green)' : 'var(--red)', minWidth:70, textAlign:'right' }}>
                  {fmtBRL(p.bal)}
                </span>
              </div>
            )
          })}
        </div>

        <div style={{ fontSize:10, color:'var(--dim)', marginTop:10, fontFamily:"'JetBrains Mono',monospace" }}>
          * Projeção baseada em valor esperado · Resultado real varia com variância · Bandas = ±1 desvio padrão estimado
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Banca365() {
  const [data,      setData]      = useState(load365)
  const [goals,     setGoals]     = useState(loadGoals)
  const [mode,      setMode]      = useState(null)   // 'deposit'|'withdraw'|'adjust'
  const [amount,    setAmount]    = useState('')
  const [note,      setNote]      = useState('')
  const [tab,       setTab]       = useState(() => localStorage.getItem('sb_banca_tab') || 'plano')  // default Plano Hoje pro user seguir
  const [newGoalV,  setNewGoalV]  = useState('')
  const [newGoalL,  setNewGoalL]  = useState('')
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [bancaSnapshot, setBancaSnapshot] = useState(null)

  // Sync com saldo/bets reais do Bet365 (poll 2min)
  useEffect(() => {
    let cancelled = false
    async function fetchSnap() {
      try {
        const r = await fetch(`${API_BASE}/v1/banca/snapshot`, { cache: 'no-store' })
        const j = await r.json()
        if (!cancelled && j.ok) setBancaSnapshot(j)
      } catch {}
    }
    fetchSnap()
    const id = setInterval(fetchSnap, 120000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  function persist(next) {
    setData(next)
    save365(next)
  }

  function commit() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return
    let newBal = data.balance
    let newDep  = data.deposited
    let newWith = data.withdrawn
    if (mode === 'deposit')  { newBal = data.balance + amt; newDep += amt }
    if (mode === 'withdraw') { newBal = Math.max(0, data.balance - amt); newWith += amt }
    if (mode === 'adjust')   { newBal = amt }
    const tx = { id: Date.now(), ts: Date.now(), type: mode, amount: amt, note, balAfter: newBal }
    persist({ ...data, balance: newBal, deposited: newDep, withdrawn: newWith, history: [...(data.history || []), tx] })
    setMode(null); setAmount(''); setNote('')
  }

  function deleteTx(id) {
    persist({ ...data, history: (data.history || []).filter(t => t.id !== id) })
  }

  function addGoal() {
    const v = parseFloat(newGoalV)
    if (!v || v <= 0) return
    const updated = [...goals, { target: v, label: newGoalL || `Meta R$${v}` }].sort((a, b) => a.target - b.target)
    setGoals(updated)
    localStorage.setItem(SK_GOALS, JSON.stringify(updated))
    setNewGoalV(''); setNewGoalL(''); setShowGoalForm(false)
  }

  function removeGoal(i) {
    const updated = goals.filter((_, idx) => idx !== i)
    setGoals(updated)
    localStorage.setItem(SK_GOALS, JSON.stringify(updated))
  }

  // Stats from pick history
  const pickHistory = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('sb_v10') || '[]') } catch { return [] }
  }, [])
  const resolved = pickHistory.filter(p => p.result === 'W' || p.result === 'L')
  const wins     = resolved.filter(p => p.result === 'W')
  const winRate  = resolved.length ? +(wins.length / resolved.length * 100).toFixed(1) : null
  const avgOdd   = resolved.length
    ? +(resolved.reduce((s, p) => s + (parseFloat(p.odd) || 2), 0) / resolved.length).toFixed(2)
    : 1.90

  // Saldo efetivo: prioriza snapshot real do Bet365 (fresh < 6h), fallback localStorage
  const snapFresh = bancaSnapshot?.balance != null && (Date.now() - (bancaSnapshot.balanceCapturedAt || 0)) < 24 * 3600 * 1000
  const effBalance = snapFresh ? bancaSnapshot.balance : (data.balance || 0)

  const netFlow  = data.deposited - data.withdrawn
  const profit   = netFlow > 0 ? effBalance - netFlow : null

  const TABS = [
    { id:'overview', l:'📊 Visão Geral' },
    { id:'plano',    l:'🎯 Plano Hoje' },
    { id:'planner',  l:'🚀 Projeção' },
    { id:'perf',     l:'📈 Performance' },
    { id:'tips',     l:'💡 Dicas' },
  ]

  return (
    <div className="page">
      <PageHeader
        icon="🎯"
        title="Banca Bet365"
        subtitle="Planejamento de banca e gestão profissional"
      />

      {/* Sync badge — saldo real do Bet365 */}
      {bancaSnapshot?.balance != null && (Date.now() - (bancaSnapshot.balanceCapturedAt || 0)) < 24 * 3600 * 1000 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '6px 12px', marginBottom: 12,
          background: 'rgba(0, 214, 143, 0.08)',
          border: '1px solid rgba(0, 214, 143, 0.3)',
          borderRadius: 6, fontSize: 11, color: 'var(--green)',
        }}>
          <span style={{ fontSize: 14 }}>🔴</span>
          <strong>Sincronizado Bet365</strong>
          <span style={{ color: 'var(--mute)' }}>·</span>
          <span style={{ color: 'var(--mute)' }}>
            saldo R$ {bancaSnapshot.balance?.toFixed(2)}
            {(() => {
              const realBets = bancaSnapshot?.bets || []
              const realPending = realBets.filter(b => !b.status || /open|pend|live/i.test(b.status))
              const realSettled = realBets.filter(b => b.status && /won|lost|win|los/i.test(b.status))
              const realWins = realSettled.filter(b => /won|win/i.test(b.status))
              const wr = realSettled.length ? +(realWins.length / realSettled.length * 100).toFixed(1) : null
              return ` · ${realPending.length} aberta${realPending.length !== 1 ? 's' : ''}${wr != null ? ` · ${wr}% win` : ''}`
            })()}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--mute)' }}>
            {new Date(bancaSnapshot.balanceCapturedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* Tab bar geral */}
      <div style={{ display:'flex', gap:0, marginBottom:16, borderBottom:'1px solid var(--card-border)', overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); try { localStorage.setItem('sb_banca_tab', t.id) } catch {} }} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
            padding:'8px 16px', background:'none', border:'none',
            borderBottom: tab===t.id ? '2px solid var(--blue)' : '2px solid transparent',
            color: tab===t.id ? 'var(--blue)' : 'var(--mute)',
            cursor:'pointer', marginBottom:-1, whiteSpace:'nowrap',
          }}>{t.l}</button>
        ))}
      </div>

      {/* ══ OVERVIEW ══ */}
      {tab === 'overview' && (
        <>
          {/* Balance Card */}
          <div style={{
            background:'var(--card-bg)', border:'1px solid var(--card-border)',
            borderRadius:'var(--r2)', padding:'16px',
            marginBottom:14,
            backgroundImage:'linear-gradient(135deg,rgba(59,130,246,.04),rgba(34,212,160,.03))',
          }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
              <div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>
                  Saldo Bet365
                </div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:34, fontWeight:900,
                  color:'var(--green)', lineHeight:1 }}>
                  {fmtBRL(effBalance)}
                </div>
                <div style={{ display:'flex', gap:14, marginTop:8, flexWrap:'wrap' }}>
                  {data.deposited > 0 && (
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
                      Dep: <span style={{ color:'var(--blue)' }}>{fmtBRL(data.deposited)}</span>
                    </span>
                  )}
                  {data.withdrawn > 0 && (
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
                      Ret: <span style={{ color:'var(--amber)' }}>{fmtBRL(data.withdrawn)}</span>
                    </span>
                  )}
                  {profit != null && (
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
                      P&L: <span style={{ color: profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight:700 }}>
                        {profit > 0 ? '+' : ''}{fmtBRL(profit)}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
                {[
                  { id:'deposit',  label:'+ Depósito',  c:'var(--green)',  bc:'rgba(34,212,160,.4)', bg:'rgba(34,212,160,.1)' },
                  { id:'withdraw', label:'− Retirada',   c:'var(--amber)',  bc:'rgba(245,158,11,.4)', bg:'rgba(245,158,11,.08)' },
                  { id:'adjust',   label:'✏ Ajustar',    c:'var(--blue)',   bc:'rgba(59,130,246,.4)', bg:'rgba(59,130,246,.08)' },
                ].map(b => (
                  <button key={b.id} onClick={() => setMode(mode === b.id ? null : b.id)} style={{
                    fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                    padding:'5px 12px', borderRadius:6, cursor:'pointer',
                    border:`1px solid ${mode===b.id ? b.bc : 'rgba(255,255,255,.12)'}`,
                    background: mode===b.id ? b.bg : 'transparent',
                    color: mode===b.id ? b.c : 'var(--mute)',
                  }}>{b.label}</button>
                ))}
              </div>
            </div>

            {/* Inline form */}
            {mode && (
              <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--line)',
                display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>R$</span>
                <input
                  autoFocus type="number" min="0" step="0.01"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && commit()}
                  placeholder={mode === 'adjust' ? 'Saldo atual Bet365' : '0,00'}
                  style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700,
                    width:130, padding:'5px 8px', borderRadius:6,
                    border:'1px solid var(--line)', background:'rgba(255,255,255,.05)', color:'var(--white)', outline:'none' }}
                />
                <input type="text" value={note} onChange={e => setNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && commit()}
                  placeholder="Nota (ex: bônus, saque parcial)"
                  style={{ fontFamily:"'Inter',sans-serif", fontSize:11, flex:1, minWidth:150,
                    padding:'5px 8px', borderRadius:6, border:'1px solid var(--line)',
                    background:'rgba(255,255,255,.05)', color:'var(--soft)', outline:'none' }}
                />
                <button onClick={commit} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                  padding:'5px 14px', borderRadius:6, cursor:'pointer',
                  background:'rgba(34,212,160,.15)', border:'1px solid rgba(34,212,160,.4)', color:'var(--green)' }}>
                  Confirmar
                </button>
                <button onClick={() => { setMode(null); setAmount(''); setNote('') }}
                  style={{ background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:16 }}>✕</button>
              </div>
            )}
          </div>

          {/* KPIs from pick history */}
          <KpiRow>
            <Kpi value={resolved.length} label="Apostas analisadas" color="var(--soft)" />
            <Kpi value={winRate ? `${winRate}%` : '—'} label="Win rate" color={winRate >= 55 ? 'var(--green)' : winRate >= 45 ? 'var(--amber)' : 'var(--red)'} />
            <Kpi value={`@${avgOdd}`} label="Odd média" color="var(--blue)" />
            <Kpi value={profit != null ? (profit > 0 ? '+' : '') + fmtBRL(profit) : '—'} label="P&L total" color={profit > 0 ? 'var(--green)' : 'var(--red)'} />
          </KpiRow>

          {/* Kelly Recommendations */}
          {effBalance > 0 && <KellyPanel balance={effBalance} />}

          {/* Goals */}
          <div className="section-label" style={{ marginTop:4 }}>🎯 Metas de Banca</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
            {goals.map((g, i) => (
              <div key={i} style={{ position:'relative' }}>
                <GoalBar
                  goal={g} balance={effBalance}
                  winRate={winRate || 52} avgOdd={avgOdd} avgStakePct={2}
                />
                <button onClick={() => removeGoal(i)} style={{
                  position:'absolute', top:8, right:8,
                  background:'none', border:'none', color:'var(--mute)',
                  cursor:'pointer', fontSize:11, opacity:.5,
                }}>✕</button>
              </div>
            ))}

            {/* Add goal */}
            {showGoalForm ? (
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap',
                background:'rgba(255,255,255,.03)', border:'1px solid var(--line)',
                borderRadius:8, padding:'10px 12px' }}>
                <input value={newGoalV} onChange={e => setNewGoalV(e.target.value)} type="number"
                  placeholder="Valor (R$)" style={{ width:110, fontFamily:"'JetBrains Mono',monospace", fontSize:11,
                    padding:'5px 8px', borderRadius:6, border:'1px solid var(--line)',
                    background:'var(--ink2)', color:'var(--white)', outline:'none' }} />
                <input value={newGoalL} onChange={e => setNewGoalL(e.target.value)}
                  placeholder="Label (ex: Meta Anual)" style={{ flex:1, minWidth:150, fontSize:11,
                    padding:'5px 8px', borderRadius:6, border:'1px solid var(--line)',
                    background:'var(--ink2)', color:'var(--soft)', outline:'none' }} />
                <button onClick={addGoal} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                  padding:'5px 12px', borderRadius:6, cursor:'pointer',
                  background:'rgba(34,212,160,.15)', border:'1px solid rgba(34,212,160,.4)', color:'var(--green)' }}>+ Adicionar</button>
                <button onClick={() => setShowGoalForm(false)}
                  style={{ background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:14 }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setShowGoalForm(true)} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:11,
                padding:'8px', borderRadius:8, cursor:'pointer', textAlign:'center',
                background:'transparent', border:'1px dashed rgba(255,255,255,.15)', color:'var(--dim)',
              }}>+ Nova Meta</button>
            )}
          </div>

          {/* Transaction history */}
          {(data.history || []).length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div className="section-label">📋 Histórico Bet365</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {[...(data.history || [])].reverse().slice(0, 10).map(tx => {
                  const c = tx.type === 'deposit' ? 'var(--green)' : tx.type === 'withdraw' ? 'var(--amber)' : 'var(--blue)'
                  const icon = tx.type === 'deposit' ? '↑' : tx.type === 'withdraw' ? '↓' : '✏'
                  return (
                    <div key={tx.id} style={{ display:'flex', alignItems:'center', gap:10,
                      background:'rgba(255,255,255,.025)', borderRadius:6, padding:'7px 10px', fontSize:11 }}>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, color:c, width:14 }}>{icon}</span>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)', minWidth:80 }}>{fmtDate(tx.ts)}</span>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:c }}>
                        {tx.type === 'deposit' ? '+' : tx.type === 'withdraw' ? '−' : ''}{fmtBRL(tx.amount)}
                      </span>
                      {tx.note && <span style={{ color:'var(--dim)', fontSize:10, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.note}</span>}
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', marginLeft:'auto' }}>→ {fmtBRL(tx.balAfter)}</span>
                      <button onClick={() => deleteTx(tx.id)}
                        style={{ background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:11 }}>✕</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ══ PLANO HOJE ══ */}
      {tab === 'plano' && (
        <PlanoHoje balance={effBalance} />
      )}

      {/* ══ PLANNER ══ */}
      {tab === 'planner' && (
        <>
          <UpgradePlanner balance={effBalance || 1000} />

          {/* Upgrade stages */}
          <div className="section-label">📈 Fases de Upgrade de Banca</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
            {[
              { range:'R$ 0 – R$ 500',    phase:'🥉 Iniciante',  strategy:'Aposte apenas em singles. Max 3-4 apostas/dia. Foco em mercados com edge claro (conf ≥80%). Stake fixo: 2-3% da banca.' },
              { range:'R$ 500 – R$ 1.000',phase:'🥈 Construção', strategy:'Comece ¼ Kelly. Pode explorar 2-3 acumuladores simples por semana. Diversifique entre futebol e NBA. ROI alvo: 4-6%/mês.' },
              { range:'R$ 1.000 – R$ 3.000',phase:'🥇 Desenvolvimento',strategy:'¼ Kelly padrão. Stop loss de 8% diário. Introduza CLV tracking. Máx 5% por aposta. Considere cashout estratégico.' },
              { range:'R$ 3.000 – R$ 10.000',phase:'💎 Profissional',strategy:'Sistema Kelly rigoroso. Diversifique casas (Betano, Pinnacle). Limites de casas podem ser atingidos. 30-50 apostas/mês é suficiente.' },
              { range:'R$ 10.000+',          phase:'🏆 Elite',     strategy:'Multi-account. Foco em EV e odds de Pinnacle como benchmark. ROI de 3-4%/mês é excelente nesse nível. Proteja a banca.' },
            ].map(stage => {
              const isActive = (() => {
                const [min, max] = stage.range.replace(/R\$ /g,'').split('–').map(v => parseFloat(v.replace(/[. ]/g,'').replace(',','.')))
                return data.balance >= (min||0) && (isNaN(max) || data.balance < max)
              })()
              return (
                <div key={stage.phase} style={{
                  background: isActive ? 'rgba(59,130,246,.06)' : 'var(--card-bg)',
                  border: `1px solid ${isActive ? 'rgba(59,130,246,.3)' : 'var(--card-border)'}`,
                  borderRadius:'var(--r)', padding:'12px 14px',
                }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, flexWrap:'wrap', gap:4 }}>
                    <span style={{ fontWeight:700, fontSize:12, color: isActive ? 'var(--blue)' : 'var(--soft)' }}>
                      {isActive ? '▶ ' : ''}{stage.phase}
                    </span>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)' }}>
                      {stage.range}
                    </span>
                  </div>
                  <div style={{ fontSize:11, color:'var(--mute)', lineHeight:1.5 }}>{stage.strategy}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ══ PERFORMANCE ══ */}
      {tab === 'perf' && (
        <Suspense fallback={<div style={{padding:40,textAlign:'center',color:'var(--mute)'}}>Carregando performance…</div>}>
          <PerformancePage />
        </Suspense>
      )}

      {/* ══ TIPS ══ */}
      {tab === 'tips' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:10 }}>
          {TIPS.map((tip, i) => (
            <div key={i} style={{
              background:'var(--card-bg)', border:'1px solid var(--card-border)',
              borderRadius:'var(--r2)', padding:'14px',
            }}>
              <div style={{ fontSize:22, marginBottom:8 }}>{tip.icon}</div>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--white)', marginBottom:6 }}>{tip.title}</div>
              <div style={{ fontSize:11, color:'var(--mute)', lineHeight:1.6 }}>{tip.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
