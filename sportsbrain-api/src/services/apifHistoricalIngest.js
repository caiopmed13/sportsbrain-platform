// apifHistoricalIngest.js — F2.46
// Substituto temporário do Sofascore enquanto o scraper deles está bloqueado.
// Usa api-football (RapidAPI) — você já paga pela key. Sem 403 challenge.
//
// Fluxo:
//   1. GET /fixtures?date=YYYY-MM-DD → lista de jogos finalizados
//   2. Para cada fixture:
//      a. GET /fixtures/statistics?fixture=X → corners/shots/cards full-match
//      b. GET /fixtures/players?fixture=X → per-player shots/minutes
//   3. HT estimado: full-match × 0.40 (baseline estatístico)
//   4. Persiste em sofascore_team_matches + sofascore_player_stats
//      (mesmo schema, mantém downstream igual)

const APIF_HOST = 'api-football-v1.p.rapidapi.com';
const APIF_BASE = `https://${APIF_HOST}/v3`;
// Ratio HT/full-match — média empírica em ligas top.
// Shots: HT ≈ 40-45% do total. Corners: HT ≈ 40-45%.
const HT_RATIO = 0.42;

function _fetchApif(url, apiKey, timeout = 10000) {
  return fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': APIF_HOST,
    },
    signal: AbortSignal.timeout(timeout),
  });
}

/**
 * Lista fixtures finalizadas (status FT/AET/PEN) de uma data.
 */
export async function fetchFixturesByDate(env, date) {
  if (!env.API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY missing');
  const res = await _fetchApif(`${APIF_BASE}/fixtures?date=${date}`, env.API_FOOTBALL_KEY);
  if (!res.ok) throw new Error(`apif /fixtures HTTP ${res.status}`);
  const json = await res.json();
  return (json.response || []).filter(f => {
    const s = f.fixture?.status?.short;
    return s === 'FT' || s === 'AET' || s === 'PEN';
  });
}

/**
 * Stats full-match de 1 fixture.
 * Retorna { home, away } com corners, shots, shots_on_target, etc.
 */
export async function fetchFixtureStats(env, fixtureId) {
  if (!env.API_FOOTBALL_KEY) return null;
  try {
    const res = await _fetchApif(`${APIF_BASE}/fixtures/statistics?fixture=${fixtureId}`, env.API_FOOTBALL_KEY);
    if (!res.ok) return null;
    const json = await res.json();
    const arr = json.response || [];
    if (arr.length !== 2) return null;
    const parse = (statsArr) => {
      const out = {};
      for (const s of (statsArr.statistics || [])) {
        const k = (s.type || '').toLowerCase();
        const v = parseFloat(s.value) || 0;
        if (/corner/.test(k)) out.corners = v;
        else if (/total\s*shot/.test(k)) out.shots = v;
        else if (/shot.*on.*goal|on\s*target/.test(k)) out.shotsOnTarget = v;
        else if (/yellow.*card/.test(k)) out.yellow = v;
        else if (/red.*card/.test(k)) out.red = v;
        else if (/^fouls/.test(k)) out.fouls = v;
        else if (/offside/.test(k)) out.offsides = v;
      }
      return out;
    };
    return { home: parse(arr[0]), away: parse(arr[1]) };
  } catch { return null; }
}

/**
 * Player stats por fixture — shots/on_target/minutes.
 */
export async function fetchFixturePlayerStats(env, fixtureId) {
  if (!env.API_FOOTBALL_KEY) return [];
  try {
    const res = await _fetchApif(`${APIF_BASE}/fixtures/players?fixture=${fixtureId}`, env.API_FOOTBALL_KEY);
    if (!res.ok) return [];
    const json = await res.json();
    const teams = json.response || [];
    const out = [];
    for (const teamBlock of teams) {
      const sideName = teamBlock.team?.name || '';
      const isHome = false; // api-football retorna ambos os times no array; precisamos cruzar via fixture data
      for (const p of (teamBlock.players || [])) {
        const stats = p.statistics?.[0] || {};
        const shots = stats.shots || {};
        const games = stats.games || {};
        const playerId = p.player?.id;
        const playerName = p.player?.name;
        if (!playerId || !playerName) continue;
        out.push({
          ssEventId: fixtureId,            // reusa campo "ss_event_id" do schema
          ssPlayerId: playerId,
          playerName,
          team: sideName.slice(0, 30),     // armazena nome do time (vs side home/away)
          totalShots: +shots.total || 0,
          shotsOnTarget: +shots.on || 0,
          minutesPlayed: +games.minutes || 0,
        });
      }
    }
    return out;
  } catch { return []; }
}

/**
 * Normaliza nome do time pra D1 (NFD lowercase).
 */
function _normTeamName(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ingere stats de 1 fixture nos D1 (sofascore_team_matches + sofascore_player_stats).
 * Estima HT cols via HT_RATIO.
 */
async function ingestFixture(env, fixture, fullStats, playerStats) {
  if (!env.SB_DB || !fixture?.fixture?.id) return { matchInserted: 0, playerInserted: 0 };
  const fixId = fixture.fixture.id;
  const date = new Date(fixture.fixture.date).toISOString().slice(0, 10);
  const home = fixture.teams.home;
  const away = fixture.teams.away;
  const league = fixture.league?.name || null;
  const homeScore = fixture.goals.home;
  const awayScore = fixture.goals.away;
  const homeHt = fixture.score?.halftime?.home ?? null;
  const awayHt = fixture.score?.halftime?.away ?? null;
  const now = Date.now();

  // HT estimado
  const ht = fullStats || { home: {}, away: {} };
  const htCornerH = Math.round((ht.home?.corners || 0) * HT_RATIO);
  const htCornerA = Math.round((ht.away?.corners || 0) * HT_RATIO);
  const htShotsH  = Math.round((ht.home?.shots   || 0) * HT_RATIO);
  const htShotsA  = Math.round((ht.away?.shots   || 0) * HT_RATIO);
  const htSotH    = Math.round((ht.home?.shotsOnTarget || 0) * HT_RATIO);
  const htSotA    = Math.round((ht.away?.shotsOnTarget || 0) * HT_RATIO);

  // Upsert times em sofascore_teams (id→name) — usa fixture team ids
  await env.SB_DB.prepare(
    `INSERT OR REPLACE INTO sofascore_teams (ss_team_id, team_name, team_name_norm, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(home.id, home.name, _normTeamName(home.name), now, now).run().catch(() => {});
  await env.SB_DB.prepare(
    `INSERT OR REPLACE INTO sofascore_teams (ss_team_id, team_name, team_name_norm, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(away.id, away.name, _normTeamName(away.name), now, now).run().catch(() => {});

  // sofascore_team_matches — 2 rows (1 por team perspective)
  const TM_SQL = `INSERT OR REPLACE INTO sofascore_team_matches (
    ss_event_id, ss_team_id, side, event_date,
    opponent_team_id, opponent_name,
    home_team_id, away_team_id, home_team_name, away_team_name,
    home_score, away_score, home_ht, away_ht,
    corner_home, corner_away, shots_home, shots_away,
    shots_on_target_home, shots_on_target_away,
    yellow_home, yellow_away, red_home, red_away,
    fouls_home, fouls_away, offsides_home, offsides_away,
    ht_corner_home, ht_corner_away, ht_shots_home, ht_shots_away,
    ht_shots_on_target_home, ht_shots_on_target_away,
    league, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const commonArgs = [
    fixId, /* ss_team_id */ 0, /* side */ '', date,
    /* opponent */ 0, '',
    home.id, away.id, home.name, away.name,
    homeScore, awayScore, homeHt, awayHt,
    ht.home?.corners || 0, ht.away?.corners || 0,
    ht.home?.shots   || 0, ht.away?.shots   || 0,
    ht.home?.shotsOnTarget || 0, ht.away?.shotsOnTarget || 0,
    ht.home?.yellow || 0, ht.away?.yellow || 0,
    ht.home?.red    || 0, ht.away?.red    || 0,
    ht.home?.fouls  || 0, ht.away?.fouls  || 0,
    ht.home?.offsides || 0, ht.away?.offsides || 0,
    htCornerH, htCornerA, htShotsH, htShotsA, htSotH, htSotA,
    league, now, now
  ];

  let matchInserted = 0;
  // row 1: home perspective
  const homeArgs = [...commonArgs];
  homeArgs[1] = home.id;
  homeArgs[2] = 'home';
  homeArgs[4] = away.id;
  homeArgs[5] = away.name;
  await env.SB_DB.prepare(TM_SQL).bind(...homeArgs).run().catch(e => console.warn('apif ingest home:', e?.message));
  matchInserted++;

  // row 2: away perspective
  const awayArgs = [...commonArgs];
  awayArgs[1] = away.id;
  awayArgs[2] = 'away';
  awayArgs[4] = home.id;
  awayArgs[5] = home.name;
  await env.SB_DB.prepare(TM_SQL).bind(...awayArgs).run().catch(e => console.warn('apif ingest away:', e?.message));
  matchInserted++;

  // sofascore_player_stats — batch
  let playerInserted = 0;
  const PS_SQL = `INSERT OR REPLACE INTO sofascore_player_stats
    (ss_event_id, ss_player_id, player_name, team, total_shots, shots_on_target, minutes_played, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  for (const p of (playerStats || [])) {
    if (!p.ssPlayerId || !p.playerName) continue;
    await env.SB_DB.prepare(PS_SQL).bind(
      fixId, p.ssPlayerId, p.playerName, p.team || '',
      p.totalShots ?? 0, p.shotsOnTarget ?? 0, p.minutesPlayed ?? 0,
      now, now
    ).run().catch(e => console.warn('apif ingest player:', e?.message));
    playerInserted++;
  }

  return { matchInserted, playerInserted };
}

/**
 * MAIN entry — ingere todos os fixtures finalizados de UMA data.
 * Limita a `cap` fixtures (default 50) pra evitar quota burn.
 */
export async function ingestApifDate(env, date, cap = 50) {
  if (!env.SB_DB) return { error: 'no db' };
  if (!env.API_FOOTBALL_KEY) return { error: 'no api key' };

  // Ensure schema (idempotent ALTER + CREATE)
  await Promise.allSettled([
    env.SB_DB.prepare(`CREATE TABLE IF NOT EXISTS sofascore_teams (ss_team_id INTEGER PRIMARY KEY, team_name TEXT NOT NULL, team_name_norm TEXT NOT NULL DEFAULT '', last_seen_at INTEGER DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`).run(),
    env.SB_DB.prepare(`CREATE TABLE IF NOT EXISTS sofascore_team_matches (ss_event_id INTEGER NOT NULL, ss_team_id INTEGER NOT NULL, side TEXT NOT NULL, event_date TEXT NOT NULL, opponent_team_id INTEGER, opponent_name TEXT NOT NULL DEFAULT '', home_team_id INTEGER, away_team_id INTEGER, home_team_name TEXT NOT NULL DEFAULT '', away_team_name TEXT NOT NULL DEFAULT '', home_score INTEGER, away_score INTEGER, home_ht INTEGER, away_ht INTEGER, corner_home INTEGER DEFAULT 0, corner_away INTEGER DEFAULT 0, shots_home INTEGER DEFAULT 0, shots_away INTEGER DEFAULT 0, shots_on_target_home INTEGER DEFAULT 0, shots_on_target_away INTEGER DEFAULT 0, yellow_home INTEGER DEFAULT 0, yellow_away INTEGER DEFAULT 0, red_home INTEGER DEFAULT 0, red_away INTEGER DEFAULT 0, fouls_home INTEGER DEFAULT 0, fouls_away INTEGER DEFAULT 0, offsides_home INTEGER DEFAULT 0, offsides_away INTEGER DEFAULT 0, league TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ss_event_id, ss_team_id))`).run(),
    env.SB_DB.prepare(`CREATE TABLE IF NOT EXISTS sofascore_player_stats (ss_event_id INTEGER NOT NULL, ss_player_id INTEGER NOT NULL, player_name TEXT NOT NULL, team TEXT NOT NULL DEFAULT '', total_shots INTEGER DEFAULT 0, shots_on_target INTEGER DEFAULT 0, minutes_played INTEGER DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ss_event_id, ss_player_id))`).run(),
    // ALTER pra adicionar HT cols caso schema antigo
    env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_corner_home INTEGER DEFAULT 0').run(),
    env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_corner_away INTEGER DEFAULT 0').run(),
    env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_home INTEGER DEFAULT 0').run(),
    env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_away INTEGER DEFAULT 0').run(),
    env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_on_target_home INTEGER DEFAULT 0').run(),
    env.SB_DB.prepare('ALTER TABLE sofascore_team_matches ADD COLUMN ht_shots_on_target_away INTEGER DEFAULT 0').run(),
  ]);

  let fixtures;
  try {
    fixtures = await fetchFixturesByDate(env, date);
  } catch (e) {
    return { error: `fetchFixturesByDate: ${e.message}` };
  }
  const slice = fixtures.slice(0, cap);
  console.log(`[apif-ingest] ${date}: ${fixtures.length} fixtures finalizadas, processando ${slice.length}`);

  let matchesInserted = 0, playersInserted = 0, statsFetched = 0;
  for (const f of slice) {
    const fixId = f.fixture.id;
    const fullStats = await fetchFixtureStats(env, fixId);
    if (fullStats) statsFetched++;
    const playerStats = await fetchFixturePlayerStats(env, fixId);
    const r = await ingestFixture(env, f, fullStats, playerStats);
    matchesInserted += r.matchInserted;
    playersInserted += r.playerInserted;
    // delay leve pra não saturar rapidapi (1 call/sec é margem segura)
    await new Promise(r => setTimeout(r, 250));
  }

  return {
    date,
    fixtures_total: fixtures.length,
    fixtures_processed: slice.length,
    stats_fetched: statsFetched,
    matches_inserted: matchesInserted,
    player_stats_inserted: playersInserted,
  };
}

/**
 * Backfill — ingere últimos N dias (chama ingestApifDate em loop).
 */
export async function backfillApifLastNDays(env, n = 7, capPerDay = 30) {
  const results = [];
  const today = new Date();
  for (let i = 1; i <= n; i++) {  // começa em 1 = ontem
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const r = await ingestApifDate(env, date, capPerDay);
    results.push(r);
  }
  return results;
}
