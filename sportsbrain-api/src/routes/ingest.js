/**
 * POST /internal/ingest
 * Recebe dados dos coletores Python (Railway) e salva no D1.
 * Autenticado por X-Ingest-Secret no header.
 *
 * Schema real do D1:
 *   games            — id TEXT PK, score_home, score_away, score_ht_home, score_ht_away
 *   game_stats       — por jogo × time (nova)
 *   game_player_stats— por jogo × jogador (nova)
 *   game_events      — eventos do jogo (gols, cartões, etc.) (nova)
 */

import { corsHeaders } from './health.js';
import { isValidIngestSecret } from '../utils/ingestAuth.js';

function ok(data)          { return new Response(JSON.stringify({ ok: true, ...data }),  { status: 200, headers: corsHeaders() }); }
function err(msg, s = 400) { return new Response(JSON.stringify({ ok: false, error: msg }), { status: s, headers: corsHeaders() }); }

// ── upsert games ──────────────────────────────────────────────────────────────

async function upsertGame(db, g) {
  await db.prepare(`
    INSERT INTO games (
      id, sport, home_team, away_team, league,
      game_date, status,
      score_home, score_away, score_ht_home, score_ht_away,
      source, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      status        = excluded.status,
      score_home    = excluded.score_home,
      score_away    = excluded.score_away,
      score_ht_home = excluded.score_ht_home,
      score_ht_away = excluded.score_ht_away,
      updated_at    = datetime('now')
  `).bind(
    g.external_id, g.sport, g.home_team, g.away_team, g.league ?? null,
    g.game_date ?? null, g.status ?? 'UNKNOWN',
    g.home_score ?? null, g.away_score ?? null,
    g.home_ht ?? null, g.away_ht ?? null,
    g.source ?? 'collector'
  ).run();
}

// ── upsert game_stats (per-game team stats) ────────────────────────────────

async function upsertGameStat(db, s) {
  await db.prepare(`
    INSERT INTO game_stats (
      game_id, team_name, sport, league, is_home,
      goals, shots, shots_on_target, corners, fouls,
      yellow_cards, red_cards, possession, offsides, saves,
      passes, pass_accuracy, xg,
      points, rebounds, assists, blocks, steals, turnovers,
      fg_pct, three_pt_pct, ft_pct, pace, ortg, drtg,
      updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(game_id, team_name) DO UPDATE SET
      goals           = excluded.goals,
      shots           = excluded.shots,
      shots_on_target = excluded.shots_on_target,
      corners         = excluded.corners,
      fouls           = excluded.fouls,
      yellow_cards    = excluded.yellow_cards,
      red_cards       = excluded.red_cards,
      possession      = excluded.possession,
      offsides        = excluded.offsides,
      saves           = excluded.saves,
      passes          = excluded.passes,
      pass_accuracy   = excluded.pass_accuracy,
      xg              = excluded.xg,
      points          = excluded.points,
      rebounds        = excluded.rebounds,
      assists         = excluded.assists,
      blocks          = excluded.blocks,
      steals          = excluded.steals,
      turnovers       = excluded.turnovers,
      fg_pct          = excluded.fg_pct,
      three_pt_pct    = excluded.three_pt_pct,
      ft_pct          = excluded.ft_pct,
      pace            = excluded.pace,
      ortg            = excluded.ortg,
      drtg            = excluded.drtg,
      updated_at      = datetime('now')
  `).bind(
    s.game_external_id, s.team_name, s.sport, s.league ?? null, s.is_home ? 1 : 0,
    s.goals ?? null, s.shots ?? null, s.shots_on_target ?? null,
    s.corners ?? null, s.fouls ?? null,
    s.yellow_cards ?? null, s.red_cards ?? null,
    s.possession ?? null, s.offsides ?? null, s.saves ?? null,
    s.passes ?? null, s.pass_accuracy ?? null, s.xg ?? null,
    s.points ?? null, s.rebounds ?? null, s.assists ?? null,
    s.blocks ?? null, s.steals ?? null, s.turnovers ?? null,
    s.fg_pct ?? null, s.three_pt_pct ?? null, s.ft_pct ?? null,
    s.pace ?? null, s.ortg ?? null, s.drtg ?? null
  ).run();
}

// ── upsert game_player_stats ──────────────────────────────────────────────────

async function upsertPlayerStat(db, p) {
  await db.prepare(`
    INSERT INTO game_player_stats (
      game_id, player_name, team_name, sport, league,
      position, minutes,
      goals, assists, shots, shots_on_target, yellow_cards, red_cards,
      key_passes, dribbles, tackles, interceptions, clearances,
      points, rebounds, reb_offensive, reb_defensive,
      nba_assists, blocks, steals, turnovers,
      fgm, fga, fg_pct, three_pm, three_pa, three_pct,
      ftm, fta, ft_pct, plus_minus,
      updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(game_id, player_name) DO UPDATE SET
      minutes         = excluded.minutes,
      goals           = excluded.goals,
      assists         = excluded.assists,
      shots           = excluded.shots,
      shots_on_target = excluded.shots_on_target,
      yellow_cards    = excluded.yellow_cards,
      red_cards       = excluded.red_cards,
      key_passes      = excluded.key_passes,
      dribbles        = excluded.dribbles,
      tackles         = excluded.tackles,
      interceptions   = excluded.interceptions,
      clearances      = excluded.clearances,
      points          = excluded.points,
      rebounds        = excluded.rebounds,
      reb_offensive   = excluded.reb_offensive,
      reb_defensive   = excluded.reb_defensive,
      nba_assists     = excluded.nba_assists,
      blocks          = excluded.blocks,
      steals          = excluded.steals,
      turnovers       = excluded.turnovers,
      fgm             = excluded.fgm,
      fga             = excluded.fga,
      fg_pct          = excluded.fg_pct,
      three_pm        = excluded.three_pm,
      three_pa        = excluded.three_pa,
      three_pct       = excluded.three_pct,
      ftm             = excluded.ftm,
      fta             = excluded.fta,
      ft_pct          = excluded.ft_pct,
      plus_minus      = excluded.plus_minus,
      updated_at      = datetime('now')
  `).bind(
    p.game_external_id, p.player_name, p.team_name ?? null, p.sport, p.league ?? null,
    p.position ?? null, p.minutes ?? null,
    p.goals ?? null, p.assists ?? null, p.shots ?? null,
    p.shots_on_target ?? null, p.yellow_cards ?? null, p.red_cards ?? null,
    p.key_passes ?? null, p.dribbles ?? null, p.tackles ?? null,
    p.interceptions ?? null, p.clearances ?? null,
    p.points ?? null, p.rebounds ?? null, p.reb_offensive ?? null,
    p.reb_defensive ?? null, p.nba_assists ?? null,
    p.blocks ?? null, p.steals ?? null, p.turnovers ?? null,
    p.fgm ?? null, p.fga ?? null, p.fg_pct ?? null,
    p.three_pm ?? null, p.three_pa ?? null, p.three_pct ?? null,
    p.ftm ?? null, p.fta ?? null, p.ft_pct ?? null,
    p.plus_minus ?? null
  ).run();
}

// ── insert game_events ────────────────────────────────────────────────────────

async function insertEvent(db, ev) {
  await db.prepare(`
    INSERT INTO game_events
      (game_id, minute, event_type, team_name, player_name, player2_name, detail, value, period)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    ev.game_external_id, ev.minute ?? null, ev.event_type,
    ev.team_name ?? null, ev.player_name ?? null, ev.player2_name ?? null,
    ev.detail ?? null, ev.value ?? null, ev.period ?? null
  ).run();
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleIngest(request, env) {
  if (!isValidIngestSecret(request, env)) {
    return err('Unauthorized', 401);
  }

  if (!env.SB_DB) return err('Database not configured', 503);

  let body;
  try { body = await request.json(); }
  catch { return err('Invalid JSON body'); }

  const { game, team_stats = [], player_stats = [], events = [] } = body;

  if (!game?.external_id) return err('game.external_id is required');

  const saved = { game: 0, team_stats: 0, player_stats: 0, events: 0 };

  try {
    await upsertGame(env.SB_DB, game);
    saved.game = 1;
  } catch (e) {
    console.error('[Ingest] game error:', e.message);
    return err(`Game upsert failed: ${e.message}`, 500);
  }

  for (const s of team_stats) {
    try { await upsertGameStat(env.SB_DB, s); saved.team_stats++; }
    catch (e) { console.error('[Ingest] game_stats error:', e.message); }
  }

  for (const p of player_stats) {
    try { await upsertPlayerStat(env.SB_DB, p); saved.player_stats++; }
    catch (e) { console.error('[Ingest] player error:', e.message); }
  }

  for (const ev of events) {
    try { await insertEvent(env.SB_DB, ev); saved.events++; }
    catch (e) { /* silencia duplicatas */ }
  }

  return ok({ saved, game_id: game.external_id });
}
