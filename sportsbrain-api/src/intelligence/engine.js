// ─────────────────────────────────────────────────────────────
// PROPRIETARY MODULE — implementation withheld from the public portfolio.
// Core intelligence engine that turns raw sports data into scored
// projections, confidence/EV outputs, prop tiers and opportunity rankings.
// Combines data-quality weighting, recency models and sport-specific estimators.
// ─────────────────────────────────────────────────────────────

const __WITHHELD = 'Proprietary module — implementation withheld from public portfolio.';

// API version constant
export const INTELLIGENCE_VERSION = null; // withheld

export function probToConf(prob, dq, sampleSize) { throw new Error(__WITHHELD); }
export function lineConf(projAvg, line, variance, dataQuality, sampleSize) { throw new Error(__WITHHELD); }
export function ftTeamPropConf(avg, line, variance, dq, sampleSize) { throw new Error(__WITHHELD); }
export function ftPlayerPropConf(perGameAvg, line, dq, sampleSize) { throw new Error(__WITHHELD); }
export function bkPlayerPropConf(avg, line, stat, isRealData, isB2B, sampleSize) { throw new Error(__WITHHELD); }
export function tierLines(avg, roundToHalf) { throw new Error(__WITHHELD); }
export function matchupBoost(opponentDef, stat) { throw new Error(__WITHHELD); }
export function b2bImpact(stat) { throw new Error(__WITHHELD); }
export function opportunityScore(args) { throw new Error(__WITHHELD); }
export function robustnessScore(args) { throw new Error(__WITHHELD); }
export function impliedEV(confidence, market) { throw new Error(__WITHHELD); }
export function estimateMatchImportance(game) { throw new Error(__WITHHELD); }
export function estimateShots(homeStats, awayStats, leagueContext, matchImportance) { throw new Error(__WITHHELD); }
export function estimateCorners(homeStats, awayStats, leagueContext, matchImportance) { throw new Error(__WITHHELD); }
export function estimateGoals(homeStats, awayStats, leagueContext, matchImportance) { throw new Error(__WITHHELD); }
export function estimateCards(homeStats, awayStats, leagueContext, refereeBias) { throw new Error(__WITHHELD); }
export function estimateOffsides(homeStats, awayStats) { throw new Error(__WITHHELD); }
export function estimate1X2(lambdaHome, lambdaAway) { throw new Error(__WITHHELD); }
export function probGoalsOver(lambdaTotal, line) { throw new Error(__WITHHELD); }
export function bkContextAvg(playerAvg, opponentDef, stat, isHome, isB2B) { throw new Error(__WITHHELD); }
export function valueLabel(conf, ev) { throw new Error(__WITHHELD); }
export function marketHealth(bookOdds, fairOdds) { throw new Error(__WITHHELD); }
export function clvFields(args) { throw new Error(__WITHHELD); }
export function recencyWeight(games_array, decay_factor) { throw new Error(__WITHHELD); }
export function homeAwayAdjust(base_value, home_away_splits, is_home) { throw new Error(__WITHHELD); }
export function formStreak(recent_results_array) { throw new Error(__WITHHELD); }
export function dataFreshness(updated_at_iso, ttl_seconds) { throw new Error(__WITHHELD); }
export function projectionRange(avg, variance) { throw new Error(__WITHHELD); }
export function qualityMultiplier(dataQuality) { throw new Error(__WITHHELD); }
