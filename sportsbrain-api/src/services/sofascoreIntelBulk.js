// src/services/sofascoreIntelBulk.js
// ─────────────────────────────────────────────────────────────────────────────
// Bulk D1 loader for daily-intel endpoint.
// Replaces 421×5=2105 per-game D1 subrequests with ~4-14 bulk queries.
//
// Strategy:
//   1. Collect all unique team IDs from today's games
//   2. Bulk-load features data (180-day window) in chunked IN() queries
//   3. Bulk-load H2H extra window (730-day lookback, 550-day extra beyond features)
//   4. Compute all features/H2H in pure JS from loaded rows
//   5. Build Team Intelligence Profiles (P2.4) per team — pure JS, zero D1
//   6. Build Match Intelligence Profiles (P2.4) per game pair — pure JS
//   7. Return gameIntelMap keyed by "homeId|awayId"
// ─────────────────────────────────────────────────────────────────────────────

import { buildTeamIntelligenceProfile, buildMatchIntelligenceProfile } from './teamIntelligenceProfiles.js';

const MIN_MATCHES      = 5;
const FEATURES_WINDOW  = 30;   // max rows per team for general features
const SIDE_WINDOW      = 18;   // max rows per team for home/away splits
const BULK_CHUNK_SIZE  = 95;   // CF D1 max bound params = 100; 95 IDs + 1 date = 96 params (safe)
const H2H_WINDOW_DAYS  = 730;  // H2H uses 2 years
const FEAT_WINDOW_DAYS = 180;  // general features use 180 days

// ─── Pure-JS computation functions (no D1) ───────────────────────────────────

/**
 * Mirrors getTeamFeatures computation from sofascoreFeatures.js.
 * @param {number} teamId
 * @param {Array} matches — pre-loaded rows, sorted event_date DESC, sliced to FEATURES_WINDOW
 * @returns {object} same shape as getTeamFeatures
 */
function computeTeamFeaturesFromMatches(teamId, matches) {
  const dataQuality = {
    matchesAvailable: matches.length,
    meetsMinimum: matches.length >= MIN_MATCHES,
    window: FEATURES_WINDOW,
  };

  if (!matches.length) {
    return { teamId, dataQuality, form: null, bttsRate: null, over25Rate: null, cornerAvg: null, attackScore: null, defenseScore: null };
  }

  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
  let btts = 0, over25 = 0;
  let cornersFor = 0, cornersAgainst = 0;
  let htGoals = 0, htBtts = 0, htOver05 = 0;
  let recentWins = 0, recentDraws = 0, recentLosses = 0, recentGf = 0, recentGa = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const isHome   = m.side === 'home';
    const scored   = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
    const conceded = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);

    gf += scored;
    ga += conceded;

    const total = scored + conceded;
    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;

    if (scored > 0 && conceded > 0) btts++;
    if (total > 2.5) over25++;

    const cornersTeam = isHome ? (m.corner_home ?? 0) : (m.corner_away ?? 0);
    const cornersOpp  = isHome ? (m.corner_away ?? 0) : (m.corner_home ?? 0);
    cornersFor     += cornersTeam;
    cornersAgainst += cornersOpp;

    const htHome = m.home_ht ?? null;
    const htAway = m.away_ht ?? null;
    if (htHome !== null && htAway !== null) {
      htGoals += htHome + htAway;
      if (htHome > 0 && htAway > 0) htBtts++;
      if (htHome + htAway > 0.5) htOver05++;
    }

    // Recent form: last 5 (already sorted DESC, so first 5 = most recent)
    if (i < 5) {
      const rScored   = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
      const rConceded = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);
      recentGf += rScored; recentGa += rConceded;
      if (rScored > rConceded) recentWins++;
      else if (rScored === rConceded) recentDraws++;
      else recentLosses++;
    }
  }

  const n = matches.length;

  return {
    teamId,
    dataQuality,
    form: {
      wins, draws, losses,
      gf, ga,
      gfPerMatch: +(gf / n).toFixed(2),
      gaPerMatch: +(ga / n).toFixed(2),
      points: wins * 3 + draws,
    },
    bttsRate:   +(btts   / n).toFixed(3),
    over25Rate: +(over25  / n).toFixed(3),
    cornerAvg: {
      forTeam: +(cornersFor     / n).toFixed(2),
      against: +(cornersAgainst / n).toFixed(2),
      total:   +((cornersFor + cornersAgainst) / n).toFixed(2),
    },
    attackScore:  +(gf / n).toFixed(2),
    defenseScore: +(ga / n).toFixed(2),
    htStats: n > 0 ? {
      avgGoals:   +(htGoals  / n).toFixed(2),
      bttsRate:   +(htBtts   / n).toFixed(3),
      over05Rate: +(htOver05 / n).toFixed(3),
    } : null,
    recentForm5: matches.length >= 1 ? {
      wins: recentWins, draws: recentDraws, losses: recentLosses,
      points: recentWins * 3 + recentDraws,
      gfPerMatch: +(recentGf / Math.min(n, 5)).toFixed(2),
      gaPerMatch: +(recentGa / Math.min(n, 5)).toFixed(2),
      inForm:     (recentWins * 3 + recentDraws) >= 9,
      outOfForm:  (recentWins * 3 + recentDraws) <= 3,
    } : null,
  };
}

/**
 * Mirrors getTeamFeaturesBySide computation from sofascoreFeatures.js.
 * @param {number} teamId
 * @param {Array} matches — pre-loaded rows for this team (all sides)
 * @param {string} side — 'home' or 'away'
 * @returns {object|null} same shape as getTeamFeaturesBySide, or null if no data
 */
function computeSplitFeaturesFromMatches(teamId, matches, side) {
  const filtered = matches.filter(m => m.side === side).slice(0, SIDE_WINDOW);
  if (!filtered.length) return null;

  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, btts = 0, over25 = 0;
  for (const m of filtered) {
    const scored   = side === 'home' ? (m.home_score ?? 0) : (m.away_score ?? 0);
    const conceded = side === 'home' ? (m.away_score ?? 0) : (m.home_score ?? 0);
    gf += scored; ga += conceded;
    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;
    if (scored > 0 && conceded > 0) btts++;
    if (scored + conceded > 2.5) over25++;
  }
  const n = filtered.length;
  return {
    side, matchesUsed: n,
    winRate:   +(wins   / n).toFixed(3),
    drawRate:  +(draws  / n).toFixed(3),
    lossRate:  +(losses / n).toFixed(3),
    gfPerMatch: +(gf / n).toFixed(2),
    gaPerMatch: +(ga / n).toFixed(2),
    bttsRate:   +(btts   / n).toFixed(3),
    over25Rate: +(over25  / n).toFixed(3),
    cleanSheetRate: +((filtered.filter(m => (side === 'home' ? m.away_score : m.home_score) === 0).length) / n).toFixed(3),
  };
}

/**
 * Mirrors getH2H computation from sofascoreFeatures.js.
 * @param {number} homeTeamId — perspective team
 * @param {Array} h2hMatches — matches where ss_team_id === homeTeamId AND opponent_team_id === awayTeamId (already filtered)
 * @returns {object|null}
 */
function computeH2HFromMatches(homeTeamId, h2hMatches) {
  if (!h2hMatches || h2hMatches.length < 2) return null;

  let homeTeamWins = 0, awayTeamWins = 0, draws = 0;
  let totalGoalsSum = 0, btts = 0, over25 = 0;

  for (const m of h2hMatches) {
    const myScore  = m.side === 'home' ? (m.home_score ?? 0) : (m.away_score ?? 0);
    const oppScore = m.side === 'home' ? (m.away_score ?? 0) : (m.home_score ?? 0);
    const total    = myScore + oppScore;

    if (myScore > oppScore) homeTeamWins++;
    else if (myScore < oppScore) awayTeamWins++;
    else draws++;

    if (myScore > 0 && oppScore > 0) btts++;
    if (total > 2.5) over25++;
    totalGoalsSum += total;
  }

  const n = h2hMatches.length;
  return {
    totalMatches:     n,
    homeTeamWinRate:  +(homeTeamWins  / n).toFixed(3),
    awayTeamWinRate:  +(awayTeamWins  / n).toFixed(3),
    drawRate:         +(draws         / n).toFixed(3),
    bttsRate:         +(btts          / n).toFixed(3),
    over25Rate:       +(over25        / n).toFixed(3),
    avgGoals:         +(totalGoalsSum / n).toFixed(2),
    window_days:      H2H_WINDOW_DAYS,
  };
}

/**
 * Canonical sort key for a H2H pair (order-independent).
 */
function makeH2HPairKey(a, b) {
  return [String(a), String(b)].sort().join('|');
}

// ─── Main bulk loader ─────────────────────────────────────────────────────────

/**
 * Load match intelligence for all games in bulk (few D1 queries total).
 * @param {Array} games — array of { homeId, awayId, ... }
 * @param {object} env — CF Workers env with SB_DB
 * @returns {{ gameIntelMap: Map, coverage: object }}
 */
export async function loadDailyIntelBulk(games, env) {
  const startMs = Date.now();
  const warnings = [];
  let queriesUsed = 0;

  if (!env?.SB_DB) {
    return {
      gameIntelMap: new Map(),
      coverage: {
        mode: 'bulk',
        teamIdsRequested: 0,
        teamsLoaded: 0,
        matchesLoaded: 0,
        avgMatchesPerTeam: 0,
        h2hPairsRequested: 0,
        h2hPairsWithMatches: 0,
        queriesUsed: 0,
        durationMs: Date.now() - startMs,
        warnings: ['SB_DB not available'],
      },
    };
  }

  // 1. Collect unique team IDs
  const teamIdSet = new Set();
  for (const g of games) {
    if (g.homeId) teamIdSet.add(Number(g.homeId));
    if (g.awayId) teamIdSet.add(Number(g.awayId));
  }
  const teamIds = [...teamIdSet];

  // 2. Compute cutoff dates
  const nowMs       = Date.now();
  const featCutoff  = new Date(nowMs - FEAT_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const h2hCutoff   = new Date(nowMs - H2H_WINDOW_DAYS  * 86400000).toISOString().slice(0, 10);

  // 3. Chunk helper
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // 4. Bulk load features data (180-day window)
  const allFeatMatches = [];
  const teamChunks = chunk(teamIds, BULK_CHUNK_SIZE);

  for (const ch of teamChunks) {
    try {
      const placeholders = ch.map(() => '?').join(',');
      // Select only columns used in computation (reduces D1 payload ~3×)
      const sql = `SELECT ss_team_id, opponent_team_id, event_date, side, home_score, away_score, home_ht, away_ht, corner_home, corner_away FROM sofascore_team_matches WHERE ss_team_id IN (${placeholders}) AND event_date >= ? ORDER BY ss_team_id, event_date DESC`;
      const result = await env.SB_DB.prepare(sql).bind(...ch, featCutoff).all();
      queriesUsed++;
      for (const row of (result.results || [])) allFeatMatches.push(row);
    } catch (e) {
      queriesUsed++;
      console.warn('[sofascoreIntelBulk] feat chunk query failed:', e?.message);
      warnings.push(`feat_chunk_failed: ${e?.message}`);
    }
  }

  // 5. Bulk load H2H extra window (730-day lookback, only 550-day extra beyond feat window)
  // Gets event_date >= h2h_cutoff AND event_date < feat_cutoff (non-overlapping older window)
  const allH2HMatches = [];

  for (const ch of teamChunks) {
    try {
      const placeholders = ch.map(() => '?').join(',');
      const sql = `SELECT ss_team_id, opponent_team_id, event_date, side, home_score, away_score FROM sofascore_team_matches WHERE ss_team_id IN (${placeholders}) AND opponent_team_id IS NOT NULL AND event_date >= ? AND event_date < ? ORDER BY event_date DESC`;
      const result = await env.SB_DB.prepare(sql).bind(...ch, h2hCutoff, featCutoff).all();
      queriesUsed++;
      for (const row of (result.results || [])) allH2HMatches.push(row);
    } catch (e) {
      queriesUsed++;
      console.warn('[sofascoreIntelBulk] h2h chunk query failed:', e?.message);
      warnings.push(`h2h_chunk_failed: ${e?.message}`);
    }
  }

  // 6. Build matchesByTeamId map from allFeatMatches (for features)
  // Each team's matches are already ordered by event_date DESC within the chunk (same ss_team_id group)
  const matchesByTeamId = new Map();
  for (const m of allFeatMatches) {
    const tid = Number(m.ss_team_id);
    if (!matchesByTeamId.has(tid)) matchesByTeamId.set(tid, []);
    matchesByTeamId.get(tid).push(m);
  }

  // 7. Compute team features for each team
  const teamFeatMap  = new Map();
  const homeSplitMap = new Map();
  const awaySplitMap = new Map();

  for (const teamId of teamIds) {
    const raw    = matchesByTeamId.get(teamId) || [];
    // Ensure sorted by event_date DESC (should be from query ORDER BY, but re-sort for safety)
    const sorted = raw.slice().sort((a, b) => (b.event_date > a.event_date ? 1 : b.event_date < a.event_date ? -1 : 0));

    teamFeatMap.set(teamId,  computeTeamFeaturesFromMatches(teamId, sorted.slice(0, FEATURES_WINDOW)));
    homeSplitMap.set(teamId, computeSplitFeaturesFromMatches(teamId, sorted, 'home'));
    awaySplitMap.set(teamId, computeSplitFeaturesFromMatches(teamId, sorted, 'away'));
  }

  // 8a. Build Team Intelligence Profiles (P2.4) — pure JS, zero D1 queries
  const asOfDate = new Date().toISOString().slice(0, 10);
  const teamProfileMap = new Map();
  for (const teamId of teamIds) {
    const feats      = teamFeatMap.get(teamId)  || null;
    const homeSplit  = homeSplitMap.get(teamId) || null;
    const awaySplit  = awaySplitMap.get(teamId) || null;
    try {
      const profile = buildTeamIntelligenceProfile({
        teamId,
        teamName: null,   // name not available at this stage; enriched downstream
        teamFeats: feats,
        homeSplit,
        awaySplit,
        asOfDate,
      });
      teamProfileMap.set(teamId, profile);
    } catch (e) {
      console.warn(`[sofascoreIntelBulk] profile build failed for team ${teamId}:`, e?.message);
    }
  }

  // 8. Build H2H pair map
  // Combine allFeatMatches + allH2HMatches for full 730-day H2H coverage
  const h2hRawMap = new Map();

  const addToH2HMap = (m) => {
    if (!m.opponent_team_id) return;
    const key = makeH2HPairKey(m.ss_team_id, m.opponent_team_id);
    if (!h2hRawMap.has(key)) h2hRawMap.set(key, []);
    h2hRawMap.get(key).push(m);
  };

  // Features window already has opponent_team_id if it's populated in the DB
  for (const m of allFeatMatches)  addToH2HMap(m);
  for (const m of allH2HMatches)   addToH2HMap(m);

  // 9. Build gameIntelMap for each game
  const gameIntelMap = new Map();
  let h2hPairsWithMatches = 0;

  for (const g of games) {
    if (!g.homeId || !g.awayId) continue;
    const homeId = Number(g.homeId);
    const awayId = Number(g.awayId);

    const homeFeats  = teamFeatMap.get(homeId)  || null;
    const awayFeats  = teamFeatMap.get(awayId)  || null;
    const homeAtHome = homeSplitMap.get(homeId) || null;
    const awayOnRoad = awaySplitMap.get(awayId) || null;

    // H2H: from homeId's perspective against awayId
    const h2hPairKey       = makeH2HPairKey(homeId, awayId);
    const h2hAllMatches    = h2hRawMap.get(h2hPairKey) || [];
    // Filter to homeId's perspective (rows where ss_team_id === homeId AND opponent_team_id === awayId)
    const h2hFromHomePersp = h2hAllMatches.filter(m => Number(m.ss_team_id) === homeId && Number(m.opponent_team_id) === awayId);
    const h2h              = computeH2HFromMatches(homeId, h2hFromHomePersp);

    if (h2h && h2h.totalMatches > 0) h2hPairsWithMatches++;

    const h2h_confidence = h2h && h2h.totalMatches >= 4 ? 'high'
      : h2h && h2h.totalMatches >= 2 ? 'medium'
      : 'none';

    const homeMeets = homeFeats?.dataQuality?.meetsMinimum ?? false;
    const awayMeets = awayFeats?.dataQuality?.meetsMinimum ?? false;
    const confidence = (homeMeets && awayMeets) ? 'high'
      : (homeMeets || awayMeets) ? 'low'
      : 'none';

    const homeBtts  = homeAtHome?.bttsRate   ?? homeFeats?.bttsRate   ?? 0;
    const awayBtts  = awayOnRoad?.bttsRate   ?? awayFeats?.bttsRate   ?? 0;
    const homeOver  = homeAtHome?.over25Rate ?? homeFeats?.over25Rate ?? 0;
    const awayOver  = awayOnRoad?.over25Rate ?? awayFeats?.over25Rate ?? 0;

    const combined = confidence === 'high' ? {
      bttsRate:       +((homeBtts  + awayBtts)  / 2).toFixed(3),
      over25Rate:     +((homeOver  + awayOver)  / 2).toFixed(3),
      cornerAvgTotal: +((homeFeats?.cornerAvg?.total ?? 0) + (awayFeats?.cornerAvg?.total ?? 0) / 2).toFixed(2),
      homeAttack:     homeAtHome?.gfPerMatch  ?? homeFeats?.attackScore  ?? null,
      awayAttack:     awayOnRoad?.gfPerMatch  ?? awayFeats?.attackScore  ?? null,
      homeDefense:    homeAtHome?.gaPerMatch  ?? homeFeats?.defenseScore ?? null,
      awayDefense:    awayOnRoad?.gaPerMatch  ?? awayFeats?.defenseScore ?? null,
      homeWinRate:    homeAtHome?.winRate     ?? null,
      awayWinRate:    awayOnRoad?.winRate     ?? null,
    } : null;

    // P2.4: Team intelligence profiles (pre-built above)
    const homeProfile = teamProfileMap.get(homeId) || null;
    const awayProfile = teamProfileMap.get(awayId) || null;

    // P2.4: Match intelligence profile — pure JS, zero D1
    let matchProfile = null;
    try {
      matchProfile = buildMatchIntelligenceProfile({
        game: g,
        homeProfile,
        awayProfile,
        h2h,
        h2hConfidence: h2h_confidence,
        confidence,
      });
    } catch (e) {
      console.warn(`[sofascoreIntelBulk] matchProfile build failed ${homeId}|${awayId}:`, e?.message);
    }

    gameIntelMap.set(`${homeId}|${awayId}`, {
      confidence,
      h2h_confidence,
      home:        homeFeats,
      away:        awayFeats,
      homeAtHome,
      awayOnRoad,
      h2h,
      combined,
      // P2.4 profiles
      homeProfile,
      awayProfile,
      matchProfile,
    });
  }

  const h2hPairsRequested = games.filter(g => g.homeId && g.awayId).length;

  // P2.4: compute profile stats for debug
  const profilesBuilt = teamProfileMap.size;
  let profilesHighConfidence = 0;
  let profilesLowDataQuality = 0;
  let totalDataQuality = 0;
  let dataQualityCount = 0;
  for (const [, prof] of teamProfileMap) {
    const dq = prof?.data_quality;
    if (dq?.confidence === 'high' || dq?.confidence === 'medium') profilesHighConfidence++;
    if (dq?.dataQualityScore != null && dq.dataQualityScore < 50) profilesLowDataQuality++;
    if (dq?.dataQualityScore != null) { totalDataQuality += dq.dataQualityScore; dataQualityCount++; }
  }
  const avgDataQualityScore = dataQualityCount > 0 ? Math.round(totalDataQuality / dataQualityCount) : null;

  return {
    gameIntelMap,
    coverage: {
      mode: 'bulk',
      teamIdsRequested: teamIds.length,
      teamsLoaded: matchesByTeamId.size,
      matchesLoaded: allFeatMatches.length + allH2HMatches.length,
      avgMatchesPerTeam: Math.round(allFeatMatches.length / (matchesByTeamId.size || 1)),
      h2hPairsRequested,
      h2hPairsWithMatches,
      queriesUsed,
      durationMs: Date.now() - startMs,
      warnings,
      // P2.4 profile stats
      profiles_built: profilesBuilt,
      profiles_high_confidence: profilesHighConfidence,
      profiles_low_data_quality: profilesLowDataQuality,
      avg_data_quality_score: avgDataQualityScore,
    },
  };
}
