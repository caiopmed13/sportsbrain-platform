// ════════════════════════════════════════════════════════════════════
// Elo rating — ranking próprio por time × sport
// ════════════════════════════════════════════════════════════════════
// Matemática clássica:
//   expected_home = 1 / (1 + 10^((rating_away + home_adv - rating_home) / 400))
//   new_rating    = old + K * (actual - expected)
//
// Calibrado por sport:
//   soccer:     K=20, home_adv=60
//   basketball: K=15, home_adv=80
//   nfl:        K=20, home_adv=55
//   baseball:   K=10, home_adv=25
// ════════════════════════════════════════════════════════════════════

const K_FACTOR = { soccer: 20, basketball: 15, nfl: 20, mlb: 10, nhl: 15, default: 20 };
const HOME_ADV = { soccer: 60, basketball: 80, nfl: 55, mlb: 25, nhl: 50, default: 60 };
const INITIAL_RATING = 1500;

export function expectedScore(rHome, rAway, sport = 'default') {
  const hAdv = HOME_ADV[sport] ?? HOME_ADV.default;
  return 1 / (1 + Math.pow(10, (rAway - rHome - hAdv) / 400));
}

// Retorna probabilidade de (home_win, draw, away_win). Para esportes sem empate,
// draw=0. Para soccer usamos heurística empírica: ~26% dos jogos empatam,
// escalada por proximidade de ratings.
export function probabilitiesFromElo(rHome, rAway, sport = 'default') {
  const pHomeNoDraw = expectedScore(rHome, rAway, sport);

  if (sport !== 'soccer') {
    return { home: pHomeNoDraw, draw: 0, away: 1 - pHomeNoDraw };
  }

  // Soccer: draw depende do |diff|. Empates são mais comuns quando ratings estão próximos.
  const ratingDiff = Math.abs(rHome - rAway + (HOME_ADV.soccer));
  // baseDraw: ~0.28 quando jogos parelhos, cai pra ~0.15 em 400+ de diff
  const baseDraw = 0.30 * Math.exp(-ratingDiff / 400);
  const pDraw = Math.max(0.12, Math.min(0.32, baseDraw));

  // Redistribui o espaço non-draw proporcionalmente
  const pHome = pHomeNoDraw * (1 - pDraw);
  const pAway = (1 - pHomeNoDraw) * (1 - pDraw);
  return { home: pHome, draw: pDraw, away: pAway };
}

// Actual score for Elo update: 1 = home win, 0.5 = draw, 0 = loss
function actualScore(homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  if (homeScore > awayScore) return 1;
  if (homeScore < awayScore) return 0;
  return 0.5;
}

// Margin of victory multiplier (evita que um 5-0 contra um 1-0 valham igual)
function movMultiplier(homeScore, awayScore, eloDiff) {
  const mov = Math.abs(homeScore - awayScore);
  return Math.log(Math.max(mov, 1) + 1) * (2.2 / ((eloDiff * 0.001) + 2.2));
}

export async function getRating(env, team, sport) {
  if (!env.SB_DB) return INITIAL_RATING;
  const row = await env.SB_DB.prepare(
    'SELECT rating FROM elo_ratings WHERE team = ? AND sport = ?'
  ).bind(team, sport).first().catch(() => null);
  return row?.rating ?? INITIAL_RATING;
}

export async function getRatings(env, teams, sport) {
  if (!env.SB_DB || !teams.length) return {};
  const placeholders = teams.map(() => '?').join(',');
  const { results } = await env.SB_DB.prepare(
    `SELECT team, rating FROM elo_ratings WHERE sport = ? AND team IN (${placeholders})`
  ).bind(sport, ...teams).all().catch(() => ({ results: [] }));
  const out = {};
  for (const t of teams) out[t] = INITIAL_RATING;
  for (const r of results || []) out[r.team] = r.rating;
  return out;
}

async function setRating(env, team, sport, rating, games) {
  await env.SB_DB.prepare(`
    INSERT INTO elo_ratings (team, sport, rating, games, last_result_at, last_update)
    VALUES (?, ?, ?, ?, unixepoch() * 1000, unixepoch() * 1000)
    ON CONFLICT(team, sport) DO UPDATE SET
      rating = excluded.rating,
      games  = elo_ratings.games + 1,
      last_result_at = unixepoch() * 1000,
      last_update    = unixepoch() * 1000
  `).bind(team, sport, rating, games).run().catch(() => {});
}

// Aplica 1 resultado e atualiza ratings dos dois times
export async function updateFromResult(env, { home, away, sport, home_score, away_score }) {
  if (!env.SB_DB || home_score == null || away_score == null) return null;
  const actual = actualScore(home_score, away_score);
  if (actual == null) return null;

  const { [home]: rH, [away]: rA } = await getRatings(env, [home, away], sport);
  const k    = K_FACTOR[sport] ?? K_FACTOR.default;
  const expH = expectedScore(rH, rA, sport);
  const mov  = movMultiplier(home_score, away_score, rH - rA);
  const delta = k * mov * (actual - expH);

  const newH = rH + delta;
  const newA = rA - delta;

  await setRating(env, home, sport, newH, 1);
  await setRating(env, away, sport, newA, 1);
  return { home_new: newH, away_new: newA, delta };
}

// Seed/refresh em batch a partir de game_results
export async function rebuildRatings(env, { sport, since = 0 } = {}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };
  let sql = `SELECT home, away, home_score, away_score, sport, commence_time
             FROM game_results
             WHERE home_score IS NOT NULL AND away_score IS NOT NULL
               AND commence_time >= ?`;
  const args = [since];
  if (sport) { sql += ' AND sport = ?'; args.push(sport); }
  sql += ' ORDER BY commence_time ASC LIMIT 5000';

  const { results } = await env.SB_DB.prepare(sql).bind(...args).all().catch(() => ({ results: [] }));
  let n = 0;
  for (const r of results || []) {
    await updateFromResult(env, r);
    n++;
  }
  return { ok: true, updated: n };
}
