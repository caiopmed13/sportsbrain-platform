export const SIMULATION_VERSION = 'p3.8.25'

// Fixed simulation attempts — all blocked or future_review_only, none applied
const FIXED_ATTEMPTS = [
  { attempt_id: 'sim-internal-download',              capability: 'internal_download',              requested: true, result: 'future_review_only', applied: false, reason: 'requires_future_phase',   safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-internal-storage',               capability: 'internal_storage',               requested: true, result: 'future_review_only', applied: false, reason: 'requires_future_phase',   safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-admin-report-archive',           capability: 'admin_report_archive',           requested: true, result: 'future_review_only', applied: false, reason: 'requires_future_phase',   safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-manual-review-unlock',           capability: 'manual_review_unlock',           requested: true, result: 'future_review_only', applied: false, reason: 'requires_future_phase',   safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-private-beta-invite-simulation', capability: 'private_beta_invite_simulation', requested: true, result: 'future_review_only', applied: false, reason: 'requires_future_phase',   safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-private-beta-real',              capability: 'private_beta_real',              requested: true, result: 'blocked',            applied: false, reason: 'hard_blocked',            safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-sell',                           capability: 'sell',                           requested: true, result: 'blocked',            applied: false, reason: 'commercial_forbidden',    safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-public-beta',                    capability: 'public_beta',                    requested: true, result: 'blocked',            applied: false, reason: 'hard_blocked',            safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-real-delivery',                  capability: 'real_delivery',                  requested: true, result: 'blocked',            applied: false, reason: 'hard_blocked',            safe_output_value: false, rollback_required: false },
  { attempt_id: 'sim-download',                       capability: 'public_export',                  requested: true, result: 'rejected',           applied: false, reason: 'public_export_forbidden', safe_output_value: false, rollback_required: false },
]

const ROLLBACK_STEPS = [
  { step_id: 'disable_capability_flag',       order: 1, automated: true  },
  { step_id: 'restore_freeze_baseline',       order: 2, automated: true  },
  { step_id: 'run_safety_invariant_snapshot', order: 3, automated: true  },
  { step_id: 'run_release_freeze_sentinel',   order: 4, automated: true  },
  { step_id: 'run_redaction_regression_lock', order: 5, automated: true  },
  { step_id: 'verify_can_beta_false',         order: 6, automated: true  },
  { step_id: 'verify_can_sell_false',         order: 7, automated: true  },
  { step_id: 'notify_operator_internal_only', order: 8, automated: false },
]

const AUDIT_ENTRIES = [
  'simulation_started',
  'capability_matrix_loaded',
  'unlock_attempts_generated',
  'all_attempts_blocked_or_future_review',
  'no_unlock_applied',
  'rollback_plan_ready',
  'final_safety_confirmed',
]

function isUnsafeInput(input) {
  if (typeof input !== 'object' || input === null) return false
  const dangerKeys = ['unfreeze_enabled', 'controlled_unfreeze_active', 'force_unlock', 'override_freeze']
  return dangerKeys.some(k => input[k] === true)
}

export function buildCapabilityUnlockAttempts(input, options) {
  // Returns a deep copy of FIXED_ATTEMPTS — applied is always false regardless of input
  return FIXED_ATTEMPTS.map(a => ({ ...a, applied: false }))
}

export function buildControlledUnfreezeSimulation(input, options) {
  const attempts = buildCapabilityUnlockAttempts(input, options)

  const blocked_attempts_count = attempts.filter(
    a => a.result === 'blocked' || a.result === 'rejected'
  ).length

  const future_review_attempts_count = attempts.filter(
    a => a.result === 'future_review_only'
  ).length

  const capabilities_requested = attempts.map(a => a.capability)

  const result = {
    status: 'simulated',
    simulation_version: SIMULATION_VERSION,
    simulation_only: true,
    unfreeze_applied: false,
    capabilities_requested,
    attempts_count: attempts.length,
    blocked_attempts_count,
    future_review_attempts_count,
    successful_unlocks_count: 0,
    can_enable_beta: false,
    can_enable_sell: false,
    can_enable_download: false,
    can_enable_storage: false,
  }

  if (isUnsafeInput(input)) {
    result.unsafe_input_sanitized = true
  }

  return result
}

export function buildUnlockRollbackPlan(input, options) {
  return {
    status: 'ready',
    rollback_required_now: false,
    future_rollback_required_if_unlocked: true,
    automatic_relock_supported: true,
    manual_operator_review_required: true,
    rollback_steps_count: ROLLBACK_STEPS.length,
    rollback_steps: ROLLBACK_STEPS.map(s => ({ ...s })),
  }
}

export function buildUnlockSimulationAudit(input, options) {
  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: AUDIT_ENTRIES.length,
    entries: AUDIT_ENTRIES.map(id => ({ entry_id: id, status: 'recorded' })),
  }
}

export function evaluateControlledUnfreezeSimulation(input, options) {
  return {
    controlled_unfreeze_simulation: buildControlledUnfreezeSimulation(input, options),
    capability_unlock_attempts: buildCapabilityUnlockAttempts(input, options),
    unlock_rollback_plan: buildUnlockRollbackPlan(input, options),
    unlock_simulation_audit: buildUnlockSimulationAudit(input, options),
  }
}
