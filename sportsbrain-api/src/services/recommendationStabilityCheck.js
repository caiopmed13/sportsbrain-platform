// recommendationStabilityCheck.js
// Version: p3.9.4
// Pure function service — no imports from other project files, no DB, no network.

export const SERVICE_VERSION = 'p3.9.4';

// Safety invariants — always false
const SAFETY_DEFAULTS = {
  can_beta: false,
  can_sell: false,
  delivery_allowed: false,
  real_delivery: false,
};

/**
 * Generates a deterministic synthetic "previous" recommendation based on current
 * recommendation and sample_size.
 */
export function buildSyntheticPreviousRecommendation(current, sample_size) {
  const n = Number(sample_size) || 0;

  if (current === 'recommend_exclude') {
    return n >= 15 ? 'watch' : 'continue_collecting';
  }
  if (current === 'candidate_keep') {
    return n >= 15 ? 'candidate_keep' : 'continue_collecting';
  }
  if (current === 'watch') {
    return n >= 10 ? 'watch' : 'continue_collecting';
  }
  if (current === 'continue_collecting') {
    return 'continue_collecting';
  }
  // insufficient_sample or anything else
  return 'insufficient_sample';
}

/**
 * Determines change_direction from previous and current recommendation.
 */
function resolveChangeDirection(previous, current) {
  if (current === previous) return 'same';

  if (current === 'recommend_exclude') {
    if (previous === 'watch' || previous === 'continue_collecting') return 'worse';
  }

  if (current === 'candidate_keep') return 'better';

  if (current === 'watch' && previous === 'continue_collecting') return 'better';

  return 'unknown';
}

/**
 * Builds the stability matrix from a recommendations array.
 * Each entry: { segment_type, segment_key, recommendation, sample_size, hit_rate, edge_vs_break_even }
 */
export function buildRecommendationStabilityMatrix(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return { status: 'empty', segments_count: 0, segments: [] };
  }

  const segments = recommendations.map((rec) => {
    const current = rec.recommendation || 'insufficient_sample';
    const sample_size = Number(rec.sample_size) || 0;
    const previous = buildSyntheticPreviousRecommendation(current, sample_size);
    const stable = current === previous;
    const change_direction = resolveChangeDirection(previous, current);

    return {
      segment_type: rec.segment_type || null,
      segment_key: rec.segment_key || null,
      previous_recommendation: previous,
      current_recommendation: current,
      stable,
      change_direction,
      sample_size,
      edge_vs_break_even:
        rec.edge_vs_break_even !== undefined ? rec.edge_vs_break_even : null,
      simulated_previous: true,
    };
  });

  return {
    status: 'available',
    segments_count: segments.length,
    segments,
  };
}

/**
 * Builds the stability check summary object from the matrix.
 */
export function buildRecommendationStabilityCheck(matrix) {
  if (!matrix || matrix.status === 'empty' || matrix.segments_count === 0) {
    return {
      status: 'empty',
      check_version: SERVICE_VERSION,
      simulation_only: true,
      recommendations_evaluated: 0,
      stable_count: 0,
      changed_count: 0,
      stability_rate: 0,
      stability_level: 'not_available',
      requires_more_runs: true,
      can_beta: false,
      can_sell: false,
    };
  }

  const evaluated = matrix.segments_count;
  const stable_count = matrix.segments.filter((s) => s.stable).length;
  const changed_count = evaluated - stable_count;
  const stability_rate =
    evaluated > 0
      ? Math.round((stable_count / evaluated) * 10000) / 10000
      : 0;

  return {
    status: 'evaluated',
    check_version: SERVICE_VERSION,
    simulation_only: true,
    recommendations_evaluated: evaluated,
    stable_count,
    changed_count,
    stability_rate,
    // Always insufficient_runs because we only have synthetic baseline
    stability_level: 'insufficient_runs',
    requires_more_runs: true,
    can_beta: false,
    can_sell: false,
  };
}

/**
 * Builds the human-readable stability summary.
 */
export function buildRecommendationStabilitySummary(check) {
  return {
    status: 'insufficient_runs',
    headline: 'Estabilidade ainda exige mais rodadas.',
    summary_text:
      'As recomendações foram comparadas com baseline sintética; ainda é necessário acompanhar múltiplas rodadas.',
    stability_rate: check ? check.stability_rate || 0 : 0,
    requires_more_runs: true,
    safe_to_beta: false,
    safe_to_sell: false,
  };
}

/**
 * Main evaluator. Accepts rawInput and options. All safety invariants are forced false.
 */
export function evaluateRecommendationStabilityCheck(rawInput, options = {}) {
  const input = rawInput || {};

  // Extract recommendations array
  const exclusionRecs = input.segment_exclusion_recommendations;
  const recommendations =
    exclusionRecs && Array.isArray(exclusionRecs.recommendations)
      ? exclusionRecs.recommendations
      : [];

  // Build pipeline
  const matrix = buildRecommendationStabilityMatrix(recommendations);
  const check = buildRecommendationStabilityCheck(matrix);
  const summary = buildRecommendationStabilitySummary(check);

  // Enforce safety invariants regardless of any input
  check.can_beta = false;
  check.can_sell = false;

  return {
    recommendation_stability_check: check,
    recommendation_stability_matrix: matrix,
    recommendation_stability_summary: summary,
  };
}
