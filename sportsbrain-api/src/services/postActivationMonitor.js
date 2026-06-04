// postActivationMonitor.js
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network
// version: p3.9.1

const MONITOR_VERSION = 'p3.9.1'

const UNSAFE_FIELDS = [
  'can_beta',
  'can_sell',
  'auto_activate_micro_test',
  'auto_activation_allowed',
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

// ─── post_activation_monitor ────────────────────────────────────────────────

export function buildPostActivationMonitor(input, violations) {
  const microTestActive = input.micro_test_active ?? false
  const microTestReport = input.micro_test_report ?? null
  const microTestPolicy = input.micro_test_policy ?? null
  const qualityProofKickoff = input.quality_proof_kickoff ?? null

  const microTestReportStatus = microTestReport?.status ?? 'not_started'
  const qualityPolicyStatus = microTestPolicy?.decision_state ?? 'not_started'
  const monitoringStarted = microTestActive && microTestReport?.status === 'active'
  const hasFirstQualitySnapshot = qualityProofKickoff?.quality_proof_started === true

  let status
  if (violations.length > 0) {
    status = 'critical_violation'
  } else if (!microTestActive) {
    status = 'not_active'
  } else if (microTestReportStatus !== 'active') {
    status = 'waiting_for_report'
  } else if (qualityProofKickoff?.status === 'quality_proof_started') {
    status = 'quality_snapshot_available'
  } else {
    status = 'monitoring_active'
  }

  return {
    status,
    monitor_version: MONITOR_VERSION,
    micro_test_active: false,
    micro_test_report_status: microTestReportStatus,
    quality_policy_status: qualityPolicyStatus,
    monitoring_started: monitoringStarted,
    has_first_quality_snapshot: hasFirstQualitySnapshot,
    requires_operator_review: true,
    can_beta: false,
    can_sell: false,
    blockers: violations.length > 0 ? ['unsafe_input_detected'] : [],
    warnings: [],
  }
}

// ─── micro_test_progress_tracker ────────────────────────────────────────────

export function buildMicroTestProgressTracker(input) {
  const resolvedValid =
    input.resolved_valid ?? input.resolved_sample_audit?.resolved_valid ?? 0

  const milestoneTargets = [30, 50, 100]
  const milestones = milestoneTargets.map((target) => ({
    target,
    reached: resolvedValid >= target,
    remaining: Math.max(0, target - resolvedValid),
  }))

  const nextMilestone = milestones.find((m) => !m.reached)?.target ?? 100

  return {
    status: 'tracking',
    resolved_valid: resolvedValid,
    milestones,
    next_milestone: nextMilestone,
    progress_pct_to_30: Math.min(100, Math.round((resolvedValid / 30) * 100)),
    progress_pct_to_100: Math.min(100, Math.round((resolvedValid / 100) * 100)),
  }
}

// ─── post_activation_checks ─────────────────────────────────────────────────

export function buildPostActivationChecks(input, violations) {
  const microTestActive = input.micro_test_active ?? false
  const microTestReport = input.micro_test_report ?? null
  const microTestPolicy = input.micro_test_policy ?? null
  const resolvedValid =
    input.resolved_sample_audit?.resolved_valid ?? input.resolved_valid ?? 0

  const checks = [
    {
      name: 'micro_test_active',
      passed: microTestActive === true,
      required: true,
      note: microTestActive ? 'Micro-test is active.' : 'Micro-test is not yet active.',
    },
    {
      name: 'micro_test_report_available',
      passed: microTestReport?.status === 'active',
      required: false,
      note:
        microTestReport?.status === 'active'
          ? 'Report is active.'
          : 'Report not yet available.',
    },
    {
      name: 'quality_policy_available',
      passed: microTestPolicy != null,
      required: false,
      note: microTestPolicy != null ? 'Quality policy present.' : 'No quality policy yet.',
    },
    {
      name: 'resolved_sample_still_valid',
      passed: resolvedValid >= 30,
      required: false,
      note:
        resolvedValid >= 30
          ? `${resolvedValid} resolved valid samples meet threshold.`
          : `Only ${resolvedValid} resolved valid samples — need 30.`,
    },
    {
      name: 'no_beta_no_sell',
      passed: true,
      required: true,
      note: 'Beta and sell are always locked.',
    },
    {
      name: 'operator_review_required',
      passed: true,
      required: true,
      note: 'Operator review is always required before any promotion.',
    },
  ]

  return {
    status: 'checked',
    checks,
  }
}

// ─── post_activation_operator_notes ─────────────────────────────────────────

export function buildPostActivationOperatorNotes(input) {
  const microTestActive = input.micro_test_active ?? false
  const microTestReport = input.micro_test_report ?? null
  const qualityProofKickoff = input.quality_proof_kickoff ?? null

  const reportActive = microTestReport?.status === 'active'
  const isMonitoringActive =
    microTestActive &&
    reportActive &&
    qualityProofKickoff?.status !== 'quality_proof_started'
  const isQualitySnapshot =
    microTestActive &&
    reportActive &&
    qualityProofKickoff?.status === 'quality_proof_started'

  let status
  let note
  let operatorInstruction

  if (!microTestActive) {
    status = 'not_active'
    note = 'Micro-test não está ativo. Aguardar ativação manual.'
    operatorInstruction =
      'Aguarde atingir o threshold de amostras e ative o micro-test manualmente via variável de ambiente do Worker.'
  } else if (!reportActive) {
    status = 'active'
    note = 'Micro-test ativo mas relatório ainda não disponível.'
    operatorInstruction =
      'Aguarde o relatório do micro-test ficar disponível antes de tomar qualquer ação.'
  } else if (isQualitySnapshot || isMonitoringActive) {
    status = 'monitoring'
    note = 'Micro-test monitorado ativamente. Qualidade sendo aferida.'
    operatorInstruction =
      'Continue monitorando. Não promova para beta nem habilite sell sem aprovação explícita do operador.'
  } else {
    status = 'monitoring'
    note = 'Micro-test monitorado ativamente. Qualidade sendo aferida.'
    operatorInstruction =
      'Continue monitorando. Não promova para beta nem habilite sell sem aprovação explícita do operador.'
  }

  return {
    status,
    note,
    operator_instruction: operatorInstruction,
    can_beta: false,
    can_sell: false,
  }
}

// ─── main export ─────────────────────────────────────────────────────────────

export function evaluatePostActivationMonitor(input = {}, _options = {}) {
  const { sanitized, violations } = sanitizeInput(input)
  const safeInput = { ...input, ...sanitized }

  const post_activation_monitor = buildPostActivationMonitor(safeInput, violations)
  const micro_test_progress_tracker = buildMicroTestProgressTracker(safeInput)
  const post_activation_checks = buildPostActivationChecks(safeInput, violations)
  const post_activation_operator_notes = buildPostActivationOperatorNotes(safeInput)

  return {
    post_activation_monitor,
    micro_test_progress_tracker,
    post_activation_checks,
    post_activation_operator_notes,
  }
}
