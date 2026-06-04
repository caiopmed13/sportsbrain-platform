// resultBttsEnricher.js — F2.56
// Enriquece legs 1X2/BTTS com prob real usando histórico de gols dos times.
// Source: matches_raw (4659+ matches com score_home/score_away).
//
// Modelos:
//   1X2:  Poisson(lambda_home, lambda_away) → P(home_wins/draw/away_wins)
//   BTTS: P(BTTS=Yes) = (1 - P(home=0)) * (1 - P(away=0))
//                    = (1 - e^-λh) * (1 - e^-λa)
//
// Onde:
//   λh = (avg_for_home_team + avg_against_away_team) / 2  ← mistura ataque-defesa
//   λa = (avg_for_away_team + avg_against_home_team) / 2

const DEFAULT_N_GAMES = 10;
const SHRINKAGE_K = 5;
const LEAGUE_PRIORS = {
  goals_for: 1.3,         // típico ataque
  goals_against: 1.3,
  btts_rate: 0.52,        // ~52% jogos têm BTTS
};

function _norm(s) {
  return (s || '').toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b|\be\.?c\.?\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca avg goals (for/against) e BTTS rate de UM time.
 * Retorna { gf_avg, ga_avg, btts_rate, n_games } ou null.
 */
export async function getTeamGoalAverages(env, teamName, nGames = DEFAULT_N_GAMES) {
  if (!env?.SB_DB || !teamName) return null;
  const tn = _norm(teamName);
  if (!tn) return null;
  try {
    const tnLike = `%${tn}%`;
    const { results } = await env.SB_DB.prepare(`
      SELECT score_home, score_away, home_team_norm, away_team_norm
      FROM matches_raw
      WHERE status = 'post'
        AND score_home IS NOT NULL AND score_away IS NOT NULL
        AND (home_team_norm LIKE ? OR away_team_norm LIKE ?)
      ORDER BY kickoff_iso DESC
      LIMIT ?
    `).bind(tnLike, tnLike, nGames).all();

    let gf = 0, ga = 0, bttsCount = 0, n = 0;
    for (const r of (results || [])) {
      const homeMatch = (r.home_team_norm || '').toLowerCase().includes(tn);
      const awayMatch = (r.away_team_norm || '').toLowerCase().includes(tn);
      const isHome = homeMatch && !awayMatch;
      const isAway = awayMatch && !homeMatch;
      if (!isHome && !isAway) continue;
      const ourGoals = isHome ? +r.score_home : +r.score_away;
      const theirGoals = isHome ? +r.score_away : +r.score_home;
      if (!Number.isFinite(ourGoals) || !Number.isFinite(theirGoals)) continue;
      gf += ourGoals;
      ga += theirGoals;
      if (ourGoals > 0 && theirGoals > 0) bttsCount++;
      n++;
    }

    // F2.58: fallback agregar shot_events (365Scores tem 12k+ shots / 229 teams).
    // Goals em shot_events vem de is_goal=1; concedidos via match_id (oponente).
    if (n < nGames) {
      const need = nGames - n;
      const shotRows = await env.SB_DB.prepare(`
        SELECT match_id,
               SUM(is_goal) as our_goals,
               (SELECT SUM(is_goal) FROM shot_events s2 WHERE s2.match_id = s.match_id AND s2.team_norm != s.team_norm) as their_goals
        FROM shot_events s
        WHERE team_norm LIKE ?
        GROUP BY match_id
        ORDER BY match_id DESC
        LIMIT ?
      `).bind(tnLike, need).all().catch(() => ({ results: [] }));
      for (const r of (shotRows?.results || [])) {
        const og = +r.our_goals || 0;
        const tg = +r.their_goals || 0;
        gf += og;
        ga += tg;
        if (og > 0 && tg > 0) bttsCount++;
        n++;
      }
    }

    if (n === 0) return null;

    // Bayesian shrinkage
    const denom = n + SHRINKAGE_K;
    const shrink = (sum, prior) => (sum / n) * (n / denom) + prior * (SHRINKAGE_K / denom);
    return {
      gf_avg:    shrink(gf, LEAGUE_PRIORS.goals_for),
      ga_avg:    shrink(ga, LEAGUE_PRIORS.goals_against),
      btts_rate: shrink(bttsCount, LEAGUE_PRIORS.btts_rate),
      n_games:   n,
    };
  } catch (e) {
    console.warn('[resultBttsEnricher] getTeamGoalAverages failed:', e?.message);
    return null;
  }
}

/**
 * Probabilidade Poisson de exatamente k gols com média lambda.
 */
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Computa probabilidades 1X2 via Poisson bivariate.
 * Range usado: 0..6 gols cada lado (cobre 99%+).
 */
function compute1X2(lambdaHome, lambdaAway) {
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let h = 0; h <= 6; h++) {
    const pH = poissonPMF(h, lambdaHome);
    for (let a = 0; a <= 6; a++) {
      const pA = poissonPMF(a, lambdaAway);
      const joint = pH * pA;
      if (h > a) pHome += joint;
      else if (h === a) pDraw += joint;
      else pAway += joint;
    }
  }
  return { pHome, pDraw, pAway };
}

/**
 * BTTS=Yes: P(home>=1) * P(away>=1) = (1 - e^-λh)(1 - e^-λa)
 */
function computeBttsYes(lambdaHome, lambdaAway) {
  return (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway));
}

const _isResultStat = (s) => /(h2h|1x2|moneyline|match[\s_]?result|resultado|match[\s_]?winner|^winner$|^result$)/i.test(String(s || '').trim());
const _isBttsStat   = (s) => /(btts|both[\s_]?teams|ambos.*marcar|ambas.*marcam|both[\s_]?score)/i.test(String(s || '').trim());

/**
 * Enriquece UMA leg de Result ou BTTS.
 * - Para Result: detecta direction (home/away/draw) e usa pHome/pDraw/pAway
 * - Para BTTS:   detecta direction (yes/no/sim/não)
 * Mantém prob original se sem dados.
 */
export async function enrichResultBttsLeg(env, leg) {
  if (!leg || !leg.stat || !leg.match) return leg;
  const stat = String(leg.stat).toLowerCase();
  const market = String(leg.market || '').toLowerCase();
  const isResult = _isResultStat(stat) || _isResultStat(market);
  const isBtts = _isBttsStat(stat) || _isBttsStat(market);
  if (!isResult && !isBtts) return leg;
  if (!leg.home_team || !leg.away_team) return leg;

  const [homeAvg, awayAvg] = await Promise.all([
    getTeamGoalAverages(env, leg.home_team),
    getTeamGoalAverages(env, leg.away_team),
  ]);
  if (!homeAvg || !awayAvg) return leg;
  // F2.58: gate min n_games=2. Bayesian shrinkage K=5 já compensa amostras
  // pequenas convergindo para o prior (league avg). Antes era n<4 → ZERO
  // enrichments porque sul-americanos têm matches_raw esparso.
  const minN = Math.min(homeAvg.n_games, awayAvg.n_games);
  if (minN < 2) return leg;

  // λh = (ataque do home + defesa fraca do away) / 2
  // Defesa fraca = average goals conceded by away
  const lambdaHome = (homeAvg.gf_avg + awayAvg.ga_avg) / 2;
  const lambdaAway = (awayAvg.gf_avg + homeAvg.ga_avg) / 2;

  let prob = null;
  if (isResult) {
    const { pHome, pDraw, pAway } = compute1X2(lambdaHome, lambdaAway);
    const dir = String(leg.direction || leg.selection || '').toLowerCase();
    if (/home|casa|^1$|mandante/.test(dir)) prob = pHome;
    else if (/away|fora|^2$|visitante/.test(dir)) prob = pAway;
    else if (/draw|empate|^x$/.test(dir)) prob = pDraw;
    else if (/1x|home.*draw|casa.*empate/.test(dir)) prob = pHome + pDraw;
    else if (/12|home.*away|sem.*empate/.test(dir)) prob = pHome + pAway;
    else if (/x2|draw.*away|empate.*fora/.test(dir)) prob = pDraw + pAway;
  } else if (isBtts) {
    const pYes = computeBttsYes(lambdaHome, lambdaAway);
    const dir = String(leg.direction || leg.selection || '').toLowerCase();
    if (/yes|sim|^y$|both/i.test(dir)) prob = pYes;
    else if (/no|não|nao/i.test(dir)) prob = 1 - pYes;
  }

  if (prob == null || !Number.isFinite(prob)) return leg;
  prob = Math.max(0.02, Math.min(0.98, prob));
  const odd = +leg.odd || 1;
  const ev_pct = +((prob * odd - 1) * 100).toFixed(2);
  const nMin = Math.min(homeAvg.n_games, awayAvg.n_games);
  return { ...leg, prob, ev_pct, _rb_enriched: true, _rb_n: nMin };
}

/**
 * Wrapper batch p/ pool inteiro.
 */
export async function enrichResultBttsLegsBatch(env, legs, cap = 100) {
  if (!Array.isArray(legs) || !env?.SB_DB) return legs;
  const toEnrich = legs.slice(0, cap);
  const enriched = await Promise.all(
    toEnrich.map(l => enrichResultBttsLeg(env, l).catch(() => l))
  );
  return [...enriched, ...legs.slice(cap)];
}
