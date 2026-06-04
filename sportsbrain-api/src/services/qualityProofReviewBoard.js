/**
 * qualityProofReviewBoard.js
 * P3.9.6 — Quality Proof Review Board (simulation-only, no real beta authority)
 */

const UNSAFE_FIELDS = [
  'can_beta', 'can_sell', 'allows_sell', 'allows_real_users',
  'allows_real_delivery', 'ready_for_real_beta', 'delivery_allowed',
  'real_delivery', 'real_users'
]

function sanitizeInput(rawInput) {
  const safe = Object.assign({}, rawInput)
  for (const field of UNSAFE_FIELDS) {
    if (field in safe) delete safe[field]
  }
  return safe
}

export function buildQualityReviewBoardVotes(input, options = {}) {
  const gateScore  = input.quality_proof_decision_gate?.gate_score ?? 0
  const canAdvance = input.quality_proof_decision_gate?.can_advance_quality_proof === true
  const trendDir   = input.quality_proof_trend_monitor?.trend_direction ?? 'flat'
  const policyOk   = input.shadow_policy_enforcement?.status === 'enforced'
  const simReady   = input.beta_simulation_readiness_review?.ready_for_beta_simulation === true
  const histStable = (input.segment_decision_history_simulation?.stable_segments_count ?? 0) > 0

  const votes = [
    {
      domain: 'sample_size',
      vote: gateScore >= 40 ? 'approve_for_simulation' : 'hold',
      severity: gateScore >= 40 ? 'advisory' : 'blocker',
      reason: gateScore >= 40 ? 'Sample size sufficient for simulation review.' : 'Sample still too small.',
      can_override: false,
    },
    {
      domain: 'quality_gate',
      vote: canAdvance ? 'approve_for_simulation' : 'hold',
      severity: canAdvance ? 'advisory' : 'blocker',
      reason: canAdvance ? 'Quality gate allows advancement.' : 'Quality gate does not allow advancement yet.',
      can_override: false,
    },
    {
      domain: 'trend_monitor',
      vote: trendDir === 'up' ? 'approve_for_simulation' : 'hold',
      severity: 'advisory',
      reason: trendDir === 'up' ? 'Quality trend is improving.' : 'Trend requires more real runs.',
      can_override: false,
    },
    {
      domain: 'segment_stability',
      vote: histStable ? 'approve_for_simulation' : 'hold',
      severity: 'advisory',
      reason: histStable ? 'Some stable segments exist.' : 'Segment history needs more runs.',
      can_override: false,
    },
    {
      domain: 'break_even_review',
      vote: 'hold',
      severity: 'advisory',
      reason: 'Break-even review requires more resolved samples.',
      can_override: false,
    },
    {
      domain: 'shadow_backtest',
      vote: policyOk ? 'approve_for_simulation' : 'hold',
      severity: 'advisory',
      reason: policyOk ? 'Shadow policy enforced.' : 'Shadow policy not yet enforced.',
      can_override: false,
    },
    {
      domain: 'cohort_plan',
      vote: 'approve_for_simulation',
      severity: 'advisory',
      reason: 'Synthetic cohort plan defined.',
      can_override: false,
    },
    {
      domain: 'ux_contract',
      vote: 'approve_for_simulation',
      severity: 'advisory',
      reason: 'Synthetic delivery UX contract defined.',
      can_override: false,
    },
    {
      domain: 'non_delivery',
      vote: 'approve_for_simulation',
      severity: 'advisory',
      reason: 'Non-delivery contract enforced.',
      can_override: false,
    },
    {
      domain: 'commercial_safety',
      vote: 'block_real_beta',
      severity: 'blocker',
      reason: 'Venda e beta real continuam proibidos.',
      can_override: false,
    },
    {
      domain: 'operator_review',
      vote: 'hold',
      severity: 'advisory',
      reason: 'Operator manual review required before advancing.',
      can_override: false,
    },
  ]

  return {
    status: 'generated',
    votes_count: votes.length,
    votes,
  }
}

export function buildQualityProofReviewBoard(input, votes, violations, options = {}) {
  const voteList = votes.votes ?? []
  const approve_for_simulation_count = voteList.filter(v => v.vote === 'approve_for_simulation').length
  const hold_count   = voteList.filter(v => v.vote === 'hold').length
  const block_count  = voteList.filter(v => v.vote === 'block_real_beta' || v.vote === 'block_all').length
  const hasViolations = violations.length > 0

  let status = 'convened'
  let overall_recommendation = 'continue_quality_proof'

  if (hasViolations) {
    status = 'critical_violation'
    overall_recommendation = 'continue_quality_proof'
  } else if (approve_for_simulation_count >= 6) {
    status = 'simulation_review_ready'
    overall_recommendation = 'simulation_review_ready'
  } else {
    status = 'convened'
    overall_recommendation = 'continue_quality_proof'
  }

  return {
    status,
    board_version: 'p3.9.6',
    simulation_only: true,
    real_authority: false,
    votes_count: voteList.length,
    approve_for_simulation_count,
    hold_count,
    block_count,
    overall_recommendation,
    can_approve_real_beta: false,
    can_approve_sell: false,
    violations: hasViolations ? violations : [],
  }
}

export function buildBetaSimulationGovernancePacket(input, votes, options = {}) {
  const voteList = votes.votes ?? []
  const approve_count = voteList.filter(v => v.vote === 'approve_for_simulation').length
  const ready_for_beta_simulation_review = approve_count >= 6

  const evidence = [
    { item: 'quality_gate_decision',  value: input.quality_proof_decision_gate?.decision ?? 'collect_more_data' },
    { item: 'trend_direction',        value: input.quality_proof_trend_monitor?.trend_direction ?? 'flat' },
    { item: 'cohort_plan_defined',    value: true },
    { item: 'ux_contract_defined',    value: true },
    { item: 'no_real_beta_no_sell',   value: true },
  ]

  return {
    status: 'generated',
    packet_version: 'p3.9.6',
    simulation_only: true,
    ready_for_beta_simulation_review,
    ready_for_real_beta: false,
    allows_real_users: false,
    allows_real_delivery: false,
    allows_sell: false,
    evidence_count: evidence.length,
    evidence,
    blockers: [
      { code: 'real_beta_permanently_blocked', active: true, severity: 'critical' },
      { code: 'sell_permanently_blocked',      active: true, severity: 'critical' },
    ],
    warnings: [],
  }
}

export function buildP39BetaSimulationOperatorSummary(input, governancePacket, options = {}) {
  const ready = governancePacket.ready_for_beta_simulation_review

  return {
    status: ready ? 'simulation_review_ready' : 'hold',
    headline: ready
      ? 'Beta simulation pronta para revisão de simulação.'
      : 'Beta simulation planejada, mas ainda em hold.',
    summary_text: ready
      ? 'Condições suficientes para revisão de simulação. Sem beta real, usuários reais ou entrega.'
      : 'A coorte e UX sintética foram definidas; ainda não há permissão para usuários reais, entrega ou venda.',
    ready_for_beta_simulation_review: ready,
    ready_for_real_beta: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
    next_action: ready
      ? 'Revisar board votes e evidências antes de avançar.'
      : 'Continuar quality proof e revisar board votes.',
  }
}

export function evaluateQualityProofReviewBoard(rawInput = {}, options = {}) {
  const violations = []
  for (const field of UNSAFE_FIELDS) {
    if (rawInput[field] === true) violations.push({ field, value: true, rejected: false })
  }
  const input = sanitizeInput(rawInput)
  const quality_review_board_votes           = buildQualityReviewBoardVotes(input, options)
  const quality_proof_review_board           = buildQualityProofReviewBoard(input, quality_review_board_votes, violations, options)
  const beta_simulation_governance_packet    = buildBetaSimulationGovernancePacket(input, quality_review_board_votes, options)
  const p39_beta_simulation_operator_summary = buildP39BetaSimulationOperatorSummary(input, beta_simulation_governance_packet, options)
  return {
    quality_proof_review_board,
    quality_review_board_votes,
    beta_simulation_governance_packet,
    p39_beta_simulation_operator_summary,
  }
}
