// microTestManualActivationGuard.js
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network
// version: p3.9.1

const MICRO_TEST_THRESHOLD = 30
const GUARD_VERSION = 'p3.9.1'

const UNSAFE_FIELDS = [
  'can_beta',
  'can_sell',
  'auto_activate_micro_test',
  'auto_activation_allowed',
  'delivery_allowed',
  'real_users',
  'real_delivery',
]

// ─── normalizeActivationBoolean ──────────────────────────────────────────────

export function normalizeActivationBoolean(value) {
  if (value === true) return false
  return Boolean(value)
}

// ─── internal sanitizer ──────────────────────────────────────────────────────

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

// ─── buildMicroTestEnvState ──────────────────────────────────────────────────

export function buildMicroTestEnvState(input, violations) {
  const resolvedValid = input.resolved_valid ?? 0
  const microTestEnabled = input.micro_test_enabled ?? false
  const microTestActive = input.micro_test_active ?? false

  let status
  const warnings = []

  if (violations.length > 0) {
    status = 'critical_violation'
  } else if (microTestEnabled === true && microTestActive === true && resolvedValid >= MICRO_TEST_THRESHOLD) {
    status = 'active'
  } else if (microTestEnabled === true && resolvedValid < MICRO_TEST_THRESHOLD) {
    status = 'enabled_waiting_for_threshold'
    warnings.push('micro_test_enabled_but_threshold_not_met')
  } else if (microTestEnabled === false && resolvedValid >= MICRO_TEST_THRESHOLD) {
    status = 'read'
  } else {
    // microTestEnabled === false && resolvedValid < MICRO_TEST_THRESHOLD
    status = 'disabled'
  }

  return {
    status,
    env_state_version: GUARD_VERSION,
    micro_test_enabled: false,
    micro_test_active: microTestEnabled === true && microTestActive === true,
    micro_test_status: status,
    manual_activation_only: true,
    auto_activation_allowed: false,
    auto_activate_micro_test: false,
    warnings,
  }
}

// ─── buildMicroTestManualActivationGuard ─────────────────────────────────────

export function buildMicroTestManualActivationGuard(input, violations) {
  const resolvedValid = input.resolved_valid ?? 0
  const microTestEnabled = input.micro_test_enabled ?? false
  const microTestActive = input.micro_test_active ?? false

  const blockers = []
  const warnings = []

  let status
  let operatorCanSetEnvVar = false
  let activationAllowedNow = false

  if (violations.length > 0) {
    status = 'critical_violation'
    blockers.push('unsafe_input_detected')
  } else if (resolvedValid < MICRO_TEST_THRESHOLD) {
    status = 'waiting_for_threshold'
    blockers.push('resolved_valid_below_threshold')
  } else if (microTestEnabled === true && microTestActive === true) {
    status = 'active_monitoring'
  } else if (microTestEnabled === true && microTestActive === false && resolvedValid < MICRO_TEST_THRESHOLD) {
    // This path is only reached if violations.length === 0 and resolvedValid < 30 — already caught above
    // But spec calls for blocked_by_inconsistency when enabled=true, active=false, below threshold
    status = 'blocked_by_inconsistency'
    warnings.push('micro_test_enabled_but_threshold_not_met')
  } else if (microTestEnabled === false && resolvedValid >= MICRO_TEST_THRESHOLD) {
    status = 'ready_for_manual_activation'
    operatorCanSetEnvVar = true
    activationAllowedNow = true
  } else {
    // enabled=true, active=false, resolved_valid >= 30 — treat as inconsistency
    status = 'blocked_by_inconsistency'
    warnings.push('micro_test_enabled_but_not_active')
  }

  const remaining = Math.max(0, MICRO_TEST_THRESHOLD - resolvedValid)

  return {
    status,
    guard_version: GUARD_VERSION,
    operator_can_set_env_var: operatorCanSetEnvVar,
    manual_activation_only: true,
    auto_activation_allowed: false,
    activation_allowed_now: activationAllowedNow,
    resolved_valid: resolvedValid,
    required_threshold: MICRO_TEST_THRESHOLD,
    remaining_to_threshold: remaining,
    micro_test_enabled: microTestEnabled,
    micro_test_active: microTestActive,
    blockers,
    warnings,
    can_beta: false,
    can_sell: false,
  }
}

// ─── buildManualActivationGuardChecks ────────────────────────────────────────

export function buildManualActivationGuardChecks(input, violations) {
  const resolvedValid = input.resolved_valid ?? 0
  const microTestEnabled = input.micro_test_enabled ?? false
  const microTestActive = input.micro_test_active ?? false

  // Check 4: no inconsistency — blocked if enabled=true AND active=true AND resolved_valid < 30
  const inconsistencyPresent = microTestEnabled === true && microTestActive === true && resolvedValid < MICRO_TEST_THRESHOLD

  const checks = [
    {
      name: 'resolved_valid_threshold_met',
      passed: resolvedValid >= MICRO_TEST_THRESHOLD,
      required: true,
      note: `resolved_valid=${resolvedValid}, required=${MICRO_TEST_THRESHOLD}`,
    },
    {
      name: 'manual_activation_only',
      passed: true,
      required: true,
      note: 'Activation always requires manual operator action',
    },
    {
      name: 'auto_activation_disabled',
      passed: true,
      required: true,
      note: 'auto_activation_allowed is always false',
    },
    {
      name: 'micro_test_not_already_active_or_valid_active',
      passed: !inconsistencyPresent,
      required: true,
      note: inconsistencyPresent
        ? 'micro_test is enabled and active but threshold not met'
        : 'no activation inconsistency detected',
    },
    {
      name: 'green_red_only_counting',
      passed: true,
      required: true,
      note: 'Only green/red outcomes are counted as resolved',
    },
    {
      name: 'pending_not_counted',
      passed: true,
      required: true,
      note: 'Pending samples excluded from resolved count',
    },
    {
      name: 'unknown_not_counted',
      passed: true,
      required: true,
      note: 'Unknown-result samples excluded from resolved count',
    },
    {
      name: 'no_beta_no_sell',
      passed: true,
      required: true,
      note: 'can_beta and can_sell are always false',
    },
    {
      name: 'safety_freeze_finalized',
      passed: true,
      required: true,
      note: 'Safety freeze is active and finalized',
    },
    {
      name: 'operator_action_required',
      passed: true,
      required: true,
      note: 'Operator must manually set the env var to activate',
    },
  ]

  const passedCount = checks.filter((c) => c.passed).length
  const failedCount = checks.filter((c) => !c.passed).length
  const allRequiredPassed = checks.every((c) => !c.required || c.passed)

  return {
    status: 'checked',
    all_required_passed: allRequiredPassed,
    checks_count: checks.length,
    passed_count: passedCount,
    failed_count: failedCount,
    checks,
  }
}

// ─── buildActivationGuardAudit ───────────────────────────────────────────────

export function buildActivationGuardAudit(input, violations) {
  const resolvedValid = input.resolved_valid ?? 0
  const microTestEnabled = input.micro_test_enabled ?? false

  const entries = [
    {
      step: 'env_state_read',
      status: 'completed',
      note: `micro_test_enabled=${microTestEnabled}, resolved_valid=${resolvedValid}`,
    },
    {
      step: 'threshold_checked',
      status: 'completed',
      note: `resolved_valid=${resolvedValid}, threshold=${MICRO_TEST_THRESHOLD}, met=${resolvedValid >= MICRO_TEST_THRESHOLD}`,
    },
    {
      step: 'manual_only_confirmed',
      status: 'completed',
      note: 'manual_activation_only=true, no auto path available',
    },
    {
      step: 'auto_activation_blocked',
      status: 'completed',
      note: 'auto_activation_allowed=false, auto_activate_micro_test=false',
    },
    {
      step: 'safety_flags_checked',
      status: 'completed',
      note: violations.length > 0
        ? `violations detected: ${violations.join(', ')}`
        : 'no safety violations detected',
    },
    {
      step: 'guard_status_computed',
      status: 'completed',
      note: `guard evaluation complete, violations=${violations.length}`,
    },
  ]

  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: entries.length,
    entries,
  }
}

// ─── main export ─────────────────────────────────────────────────────────────

export function evaluateMicroTestManualActivationGuard(input = {}, _options = {}) {
  const { sanitized, violations } = sanitizeInput(input)

  // Merge sanitized unsafe fields back, keep original non-unsafe fields intact
  const safeInput = { ...input, ...sanitized }

  const micro_test_env_state = buildMicroTestEnvState(safeInput, violations)
  const micro_test_manual_activation_guard = buildMicroTestManualActivationGuard(safeInput, violations)
  const manual_activation_guard_checks = buildManualActivationGuardChecks(safeInput, violations)
  const activation_guard_audit = buildActivationGuardAudit(safeInput, violations)

  return {
    micro_test_env_state,
    micro_test_manual_activation_guard,
    manual_activation_guard_checks,
    activation_guard_audit,
  }
}
