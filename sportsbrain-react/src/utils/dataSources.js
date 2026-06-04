// ═══════════════════════════════════════════════════════════════════════════
// Data Sources — fecha os gaps de dados vs. concorrentes (SportMonks, FotMob)
// ═══════════════════════════════════════════════════════════════════════════
// Fontes integradas:
//   · Understat (xG/xA top-5 ligas europeias + RPL)  — via CORS-friendly proxy ou Worker
//   · ESPN athletes endpoint (stats individuais de jogadores — existe e não usávamos)
//   · ESPN event details (árbitro, cartões totais do jogo)
//   · Open-Meteo (clima por lat/lon — 100% grátis, sem API key)
//   · ESPN team roster (lineups provável com posições)
//
// Todas as funções são CORS-safe quando possível; Understat precisa de proxy.
// ═══════════════════════════════════════════════════════════════════════════

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'

// Cache em memória simples (10 min default)
const _cache = new Map()
function cached(key, ttlMs, fn) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data)
  return fn().then(data => {
    _cache.set(key, { data, ts: Date.now() })
    return data
  }).catch(() => null)
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Understat xG/xA (top-5 + RPL)
// ═══════════════════════════════════════════════════════════════════════════
// Understat expõe HTML com JSON embutido em <script> var teamsData = JSON.parse('...')
// Para browser direto: não tem CORS. Solução: usamos o Worker como proxy.
// O Worker adiciona /v1/xg?team=X&league=Y devolvendo xG, xA, xPTS.
//
// Ligas suportadas: EPL, La Liga, Bundesliga, Serie A, Ligue 1, RPL
// ═══════════════════════════════════════════════════════════════════════════

const UNDERSTAT_SUPPORTED = new Set([
  'premier league', 'la liga', 'bundesliga', 'serie a', 'ligue 1',
  'russian premier league', 'rpl',
])

export async function fetchXG(teamName, leagueStr) {
  const lg = (leagueStr || '').toLowerCase()
  const supported = [...UNDERSTAT_SUPPORTED].some(s => lg.includes(s))
  if (!supported) return null

  const key = `xg_${teamName}_${leagueStr}`.toLowerCase()
  return cached(key, 6 * 3600_000, async () => {
    // Usamos o Worker como proxy (endpoint a ser criado em sportsbrain-api)
    try {
      const url = `https://sportsbrain-api.sportsbrain-api.workers.dev/v1/xg?team=${encodeURIComponent(teamName)}&league=${encodeURIComponent(leagueStr)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) return null
      const json = await res.json()
      if (!json?.data) return null
      return {
        xg:       json.data.xg ?? null,          // xG total da temporada
        xga:      json.data.xga ?? null,         // xG contra
        xg_per90: json.data.xg_per90 ?? null,
        xga_per90:json.data.xga_per90 ?? null,
        xpts:     json.data.xpts ?? null,        // expected points
        goals:    json.data.goals ?? null,
        npxg:     json.data.npxg ?? null,        // non-penalty xG
        games:    json.data.games ?? null,
        source:   'understat',
      }
    } catch { return null }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ESPN Athletes — stats individuais (TOP 5 scorers do time)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoint: /soccer/:league/teams/:id/statistics devolve leaders por categoria.
// Vantagem: já temos o teamId resolvido via findTeamIdFull do espn.js.
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchTopScorers(teamId, leagueCode) {
  if (!teamId || !leagueCode) return null
  const key = `scorers_${teamId}_${leagueCode}`
  return cached(key, 6 * 3600_000, async () => {
    try {
      const url = `${ESPN_BASE}/soccer/${leagueCode}/teams/${teamId}?enable=roster,stats`
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) return null
      const json = await res.json()

      const roster = json?.team?.athletes || json?.roster?.entries || []
      const leaders = json?.team?.record?.items || []
      const scorerLeaders = (json?.team?.leaders || [])
        .find(l => (l.name || '').toLowerCase().includes('goals'))

      const topScorers = (scorerLeaders?.leaders || []).slice(0, 5).map(l => ({
        player: l.athlete?.displayName || l.displayName || '',
        position: l.athlete?.position?.abbreviation || '',
        goals: +(l.value || 0),
        jersey: l.athlete?.jersey || '',
      })).filter(s => s.player)

      // Fallback: top 5 do roster por jogos jogados
      const rosterTop = roster.slice(0, 5).map(e => {
        const a = e.athlete || e
        return {
          player: a.displayName || a.fullName || '',
          position: a.position?.abbreviation || '',
          jersey: a.jersey || '',
        }
      }).filter(r => r.player)

      return {
        topScorers: topScorers.length ? topScorers : null,
        squadSample: rosterTop.slice(0, 8),
        source: 'espn',
      }
    } catch { return null }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ESPN Event Details — árbitro, cartões esperados, venue
// ═══════════════════════════════════════════════════════════════════════════
export async function fetchEventDetails(eventId, leagueCode) {
  if (!eventId || !leagueCode) return null
  const key = `event_${eventId}`
  return cached(key, 15 * 60_000, async () => {
    try {
      const url = `${ESPN_BASE}/soccer/${leagueCode}/summary?event=${eventId}`
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) return null
      const json = await res.json()

      const header = json?.header || {}
      const gameInfo = json?.gameInfo || {}
      const venue = gameInfo.venue || header.competitions?.[0]?.venue || {}
      const officials = gameInfo.officials || header.competitions?.[0]?.officials || []
      const headRef = officials.find(o => (o.position?.displayName || '').toLowerCase().includes('center'))
                   || officials[0]

      // Lat/lon do estádio (para integração com clima)
      const lat = venue?.address?.latitude ?? venue?.latitude ?? null
      const lon = venue?.address?.longitude ?? venue?.longitude ?? null

      return {
        venue: {
          name: venue.fullName || venue.name || null,
          city: venue.address?.city || null,
          capacity: venue.capacity || null,
          lat: lat ? +lat : null,
          lon: lon ? +lon : null,
        },
        referee: headRef ? {
          name: headRef.displayName || headRef.fullName || '',
          nationality: headRef.nationality?.abbreviation || null,
        } : null,
        attendance: header.competitions?.[0]?.attendance || null,
        weather: gameInfo.weather || null,
        source: 'espn',
      }
    } catch { return null }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Open-Meteo — clima por lat/lon (100% grátis, sem API key)
// ═══════════════════════════════════════════════════════════════════════════
// Impacto conhecido no jogo:
//   · Chuva forte → mais erros defensivos, BTTS sobe
//   · Vento >25 km/h → menos gols de longa distância
//   · Temperatura <5°C ou >32°C → ritmo cai, expGoals −0.1
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchWeather(lat, lon, kickoffISO) {
  if (!lat || !lon) return null
  const key = `weather_${lat.toFixed(2)}_${lon.toFixed(2)}_${(kickoffISO || '').slice(0, 13)}`
  return cached(key, 60 * 60_000, async () => {
    try {
      // Se tem kickoff, buscamos a previsão horária para o horário do jogo
      const params = new URLSearchParams({
        latitude:  String(lat),
        longitude: String(lon),
        current:   'temperature_2m,precipitation,wind_speed_10m,weather_code',
        hourly:    'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code',
        forecast_days: '3',
        timezone: 'auto',
      })
      const res = await fetch(`${OPEN_METEO}?${params}`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return null
      const json = await res.json()

      let snapshot = json.current
      if (kickoffISO && json.hourly?.time) {
        const kickHour = kickoffISO.slice(0, 13)  // YYYY-MM-DDTHH
        const idx = json.hourly.time.findIndex(t => t.startsWith(kickHour))
        if (idx >= 0) {
          snapshot = {
            temperature_2m: json.hourly.temperature_2m[idx],
            precipitation:  json.hourly.precipitation[idx],
            wind_speed_10m: json.hourly.wind_speed_10m[idx],
            weather_code:   json.hourly.weather_code[idx],
            precip_prob:    json.hourly.precipitation_probability[idx],
          }
        }
      }
      if (!snapshot) return null

      const code = snapshot.weather_code ?? 0
      const desc = weatherCodeToText(code)
      return {
        temp_c:     +((snapshot.temperature_2m ?? 0)).toFixed(1),
        precip_mm:  +((snapshot.precipitation ?? 0)).toFixed(1),
        precip_prob:snapshot.precip_prob ?? null,
        wind_kmh:   +((snapshot.wind_speed_10m ?? 0)).toFixed(1),
        condition:  desc,
        // Ajuste sugerido em expGoals
        goalImpact: weatherGoalImpact(snapshot),
        source: 'open-meteo',
      }
    } catch { return null }
  })
}

// WMO weather interpretation codes → texto
function weatherCodeToText(code) {
  if (code === 0) return 'Céu limpo'
  if (code <= 3) return 'Nublado'
  if (code <= 48) return 'Neblina'
  if (code <= 57) return 'Garoa'
  if (code <= 65) return 'Chuva'
  if (code <= 67) return 'Chuva gelada'
  if (code <= 77) return 'Neve'
  if (code <= 82) return 'Aguaceiros'
  if (code <= 86) return 'Nevascas'
  if (code <= 99) return 'Tempestade'
  return 'Desconhecido'
}

// Impacto estimado em expGoals (de −0.3 a +0.2)
function weatherGoalImpact(w) {
  let impact = 0
  const precip = w.precipitation ?? 0
  const wind   = w.wind_speed_10m ?? 0
  const temp   = w.temperature_2m ?? 20
  if (precip > 5) impact -= 0.15              // chuva forte
  else if (precip > 1) impact -= 0.05
  if (wind > 30) impact -= 0.12               // vento muito forte
  else if (wind > 20) impact -= 0.05
  if (temp < 5 || temp > 32) impact -= 0.08   // extremos
  return +impact.toFixed(2)
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Aggregator — chama tudo em paralelo
// ═══════════════════════════════════════════════════════════════════════════
// Retorna o pacote "premium data" que diferencia SportsBrain dos competidores.
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchPremiumData({ home, away, league, eventId, teamIdH, teamIdA, leagueCode, kickoffISO }) {
  const [xgH, xgA, scorersH, scorersA, eventDet] = await Promise.allSettled([
    fetchXG(home, league),
    fetchXG(away, league),
    fetchTopScorers(teamIdH, leagueCode),
    fetchTopScorers(teamIdA, leagueCode),
    eventId ? fetchEventDetails(eventId, leagueCode) : Promise.resolve(null),
  ])
  const ev = eventDet.status === 'fulfilled' ? eventDet.value : null

  // Clima depois — depende da lat/lon do venue
  let weather = null
  if (ev?.venue?.lat && ev?.venue?.lon) {
    weather = await fetchWeather(ev.venue.lat, ev.venue.lon, kickoffISO)
  }

  return {
    xg: {
      home: xgH.status === 'fulfilled' ? xgH.value : null,
      away: xgA.status === 'fulfilled' ? xgA.value : null,
    },
    players: {
      home: scorersH.status === 'fulfilled' ? scorersH.value : null,
      away: scorersA.status === 'fulfilled' ? scorersA.value : null,
    },
    event: ev,
    weather,
  }
}
