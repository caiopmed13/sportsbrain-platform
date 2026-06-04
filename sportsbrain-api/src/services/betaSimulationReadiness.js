// betaSimulationReadiness.js
// Pure functions — no DB access, no imports from other project files.

const UNSAFE_FIELDS = [
  'can_beta', 'can_sell', 'ready_for_real_beta',
  'beta_simulation_allows_real_users', 'beta_simulation_allows_delivery',
  'delivery_allowed', 'real_delivery', 'auto_apply_exclusions'
]

function sanitizeInput(rawInput) {
  const input = { ...rawInput }
  for (const field of UNSAFE_FIELDS) {
    delete input[field]
  }
  return input
}

function computeReviewScore(input) {
  let score = 0

  // Gate score contribution (max 50 points)
  const gateScore = input.quality_proof_decision_gate?.gate_score ?? 0
  score += Math.min(50, (gateScore / 100) * 50)

  // Stability contribution (max 15 points)
  const stabilityLevel = input.recommendation_stability_check?.stability_level ?? 'not_available'
  if (stabilityLevel === 'stable') score += 15
  else if (stabilityLevel === 'mixed') score += 8
  else score += 0

  // Shadow policy contribution (max 15 points)
  const policyStatus = input.shadow_policy_enforcement?.status ?? ''
  if (policyStatus === 'enforced') score += 15

  // Trend contribution (max 10 points)
  const trendDirection = input.quality_proof_trend_monitor?.trend_direction ?? ''
  if (trendDirection === 'up') score += 10
  else if (trendDirection === 'flat') score += 5

  // History stability contribution (max 10 points)
  const stableSegments = input.segment_decision_history_simulation?.stable_segments_count ?? 0
  if (stableSegments > 0) score += 10

  return Math.min(100, Math.max(0, Math.round(score)))
}

function computeReviewGrade(score) {
  if (score >= 75) return 'ready_for_beta_simulation_review'
  if (score >= 60) return 'watch'
  if (score >= 40) return 'early_watch'
  return 'insufficient'
}

export function buildBetaSimulationBlockerMatrix(input, violations, options = {}) {
  const permanentBlockers = [
    { code: 'real_beta_not_allowed', scope: 'real_beta', active: true, severity: 'critical', description: 'Beta real não é permitido nesta fase.' },
    { code: 'sell_not_allowed', scope: 'real_beta', active: true, severity: 'critical', description: 'Venda não é permitida nesta fase.' },
    { code: 'real_users_not_allowed', scope: 'real_beta', active: true, severity: 'critical', description: 'Usuários reais não são permitidos nesta fase.' },
    { code: 'real_delivery_not_allowed', scope: 'real_beta', active: true, severity: 'critical', description: 'Entrega real não é permitida nesta fase.' },
    { code: 'public_beta_not_allowed', scope: 'real_beta', active: true, severity: 'critical', description: 'Beta público não é permitido nesta fase.' },
  ]

  const resolvedValidCount = input.first_real_quality_snapshot?.resolved_valid_count ?? 0
  const gateScore = input.quality_proof_decision_gate?.gate_score ?? 0
  const activationStatus = input.micro_test_activation_readiness?.activation_status
  const canAdvanceQualityProof = input.quality_proof_decision_gate?.can_advance_quality_proof
  const stabilityLevel = input.recommendation_stability_check?.stability_level
  const requiresMoreRuns = input.recommendation_stability_check?.requires_more_runs
  const trendRequiresMoreRuns = input.quality_proof_trend_monitor?.requires_more_real_runs
  const policyStatus = input.shadow_policy_enforcement?.status

  const conditionalBlockers = [
    {
      code: 'resolved_sample_too_small',
      scope: 'beta_simulation',
      active: resolvedValidCount < 10 || gateScore < 30,
      severity: 'critical',
      description: 'Amostra resolvida muito pequena para beta simulation.',
    },
    {
      code: 'micro_test_not_active',
      scope: 'beta_simulation',
      active: !activationStatus || activationStatus !== 'active',
      severity: 'critical',
      description: 'Micro-teste não está ativo.',
    },
    {
      code: 'quality_gate_not_ready',
      scope: 'beta_simulation',
      active: !(canAdvanceQualityProof === true),
      severity: 'critical',
      description: 'Quality gate não está pronto para avançar.',
    },
    {
      code: 'recommendations_unstable',
      scope: 'beta_simulation',
      active: stabilityLevel === 'unstable' || requiresMoreRuns === true,
      severity: 'critical',
      description: 'Recomendações instáveis ou requerem mais runs.',
    },
    {
      code: 'trend_requires_more_runs',
      scope: 'beta_simulation',
      active: trendRequiresMoreRuns === true,
      severity: 'critical',
      description: 'Tendência requer mais runs reais.',
    },
    {
      code: 'shadow_policy_failed',
      scope: 'beta_simulation',
      active: policyStatus !== 'enforced',
      severity: 'critical',
      description: 'Shadow policy não está sendo aplicada.',
    },
  ]

  const allBlockers = [...permanentBlockers, ...conditionalBlockers]

  return {
    status: 'active',
    blockers_count: allBlockers.length,
    critical_blockers_count: 5,
    blockers: allBlockers,
  }
}

export function buildBetaSimulationReadinessReview(input, blockerMatrix, reviewScore, violations, options = {}) {
  const reviewGrade = computeReviewGrade(reviewScore)
  const ready_for_beta_simulation = reviewGrade === 'ready_for_beta_simulation_review'

  let status = 'reviewed'
  if (violations.length > 0) status = 'critical_violation'
  else if (reviewGrade === 'insufficient') status = 'not_ready'

  return {
    status,
    review_version: 'p3.9.5',
    simulation_only: true,
    ready_for_beta_simulation,
    ready_for_real_beta: false,
    beta_simulation_allows_real_users: false,
    beta_simulation_allows_delivery: false,
    requires_operator_review: true,
    review_score: reviewScore,
    review_grade: reviewGrade,
    violations: violations.length > 0 ? violations : [],
    can_beta: false,
    can_sell: false,
  }
}

export function buildBetaSimulationReadinessEvidence(input, options = {}) {
  const items = [
    { code: 'quality_gate_decision', value: input.quality_proof_decision_gate?.decision ?? 'collect_more_data', status: 'collected' },
    { code: 'quality_trend_direction', value: input.quality_proof_trend_monitor?.trend_direction ?? 'flat', status: 'collected' },
    { code: 'recommendation_stability_level', value: input.recommendation_stability_check?.stability_level ?? 'not_available', status: 'collected' },
    { code: 'segment_history_requires_more_runs', value: true, status: 'collected' },
    { code: 'shadow_policy_enforced', value: input.shadow_policy_enforcement?.status === 'enforced', status: 'collected' },
    { code: 'micro_test_activation_status', value: input.micro_test_activation_readiness?.activation_status ?? 'not_active', status: 'collected' },
    { code: 'first_snapshot_status', value: input.first_real_quality_snapshot?.snapshot_quality_level ?? 'not_available', status: 'collected' },
    { code: 'no_beta_no_sell', value: true, status: 'enforced' },
  ]

  return {
    status: 'collected',
    evidence_items_count: items.length,
    evidence_items: items,
  }
}

export function buildP39BetaSimulationSummary(input, readinessReview, options = {}) {
  const ready = readinessReview.ready_for_beta_simulation

  let status = 'collect_more_data'
  if (ready) status = 'ready_for_beta_simulation_review'
  else if (readinessReview.review_grade === 'early_watch' || readinessReview.review_grade === 'watch') status = 'review_required'

  return {
    status,
    headline: ready ? 'Beta simulation pode estar pronto para revisão.' : 'Beta simulation ainda não está pronto.',
    summary_text: ready
      ? 'Condições shadow suficientes para revisão. Sem usuários reais ou entrega real.'
      : 'A quality proof precisa de mais dados reais e estabilidade antes de beta simulation.',
    ready_for_beta_simulation: ready,
    ready_for_real_beta: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
    next_action: ready
      ? 'Revisar evidências e blockers antes de avançar.'
      : 'Continuar acumulando resultados e monitorar tendências.',
  }
}

export function evaluateBetaSimulationReadiness(rawInput = {}, options = {}) {
  const violations = []
  const UNSAFE_BOOLEANS = ['can_beta', 'can_sell', 'ready_for_real_beta', 'beta_simulation_allows_real_users', 'beta_simulation_allows_delivery', 'delivery_allowed', 'real_delivery']
  for (const field of UNSAFE_BOOLEANS) {
    if (rawInput[field] === true) violations.push({ field, value: true, rejected: false })
  }

  const input = sanitizeInput(rawInput)
  const reviewScore = computeReviewScore(input)
  const beta_simulation_blocker_matrix = buildBetaSimulationBlockerMatrix(input, violations, options)
  const beta_simulation_readiness_review = buildBetaSimulationReadinessReview(input, beta_simulation_blocker_matrix, reviewScore, violations, options)
  const beta_simulation_readiness_evidence = buildBetaSimulationReadinessEvidence(input, options)
  const p39_beta_simulation_summary = buildP39BetaSimulationSummary(input, beta_simulation_readiness_review, options)

  return {
    beta_simulation_readiness_review,
    beta_simulation_blocker_matrix,
    beta_simulation_readiness_evidence,
    p39_beta_simulation_summary,
  }
}
