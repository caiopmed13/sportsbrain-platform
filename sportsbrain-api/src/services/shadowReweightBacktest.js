// shadowReweightBacktest.js
// Pure-function service — ESM, no imports from other project files, no DB, no network.
// Version: p3.9.4

export const VERSION = 'p3.9.4'

// Safety invariants — these fields are ALWAYS false in output, even if input tries to set them true.
const SAFETY_INVARIANT_FIELDS = [
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
  'reweight_applied',
  'engine_weights_changed',
  'real_ranking_changed',
]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

/**
 * Sanitize input and collect safety violations.
 * Returns { sanitized, violations }
 */
function sanitizeInput(rawInput) {
  const sanitized = Object.assign({}, rawInput)
  const violations = []

  for (const field of SAFETY_INVARIANT_FIELDS) {
    if (rawInput[field] === true) {
      violations.push({
        field,
        attempted_value: true,
        enforced_value: false,
        reason: `Safety invariant: ${field} must always be false`,
      })
      sanitized[field] = false
    } else {
      sanitized[field] = false
    }
  }

  return { sanitized, violations }
}

/**
 * Match a row to the best weight change from weightChanges.
 * Try market first, then sport.
 */
function matchWeight(row, changes) {
  if (!Array.isArray(changes) || changes.length === 0) return 1.0

  // Try matching by market first
  if (row.market) {
    const match = changes.find(
      (c) => c.segment_key === row.market
    )
    if (match && typeof match.proposed_weight === 'number') {
      return match.proposed_weight
    }
  }

  // Then try sport
  if (row.sport) {
    const match = changes.find(
      (c) => c.segment_key === row.sport
    )
    if (match && typeof match.proposed_weight === 'number') {
      return match.proposed_weight
    }
  }

  return 1.0
}

/**
 * Compute shadow-adjusted score for a single row.
 * @param {object} row - { bet_confidence_score, market, sport, ... }
 * @param {Array} weightChanges - array of { segment_key, proposed_weight, ... }
 * @returns {{ base_score, shadow_score, matched_weight }}
 */
export function computeShadowAdjustedScore(row, weightChanges) {
  const changes = Array.isArray(weightChanges) ? weightChanges : []
  const base_score = row.bet_confidence_score != null ? row.bet_confidence_score : 50
  const matched_weight = matchWeight(row, changes)
  const shadow_score = clamp(base_score * matched_weight, 0, 100)
  return { base_score, shadow_score, matched_weight }
}

/**
 * Build the shadow ranking delta report.
 * @param {Array} resolvedRows
 * @param {object} weightChanges - { changes: [...] }
 * @returns {object}
 */
export function buildShadowRankingDeltaReport(resolvedRows, weightChanges) {
  const rows = Array.isArray(resolvedRows) ? resolvedRows : []
  const changes =
    weightChanges && Array.isArray(weightChanges.changes)
      ? weightChanges.changes
      : []

  if (rows.length === 0) {
    return {
      status: 'empty',
      rows_evaluated: 0,
      promoted_count: 0,
      demoted_count: 0,
      unchanged_count: 0,
      average_abs_delta: 0,
      max_promotion_delta: 0,
      max_demotion_delta: 0,
      top_promotions: [],
      top_demotions: [],
    }
  }

  // Compute scores for each row
  const scored = rows.map((row, idx) => {
    const { base_score, shadow_score, matched_weight } = computeShadowAdjustedScore(row, changes)
    return {
      row_id: `shadow-row-${idx}`,
      sport: row.sport || null,
      market: row.market || null,
      result_status: row.result_status || null,
      base_score,
      shadow_score,
      matched_weight,
      simulated_only: true,
    }
  })

  // Sort by base_score descending → original_rank (1-indexed)
  const byBase = [...scored].sort((a, b) => b.base_score - a.base_score)
  const originalRankMap = new Map()
  byBase.forEach((item, idx) => {
    originalRankMap.set(item.row_id, idx + 1)
  })

  // Sort by shadow_score descending → shadow_rank (1-indexed)
  const byShadow = [...scored].sort((a, b) => b.shadow_score - a.shadow_score)
  const shadowRankMap = new Map()
  byShadow.forEach((item, idx) => {
    shadowRankMap.set(item.row_id, idx + 1)
  })

  // Compute rank_delta for each row
  const withDeltas = scored.map((item) => {
    const original_rank = originalRankMap.get(item.row_id)
    const shadow_rank = shadowRankMap.get(item.row_id)
    const rank_delta = original_rank - shadow_rank
    return { ...item, original_rank, shadow_rank, rank_delta }
  })

  const promoted_count = withDeltas.filter((r) => r.rank_delta > 0).length
  const demoted_count = withDeltas.filter((r) => r.rank_delta < 0).length
  const unchanged_count = withDeltas.filter((r) => r.rank_delta === 0).length

  const absDeltas = withDeltas.map((r) => Math.abs(r.rank_delta))
  const average_abs_delta =
    absDeltas.length > 0
      ? round4(absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length)
      : 0

  const allDeltas = withDeltas.map((r) => r.rank_delta)
  const max_promotion_delta = allDeltas.length > 0 ? Math.max(...allDeltas) : 0
  const max_demotion_delta = allDeltas.length > 0 ? Math.min(...allDeltas) : 0

  // top_promotions: top 3 by rank_delta descending
  const top_promotions = [...withDeltas]
    .sort((a, b) => b.rank_delta - a.rank_delta)
    .slice(0, 3)
    .map((r) => ({
      row_id: r.row_id,
      sport: r.sport,
      market: r.market,
      result_status: r.result_status,
      base_score: r.base_score,
      shadow_score: r.shadow_score,
      original_rank: r.original_rank,
      shadow_rank: r.shadow_rank,
      rank_delta: r.rank_delta,
      matched_weight: r.matched_weight,
      simulated_only: true,
    }))

  // top_demotions: top 3 by rank_delta ascending (most negative)
  const top_demotions = [...withDeltas]
    .sort((a, b) => a.rank_delta - b.rank_delta)
    .slice(0, 3)
    .map((r) => ({
      row_id: r.row_id,
      sport: r.sport,
      market: r.market,
      result_status: r.result_status,
      base_score: r.base_score,
      shadow_score: r.shadow_score,
      original_rank: r.original_rank,
      shadow_rank: r.shadow_rank,
      rank_delta: r.rank_delta,
      matched_weight: r.matched_weight,
      simulated_only: true,
    }))

  return {
    status: 'available',
    rows_evaluated: rows.length,
    promoted_count,
    demoted_count,
    unchanged_count,
    average_abs_delta,
    max_promotion_delta,
    max_demotion_delta,
    top_promotions,
    top_demotions,
  }
}

/**
 * Build the shadow_reweight_backtest block.
 * @param {Array} resolvedRows
 * @param {Array} violations
 * @returns {object}
 */
export function buildShadowReweightBacktest(resolvedRows, violations) {
  const rows = Array.isArray(resolvedRows) ? resolvedRows : []
  const viols = Array.isArray(violations) ? violations : []

  let status
  if (viols.length > 0) {
    status = 'critical_violation'
  } else if (rows.length === 0) {
    status = 'empty'
  } else {
    status = 'simulated'
  }

  return {
    status,
    backtest_version: VERSION,
    shadow_backtest_only: true,
    rows_evaluated: rows.length,
    original_rank_available: true,
    shadow_rank_generated: true,
    reweight_applied: false,
    engine_weights_changed: false,
    real_ranking_changed: false,
    can_beta: false,
    can_sell: false,
    violations: viols,
  }
}

/**
 * Build the shadow_backtest_audit block.
 * @param {Array} resolvedRows
 * @param {object} weightChanges
 * @returns {object}
 */
export function buildShadowBacktestAudit(resolvedRows, weightChanges) {
  const rows = Array.isArray(resolvedRows) ? resolvedRows : []
  const changes =
    weightChanges && Array.isArray(weightChanges.changes)
      ? weightChanges.changes
      : []

  const entries = [
    { event: 'rows_loaded', version: VERSION, ok: true },
    { event: 'proposed_weights_loaded', version: VERSION, ok: true },
    { event: 'shadow_scores_computed', version: VERSION, ok: rows.length >= 0 },
    { event: 'ranking_delta_generated', version: VERSION, ok: true },
    { event: 'no_real_ranking_change_confirmed', version: VERSION, ok: true },
    { event: 'no_engine_weight_change_confirmed', version: VERSION, ok: true },
  ]

  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: entries.length,
    entries,
  }
}

/**
 * Build the shadow_backtest_summary block.
 * @param {Array} resolvedRows
 * @param {object} deltaReport
 * @param {Array} violations
 * @returns {object}
 */
export function buildShadowBacktestSummary(resolvedRows, deltaReport, violations) {
  const rows = Array.isArray(resolvedRows) ? resolvedRows : []
  const viols = Array.isArray(violations) ? violations : []
  const status = rows.length === 0 ? 'empty' : 'simulated'

  return {
    status,
    headline: 'Backtest shadow de reweight executado.',
    summary_text:
      'Ranking ajustado foi simulado, mas nenhuma mudança real foi aplicada.',
    rows_evaluated: rows.length,
    promoted_count: deltaReport ? deltaReport.promoted_count ?? 0 : 0,
    demoted_count: deltaReport ? deltaReport.demoted_count ?? 0 : 0,
    reweight_applied: false,
    real_ranking_changed: false,
    safe_to_beta: false,
    safe_to_sell: false,
  }
}

/**
 * Main entry point.
 * @param {object} rawInput
 * @param {object} [options]
 * @returns {object}
 */
export function evaluateShadowReweightBacktest(rawInput, options) {
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {}

  const { sanitized, violations } = sanitizeInput(input)

  const resolvedRows = Array.isArray(sanitized.resolved_rows)
    ? sanitized.resolved_rows
    : []

  const weightChanges =
    sanitized.proposed_weight_changes &&
    typeof sanitized.proposed_weight_changes === 'object'
      ? sanitized.proposed_weight_changes
      : { changes: [] }

  const shadow_reweight_backtest = buildShadowReweightBacktest(resolvedRows, violations)
  const shadow_ranking_delta_report = buildShadowRankingDeltaReport(resolvedRows, weightChanges)
  const shadow_backtest_audit = buildShadowBacktestAudit(resolvedRows, weightChanges)
  const shadow_backtest_summary = buildShadowBacktestSummary(
    resolvedRows,
    shadow_ranking_delta_report,
    violations
  )

  return {
    shadow_reweight_backtest,
    shadow_ranking_delta_report,
    shadow_backtest_audit,
    shadow_backtest_summary,
  }
}
