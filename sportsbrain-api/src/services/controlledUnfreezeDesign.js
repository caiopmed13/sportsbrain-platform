// src/services/controlledUnfreezeDesign.js
// P3.8.24 — Controlled Unfreeze Design, Preconditions Matrix & Risk Assessment

export const DESIGN_VERSION = 'p3.8.24'

export const CAPABILITIES_UNDER_DESIGN = [
  'internal_download',
  'internal_storage',
  'manual_review_unlock',
  'private_beta_invite_simulation',
]

export const CAPABILITIES_NOT_ELIGIBLE = [
  'sell',
  'public_beta',
  'real_delivery',
  'checkout',
  'pricing',
  'public_export',
  'webhook',
  'email_delivery',
]

export const UNFREEZE_RISKS = [
  'premature_beta_release',
  'premature_sell_release',
  'download_public_exposure',
  'storage_persistence_without_policy',
  'real_delivery_exposure',
  'claims_compliance_risk',
  'admin_access_abuse',
  'insufficient_micro_test_sample',
]

// ── Controlled Unfreeze Design ────────────────────────────────────────────────

export function buildControlledUnfreezeDesign(input = {}, options = {}) {
  const safeInput = input ?? {}

  const unsafeUnfreezeEnabled      = safeInput.unfreeze_enabled === true
  const unsafeControlledActive     = safeInput.controlled_unfreeze_active === true
  const unsafeInputDetected        = unsafeUnfreezeEnabled || unsafeControlledActive

  const result = {
    status:                    'designed',
    design_version:            DESIGN_VERSION,
    simulation_only:           true,
    unfreeze_enabled:          false,   // ALWAYS false
    controlled_unfreeze_active: false,  // ALWAYS false
    can_unfreeze_now:          false,   // ALWAYS false
    requires_future_phase:     true,
    required_future_phase:     'P3.8.25+',
    capabilities_under_design: CAPABILITIES_UNDER_DESIGN,
    capabilities_not_eligible: CAPABILITIES_NOT_ELIGIBLE,
  }

  if (unsafeInputDetected) {
    result.unsafe_input_sanitized = true
    result.blockers = ['unfreeze_requested_but_blocked']
  }

  return result
}

// ── Preconditions Matrix ──────────────────────────────────────────────────────

export function buildUnfreezePreconditionsMatrix(input = {}, options = {}) {
  const safeInput = input ?? {}

  const preconditions = [
    {
      code:     'micro_test_active',
      met:      safeInput.micro_test_active === true,
      required: true,
    },
    {
      code:     'minimum_decision_sample_met',
      met:      (safeInput.resolved_valid ?? 0) >= 30,
      required: true,
    },
    {
      code:     'quality_policy_passed',
      met:      safeInput.micro_test_policy?.passed !== false,
      required: true,
    },
    {
      code:     'candidate_segments_available',
      met:      Array.isArray(safeInput.candidate_segments) && safeInput.candidate_segments.length > 0,
      required: true,
    },
    {
      code:     'sandbox_completed',
      met:      safeInput.private_beta_sandbox?.status === 'ready',
      required: true,
    },
    {
      code:     'operator_review_ready',
      met:      safeInput.operator_review_console != null,
      required: true,
    },
    {
      code:     'manual_review_artifact_ready',
      met:      safeInput.manual_review_artifact != null,
      required: true,
    },
    {
      code:     'approval_simulation_reviewed',
      met:      safeInput.approval_simulation != null,
      required: true,
    },
    {
      code:     'governance_regression_passed',
      met:      safeInput.governance_regression_suite?.passed !== false,
      required: true,
    },
    {
      code:     'redaction_regression_passed',
      met:      safeInput.redaction_regression_lock?.passed !== false,
      required: true,
    },
    {
      code:     'release_freeze_sentinel_passed',
      met:      safeInput.release_freeze_sentinel?.passed !== false,
      required: true,
    },
    {
      code:     'admin_access_protected',
      met:      safeInput.admin_access_audit?.authorized !== false,
      required: true,
    },
    {
      code:     'no_sell_enforcement_active',
      met:      safeInput.immutable_no_sell_enforcement?.status !== 'critical_violation',
      required: true,
    },
    {
      code:     'explicit_future_phase_approval',
      met:      false,  // ALWAYS false — never met in this phase
      required: true,
    },
  ]

  const metCount    = preconditions.filter(p => p.met).length
  const failedCount = preconditions.filter(p => !p.met).length

  return {
    status:             'defined',
    all_met:            false,  // ALWAYS false because explicit_future_phase_approval is always unmet
    preconditions_count: preconditions.length,
    met_count:          metCount,
    failed_count:       failedCount,
    preconditions,
  }
}

// ── Risk Assessment ───────────────────────────────────────────────────────────

export function buildUnfreezeRiskAssessment(input = {}, options = {}) {
  return {
    status:       'high_risk_hold',
    overall_risk: 'high',
    risks: [
      { code: 'premature_beta_release',             level: 'high',    mitigated: false },
      { code: 'premature_sell_release',             level: 'critical', mitigated: false },
      { code: 'download_public_exposure',           level: 'high',    mitigated: false },
      { code: 'storage_persistence_without_policy', level: 'medium',  mitigated: false },
      { code: 'real_delivery_exposure',             level: 'high',    mitigated: false },
      { code: 'claims_compliance_risk',             level: 'high',    mitigated: false },
      { code: 'admin_access_abuse',                 level: 'medium',  mitigated: false },
      { code: 'insufficient_micro_test_sample',     level: 'medium',  mitigated: false },
    ],
    blockers:        ['unfreeze_not_approved_for_this_phase'],
    warnings:        [],
    safe_to_unfreeze: false,
  }
}

// ── Simulation Guard ──────────────────────────────────────────────────────────

export function buildUnfreezeSimulationGuard(input = {}, options = {}) {
  return {
    status:                     'locked',
    simulation_only:            true,
    unfreeze_simulation_allowed: true,
    real_unfreeze_allowed:       false,
    can_enable_beta:             false,
    can_enable_sell:             false,
    can_enable_download:         false,
    can_enable_storage:          false,
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function buildControlledUnfreezeSummary(input = {}, options = {}) {
  return {
    status:                    'design_only',
    headline:                  'Unfreeze controlado apenas desenhado, não ativo.',
    summary_text:              'Nenhuma capacidade congelada foi liberada nesta fase.',
    safe_to_unfreeze:          false,
    safe_to_sell:              false,
    safe_to_invite_private_users: false,
    next_action:               'Manter baseline congelado e revisar pré-condições em fase futura.',
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateControlledUnfreezeDesign(input = {}, options = {}) {
  const safeInput = input ?? {}

  const controlled_unfreeze_design    = buildControlledUnfreezeDesign(safeInput, options)
  const unfreeze_preconditions_matrix = buildUnfreezePreconditionsMatrix(safeInput, options)
  const unfreeze_risk_assessment      = buildUnfreezeRiskAssessment(safeInput, options)
  const unfreeze_simulation_guard     = buildUnfreezeSimulationGuard(safeInput, options)
  const controlled_unfreeze_summary   = buildControlledUnfreezeSummary(safeInput, options)

  return {
    controlled_unfreeze_design,
    unfreeze_preconditions_matrix,
    unfreeze_risk_assessment,
    unfreeze_simulation_guard,
    controlled_unfreeze_summary,
  }
}
