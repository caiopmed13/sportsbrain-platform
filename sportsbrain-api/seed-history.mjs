/**
 * SportsBrain — Seed histórico de picks (Abril 2026)
 * Busca jogos finalizados da ESPN, gera picks + verifica W/L automaticamente
 * Uso: node seed-history.mjs
 */

const WORKER_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'

const ESPN_LEAGUES = [
  { slug: 'bra.1',                 name: 'Brasileirão Série A',  country: 'Brazil' },
  { slug: 'bra.2',                 name: 'Brasileirão Série B',  country: 'Brazil' },
  { slug: 'bra.cup',               name: 'Copa do Brasil',        country: 'Brazil' },
  { slug: 'conmebol.libertadores', name: 'Copa Libertadores',     country: 'S. America' },
  { slug: 'conmebol.sudamericana', name: 'Copa Sudamericana',     country: 'S. America' },
  { slug: 'arg.1',                 name: 'Liga Argentina',        country: 'Argentina' },
  { slug: 'eng.1',                 name: 'Premier League',        country: 'England' },
  { slug: 'esp.1',                 name: 'La Liga',               country: 'Spain' },
  { slug: 'ger.1',                 name: 'Bundesliga',            country: 'Germany' },
  { slug: 'ita.1',                 name: 'Serie A',               country: 'Italy' },
  { slug: 'fra.1',                 name: 'Ligue 1',               country: 'France' },
  { slug: 'por.1',                 name: 'Primeira Liga',         country: 'Portugal' },
  { slug: 'usa.1',                 name: 'MLS',                   country: 'USA' },
  { slug: 'mex.1',                 name: 'Liga MX',               country: 'Mexico' },
  { slug: 'ned.1',                 name: 'Eredivisie',            country: 'Netherlands' },
  { slug: 'tur.1',                 name: 'Süper Lig',             country: 'Turkey' },
  { slug: 'uefa.champions',        name: 'Champions League',      country: 'UEFA' },
  { slug: 'uefa.europa',           name: 'Europa League',         country: 'UEFA' },
  { slug: 'uefa.europa_conference',name: 'Conference League',     country: 'UEFA' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}
function pickId(date, match, stat) {
  return `${date}|${norm(match)}|${norm(stat)}`
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function dateRange(from, to) {
  const dates = []
  const d = new Date(from + 'T12:00:00Z')
  const end = new Date(to   + 'T12:00:00Z')
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}

// ── Busca jogos finalizados da ESPN para uma data ─────────────────────────────
async function fetchFinishedGames(date) {
  const dateStr = date.replace(/-/g, '')
  const games   = []

  await Promise.allSettled(ESPN_LEAGUES.map(async lg => {
    try {
      const res  = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.slug}/scoreboard?dates=${dateStr}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (!res.ok) return
      const data = await res.json()

      for (const ev of (data.events || [])) {
        if (ev.status?.type?.state !== 'post') continue   // só finalizados
        const comp = ev.competitions?.[0]
        const home = comp?.competitors?.find(c => c.homeAway === 'home')
        const away = comp?.competitors?.find(c => c.homeAway === 'away')
        if (!home || !away) continue
        const hs = parseInt(home.score ?? -1, 10)
        const as = parseInt(away.score ?? -1, 10)
        if (hs < 0 || as < 0) continue

        // Stats extras (corners, shots) — disponíveis em jogos finalizados
        const statsMap = {}
        for (const c of (comp.competitors || [])) {
          const side = c.homeAway  // 'home'|'away'
          for (const s of (c.statistics || [])) {
            const key = (s.abbreviation || s.name || '').toUpperCase()
            statsMap[`${side}_${key}`] = parseFloat(s.value ?? 0)
          }
        }

        games.push({
          home_team:    home.team?.displayName || home.team?.name || '—',
          away_team:    away.team?.displayName || away.team?.name || '—',
          league:       lg.name,
          country:      lg.country,
          score_home:   hs,
          score_away:   as,
          corners_home: statsMap['home_CK']  ?? statsMap['home_CO']  ?? null,
          corners_away: statsMap['away_CK']  ?? statsMap['away_CO']  ?? null,
          sot_home:     statsMap['home_SOG'] ?? statsMap['home_SRS'] ?? null,
          sot_away:     statsMap['away_SOG'] ?? statsMap['away_SRS'] ?? null,
          date,
        })
      }
    } catch {}
  }))

  return games
}

// ── Busca stats do time no Worker ─────────────────────────────────────────────
const statsCache = {}
async function fetchTeamStats(team) {
  if (statsCache[team] !== undefined) return statsCache[team]
  try {
    const res  = await fetch(
      `${WORKER_BASE}/v1/football/team/${encodeURIComponent(team)}/stats?home_away=all`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) { statsCache[team] = null; return null }
    const data = await res.json()
    statsCache[team] = data?.data || data || null
    return statsCache[team]
  } catch {
    statsCache[team] = null
    return null
  }
}

// ── Gerador de picks (mesmo modelo do FtProps) ────────────────────────────────
function generatePicks(game, homeStats, awayStats) {
  const picks  = []
  const { home_team, away_team, league, score_home, score_away, date,
          corners_home, corners_away, sot_home, sot_away } = game
  const match  = `${home_team} vs ${away_team}`
  const total  = score_home + score_away
  const bttsOk = score_home > 0 && score_away > 0
  const homeWon = score_home > score_away
  const awayWon = score_away > score_home

  // Defaults caso stats não disponíveis
  const hGF = homeStats?.goals_for     ?? 1.4
  const hGA = homeStats?.goals_against ?? 1.3
  const hCK = homeStats?.corners_per_game      ?? 5.2
  const hCKh= homeStats?.corners_ht_per_game   ?? 2.5
  const hSH = homeStats?.shots_on_target_per_game ?? 3.8
  const hSHh= homeStats?.shots_ht_per_game     ?? 2.0

  const aGF = awayStats?.goals_for     ?? 1.2
  const aGA = awayStats?.goals_against ?? 1.5
  const aCK = awayStats?.corners_per_game      ?? 4.8
  const aCKh= awayStats?.corners_ht_per_game   ?? 2.3
  const aSH = awayStats?.shots_on_target_per_game ?? 3.4
  const aSHh= awayStats?.shots_ht_per_game     ?? 1.8

  const expGoals = ((hGF + aGA) + (aGF + hGA)) / 2
  const CONF_MIN = 65  // seed é mais permissivo para gerar volume de dados

  // ── Over/Under 2.5 ─────────────────────────────
  // Base real: ~55% dos jogos terminam com >2.5 gols (futebol europeu)
  const over25p = Math.min(0.93, Math.max(0.42, 0.55 + (expGoals - 2.7) * 0.22))
  const over25c = Math.round(over25p * 100)
  if (over25c >= CONF_MIN) {
    picks.push({ id: pickId(date, match, 'Over 2.5'),
      pick_date: date, match, league, sport: 'football', stat: 'Over 2.5', conf: over25c,
      tier: over25c >= 82 ? 'safe' : over25c >= 76 ? 'median' : 'aggressive',
      real_odd: null, ev_real: null, result: total > 2.5 ? 'W' : 'L', auto_verified: 1 })
  }

  // ── Under 2.5 ──────────────────────────────────
  const under25p = 1 - over25p
  const under25c = Math.round(under25p * 100)
  if (under25c >= CONF_MIN) {
    picks.push({ id: pickId(date, match, 'Under 2.5'),
      pick_date: date, match, league, sport: 'football', stat: 'Under 2.5', conf: under25c,
      tier: under25c >= 82 ? 'safe' : under25c >= 76 ? 'median' : 'aggressive',
      real_odd: null, ev_real: null, result: total < 2.5 ? 'W' : 'L', auto_verified: 1 })
  }

  // ── Over 1.5 ───────────────────────────────────
  const over15p = Math.min(0.95, Math.max(0.55, 0.72 + (expGoals - 2.5) * 0.18))
  const over15c = Math.round(over15p * 100)
  if (over15c >= CONF_MIN) {
    picks.push({ id: pickId(date, match, 'Over 1.5'),
      pick_date: date, match, league, sport: 'football', stat: 'Over 1.5', conf: over15c,
      tier: over15c >= 82 ? 'safe' : over15c >= 76 ? 'median' : 'aggressive',
      real_odd: null, ev_real: null, result: total > 1.5 ? 'W' : 'L', auto_verified: 1 })
  }

  // ── BTTS ────────────────────────────────────────
  // Base real: ~50% dos jogos têm ambos marcando
  const hScoreP = Math.min(0.90, Math.max(0.35, 0.52 + (hGF - 1.3) * 0.18))
  const aScoreP = Math.min(0.90, Math.max(0.35, 0.52 + (aGF - 1.1) * 0.18))
  const bttsP   = hScoreP * aScoreP
  const bttsC   = Math.round(bttsP * 100)
  if (bttsC >= CONF_MIN) {
    picks.push({ id: pickId(date, match, 'BTTS'),
      pick_date: date, match, league, sport: 'football', stat: 'BTTS', conf: bttsC,
      tier: bttsC >= 82 ? 'safe' : bttsC >= 76 ? 'median' : 'aggressive',
      real_odd: null, ev_real: null, result: bttsOk ? 'W' : 'L', auto_verified: 1 })
  }

  // ── Vitória Casa ────────────────────────────────
  // Base real: ~46% dos jogos terminam com vitória do mandante
  const homeDiff = (hGF - hGA) - (aGF - aGA)
  const homeWinP = Math.min(0.85, Math.max(0.35, 0.46 + homeDiff * 0.12 + 0.04)) // +4% home advantage
  const homeWinC = Math.round(homeWinP * 100)
  if (homeWinC >= CONF_MIN) {
    picks.push({ id: pickId(date, match, 'Vitória Casa'),
      pick_date: date, match, league, sport: 'football', stat: 'Vitória Casa', conf: homeWinC,
      tier: homeWinC >= 82 ? 'safe' : homeWinC >= 76 ? 'median' : 'aggressive',
      real_odd: null, ev_real: null, result: homeWon ? 'W' : 'L', auto_verified: 1 })
  }

  // ── Vitória Fora ────────────────────────────────
  // Base real: ~29% dos jogos terminam com vitória do visitante
  const awayWinP = Math.min(0.82, Math.max(0.22, 0.29 + (aGF - aGA - (hGF - hGA)) * 0.10))
  const awayWinC = Math.round(awayWinP * 100)
  if (awayWinC >= CONF_MIN) {
    picks.push({ id: pickId(date, match, 'Vitória Fora'),
      pick_date: date, match, league, sport: 'football', stat: 'Vitória Fora', conf: awayWinC,
      tier: awayWinC >= 82 ? 'safe' : awayWinC >= 76 ? 'median' : 'aggressive',
      real_odd: null, ev_real: null, result: awayWon ? 'W' : 'L', auto_verified: 1 })
  }

  // ── Escanteios Over 9.5 (se ESPN retornou dados) ─
  if (corners_home != null && corners_away != null) {
    const totalCK  = corners_home + corners_away
    const expCKtot = (hCK + aCK) / 2
    const ck9p     = Math.min(0.90, Math.max(0.40, 0.50 + (expCKtot - 9.5) * 0.08))
    const ck9c     = Math.round(ck9p * 100)
    if (ck9c >= CONF_MIN) {
      picks.push({ id: pickId(date, match, 'Escanteios Over 9.5'),
        pick_date: date, match, league, sport: 'football', stat: 'Escanteios Over 9.5', conf: ck9c,
        tier: ck9c >= 82 ? 'safe' : ck9c >= 76 ? 'median' : 'aggressive',
        real_odd: null, ev_real: null, result: totalCK > 9.5 ? 'W' : 'L', auto_verified: 1 })
    }
  }

  // ── SOT Over 4.5 (se ESPN retornou dados) ───────
  if (sot_home != null && sot_away != null) {
    const totalSOT = sot_home + sot_away
    const expSOT   = (hSH + aSH) / 2
    const sot4p    = Math.min(0.90, Math.max(0.40, 0.55 + (expSOT - 6.5) * 0.10))
    const sot4c    = Math.round(sot4p * 100)
    if (sot4c >= CONF_MIN) {
      picks.push({ id: pickId(date, match, 'SOT Over 4.5'),
        pick_date: date, match, league, sport: 'football', stat: 'SOT Over 4.5', conf: sot4c,
        tier: sot4c >= 82 ? 'safe' : sot4c >= 76 ? 'median' : 'aggressive',
        real_odd: null, ev_real: null, result: totalSOT > 4.5 ? 'W' : 'L', auto_verified: 1 })
    }
  }

  return picks
}

// ── Upload para o Worker ───────────────────────────────────────────────────────
async function uploadPicks(picks) {
  if (!picks.length) return 0
  const res  = await fetch(`${WORKER_BASE}/v1/picks/save`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ picks }),
    signal:  AbortSignal.timeout(20000),
  })
  const data = await res.json()
  return data.inserted ?? 0
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const FROM = '2026-04-01'
  const TO   = '2026-04-19'   // até ontem (jogos finalizados)
  const dates = dateRange(FROM, TO)

  console.log(`\n🗓  Seed histórico SportsBrain: ${FROM} → ${TO}`)
  console.log(`   ${dates.length} dias · Worker: ${WORKER_BASE}\n`)

  let totalGames = 0
  let totalPicks = 0
  let totalInserted = 0

  for (const date of dates) {
    process.stdout.write(`📅 ${date}  `)
    const games = await fetchFinishedGames(date)
    if (!games.length) { console.log('0 jogos'); await sleep(300); continue }
    process.stdout.write(`${games.length} jogos  `)

    const dayPicks = []
    for (const game of games) {
      const [hStats, aStats] = await Promise.all([
        fetchTeamStats(game.home_team),
        fetchTeamStats(game.away_team),
      ])
      const picks = generatePicks(game, hStats, aStats)
      dayPicks.push(...picks)
    }

    // Filtra apenas picks com confiança ≥ 75%
    const highConf = dayPicks.filter(p => p.conf >= 75)
    const inserted = await uploadPicks(highConf)

    console.log(`→ ${highConf.length} picks (≥75%)  ✅ ${inserted} novos no D1`)
    totalGames    += games.length
    totalPicks    += highConf.length
    totalInserted += inserted

    await sleep(400)   // respeita rate limit
  }

  console.log(`\n${'═'.repeat(55)}`)
  console.log(`✅ Seed concluído!`)
  console.log(`   Jogos processados : ${totalGames}`)
  console.log(`   Picks gerados     : ${totalPicks}`)
  console.log(`   Inseridos no D1   : ${totalInserted}`)
  console.log(`${'═'.repeat(55)}\n`)
}

main().catch(e => { console.error('❌ Erro:', e.message); process.exit(1) })
