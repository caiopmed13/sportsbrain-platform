export const GATE_VERSION = 'p3.8.25'

const GATE_SCORE_WEIGHTS = {
  freeze_integrity:      20,
  safety_invariants:     20,
  micro_test_policy:     15,
  sandbox_monitor:       10,
  admin_export_security: 10,
  manual_review_artifact: 10,
  capability_matrix:     10,
  operator_review:        5,
}

const GRADE_THRESHOLDS = [
  { min: 90,  max: 100, grade: 'strong_hold' },
  { min: 75,  max: 89,  grade: 'future_review_candidate' },
  { min: 60,  max: 74,  grade: 'review_hold' },
  { min: 40,  max: 59,  grade: 'early_hold' },
  { min: 0,   max: 39,  grade: 'blocked' },
]

const REQUIRED_BLOCKERS = [
  { code: 'real_beta_still_forbidden',          category: 'beta',        severity: 'blocker', description: 'Beta real permanece proibido.',                    required_to_clear: 'Future explicit beta phase.' },
  { code: 'sell_still_forbidden',               category: 'commercial',  severity: 'blocker', description: 'Venda permanece proibida.',                       required_to_clear: 'Future explicit commercial phase.' },
  { code: 'explicit_future_phase_missing',      category: 'governance',  severity: 'blocker', description: 'Aprovação de fase futura não obtida.',            required_to_clear: 'Explicit approval in future phase.' },
  { code: 'unfreeze_not_allowed',               category: 'governance',  severity: 'blocker', description: 'Unfreeze não autorizado nesta fase.',             required_to_clear: 'Future explicit unfreeze phase.' },
  { code: 'private_beta_real_blocked',          category: 'beta',        severity: 'blocker', description: 'Private beta real bloqueado.',                    required_to_clear: 'Future explicit private beta phase.' },
  { code: 'public_beta_blocked',                category: 'beta',        severity: 'blocker', description: 'Public beta bloqueado.',                          required_to_clear: 'Future explicit public beta phase.' },
  { code: 'real_delivery_blocked',              category: 'delivery',    severity: 'blocker', description: 'Entrega real bloqueada.',                         required_to_clear: 'Future explicit delivery phase.' },
  { code: 'checkout_blocked',                   category: 'commercial',  severity: 'blocker', description: 'Checkout bloqueado.',                             required_to_clear: 'Future explicit checkout phase.' },
  { code: 'pricing_blocked',                    category: 'commercial',  severity: 'blocker', description: 'Pricing bloqueado.',                              required_to_clear: 'Future explicit pricing phase.' },
  { code: 'download_real_blocked',              category: 'export',      severity: 'blocker', description: 'Download real bloqueado.',                        required_to_clear: 'Future explicit download phase.' },
  { code: 'storage_real_blocked',               category: 'storage',     severity: 'blocker', description: 'Storage real bloqueado.',                         required_to_clear: 'Future explicit storage phase.' },
  { code: 'manual_operator_approval_not_final', category: 'governance',  severity: 'blocker', description: 'Aprovação manual do operador não finalizada.',    required_to_clear: 'Formal operator sign-off.' },
]

const REVIEW_ITEMS = [
  { item_id: 'review_micro_test_sample',   status: 'pending' },
  { item_id: 'review_candidate_segments', status: 'pending' },
  { item_id: 'review_sandbox_ledger',     status: 'pending' },
  { item_id: 'review_freeze_baseline',    status: 'pending' },
  { item_id: 'review_capability_matrix',  status: 'pending' },
  { item_id: 'review_unfreeze_risks',     status: 'pending' },
  { item_id: 'confirm_no_sell',           status: 'confirmed' },
  { item_id: 'confirm_no_real_users',     status: 'confirmed' },
]

function computeGateScore(input) {
  let score = 0
  if (input.release_freeze_sentinel?.passed !== false) score += 20
  if (input.safety_invariant_snapshot?.all_passed !== false) score += 20
  if (input.micro_test_policy?.passed !== false) score += 15
  if (input.simulated_cohort_monitor != null) score += 10
  if (input.admin_access_audit?.authorized === true) score += 10
  if (input.manual_review_artifact != null) score += 10
  if (input.capability_unlock_matrix?.status === 'evaluated') score += 10
  if (input.controlled_unfreeze_simulation?.status === 'simulated') score += 5
  return score
}

function computeGrade(score) {
  for (const threshold of GRADE_THRESHOLDS) {
    if (score >= threshold.min && score <= threshold.max) return threshold.grade
  }
  return 'blocked'
}

function gradeToStatus(grade) {
  if (grade === 'blocked' || grade === 'early_hold') return 'blocked'
  if (grade === 'review_hold') return 'review_hold'
  return 'future_review_candidate'
}

export function buildPreBetaBlockerMatrix(input = {}, options = {}) {
  const blockers = REQUIRED_BLOCKERS.map(b => ({ ...b, active: true }))

  if (input.private_beta_enabled === true) {
    blockers.push({
      code: 'private_beta_unsafe_input_detected',
      category: 'beta',
      severity: 'blocker',
      description: 'private_beta_enabled=true detectado na entrada — unsafe input.',
      required_to_clear: 'Remove private_beta_enabled flag.',
      active: true,
    })
  }

  return {
    status: 'blocked',
    blockers_count: blockers.length,
    critical_blockers_count: blockers.length,
    blockers,
  }
}

export function buildPreBetaGovernanceGate(input = {}, options = {}) {
  const score = computeGateScore(input)
  const grade = computeGrade(score)
  const status = gradeToStatus(grade)
  const blockerMatrix = buildPreBetaBlockerMatrix(input, options)

  return {
    status,
    gate_version: GATE_VERSION,
    simulation_only: true,
    can_enter_private_beta: false,
    can_enter_public_beta: false,
    can_sell: false,
    can_unlock_capabilities: false,
    gate_score: score,
    gate_grade: grade,
    blockers: blockerMatrix.blockers,
    warnings: [],
    required_next_phase: 'P3.8.26+',
  }
}

export function buildPreBetaOperatorReview(input = {}, options = {}) {
  return {
    status: 'ready_for_internal_review',
    review_type: 'pre_beta_governance',
    operator_can_review: true,
    operator_can_approve_beta_now: false,
    operator_can_approve_sell_now: false,
    review_items_count: REVIEW_ITEMS.length,
    review_items: REVIEW_ITEMS.map(r => ({ ...r })),
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function buildFinalPreBetaSummary(input = {}, options = {}) {
  return {
    status: 'blocked',
    headline: 'Gate pré-beta permanece bloqueado.',
    summary_text: 'O sistema possui simulação de unlock e matriz de capacidades, mas nenhuma capacidade foi destravada.',
    next_action: 'Preparar próxima fase de governança sem liberar beta real.',
    can_enter_private_beta: false,
    can_enter_public_beta: false,
    can_sell: false,
    can_unlock_any_now: false,
  }
}

export function evaluatePreBetaGovernanceGate(input = {}, options = {}) {
  return {
    pre_beta_governance_gate:  buildPreBetaGovernanceGate(input, options),
    pre_beta_blocker_matrix:   buildPreBetaBlockerMatrix(input, options),
    pre_beta_operator_review:  buildPreBetaOperatorReview(input, options),
    final_pre_beta_summary:    buildFinalPreBetaSummary(input, options),
  }
}
