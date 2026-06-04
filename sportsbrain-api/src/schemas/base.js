/**
 * SportsBrain Data API 4.0 — Base Response Schemas
 * ─────────────────────────────────────────────────
 * All API responses are wrapped in SportsBrainResponse.
 * Every data field carries quality metadata.
 * Clients can always trust what is data vs what is metadata.
 */

export const SB_VERSION = '1';

// ── Data Quality Levels ──────────────────────────────────────────────────
export const DATA_QUALITY = {
  REAL:    'REAL',     // sourced from a verified live/historical feed
  PARTIAL: 'PARTIAL',  // real data but incomplete (e.g. only last 3 games)
  EST:     'EST',      // estimated from averages/models
};

// Backward compatibility alias
export const DQ = DATA_QUALITY;

// ── Source Reliability Tiers ─────────────────────────────────────────────
export const SOURCE_RELIABILITY = {
  HIGH:   'HIGH',    // official API, confirmed data
  MEDIUM: 'MEDIUM',  // aggregated / semi-official
  LOW:    'LOW',     // estimated / inferred
};

// ── Confidence Tiers with Descriptions ───────────────────────────────────
export const CONVICTION = {
  PREMIUM: {
    min: 80,
    label: 'PREMIUM',
    stake: '3-5 units (high confidence)',
    description: 'Very high confidence — REAL data, conf ≥ 80, sample ≥ 5. Rare, selective, reliable.',
  },
  STRONG: {
    min: 68,
    label: 'STRONG',
    stake: '2-3 units (strong confidence)',
    description: 'Strong confidence — primary recommended plays',
  },
  SOLID: {
    min: 55,
    label: 'SOLID',
    stake: '1-2 units (solid confidence)',
    description: 'Solid confidence — viable supplementary plays',
  },
  MODERATE: {
    min: 40,
    label: 'MODERATE',
    stake: '0.5 units (moderate confidence)',
    description: 'Moderate confidence — exploratory or contrarian plays',
  },
  SPECULATIVE: {
    min: 0,
    label: 'SPECULATIVE',
    stake: '0 units (avoid)',
    description: 'Low confidence — information only, not recommended for play',
  },
};

// getConviction v2.1 (4.5.0): multi-dimensional with conviction_reason.
// PREMIUM requires: conf >= 80 AND dq !== EST AND sampleSize >= 5 (if known).
// Returns the conviction object plus a conviction_reason string explaining the assignment.
// When dq/sampleSize are not provided (null/0), backward-compatible behaviour is preserved.
export function getConviction(confidence, dq = null, sampleSize = 0) {
  if (confidence >= CONVICTION.PREMIUM.min) {
    const dqBlocked  = dq !== null && dq === DATA_QUALITY.EST;
    const sampleWeak = sampleSize > 0 && sampleSize < 5;
    if (!dqBlocked && !sampleWeak) {
      return { ...CONVICTION.PREMIUM, conviction_reason: `conf ${confidence} ≥ 80, DQ ${dq || 'verified'}, sample sufficient` };
    }
    // Downgrade: meets confidence bar but DQ or sample does not support PREMIUM
    const reason = dqBlocked
      ? `conf ${confidence} ≥ 80 but DQ=EST — PREMIUM blocked, downgraded to STRONG`
      : `conf ${confidence} ≥ 80 but sample ${sampleSize} < 5 — PREMIUM blocked, downgraded to STRONG`;
    return { ...CONVICTION.STRONG, conviction_reason: reason };
  }
  for (const [, v] of Object.entries(CONVICTION)) {
    if (confidence >= v.min) {
      const reason = `conf ${confidence} in range [${v.min}–${v.min + 12 < 100 ? v.min + 12 : 99}]`;
      return { ...v, conviction_reason: reason };
    }
  }
  return { ...CONVICTION.SPECULATIVE, conviction_reason: `conf ${confidence} below all thresholds` };
}

// ── Data Warning Helper ───────────────────────────────────────────────────
// Returns a warning string when a STRONG/SOLID pick is backed by weak data.
// Helps users calibrate trust even when the tier label looks good.
export function dataWarning(conviction, dq, sampleSize = 0) {
  if (!conviction || conviction === 'MODERATE' || conviction === 'SPECULATIVE') return null;
  if (conviction === 'STRONG' && (dq === DATA_QUALITY.EST || dq === DATA_QUALITY.PARTIAL) && sampleSize < 5) {
    return `STRONG based on ${dq} data (${sampleSize} games) — use with caution`;
  }
  if (conviction === 'SOLID' && dq === DATA_QUALITY.EST && sampleSize < 3) {
    return `SOLID based on minimal EST data (${sampleSize} games) — low reliability`;
  }
  return null;
}

// ── Product Modules ──────────────────────────────────────────────────────
export const PRODUCT_MODULES = {
  FOOTBALL: 'football',
  BASKETBALL: 'basketball',
  INTELLIGENCE: 'intelligence',
  ODDS: 'odds',
  HISTORY: 'history',
};

// ── API Tiers ────────────────────────────────────────────────────────────
export const API_TIERS = {
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
};

// ── Data Quality Object ───────────────────────────────────────────────────
export function makeQuality({
  level = DATA_QUALITY.EST,
  sourceReliability = SOURCE_RELIABILITY.LOW,
  sampleSize = 0,
  freshness = null,          // ISO timestamp of when data was last refreshed
  fallbackUsed = false,
  estimationMethod = null,   // e.g. 'season_average', 'h2h_weighted', 'xg_model'
  integrityScore = null,     // 0–100
  dataQuality = {},
} = {}) {
  // Calculate integrity_score if not provided
  let finalIntegrityScore = integrityScore;
  if (finalIntegrityScore === null) {
    const levelScore = level === DATA_QUALITY.REAL ? 80 : level === DATA_QUALITY.PARTIAL ? 50 : 30;
    const reliabilityScore =
      sourceReliability === SOURCE_RELIABILITY.HIGH ? 20 :
      sourceReliability === SOURCE_RELIABILITY.MEDIUM ? 10 : 5;
    finalIntegrityScore = Math.min(100, levelScore + reliabilityScore);
  }

  // Determine data_status based on freshness
  let dataStatus = 'live';
  if (freshness) {
    const now = new Date();
    const freshnessTime = new Date(freshness);
    const minutesOld = (now - freshnessTime) / (1000 * 60);

    if (minutesOld < 5) dataStatus = 'live';
    else if (minutesOld < 60) dataStatus = 'recent';
    else if (minutesOld < 1440) dataStatus = 'stale';
    else dataStatus = 'estimated';
  } else if (level === DATA_QUALITY.EST) {
    dataStatus = 'estimated';
  }

  return {
    level,
    source_reliability: sourceReliability,
    sample_size: sampleSize,
    freshness,
    fallback_used: fallbackUsed,
    estimation_method: estimationMethod,
    integrity_score: finalIntegrityScore,
    data_status: dataStatus,
    is_estimated: level === DATA_QUALITY.EST,
    is_real: level === DATA_QUALITY.REAL,
    is_partial: level === DATA_QUALITY.PARTIAL,
    ...dataQuality,
  };
}

// ── Line Movement Schema ──────────────────────────────────────────────────
export function makeLineMovement({
  opened_at = null,
  current_line = null,
  high = null,
  low = null,
  movement_direction = null,    // 'up' | 'down' | null
  movement_pct = null,           // percentage change
  snapshots_count = null,        // number of samples
  last_snapshot_at = null,       // ISO timestamp
} = {}) {
  return {
    opened_at,
    current_line,
    high,
    low,
    movement_direction,
    movement_pct,
    snapshots_count,
    last_snapshot_at,
  };
}

// ── Context Schema ──────────────────────────────────────────────────────
export function makeContext({
  is_playoff = null,
  is_neutral_venue = null,
  is_rivalry = null,
  is_revenge_game = null,
  weather = null,              // { temp_c, precipitation_pct, wind_kmh, condition }
  head_to_head = null,         // { last_5: [], home_wins, away_wins, draws }
} = {}) {
  return {
    is_playoff,
    is_neutral_venue,
    is_rivalry,
    is_revenge_game,
    weather: weather ? {
      temp_c: weather.temp_c || null,
      precipitation_pct: weather.precipitation_pct || null,
      wind_kmh: weather.wind_kmh || null,
      condition: weather.condition || null,
    } : null,
    head_to_head: head_to_head ? {
      last_5: head_to_head.last_5 || [],
      home_wins: head_to_head.home_wins || null,
      away_wins: head_to_head.away_wins || null,
      draws: head_to_head.draws || null,
    } : null,
  };
}

// ── SportsBrain Standard Response Wrapper ────────────────────────────────
export function sbResponse({
  data,
  meta = {},
  errors = [],
  status = 200,
}) {
  const now = new Date().toISOString();
  return {
    ok: errors.length === 0,
    version: `v${SB_VERSION}`,
    timestamp: now,
    meta: {
      api_version: 'v1',
      generated_at: now,
      source: 'SportsBrain Data API',
      limit: meta.limit || null,
      remaining: meta.remaining || null,
      reset: meta.reset || null,
      ...meta,
    },
    data,
    errors: errors.length ? errors : undefined,
  };
}

// ── Error Response ────────────────────────────────────────────────────────
export function sbError(code, message, status = 400) {
  return {
    ok: false,
    version: `v${SB_VERSION}`,
    timestamp: new Date().toISOString(),
    status,
    data: null,
    errors: [{
      code,
      message,
      docs_url: 'https://docs.sportsbrain.api/errors#' + code,
    }],
  };
}

// ── Odds & Value Schema ───────────────────────────────────────────────────
export function makeOddsValue({
  confidence,
  bookOdds = null,
  fairOdds = null,
  book_odds_calc = null,  // alias for bookOdds
  fair_odds_calc = null,  // alias for fairOdds
}) {
  const bo = bookOdds ?? book_odds_calc;
  const fo = fairOdds ?? fair_odds_calc;

  const p   = confidence / 100;
  const calculatedFo  = fo ?? (p > 0 ? parseFloat((1 / p).toFixed(3)) : null);
  const calculatedBo  = bo ?? (calculatedFo ? parseFloat((calculatedFo * 0.91).toFixed(3)) : null); // ~9% vig default
  const ev  = calculatedBo && calculatedFo ? parseFloat(((calculatedFo / calculatedBo - 1) * 100).toFixed(2)) : null;
  const edge = calculatedFo && calculatedBo ? parseFloat(((p - (1 / calculatedBo)) * 100).toFixed(2)) : null;
  const conviction = getConviction(confidence);

  return {
    confidence,
    fair_odds: calculatedFo,
    book_odds: calculatedBo,
    ev_pct: ev,
    edge_pct: edge,
    conviction: conviction.label,
    conviction_description: conviction.description,
    stake_suggest: conviction.stake,
    is_value: ev !== null && ev > 0,
  };
}

// ── Prop Tier Definitions ─────────────────────────────────────────────────
export const PROP_TIERS = {
  safe: {
    label: 'SAFE',
    desc: 'Conservative line, high hit rate',
  },
  median: {
    label: 'MEDIAN',
    desc: 'Balanced line, best risk/reward',
  },
  aggressive: {
    label: 'AGGRESSIVE',
    desc: 'Stretch line, higher EV upside',
  },
};
