// ═══════════════════════════════════════════════════════════
// Análise 365 AI — Fase 34 v4
// Motor próprio SportsBrain:
//   • /v1/odds/value → value bets já calculados pelo Worker
//   • /v1/odds/all   → snapshot interno (fallback de-juíce local)
//   • fetchMatches   → fallback simulado quando snapshot vazio
// ═══════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import { fetchMatches } from '../api/client'
import { getClaudeKey, saveClaudeKey, callClaude as _callClaude, mdToHtml as _mdToHtml } from '../utils/ai'

// ── Worker endpoint (odds proxy) ────────────────────────────
const WORKER_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'

// Sport type map — used to detect basketball from sport_key
const SPORT_TYPE_MAP = { basketball_nba: 'basketball' }

// ── Data local YYYY-MM-DD ────────────────────────────────────
function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// ════════════════════════════════════════════════════════════
// MODO REAL — via Worker proxy (ODDS_API_KEY vive como secret)
// ════════════════════════════════════════════════════════════

/** Busca todos os eventos via Worker — chave fica no servidor */
async function fetchAllEventsFromWorker() {
  const resp = await fetch(`${WORKER_BASE}/v1/odds/all`, { signal: AbortSignal.timeout(30000) })
  if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`)
  const data = await resp.json()
  return Array.isArray(data.events) ? data.events : []
}

/** De-juíza o mercado: devolve probabilidades justas normalizadas */
function dejuice(arr, keys) {
  const sums = {}; keys.forEach(k => { sums[k] = 0 })
  let count = 0
  arr.forEach(row => {
    const impl = keys.reduce((s, k) => s + (row[k] && row[k] > 1 ? 1 / row[k] : 0), 0)
    if (impl < 0.85) return
    keys.forEach(k => { if (row[k] && row[k] > 1) sums[k] += (1 / row[k]) / impl })
    count++
  })
  if (!count) return null
  const probs = {}; let total = 0
  keys.forEach(k => { probs[k] = sums[k] / count; total += probs[k] })
  if (total <= 0) return null
  keys.forEach(k => { probs[k] = probs[k] / total })
  return probs
}

/** Melhor odd e a casa que a oferece */
function bestOdds(arr, key) {
  let best = null, bk = ''
  arr.forEach(row => {
    if (row[key] && row[key] > 1 && (!best || row[key] > best)) {
      best = row[key]; bk = row.bkTitle || row.bk || ''
    }
  })
  return { odds: best, bk }
}

/** Analisa evento real: de-juíza h2h + totals, calcula EV por mercado */
function analyzeRealEvent(event, sportType) {
  const results = []
  const isBball = sportType === 'basketball'
  const h2hAll = [], totAll = []

  // Agrupa totals por ponto — escolhe o mais popular depois
  const totalsByPoint = {}

  ;(event.bookmakers || []).forEach(bk => {
    ;(bk.markets || []).forEach(mkt => {
      if (mkt.key === 'h2h') {
        const row = { bk: bk.key, bkTitle: bk.title || bk.key }
        ;(mkt.outcomes || []).forEach(o => {
          if (o.name === event.home_team)  row.home = o.price
          else if (o.name === event.away_team) row.away = o.price
          else if (o.name === 'Draw')          row.draw = o.price
        })
        if (row.home && row.away) h2hAll.push(row)
      }
      if (!isBball && mkt.key === 'totals') {
        ;(mkt.outcomes || []).forEach(o => {
          const pt = o.point
          if (pt == null) return
          if (!totalsByPoint[pt]) totalsByPoint[pt] = {}
          if (!totalsByPoint[pt][bk.key]) totalsByPoint[pt][bk.key] = { bk: bk.key, bkTitle: bk.title || bk.key }
          const row = totalsByPoint[pt][bk.key]
          const name = (o.name || '').toLowerCase()
          if (name === 'over')  row.over  = o.price
          if (name === 'under') row.under = o.price
        })
      }
    })
  })

  // Escolhe melhor linha de totals (prefere 2.5, senão a mais popular)
  const pointKeys = Object.keys(totalsByPoint)
  let bestPoint = null
  if (pointKeys.length) {
    if (totalsByPoint['2.5']) bestPoint = '2.5'
    else {
      bestPoint = pointKeys.sort((a,b) => {
        const na = Object.keys(totalsByPoint[a]).length
        const nb = Object.keys(totalsByPoint[b]).length
        if (nb !== na) return nb - na
        return Math.abs(+a - 2.5) - Math.abs(+b - 2.5)
      })[0]
    }
    Object.values(totalsByPoint[bestPoint] || {}).forEach(row => {
      if (row.over || row.under) totAll.push(row)
    })
  }

  // Se não tem nem h2h nem totals, aborta
  if (!h2hAll.length && !totAll.length) return results

  // ── H2H ──
  const h2hKeys = isBball ? ['home','away'] : ['home','draw','away']
  const fairProbs = dejuice(h2hAll, h2hKeys)
  if (fairProbs) {
    const h2hMarkets = isBball
      ? [{ key:'h2h_home', confKey:'home', label:'Vitória Casa' },
         { key:'h2h_away', confKey:'away', label:'Vitória Fora' }]
      : [{ key:'h2h_home', confKey:'home', label:'Vitória Casa' },
         { key:'h2h_draw', confKey:'draw', label:'Empate' },
         { key:'h2h_away', confKey:'away', label:'Vitória Fora' }]
    h2hMarkets.forEach(mp => {
      const fp = fairProbs[mp.confKey]
      if (!fp || fp < 0.04) return
      const best = bestOdds(h2hAll, mp.confKey)
      if (!best.odds || best.odds <= 1.01) return
      const conf = Math.round(fp * 100)
      const ve = calcEV(conf, best.odds)
      results.push({
        id: (event.id || event.home_team + '|' + event.away_team) + '_' + mp.key,
        sport: sportType,
        home: event.home_team, away: event.away_team,
        league: event.sport_key || '',
        commence: event.commence_time || '',
        market: mp.key, marketLabel: mp.label,
        conf, odds: best.odds, bestBk: best.bk, books: h2hAll.length,
        ...ve,
        _real: true,
      })
    })
  }

  // ── Over/Under 2.5 ──
  if (!isBball && totAll.length) {
    const totProbs = dejuice(totAll, ['over','under'])
    if (totProbs) {
      const ptLbl = bestPoint || '2.5'
      ;[{ key:'totals_over', confKey:'over', label:`Over ${ptLbl} Gols` },
        { key:'totals_under', confKey:'under', label:`Under ${ptLbl} Gols` }].forEach(mp => {
        const fp = totProbs[mp.confKey]
        if (!fp || fp < 0.1) return
        const best = bestOdds(totAll, mp.confKey)
        if (!best.odds || best.odds <= 1.01) return
        const conf = Math.round(fp * 100)
        const ve = calcEV(conf, best.odds)
        results.push({
          id: (event.id || event.home_team + '|' + event.away_team) + '_' + mp.key,
          sport: sportType,
          home: event.home_team, away: event.away_team,
          league: event.sport_key || '',
          commence: event.commence_time || '',
          market: mp.key, marketLabel: mp.label,
          conf, odds: best.odds, bestBk: best.bk, books: totAll.length,
          ...ve,
          _real: true,
        })
      })
    }
  }

  return results
}

// ════════════════════════════════════════════════════════════
// MODO SIMULADO — Worker + Seeded RNG (fallback)
// ════════════════════════════════════════════════════════════

function seededRng(seed) {
  let s = 0
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5
    return ((s >>> 0) / 0xFFFFFFFF)
  }
}

function genMarketOdds(fairProb, rng) {
  const juice = 1.04 + rng() * 0.03
  const impliedOdd = 1 / (fairProb * juice)
  const ineff = 0.96 + rng() * 0.16
  return Number((impliedOdd * ineff).toFixed(2))
}

function analyzeGame(g) {
  const rng = seededRng(g.id || (g.home_team + g.away_team + localDate()))
  const sport = g.sport || 'football'
  const isBball = sport === 'basketball'
  const league = typeof g.league === 'string' ? g.league : g.league?.name || 'Liga'
  const home = g.home_team || g.home_team_name || 'Casa'
  const away = g.away_team || g.away_team_name || 'Fora'
  const baseConf = g.confidence_score ? Math.round(g.confidence_score * 100) : Math.round(45 + rng() * 25)
  const results = []

  // H2H
  const homeProb = Math.max(0.18, Math.min(0.72, (baseConf / 100) * (0.55 + rng() * 0.3)))
  const drawProb = isBball ? 0 : Math.max(0.12, Math.min(0.35, 0.27 + rng() * 0.12))
  const awayProb = isBball ? 1 - homeProb : Math.max(0.08, 1 - homeProb - drawProb)

  const h2hDefs = isBball
    ? [{ key:'home', label:'Vitória Casa', prob:homeProb },
       { key:'away', label:'Vitória Fora', prob:awayProb }]
    : [{ key:'home', label:'Vitória Casa', prob:homeProb },
       { key:'draw', label:'Empate',        prob:drawProb },
       { key:'away', label:'Vitória Fora',  prob:awayProb }]

  const books = ['Bet365','Pinnacle','Betway','1xBet','Betfair','Unibet','Bwin','William Hill']
  h2hDefs.forEach(def => {
    const conf = Math.round(def.prob * 100)
    const numBooks = 4 + Math.floor(rng() * 5)
    let bestOdd = 0, bestBk = ''
    for (let i = 0; i < numBooks; i++) {
      const odd = genMarketOdds(def.prob, rng)
      if (odd > bestOdd) { bestOdd = odd; bestBk = books[i % books.length] }
    }
    const ve = calcEV(conf, bestOdd)
    results.push({
      id: (g.id || home) + '_h2h_' + def.key,
      sport, home, away, league,
      commence: g.date || g.date_utc,
      market: 'h2h_' + def.key, marketLabel: def.label,
      conf, odds: bestOdd, bestBk, books: numBooks,
      ...ve,
    })
  })

  // Over/Under 2.5
  if (!isBball) {
    const overProb = Math.max(0.28, Math.min(0.72, 0.45 + rng() * 0.22))
    const underProb = 1 - overProb
    const totBooks = ['Pinnacle','Bet365','Betfair','1xBet','Betway']
    ;[{ key:'over', label:'Over 2.5 Gols', prob:overProb },
      { key:'under', label:'Under 2.5 Gols', prob:underProb }].forEach(def => {
      const conf = Math.round(def.prob * 100)
      const numBooks = 3 + Math.floor(rng() * 4)
      let bestOdd = 0, bestBk = ''
      for (let i = 0; i < numBooks; i++) {
        const odd = genMarketOdds(def.prob, rng)
        if (odd > bestOdd) { bestOdd = odd; bestBk = totBooks[i % totBooks.length] }
      }
      const ve = calcEV(conf, bestOdd)
      results.push({
        id: (g.id || home) + '_tot_' + def.key,
        sport, home, away, league,
        commence: g.date || g.date_utc,
        market: 'totals_' + def.key, marketLabel: def.label,
        conf, odds: bestOdd, bestBk, books: numBooks,
        ...ve,
      })
    })
  }

  // BTTS
  if (!isBball && rng() > 0.3) {
    const bttsProb = Math.max(0.3, Math.min(0.7, 0.42 + rng() * 0.2))
    const conf = Math.round(bttsProb * 100)
    const numBooks = 3 + Math.floor(rng() * 3)
    const bttsBooks = ['Bet365','Betway','Bwin','Unibet']
    let bestOdd = 0, bestBk = ''
    for (let i = 0; i < numBooks; i++) {
      const odd = genMarketOdds(bttsProb, rng)
      if (odd > bestOdd) { bestOdd = odd; bestBk = bttsBooks[i % bttsBooks.length] }
    }
    const ve = calcEV(conf, bestOdd)
    results.push({
      id: (g.id || home) + '_btts',
      sport, home, away, league,
      commence: g.date || g.date_utc,
      market: 'btts', marketLabel: 'Ambas Marcam',
      conf, odds: bestOdd, bestBk, books: numBooks,
      ...ve,
    })
  }

  return results
}

// ════════════════════════════════════════════════════════════
// EV / Edge — compartilhado por ambos os modos
// ════════════════════════════════════════════════════════════
function calcEV(conf, marketOdd) {
  const p = conf / 100
  const fo = Number((1 / p).toFixed(2))
  const ev = Number((((p * marketOdd) - 1) * 100).toFixed(1))
  const edge = Number(((marketOdd / fo - 1) * 100).toFixed(1))
  let lbl = 'no_value'
  if (ev >= 8)      lbl = 'high'
  else if (ev >= 3) lbl = 'good'
  else if (ev >= 0) lbl = 'neutral'
  return { ev, fo, edge, lbl }
}

// ── Re-exports do utils/ai (mantém compatibilidade) ────────
export const mdToHtml   = _mdToHtml
export const callClaude = _callClaude

// ── Mapas de label ──────────────────────────────────────────
const lblMap   = { no_value:'Sem Valor', neutral:'Neutro', good:'Boa Relação', high:'Valor Alto' }
const lblColor = { no_value:'var(--red)', neutral:'var(--mute)', good:'var(--blue)', high:'var(--green)' }
const evColor  = ev => ev >= 8 ? 'var(--green)' : ev >= 3 ? 'rgba(0,214,143,.7)' : ev >= 0 ? 'var(--amber)' : 'var(--red)'

// ── ValueCard ───────────────────────────────────────────────
function ValueCard({ r, rank }) {
  const diffPct = r.odds > r.fo ? Math.round((r.odds / r.fo - 1) * 100) : 0
  const sportIcon = r.sport === 'basketball' ? '🏀' : '⚽'
  const rankLabel = rank < 3 ? ['🥇','🥈','🥉'][rank] : `${rank+1}º`
  const ev = r.ev
  const isReal = !!r._real

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: `1px solid ${ev >= 5 ? 'rgba(0,214,143,.3)' : ev >= 0 ? 'rgba(255,184,48,.18)' : 'rgba(255,79,106,.15)'}`,
      borderRadius: 'var(--r2)',
      padding: '12px',
      marginBottom: 8,
      boxShadow: ev >= 5 ? '0 0 14px rgba(0,214,143,.08)' : 'none',
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:8 }}>
        <div style={{ fontSize:15, lineHeight:1, minWidth:24, textAlign:'center' }}>{rankLabel}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {sportIcon} {r.home} vs {r.away}
          </div>
          <div style={{ fontSize:10, color:'var(--mute)', marginTop:2 }}>
            {r.league}
            {r.commence ? ` · ${new Date(r.commence).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}` : ''}
            {isReal && <span style={{ marginLeft:6, color:'var(--green)', fontFamily:"'JetBrains Mono',monospace", fontSize: 11 }}>● REAL</span>}
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:22, fontWeight:900, color:evColor(ev), lineHeight:1 }}>
            {ev >= 0 ? '+' : ''}{ev}%
          </div>
          <div style={{ fontSize: 11, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>EV</div>
        </div>
      </div>

      <div style={{
        display:'flex', alignItems:'center', gap:6, flexWrap:'wrap',
        padding:'6px 10px', borderRadius:6, marginBottom:8,
        background: ev >= 5 ? 'rgba(0,214,143,.07)' : ev >= 0 ? 'rgba(255,184,48,.06)' : 'rgba(255,79,106,.05)',
      }}>
        <span style={{ fontSize:12, fontWeight:700, color:evColor(ev) }}>{r.marketLabel}</span>
        <span style={{ fontSize: 11, color:'var(--mute)', marginLeft:'auto' }}>Prob. modelo</span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:800, color:'var(--blue)' }}>{r.conf}%</span>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:8 }}>
        {[
          { label:'ODD JUSTA',   val: r.fo,   color:'var(--soft)' },
          { label:'ODD MERCADO', val: r.odds, color:'var(--green)' },
          { label:'DIFERENÇA',   val: `${diffPct >= 0 ? '+' : ''}${diffPct}%`, color: diffPct > 0 ? 'var(--green)' : 'var(--red)' },
        ].map(col => (
          <div key={col.label} style={{ background:'rgba(255,255,255,.03)', border:'1px solid var(--line)', borderRadius:5, padding:'6px', textAlign:'center' }}>
            <div style={{ fontSize: 11, color:'var(--mute)', marginBottom:3, fontFamily:"'JetBrains Mono',monospace" }}>{col.label}</div>
            <div style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:15, fontWeight:800, color:col.color }}>{col.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, fontWeight:700, padding:'2px 7px', borderRadius:3, background:'rgba(0,0,0,.25)', border:`1px solid ${evColor(ev)}`, color:evColor(ev) }}>
          EV {ev >= 0 ? '+' : ''}{ev}%
        </span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, fontWeight:700, padding:'2px 7px', borderRadius:3, background:'rgba(0,0,0,.2)', border:'1px solid var(--line)', color:lblColor[r.lbl] || 'var(--mute)' }}>
          {lblMap[r.lbl] || r.lbl}
        </span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color:'var(--mute)', marginLeft:'auto' }}>
          {r.books} casas{r.bestBk ? ` · ${r.bestBk}` : ''} · edge {r.edge >= 0 ? '+' : ''}{r.edge}%
        </span>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
export default function Analise365() {
  const [results, setResults]       = useState([])
  const [status, setStatus]         = useState({ msg:'Clique em ✦ Buscar Odds para varrer 12 ligas (EPL, La Liga, Serie A, Bundesliga, Brasileirão, NBA e mais) usando o motor interno SportsBrain.', color:'mute' })
  const [loading, setLoading]       = useState(false)
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiContent, setAiContent]   = useState('')
  const [filter, setFilter]         = useState('all')
  const [configOpen, setConfigOpen] = useState(false)
  const [minEv, setMinEv]           = useState(-100)
  const [minConf, setMinConf]       = useState(0)
  const [claudeKey, setClaudeKeyState]   = useState(() => getClaudeKey())
  const [mode, setMode]             = useState('') // 'real' | 'sim' | ''
  const totalGamesRef  = useRef(0)
  const autoAiRanRef   = useRef(false)

  function handleClaudeKey(v) { setClaudeKeyState(v); saveClaudeKey(v) }

  // ── Buscar Modo Real (Motor SportsBrain próprio) ──────────
  const fetchReal = useCallback(async () => {
    setStatus({ msg:'🔬 Motor SportsBrain — varrendo snapshot interno…', color:'blue' })
    const now = Date.now()
    let allResults = []
    let totalEvents = 0

    // Tenta primeiro /v1/odds/value (value bets prontos do Worker)
    try {
      const vresp = await fetch(`${WORKER_BASE}/v1/odds/value?min_edge=0`, { signal: AbortSignal.timeout(15000) })
      if (vresp.ok) {
        const vdata = await vresp.json()
        const vbets = Array.isArray(vdata.bets) ? vdata.bets : []
        if (vbets.length > 0) {
          const sorted = vbets.map(b => ({
            id: `${b.event_id || b.id || b.home_team+'|'+b.away_team}_${b.market}_${b.outcome}`,
            sport: (b.sport || '').includes('basket') ? 'basketball' : 'football',
            home: b.home_team || '', away: b.away_team || '',
            league: b.league || b.sport_key || '',
            commence: b.commence_time || '',
            market: b.market || '', marketLabel: b.outcome || b.market || '',
            conf: Math.round((b.fair_prob || b.model_prob || 0) * 100),
            odds: b.price || b.price_at_pick || 0,
            bestBk: b.book || '', books: b.books_count || 1,
            ev: Math.round((b.edge_pct || 0) * 10) / 10,
            edge: Math.round((b.edge_pct || 0) * 10) / 10,
            fo: b.fair_price ? +(b.fair_price).toFixed(2) : null,
            lbl: (b.edge_pct || 0) >= 5 ? 'hot' : (b.edge_pct || 0) >= 2 ? 'good' : 'neutral',
            _real: true,
          }))
          setResults(sorted)
          totalGamesRef.current = sorted.length
          const evPlus = sorted.filter(r => r.ev > 0).length
          const evHigh = sorted.filter(r => r.ev >= 5).length
          setStatus({
            msg: `✅ MOTOR · ${sorted.length} value bets · ${evPlus} com EV+ · ${evHigh} com EV ≥ 5%`,
            color: evHigh > 0 ? 'green' : evPlus > 0 ? 'amber' : 'mute',
          })
          setMode('real')
          return sorted.length
        }
      }
    } catch {}

    // Fallback: snapshot interno + de-juice local
    const events = await fetchAllEventsFromWorker()

    // Janela: -2h até +36h
    events.forEach(ev => {
      const t = ev.commence_time ? new Date(ev.commence_time).getTime() : 0
      if (t < now - 2 * 3600000 || t > now + 36 * 3600000) return
      const sportType = SPORT_TYPE_MAP[ev.sport_key] || 'football'
      allResults.push(...analyzeRealEvent(ev, sportType))
      totalEvents++
    })

    // Deduplica: melhor EV por jogo+mercado
    const seen = {}
    allResults.forEach(r => {
      if (!seen[r.id] || r.ev > seen[r.id].ev) seen[r.id] = r
    })
    const sorted = Object.values(seen).sort((a, b) => b.ev - a.ev)
    setResults(sorted)
    totalGamesRef.current = totalEvents

    const evPlus = sorted.filter(r => r.ev > 0).length
    const evHigh = sorted.filter(r => r.ev >= 5).length
    setStatus({
      msg: `✅ SNAPSHOT · ${totalEvents} jogos · ${sorted.length} mercados · ${evPlus} com EV+`,
      color: evHigh > 0 ? 'green' : evPlus > 0 ? 'amber' : 'mute',
    })
    setMode('real')
    // Retorna 0 se não achou mercados — aciona fallback simulado
    return sorted.length > 0 ? totalEvents : 0
  }, [])

  // ── Buscar Modo Simulado (Worker + RNG) ────────────────────
  const fetchSim = useCallback(async () => {
    setStatus({ msg:'⏳ Modo Simulado — buscando jogos do Worker…', color:'amber' })
    const res = await fetchMatches({ date: localDate(), per_page: 200 })
    const all = res.matches || res.data || res || []

    const today = localDate()
    const games = all.filter(g => {
      const d = g.date || g.date_utc || g.utcDate
      if (!d) return true
      const ld = new Date(d)
      const lDate = `${ld.getFullYear()}-${String(ld.getMonth()+1).padStart(2,'0')}-${String(ld.getDate()).padStart(2,'0')}`
      return lDate === today
    })

    totalGamesRef.current = games.length
    let allResults = []
    games.forEach(g => { allResults.push(...analyzeGame(g)) })

    const seen = {}
    allResults.forEach(r => {
      const dk = r.id
      if (!seen[dk] || r.ev > seen[dk].ev) seen[dk] = r
    })
    const sorted = Object.values(seen).sort((a, b) => b.ev - a.ev)
    setResults(sorted)

    const evPlus = sorted.filter(r => r.ev > 0).length
    const evHigh = sorted.filter(r => r.ev >= 5).length
    setStatus({
      msg: `✅ SIMULADO · ${games.length} jogos · ${sorted.length} mercados · ${evPlus} com EV+ · ${evHigh} com EV ≥ 5%`,
      color: evHigh > 0 ? 'green' : evPlus > 0 ? 'amber' : 'mute',
    })
    setMode('sim')
  }, [])

  // ── Buscar — tenta modo real (Worker), fallback sim ────────
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const count = await fetchReal()
      if (!count) await fetchSim()  // Worker vazio → fallback simulado
    } catch(e) {
      setStatus({ msg:`⚠ Worker indisponível — modo simulado`, color:'amber' })
      try { await fetchSim() } catch {}
    }
    setLoading(false)
  }, [fetchReal, fetchSim])

  // ── IA Analisar (Claude) ───────────────────────────────────
  const runAI = useCallback(async () => {
    if (!claudeKey) { setConfigOpen(true); return }
    if (!results.length) { setStatus({ msg:'⚠ Busque os odds primeiro.', color:'amber' }); return }
    setAiLoading(true); setAiContent('')

    const top = results.filter(r => r.ev >= minEv).slice(0, 20)
    const evPositive = results.filter(r => r.ev > 0).length
    const evHigh     = results.filter(r => r.ev >= 5).length
    const today      = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' })
    const modeLabel  = mode === 'real' ? 'odds reais (SportsBrain Worker)' : 'odds simuladas (modelo SportsBrain)'

    const summaryLines = top.map((r, i) =>
      `${i+1}. ${r.home} vs ${r.away} [${r.league}]\n   Mercado: ${r.marketLabel} | Prob modelo: ${r.conf}% | Odd justa: ${r.fo} | Melhor odd: ${r.odds} (${r.bestBk || r.books+' casas'}) | EV: ${r.ev >= 0 ? '+' : ''}${r.ev}% | Edge: ${r.edge >= 0 ? '+' : ''}${r.edge}%`
    ).join('\n\n')

    const prompt = `Você é um analista quantitativo revisando observações internas de modelo (modo LAB · não validado em produção). Analise os sinais teóricos do modelo SportsBrain para ${today}.\n\n=== CONTEXTO ===\nFonte dos dados: ${modeLabel}\nTotal de mercados analisados: ${results.length}\nJogos do dia: ${totalGamesRef.current}\nCom EV teórico positivo: ${evPositive}\nCom EV teórico ≥ 5% (alto sinal): ${evHigh}\n\n=== TOP SINAIS (por EV teórico) ===\n${summaryLines}\n\n=== SUA ANÁLISE ===\nForneça:\n1. **Top 3-5 sinais do Dia** — melhores observações com justificativa técnica (sem promessa de lucro)\n2. **Alertas de Risco** — odds suspeitas ou EV muito alto (possível erro de modelo)\n3. **Padrão do Dia** — tendências nos mercados (favoritos sub-precificados, over/under com sinal, etc.)\n4. **Exposição teórica** — comentário sobre a métrica interna por pick (sem recomendação de stake real)\n5. **Conclusão** — veredicto geral em 2-3 frases\n\nLembrete: este é um relatório de análise LAB, não uma recomendação de aposta. Seja objetivo, técnico, em português. Use markdown.`

    try {
      const text = await callClaude(claudeKey, prompt)
      setAiContent(mdToHtml(text))
    } catch(e) {
      const msg = e.message || 'Erro desconhecido'
      setAiContent(`<span style="color:var(--red)">❌ ${msg}</span>`)
      if (msg.includes('401') || msg.toLowerCase().includes('auth')) {
        setStatus({ msg: '❌ Chave Claude inválida — verifique em ⚙ Configurar', color: 'red' })
      }
    }
    setAiLoading(false)
  }, [claudeKey, results, minEv, mode])

  // ── Auto-fetch ao montar ───────────────────────────────────
  useEffect(() => {
    fetchAll()
  }, []) // roda 1x ao abrir

  // ── Auto-IA após resultados carregarem ─────────────────────
  useEffect(() => {
    if (!results.length || autoAiRanRef.current) return
    const ck = getClaudeKey()
    if (!ck) return
    autoAiRanRef.current = true
    runAI()
  }, [results])

  // ── Filtros ────────────────────────────────────────────────
  const filtered = useMemo(() => results.filter(r => {
    if (filter === 'football'   && r.sport !== 'football')   return false
    if (filter === 'basketball' && r.sport !== 'basketball') return false
    if (filter === 'ev'         && r.ev <= 0)                return false
    if (r.ev < minEv)    return false
    if (r.conf < minConf) return false
    return true
  }), [results, filter, minEv, minConf])

  const kpis = {
    total:   results.length,
    evPlus:  results.filter(r => r.ev > 0).length,
    evHigh:  results.filter(r => r.ev >= 5).length,
    avgEv:   results.length ? (results.reduce((s,r) => s + r.ev, 0) / results.length).toFixed(1) : null,
  }

  const dotColor = { green:'var(--green)', amber:'var(--amber)', blue:'var(--blue)', red:'var(--red)', mute:'var(--line)' }

  return (
    <div className="page">
      <PageHeader
        icon="🎰"
        title="Análise 365 AI"
        subtitle="Compara probabilidades do modelo vs mercado e identifica sinais de EV teórico positivo (modo LAB · não validado)"
        actions={
          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color:'var(--mute)' }}>
              {mode === 'real'
                ? <span style={{ color:'var(--green)' }}>● REAL</span>
                : mode === 'sim'
                  ? <span style={{ color:'var(--amber)' }}>● SIM</span>
                  : null}
              {' '}Jogos: <b style={{ color:'var(--blue)' }}>{totalGamesRef.current}</b>
              {' '}· EV+: <b style={{ color:'var(--green)' }}>{kpis.evPlus}</b>
            </span>
            <button onClick={fetchAll} disabled={loading} className="btn btn-primary" style={{ padding:'5px 14px', fontSize:12, fontWeight:700 }}>
              {loading ? '⏳ Varrendo…' : '✦ Buscar Odds'}
            </button>
            <button onClick={runAI} disabled={aiLoading || !results.length} className="btn"
              style={{ padding:'5px 12px', fontSize:11, background:'rgba(0,214,143,.12)', borderColor:'rgba(0,214,143,.3)', color:'var(--green)' }}>
              {aiLoading ? '⏳ Analisando…' : '🎯 IA Analisar'}
            </button>
            <button onClick={() => setConfigOpen(v => !v)} className="btn"
              style={{ padding:'5px 12px', fontSize:11, background:'rgba(255,184,48,.08)', borderColor:'rgba(255,184,48,.2)', color:'var(--amber)' }}>
              ⚙ Configurar
            </button>
          </div>
        }
      />

      {/* Config panel */}
      {configOpen && (
        <div style={{ background:'var(--card-bg)', border:'1px solid rgba(255,184,48,.2)', borderRadius:'var(--r2)', padding:14, marginBottom:12 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color:'var(--amber)', letterSpacing:'1px', textTransform:'uppercase', marginBottom:12 }}>⚙ Configuração</div>

          {/* Odds — via Worker (sem chave no browser) */}
          <div style={{ marginBottom:14, padding:'8px 12px', background:'rgba(0,214,143,.04)', border:'1px solid rgba(0,214,143,.15)', borderRadius:6 }}>
            <div style={{ fontSize:11, color:'var(--green)', fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>
              ✅ Odds reais ativas — EPL, La Liga, Serie A, Bundesliga, Brasileirão, NBA e mais
            </div>
            <div style={{ fontSize:11, color:'var(--dim)', marginTop:3 }}>
              Dados via Worker próprio · chave segura no servidor · cache 10 min
            </div>
          </div>

          {/* Claude AI key */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:'var(--mute)', marginBottom:6 }}>
              Chave Claude AI{' '}
              <span style={{ color: claudeKey ? 'var(--green)' : 'var(--dim)', fontFamily:"'JetBrains Mono',monospace", fontSize: 11 }}>
                {claudeKey ? '(✅ configurada)' : '(opcional — para IA Analisar)'}
              </span>
            </div>
            <input type="password" value={claudeKey} onChange={e => handleClaudeKey(e.target.value)}
              placeholder="sk-ant-…"
              style={{ width:'100%', fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:'6px 8px', background:'rgba(255,255,255,.05)', border:'1px solid var(--line)', borderRadius:4, color:'var(--text)', outline:'none', boxSizing:'border-box' }}
            />
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color:'var(--dim)', marginTop:4 }}>
              Obtenha em{' '}
              <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color:'var(--blue)' }}>console.anthropic.com</a>
            </div>
          </div>

          {/* Thresholds */}
          <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:10, color:'var(--mute)', marginBottom:4, fontFamily:"'JetBrains Mono',monospace" }}>EV MÍNIMO</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="range" min={0} max={15} step={0.5} value={minEv} onChange={e => setMinEv(Number(e.target.value))} style={{ width:90 }}/>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:'var(--green)', fontWeight:700, minWidth:36 }}>+{minEv}%</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize:10, color:'var(--mute)', marginBottom:4, fontFamily:"'JetBrains Mono',monospace" }}>CONF. MÍNIMA</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="range" min={40} max={85} step={1} value={minConf} onChange={e => setMinConf(Number(e.target.value))} style={{ width:90 }}/>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:'var(--blue)', fontWeight:700, minWidth:36 }}>{minConf}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:'var(--r)', marginBottom:12, fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)' }}>
        <span style={{ width:7, height:7, borderRadius:'50%', background:dotColor[status.color]||'var(--line)', flexShrink:0, display:'inline-block', ...(status.color==='green'?{boxShadow:'0 0 6px var(--green)'}:{}) }}/>
        {status.msg}
      </div>

      {/* KPIs */}
      {results.length > 0 && (
        <KpiRow>
          <Kpi value={kpis.total}  label="Mercados" color="var(--blue)"/>
          <Kpi value={kpis.evPlus} label="Com EV+" color="var(--green)"/>
          <Kpi value={kpis.evHigh} label="EV ≥ 5%" color="var(--amber)"/>
          <Kpi value={kpis.avgEv ? `+${kpis.avgEv}%` : '—'} label="EV Médio" color="var(--purple)"/>
        </KpiRow>
      )}

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
        {[
          { id:'all',        label:'Todos' },
          { id:'football',   label:'⚽ Futebol' },
          { id:'basketball', label:'🏀 Basquete' },
          { id:'ev',         label:'✅ Apenas EV+' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, padding:'4px 12px', borderRadius:4, cursor:'pointer',
            border: filter === f.id ? '1px solid rgba(0,214,143,.4)' : '1px solid var(--line)',
            background: filter === f.id ? 'rgba(0,214,143,.12)' : 'transparent',
            color: filter === f.id ? 'var(--green)' : 'var(--mute)',
            fontWeight: filter === f.id ? 700 : 400,
          }}>{f.label}</button>
        ))}
      </div>

      {/* Main layout */}
      <div style={{ display:'flex', gap:14, alignItems:'flex-start', flexWrap:'wrap' }}>

        {/* Lista */}
        <div style={{ flex:2, minWidth:260 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color:'var(--mute)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:8 }}>
            OPORTUNIDADES DE VALOR — {filtered.length} ENCONTRADAS
          </div>

          {!loading && results.length === 0 && (
            <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--mute)' }}>
              <div style={{ fontSize:36, opacity:.3, marginBottom:10 }}>📡</div>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:8, color:'var(--soft)' }}>Pronto para varrer o mercado</div>
              <div style={{ fontSize:12, lineHeight:1.7, marginBottom:16 }}>
                Clique em <b style={{ color:'var(--green)' }}>✦ Buscar Odds</b> para analisar 12 ligas.<br/>
                <span style={{ color:'var(--dim)', fontSize:11 }}>
                  🔬 Motor SportsBrain próprio — snapshot interno + de-juíce Pinnacle-style.
                </span>
              </div>
              <button onClick={fetchAll} className="btn btn-primary" style={{ padding:'8px 20px', fontSize:12, fontWeight:700 }}>
                ✦ Buscar Odds Agora
              </button>
            </div>
          )}

          {loading && (
            <div className="loading-center">
              <div className="spinner"/>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', marginLeft:8 }}>
                🌐 Varrendo odds… {totalGamesRef.current > 0 ? `(${totalGamesRef.current} jogos)` : ''}
              </span>
            </div>
          )}

          {!loading && results.length > 0 && filtered.length === 0 && (
            <div style={{ textAlign:'center', padding:'30px 20px', color:'var(--mute)' }}>
              <div style={{ fontSize:22, marginBottom:8, opacity:.3 }}>🔍</div>
              <div style={{ fontSize:12 }}>Nenhuma oportunidade com os filtros atuais.</div>
              <div style={{ fontSize:10, marginTop:4 }}>Reduza o EV mínimo em ⚙ Configurar ou mude o filtro.</div>
            </div>
          )}

          {filtered.map((r, i) => <ValueCard key={r.id} r={r} rank={i}/>)}
        </div>

        {/* AI Panel */}
        <div style={{ flex:1, minWidth:240 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color:'var(--mute)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:8 }}>
            IA — ANÁLISE CLAUDE
          </div>
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)', borderRadius:'var(--r2)', padding:14, fontSize:12, lineHeight:1.8, color:'var(--mute)', minHeight:280, overflowY:'auto' }}>
            {aiLoading ? (
              <div style={{ padding:14, fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', lineHeight:1.8 }}>
                🤖 Enviando top {results.filter(r=>r.ev>=minEv).slice(0,20).length} oportunidades para IA…<br/>⏳ Aguardando análise…
              </div>
            ) : aiContent ? (
              <div style={{ color:'var(--text)' }} dangerouslySetInnerHTML={{ __html: aiContent }}/>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:200, gap:10, opacity:.5 }}>
                <div style={{ fontSize:32 }}>🤖</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, textAlign:'center', lineHeight:1.7 }}>
                  IA de Odd Pronta<br/>
                  <span style={{ fontSize: 11 }}>Após buscar as odds, clique em<br/>🎯 IA Analisar para análise completa</span>
                </div>
              </div>
            )}
          </div>
          {!claudeKey && results.length > 0 && (
            <div style={{ marginTop:8, padding:'8px 10px', background:'rgba(255,184,48,.06)', border:'1px solid rgba(255,184,48,.15)', borderRadius:'var(--r)', fontSize:10, color:'var(--amber)', fontFamily:"'JetBrains Mono',monospace", lineHeight:1.5 }}>
              ⚠️ Configure a chave Claude AI em ⚙ Configurar para ativar a análise por IA
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
