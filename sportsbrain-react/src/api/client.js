// ═══ SportsBrain — API Client ═══
// Centraliza todas as chamadas fetch com fallback Worker → Backend próprio

const WORKER_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'
const LOCAL_BASE  = 'http://localhost:8001'
const ODDS_API_KEY = '' // Setar via env ou settings

let _activeBase = WORKER_BASE
let _workerOk   = false

// ── Utilitários ──────────────────────────────────────────────────────────────

async function get(path, opts = {}) {
  const { ms = 8000, base = _activeBase } = opts
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Health check / seleção de base ──────────────────────────────────────────

export async function checkHealth() {
  // Tenta Worker primeiro
  try {
    const res = await fetch(`${WORKER_BASE}/health`, { signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      _activeBase = WORKER_BASE
      _workerOk = true
      return { ok: true, source: 'worker', label: '🧠 Engine IA' }
    }
  } catch (_) {}

  // Fallback: backend local
  try {
    const res = await fetch(`${LOCAL_BASE}/health`, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      _activeBase = LOCAL_BASE
      _workerOk = false
      return { ok: true, source: 'local', label: '🖥 API Local' }
    }
  } catch (_) {}

  return { ok: false, source: null, label: '⚠ Offline' }
}

export function getActiveBase() { return _activeBase }
export function isWorkerOk() { return _workerOk }

// ══ SB Odds Engine v2 — proprietary analytics ═════════════════════════════
export async function sbOddsAll(sport = null)      { const s = sport ? `?sport=${sport}` : ''; return get('/v1/odds/all' + s) }
export async function sbOddsValue(sport, minEdge = 1.5) { const qs = new URLSearchParams({ ...(sport&&{sport}), min_edge: minEdge }); return get('/v1/odds/value?' + qs) }
export async function sbOddsArbitrage(sport)       { return get('/v1/odds/arbitrage' + (sport ? `?sport=${sport}` : '')) }
export async function sbOddsMiddles(sport)         { return get('/v1/odds/middles' + (sport ? `?sport=${sport}` : '')) }
export async function sbOddsHold(sport)            { return get('/v1/odds/hold' + (sport ? `?sport=${sport}` : '')) }
export async function sbOddsNoVig(sport)           { return get('/v1/odds/no_vig' + (sport ? `?sport=${sport}` : '')) }
export async function sbOddsWidest(sport)          { return get('/v1/odds/widest' + (sport ? `?sport=${sport}` : '')) }
export async function sbOddsSteam(eventId, market = 'h2h', outcome = 'home') { return get(`/v1/odds/steam/${encodeURIComponent(eventId)}?market=${market}&outcome=${outcome}`) }
export async function sbOddsMovement(eventId, market = 'h2h', outcome = 'home', hours = 24) { return get(`/v1/odds/movement/${encodeURIComponent(eventId)}?market=${market}&outcome=${outcome}&hours=${hours}`) }
export async function sbContext(eventId)           { return get('/v1/context/' + encodeURIComponent(eventId)) }
export async function sbIntelligencePicksToday(max = 20) { return get(`/v1/intelligence/picks/today?max=${max}`) }
// Phase 5: filtro rigoroso server-side (edge/vig/books + Kelly ajustado)
export async function sbSelectionFilter(picks, { banca = 1000, kellyFraction = 0.25 } = {}) {
  return postJson('/v1/admin/ml/selection/filter', { picks, banca, kelly_fraction: kellyFraction })
}
// Phase 2/3: qualidade (Brier, calibração, Platt scaling)
export async function sbMLBaseline({ sport, market } = {}, key) {
  const qs = new URLSearchParams({ ...(sport && { sport }), ...(market && { market }) })
  const res = await fetch(`${_activeBase}/v1/admin/ml/quality/baseline?${qs}`, {
    headers: { 'X-Admin-Key': key }, signal: AbortSignal.timeout(10000),
  })
  return res.json()
}
export async function sbMLCalibration({ sport, market, bins = 10 } = {}, key) {
  const qs = new URLSearchParams({ ...(sport && { sport }), ...(market && { market }), bins })
  const res = await fetch(`${_activeBase}/v1/admin/ml/quality/calibration?${qs}`, {
    headers: { 'X-Admin-Key': key }, signal: AbortSignal.timeout(10000),
  })
  return res.json()
}
export async function sbBacktest({ strategy = 'value', minEdge = 2, sport, days = 30 } = {}) {
  const qs = new URLSearchParams({ strategy, min_edge: minEdge, days, ...(sport && { sport }) })
  return get('/v1/backtest?' + qs)
}

// Portfolio (requires X-SB-Key header; use sb_sandbox_ prefix for dev)
async function postJson(path, body, { key } = {}) {
  const res = await fetch(`${_activeBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key && { 'X-SB-Key': key }) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
async function patchJson(path, body, { key } = {}) {
  const res = await fetch(`${_activeBase}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(key && { 'X-SB-Key': key }) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
export async function sbPortfolioAdd(pick, key)        { return postJson('/v1/portfolio/pick', pick, { key }) }
export async function sbPortfolioList(key)             {
  const res = await fetch(`${_activeBase}/v1/portfolio/picks`, { headers: { 'X-SB-Key': key } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
export async function sbPortfolioStats(key)            {
  const res = await fetch(`${_activeBase}/v1/portfolio/stats`, { headers: { 'X-SB-Key': key } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
export async function sbPortfolioUpdate(id, patch, key) { return patchJson(`/v1/portfolio/pick/${id}`, patch, { key }) }

// BYO-key AI Copilot
export async function sbAiCopilot({ provider, api_key, question, event_id, context }) {
  return postJson('/v1/ai/copilot', { provider, api_key, question, event_id, context })
}

// ── ESPN Direct — Dados reais de jogos ───────────────────────────────────────

const ESPN_SOCCER_LEAGUES = [
  // ── BRASIL ─────────────────────────────────────────────────────────────
  { slug:'bra.1',                  name:'Brasileirão A',      country:'Brazil' },
  { slug:'bra.2',                  name:'Brasileirão B',      country:'Brazil' },
  { slug:'bra.3',                  name:'Série C',            country:'Brazil' },
  { slug:'bra.copa_do_brazil',     name:'Copa do Brasil',     country:'Brazil' },
  { slug:'bra.copa_do_nordeste',   name:'Copa do Nordeste',   country:'Brazil' },
  { slug:'bra.supercopa_do_brazil',name:'Supercopa do Brasil',country:'Brazil' },
  { slug:'bra.camp.paulista',      name:'Paulistão',          country:'Brazil' },
  { slug:'bra.camp.carioca',       name:'Campeonato Carioca', country:'Brazil' },
  { slug:'bra.camp.mineiro',       name:'Campeonato Mineiro', country:'Brazil' },
  { slug:'bra.camp.gaucho',        name:'Campeonato Gaúcho',  country:'Brazil' },
  // ── AMÉRICA DO SUL ─────────────────────────────────────────────────────
  { slug:'conmebol.libertadores',  name:'Copa Libertadores',  country:'S. America' },
  { slug:'conmebol.sudamericana',  name:'Copa Sudamericana',  country:'S. America' },
  { slug:'conmebol.america',       name:'Copa América',       country:'S. America' },
  { slug:'conmebol.recopa',        name:'Recopa Sulamericana',country:'S. America' },
  // ── EUROPA TOP 5 ───────────────────────────────────────────────────────
  { slug:'eng.1',                  name:'Premier League',     country:'England' },
  { slug:'esp.1',                  name:'La Liga',            country:'Spain' },
  { slug:'ger.1',                  name:'Bundesliga',         country:'Germany' },
  { slug:'ita.1',                  name:'Serie A',            country:'Italy' },
  { slug:'fra.1',                  name:'Ligue 1',            country:'France' },
  // ── OUTROS ─────────────────────────────────────────────────────────────
  { slug:'arg.1',                  name:'Liga Argentina',     country:'Argentina' },
  { slug:'arg.copa',               name:'Copa Argentina',     country:'Argentina' },
  { slug:'por.1',                  name:'Primeira Liga',      country:'Portugal' },
  { slug:'usa.1',                  name:'MLS',                country:'USA' },
  { slug:'mex.1',                  name:'Liga MX',            country:'Mexico' },
  { slug:'uefa.champions',         name:'Champions League',   country:'UEFA' },
  { slug:'uefa.europa',            name:'Europa League',      country:'UEFA' },
  { slug:'uefa.europa_conference', name:'Conference League',  country:'UEFA' },
]

// Slugs que usam fallback "sem data" quando não há jogos na janela normal.
// IMPORTANTE: mesmo com fallback, filtramos por data real do evento (apenas hoje).
const ESPN_FALLBACK_NODATE = new Set(['bra.1','bra.2','bra.3'])

// Ligas destacadas (Bet365-like): sempre aparecem no topo se houver jogos
const FEATURED_LEAGUE_IDS = new Set([
  'uefa.champions','uefa.europa','uefa.europa_conference',
  'eng.1','esp.1','ger.1','ita.1','fra.1',
  'conmebol.libertadores','conmebol.sudamericana',
  'bra.1','bra.copa_do_brazil',
])

function _espnStatus(status) {
  const state  = status?.type?.state || 'pre'
  const name   = status?.type?.name  || ''
  const detail = (status?.type?.detail || '').toLowerCase()
  if (state === 'post' || status?.type?.completed) return 'FT'
  if (detail.includes('halftime') || name.includes('HALFTIME')) return 'HT'
  if (state === 'in') return 'LIVE'
  return 'NS'
}

function _espnNormalize(ev, league, sport) {
  const comp  = ev.competitions?.[0]
  const home  = comp?.competitors?.find(c => c.homeAway === 'home')
  const away  = comp?.competitors?.find(c => c.homeAway === 'away')
  const st    = _espnStatus(ev.status)
  const isLive = st === 'LIVE', isHT = st === 'HT', isFin = st === 'FT', isPre = st === 'NS'
  const clock  = ev.status?.displayClock?.replace("'","") || null
  return {
    id:          ev.id,
    sport,
    home_team:   home?.team?.displayName || home?.team?.name || '—',
    away_team:   away?.team?.displayName || away?.team?.name || '—',
    league:      { name: league.name, id: league.slug },
    league_name: league.name,
    country:     league.country,
    date:        ev.date,
    date_utc:    ev.date,
    status:      st,
    status_meta: {
      isLive, isHT, isFin, isPre,
      isActive: isLive || isHT,
      label: isFin ? 'Encerrado' : isLive ? 'Ao Vivo' : isHT ? 'Intervalo' : 'Agendado',
    },
    score: {
      home: home?.score != null ? parseInt(home.score, 10) : null,
      away: away?.score != null ? parseInt(away.score, 10) : null,
    },
    minute:  isLive ? clock : null,
    elapsed: isLive ? parseInt(clock) || null : null,
  }
}

// Calcula data+N dias no formato YYYYMMDD
function _dateOffset(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0,10).replace(/-/g,'')
}

async function _fetchESPNLeague(league, sport, date) {
  try {
    const path = sport === 'basketball' ? 'basketball/nba' : `soccer/${league.slug}`
    const base = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`

    // Janela de 3 dias: hoje até hoje+2
    const query = date ? `?dates=${date.replace(/-/g,'')}-${_dateOffset(date, 2)}` : ''
    const res   = await fetch(`${base}${query}`, { signal: AbortSignal.timeout(7000) })
    if (!res.ok) return []
    const data  = await res.json()
    let events  = (data.events || []).map(ev => _espnNormalize(ev, league, sport))

    // Fallback: se retornou 0 eventos e a liga suporta "no-date",
    // busca rodada atual do ESPN e filtra apenas jogos realmente DENTRO da janela.
    // Sem esse filtro de data o ESPN retornaria a próxima rodada inteira,
    // poluindo a UI com jogos que não são de hoje.
    if (events.length === 0 && date && ESPN_FALLBACK_NODATE.has(league.slug)) {
      try {
        const r2   = await fetch(base, { signal: AbortSignal.timeout(6000) })
        if (r2.ok) {
          const d2 = await r2.json()
          // Janela aceitável: hoje até hoje+2 (mesma lógica do query normal)
          const startMs = new Date(date + 'T00:00:00Z').getTime()
          const endMs   = startMs + 3 * 24 * 60 * 60 * 1000
          events = (d2.events || [])
            .filter(ev => {
              if ((ev.status?.type?.state || 'pre') !== 'pre') return false
              const evMs = new Date(ev.date).getTime()
              return !isNaN(evMs) && evMs >= startMs && evMs < endMs
            })
            .map(ev => _espnNormalize(ev, league, sport))
        }
      } catch { /* ignora */ }
    }

    return events
  } catch { return [] }
}

// ── Worker Football Games — API-Football via Worker (inclui Copa do Brasil) ──
// O Worker em /v1/football/games/today usa API-Football (todas as ligas) ou
// football-data.org como fallback. Inclui Copa do Brasil, Série A, B, C e mais.

function _workerGameToMatch(g) {
  // Normaliza formato do Worker para o mesmo padrão que ESPN retorna
  const st = g.status || 'scheduled'
  const isFin  = st === 'ft' || st === 'finished'
  const isLive = st === 'live' || st === '1h' || st === '2h'
  const isHT   = st === 'ht'
  const isPre  = !isFin && !isLive && !isHT
  return {
    id:          g.id || '',
    sport:       'football',
    home_team:   g.home_team || g.home || '—',
    away_team:   g.away_team || g.away || '—',
    league:      { name: g.league || g.competition || 'Futebol', id: g.competition_id || '' },
    league_name: g.league || g.competition || 'Futebol',
    country:     g.country || '',
    date:        g.kickoff || g.date_utc || null,
    date_utc:    g.kickoff || g.date_utc || null,
    status:      isFin ? 'FT' : isLive ? 'LIVE' : isHT ? 'HT' : 'NS',
    status_meta: { isLive, isHT, isFin, isPre, isActive: isLive||isHT,
      label: isFin ? 'Encerrado' : isLive ? 'Ao Vivo' : isHT ? 'Intervalo' : 'Agendado' },
    score: g.score || null,
    minute: null, elapsed: null,
    _source: 'worker',
  }
}

// ── API-Football direto (via api-sports.io key nas Settings) ─────────────────
// Chave grátis em dashboard.api-football.com (100 req/dia)
// Inclui Copa do Brasil, Série A, Série B, Série C e +700 ligas
// Cache de 60 min no sessionStorage para economizar requests

const APIF_CACHE_KEY = 'sb_apif_fixtures_v1'
const APIF_CACHE_TTL = 60 * 60 * 1000  // 60 minutos

function _getApifKey() {
  try {
    const s = JSON.parse(localStorage.getItem('sb_settings_v1') || '{}')
    return s.apiFootballKey?.trim() || ''
  } catch { return '' }
}

async function _fetchApifDirect(date) {
  const key = _getApifKey()
  if (!key) return []
  try {
    const tz = 'America/Sao_Paulo'
    const d  = date || new Date().toLocaleDateString('sv-SE', { timeZone: tz })

    // ── Cache: evita consumir requests desnecessários ─────────────────────
    const cacheRaw = sessionStorage.getItem(APIF_CACHE_KEY)
    if (cacheRaw) {
      try {
        const c = JSON.parse(cacheRaw)
        if (c?.date === d && c?.ts && Date.now() - c.ts < APIF_CACHE_TTL) {
          return c.fixtures || []
        }
      } catch {}
    }

    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${d}&timezone=${encodeURIComponent(tz)}`,
      {
        headers: { 'x-apisports-key': key },
        signal: AbortSignal.timeout(10000),
      }
    )
    if (!res.ok) return []
    const json = await res.json()
    const fixtures = json?.response || []
    if (!fixtures.length) return []

    const PRE_STATUS = new Set(['NS', 'TBD', 'PST'])
    const result = fixtures
      .filter(f => PRE_STATUS.has(f.fixture?.status?.short))
      .map(f => ({
        id:          String(f.fixture.id),
        sport:       'football',
        home_team:   f.teams.home.name,
        away_team:   f.teams.away.name,
        league:      { name: f.league.name, id: String(f.league.id) },
        league_name: f.league.name,
        country:     f.league.country || '',
        date:        f.fixture.date,
        date_utc:    f.fixture.date,
        status:      'NS',
        status_meta: { isLive:false, isHT:false, isFin:false, isPre:true, isActive:false,
          label: 'Agendado' },
        score: null, minute: null, elapsed: null,
        _source: 'api-football',
      }))

    // Salva no cache
    try {
      sessionStorage.setItem(APIF_CACHE_KEY, JSON.stringify({ date: d, fixtures: result, ts: Date.now() }))
    } catch {}

    return result
  } catch { return [] }
}

async function _fetchWorkerGames(date) {
  try {
    const path = date ? `/v1/football/games/${date}` : '/v1/football/games/today'
    const r    = await fetch(`${_activeBase}${path}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return []
    const json = await r.json()
    const games = json?.data?.games || json?.games || []
    if (!games.length) return []
    // Só jogos ainda não iniciados (inclui 'scheduled' e qualquer outro pre-game)
    return games
      .filter(g => {
        const s = (g.status || 'scheduled').toLowerCase()
        return s === 'scheduled' || s === 'ns' || s === 'postponed' || s === 'tbd'
      })
      .map(_workerGameToMatch)
  } catch { return [] }
}

// ── Matches / Jogos ──────────────────────────────────────────────────────────

export async function fetchMatches({ date, sport, league, status, page = 1, per_page = 200 } = {}) {
  const nbaLeague = { slug:'nba', name:'NBA', country:'USA' }
  const fetchSoccer     = !sport || sport === 'football'
  const fetchBasketball = !sport || sport === 'basketball'

  const tasks = [
    ...(fetchSoccer     ? [_fetchApifDirect(date)]    : []),  // API-Football direto — PRIMEIRO (inclui Copa do Brasil e ligas não ESPN)
    ...(fetchSoccer     ? ESPN_SOCCER_LEAGUES.map(lg => _fetchESPNLeague(lg, 'football', date)) : []),
    ...(fetchSoccer     ? [_fetchWorkerGames(date)]   : []),  // Worker/TheSportsDB fallback
    ...(fetchBasketball ? [_fetchESPNLeague(nbaLeague, 'basketball', date)] : []),
  ]

  const settled = await Promise.allSettled(tasks)
  let all = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value)

  // Deduplica por nome de jogo (pode vir duplicado de endpoints diferentes)
  const seen = new Set()
  all = all.filter(g => {
    const key = `${g.home_team}|${g.away_team}|${g.league_name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (league) all = all.filter(g => g.league?.name === league || g.league?.id === league)
  if (status) {
    const s = status.toUpperCase()
    all = all.filter(g => g.status === s)
  }

  // ── Validação de data em fuso BR: só mostra jogos do dia pedido (+ amanhã para UTC offset)
  //    Jogo às 22h Brasília = 01h UTC do dia seguinte → aceitamos date e date+1 em UTC.
  //    Mas comparamos pelo horário em Brasília para evitar poluir com jogos de 2 dias à frente.
  if (date) {
    const toBR = (d) => {
      try { return new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) }
      catch { return '' }
    }
    all = all.filter(g => {
      if (!g.date) return true
      const gameDateBR = toBR(g.date)
      if (!gameDateBR) return true
      // Aceita o dia pedido ou o próximo (jogos noturnos cruzam meia-noite UTC)
      const nextDate = new Date(date + 'T12:00:00').toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      // nextDate = date+1 in BR. Para calcular: incrementa 1 dia
      const d1 = new Date(date); d1.setDate(d1.getDate() + 1)
      const d1str = d1.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      return gameDateBR === date || gameDateBR === d1str
    })
  }

  // ── Ordenação: ligas destacadas (tipo Bet365) primeiro, depois por horário
  const featRank = (g) => FEATURED_LEAGUE_IDS.has(g.league?.id) ? 0 : 1
  all.sort((a, b) => {
    const fa = featRank(a), fb = featRank(b)
    if (fa !== fb) return fa - fb
    const ta = a.date ? new Date(a.date).getTime() : Infinity
    const tb = b.date ? new Date(b.date).getTime() : Infinity
    return ta - tb
  })

  const offset = (page - 1) * per_page
  return { matches: all.slice(offset, offset + per_page), total: all.length, source: 'espn' }
}

export async function fetchMatch(id) {
  return get(`/v1/matches/${id}`)
}

export async function fetchH2H(id) {
  return get(`/v1/matches/${id}/head2head`)
}

export async function fetchLive() {
  const res  = await fetchMatches({})
  const live = (res.matches || []).filter(g => g.status_meta?.isLive || g.status_meta?.isHT)
  return { games: live, total: live.length, source: 'espn' }
}

// ── Analytics ────────────────────────────────────────────────────────────────

export async function fetchConfidence() {
  return get('/v1/analytics/confidence')
}

export async function fetchHtSignals() {
  return get('/v1/analytics/ht-signals')
}

export async function fetchTrends() {
  return get('/v1/analytics/trends')
}

export async function fetchPredictions() {
  return get('/v1/analytics/predictions')
}

// ── Calibração ───────────────────────────────────────────────────────────────

export async function fetchCalibrationFactors() {
  return get('/v1/calibration/factors')
}

// ── NBA Props (BallDontLie) ───────────────────────────────────────────────────

export async function fetchPlayerBoxscores(name) {
  return get(`/v1/players/${encodeURIComponent(name)}/boxscores`)
}

export async function fetchPropsRadarSequence(name, prop) {
  const params = new URLSearchParams({ player: name, prop })
  return get(`/v1/basketball/propsradar/sequence?${params}`)
}

export async function fetchNbaMatchupReal(team) {
  return get(`/v1/basketball/matchup/${encodeURIComponent(team)}/real`)
}

// ── Futebol Props (ESPN) ──────────────────────────────────────────────────────

export async function fetchFootballHtStats(eventId, league = 'eng.1') {
  return get(`/v1/football/match/${eventId}/ht-stats?league=${league}`)
}

// ── The Odds API ──────────────────────────────────────────────────────────────

export async function fetchOddsApi(sportKey, regions = 'eu', markets = 'h2h') {
  if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY não configurada')
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=decimal`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Odds API: HTTP ${res.status}`)
  return res.json()
}

// ── Standings / Tabelas ───────────────────────────────────────────────────────

export async function fetchStandings(code) {
  return get(`/v1/competitions/${code}/standings`)
}

export async function fetchScorers(code) {
  return get(`/v1/competitions/${code}/scorers`)
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function search(q, type = '') {
  const params = new URLSearchParams({ q })
  if (type) params.set('type', type)
  return get(`/v1/search?${params}`)
}

// ── Value / CLV ───────────────────────────────────────────────────────────────

export async function fetchValueHistory(matchId) {
  return get(`/v1/value/history?match_id=${encodeURIComponent(matchId)}&limit=60`)
}

export async function postValueHistory(body) {
  return fetch(`${_activeBase}/v1/value/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: timeout(5000),
  }).then((r) => r.json())
}

// ── Team stats (histórico real do D1) ────────────────────────────────────────
// Retorna médias reais calculadas dos jogos armazenados no banco.
// Se não houver dados suficientes, o Worker retorna estimativas da liga.
// homeAway: 'home' | 'away' | 'all'
export async function fetchTeamStats(teamName, sport = 'football', homeAway = 'all') {
  if (!teamName) return null
  try {
    const enc = encodeURIComponent(teamName)
    const data = await get(`/v1/football/team/${enc}/stats?home_away=${homeAway}&sport=${sport}`, { ms: 5000 })
    return data?.data || data || null
  } catch (_) {
    return null
  }
}

export async function fetchBkTeamStats(teamName) {
  if (!teamName) return null
  try {
    const enc = encodeURIComponent(teamName)
    const data = await get(`/v1/basketball/team/${enc}/stats`, { ms: 5000 })
    return data?.data || data || null
  } catch (_) {
    return null
  }
}

// ── Tips / Palpites ───────────────────────────────────────────────────────────

export async function fetchTipsBatch(matchIds) {
  return fetch(`${_activeBase}/v1/tips/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ match_ids: matchIds }),
    signal: timeout(30000),
  }).then((r) => r.json())
}

// ── Players unavailable ───────────────────────────────────────────────────────

export async function fetchUnavailablePlayers(sport = 'basketball') {
  return get(`/v1/players/unavailable?sport=${sport}`)
}

// ── Match Detail (SportsBrain proprietary: lineups + weather + xA/PPDA) ─────

export async function fetchMatchDetailByTeams(home, away, date) {
  if (!home || !away) return null
  try {
    const params = new URLSearchParams({ home, away })
    if (date) params.set('date', date)
    const search = await get(`/v1/match/search?${params}`, { ms: 5000 })
    const matches = search?.data?.matches || []
    if (!matches.length) return null
    const matchId = matches[0].match_id
    const detail = await get(`/v1/match/${encodeURIComponent(matchId)}/detail`, { ms: 7000 })
    return detail?.data || null
  } catch { return null }
}

export async function fetchLineups(matchId) {
  try { return (await get(`/v1/lineups/${encodeURIComponent(matchId)}`))?.data || null }
  catch { return null }
}

export async function fetchWeather(matchId) {
  try { return (await get(`/v1/weather/${encodeURIComponent(matchId)}`))?.data || null }
  catch { return null }
}

export async function fetchBriefing(home, away, { league, date } = {}) {
  if (!home || !away) return null
  try {
    const params = new URLSearchParams()
    if (league) params.set('league', league)
    if (date) params.set('date', date)
    const qs = params.toString() ? `?${params}` : ''
    const res = await get(`/v1/briefing/${encodeURIComponent(home)}/${encodeURIComponent(away)}${qs}`, { ms: 8000 })
    return res?.data || null
  } catch { return null }
}

// ── xG rolling ───────────────────────────────────────────────────────────────
export async function fetchXG(team, { league, season } = {}) {
  if (!team) return null
  try {
    const p = new URLSearchParams({ team })
    if (league) p.set('league', league)
    if (season) p.set('season', season)
    const r = await get(`/v1/xg?${p}`, { ms: 6000 })
    return r?.data || null
  } catch { return null }
}

// ── Referee stats ────────────────────────────────────────────────────────────
export async function fetchRefereeStats(name) {
  if (!name) return null
  try {
    const r = await get(`/v1/referee/${encodeURIComponent(name)}/stats`, { ms: 6000 })
    return r?.data || null
  } catch { return null }
}

// ── Meta ─────────────────────────────────────────────────────────────────────

export async function fetchMetaLeagues() {
  return get('/v1/meta/leagues')
}

export async function fetchMetaSports() {
  return get('/v1/meta/sports')
}
