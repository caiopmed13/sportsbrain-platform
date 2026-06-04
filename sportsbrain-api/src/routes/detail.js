/**
 * Match Detail Routes — SportsBrain proprietary
 * ─────────────────────────────────────────────
 * GET /v1/match/:matchId/detail   → match completo (lineups + weather + shots + ppda + xg)
 * GET /v1/lineups/:matchId        → lineups só
 * GET /v1/weather/:matchId        → weather só
 * GET /v1/players/team/:teamNorm  → players acumulados de um time (season)
 * GET /v1/match/search?home=X&away=Y&date=YYYY-MM-DD  → resolve matchId
 */

import { sbResponse, sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';

function normTeam(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b/g,'')
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}

async function findMatch(env, matchIdOrExt) {
  return await env.SB_DB.prepare(
    `SELECT * FROM matches_raw WHERE match_id = ? OR external_id = ? LIMIT 1`
  ).bind(matchIdOrExt, matchIdOrExt).first();
}

async function handleMatchDetail(pathname, env) {
  const matchId = decodeURIComponent(pathname.replace('/v1/match/', '').replace('/detail', ''));
  const match = await findMatch(env, matchId);
  if (!match) {
    return new Response(JSON.stringify(sbError('MATCH_NOT_FOUND', `Match ${matchId} not in D1`, 404)),
      { status: 404, headers: corsHeaders() });
  }

  const [lineups, weather, shots, metrics, officials] = await Promise.all([
    env.SB_DB.prepare(`SELECT * FROM lineups WHERE match_id = ? ORDER BY is_home DESC, is_starter DESC`).bind(match.match_id).all(),
    env.SB_DB.prepare(`SELECT * FROM weather_snapshots WHERE match_id = ?`).bind(match.match_id).first(),
    env.SB_DB.prepare(`SELECT * FROM shot_events WHERE match_id = ? ORDER BY minute ASC`).bind(match.match_id).all(),
    env.SB_DB.prepare(`SELECT * FROM match_team_metrics WHERE match_id = ?`).bind(match.match_id).all(),
    env.SB_DB.prepare(`SELECT * FROM officials WHERE match_id = ?`).bind(match.match_id).all(),
  ]);

  const byTeam = (arr, isHome) => (arr.results || []).filter(r => r.is_home === (isHome ? 1 : 0));

  return new Response(JSON.stringify(sbResponse({
    data: {
      match: {
        id: match.match_id, external_id: match.external_id,
        league: match.league_slug, season: match.season,
        date: match.match_date, kickoff: match.kickoff_iso,
        status: match.status,
        home: match.home_team, away: match.away_team,
        score: `${match.score_home ?? '-'}-${match.score_away ?? '-'}`,
        score_ht: match.score_ht_home != null ? `${match.score_ht_home}-${match.score_ht_away}` : null,
        venue: match.venue, attendance: match.attendance,
        coords: match.venue_lat && match.venue_lon ? { lat: match.venue_lat, lon: match.venue_lon } : null,
      },
      lineups: {
        home: byTeam(lineups, true),
        away: byTeam(lineups, false),
        formations: {
          home: byTeam(lineups, true)[0]?.formation || null,
          away: byTeam(lineups, false)[0]?.formation || null,
        },
      },
      weather,
      shot_events: shots.results || [],
      team_metrics: metrics.results || [],
      officials: officials.results || [],
      summary: {
        shots_home: byTeam(shots, true).length,
        shots_away: byTeam(shots, false).length,
        xg_home: +byTeam(shots, true).reduce((a, s) => a + (s.xg_computed || 0), 0).toFixed(2),
        xg_away: +byTeam(shots, false).reduce((a, s) => a + (s.xg_computed || 0), 0).toFixed(2),
      },
    },
  })), { status: 200, headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=1800' } });
}

async function handleLineups(pathname, env) {
  const matchId = decodeURIComponent(pathname.replace('/v1/lineups/', ''));
  const match = await findMatch(env, matchId);
  if (!match) {
    return new Response(JSON.stringify(sbError('MATCH_NOT_FOUND', `Match ${matchId} not in D1`, 404)),
      { status: 404, headers: corsHeaders() });
  }
  const lineups = await env.SB_DB.prepare(
    `SELECT * FROM lineups WHERE match_id = ? ORDER BY is_home DESC, is_starter DESC, jersey ASC`
  ).bind(match.match_id).all();
  const home = (lineups.results || []).filter(l => l.is_home === 1);
  const away = (lineups.results || []).filter(l => l.is_home === 0);
  return new Response(JSON.stringify(sbResponse({
    data: {
      match_id: match.match_id, home_team: match.home_team, away_team: match.away_team,
      home: { formation: home[0]?.formation || null, starters: home.filter(p => p.is_starter),
              bench: home.filter(p => !p.is_starter) },
      away: { formation: away[0]?.formation || null, starters: away.filter(p => p.is_starter),
              bench: away.filter(p => !p.is_starter) },
      confirmed: lineups.results?.[0]?.is_confirmed === 1,
    },
  })), { status: 200, headers: corsHeaders() });
}

async function handleWeather(pathname, env) {
  const matchId = decodeURIComponent(pathname.replace('/v1/weather/', ''));
  const match = await findMatch(env, matchId);
  if (!match) return new Response(JSON.stringify(sbError('MATCH_NOT_FOUND', `Match ${matchId} not in D1`, 404)),
    { status: 404, headers: corsHeaders() });
  const w = await env.SB_DB.prepare(`SELECT * FROM weather_snapshots WHERE match_id = ?`).bind(match.match_id).first();
  if (!w) return new Response(JSON.stringify(sbError('WEATHER_UNAVAILABLE',
    'No weather data. Needs venue coordinates + kickoff time.', 404)),
    { status: 404, headers: corsHeaders() });
  return new Response(JSON.stringify(sbResponse({ data: w })),
    { status: 200, headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=3600' } });
}

async function handleTeamPlayers(pathname, env) {
  const teamNorm = decodeURIComponent(pathname.replace('/v1/players/team/', ''));
  // Agrega de lineups: quem jogou, quantos jogos, quantos como starter
  const rows = await env.SB_DB.prepare(`
    SELECT player_name, player_norm,
      COUNT(*) as appearances,
      SUM(is_starter) as starts,
      MAX(jersey) as jersey,
      MAX(position) as position
    FROM lineups WHERE team_norm = ?
    GROUP BY player_norm ORDER BY starts DESC, appearances DESC
  `).bind(normTeam(teamNorm)).all();

  // Top scorers do time via shot_events
  const scorers = await env.SB_DB.prepare(`
    SELECT player_name, COUNT(*) as shots, SUM(is_goal) as goals, SUM(xg_computed) as xg_total
    FROM shot_events WHERE team_norm = ? AND player_name IS NOT NULL
    GROUP BY player_name ORDER BY goals DESC, xg_total DESC LIMIT 20
  `).bind(normTeam(teamNorm)).all();

  return new Response(JSON.stringify(sbResponse({
    data: {
      team_norm: normTeam(teamNorm),
      squad: rows.results || [],
      top_scorers: (scorers.results || []).map(s => ({ ...s, xg_total: +(s.xg_total || 0).toFixed(2) })),
    },
  })), { status: 200, headers: corsHeaders() });
}

async function handleRefereeStats(pathname, env) {
  const refNorm = decodeURIComponent(pathname.replace('/v1/referee/', '').replace('/stats', ''));
  if (!refNorm) {
    return new Response(JSON.stringify(sbError('BAD_REQUEST', 'Usage: /v1/referee/:name/stats', 400)),
      { status: 400, headers: corsHeaders() });
  }
  const rn = normTeam(refNorm);
  const row = await env.SB_DB.prepare(`
    SELECT referee_name, referee_norm,
      COUNT(DISTINCT match_id) as games,
      SUM(yellow_cards) as yellows,
      SUM(red_cards) as reds,
      SUM(penalties) as pens,
      SUM(fouls) as fouls
    FROM officials
    WHERE referee_norm LIKE ? AND role = 'center'
    GROUP BY referee_norm
    ORDER BY games DESC LIMIT 1
  `).bind(`%${rn}%`).first();

  if (!row || !row.games) {
    return new Response(JSON.stringify(sbError('REFEREE_NOT_FOUND',
      `No history for "${refNorm}" — try fuller name`, 404)),
      { status: 404, headers: corsHeaders() });
  }

  const games = row.games || 1;
  const y_pg  = row.yellows / games;
  const r_pg  = row.reds / games;
  const cards_pg = y_pg + r_pg;
  const pens_pg  = row.pens / games;
  // Prob >=1 cartão vermelho por jogo (Poisson tail)
  const pRedOne = 1 - Math.exp(-r_pg);
  // Prob >=5 cards (Poisson tail Σ k>=5)
  let p4_or_less = 0;
  for (let k = 0; k <= 4; k++) {
    let fact = 1; for (let i = 2; i <= k; i++) fact *= i;
    p4_or_less += (Math.exp(-cards_pg) * Math.pow(cards_pg, k)) / fact;
  }
  const pOver45Cards = Math.max(0, Math.min(0.98, 1 - p4_or_less));
  const pPenInMatch  = 1 - Math.exp(-pens_pg);

  return new Response(JSON.stringify(sbResponse({
    data: {
      referee: row.referee_name,
      referee_norm: row.referee_norm,
      games, sample_level: games >= 10 ? 'HIGH' : games >= 4 ? 'MED' : 'LOW',
      yellows_per_game: +y_pg.toFixed(2),
      reds_per_game:    +r_pg.toFixed(3),
      cards_per_game:   +cards_pg.toFixed(2),
      pens_per_game:    +pens_pg.toFixed(3),
      fouls_per_game:   +((row.fouls || 0) / games).toFixed(1),
      markets: {
        p_over_4_5_cards: +pOver45Cards.toFixed(4),
        p_red_in_match:   +pRedOne.toFixed(4),
        p_pen_in_match:   +pPenInMatch.toFixed(4),
      },
    },
  })), { status: 200, headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=3600' } });
}

async function handleMatchSearch(url, env) {
  const home = url.searchParams.get('home');
  const away = url.searchParams.get('away');
  const date = url.searchParams.get('date');
  if (!home || !away) {
    return new Response(JSON.stringify(sbError('BAD_REQUEST', 'Usage: ?home=X&away=Y&date=YYYY-MM-DD', 400)),
      { status: 400, headers: corsHeaders() });
  }
  const hn = normTeam(home), an = normTeam(away);
  let sql = `SELECT * FROM matches_raw WHERE (home_team_norm LIKE ? AND away_team_norm LIKE ?)`;
  const binds = [`%${hn}%`, `%${an}%`];
  if (date) { sql += ` AND match_date = ?`; binds.push(date); }
  sql += ` ORDER BY match_date DESC LIMIT 10`;
  const rows = await env.SB_DB.prepare(sql).bind(...binds).all();
  return new Response(JSON.stringify(sbResponse({ data: { matches: rows.results || [] } })),
    { status: 200, headers: corsHeaders() });
}

export async function handleDetail(pathname, request, env) {
  const url = new URL(request.url);
  try {
    if (pathname === '/v1/match/search')          return await handleMatchSearch(url, env);
    if (pathname.startsWith('/v1/match/') && pathname.endsWith('/detail')) return await handleMatchDetail(pathname, env);
    if (pathname.startsWith('/v1/lineups/'))      return await handleLineups(pathname, env);
    if (pathname.startsWith('/v1/weather/'))      return await handleWeather(pathname, env);
    if (pathname.startsWith('/v1/players/team/')) return await handleTeamPlayers(pathname, env);
    if (pathname.startsWith('/v1/referee/') && pathname.endsWith('/stats')) return await handleRefereeStats(pathname, env);
    return new Response(JSON.stringify(sbError('NOT_FOUND', `Unknown route ${pathname}`, 404)),
      { status: 404, headers: corsHeaders() });
  } catch (err) {
    console.error('[detail]', err.message);
    return new Response(JSON.stringify(sbError('INTERNAL_ERROR', err.message, 500)),
      { status: 500, headers: corsHeaders() });
  }
}
