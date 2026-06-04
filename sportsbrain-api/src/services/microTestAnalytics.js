/**
 * microTestAnalytics.js
 * Pure analytics layer for Micro-Test result reporting.
 * Only produces a report when micro_test_active === true.
 * Never unlocks beta or sell. Never produces commercial conclusions.
 */

export const ODDS_BUCKETS = [
  { label: '<1.50',    min: 0,    max: 1.50  },
  { label: '1.50-1.79', min: 1.50, max: 1.80  },
  { label: '1.80-2.09', min: 1.80, max: 2.10  },
  { label: '2.10-2.49', min: 2.10, max: 2.50  },
  { label: '2.50+',   min: 2.50, max: Infinity },
];

export function classifyOddsBucket(odd) {
  if (odd == null || typeof odd !== 'number' || isNaN(odd)) return 'unknown';
  for (const b of ODDS_BUCKETS) {
    if (odd >= b.min && odd < b.max) return b.label;
  }
  return 'unknown';
}

export function classifyConfidenceBucket(score) {
  if (score == null || typeof score !== 'number' || isNaN(score)) return 'unknown';
  if (score >= 0.75) return 'elite';
  if (score >= 0.65) return 'strong';
  if (score >= 0.55) return 'medium';
  return 'low';
}

/**
 * Builds a micro-test analytics report from an array of resolved rows.
 * Rows must already be filtered to training_eligible=1 AND result_status IN ('green','red').
 */
export function buildMicroTestReport(rows) {
  const sample_size  = rows.length;
  const green_count  = rows.filter(r => r.result_status === 'green').length;
  const red_count    = rows.filter(r => r.result_status === 'red').length;
  const hit_rate     = sample_size > 0 ? green_count / sample_size : null;
  const hit_rate_pct = hit_rate != null ? Math.round(hit_rate * 1000) / 10 : null;

  const by_sport             = {};
  const by_market            = {};
  const by_confidence_bucket = {};
  const by_odds_bucket       = {};
  const by_trust_level       = {};

  for (const row of rows) {
    const isGreen = row.result_status === 'green';

    const sport  = row.sport  || 'unknown';
    const market = row.market || 'unknown';
    const conf   = classifyConfidenceBucket(row.bet_confidence_score);
    const odds   = classifyOddsBucket(row.odd);
    const trust  = row.trust_level || 'unknown';

    for (const [dict, key] of [
      [by_sport, sport], [by_market, market],
      [by_confidence_bucket, conf], [by_odds_bucket, odds], [by_trust_level, trust],
    ]) {
      if (!dict[key]) dict[key] = { green: 0, red: 0, total: 0, hit_rate: null };
      dict[key].total++;
      if (isGreen) dict[key].green++; else dict[key].red++;
    }
  }

  for (const dict of [by_sport, by_market, by_confidence_bucket, by_odds_bucket, by_trust_level]) {
    for (const v of Object.values(dict)) {
      v.hit_rate = v.total > 0 ? Math.round((v.green / v.total) * 1000) / 1000 : null;
    }
  }

  return {
    status: 'active',
    sample_size,
    green_count,
    red_count,
    hit_rate,
    hit_rate_pct,
    by_sport,
    by_market,
    by_confidence_bucket,
    by_odds_bucket,
    by_trust_level,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Returns an inert report when micro-test is not yet active.
 */
function inertReport(status, reason) {
  return {
    status,
    reason,
    sample_size: 0,
    green_count: 0,
    red_count: 0,
    hit_rate: null,
    hit_rate_pct: null,
    by_sport: {},
    by_market: {},
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: {},
  };
}

/**
 * Queries D1 and returns a micro-test analytics report.
 * @param {object} env — Cloudflare Workers env with SB_DB
 * @param {{ can_micro_test: boolean, micro_test_active: boolean }} readiness
 * @param {number} days — lookback window (default 90)
 */
export async function queryMicroTestReport(env, readiness, days = 90) {
  if (!readiness?.can_micro_test) {
    return inertReport('not_started', 'threshold_not_reached');
  }
  if (!readiness?.micro_test_active) {
    return inertReport('waiting_for_activation', 'micro_test_enabled_false');
  }
  if (!env?.SB_DB) {
    return inertReport('not_started', 'db_not_configured');
  }

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { results } = await env.SB_DB.prepare(`
      SELECT sport, market, bet_confidence_score, odd, trust_level, result_status
      FROM shadow_bets
      WHERE training_eligible = 1
        AND result_status IN ('green', 'red')
        AND created_at >= ?
      ORDER BY created_at DESC
    `).bind(since).all();

    return buildMicroTestReport(results ?? []);
  } catch (err) {
    console.error('[microTestAnalytics] queryMicroTestReport error:', err);
    return inertReport('not_started', 'query_error');
  }
}
