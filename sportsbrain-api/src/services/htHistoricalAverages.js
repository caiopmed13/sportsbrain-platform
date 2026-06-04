// htHistoricalAverages.js — F2.44
// Queries D1 (sofascore_stats × sofascore_events) para computar médias HT
// per-team usando últimos N jogos. Saída: prob estimada de "HT shots > line"
// e "HT corners > line".
//
// Replaces fake default probs (0.645/0.623) com Bayesian-shrunk averages.

const DEFAULT_N_GAMES = 10;
const SHRINKAGE_K = 5;       // pseudo-counts pra regressão à média
const LEAGUE_PRIORS = {
  ht_shots: 4.5,             // típico HT shots per side numa liga top
  ht_corners: 2.5,
  ht_shots_on_target: 1.5,
};

/**
 * Normaliza nome do time pra match com D1.
 * F2.55: alinhado com normTeam dos ingests (ESPN/Cartola/365Scores) que PRESERVAM
 * espaços. Antes removia espaços → query LIKE '%americadecali%' não batia com
 * team_norm 'america de cali' no banco → 0 enrichments.
 */
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
 * Busca médias HT de UM time (últimas N partidas) do D1.
 * Retorna { ht_shots_avg, ht_corners_avg, ht_shots_on_target_avg, n_games }
 * ou null se time não estiver na base.
 */
export async function getTeamHtAverages(env, teamName, nGames = DEFAULT_N_GAMES) {
  if (!env?.SB_DB || !teamName) return null;
  const teamNorm = _norm(teamName);
  if (!teamNorm) return null;
  try {
    // F2.48: usar nossa PRÓPRIA base (shot_events + corner_events do ESPN ingest)
    // ao invés de Sofascore (bloqueado por CF). ESPN ingest já roda toda hora.
    // HT = period 1 OR minute <= 45. Agregar por (match_id, team_norm).
    const teamLike = `%${teamNorm}%`;

    // HT shots agregados por match
    const shotsRows = await env.SB_DB.prepare(`
      SELECT match_id,
             COUNT(*) as total_shots,
             SUM(CASE WHEN xg_computed > 0.15 THEN 1 ELSE 0 END) as shots_on_target
      FROM shot_events
      WHERE (period = 1 OR (period IS NULL AND minute <= 45))
        AND (team_norm LIKE ? OR LOWER(REPLACE(REPLACE(team, ' ', ''), '-', '')) LIKE ?)
      GROUP BY match_id
      ORDER BY match_id DESC
      LIMIT ?
    `).bind(teamLike, teamLike, nGames).all();

    // HT corners agregados por match
    const cornersRows = await env.SB_DB.prepare(`
      SELECT match_id, COUNT(*) as ht_corners
      FROM corner_events
      WHERE (period = 1 OR (period IS NULL AND minute <= 45))
        AND (team_norm LIKE ? OR LOWER(REPLACE(REPLACE(team, ' ', ''), '-', '')) LIKE ?)
      GROUP BY match_id
      ORDER BY match_id DESC
      LIMIT ?
    `).bind(teamLike, teamLike, nGames).all();

    const shotsByMatch = new Map();
    for (const r of (shotsRows?.results || [])) shotsByMatch.set(r.match_id, r);
    const cornersByMatch = new Map();
    for (const r of (cornersRows?.results || [])) cornersByMatch.set(r.match_id, r);

    // F2.49: fallback boxscore totals (Brasileirão sem play-by-play).
    // Quando shot_events vazio, busca match_team_metrics (totais full match)
    // e estima HT × ratio 0.42.
    const HT_RATIO = 0.42;
    const fallbackRows = await env.SB_DB.prepare(`
      SELECT match_id, shots, shots_on_target, corners
      FROM match_team_metrics
      WHERE team_norm LIKE ?
        AND (shots > 0 OR corners > 0)
      ORDER BY match_id DESC
      LIMIT ?
    `).bind(teamLike, nGames).all();

    const fallbackByMatch = new Map();
    for (const r of (fallbackRows?.results || [])) fallbackByMatch.set(r.match_id, r);

    // União dos match_ids (prefere shot_events sobre fallback)
    const allMatchIds = new Set([...shotsByMatch.keys(), ...cornersByMatch.keys(), ...fallbackByMatch.keys()]);
    if (allMatchIds.size === 0) return null;

    let sumShots = 0, sumCorners = 0, sumSoT = 0, n = 0;
    for (const mid of allMatchIds) {
      const s = shotsByMatch.get(mid);
      const c = cornersByMatch.get(mid);
      const fb = fallbackByMatch.get(mid);
      if (s || c) {
        // Real play-by-play HT data (europeias)
        sumShots   += s?.total_shots     || 0;
        sumSoT     += s?.shots_on_target || 0;
        sumCorners += c?.ht_corners      || 0;
      } else if (fb) {
        // F2.49 fallback: full match totals × HT_RATIO (Brasileirão)
        sumShots   += Math.round((fb.shots           || 0) * HT_RATIO);
        sumSoT     += Math.round((fb.shots_on_target || 0) * HT_RATIO);
        sumCorners += Math.round((fb.corners         || 0) * HT_RATIO);
      } else continue;
      n++;
    }
    if (n === 0) return null;

    // Bayesian shrinkage: media_obs * n / (n+K) + prior * K / (n+K)
    const denom = n + SHRINKAGE_K;
    const shrink = (sum, prior) => (sum / n) * (n / denom) + prior * (SHRINKAGE_K / denom);
    return {
      ht_shots_avg: shrink(sumShots, LEAGUE_PRIORS.ht_shots),
      ht_corners_avg: shrink(sumCorners, LEAGUE_PRIORS.ht_corners),
      ht_shots_on_target_avg: shrink(sumSoT, LEAGUE_PRIORS.ht_shots_on_target),
      n_games: n,
      raw_avg: { shots: sumShots/n, corners: sumCorners/n, sot: sumSoT/n },
    };
  } catch (e) {
    console.warn('[htHistoricalAverages] query failed:', e?.message);
    return null;
  }
}

/**
 * Prob estimada de "stat > line" usando distribuição Poisson com lambda = média.
 * Ex: line=3.5, avg=4.5 → P(X > 3.5) = 1 - P(X <= 3) com Poisson(4.5).
 */
export function probOverLine(avg, line) {
  if (!Number.isFinite(avg) || avg <= 0) return null;
  if (!Number.isFinite(line) || line < 0) return null;
  const k = Math.floor(line);  // line=3.5 → k=3 (P(X>3))
  // CDF Poisson(avg, x) for x=0..k
  let cdf = 0;
  let term = Math.exp(-avg);
  cdf += term;
  for (let i = 1; i <= k; i++) {
    term *= avg / i;
    cdf += term;
  }
  return Math.max(0.01, Math.min(0.99, 1 - cdf));
}

/**
 * Enriquece um leg HT com prob real baseado em histórico de ambos os times.
 * stat: 'ht_shots_home', 'ht_corners_away', etc.
 * Mantém prob original se sem dados.
 */
export async function enrichHtLeg(env, leg) {
  if (!leg || !leg.stat || !leg.match) return leg;
  const stat = String(leg.stat).toLowerCase();
  if (!/^ht_(shots|corners|shots_on_target)/.test(stat)) return leg;
  const isHome = /_home$/.test(stat);
  const teamName = isHome ? leg.home_team : leg.away_team;
  if (!teamName) return leg;
  const avgs = await getTeamHtAverages(env, teamName);
  if (!avgs) return leg;  // sem histórico — mantém prob default
  const line = +leg.line || 0;
  let avg;
  if (/shots_on_target/.test(stat)) avg = avgs.ht_shots_on_target_avg;
  else if (/shots/.test(stat))      avg = avgs.ht_shots_avg;
  else if (/corners?/.test(stat))   avg = avgs.ht_corners_avg;
  if (!avg) return leg;
  const isOver = /over|mais|more/i.test(leg.direction || leg.selection || '');
  const prob = isOver ? probOverLine(avg, line) : (1 - probOverLine(avg, line));
  if (!prob) return leg;
  // recompute ev_pct with new prob
  const odd = +leg.odd || 1;
  const ev_pct = +((prob * odd - 1) * 100).toFixed(2);
  return { ...leg, prob, ev_pct, _ht_enriched: true, _ht_avg_n: avgs.n_games };
}

/**
 * Enriquece um array de legs (paralelo, com cap).
 */
export async function enrichHtLegsBatch(env, legs, cap = 50) {
  if (!Array.isArray(legs) || !env?.SB_DB) return legs;
  const toEnrich = legs.slice(0, cap);
  const enriched = await Promise.all(toEnrich.map(l => enrichHtLeg(env, l).catch(() => l)));
  return [...enriched, ...legs.slice(cap)];
}

/**
 * F2.84: BATCH version — busca avgs HT de MÚLTIPLOS times em apenas 3 queries D1.
 * Usa WHERE team_norm IN (?, ?, ?) com placeholders dinâmicos.
 * Resulta em ~16× menos subrequests vs chamadas individuais.
 *
 * Opcionalmente também usa KV cache (key `htavg:<team_norm>`, TTL 1h) — verifica
 * cache primeiro, busca D1 só para os teams missing, salva resultado em KV.
 *
 * @param env - Cloudflare bindings (SB_DB + opcionalmente SB_KV)
 * @param teamNames - array de team names
 * @param nGames - últimos N jogos (default 10)
 * @returns Map<teamNameOriginal, avgs> — preserva nome original como chave
 */
export async function getBatchTeamHtAverages(env, teamNames, nGames = DEFAULT_N_GAMES) {
  const out = new Map();
  if (!env?.SB_DB || !Array.isArray(teamNames) || teamNames.length === 0) return out;
  const KV = env.SB_KV || env.SB_CACHE || null;
  const CACHE_TTL = 3600;  // 1h
  // Normaliza e dedupe
  const teamNorms = new Map();   // norm → original name
  for (const t of teamNames) {
    const tn = _norm(t);
    if (tn && !teamNorms.has(tn)) teamNorms.set(tn, t);
  }
  if (teamNorms.size === 0) return out;

  // 1) Tenta KV cache primeiro
  const needsFetch = [];
  if (KV) {
    const kvHits = await Promise.all([...teamNorms.keys()].map(tn =>
      KV.get(`htavg:${tn}`, 'json').catch(() => null)
    ));
    let i = 0;
    for (const tn of teamNorms.keys()) {
      const cached = kvHits[i++];
      if (cached && cached.n_games >= 3) {
        out.set(teamNorms.get(tn), cached);
      } else {
        needsFetch.push(tn);
      }
    }
  } else {
    needsFetch.push(...teamNorms.keys());
  }
  if (needsFetch.length === 0) return out;

  // 2) Batch D1 query — usa GLOB ou OR (D1 não suporta IN com arrays parametrizados nativamente)
  // Constrói WHERE team_norm LIKE ? OR team_norm LIKE ? ... — 1 query agrupando todos
  try {
    const teamLikes = needsFetch.map(tn => `%${tn}%`);
    const placeholders = teamLikes.map(() => 'team_norm LIKE ?').join(' OR ');

    // Shots HT events
    const shotsRows = await env.SB_DB.prepare(`
      SELECT team_norm, match_id,
             COUNT(*) as total_shots,
             SUM(CASE WHEN xg_computed > 0.15 THEN 1 ELSE 0 END) as shots_on_target
      FROM shot_events
      WHERE (period = 1 OR (period IS NULL AND minute <= 45))
        AND (${placeholders})
      GROUP BY team_norm, match_id
      ORDER BY match_id DESC
    `).bind(...teamLikes).all();

    // Corners HT events
    const cornersRows = await env.SB_DB.prepare(`
      SELECT team_norm, match_id, COUNT(*) as ht_corners
      FROM corner_events
      WHERE (period = 1 OR (period IS NULL AND minute <= 45))
        AND (${placeholders})
      GROUP BY team_norm, match_id
      ORDER BY match_id DESC
    `).bind(...teamLikes).all();

    // Fallback boxscore (Brasileirão sem play-by-play)
    const fallbackRows = await env.SB_DB.prepare(`
      SELECT team_norm, match_id, shots, shots_on_target, corners
      FROM match_team_metrics
      WHERE (${placeholders}) AND (shots > 0 OR corners > 0)
      ORDER BY match_id DESC
    `).bind(...teamLikes).all();

    // Agrupa por team_norm (usando LIKE match em vez de equals — pega substring matches)
    const HT_RATIO = 0.42;
    function _accumulateTeam(targetTn) {
      const targetLike = targetTn;   // já sem espaços/acentos
      const shotsByMatch = new Map();
      const cornersByMatch = new Map();
      const fallbackByMatch = new Map();
      for (const r of (shotsRows?.results || [])) {
        if (!r.team_norm || !r.team_norm.toLowerCase().includes(targetLike)) continue;
        shotsByMatch.set(r.match_id, r);
      }
      for (const r of (cornersRows?.results || [])) {
        if (!r.team_norm || !r.team_norm.toLowerCase().includes(targetLike)) continue;
        cornersByMatch.set(r.match_id, r);
      }
      for (const r of (fallbackRows?.results || [])) {
        if (!r.team_norm || !r.team_norm.toLowerCase().includes(targetLike)) continue;
        fallbackByMatch.set(r.match_id, r);
      }
      const allMatchIds = new Set([...shotsByMatch.keys(), ...cornersByMatch.keys(), ...fallbackByMatch.keys()]);
      if (allMatchIds.size === 0) return null;

      let sumShots = 0, sumCorners = 0, sumSoT = 0, n = 0;
      const ids = [...allMatchIds].sort((a, b) => (b > a ? 1 : -1)).slice(0, nGames);
      for (const mid of ids) {
        const s = shotsByMatch.get(mid);
        const c = cornersByMatch.get(mid);
        const fb = fallbackByMatch.get(mid);
        if (s || c) {
          sumShots   += s?.total_shots     || 0;
          sumSoT     += s?.shots_on_target || 0;
          sumCorners += c?.ht_corners      || 0;
        } else if (fb) {
          sumShots   += Math.round((fb.shots           || 0) * HT_RATIO);
          sumSoT     += Math.round((fb.shots_on_target || 0) * HT_RATIO);
          sumCorners += Math.round((fb.corners         || 0) * HT_RATIO);
        } else continue;
        n++;
      }
      if (n === 0) return null;
      const denom = n + SHRINKAGE_K;
      const shrink = (sum, prior) => (sum / n) * (n / denom) + prior * (SHRINKAGE_K / denom);
      return {
        ht_shots_avg: shrink(sumShots, LEAGUE_PRIORS.ht_shots),
        ht_corners_avg: shrink(sumCorners, LEAGUE_PRIORS.ht_corners),
        ht_shots_on_target_avg: shrink(sumSoT, LEAGUE_PRIORS.ht_shots_on_target),
        n_games: n,
        raw_avg: { shots: sumShots/n, corners: sumCorners/n, sot: sumSoT/n },
      };
    }

    // Salva por team e em KV
    const kvWrites = [];
    for (const tn of needsFetch) {
      const avgs = _accumulateTeam(tn);
      if (avgs) {
        out.set(teamNorms.get(tn), avgs);
        if (KV) kvWrites.push(KV.put(`htavg:${tn}`, JSON.stringify(avgs), { expirationTtl: CACHE_TTL }).catch(() => {}));
      }
    }
    // Fire-and-forget KV writes (não bloqueia response)
    if (kvWrites.length > 0 && env.ctx?.waitUntil) env.ctx.waitUntil(Promise.all(kvWrites));
    else if (kvWrites.length > 0) Promise.all(kvWrites).catch(() => {});
  } catch (e) {
    console.warn('[htHistoricalAverages.batch] query failed:', e?.message);
  }
  return out;
}

/**
 * F2.48: média de shots por player (full match) usando shot_events.
 * Para método CHUTES — substitui dependência de Sofascore /lineups.
 * Returns { avg_shots, avg_on_target, n_games, last_seen_match_id }
 */
export async function getPlayerShotAverages(env, playerName, nGames = 10) {
  if (!env?.SB_DB || !playerName) return null;
  const playerNorm = (playerName || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!playerNorm) return null;
  try {
    // 1) shot_events (ESPN play-by-play, ligas europeias)
    const espnRows = await env.SB_DB.prepare(`
      SELECT match_id,
             COUNT(*) as total_shots,
             SUM(CASE WHEN on_target = 1 THEN 1 ELSE 0 END) as on_target,
             SUM(CASE WHEN is_goal = 1 THEN 1 ELSE 0 END) as goals
      FROM shot_events
      WHERE LOWER(player_name) LIKE ?
      GROUP BY match_id
      ORDER BY match_id DESC
      LIMIT ?
    `).bind(`%${playerNorm}%`, nGames).all().catch(() => ({ results: [] }));

    let sumShots = 0, sumOnT = 0, n = 0, sourceTag = null;
    for (const r of (espnRows?.results || [])) {
      sumShots += +r.total_shots || 0;
      sumOnT   += +r.on_target   || 0;
      n++;
    }
    if (n > 0) sourceTag = 'espn_plays';

    // 2) F2.52: player_match_aggs (Cartola FC, Brasileirão A) — backfill se ESPN vazio
    if (n < nGames) {
      const need = nGames - n;
      const cartolaRows = await env.SB_DB.prepare(`
        SELECT match_id, shots, shots_on_target, goals
        FROM player_match_aggs
        WHERE player_norm LIKE ? AND source = 'cartola'
        ORDER BY season DESC, rodada DESC
        LIMIT ?
      `).bind(`%${playerNorm}%`, need).all().catch(() => ({ results: [] }));

      for (const r of (cartolaRows?.results || [])) {
        sumShots += +r.shots || 0;
        sumOnT   += +r.shots_on_target || 0;
        n++;
      }
      if (cartolaRows?.results?.length) {
        sourceTag = sourceTag ? 'espn+cartola' : 'cartola';
      }
    }

    if (n === 0) return null;

    // Bayesian shrink to league prior (~1.2 shots/game per outfield)
    const PLAYER_PRIOR = 1.2;
    const denom = n + SHRINKAGE_K;
    return {
      avg_shots: (sumShots / n) * (n / denom) + PLAYER_PRIOR * (SHRINKAGE_K / denom),
      avg_on_target: (sumOnT / n) * (n / denom) + 0.4 * (SHRINKAGE_K / denom),
      n_games: n,
      raw_avg: sumShots / n,
      source: sourceTag,
    };
  } catch (e) {
    console.warn('[htHist] getPlayerShotAverages failed:', e?.message);
    return null;
  }
}
