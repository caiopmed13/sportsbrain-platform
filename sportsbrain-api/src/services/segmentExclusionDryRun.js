// src/services/segmentExclusionDryRun.js
// p3.9.3 — Segment Exclusion Dry-Run Simulation

const DRY_RUN_VERSION = 'p3.9.3'

// ── Unsafe fields that must never be propagated from input ────────────────────

const UNSAFE_FIELDS = [
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
  'auto_apply_exclusions',
  'exclusions_applied',
  'real_filter_changed',
]

function sanitizeInput(raw = {}) {
  const sanitized = Object.assign({}, raw)
  const violations = []

  for (const field of UNSAFE_FIELDS) {
    if (raw[field] === true || raw[field] === 'true') {
      violations.push({
        field,
        attempted_value: raw[field],
        forced_to: false,
        reason: `Safety invariant: ${field} must always be false`,
      })
    }
    delete sanitized[field]
  }

  return { sanitized, violations }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round4(v) {
  return Math.round(v * 10000) / 10000
}

// ── matchRowToSegmentRecommendation ───────────────────────────────────────────

export function matchRowToSegmentRecommendation(row, recommendation) {
  if (!row || !recommendation) return false
  if (recommendation.recommendation !== 'recommend_exclude') return false
  const key = recommendation.segment_key
  return row.sport === key || row.market === key
}

// ── buildSegmentExclusionDryRun ───────────────────────────────────────────────

export function buildSegmentExclusionDryRun(input = {}, violations = []) {
  const recommendations = input.segment_exclusion_recommendations?.recommendations ?? []
  const resolvedRows    = Array.isArray(input.resolved_rows) ? input.resolved_rows : []

  if (violations.length > 0) {
    return {
      status: 'critical_violation',
      dry_run_version: DRY_RUN_VERSION,
      dry_run_only: true,
      auto_apply_exclusions: false,
      exclusions_applied: false,
      real_filter_changed: false,
      recommendations_count: 0,
      segments_marked_for_exclusion_count: 0,
      rows_evaluated: 0,
      rows_would_be_excluded: 0,
      rows_would_remain: 0,
      can_beta: false,
      can_sell: false,
      violations,
    }
  }

  const excludeRecs = recommendations.filter(r => r.recommendation === 'recommend_exclude')

  if (recommendations.length === 0 || resolvedRows.length === 0) {
    const status = recommendations.length > 0 && resolvedRows.length === 0
      ? 'insufficient_data'
      : 'empty'
    return {
      status,
      dry_run_version: DRY_RUN_VERSION,
      dry_run_only: true,
      auto_apply_exclusions: false,
      exclusions_applied: false,
      real_filter_changed: false,
      recommendations_count: recommendations.length,
      segments_marked_for_exclusion_count: excludeRecs.length,
      rows_evaluated: resolvedRows.length,
      rows_would_be_excluded: 0,
      rows_would_remain: resolvedRows.length,
      can_beta: false,
      can_sell: false,
      violations: [],
    }
  }

  const wouldBeExcluded = resolvedRows.filter(row =>
    excludeRecs.some(rec => matchRowToSegmentRecommendation(row, rec))
  )

  return {
    status: 'simulated',
    dry_run_version: DRY_RUN_VERSION,
    dry_run_only: true,
    auto_apply_exclusions: false,
    exclusions_applied: false,
    real_filter_changed: false,
    recommendations_count: recommendations.length,
    segments_marked_for_exclusion_count: excludeRecs.length,
    rows_evaluated: resolvedRows.length,
    rows_would_be_excluded: wouldBeExcluded.length,
    rows_would_remain: resolvedRows.length - wouldBeExcluded.length,
    can_beta: false,
    can_sell: false,
    violations: [],
  }
}

// ── buildDryRunExcludedSegments ───────────────────────────────────────────────

export function buildDryRunExcludedSegments(input = {}) {
  const recommendations = input.segment_exclusion_recommendations?.recommendations ?? []
  const resolvedRows    = Array.isArray(input.resolved_rows) ? input.resolved_rows : []

  const excludeRecs = recommendations.filter(r => r.recommendation === 'recommend_exclude')

  if (excludeRecs.length === 0) {
    return {
      status: 'empty',
      segments_count: 0,
      segments: [],
    }
  }

  const segments = excludeRecs.map(rec => {
    const matchedRows = resolvedRows.filter(row => matchRowToSegmentRecommendation(row, rec))
    const green_removed = matchedRows.filter(r => r.result_status === 'green').length
    const red_removed   = matchedRows.filter(r => r.result_status === 'red').length

    return {
      segment_type:       rec.segment_type,
      segment_key:        rec.segment_key,
      recommendation:     rec.recommendation,
      matched_rows_count: matchedRows.length,
      green_removed,
      red_removed,
      simulated_only:     true,
      auto_applied:       false,
    }
  })

  return {
    status: 'available',
    segments_count: segments.length,
    segments,
  }
}

// ── buildSegmentExclusionImpactReport ─────────────────────────────────────────

export function buildSegmentExclusionImpactReport(input = {}) {
  const recommendations = input.segment_exclusion_recommendations?.recommendations ?? []
  const resolvedRows    = Array.isArray(input.resolved_rows) ? input.resolved_rows : []

  const sample_size_before = resolvedRows.length

  if (sample_size_before === 0) {
    return {
      status: 'not_available',
      sample_size_before: 0,
      sample_size_after_simulated: 0,
      green_before: 0,
      red_before: 0,
      green_after_simulated: 0,
      red_after_simulated: 0,
      hit_rate_before: 0,
      hit_rate_after_simulated: 0,
      delta_hit_rate_simulated: 0,
      removed_green_count: 0,
      removed_red_count: 0,
      impact_quality: 'not_available',
    }
  }

  const excludeRecs = recommendations.filter(r => r.recommendation === 'recommend_exclude')

  const excludedRows = resolvedRows.filter(row =>
    excludeRecs.some(rec => matchRowToSegmentRecommendation(row, rec))
  )

  const removed_green_count = excludedRows.filter(r => r.result_status === 'green').length
  const removed_red_count   = excludedRows.filter(r => r.result_status === 'red').length

  const green_before = resolvedRows.filter(r => r.result_status === 'green').length
  const red_before   = resolvedRows.filter(r => r.result_status === 'red').length

  const green_after_simulated = green_before - removed_green_count
  const red_after_simulated   = red_before   - removed_red_count
  const sample_size_after_simulated = sample_size_before - (removed_green_count + removed_red_count)

  const hit_rate_before          = round4(green_before / sample_size_before)
  const hit_rate_after_simulated = sample_size_after_simulated > 0
    ? round4(green_after_simulated / sample_size_after_simulated)
    : 0
  const delta_hit_rate_simulated = round4(hit_rate_after_simulated - hit_rate_before)

  let impact_quality
  if (sample_size_after_simulated === 0) {
    impact_quality = 'insufficient_data'
  } else if (removed_red_count > removed_green_count && hit_rate_after_simulated > hit_rate_before) {
    impact_quality = 'improves_hit_rate'
  } else if (removed_green_count > removed_red_count) {
    impact_quality = 'hurts_hit_rate'
  } else {
    impact_quality = 'neutral'
  }

  const status = excludeRecs.length > 0 ? 'available' : 'insufficient_data'

  return {
    status,
    sample_size_before,
    sample_size_after_simulated,
    green_before,
    red_before,
    green_after_simulated,
    red_after_simulated,
    hit_rate_before,
    hit_rate_after_simulated,
    delta_hit_rate_simulated,
    removed_green_count,
    removed_red_count,
    impact_quality,
  }
}

// ── buildSegmentExclusionDryRunSummary ────────────────────────────────────────

export function buildSegmentExclusionDryRunSummary(input = {}, dryRun = {}, impactReport = {}) {
  const rowsWouldBeExcluded  = dryRun.rows_would_be_excluded ?? 0
  const deltaHitRate         = impactReport.delta_hit_rate_simulated ?? 0
  const isEmpty              = (dryRun.status === 'empty' || dryRun.rows_evaluated === 0)

  return {
    status: isEmpty ? 'empty' : 'simulated',
    headline: 'Dry-run de exclusão executado sem alteração real.',
    summary_text: 'Segmentos fracos foram simulados como excluídos, mas nenhuma regra real foi aplicada.',
    rows_would_be_excluded: rowsWouldBeExcluded,
    delta_hit_rate_simulated: deltaHitRate,
    auto_apply_exclusions: false,
    real_filter_changed: false,
    safe_to_beta: false,
    safe_to_sell: false,
  }
}

// ── evaluateSegmentExclusionDryRun  (main export) ────────────────────────────

export function evaluateSegmentExclusionDryRun(rawInput = {}, options = {}) {
  const { sanitized, violations } = sanitizeInput(rawInput)

  const segment_exclusion_dry_run          = buildSegmentExclusionDryRun(sanitized, violations)
  const dry_run_excluded_segments          = buildDryRunExcludedSegments(sanitized)
  const segment_exclusion_impact_report    = buildSegmentExclusionImpactReport(sanitized)
  const segment_exclusion_dry_run_summary  = buildSegmentExclusionDryRunSummary(
    sanitized,
    segment_exclusion_dry_run,
    segment_exclusion_impact_report,
  )

  return {
    segment_exclusion_dry_run,
    dry_run_excluded_segments,
    segment_exclusion_impact_report,
    segment_exclusion_dry_run_summary,
  }
}
