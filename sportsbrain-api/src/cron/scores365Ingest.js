// scores365Ingest.js — F2.53
// Ingest play-by-play shots via 365Scores API pública (webws.365scores.com).
// Cobertura: Brasileirao A (compid=113), Brasileirao B (116), Libertadores (102),
// Sudamericana (389). Cada shot tem minute → permite split HT vs FT.
//
// chartEvents.events[]:
//   { time: "22'", competitorNum: 1|2, playerId, outcome: {name},
//     type, subType, status, xg, xgot, bodyPart }
//
// outcome.name: "Blocked" | "Missed" | "Saved" | "Goal"
//   on_target = (name === 'Saved' || name === 'Goal')
//   is_goal   = (name === 'Goal')

const S365_BASE = 'https://webws.365scores.com/web';
const HTTP_TIMEOUT_MS = 12_000;

const COMPETITION_IDS = {
  // Brasil + CONMEBOL
  113: { slug: '365|bra.1',                   name: 'Brasileirão Série A' },
  116: { slug: '365|bra.2',                   name: 'Brasileirão Série B' },
  102: { slug: '365|conmebol.libertadores',   name: 'CONMEBOL Libertadores' },
  389: { slug: '365|conmebol.sudamericana',   name: 'CONMEBOL Sudamericana' },
  // Top-5 europeias (HT real para todos os times principais)
  7:   { slug: '365|eng.1',  name: 'Premier League' },
  11:  { slug: '365|esp.1',  name: 'La Liga' },
  17:  { slug: '365|ita.1',  name: 'Serie A' },
  25:  { slug: '365|ger.1',  name: 'Bundesliga' },
  35:  { slug: '365|fra.1',  name: 'Ligue 1' },
  // Segunda divisão das grandes
  12:  { slug: '365|esp.2',  name: 'La Liga 2' },
  // Outras europeias relevantes
  73:  { slug: '365|por.1',  name: 'Primeira Liga' },
};

function normTeam(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b|\be\.?c\.?\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normPlayer(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return await res.json();
}

function parseMinute(timeStr) {
  // "22'" → 22 ; "45+2'" → 45 ; "" → null
  if (!timeStr) return null;
  const m = String(timeStr).replace(/['"]/g, '').split('+')[0];
  const n = parseInt(m, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lista games (allscores) num intervalo de datas para uma lista de competitionIds.
 * Filtra apenas games com hasStats=true E que terminaram (statusGroup=3) E
 * pertencem aos competitionIds de interesse.
 */
async function listGames(dateFrom, dateTo, competitionIds) {
  const url = `${S365_BASE}/games/allscores/?appTypeId=5&langId=1` +
    `&timezoneName=America/Sao_Paulo&userCountryId=21` +
    `&startDate=${dateFrom}&endDate=${dateTo}&sports=1`;
  const data = await fetchJson(url);
  const games = data?.games || [];
  const wantIds = new Set(competitionIds);
  return games.filter(g =>
    wantIds.has(g.competitionId) &&
    // statusGroup varia por liga (3 ou 4 = ended); checa statusText como sinal robusto
    (g.statusGroup === 3 || g.statusGroup === 4 || (g.statusText || '').startsWith('Ended')) &&
    g.hasStats === true
  );
}

/**
 * Pull game detail + extract shot events.
 * Returns { matchId, shots: [...], homeTeam, awayTeam, kickoff, leagueSlug }
 */
async function extractGameShots(gameId, gameMeta) {
  const url = `${S365_BASE}/game/?appTypeId=5&langId=1` +
    `&timezoneName=America/Sao_Paulo&userCountryId=21` +
    `&gameId=${gameId}&showLineups=true&showStatistics=true&showPlayerStatistics=true`;
  const data = await fetchJson(url);
  const g = data?.game || {};
  const ce = g.chartEvents || {};
  const events = ce.events || [];
  if (!events.length) return null;

  const homeName = g.homeCompetitor?.name || gameMeta.homeName;
  const awayName = g.awayCompetitor?.name || gameMeta.awayName;
  const matchId = `365|${gameId}`;
  const leagueSlug = COMPETITION_IDS[g.competitionId]?.slug || `365|${g.competitionId}`;

  // Members map para resolver playerId → name
  const memberById = new Map();
  for (const m of (g.members || [])) {
    if (m.athleteId) memberById.set(m.athleteId, m);
    if (m.id) memberById.set(m.id, m);
  }

  const shots = [];
  for (const e of events) {
    // 365Scores chartEvents só tem shot/goal events (type=0)
    if (e.type !== 0 && e.type !== undefined && e.type !== null) continue;
    const minute = parseMinute(e.time);
    const period = minute != null && minute > 45 ? 2 : 1;
    const isHome = e.competitorNum === 1;
    const teamName = isHome ? homeName : awayName;
    const outcomeName = (e.outcome || {}).name;
    const isGoal = outcomeName === 'Goal' ? 1 : 0;
    const onTarget = (outcomeName === 'Saved' || outcomeName === 'Goal') ? 1 : 0;
    const playerMember = memberById.get(e.playerId);
    const playerName = playerMember?.name || null;
    const playerNorm = normPlayer(playerName);
    const xgComputed = Number.parseFloat(e.xg) || 0;

    shots.push({
      match_id: matchId,
      team: teamName,
      team_norm: normTeam(teamName),
      player_name: playerName,
      assist_player: null,
      minute,
      period,
      shot_type: e.subType ? `subType_${e.subType}` : null,
      body_part: e.bodyPart || null,
      x_coord: e.line ?? null,
      y_coord: e.side ?? null,
      distance: null,
      angle_deg: null,
      on_target: onTarget,
      is_goal: isGoal,
      xg_computed: xgComputed,
      xg_model_ver: '365',
      is_home: isHome ? 1 : 0,
    });
  }

  return {
    matchId, leagueSlug, homeName, awayName,
    kickoff: g.startTime || gameMeta.startTime,
    shots,
  };
}

/**
 * Insere shots em shot_events. Idempotente (DELETE+INSERT por match_id).
 */
async function insertShots(env, gameData) {
  if (!gameData?.shots?.length) return 0;
  const matchId = gameData.matchId;
  await env.SB_DB.prepare(`DELETE FROM shot_events WHERE match_id = ?`).bind(matchId).run();
  const stmts = gameData.shots.map(s => env.SB_DB.prepare(`
    INSERT INTO shot_events (match_id, team, team_norm, player_name, assist_player,
      minute, period, shot_type, body_part, x_coord, y_coord, distance, angle_deg,
      on_target, is_goal, xg_computed, xg_model_ver, is_home)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    s.match_id, s.team, s.team_norm, s.player_name, s.assist_player,
    s.minute, s.period, s.shot_type, s.body_part, s.x_coord, s.y_coord,
    s.distance, s.angle_deg, s.on_target, s.is_goal,
    s.xg_computed, s.xg_model_ver, s.is_home,
  ));
  for (let i = 0; i < stmts.length; i += 80) {
    await env.SB_DB.batch(stmts.slice(i, i + 80));
  }
  return stmts.length;
}

/**
 * Ingest um range de datas para os competitionIds dados.
 * @param {object} env
 * @param {object} opts { dateFrom: 'DD/MM/YYYY', dateTo, competitionIds: [113,116,102,389], skipExisting }
 */
export async function ingest365Scores(env, opts = {}) {
  if (!env?.SB_DB) return { error: 'no db' };
  const dateFrom = opts.dateFrom;
  const dateTo = opts.dateTo || dateFrom;
  if (!dateFrom) return { error: 'dateFrom required' };
  const competitionIds = opts.competitionIds || Object.keys(COMPETITION_IDS).map(Number);

  const games = await listGames(dateFrom, dateTo, competitionIds);
  const stats = {
    dateFrom, dateTo, competitions: competitionIds.length,
    games_listed: games.length,
    games_with_shots: 0,
    total_shots_inserted: 0,
    errors: 0,
    sample_match: null,
  };

  for (const game of games) {
    try {
      // Skip se já temos shots desse match
      if (opts.skipExisting !== false) {
        const existing = await env.SB_DB.prepare(
          `SELECT COUNT(*) as c FROM shot_events WHERE match_id = ?`
        ).bind(`365|${game.id}`).first();
        if (existing?.c > 0) continue;
      }
      const gameData = await extractGameShots(game.id, {
        homeName: game.homeCompetitor?.name,
        awayName: game.awayCompetitor?.name,
        startTime: game.startTime,
      });
      if (!gameData?.shots?.length) continue;
      const inserted = await insertShots(env, gameData);
      stats.games_with_shots++;
      stats.total_shots_inserted += inserted;
      if (!stats.sample_match) {
        stats.sample_match = `${gameData.homeName} v ${gameData.awayName} (${inserted} shots)`;
      }
    } catch (e) {
      stats.errors++;
      if (!stats.errorSample) stats.errorSample = `${game.id}: ${e.message}`;
    }
  }
  return stats;
}

/**
 * Backfill maior — itera por buckets de dias.
 * Ex: backfill365(env, { fromDate: new Date('2026-01-01'), toDate: new Date() })
 */
export async function backfill365Scores(env, opts = {}) {
  const fromDate = opts.fromDate ? new Date(opts.fromDate) : new Date(Date.now() - 60 * 86_400_000);
  const toDate = opts.toDate ? new Date(opts.toDate) : new Date();
  const bucketDays = opts.bucketDays || 7;
  const competitionIds = opts.competitionIds || Object.keys(COMPETITION_IDS).map(Number);

  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  const results = [];
  let cursor = new Date(fromDate);
  while (cursor <= toDate) {
    const bucketEnd = new Date(cursor);
    bucketEnd.setDate(bucketEnd.getDate() + bucketDays - 1);
    if (bucketEnd > toDate) bucketEnd.setTime(toDate.getTime());
    try {
      const r = await ingest365Scores(env, {
        dateFrom: fmt(cursor),
        dateTo: fmt(bucketEnd),
        competitionIds,
        skipExisting: true,
      });
      results.push(r);
    } catch (e) {
      results.push({ dateFrom: fmt(cursor), error: e.message });
    }
    cursor.setDate(cursor.getDate() + bucketDays);
  }

  const totalShots = results.reduce((a, r) => a + (r.total_shots_inserted || 0), 0);
  const totalGames = results.reduce((a, r) => a + (r.games_with_shots || 0), 0);
  return {
    fromDate: fmt(fromDate),
    toDate: fmt(toDate),
    buckets: results.length,
    total_games: totalGames,
    total_shots: totalShots,
    per_bucket: results.length <= 20 ? results : results.slice(-20),
  };
}
