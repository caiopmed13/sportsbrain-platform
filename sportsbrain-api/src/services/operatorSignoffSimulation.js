// operatorSignoffSimulation.js
// Pure simulation module — no imports, no DB, no side effects.
// SIMULATION_VERSION = 'p3.8.26'
// All effective booleans are hardcoded false. Sign-off is never operationally effective.

const SIMULATION_VERSION = 'p3.8.26'

/**
 * Normalise any truthy/falsy value to a strict boolean.
 * Intentionally never returns true for the safety-critical flags —
 * callers decide what to do with the normalised value.
 */
export function normalizeSignoffBoolean(value) {
  return value === true
}

/**
 * Build the core operator sign-off simulation object.
 *
 * Safety invariants (HARD — never altered by input or options):
 *   operator_signoff_effective  → false
 *   effective                   → false
 *   can_override_governance     → false
 *   can_enable_beta             → false
 *   can_enable_sell             → false
 *   simulated_approval          → false  (output — intent is recorded separately via status)
 *   simulated_rejection         → false  (output — intent is recorded separately via status)
 *   enabled                     → false
 */
export function buildOperatorSignoffSimulation(input = {}, options = {}) {
  const enabled = normalizeSignoffBoolean(options.OPERATOR_SIGNOFF_SIMULATION_ENABLED)
  const approved = normalizeSignoffBoolean(options.OPERATOR_SIMULATED_SIGNOFF_APPROVED)
  const rejected = normalizeSignoffBoolean(options.OPERATOR_SIMULATED_SIGNOFF_REJECTED)

  // Detect unsafe input — any attempt to set operator_signoff_effective to true is sanitised
  const unsafeInputSanitized = input != null && input.operator_signoff_effective === true

  // Determine status
  let status
  let reason

  if (!enabled) {
    status = 'disabled'
    reason = 'simulation_disabled'
  } else if (approved && rejected) {
    status = 'conflict'
    reason = 'conflict_detected'
  } else if (approved) {
    status = 'approved_but_ineffective'
    reason = 'no_override_policy'
  } else if (rejected) {
    status = 'rejected'
    reason = 'operator_rejected'
  } else {
    status = 'pending'
    reason = 'awaiting_operator_decision'
  }

  return {
    status,
    simulation_only: true,
    enabled: false,                    // ALWAYS false
    simulated_approval: false,         // ALWAYS false in output
    simulated_rejection: false,        // ALWAYS false in output
    conflict: approved && rejected,
    effective: false,                  // ALWAYS false
    operator_signoff_effective: false, // HARD INVARIANT — ALWAYS false
    can_override_governance: false,    // ALWAYS false
    can_enable_beta: false,            // ALWAYS false
    can_enable_sell: false,            // ALWAYS false
    reason,
    unsafe_input_sanitized: unsafeInputSanitized,
  }
}

/**
 * Build the sign-off effectiveness policy.
 * Sign-off can never override governance in this phase.
 */
export function buildSignoffEffectivenessPolicy(input = {}, options = {}) {
  return {
    status: 'no_override',
    policy_version: SIMULATION_VERSION,
    signoff_can_override: false,           // ALWAYS false
    signoff_effective_now: false,          // ALWAYS false
    requires_future_phase: true,
    requires_non_delivery_contract: true,
    requires_release_freeze: true,
    allowed_effects: ['internal_note_only'],
    blocked_effects: [
      'enable_beta',
      'enable_sell',
      'enable_delivery',
      'enable_checkout',
      'enable_download',
    ],
  }
}

/**
 * Build the immutable audit trail for this sign-off simulation cycle.
 */
export function buildSignoffAuditTrail(input = {}, options = {}) {
  const entries = [
    { id: 'signoff_simulation_checked',  status: 'confirmed' },
    { id: 'approval_flag_checked',       status: 'confirmed' },
    { id: 'rejection_flag_checked',      status: 'confirmed' },
    { id: 'no_override_policy_checked',  status: 'confirmed' },
    { id: 'governance_locks_confirmed',  status: 'confirmed' },
    { id: 'final_no_effect_confirmed',   status: 'confirmed' },
  ]

  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: entries.length,
    entries,
  }
}

/**
 * Build the human-readable sign-off summary.
 * Delivery, beta and sell flags are always false regardless of input.
 */
export function buildSignoffSummary(input = {}, options = {}) {
  return {
    status: 'ineffective',
    headline: 'Sign-off simulado sem efeito operacional.',
    summary_text:
      'Qualquer aprovação simulada permanece apenas como nota interna e não libera beta, venda ou entrega.',
    safe_to_invite_private_users: false, // ALWAYS false
    safe_to_sell: false,                  // ALWAYS false
    next_action: 'Manter política de no-delivery ativa.',
  }
}

/**
 * Top-level evaluator — composes all four simulation sub-results.
 */
export function evaluateOperatorSignoffSimulation(input = {}, options = {}) {
  return {
    operator_signoff_simulation:   buildOperatorSignoffSimulation(input, options),
    signoff_effectiveness_policy:  buildSignoffEffectivenessPolicy(input, options),
    signoff_audit_trail:           buildSignoffAuditTrail(input, options),
    signoff_summary:               buildSignoffSummary(input, options),
  }
}
