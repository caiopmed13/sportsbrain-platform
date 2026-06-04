// betaSimulationCohortPlan.js
// Pure functions — no imports from other project files.

const UNSAFE_FIELDS = [
  'can_beta', 'can_sell', 'real_users_allowed', 'real_users',
  'delivery_allowed', 'real_delivery', 'email_delivery_enabled',
  'webhook_enabled', 'checkout_enabled', 'pricing_enabled'
]

export function normalizeCohortPlanBoolean(value) {
  return false
}

function sanitizeInput(input = {}) {
  const clean = Object.assign({}, input)
  for (const field of UNSAFE_FIELDS) delete clean[field]
  return clean
}

export function buildSyntheticBetaCohortMembers(input, options = {}) {
  const members = [
    { member_id: 'sim-beta-001', profile_type: 'low_risk_viewer',         synthetic: true, real_user: false, email: null, user_id: null, delivery_target: null, allowed_to_receive_real_picks: false, allowed_channels: [], notes: 'Synthetic beta simulation member only.' },
    { member_id: 'sim-beta-002', profile_type: 'high_confidence_reviewer', synthetic: true, real_user: false, email: null, user_id: null, delivery_target: null, allowed_to_receive_real_picks: false, allowed_channels: [], notes: 'Synthetic beta simulation member only.' },
    { member_id: 'sim-beta-003', profile_type: 'football_focused',         synthetic: true, real_user: false, email: null, user_id: null, delivery_target: null, allowed_to_receive_real_picks: false, allowed_channels: [], notes: 'Synthetic beta simulation member only.' },
    { member_id: 'sim-beta-004', profile_type: 'basketball_focused',       synthetic: true, real_user: false, email: null, user_id: null, delivery_target: null, allowed_to_receive_real_picks: false, allowed_channels: [], notes: 'Synthetic beta simulation member only.' },
    { member_id: 'sim-beta-005', profile_type: 'quality_auditor',          synthetic: true, real_user: false, email: null, user_id: null, delivery_target: null, allowed_to_receive_real_picks: false, allowed_channels: [], notes: 'Synthetic beta simulation member only.' },
  ]
  return {
    status: 'generated',
    simulation_only: true,
    members_count: members.length,
    members,
  }
}

export function buildBetaSimulationCohortPlan(input, violations, options = {}) {
  const hasViolations = violations.length > 0
  return {
    status: hasViolations ? 'critical_violation' : 'planned',
    plan_version: 'p3.9.6',
    simulation_only: true,
    cohort_type: 'synthetic_beta_simulation',
    members_planned_count: 5,
    real_users_allowed: false,
    real_emails_allowed: false,
    delivery_allowed: false,
    ready_for_real_beta: false,
    requires_operator_review: true,
    violations: hasViolations ? violations : [],
    can_beta: false,
    can_sell: false,
  }
}

export function buildBetaCohortRiskReview(input, options = {}) {
  const risks = [
    { risk: 'real_user_leakage',                        severity: 'high',   description: 'Synthetic members must not be confused with real users.' },
    { risk: 'email_delivery_leakage',                   severity: 'high',   description: 'No email delivery allowed in simulation mode.' },
    { risk: 'synthetic_member_confused_with_real_user', severity: 'medium', description: 'Operators must clearly distinguish synthetic from real.' },
    { risk: 'operator_misinterprets_simulation_as_beta', severity: 'medium', description: 'Beta simulation is not real beta.' },
    { risk: 'quality_not_proven_enough',                severity: 'medium', description: 'Quality proof still requires more real data.' },
    { risk: 'sample_still_small',                       severity: 'low',    description: 'Sample size is not yet sufficient for confident decisions.' },
  ]
  return {
    status: 'evaluated',
    risk_level: 'low_for_simulation_high_for_real',
    risks_count: risks.length,
    risks,
    blockers: [],
    warnings: [],
  }
}

export function buildBetaSimulationCohortSummary(input, cohortPlan, options = {}) {
  return {
    status: 'planned',
    headline: 'Coorte de beta simulation planejada sem usuários reais.',
    summary_text: 'A coorte é 100% sintética e não pode receber entrega real.',
    members_count: 5,
    ready_for_simulation_review: false,
    ready_for_real_beta: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function evaluateBetaSimulationCohortPlan(rawInput = {}, options = {}) {
  const violations = []
  for (const field of UNSAFE_FIELDS) {
    if (rawInput[field] === true) violations.push({ field, value: true, rejected: false })
  }
  const input = sanitizeInput(rawInput)
  const synthetic_beta_cohort_members  = buildSyntheticBetaCohortMembers(input, options)
  const beta_simulation_cohort_plan    = buildBetaSimulationCohortPlan(input, violations, options)
  const beta_cohort_risk_review        = buildBetaCohortRiskReview(input, options)
  const beta_simulation_cohort_summary = buildBetaSimulationCohortSummary(input, beta_simulation_cohort_plan, options)
  return {
    beta_simulation_cohort_plan,
    synthetic_beta_cohort_members,
    beta_cohort_risk_review,
    beta_simulation_cohort_summary,
  }
}
