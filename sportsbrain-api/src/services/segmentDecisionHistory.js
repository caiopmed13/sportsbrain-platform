// segmentDecisionHistory.js
// Pure functions — no DB access, no side effects

const UNSAFE_FIELDS = ['can_beta', 'can_sell', 'delivery_allowed', 'real_delivery', 'auto_apply_exclusions']

function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = { ...raw }
  for (const field of UNSAFE_FIELDS) {
    delete out[field]
  }
  return out
}

function syntheticPreviousRounds(currentRec) {
  switch (currentRec) {
    case 'recommend_exclude':
      return ['continue_collecting', 'watch']
    case 'watch':
      return ['continue_collecting', 'continue_collecting']
    case 'candidate_keep':
      return ['watch', 'watch']
    case 'continue_collecting':
      return ['continue_collecting', 'continue_collecting']
    case 'insufficient_sample':
      return ['insufficient_sample', 'insufficient_sample']
    default:
      return ['continue_collecting', 'continue_collecting']
  }
}

function recommendationSeverity(rec) {
  const map = {
    candidate_keep: 0,
    continue_collecting: 1,
    insufficient_sample: 2,
    watch: 3,
    recommend_exclude: 4,
  }
  return map[rec] ?? 2
}

function classifyTrend(r1, r2, current) {
  const s1 = recommendationSeverity(r1)
  const sCurrent = recommendationSeverity(current)

  if (r1 === r2 && r2 === current) return 'stable'
  if (sCurrent < s1) return 'improving'
  if (sCurrent > s1) return 'declining'
  return 'volatile'
}

export function buildSyntheticSegmentDecisionHistory(input, options = {}) {
  const recommendations = input.segment_exclusion_recommendations?.recommendations ?? []

  return recommendations.map(seg => {
    const [r1, r2] = syntheticPreviousRounds(seg.recommendation)
    const history = [
      { round: 'round_1', recommendation: r1, simulated: true },
      { round: 'round_2', recommendation: r2, simulated: true },
      { round: 'current', recommendation: seg.recommendation, simulated: false },
    ]
    const stable = r1 === r2 && r2 === seg.recommendation
    const trend = classifyTrend(r1, r2, seg.recommendation)

    return {
      segment_type: seg.segment_type,
      segment_key: seg.segment_key,
      history,
      current_recommendation: seg.recommendation,
      stable,
      trend,
      requires_more_runs: true,
    }
  })
}

export function buildSegmentDecisionHistoryMatrix(input, options = {}) {
  const segments = buildSyntheticSegmentDecisionHistory(input, options)

  return {
    status: segments.length > 0 ? 'available' : 'empty',
    segments_count: segments.length,
    segments,
  }
}

export function buildSegmentDecisionHistorySimulation(input, matrixResult, options = {}) {
  const segments = matrixResult.segments ?? []
  const stable_segments_count = segments.filter(s => s.stable).length
  const unstable_segments_count = segments.filter(s => !s.stable).length
  const improving_segments_count = segments.filter(s => s.trend === 'improving').length
  const declining_segments_count = segments.filter(s => s.trend === 'declining').length

  return {
    status: segments.length > 0 ? 'simulated' : 'empty',
    history_version: 'p3.9.5',
    simulation_only: true,
    history_persistence_enabled: false,
    segments_tracked: segments.length,
    stable_segments_count,
    unstable_segments_count,
    improving_segments_count,
    declining_segments_count,
    requires_more_runs: true,
    can_beta: false,
    can_sell: false,
  }
}

export function buildSegmentDecisionHistorySummary(input, matrixResult, options = {}) {
  const segments = matrixResult.segments ?? []
  const stable_segments_count = segments.filter(s => s.stable).length
  const unstable_segments_count = segments.filter(s => !s.stable).length

  return {
    status: 'simulated',
    headline: 'Histórico de decisões por segmento simulado.',
    summary_text: 'O histórico ainda é sintético e exige múltiplas rodadas reais antes de mudanças no motor.',
    stable_segments_count,
    unstable_segments_count,
    requires_more_runs: true,
    safe_to_beta: false,
    safe_to_sell: false,
  }
}

export function evaluateSegmentDecisionHistory(rawInput = {}, options = {}) {
  const input = sanitizeInput(rawInput)

  const segment_decision_history_matrix = buildSegmentDecisionHistoryMatrix(input, options)
  const segment_decision_history_simulation = buildSegmentDecisionHistorySimulation(input, segment_decision_history_matrix, options)
  const segment_decision_history_summary = buildSegmentDecisionHistorySummary(input, segment_decision_history_matrix, options)

  return {
    segment_decision_history_simulation,
    segment_decision_history_matrix,
    segment_decision_history_summary,
  }
}
