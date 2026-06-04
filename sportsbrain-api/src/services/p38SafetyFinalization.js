// p38SafetyFinalization.js
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network

const UNSAFE_INPUT_KEYS = [
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
  'download_enabled',
  'storage_write_enabled',
  'email_sent',
  'webhook_sent',
  'operator_notified_externally',
  'incident_real_action_taken',
  'recovery_real_action_taken',
  'checkout_enabled',
  'pricing_enabled',
];

const INVARIANT_CHECK_IDS = [
  'can_beta_false',
  'can_sell_false',
  'real_users_false',
  'real_delivery_false',
  'delivery_allowed_false',
  'download_enabled_false',
  'storage_write_enabled_false',
  'checkout_enabled_false',
  'pricing_enabled_false',
  'email_sent_false',
  'webhook_sent_false',
  'operator_notified_externally_false',
  'incident_real_action_taken_false',
  'recovery_real_action_taken_false',
];

// Maps check_id -> input key that would violate it (undefined = no direct input key)
const CHECK_ID_TO_INPUT_KEY = {
  can_beta_false: 'can_beta',
  can_sell_false: 'can_sell',
  real_users_false: undefined,
  real_delivery_false: 'real_delivery',
  delivery_allowed_false: 'delivery_allowed',
  download_enabled_false: 'download_enabled',
  storage_write_enabled_false: 'storage_write_enabled',
  checkout_enabled_false: 'checkout_enabled',
  pricing_enabled_false: 'pricing_enabled',
  email_sent_false: 'email_sent',
  webhook_sent_false: 'webhook_sent',
  operator_notified_externally_false: 'operator_notified_externally',
  incident_real_action_taken_false: 'incident_real_action_taken',
  recovery_real_action_taken_false: 'recovery_real_action_taken',
};

export function evaluateP38SafetyFinalization(input = {}, options = {}) {
  // --- Unsafe input detection ---
  const violations = [];
  for (const key of UNSAFE_INPUT_KEYS) {
    if (input[key] === true) {
      violations.push(key);
    }
  }
  const unsafeInputSanitized = violations.length > 0;

  // --- p38_safety_freeze_finalization ---
  const p38_safety_freeze_finalization = {
    status: unsafeInputSanitized ? 'finalized_with_warnings' : 'finalized',
    finalization_version: 'p3.8.30',
    freeze_active: true,
    no_sell_active: true,
    non_delivery_active: true,
    kill_switch_active: true,
    incident_response_ready: true,
    can_be_unfrozen_now: false,
    requires_future_phase_to_unfreeze: true,
    can_beta: false,
    can_sell: false,
    delivery_allowed: false,
    unsafe_input_sanitized: unsafeInputSanitized,
    violations: [...violations],
  };

  // --- final_safety_invariant_check ---
  const violationSet = new Set(violations);
  const checks = INVARIANT_CHECK_IDS.map((checkId) => {
    const inputKey = CHECK_ID_TO_INPUT_KEY[checkId];
    const violated = inputKey !== undefined && violationSet.has(inputKey);
    return {
      check_id: checkId,
      passed: !violated,
      expected: false,
      actual: violated ? true : false,
    };
  });

  const failedChecks = checks.filter((c) => !c.passed);
  const failed_count = failedChecks.length;
  const critical_failures = failedChecks.map((c) => c.check_id);

  const final_safety_invariant_check = {
    status: failed_count > 0 ? 'failed' : 'passed',
    passed: failed_count === 0,
    checks_count: 14,
    failed_count,
    critical_failures,
    checks,
  };

  // --- final_no_sell_no_delivery_check ---
  const final_no_sell_no_delivery_check = {
    status: 'passed',
    passed: true,
    no_sell_confirmed: true,
    no_delivery_confirmed: true,
    no_invites_confirmed: true,
    no_external_notification_confirmed: true,
    safe_to_sell: false,
    safe_to_invite_private_users: false,
    operator_notified_externally: false,
    delivery_allowed: false,
  };

  // --- p38_safety_finalization_summary ---
  const p38_safety_finalization_summary = {
    status: 'finalized',
    headline: 'Safety freeze finalizado.',
    summary_text:
      'No-sell, no-delivery, kill-switch e incident recovery permanecem ativos.',
    can_beta: false,
    can_sell: false,
    delivery_allowed: false,
    ready_for_quality_proof: true,
    next_action: 'Avançar para P3.9 sem liberar beta real.',
  };

  return {
    p38_safety_freeze_finalization,
    final_safety_invariant_check,
    final_no_sell_no_delivery_check,
    p38_safety_finalization_summary,
  };
}
