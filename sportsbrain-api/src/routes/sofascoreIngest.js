// src/routes/sofascoreIngest.js
// POST /internal/sofascore-ingest
// Recebe dados do SofaScore (buscados pelo self-hosted runner) e armazena no D1.

import { updateSofaScoreHealth } from '../services/sofascore.js';
import { isValidIngestSecret } from '../utils/ingestAuth.js';

function corsHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...extra,
  };
}

export async function handleSofaScoreIngest(request, env) {
  // Auth — contrato único de ingest (Fase 1)
  if (!isValidIngestSecret(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: corsHeaders(),
    });
  }

  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), {
      status: 503, headers: corsHeaders(),
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400, headers: corsHeaders(),
    });
  }

  const { date, sport = 'football', events = [], stats = [], teams = [], playerStats = [] } = body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_date' }), {
      status: 400, headers: corsHeaders(),
    });
  }

  let eventsInserted = 0;
  let statsInserted = 0;
  let teamsUpserted = 0;
  let playerStatsInserted = 0;
  const errors = [];

  try {
    const now = Date.now();
    const BATCH_SIZE = 50;

    // ── Ensure tables exist (idempotent — runs once then is a fast no-op) ────
    // Use prepare().run() — exec() splits on newlines and treats each line as
    // a separate SQL statement, breaking multi-line CREATE TABLE DDL.
    // Two sequential awaits: CREATEs first, then ALTERs (ALTER requires table to exist).
    await Promise.allSettled([
      // sofascore_events — with home_team_id, away_team_id columns
      env.SB_DB.prepare('CREATE TABLE IF NOT EXISTS sofascore_events (id INTEGER PRIMARY KEY AUTOINCREMENT, norm_key TEXT NOT NULL, event_date TEXT NOT NULL, ss_event_id INTEGER NOT NULL, sport TEXT NOT NULL DEFAULT \'football\', home_team TEXT NOT NULL, away_team TEXT NOT NULL, home_team_id INTEGER, away_team_id INTEGER, home_score INTEGER, away_score INTEGER, home_ht INTEGER, away_ht INTEGER, status TEXT NOT NULL DEFAULT \'finished\', league TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, UNIQUE(norm_key, event_date, sport))').run(),
      // sofascore_teams — new: id→name mapping, populated by daily ingest
      env.SB_DB.prepare('CREATE TABLE IF NOT EXISTS sofascore_teams (ss_team_id INTEGER PRIMARY KEY, team_name TEXT NOT NULL, team_name_norm TEXT NOT NULL DEFAULT \'\', last_seen_at INTEGER DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)').run(),
      // sofascore_stats — unchanged
      env.SB_DB.prepare('CREATE TABLE IF NOT EXISTS sofascore_stats (ss_event_id INTEGER PRIMARY KEY, corner_home INTEGER DEFAULT 0, corner_away INTEGER DEFAULT 0, shots_home INTEGER DEFAULT 0, shots_away INTEGER DEFAULT 0, shots_on_target_home INTEGER DEFAULT 0, shots_on_target_away INTEGER DEFAULT 0, yellow_home INTEGER DEFAULT 0, yellow_away INTEGER DEFAULT 0, red_home INTEGER DEFAULT 0, red_away INTEGER DEFAULT 0, fouls_home INTEGER DEFAULT 0, fouls_away INTEGER DEFAULT 0, offsides_home INTEGER DEFAULT 0, offsides_away INTEGER DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)').run(),
      // sofascore_health — unchanged
      env.SB_DB.prepare('CREATE TABLE IF NOT EXISTS sofascore_health (id INTEGER PRIMARY KEY, last_ingest_at INTEGER DEFAULT 0, last_ingest_date TEXT DEFAULT \'\', events_today INTEGER DEFAULT 0, stats_today INTEGER DEFAULT 0, last_error TEXT DEFAULT \'\', updated_at INTEGER NOT NULL DEFAULT 0)').run()
        .then(() => env.SB_DB.prepare('INSERT OR IGNORE INTO sofascore_health (id) VALUES (1)').run()),
    ]);
    // Column migrations run after CREATEs to guarantee table exists (ALTER fails silently if column exists)
    await Promise.allSettled([
      env.SB_DB.prepare('ALTER TABLE sofascore_events ADD COLUMN home_team_id INTEGER').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_events ADD COLUMN away_team_id INTEGER').run(),
      // F2.43: HT breakdown stats (1st half) — required for buildHtChutes real data
      env.SB_DB.prepare('ALTER TABLE sofascore_stats ADD COLUMN ht_corner_home INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_stats ADD COLUMN ht_corner_away INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_stats ADD COLUMN ht_shots_home INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_stats ADD COLUMN ht_shots_away INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_stats ADD COLUMN ht_shots_on_target_home INTEGER DEFAULT 0').run(),
      env.SB_DB.prepare('ALTER TABLE sofascore_stats ADD COLUMN ht_shots_on_target_away INTEGER DEFAULT 0').run(),
      // F2.43: player_stats table for CHUTES method baseline
      env.SB_DB.prepare(`CREATE TABLE IF NOT EXISTS sofascore_player_stats (
        ss_event_id INTEGER NOT NULL,
        ss_player_id INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        team TEXT NOT NULL DEFAULT '',
        total_shots INTEGER DEFAULT 0,
        shots_on_target INTEGER DEFAULT 0,
        minutes_played INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ss_event_id, ss_player_id)
      )`).run(),
    ]);

    // ── Events ───────────────────────────────────────────────────────────────
    // D1 batch() sends up to BATCH_SIZE statements per API call (vs. 1 call each).
    const EVENT_SQL = `INSERT OR REPLACE INTO sofascore_events
      (norm_key, event_date, ss_event_id, sport, home_team, away_team,
       home_team_id, away_team_id,
       home_score, away_score, home_ht, away_ht, status, league, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const validEvents = events.filter(ev => ev.normKey && ev.ssEventId);
    for (let i = 0; i < validEvents.length; i += BATCH_SIZE) {
      const chunk = validEvents.slice(i, i + BATCH_SIZE);
      const stmts = chunk.map(ev =>
        env.SB_DB.prepare(EVENT_SQL).bind(
          ev.normKey, date, ev.ssEventId, sport,
          ev.homeTeam || '', ev.awayTeam || '',
          ev.homeTeamId ?? null, ev.awayTeamId ?? null,
          ev.homeScore ?? null, ev.awayScore ?? null,
          ev.homeHt ?? null, ev.awayHt ?? null,
          ev.status || 'finished', ev.league || null,
          now, now
        )
      );
      const results = await env.SB_DB.batch(stmts);
      eventsInserted += results.filter(r => r.success !== false).length;
    }

    // ── Stats (F2.43: + HT breakdown) ────────────────────────────────────────
    const STATS_SQL = `INSERT OR REPLACE INTO sofascore_stats
      (ss_event_id, corner_home, corner_away, shots_home, shots_away,
       shots_on_target_home, shots_on_target_away,
       yellow_home, yellow_away, red_home, red_away,
       fouls_home, fouls_away, offsides_home, offsides_away,
       ht_corner_home, ht_corner_away, ht_shots_home, ht_shots_away,
       ht_shots_on_target_home, ht_shots_on_target_away,
       created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const validStats = stats.filter(s => s.ssEventId);
    for (let i = 0; i < validStats.length; i += BATCH_SIZE) {
      const chunk = validStats.slice(i, i + BATCH_SIZE);
      const stmts = chunk.map(s =>
        env.SB_DB.prepare(STATS_SQL).bind(
          s.ssEventId,
          s.cornerHome   ?? 0, s.cornerAway   ?? 0,
          s.shotsHome    ?? 0, s.shotsAway    ?? 0,
          s.shotsOnTargetHome ?? 0, s.shotsOnTargetAway ?? 0,
          s.yellowHome   ?? 0, s.yellowAway   ?? 0,
          s.redHome      ?? 0, s.redAway      ?? 0,
          s.foulsHome    ?? 0, s.foulsAway    ?? 0,
          s.offsidesHome ?? 0, s.offsidesAway ?? 0,
          s.htCornerHome ?? 0, s.htCornerAway ?? 0,
          s.htShotsHome  ?? 0, s.htShotsAway  ?? 0,
          s.htShotsOnTargetHome ?? 0, s.htShotsOnTargetAway ?? 0,
          now, now
        )
      );
      const results = await env.SB_DB.batch(stmts);
      statsInserted += results.filter(r => r.success !== false).length;
    }

    // ── Player Stats (F2.43: CHUTES baseline) ────────────────────────────────
    const PLAYER_STATS_SQL = `INSERT OR REPLACE INTO sofascore_player_stats
      (ss_event_id, ss_player_id, player_name, team, total_shots, shots_on_target, minutes_played, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const validPlayerStats = playerStats.filter(p => p.ssEventId && p.ssPlayerId && p.playerName);
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

    // ── Teams ────────────────────────────────────────────────────────────────
    const validTeams = teams.filter(t => t.ssTeamId);
    if (validTeams.length > 0) {
      const normTeamName = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const TEAMS_SQL = `INSERT OR REPLACE INTO sofascore_teams (ss_team_id, team_name, team_name_norm, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)`;
      for (let i = 0; i < validTeams.length; i += BATCH_SIZE) {
        const chunk = validTeams.slice(i, i + BATCH_SIZE);
        const stmts = chunk.map(t =>
          env.SB_DB.prepare(TEAMS_SQL).bind(t.ssTeamId, t.teamName || '', normTeamName(t.teamName), now, now)
        );
        const results = await env.SB_DB.batch(stmts);
        teamsUpserted += results.filter(r => r.success !== false).length;
      }
    }

    // ── Health ───────────────────────────────────────────────────────────────
    await updateSofaScoreHealth(env, {
      date,
      eventsToday: eventsInserted,
      statsToday: statsInserted,
      error: '',
    }).catch(() => {});

  } catch (e) {
    errors.push(e.message);
    console.error(`[SofaScoreIngest] fatal: ${e.message}\n${e.stack}`);
  }

  console.log(`[SofaScoreIngest] date=${date} events=${eventsInserted} stats=${statsInserted} teams=${teamsUpserted} player_stats=${playerStatsInserted} errors=${errors.length}`);

  return new Response(JSON.stringify({
    ok: errors.length === 0,
    date,
    sport,
    events_inserted: eventsInserted,
    stats_inserted: statsInserted,
    teams_upserted: teamsUpserted,
    player_stats_inserted: playerStatsInserted,
    errors: errors.length > 0 ? errors : undefined,
  }), { status: errors.length > 0 && eventsInserted === 0 ? 500 : 200, headers: corsHeaders() });
}
