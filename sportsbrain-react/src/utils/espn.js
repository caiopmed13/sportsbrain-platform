// ─── ESPN Public API Utilities ────────────────────────────────────────────────
// All ESPN endpoints support CORS * — safe to call from browser

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

// ── League code map ──
const SOCCER_LEAGUES = {
  'Premier League': 'eng.1',
  'La Liga':        'esp.1',
  'Bundesliga':     'ger.1',
  'Serie A':        'ita.1',
  'Ligue 1':        'fra.1',
  'Champions':      'uefa.champions',
  'Europa':         'uefa.europa',
  'Brasileirao':    'bra.1',
  'Brasileirão':    'bra.1',
  'Serie B':        'bra.2',
  'Brasileirão B':  'bra.2',
  'Série C':        'bra.3',
  'Copa do Brasil': 'bra.copa_do_brazil',
  'Libertadores':   'conmebol.libertadores',
  'Sudamericana':   'conmebol.sudamericana',
  'MLS':            'usa.1',
  'Eredivisie':     'ned.1',
  'Primeira Liga':  'por.1',
}

function guessLeagueCode(leagueStr) {
  const l = (leagueStr || '').toLowerCase()
  // Casos mais específicos primeiro (Copa do Brasil antes de Brasileirão)
  if (l.includes('copa do brasil') || l.includes('copa brasil')) return 'bra.copa_do_brazil'
  if (l.includes('série c') || l.includes('serie c')) return 'bra.3'
  if (l.includes('brasileirão b') || l.includes('brasileirao b') || l.includes('série b') || l.includes('serie b')) return 'bra.2'
  if (l.includes('brasileirão') || l.includes('brasileirao')) return 'bra.1'
  if (l.includes('libertadores')) return 'conmebol.libertadores'
  if (l.includes('sudamericana')) return 'conmebol.sudamericana'
  if (l.includes('liga argentin') || l.includes('argentine') || (l.includes('argentin') && !l.includes('copa'))) return 'arg.1'
  if (l.includes('copa argentin')) return 'arg.copa'
  // "Premier League" prefixado de país = liga local (não EPL)
  if (l.includes('belarus')) return 'blr.1'
  if (l.includes('russia')) return 'rus.1'
  if (l.includes('ukrain')) return 'ukr.1'
  if (l.includes('scott')) return 'sco.1'
  if (l.includes('turkey') || l.includes('turkish') || l.includes('super lig')) return 'tur.1'
  if (l.includes('english premier') || l === 'premier league' || l.includes('england')) return 'eng.1'
  if (l.includes('la liga') || l.includes('laliga') || (l.includes('liga') && l.includes('spain'))) return 'esp.1'
  if (l.includes('champions')) return 'uefa.champions'
  if (l.includes('europa')) return 'uefa.europa'
  if (l.includes('conference')) return 'uefa.europa_conference'
  if (l.includes('bundesliga') || l.includes('german')) return 'ger.1'
  if (l.includes('serie a') || l.includes('ital')) return 'ita.1'
  if (l.includes('ligue 1') || l.includes('fren')) return 'fra.1'
  if (l.includes('mls')) return 'usa.1'
  if (l.includes('primeira') || l.includes('portug')) return 'por.1'
  // Match exato contra o mapa (fallback)
  for (const [name, code] of Object.entries(SOCCER_LEAGUES)) {
    if (l.includes(name.toLowerCase())) return code
  }
  return 'eng.1'  // default
}

// ── Parse score robusto: aceita string, número ou objeto {value,displayValue}
function parseScore(s) {
  if (s == null) return null
  if (typeof s === 'number') return isNaN(s) ? null : s
  if (typeof s === 'string') {
    const n = parseInt(s, 10)
    return isNaN(n) ? null : n
  }
  if (typeof s === 'object') {
    const n = parseInt(s.value ?? s.displayValue ?? '', 10)
    return isNaN(n) ? null : n
  }
  return null
}

// ── In-memory cache ──
const _cache = new Map()
function cached(key, ttlMs, fn) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data)
  return fn().then(data => {
    _cache.set(key, { data, ts: Date.now() })
    return data
  })
}

// ── Normalize team name for matching ──
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/\bfc\b|\bsc\b|\bac\b|\baf\b|\bsv\b|\bcf\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function teamSimilarity(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85
  const wordsA = na.split(' '), wordsB = nb.split(' ')
  const common = wordsA.filter(w => w.length > 2 && wordsB.some(wb => wb.startsWith(w) || w.startsWith(wb)))
  return common.length / Math.max(wordsA.length, wordsB.length)
}

// ── Fetch all teams for a league ──
async function fetchTeamsList(leagueCode) {
  const url = `${ESPN_BASE}/soccer/${leagueCode}/teams?limit=100`
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`ESPN teams ${res.status}`)
  const json = await res.json()
  return (json.sports?.[0]?.leagues?.[0]?.teams || []).map(t => ({
    id:        t.team.id,
    name:      t.team.displayName,
    shortName: t.team.shortDisplayName,
    abbrev:    t.team.abbreviation,
    logo:      t.team.logos?.[0]?.href || null,
  }))
}

// ── Find team ID by name (single league) ──
async function findTeamId(teamName, leagueCode) {
  try {
    const cacheKey = `teams_${leagueCode}`
    const teams = await cached(cacheKey, 12 * 3600_000, () => fetchTeamsList(leagueCode))
    let best = null, bestScore = 0
    for (const t of teams) {
      const s = Math.max(teamSimilarity(teamName, t.name), teamSimilarity(teamName, t.shortName))
      if (s > bestScore) { bestScore = s; best = t }
    }
    if (bestScore < 0.4) return null
    return best
  } catch { return null }
}

// Ligas-torneio (copas) — o schedule delas só tem 2-4 jogos por time.
// Para forma/H2H, precisamos buscar o histórico na liga regular do time.
const CUP_LEAGUES = new Set([
  'bra.copa_do_brazil', 'bra.copa_do_nordeste', 'bra.supercopa_do_brazil',
  'conmebol.libertadores', 'conmebol.sudamericana', 'conmebol.recopa',
  'uefa.champions', 'uefa.europa', 'uefa.europa_conference',
  'arg.copa',
])

// Ligas regulares candidatas por país (ordem de preferência)
const REGULAR_LEAGUES_BY_REGION = {
  'bra': ['bra.1', 'bra.2', 'bra.3'],
  'conmebol': ['bra.1', 'arg.1', 'bra.2', 'col.1', 'chi.1', 'uru.1', 'par.1'],
  'uefa': ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'por.1', 'ned.1', 'tur.1', 'bel.1'],
  'arg': ['arg.1', 'arg.2'],
}

function regionOfLeague(leagueCode) {
  if (leagueCode.startsWith('bra.')) return 'bra'
  if (leagueCode.startsWith('conmebol.')) return 'conmebol'
  if (leagueCode.startsWith('uefa.')) return 'uefa'
  if (leagueCode.startsWith('arg.')) return 'arg'
  return null
}

// ── Find team ID com fallback multi-liga ──
// Para ligas-copa, SEMPRE busca na liga regular do time (mais histórico).
async function findTeamIdFull(teamName, primaryLeagueCode) {
  const isCup = CUP_LEAGUES.has(primaryLeagueCode)
  const region = regionOfLeague(primaryLeagueCode)
  const regular = REGULAR_LEAGUES_BY_REGION[region] || []

  // Para copas: pula a liga primária e vai direto pra liga regular
  // (schedule da copa tem poucos jogos para análise de forma)
  const searchOrder = isCup
    ? [...regular, primaryLeagueCode]       // regulares primeiro, cup como last resort
    : [primaryLeagueCode, ...regular.filter(c => c !== primaryLeagueCode)]

  for (const lg of searchOrder) {
    const t = await findTeamId(teamName, lg)
    if (t) return { team: t, leagueCode: lg }
  }
  return null
}

// ─── B1: Team Form (last N results) ──────────────────────────────────────────
// Returns array of { result: 'W'|'D'|'L', opponent, score, date }
export async function fetchTeamForm(teamName, leagueStr, n = 5) {
  const leagueCode = guessLeagueCode(leagueStr)
  const cacheKey = `form_${normalize(teamName)}_${leagueCode}`

  return cached(cacheKey, 3600_000, async () => {
    const found = await findTeamIdFull(teamName, leagueCode)
    if (!found) return null
    const { team, leagueCode: resolvedLeague } = found

    // Estratégia robusta: agrega de 3 fontes (default + ano atual + ano anterior)
    // e deduplica por event ID. Pega os N últimos por data.
    const now = new Date()
    const urls = [
      `${ESPN_BASE}/soccer/${resolvedLeague}/teams/${team.id}/schedule?limit=40`,
      `${ESPN_BASE}/soccer/${resolvedLeague}/teams/${team.id}/schedule?limit=40&season=${now.getFullYear()}`,
      `${ESPN_BASE}/soccer/${resolvedLeague}/teams/${team.id}/schedule?limit=40&season=${now.getFullYear() - 1}`,
    ]

    const eventMap = new Map()   // eventId → event (dedup)
    const results = await Promise.allSettled(urls.map(u => fetch(u).then(r => r.ok ? r.json() : null)))
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue
      for (const ev of (r.value.events || [])) {
        if (!eventMap.has(ev.id)) eventMap.set(ev.id, ev)
      }
    }

    let completed = [...eventMap.values()]
      .filter(e => e.competitions?.[0]?.status?.type?.completed)
    // Ordena por data ASCendente (mais antigo primeiro) e pega os últimos N
    completed.sort((a, b) => new Date(a.date) - new Date(b.date))
    completed = completed.slice(-n)

    return completed.map(e => {
      const comp  = e.competitions[0]
      const home  = comp.competitors.find(c => c.homeAway === 'home')
      const away  = comp.competitors.find(c => c.homeAway === 'away')
      const isHome = home?.team?.id === team.id
      const us    = isHome ? home : away
      const them  = isHome ? away : home
      const ourScore   = parseScore(us?.score)
      const theirScore = parseScore(them?.score)
      // Sem placar válido = descarta (evita enviesar com 0-0 fake)
      if (ourScore == null || theirScore == null) return null
      const result = ourScore > theirScore ? 'W' : ourScore < theirScore ? 'L' : 'D'
      return {
        result,
        opponent:   them?.team?.shortDisplayName || them?.team?.displayName || '?',
        score:      `${ourScore}-${theirScore}`,
        date:       e.date?.slice(0, 10) || '',
        isHome,
        logo:       team.logo,
      }
    }).filter(Boolean)
  })
}

// ─── B5: H2H (last encounters between two teams) ─────────────────────────────
export async function fetchH2H(homeTeam, awayTeam, leagueStr) {
  const leagueCode = guessLeagueCode(leagueStr)
  const cacheKey = `h2h_${normalize(homeTeam)}_${normalize(awayTeam)}_${leagueCode}`

  return cached(cacheKey, 3600_000, async () => {
    const [foundA, foundB] = await Promise.all([
      findTeamIdFull(homeTeam, leagueCode),
      findTeamIdFull(awayTeam, leagueCode),
    ])
    if (!foundA || !foundB) return null
    const { team: teamA, leagueCode: leagueA } = foundA
    const { team: teamB } = foundB

    // Fetch schedule de teamA agregando default + 3 temporadas
    const now = new Date()
    const urls = [
      `${ESPN_BASE}/soccer/${leagueA}/teams/${teamA.id}/schedule?limit=80`,
      `${ESPN_BASE}/soccer/${leagueA}/teams/${teamA.id}/schedule?limit=80&season=${now.getFullYear()}`,
      `${ESPN_BASE}/soccer/${leagueA}/teams/${teamA.id}/schedule?limit=80&season=${now.getFullYear() - 1}`,
      `${ESPN_BASE}/soccer/${leagueA}/teams/${teamA.id}/schedule?limit=80&season=${now.getFullYear() - 2}`,
    ]
    const eventMap = new Map()
    const results = await Promise.allSettled(urls.map(u => fetch(u).then(r => r.ok ? r.json() : null)))
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue
      for (const ev of (r.value.events || [])) {
        if (!eventMap.has(ev.id)) eventMap.set(ev.id, ev)
      }
    }

    const events = [...eventMap.values()]
      .filter(e => {
        const comp = e.competitions?.[0]
        if (!comp?.status?.type?.completed) return false
        return comp.competitors.some(c => c.team?.id === teamB.id)
      })
    events.sort((a, b) => new Date(a.date) - new Date(b.date))
    const last = events.slice(-5)

    return last.map(e => {
      const comp  = e.competitions[0]
      const a     = comp.competitors.find(c => c.team?.id === teamA.id)
      const b     = comp.competitors.find(c => c.team?.id === teamB.id)
      const scoreA = parseScore(a?.score)
      const scoreB = parseScore(b?.score)
      if (scoreA == null || scoreB == null) return null
      const winner = scoreA > scoreB ? teamA.shortName || homeTeam : scoreA < scoreB ? teamB.shortName || awayTeam : 'Empate'
      return {
        date:   e.date?.slice(0, 10) || '',
        score:  `${scoreA}-${scoreB}`,
        winner,
        homeId:  a?.homeAway === 'home' ? teamA.id : teamB.id,
        teamAId: teamA.id,
        teamBId: teamB.id,
      }
    }).filter(Boolean)
  })
}

// ─── B6: Team Roster + Injuries ──────────────────────────────────────────────
// Retorna { players: [{name, position, status}], injuries: [...] }
export async function fetchTeamInjuries(teamName, leagueStr) {
  const leagueCode = guessLeagueCode(leagueStr)
  const cacheKey = `injuries_${normalize(teamName)}_${leagueCode}`
  return cached(cacheKey, 3 * 3600_000, async () => {
    const found = await findTeamIdFull(teamName, leagueCode)
    if (!found) return null
    const { team, leagueCode: resolvedLeague } = found

    // ESPN injury endpoint
    const url = `${ESPN_BASE}/soccer/${resolvedLeague}/teams/${team.id}/injuries`
    let injuries = []
    try {
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        const items = json.items || json.injuries || []
        injuries = items.map(it => ({
          player:   it.athlete?.displayName || it.name || '',
          position: it.athlete?.position?.abbreviation || '',
          status:   it.status || it.type?.description || 'questionable',
          detail:   it.details?.type || it.shortComment || '',
        })).filter(i => i.player)
      }
    } catch {}

    return {
      teamId: team.id,
      teamName: team.name,
      injuries,
      injuryCount: injuries.length,
    }
  })
}

// ─── B7: Team statistics summary (rank, GF/GA total, ELO-like) ─────────────
export async function fetchTeamOverview(teamName, leagueStr) {
  const leagueCode = guessLeagueCode(leagueStr)
  const cacheKey = `overview_${normalize(teamName)}_${leagueCode}`
  return cached(cacheKey, 6 * 3600_000, async () => {
    const found = await findTeamIdFull(teamName, leagueCode)
    if (!found) return null
    const { team, leagueCode: resolvedLeague } = found

    // ESPN standings / team record endpoint
    try {
      const url = `${ESPN_BASE}/soccer/${resolvedLeague}/teams/${team.id}`
      const res = await fetch(url)
      if (!res.ok) return null
      const json = await res.json()
      const t = json.team || {}
      const rec = t.record?.items?.[0]?.stats || []
      const get = (key) => rec.find(s => s.name === key)?.value ?? null

      return {
        teamId:    team.id,
        teamName:  team.name,
        logo:      team.logo,
        rank:      t.rank ?? null,
        standing:  t.standingSummary || '',
        played:    get('gamesPlayed'),
        wins:      get('wins'),
        draws:     get('ties'),
        losses:    get('losses'),
        gf:        get('pointsFor'),
        ga:        get('pointsAgainst'),
        points:    get('points'),
      }
    } catch { return null }
  })
}

// ─── NBA Player Recent Stats (B4) ────────────────────────────────────────────
export async function fetchNBAPlayerStats(playerName) {
  const cacheKey = `nba_stats_${normalize(playerName)}`
  return cached(cacheKey, 1800_000, async () => {
    // Use ESPN athlete search
    const search = encodeURIComponent(playerName.split(' ').slice(-1)[0]) // last name
    const url = `${ESPN_BASE}/basketball/nba/athletes?limit=5&search=${search}`
    const res  = await fetch(url)
    if (!res.ok) throw new Error(`ESPN athletes ${res.status}`)
    const json = await res.json()
    const athletes = json.athletes || []

    // Find best match
    let best = null, bestScore = 0
    for (const a of athletes) {
      const s = teamSimilarity(playerName, a.fullName || a.displayName || '')
      if (s > bestScore) { bestScore = s; best = a }
    }
    if (!best || bestScore < 0.4) return null

    // Fetch athlete gamelog
    const logUrl = `${ESPN_BASE}/basketball/nba/athletes/${best.id}/gamelog`
    const logRes  = await fetch(logUrl)
    if (!logRes.ok) return null
    const logJson = await logRes.json()

    // Extract last 5 and last 10 averages
    const stats = logJson.events?.labelsMap ? parseGameLog(logJson) : null
    return { id: best.id, name: best.fullName, stats }
  })
}

function parseGameLog(logJson) {
  // ESPN gamelog has a complex structure — extract pts/reb/ast + min + home/away + date
  try {
    const labels = logJson.labelsMap || {}
    const findIdx = (name) => Object.entries(labels).find(([,v]) => v === name)?.[0]
    const ptsIdx = findIdx('PTS')
    const rebIdx = findIdx('REB')
    const astIdx = findIdx('AST')
    const minIdx = findIdx('MIN')

    const rows = logJson.seasonTypes
      ?.find(t => t.type === 2)  // regular season
      ?.categories?.[0]
      ?.events || []

    const games = rows.slice(-15).map(row => {
      const evt = logJson.events?.[row.eventId] || row
      // ESPN encodes home/away via '@' prefix in opponent abbreviation or homeTeamScore/awayTeamScore
      const opp   = row.opponent?.abbreviation || row.opponent?.displayName || ''
      const away  = /^@/.test(opp) || row.atVs === '@' || row.homeAwaySymbol === '@'
      const dateStr = evt.gameDate || evt.date || row.gameDate || null
      return {
        pts: parseFloat(row.stats?.[ptsIdx] ?? 0),
        reb: parseFloat(row.stats?.[rebIdx] ?? 0),
        ast: parseFloat(row.stats?.[astIdx] ?? 0),
        min: minIdx != null ? parseFloat(row.stats?.[minIdx] ?? 0) : null,
        home: !away,
        date: dateStr ? new Date(dateStr).getTime() : null,
      }
    }).filter(g => !isNaN(g.pts))

    const avg = (arr, key) => {
      const v = arr.filter(g => g[key] != null && !isNaN(g[key]))
      return v.length ? +(v.reduce((s, g) => s + g[key], 0) / v.length).toFixed(1) : null
    }
    const last5  = games.slice(-5)
    const last10 = games.slice(-10)
    const homeGames = games.filter(g => g.home)
    const awayGames = games.filter(g => !g.home)

    // Dias desde o último jogo (rest indicator)
    const dates = games.filter(g => g.date).map(g => g.date).sort()
    const lastGameDate = dates.length ? dates[dates.length - 1] : null
    const daysSinceLast = lastGameDate ? Math.round((Date.now() - lastGameDate) / 86400000) : null

    return {
      l5:  { pts: avg(last5,  'pts'), reb: avg(last5,  'reb'), ast: avg(last5,  'ast'), min: avg(last5, 'min') },
      l10: { pts: avg(last10, 'pts'), reb: avg(last10, 'reb'), ast: avg(last10, 'ast'), min: avg(last10, 'min') },
      home: { pts: avg(homeGames, 'pts'), reb: avg(homeGames, 'reb'), ast: avg(homeGames, 'ast'), sample: homeGames.length },
      away: { pts: avg(awayGames, 'pts'), reb: avg(awayGames, 'reb'), ast: avg(awayGames, 'ast'), sample: awayGames.length },
      lastGameDate,
      daysSinceLast,
      games: last10,
    }
  } catch { return null }
}

// ─── NBA Injuries (lista dinâmica OUT/DTD/QUESTIONABLE) ──────────────────────
export async function fetchNBAInjuries() {
  return cached('nba_injuries_v1', 15 * 60 * 1000, async () => {
    try {
      const url = `${ESPN_BASE}/basketball/nba/injuries`
      const res = await fetch(url)
      if (!res.ok) return { out: [], doubtful: [], questionable: [] }
      const json = await res.json()
      const out = [], doubtful = [], questionable = []
      const teams = json.injuries || []
      teams.forEach(t => {
        (t.injuries || []).forEach(inj => {
          const name = inj.athlete?.displayName || inj.athlete?.fullName
          const status = (inj.status || '').toLowerCase()
          if (!name) return
          if (status.includes('out') || status.includes('suspended')) out.push(name)
          else if (status.includes('doubtful')) doubtful.push(name)
          else if (status.includes('questionable') || status.includes('day-to-day')) questionable.push(name)
        })
      })
      return { out, doubtful, questionable, fetchedAt: Date.now() }
    } catch { return { out: [], doubtful: [], questionable: [] } }
  })
}
