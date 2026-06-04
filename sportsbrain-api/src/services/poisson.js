// ════════════════════════════════════════════════════════════════════
// Poisson bivariado — modelo probabilístico de soccer
// ════════════════════════════════════════════════════════════════════
// Estima λ_home e λ_away (gols esperados) a partir de:
//   • attack strength do time (goals_for_avg vs liga)
//   • defense strength do oponente
//   • home advantage (multiplicador ~1.3 em soccer)
//
// Deriva probabilidades de:
//   • resultado (1X2)
//   • over/under total
//   • BTTS (both teams to score)
//   • placar exato
//
// Ajuste Dixon-Coles aplicado em placares baixos (0-0, 1-0, 0-1, 1-1) pra
// corrigir sub-predição histórica desses scores.
// ════════════════════════════════════════════════════════════════════

const DEFAULT_LEAGUE_AVG_GOALS = 2.7; // média histórica ligas top europeias
const HOME_ADV_MULTIPLIER      = 1.30;
const MAX_GOALS                = 10;  // trunca soma da matriz de probabilidades

// PMF de Poisson: P(X=k | λ) = λ^k * e^-λ / k!
export function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // Numericamente estável via log
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Correção Dixon-Coles pros 4 scores low-scoring
function dcCorrection(home, away, lambdaH, lambdaA, rho = -0.1) {
  if (home === 0 && away === 0) return 1 - lambdaH * lambdaA * rho;
  if (home === 0 && away === 1) return 1 + lambdaH * rho;
  if (home === 1 && away === 0) return 1 + lambdaA * rho;
  if (home === 1 && away === 1) return 1 - rho;
  return 1;
}

// Constrói matriz MAX_GOALS×MAX_GOALS de P(H=i, A=j)
function scoreMatrix(lambdaH, lambdaA) {
  const M = [];
  let sum = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    M[h] = [];
    const pH = poissonPmf(h, lambdaH);
    for (let a = 0; a <= MAX_GOALS; a++) {
      const pA = poissonPmf(a, lambdaA);
      const dc = dcCorrection(h, a, lambdaH, lambdaA);
      const p  = pH * pA * dc;
      M[h][a]  = p;
      sum     += p;
    }
  }
  // Normaliza (compensa truncamento e correção)
  for (let h = 0; h <= MAX_GOALS; h++)
    for (let a = 0; a <= MAX_GOALS; a++)
      M[h][a] /= sum;
  return M;
}

// Deriva todas as probabilidades do modelo a partir de λ_home e λ_away
export function probabilitiesFromLambdas(lambdaH, lambdaA) {
  const M = scoreMatrix(lambdaH, lambdaA);

  let pHome = 0, pDraw = 0, pAway = 0;
  let pBttsYes = 0;
  const overProbs = { 0.5: 0, 1.5: 0, 2.5: 0, 3.5: 0, 4.5: 0 };

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = M[h][a];
      if (h > a)      pHome += p;
      else if (h < a) pAway += p;
      else            pDraw += p;

      if (h > 0 && a > 0) pBttsYes += p;
      const total = h + a;
      for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
        if (total > line) overProbs[line] += p;
      }
    }
  }

  return {
    lambda_home: lambdaH,
    lambda_away: lambdaA,
    h2h: { home: pHome, draw: pDraw, away: pAway },
    btts: { yes: pBttsYes, no: 1 - pBttsYes },
    totals: {
      '0.5': { over: overProbs[0.5], under: 1 - overProbs[0.5] },
      '1.5': { over: overProbs[1.5], under: 1 - overProbs[1.5] },
      '2.5': { over: overProbs[2.5], under: 1 - overProbs[2.5] },
      '3.5': { over: overProbs[3.5], under: 1 - overProbs[3.5] },
      '4.5': { over: overProbs[4.5], under: 1 - overProbs[4.5] },
    },
  };
}

// Calcula λ partindo de stats de goal average
//   attack   = goalsFor_team / leagueAvg
//   defense  = goalsAgainst_opp / leagueAvg
//   λ_home   = attack_home * defense_away * leagueAvg * HOME_ADV
//   λ_away   = attack_away * defense_home * leagueAvg
export function lambdasFromStats(stats, leagueAvg = DEFAULT_LEAGUE_AVG_GOALS) {
  const attH = (stats.home_goals_for ?? stats.goals_for_avg ?? leagueAvg) / leagueAvg;
  const defH = (stats.home_goals_against ?? stats.goals_against_avg ?? leagueAvg) / leagueAvg;
  const attA = (stats.away_goals_for ?? stats.goals_for_avg ?? leagueAvg) / leagueAvg;
  const defA = (stats.away_goals_against ?? stats.goals_against_avg ?? leagueAvg) / leagueAvg;

  const lambdaH = attH * defA * leagueAvg * HOME_ADV_MULTIPLIER;
  const lambdaA = attA * defH * leagueAvg;
  return { lambdaH, lambdaA };
}

// Interface com D1: busca stats + retorna probs
export async function predictSoccerMatch(env, { home, away, league }) {
  if (!env.SB_DB) return null;

  const { results: rows } = await env.SB_DB.prepare(`
    SELECT team, goals_for_avg, goals_against_avg,
           home_goals_for, home_goals_against, away_goals_for, away_goals_against
    FROM team_goal_stats
    WHERE league = ? AND team IN (?, ?)
  `).bind(league || '', home, away).all().catch(() => ({ results: [] }));

  const map = {};
  for (const r of rows || []) map[r.team] = r;

  // Merge stats combinando casa do home + visitante do away
  const stats = {
    home_goals_for:     map[home]?.home_goals_for     ?? map[home]?.goals_for_avg,
    home_goals_against: map[home]?.home_goals_against ?? map[home]?.goals_against_avg,
    away_goals_for:     map[away]?.away_goals_for     ?? map[away]?.goals_for_avg,
    away_goals_against: map[away]?.away_goals_against ?? map[away]?.goals_against_avg,
    goals_for_avg:      map[home]?.goals_for_avg,
    goals_against_avg: map[home]?.goals_against_avg,
  };

  const hasData = Object.values(stats).some(v => v != null);
  if (!hasData) return null;

  const { lambdaH, lambdaA } = lambdasFromStats(stats);
  return {
    ...probabilitiesFromLambdas(lambdaH, lambdaA),
    has_prior: true,
  };
}

// Rebuild stats a partir de game_results — sliding window de N jogos
export async function rebuildTeamGoalStats(env, { league, window = 20 } = {}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };

  const { results: games } = await env.SB_DB.prepare(`
    SELECT home, away, home_score, away_score, commence_time
    FROM game_results
    WHERE league = ? AND home_score IS NOT NULL
    ORDER BY commence_time DESC LIMIT 400
  `).bind(league || '').all().catch(() => ({ results: [] }));

  if (!games?.length) return { ok: true, updated: 0, note: 'no_data' };

  const teamStats = new Map();
  const get = (team) => {
    if (!teamStats.has(team)) {
      teamStats.set(team, {
        games: 0, gf: 0, ga: 0,
        home_gf: 0, home_ga: 0, home_n: 0,
        away_gf: 0, away_ga: 0, away_n: 0,
      });
    }
    return teamStats.get(team);
  };

  for (const g of games.slice(0, window * 20)) {  // cap para controlar custo
    if (g.home_score == null || g.away_score == null) continue;
    const h = get(g.home);
    const a = get(g.away);
    h.games++; h.gf += g.home_score; h.ga += g.away_score;
    h.home_gf += g.home_score; h.home_ga += g.away_score; h.home_n++;
    a.games++; a.gf += g.away_score; a.ga += g.home_score;
    a.away_gf += g.away_score; a.away_ga += g.home_score; a.away_n++;
  }

  let updated = 0;
  for (const [team, s] of teamStats) {
    if (s.games < 3) continue;  // sample size mínimo
    await env.SB_DB.prepare(`
      INSERT INTO team_goal_stats (team, league, games, goals_for_avg, goals_against_avg,
                                   home_goals_for, home_goals_against, away_goals_for, away_goals_against,
                                   last_update)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)
      ON CONFLICT(team, league) DO UPDATE SET
        games = excluded.games,
        goals_for_avg = excluded.goals_for_avg,
        goals_against_avg = excluded.goals_against_avg,
        home_goals_for = excluded.home_goals_for,
        home_goals_against = excluded.home_goals_against,
        away_goals_for = excluded.away_goals_for,
        away_goals_against = excluded.away_goals_against,
        last_update = unixepoch() * 1000
    `).bind(
      team, league || '', s.games,
      s.gf / s.games, s.ga / s.games,
      s.home_n ? s.home_gf / s.home_n : s.gf / s.games,
      s.home_n ? s.home_ga / s.home_n : s.ga / s.games,
      s.away_n ? s.away_gf / s.away_n : s.gf / s.games,
      s.away_n ? s.away_ga / s.away_n : s.ga / s.games,
    ).run().catch(() => {});
    updated++;
  }
  return { ok: true, updated };
}
