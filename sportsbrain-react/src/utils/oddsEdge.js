// ═══════════════════════════════════════════════════════════════════════════
// Fase 4 — Edge vs Odds Reais (Kelly fracionário)
// ═══════════════════════════════════════════════════════════════════════════
// Consume /v1/odds/all do worker — ENGINE PROPRIETÁRIO (v2):
//   • 4 scrapers (Betfair Ex, Pinnacle, Betano, Superbet) → consensus D1
//   • Weighted median + de-overround = fair prob
//   • league_slug canônico (disambig. Premier League: ENG/BLR/RUS/etc)
//   • Snapshots 5min → CLV tracker
//
// Match por team names → melhor odd H2H entre todos books.
// Calcula edge = pModelo - impliedProb; Kelly fracionário 25%.
//
// API:
//   fetchAllOdds()                    → [event]  (cached 5min sessionStorage)
//   matchOddsForGame(events, h, a)    → { home, draw, away, bestBook } | null
//   findOddsEvent(events, h, a)       → evento bruto (com league_slug)
//   computeEdge(pModel, realOdd)      → { edge, implied, value }
//   kellyStake(pModel, odd, banca, fraction=0.25) → stake BRL
// ═══════════════════════════════════════════════════════════════════════════

const ODDS_CACHE_KEY = 'sb_odds_all_v2'      // v2 = engine proprietário
const ODDS_CACHE_TTL = 5 * 60 * 1000         // 5min (sincroniza com cron snapshot)

export async function fetchAllOdds() {
  try {
    const raw = sessionStorage.getItem(ODDS_CACHE_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      if (c?.ts && Date.now() - c.ts < ODDS_CACHE_TTL) return c.events || []
    }
  } catch {}

  try {
    const res = await fetch('https://sportsbrain-api.sportsbrain-api.workers.dev/v1/odds/all', {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const events = data.events || data.data?.events || []
    try { sessionStorage.setItem(ODDS_CACHE_KEY, JSON.stringify({ events, ts: Date.now() })) } catch {}
    return events
  } catch { return [] }
}

// ── Normaliza nome para match ────────────────────────────────────────────
function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
    .replace(/\bfc\b|\bsc\b|\bac\b|\baf\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function teamMatch(a, b) {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length < 4 || nb.length < 4) return false
  return na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5)) ||
         na.includes(nb.slice(0, 6)) || nb.includes(na.slice(0, 6))
}

// ── Extrai melhor odd h2h de um evento TheOddsAPI ────────────────────────
function extractBestH2H(event, homeName, awayName) {
  if (!event?.bookmakers?.length) return null
  const best = { home: 0, draw: 0, away: 0 }
  let bestBook = null

  for (const bk of event.bookmakers) {
    const h2h = (bk.markets || []).find(m => m.key === 'h2h')
    if (!h2h) continue
    const outcomes = h2h.outcomes || []
    const hOut = outcomes.find(o => teamMatch(o.name, homeName) || teamMatch(o.name, event.home_team))
    const aOut = outcomes.find(o => teamMatch(o.name, awayName) || teamMatch(o.name, event.away_team))
    const dOut = outcomes.find(o => /draw|empate/i.test(o.name))
    if (hOut && hOut.price > best.home) { best.home = hOut.price; bestBook = bk.key }
    if (aOut && aOut.price > best.away) { best.away = aOut.price }
    if (dOut && dOut.price > best.draw) { best.draw = dOut.price }
  }
  if (!best.home && !best.away) return null
  return { ...best, bestBook }
}

// ═══════════════════════════════════════════════════════════════════════════
export function matchOddsForGame(events, home, away) {
  if (!events?.length) return null
  const match = events.find(e =>
    (teamMatch(e.home_team, home) && teamMatch(e.away_team, away)) ||
    (teamMatch(e.home_team, away) && teamMatch(e.away_team, home))
  )
  if (!match) return null
  return extractBestH2H(match, home, away)
}

// Retorna o evento bruto (com home_team/away_team no nome oficial Bet365/TheOddsAPI)
// Útil pra usar os nomes canônicos do book em vez dos nomes ESPN
export function findOddsEvent(events, home, away) {
  if (!events?.length) return null
  return events.find(e =>
    (teamMatch(e.home_team, home) && teamMatch(e.away_team, away)) ||
    (teamMatch(e.home_team, away) && teamMatch(e.away_team, home))
  ) || null
}

// ── Edge e valor ─────────────────────────────────────────────────────────
export function computeEdge(pModel, realOdd) {
  if (!realOdd || realOdd <= 1 || !pModel || pModel <= 0) {
    return { edge: 0, implied: 0, value: 0, hasEdge: false }
  }
  const implied = 1 / realOdd                     // prob implícita (com margem do book)
  const edge    = pModel - implied                // diferença absoluta
  const value   = (pModel * realOdd - 1) * 100    // EV% clássico

  return {
    edge:    +(edge * 100).toFixed(2),            // pp
    implied: +(implied * 100).toFixed(1),         // %
    value:   +value.toFixed(2),                   // EV%
    hasEdge: edge > 0.03,                          // ≥3pp de edge = value bet
  }
}

// ── Kelly fracionário ─────────────────────────────────────────────────────
// Kelly full: f = (bp - q) / b, onde b = odd-1, p = prob real, q = 1-p
// Fracionário 25%: muito usado por sharps para reduzir variância
export function kellyStake(pModel, realOdd, banca = 0, fraction = 0.25) {
  if (!pModel || pModel <= 0 || !realOdd || realOdd <= 1 || !banca || banca <= 0) {
    return { fraction: 0, stake: 0, fullKelly: 0 }
  }
  const b = realOdd - 1
  const p = pModel
  const q = 1 - p
  const fullKelly = (b * p - q) / b
  if (fullKelly <= 0) return { fraction: 0, stake: 0, fullKelly: +fullKelly.toFixed(4) }
  const fk = Math.min(fullKelly * fraction, 0.05)   // teto 5% banca
  return {
    fraction: +(fk * 100).toFixed(2),               // % da banca
    stake:    +(fk * banca).toFixed(2),             // R$
    fullKelly:+(fullKelly * 100).toFixed(2),        // % Kelly cheio (para info)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Enriquece pick com odds reais + edge + Kelly
// pick deve ter: { home, away, stat, conf, modelMeta? (prob bruta) }
// ═══════════════════════════════════════════════════════════════════════════
export function enrichPickWithOdds(pick, gameOdds, banca = 0) {
  if (!gameOdds || !pick) return pick
  const stat = pick.stat
  let realOdd = null
  if (stat === 'Casa Win')     realOdd = gameOdds.home
  else if (stat === 'Empate')  realOdd = gameOdds.draw
  else if (stat === 'Fora Win') realOdd = gameOdds.away
  if (!realOdd) return pick

  // Se pick tem prob bruta (modelMeta.pHome etc) usa ela; senão usa conf/100
  const pModel = pick.modelMeta?.prob || (pick.conf / 100)
  const edgeInfo = computeEdge(pModel, realOdd)
  const kelly    = kellyStake(pModel, realOdd, banca)

  return {
    ...pick,
    real_odd:   realOdd,
    realOdd:    realOdd,
    ev_real:    edgeInfo.value,
    evReal:     edgeInfo.value,
    edge_pp:    edgeInfo.edge,
    implied_pct:edgeInfo.implied,
    has_edge:   edgeInfo.hasEdge,
    kelly_pct:  kelly.fraction,
    kelly_stake:kelly.stake,
    book:       gameOdds.bestBook || null,
  }
}
