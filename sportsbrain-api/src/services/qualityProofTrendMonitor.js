/**
 * qualityProofTrendMonitor.js
 * P3.9.5 — Quality proof trend monitoring for shadow bet accumulation phase.
 * Pure functions only. No DB access. No external imports.
 */

const UNSAFE_FIELDS = ['can_beta', 'can_sell', 'delivery_allowed', 'real_delivery', 'auto_apply_exclusions']

function sanitizeInput(rawInput) {
  const input = { ...rawInput }
  for (const field of UNSAFE_FIELDS) {
    delete input[field]
  }
  return input
}

export function buildSyntheticQualityProofHistory(input, options = {}) {
  const gate_score = input.quality_proof_decision_gate?.gate_score

  if (gate_score === null || gate_score === undefined || !gate_score) {
    return []
  }

  const currentScore = gate_score
  const previousScore = options.synthetic_previous_score ?? Math.max(0, currentScore - 4)
  const baselineScore = options.synthetic_baseline_score ?? Math.max(0, previousScore - 4)

  const currentDecision = input.quality_proof_decision_gate?.decision ?? 'collect_more_data'
  const currentQualityLevel = input.quality_proof_decision_gate?.gate_grade ?? 'insufficient'

  return [
    {
      snapshot_id: 'baseline_shadow',
      simulated: true,
      gate_score: baselineScore,
      decision: 'collect_more_data',
      risk_level: 'high',
      quality_level: 'insufficient',
    },
    {
      snapshot_id: 'previous_shadow',
      simulated: true,
      gate_score: previousScore,
      decision: 'collect_more_data',
      risk_level: 'high',
      quality_level: 'insufficient',
    },
    {
      snapshot_id: 'current_shadow',
      simulated: false,
      gate_score: currentScore,
      decision: currentDecision,
      risk_level: currentScore >= 75 ? 'low' : currentScore >= 50 ? 'medium' : 'high',
      quality_level: currentQualityLevel,
    },
  ]
}

export function buildQualityGateTrendReport(input, snapshots, options = {}) {
  const current = snapshots.find(s => s.snapshot_id === 'current_shadow')
  const previous = snapshots.find(s => s.snapshot_id === 'previous_shadow')
  const baseline = snapshots.find(s => s.snapshot_id === 'baseline_shadow')

  const currentScore = current?.gate_score ?? 0
  const previousScore = previous?.gate_score ?? 0
  const baselineScore = baseline?.gate_score ?? 0

  let trend_direction = 'unknown'
  if (snapshots.length === 0) {
    trend_direction = 'flat'
  } else if (currentScore > previousScore) {
    trend_direction = 'up'
  } else if (currentScore < previousScore) {
    trend_direction = 'down'
  } else {
    trend_direction = 'flat'
  }

  const score_history = snapshots.map(s => ({
    snapshot_id: s.snapshot_id,
    score: s.gate_score,
    simulated: s.simulated,
  }))

  return {
    status: 'available',
    current_score: currentScore,
    previous_score: previousScore,
    baseline_score: baselineScore,
    delta_from_previous: currentScore - previousScore,
    delta_from_baseline: currentScore - baselineScore,
    trend_direction,
    score_history,
  }
}

export function buildQualityProofTrendMonitor(input, snapshots, trendReport, violations, options = {}) {
  const hasDat = snapshots.length > 0
  const trendDir = trendReport.trend_direction

  let quality_trend = 'insufficient_data'
  if (hasDat) {
    if (trendDir === 'up') quality_trend = 'improving'
    else if (trendDir === 'down') quality_trend = 'declining'
    else quality_trend = 'flat'
  }

  return {
    status: 'tracking',
    monitor_version: 'p3.9.5',
    simulation_only: true,
    history_persistence_enabled: false,
    snapshots_count: snapshots.length,
    trend_direction: trendDir,
    quality_trend,
    requires_more_real_runs: true,
    violations: violations.length > 0 ? violations : [],
    can_beta: false,
    can_sell: false,
  }
}

export function buildQualityTrendOperatorActions(input, violations, options = {}) {
  const actions = [
    { action: 'continue_collecting_real_results', priority: 'high' },
    { action: 'review_gate_score_trend', priority: 'medium' },
    { action: 'review_segment_stability', priority: 'medium' },
    { action: 'do_not_enable_beta', priority: 'critical' },
    { action: 'do_not_sell', priority: 'critical' },
    { action: 'do_not_apply_reweight', priority: 'high' },
    { action: 'wait_for_more_real_runs', priority: 'high' },
  ]

  return {
    status: 'generated',
    actions_count: actions.length,
    actions,
  }
}

export function evaluateQualityProofTrendMonitor(rawInput = {}, options = {}) {
  const violations = []
  if (rawInput.can_beta === true) violations.push({ field: 'can_beta', value: true, rejected: false })
  if (rawInput.can_sell === true) violations.push({ field: 'can_sell', value: true, rejected: false })

  const input = sanitizeInput(rawInput)

  const snapshots = buildSyntheticQualityProofHistory(input, options)
  const quality_gate_trend_report = buildQualityGateTrendReport(input, snapshots, options)
  const quality_proof_trend_monitor = buildQualityProofTrendMonitor(input, snapshots, quality_gate_trend_report, violations, options)
  const quality_trend_operator_actions = buildQualityTrendOperatorActions(input, violations, options)

  return {
    quality_proof_trend_monitor,
    quality_gate_trend_report,
    quality_trend_operator_actions,
  }
}
