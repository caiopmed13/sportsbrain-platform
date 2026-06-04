// src/routes/sofascoreHistoricalIngest.js
// POST /internal/sofascore/ingest-team-history
// Recebe histórico de 1 ano de jogos de um time e armazena no D1.

import { isValidIngestSecret } from '../utils/ingestAuth.js';

const BATCH_SIZE = 50;

function corsHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extra };
}

// All DDL on single lines — D1's prepare().run() is safe; exec() splits on \n and silently fails.
const TEAM_MATCHES_DDL = 'CREATE TABLE IF NOT EXISTS sofascore_team_matches (ss_event_id INTEGER NOT NULL, ss_team_id INTEGER NOT NULL, side TEXT NOT NULL, event_date TEXT NOT NULL, opponent_team_id INTEGER, opponent_name TEXT NOT NULL DEFAULT \'\', home_team_id INTEGER, away_team_id INTEGER, home_team_name TEXT NOT NULL DEFAULT \'\', away_team_name TEXT NOT NULL DEFAULT \'\', home_score INTEGER, away_score INTEGER, home_ht INTEGER, away_ht INTEGER, corner_home INTEGER DEFAULT 0, corner_away INTEGER DEFAULT 0, shots_home INTEGER DEFAULT 0, shots_away INTEGER DEFAULT 0, shots_on_target_home INTEGER DEFAULT 0, shots_on_target_away INTEGER DEFAULT 0, yellow_home INTEGER DEFAULT 0, yellow_away INTEGER DEFAULT 0, red_home INTEGER DEFAULT 0, red_away INTEGER DEFAULT 0, fouls_home INTEGER DEFAULT 0, fouls_away INTEGER DEFAULT 0, offsides_home INTEGER DEFAULT 0, offsides_away INTEGER DEFAULT 0, league TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ss_event_id, ss_team_id))';
const BACKFILL_RUNS_DDL = 'CREATE TABLE IF NOT EXISTS sofascore_backfill_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ss_team_id INTEGER NOT NULL, team_name TEXT NOT NULL DEFAULT \'\', pages_fetched INTEGER DEFAULT 0, matches_inserted INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT \'running\', started_at INTEGER NOT NULL DEFAULT 0, finished_at INTEGER, error TEXT)';
const TEAMS_DDL = 'CREATE TABLE IF NOT EXISTS sofascore_teams (ss_team_id INTEGER PRIMARY KEY, team_name TEXT NOT NULL, team_name_norm TEXT NOT NULL DEFAULT \'\', last_seen_at INTEGER DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)';

// F2.45: + HT breakdown cols
const TEAM_MATCH_SQL = `INSERT OR REPLACE INTO sofascore_team_matches (ss_event_id, ss_team_id, side, event_date, opponent_team_id, opponent_name, home_team_id, away_team_id, home_team_name, away_team_name, home_score, away_score, home_ht, away_ht, corner_home, corner_away, shots_home, shots_away, shots_on_target_home, shots_on_target_away, yellow_home, yellow_away, red_home, red_away, fouls_home, fouls_away, offsides_home, offsides_away, ht_corner_home, ht_corner_away, ht_shots_home, ht_shots_away, ht_shots_on_target_home, ht_shots_on_target_away, league, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export async function handleSofaScoreHistoricalIngest(request, env) {
  // ── Auth — contrato único de ingest (Fase 1) ──────────────────────────────
  if (!isValidIngestSecret(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
  }
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), { status: 400, headers: corsHeaders() }); }

  const { teamId, teamName = '', matches = [], pagesFetched = 0, playerStats = [] } = body;
  if (!teamId || typeof teamId !== 'number') {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_team_id' }), { status: 400, headers: corsHeaders() });
  }

  let matchesInserted = 0;
  let playerStatsInserted = 0;
  const errors = [];
  const now = Date.now();

  try {
    // ── Ensure tables exist (idempotent) ────────────────────────────────────
    await Promise.allSettled([
      env.SB_DB.prepare(TEAM_MATCHES_DDL).run(),
      env.SB_DB.prepare(BACKFILL_RUNS_DDL).run(),
      env.SB_DB.prepare(TEAMS_DDL).run(),
      // F2.45: HT columns + player_stats (idempotent — ALTER falha silenciosamente se existe)
      env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_corner_home INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_corner_away INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_home INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_away INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_on_target_home INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_on_target_away INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare(`CREATE TABLE IF NOT EXISTS sofascore_player_stats (
        ss_event_id INTEGER NOT NULL, ss_player_id INTEGER NOT NULL,
        player_name TEXT NOT NULL, team TEXT NOT NULL DEFAULT '',
        total_shots INTEGER DEFAULT 0, shots_on_target INTEGER DEFAULT 0, minutes_played INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ss_event_id, ss_player_id)
      )`).run(),
    ]);

    // ── Record backfill run start ────────────────────────────────────────────
    const runInsert = await env.SB_DB.prepare(
      'INSERT INTO sofascore_backfill_runs (ss_team_id, team_name, pages_fetched, status, started_at) VALUES (?, ?, ?, \'running\', ?)'
    ).bind(teamId, teamName, pagesFetched, now).run().catch(() => null);
    const runId = runInsert?.meta?.last_row_id ?? runInsert?.meta?.lastRowId ?? null;

    // ── Insert matches in batches ────────────────────────────────────────────
    const validMatches = matches.filter(m => m.ssEventId && m.eventDate && m.side);
    for (let i = 0; i < validMatches.length; i += BATCH_SIZE) {
      const chunk = validMatches.slice(i, i + BATCH_SIZE);
      const stmts = chunk.map(m =>
        env.SB_DB.prepare(TEAM_MATCH_SQL).bind(
          m.ssEventId, teamId, m.side, m.eventDate,
          m.opponentTeamId ?? null, m.opponentName || '',
          m.homeTeamId ?? null, m.awayTeamId ?? null,
          m.homeTeamName || '', m.awayTeamName || '',
          m.homeScore ?? null, m.awayScore ?? null,
          m.homeHt ?? null, m.awayHt ?? null,
          m.cornerHome ?? 0, m.cornerAway ?? 0,
          m.shotsHome ?? 0, m.shotsAway ?? 0,
          m.shotsOnTargetHome ?? 0, m.shotsOnTargetAway ?? 0,
          m.yellowHome ?? 0, m.yellowAway ?? 0,
          m.redHome ?? 0, m.redAway ?? 0,
          m.foulsHome ?? 0, m.foulsAway ?? 0,
          m.offsidesHome ?? 0, m.offsidesAway ?? 0,
          m.htCornerHome ?? 0, m.htCornerAway ?? 0,
          m.htShotsHome  ?? 0, m.htShotsAway  ?? 0,
          m.htShotsOnTargetHome ?? 0, m.htShotsOnTargetAway ?? 0,
          m.league ?? null,
          now, now
        )
      );
      const results = await env.SB_DB.batch(stmts);
      matchesInserted += results.filter(r => r.success !== false).length;
    }

    // F2.45: Player stats batch
    const PLAYER_STATS_SQL = `INSERT OR REPLACE INTO sofascore_player_stats
      (ss_event_id, ss_player_id, player_name, team, total_shots, shots_on_target, minutes_played, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const validPlayerStats = (playerStats || []).filter(p => p.ssEventId && p.ssPlayerId && p.playerName);
    for (let i = 0; i < validPlayerStats.length; i += BATCH_SIZE) {
      const chunk = validPlayerStats.slice(i, i + BATCH_SIZE);
      const stmts = chunk.map(p =>
        env.SB_DB.prepare(PLAYER_STATS_SQL).bind(
          p.ssEventId, p.ssPlayerId, p.playerName, p.team || '',
          p.totalShots ?? 0, p.shotsOnTarget ?? 0, p.minutesPlayed ?? 0,
          now, now
        )
      );
      const results = await env.SB_DB.batch(stmts);
      playerStatsInserted += results.filter(r => r.success !== false).length;
    }

    // ── Mark run done ────────────────────────────────────────────────────────
    if (runId) {
      await env.SB_DB.prepare(
        'UPDATE sofascore_backfill_runs SET status=\'done\', matches_inserted=?, finished_at=? WHERE id=?'
      ).bind(matchesInserted, Date.now(), runId).run().catch(() => {});
    }

    // ── Upsert team in sofascore_teams (in case daily ingest hasn't run yet) ─
    const normTeamName = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    await env.SB_DB.prepare(
      'INSERT OR REPLACE INTO sofascore_teams (ss_team_id, team_name, team_name_norm, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(teamId, teamName, normTeamName(teamName), now, now).run().catch(() => {});

  } catch (e) {
    errors.push(e.message);
    console.error(`[SofaScoreHistoricalIngest] team=${teamId} fatal: ${e.message}\n${e.stack}`);
  }

  console.log(`[SofaScoreHistoricalIngest] team=${teamId}(${teamName}) matches=${matchesInserted} errors=${errors.length}`);

  return new Response(JSON.stringify({
    ok: errors.length === 0,
    teamId, teamName,
    matches_inserted: matchesInserted,
    player_stats_inserted: playerStatsInserted,
    errors: errors.length > 0 ? errors : undefined,
  }), { status: errors.length > 0 && matchesInserted === 0 ? 500 : 200, headers: corsHeaders() });
}
