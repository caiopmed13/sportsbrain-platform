/**
 * xG Route — SportsBrain Proprietary (v2)
 * ────────────────────────────────────────
 * GET /v1/xg?team=Liverpool&league=eng.1&season=2026&window=season
 * GET /v1/xg/match/:matchId                    → xG por chute de um jogo
 * GET /v1/xg/ingest?force=1                    → dispara ingest manual (admin)
 *
 * Fonte: shot_events (D1) alimentado pelo cron ESPN harvester.
 * Modelo xG: nosso (src/models/xgModel.js) — coeficientes próprios.
 *
 * Zero dependência de API paga. Dados acumulam em D1 → viram moat.
 */

import { sbResponse, sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';
import { ingestMatches, recomputeTeamXG } from '../cron/ingestMatches.js';
import { backfillFdco, backfillMultiple } from '../cron/backfillHistorical.js';
import { XG_MODEL_VERSION } from '../models/xgModel.js';

function normTeam(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìî]/g, 'i')
    .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Mapeamento league legível → slug ESPN (mesma usada no ingest)
const LEAGUE_SLUGS = {
  'premier league': 'eng.1', 'epl': 'eng.1', 'england': 'eng.1',
  'la liga': 'esp.1', 'laliga': 'esp.1', 'spain': 'esp.1',
  'bundesliga': 'ger.1', 'germany': 'ger.1',
  'serie a': 'ita.1', 'italy': 'ita.1',
  'ligue 1': 'fra.1', 'france': 'fra.1',
  'primeira liga': 'por.1', 'portugal': 'por.1',
  'eredivisie': 'ned.1', 'netherlands': 'ned.1',
  'brasileirão': 'bra.1', 'brasileirao': 'bra.1', 'serie a brasil': 'bra.1', 'brazil': 'bra.1',
  'serie b brasil': 'bra.2',
  'copa do brasil': 'bra.copa_do_brazil',
  'libertadores': 'conmebol.libertadores',
  'sudamericana': 'conmebol.sudamericana',
  'champions': 'uefa.champions', 'champions league': 'uefa.champions', 'ucl': 'uefa.champions',
  'europa': 'uefa.europa', 'europa league': 'uefa.europa', 'uel': 'uefa.europa',
  'conference': 'uefa.europa.conf',
  'mls': 'usa.1', 'usa': 'usa.1',
  'liga mx': 'mex.1', 'mexico': 'mex.1',
};

function resolveLeague(leagueStr) {
  const l = (leagueStr || '').toLowerCase().trim();
  if (!l) return null;
  // Match direto em slugs (se usuário passou 'eng.1' direto)
  if (Object.values(LEAGUE_SLUGS).includes(l)) return l;
  // Match por nome legível
  for (const [k, v] of Object.entries(LEAGUE_SLUGS)) {
    if (l.includes(k)) return v;
  }
  return null;
}

async function getTeamXG(env, teamNorm, leagueSlug, season, window = 'season') {
  const row = await env.SB_DB.prepare(`
    SELECT * FROM team_xg_rolling
    WHERE team_norm = ? AND league_slug = ? AND season = ? AND window = ?
    LIMIT 1
  `).bind(teamNorm, leagueSlug, season, window).first();
  return row;
}

async function searchTeamFuzzy(env, teamNorm, leagueSlug, season) {
  // Tenta match exato, depois LIKE bilateral
  const exact = await env.SB_DB.prepare(`
    SELECT * FROM team_xg_rolling
    WHERE team_norm = ? AND league_slug = ? AND season = ? AND window = 'season'
    LIMIT 1
  `).bind(teamNorm, leagueSlug, season).first();
  if (exact) return exact;

  const like = await env.SB_DB.prepare(`
    SELECT * FROM team_xg_rolling
    WHERE (team_norm LIKE ? OR ? LIKE '%' || team_norm || '%')
      AND league_slug = ? AND season = ? AND window = 'season'
    ORDER BY games DESC LIMIT 1
  `).bind(`%${teamNorm}%`, teamNorm, leagueSlug, season).first();
  return like;
}

async function handleTeamXG(url, env) {
  const team = url.searchParams.get('team');
  const league = url.searchParams.get('league');
  const season = url.searchParams.get('season') || String(new Date().getFullYear());
  const window = url.searchParams.get('window') || 'season';

  if (!team || !league) {
    return new Response(JSON.stringify(sbError('BAD_REQUEST',
      'Usage: /v1/xg?team=Name&league=<name or slug>&season=YYYY&window=season', 400)),
      { status: 400, headers: corsHeaders() });
  }

  const leagueSlug = resolveLeague(league);
  if (!leagueSlug) {
    return new Response(JSON.stringify(sbError('LEAGUE_UNKNOWN',
      `League "${league}" not mapped. Supported: ${Object.keys(LEAGUE_SLUGS).join(', ')}`, 400)),
      { status: 400, headers: corsHeaders() });
  }

  const teamNorm = normTeam(team);
  let row = await searchTeamFuzzy(env, teamNorm, leagueSlug, season);
  let seasonFallback = null;

  // ─── Fallback multi-season: se season atual tem 0 games, tenta até 3 temporadas atrás ─────
  // Desbloqueia app quando ingestão ainda não cobre a temporada nova mas existe histórico.
  if (!row || row.games === 0) {
    const triedSeasons = [];
    for (let back = 1; back <= 3; back++) {
      const prevSeason = String(parseInt(season, 10) - back);
      const prev = await searchTeamFuzzy(env, teamNorm, leagueSlug, prevSeason);
      triedSeasons.push({ season: prevSeason, found: !!prev, games: prev?.games ?? 0 });
      if (prev && prev.games > 0) {
        row = prev;
        seasonFallback = {
          requested: season,
          served: prevSeason,
          reason: 'no_data_for_requested_season',
          tried: triedSeasons,
        };
        break;
      }
    }
  }

  // ─── Season stacking (#10): se temporada atual tem <10 jogos, blenda ─────
  //  xG_final = (n/10) × xG_current + (1 - n/10) × xG_prev
  //  Protege contra cold-start em agosto/setembro.
  let seasonBlend = null;
  if (row && row.games < 10) {
    const prevSeason = String(parseInt(season, 10) - 1);
    const prev = await searchTeamFuzzy(env, teamNorm, leagueSlug, prevSeason);
    if (prev && prev.games >= 10) {
      const w = row.games / 10;
      const blend = (a, b) => +((w * (a || 0)) + ((1 - w) * (b || 0))).toFixed(3);
      seasonBlend = {
        current_games: row.games,
        prev_season: prevSeason,
        prev_games: prev.games,
        weight_current: +w.toFixed(2),
        raw_current_xg_per90: row.xg_per90,
        raw_prev_xg_per90: prev.xg_per90,
      };
      // Sobrescreve campos blendados (mantém row.games original pra transparência)
      row = {
        ...row,
        xg_for:     blend(row.xg_for, prev.xg_for),
        xg_against: blend(row.xg_against, prev.xg_against),
        xg_per90:   blend(row.xg_per90, prev.xg_per90),
        xga_per90:  blend(row.xga_per90, prev.xga_per90),
        xg_diff:    blend(row.xg_diff, prev.xg_diff),
      };
    }
  }

  if (!row) {
    // Check se há jogos recentes dessa liga sequer
    const coverage = await env.SB_DB.prepare(`
      SELECT COUNT(*) as matches, COUNT(DISTINCT s.team_norm) as teams
      FROM matches_raw m LEFT JOIN shot_events s ON s.match_id = m.match_id
      WHERE m.league_slug = ? AND m.season = ? AND m.status = 'post'
    `).bind(leagueSlug, season).first();

    return new Response(JSON.stringify(sbError('XG_UNAVAILABLE',
      `No proprietary xG data yet for "${team}" in "${leagueSlug}" season ${season}. ` +
      `Coverage currently: ${coverage?.matches || 0} finalized matches, ${coverage?.teams || 0} teams. ` +
      `Data accumulates from hourly ESPN ingest — try again in a few hours.`, 404)),
      { status: 404, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } });
  }

  const result = {
    team: row.team_display,
    matched_with: team,
    team_norm: row.team_norm,
    league: leagueSlug,
    season,
    window,
    games: row.games,
    goals: row.goals_for,
    goals_against: row.goals_against,
    xg: +(row.xg_for || 0).toFixed(2),
    xga: +(row.xg_against || 0).toFixed(2),
    xg_per90: row.xg_per90,
    xga_per90: row.xga_per90,
    xg_diff: row.xg_diff,
    overperforming: !!row.overperf,
    underperforming: !!row.underperf,
    season_blend: seasonBlend,
    season_fallback: seasonFallback,
    model_version: XG_MODEL_VERSION,
    source: 'sportsbrain-proprietary',
    data_freshness: row.updated_at,
    note: 'xG computed from ESPN shot events via SportsBrain proprietary logistic model. Updates hourly.',
  };

  return new Response(JSON.stringify(sbResponse({ data: result })), {
    status: 200,
    headers: {
      ...corsHeaders(),
      'Cache-Control': 'public, max-age=3600',
      'X-Data-Source': 'sportsbrain-proprietary',
      'X-Model-Version': XG_MODEL_VERSION,
    },
  });
}

async function handleMatchXG(pathname, env) {
  const matchId = decodeURIComponent(pathname.replace('/v1/xg/match/', ''));
  if (!matchId) {
    return new Response(JSON.stringify(sbError('BAD_REQUEST', 'matchId required', 400)),
      { status: 400, headers: corsHeaders() });
  }

  const match = await env.SB_DB.prepare(
    `SELECT * FROM matches_raw WHERE match_id = ? OR external_id = ? LIMIT 1`
  ).bind(matchId, matchId).first();

  if (!match) {
    return new Response(JSON.stringify(sbError('MATCH_NOT_FOUND', `Match ${matchId} not in D1 yet`, 404)),
      { status: 404, headers: corsHeaders() });
  }

  const shots = await env.SB_DB.prepare(
    `SELECT * FROM shot_events WHERE match_id = ? ORDER BY minute ASC, id ASC`
  ).bind(match.match_id).all();

  const homeShots = (shots.results || []).filter(s => s.is_home === 1);
  const awayShots = (shots.results || []).filter(s => s.is_home === 0);
  const sum = arr => arr.reduce((a, b) => a + (b.xg_computed || 0), 0);

  return new Response(JSON.stringify(sbResponse({
    data: {
      match_id: match.match_id,
      home: match.home_team, away: match.away_team,
      score: `${match.score_home ?? '-'}-${match.score_away ?? '-'}`,
      xg: { home: +sum(homeShots).toFixed(2), away: +sum(awayShots).toFixed(2) },
      shots: { home: homeShots.length, away: awayShots.length },
      shot_events: shots.results || [],
      model_version: XG_MODEL_VERSION,
    },
  })), { status: 200, headers: corsHeaders() });
}

async function handleManualIngest(env, url) {
  const adminKey = url.searchParams.get('admin_key');
  if (adminKey !== env.INGEST_SECRET) {
    return new Response(JSON.stringify(sbError('UNAUTHORIZED', 'admin_key required', 401)),
      { status: 401, headers: corsHeaders() });
  }
  const daysBack = parseInt(url.searchParams.get('days') || '1');
  const result = await ingestMatches(env, { daysBack });
  const agg = await recomputeTeamXG(env, String(new Date().getFullYear()));
  return new Response(JSON.stringify(sbResponse({ data: { ingest: result, aggregates: agg } })),
    { status: 200, headers: corsHeaders() });
}

async function handleBackfill(env, url) {
  const adminKey = url.searchParams.get('admin_key');
  if (adminKey !== env.INGEST_SECRET) {
    return new Response(JSON.stringify(sbError('UNAUTHORIZED', 'admin_key required', 401)),
      { status: 401, headers: corsHeaders() });
  }
  const leagues = (url.searchParams.get('leagues') || 'E0').split(',');
  const seasons = (url.searchParams.get('seasons') || '2425').split(',');
  const results = await backfillMultiple(env, { leagueCodes: leagues, seasonCodes: seasons });
  const agg = await recomputeTeamXG(env, '20' + seasons[seasons.length - 1].slice(0, 2));
  return new Response(JSON.stringify(sbResponse({ data: { backfill: results, aggregates: agg } })),
    { status: 200, headers: corsHeaders() });
}

async function handleStatus(env) {
  const totals = await env.SB_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM matches_raw) as matches,
      (SELECT COUNT(*) FROM matches_raw WHERE status='post') as finalized,
      (SELECT COUNT(*) FROM shot_events) as shots,
      (SELECT COUNT(*) FROM shot_events WHERE xg_model_ver LIKE 'v1%') as shots_espn,
      (SELECT COUNT(*) FROM shot_events WHERE xg_model_ver='fdco-agg') as shots_fdco,
      (SELECT COUNT(*) FROM officials) as officials,
      (SELECT COUNT(*) FROM team_xg_rolling) as team_aggs,
      (SELECT COUNT(DISTINCT league_slug) FROM matches_raw) as leagues_covered
  `).first();

  const recent = await env.SB_DB.prepare(
    `SELECT * FROM ingestion_log ORDER BY id DESC LIMIT 10`
  ).all();

  return new Response(JSON.stringify(sbResponse({
    data: {
      model_version: XG_MODEL_VERSION,
      dataset: totals,
      recent_runs: recent.results || [],
    },
  })), { status: 200, headers: corsHeaders() });
}

export async function handleXG(pathname, request, env) {
  const url = new URL(request.url);

  try {
    if (pathname === '/v1/xg/ingest') return await handleManualIngest(env, url);
    if (pathname === '/v1/xg/backfill') return await handleBackfill(env, url);
    if (pathname === '/v1/xg/status')   return await handleStatus(env);
    if (pathname.startsWith('/v1/xg/match/')) return await handleMatchXG(pathname, env);
    if (pathname === '/v1/xg') return await handleTeamXG(url, env);

    return new Response(JSON.stringify(sbError('NOT_FOUND', `Unknown xG route ${pathname}`, 404)),
      { status: 404, headers: corsHeaders() });
  } catch (err) {
    console.error('[xg]', err.message, err.stack);
    return new Response(JSON.stringify(sbError('INTERNAL_ERROR',
      `xG route failed: ${err.message}`, 500)),
      { status: 500, headers: corsHeaders() });
  }
}
