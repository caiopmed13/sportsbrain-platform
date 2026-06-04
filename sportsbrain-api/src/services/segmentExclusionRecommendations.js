// src/services/segmentExclusionRecommendations.js
// p3.9.2 — Segment Exclusion Recommendations, Watchlist & Policy

const RECOMMENDATIONS_VERSION = 'p3.9.2'

// ── Unsafe fields that must never be propagated from input ────────────────────

const UNSAFE_FIELDS = ['can_beta', 'can_sell', 'delivery_allowed', 'real_delivery', 'auto_apply_exclusions']

function sanitizeInput(input = {}) {
  const clean = Object.assign({}, input)
  for (const field of UNSAFE_FIELDS) {
    delete clean[field]
  }
  return clean
}

// ── Confidence from sample size ───────────────────────────────────────────────

function computeConfidence(sample_size) {
  if (sample_size >= 20) return 'high'
  if (sample_size >= 10) return 'medium'
  return 'low'
}

// ── Single-segment recommendation logic ──────────────────────────────────────

function classifySegment(seg) {
  const { sample_size = 0, hit_rate = null, edge_vs_break_even = null } = seg

  if (sample_size < 5) {
    return {
      recommendation: 'insufficient_sample',
      reason: 'insufficient_sample_for_judgment',
    }
  }

  if (sample_size >= 10 && edge_vs_break_even != null && edge_vs_break_even <= -0.08) {
    return {
      recommendation: 'recommend_exclude',
      reason: 'negative_edge_with_actionable_sample',
    }
  }

  if (sample_size >= 5 && edge_vs_break_even != null && edge_vs_break_even < 0) {
    return {
      recommendation: 'watch',
      reason: 'negative_edge_small_sample',
    }
  }

  if (sample_size >= 5 && hit_rate != null && hit_rate < 0.45) {
    return {
      recommendation: 'watch',
      reason: 'low_hit_rate',
    }
  }

  if (sample_size >= 10 && edge_vs_break_even != null && edge_vs_break_even >= 0.03) {
    return {
      recommendation: 'candidate_keep',
      reason: 'positive_edge_with_actionable_sample',
    }
  }

  return {
    recommendation: 'continue_collecting',
    reason: 'needs_more_sample',
  }
}

// ── buildSegmentExclusionRecommendations ─────────────────────────────────────

export function buildSegmentExclusionRecommendations(input = {}, violations = []) {
  const segments = input.all_segments

  if (violations.length > 0) {
    return {
      status: 'critical_violation',
      recommendations_version: RECOMMENDATIONS_VERSION,
      auto_apply_exclusions: false,
      recommendations_count: 0,
      recommendations: [],
    }
  }

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return {
      status: 'empty',
      recommendations_version: RECOMMENDATIONS_VERSION,
      auto_apply_exclusions: false,
      recommendations_count: 0,
      recommendations: [],
    }
  }

  const recommendations = segments.map(seg => {
    const { segment_type, segment_key, sample_size = 0, hit_rate = null, edge_vs_break_even = null } = seg
    const { recommendation, reason } = classifySegment(seg)
    return {
      segment_type,
      segment_key,
      recommendation,
      reason,
      sample_size,
      hit_rate,
      edge_vs_break_even: edge_vs_break_even ?? null,
      confidence: computeConfidence(sample_size),
      auto_applied: false,
    }
  })

  return {
    status: 'generated',
    recommendations_version: RECOMMENDATIONS_VERSION,
    auto_apply_exclusions: false,
    recommendations_count: recommendations.length,
    recommendations,
  }
}

// ── Watchlist condition helpers ───────────────────────────────────────────────

function isCandidateExclusion(seg) {
  const { sample_size = 0, edge_vs_break_even = null } = seg
  return sample_size >= 10 && edge_vs_break_even != null && edge_vs_break_even <= -0.08
}

function isNegativeEdgeSmallSample(seg) {
  const { sample_size = 0, edge_vs_break_even = null } = seg
  return sample_size >= 5 && sample_size <= 9 && edge_vs_break_even != null && edge_vs_break_even < 0
}

function isLowHitRate(seg) {
  const { sample_size = 0, hit_rate = null } = seg
  return sample_size >= 5 && hit_rate != null && hit_rate < 0.45
}

function isNeedsMoreSample(seg) {
  return (seg.sample_size ?? 0) < 5
}

// ── buildSegmentWatchlist ─────────────────────────────────────────────────────

export function buildSegmentWatchlist(input = {}, violations = []) {
  const segments = input.all_segments

  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return {
      status: 'empty',
      watchlist_count: 0,
      watchlist: [],
    }
  }

  const watchlist = []

  for (const seg of segments) {
    const { segment_key, segment_type, sample_size = 0, hit_rate = null, edge_vs_break_even = null } = seg

    let watchReason = null

    if (isCandidateExclusion(seg)) {
      watchReason = 'candidate_exclusion_pending'
    } else if (isNegativeEdgeSmallSample(seg)) {
      watchReason = 'negative_edge_small_sample'
    } else if (isLowHitRate(seg)) {
      watchReason = 'low_hit_rate'
    } else if (isNeedsMoreSample(seg)) {
      watchReason = 'needs_more_sample'
    }

    if (watchReason) {
      const entry = { segment_key, segment_type, reason: watchReason, sample_size, hit_rate }
      if (edge_vs_break_even != null) entry.edge_vs_break_even = edge_vs_break_even
      watchlist.push(entry)
    }
  }

  return {
    status: watchlist.length > 0 ? 'generated' : 'empty',
    watchlist_count: watchlist.length,
    watchlist,
  }
}

// ── buildSegmentRecommendationPolicy ─────────────────────────────────────────

export function buildSegmentRecommendationPolicy(input = {}, violations = []) {
  const policy = {
    status: 'active',
    policy_version: RECOMMENDATIONS_VERSION,
    auto_apply_exclusions: false,
    manual_operator_review_required: true,
    minimum_actionable_sample: 10,
    minimum_watch_sample: 5,
    exclude_edge_threshold: -0.08,
    watch_edge_threshold: 0,
    can_change_pick_engine_now: false,
  }

  if (violations.length > 0) {
    policy.note = 'Policy active but violations detected — no actions allowed until violations are resolved.'
  }

  return policy
}

// ── buildSegmentExclusionSummary ──────────────────────────────────────────────

export function buildSegmentExclusionSummary(input = {}, violations = []) {
  const segments = input.all_segments ?? []
  const recommendations = Array.isArray(segments) ? segments : []

  let recommend_exclude_count = 0
  let watch_count = 0
  let candidate_keep_count = 0

  for (const seg of recommendations) {
    const { recommendation, reason } = classifySegment(seg)
    if (recommendation === 'recommend_exclude') recommend_exclude_count++
    else if (recommendation === 'watch') watch_count++
    else if (recommendation === 'candidate_keep') candidate_keep_count++
  }

  return {
    status: 'review_required',
    headline: 'Recomendações de segmento geradas sem aplicação automática.',
    summary_text: 'Alguns segmentos podem ser observados ou excluídos futuramente, mas nenhuma mudança foi aplicada ao motor.',
    recommend_exclude_count,
    watch_count,
    candidate_keep_count,
    auto_apply_exclusions: false,
    safe_to_beta: false,
    safe_to_sell: false,
  }
}

// ── evaluateSegmentExclusionRecommendations  (main export) ───────────────────

export function evaluateSegmentExclusionRecommendations(rawInput = {}, options = {}) {
  const input = sanitizeInput(rawInput)

  // Resolve all_segments — prefer direct field, fall back to segment_break_even_matrix.segments
  const all_segments = Array.isArray(input.all_segments)
    ? input.all_segments
    : (input.segment_break_even_matrix?.segments ?? [])

  const enrichedInput = Object.assign({}, input, { all_segments })

  const violations = []  // no violation detection at this layer; kept for downstream composability

  const segment_exclusion_recommendations = buildSegmentExclusionRecommendations(enrichedInput, violations)
  const segment_watchlist                 = buildSegmentWatchlist(enrichedInput, violations)
  const segment_recommendation_policy    = buildSegmentRecommendationPolicy(enrichedInput, violations)
  const segment_exclusion_summary        = buildSegmentExclusionSummary(enrichedInput, violations)

  return {
    segment_exclusion_recommendations,
    segment_watchlist,
    segment_recommendation_policy,
    segment_exclusion_summary,
  }
}
