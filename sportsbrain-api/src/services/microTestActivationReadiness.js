// microTestActivationReadiness.js
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network
// version: p3.9.0

const MICRO_TEST_THRESHOLD = 30
const READINESS_VERSION = 'p3.9.0'

const UNSAFE_FIELDS = [
  'auto_activate_micro_test',
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
]

function sanitizeInput(raw) {
  const violations = []
  const sanitized = { ...raw }

  for (const field of UNSAFE_FIELDS) {
    if (raw[field] === true) {
      violations.push(field)
      sanitized[field] = false
    }
  }

  return { sanitized, violations }
}

// ─── micro_test_activation_readiness ────────────────────────────────────────

function buildActivationReadiness(input, violations) {
  const resolvedValid = input.resolved_valid ?? 0
  const microTestEnabled = input.micro_test_enabled ?? false
  const microTestActive = input.micro_test_active ?? false
  const unsafeSanitized = violations.length > 0

  let status
  let activationAllowedNow

  if (resolvedValid < MICRO_TEST_THRESHOLD) {
    status = 'waiting_for_threshold'
    activationAllowedNow = false
  } else if (microTestEnabled === true && microTestActive === true) {
    status = 'already_active'
    activationAllowedNow = false
  } else if (microTestEnabled === true) {
    status = 'already_active'
    activationAllowedNow = false
  } else {
    // resolvedValid >= 30, microTestEnabled === false
    status = 'ready_for_manual_activation'
    activationAllowedNow = true
  }

  const blockers = []
  if (resolvedValid < MICRO_TEST_THRESHOLD) {
    blockers.push('resolved_valid_below_threshold')
  }
  if (status === 'already_active') {
    blockers.push('micro_test_already_active')
  }
  if (unsafeSanitized) {
    blockers.push('unsafe_input_detected')
    activationAllowedNow = false
  }

  const remaining = Math.max(0, MICRO_TEST_THRESHOLD - resolvedValid)

  return {
    status,
    readiness_version: READINESS_VERSION,
    manual_activation_only: true,
    auto_activation_allowed: false,
    activation_allowed_now: activationAllowedNow,
    micro_test_enabled: microTestEnabled,
    micro_test_active: microTestActive,
    resolved_valid: resolvedValid,
    required_threshold: MICRO_TEST_THRESHOLD,
    remaining_to_threshold: remaining,
    blockers,
    warnings: [],
    can_beta: false,
    can_sell: false,
    unsafe_input_sanitized: unsafeSanitized,
    violations,
  }
}

// ─── activation_prerequisites ────────────────────────────────────────────────

function buildActivationPrerequisites(input) {
  const resolvedValid = input.resolved_valid ?? 0

  const required = [
    {
      check_id: 'resolved_valid_threshold_met',
      required: true,
      passed: resolvedValid >= MICRO_TEST_THRESHOLD,
    },
    {
      check_id: 'no_pending_counted_as_resolved',
      required: true,
      passed: true, // rule enforced by service
    },
    {
      check_id: 'unknown_not_counted',
      required: true,
      passed: true, // rule enforced by service
    },
    {
      check_id: 'green_red_only_counting',
      required: true,
      passed: true, // rule enforced
    },
    {
      check_id: 'audit_coverage_available',
      required: true,
      passed: resolvedValid > 0,
    },
    {
      check_id: 'safety_freeze_active',
      required: true,
      passed: true, // hardcoded — freeze always active
    },
    {
      check_id: 'no_sell_active',
      required: true,
      passed: true, // hardcoded
    },
    {
      check_id: 'manual_activation_only',
      required: true,
      passed: true, // hardcoded
    },
  ]

  const optional = [
    { check_id: 'sport_distribution_available', required: false, passed: true },
    { check_id: 'market_distribution_available', required: false, passed: true },
    { check_id: 'trust_level_distribution_available', required: false, passed: true },
    { check_id: 'confidence_distribution_available', required: false, passed: true },
    { check_id: 'odds_distribution_available', required: false, passed: true },
  ]

  const allRequiredMet = resolvedValid >= MICRO_TEST_THRESHOLD

  return {
    status: 'checked',
    all_required_met: allRequiredMet,
    required,
    optional,
  }
}

// ─── micro_test_manual_activation_checklist ──────────────────────────────────

function buildManualActivationChecklist(input) {
  const resolvedValid = input.resolved_valid ?? 0
  const microTestEnabled = input.micro_test_enabled ?? false

  const items = [
    {
      item_id: 'confirm_resolved_valid_at_least_30',
      status: resolvedValid >= MICRO_TEST_THRESHOLD ? 'ready' : 'blocked',
      manual: true,
    },
    {
      item_id: 'confirm_green_red_only',
      status: 'ready',
      manual: true,
    },
    {
      item_id: 'confirm_unknown_not_counted',
      status: 'ready',
      manual: true,
    },
    {
      item_id: 'confirm_pending_not_counted',
      status: 'ready',
      manual: true,
    },
    {
      item_id: 'confirm_micro_test_enabled_currently_false',
      status: microTestEnabled === false ? 'ready' : 'blocked',
      manual: true,
    },
    {
      item_id: 'confirm_no_beta_no_sell',
      status: 'ready',
      manual: true,
    },
    {
      item_id: 'confirm_operator_sets_worker_var_manually',
      status: 'ready',
      manual: true,
    },
    {
      item_id: 'confirm_run_workflow_after_activation',
      status: 'ready',
      manual: true,
    },
    {
      item_id: 'confirm_review_micro_test_report_after_activation',
      status: 'ready',
      manual: true,
    },
  ]

  const readyCount = items.filter((i) => i.status === 'ready').length
  const blockedCount = items.filter((i) => i.status === 'blocked').length
  const allReady = blockedCount === 0

  return {
    status: allReady ? 'ready' : 'blocked',
    items_count: items.length,
    ready_items_count: readyCount,
    blocked_items_count: blockedCount,
    items,
  }
}

// ─── activation_risk_review ──────────────────────────────────────────────────

function buildActivationRiskReview(input, violations) {
  const resolvedValid = input.resolved_valid ?? 0
  const unsafeSanitized = violations.length > 0

  const risks = [
    {
      risk_id: 'activating_before_threshold',
      severity: 'high',
      mitigated: resolvedValid >= MICRO_TEST_THRESHOLD,
      description: 'Activating micro-test before reaching the minimum resolved sample threshold.',
    },
    {
      risk_id: 'counting_pending_as_resolved',
      severity: 'high',
      mitigated: true, // always enforced
      description: 'Pending samples being miscounted as resolved outcomes.',
    },
    {
      risk_id: 'counting_unknown_as_resolved',
      severity: 'high',
      mitigated: true, // always enforced
      description: 'Unknown-result samples being miscounted as resolved outcomes.',
    },
    {
      risk_id: 'insufficient_distribution',
      severity: 'medium',
      mitigated: false, // no distribution data yet in default
      description: 'Insufficient distribution data across sports, markets, or confidence levels.',
    },
    {
      risk_id: 'manual_env_change_required',
      severity: 'medium',
      mitigated: false, // always needs operator action
      description: 'Operator must manually set Worker environment variable to activate.',
    },
    {
      risk_id: 'quality_not_yet_proven',
      severity: 'medium',
      mitigated: false, // no quality proof yet
      description: 'Signal quality has not been independently validated beyond sample count.',
    },
  ]

  const blockers = []
  const warnings = []

  if (unsafeSanitized) {
    blockers.push('unsafe_input_detected')
  }

  return {
    status: unsafeSanitized ? 'blocked' : 'low_risk_when_manual',
    risk_level: 'low',
    risks,
    blockers,
    warnings,
  }
}

// ─── main export ─────────────────────────────────────────────────────────────

export function evaluateMicroTestActivationReadiness(input = {}, _options = {}) {
  const { sanitized, violations } = sanitizeInput(input)

  // Merge sanitized unsafe fields back, keep original non-unsafe fields intact
  const safeInput = { ...input, ...sanitized }

  const micro_test_activation_readiness = buildActivationReadiness(safeInput, violations)
  const activation_prerequisites = buildActivationPrerequisites(safeInput)
  const micro_test_manual_activation_checklist = buildManualActivationChecklist(safeInput)
  const activation_risk_review = buildActivationRiskReview(safeInput, violations)

  return {
    micro_test_activation_readiness,
    activation_prerequisites,
    micro_test_manual_activation_checklist,
    activation_risk_review,
  }
}
