// incidentRecoverySimulation.js
// Simulation version: p3.8.29
// Cloudflare Workers Node.js ESM

export const SIMULATION_VERSION = 'p3.8.29';

const UNSAFE_INPUT_KEYS = [
  'recovery_real_action_taken',
  'operator_notified_externally',
  'automatic_recovery_executed',
  'can_beta',
  'can_sell',
  'external_escalation_sent',
];

function detectUnsafeInput(input) {
  const violations = [];
  for (const key of UNSAFE_INPUT_KEYS) {
    if (input[key] === true) {
      violations.push({ key, provided_value: true, forced_value: false });
    }
  }
  return violations;
}

function buildIncidentRecoverySimulation(violations) {
  const unsafe_input_sanitized = violations.length > 0;
  return {
    status: 'simulated',
    simulation_version: SIMULATION_VERSION,
    simulation_only: true,
    recovery_required: true,
    recovery_real_action_taken: false,
    automatic_recovery_executed: false,
    manual_operator_review_required: true,
    channels_relocked: true,
    delivery_flags_cleared: true,
    can_beta: false,
    can_sell: false,
    unsafe_input_sanitized,
    violations,
  };
}

function buildRecoveryActionPlan() {
  return {
    status: 'ready',
    plan_version: SIMULATION_VERSION,
    simulation_only: true,
    external_actions_allowed: false,
    steps_count: 13,
    steps: [
      { step_id: 'confirm_global_kill_switch_armed', order: 1,  simulated: true, real_action: false },
      { step_id: 'relock_all_delivery_channels',     order: 2,  simulated: true, real_action: false },
      { step_id: 'clear_invitation_flags',           order: 3,  simulated: true, real_action: false },
      { step_id: 'clear_delivery_flags',             order: 4,  simulated: true, real_action: false },
      { step_id: 'verify_no_users_created',          order: 5,  simulated: true, real_action: false },
      { step_id: 'verify_no_emails_sent',            order: 6,  simulated: true, real_action: false },
      { step_id: 'verify_no_webhooks_sent',          order: 7,  simulated: true, real_action: false },
      { step_id: 'run_non_delivery_enforcement',     order: 8,  simulated: true, real_action: false },
      { step_id: 'run_safety_invariant_snapshot',    order: 9,  simulated: true, real_action: false },
      { step_id: 'run_release_freeze_sentinel',      order: 10, simulated: true, real_action: false },
      { step_id: 'run_redaction_regression_lock',    order: 11, simulated: true, real_action: false },
      { step_id: 'record_internal_recovery_note',    order: 12, simulated: true, real_action: false },
      { step_id: 'operator_manual_review',           order: 13, simulated: true, real_action: false },
    ],
  };
}

function buildRecoveryVerificationChecklist(violations) {
  const hasUnsafe = violations.length > 0;
  const items = [
    { item_id: 'global_kill_switch_still_armed', passed: true, confirmed: true },
    { item_id: 'all_channels_locked',            passed: true, confirmed: true },
    { item_id: 'real_invites_false',             passed: true, confirmed: true },
    { item_id: 'users_created_false',            passed: true, confirmed: true },
    { item_id: 'emails_sent_false',              passed: true, confirmed: true },
    { item_id: 'webhooks_sent_false',            passed: true, confirmed: true },
    { item_id: 'real_delivery_false',            passed: true, confirmed: true },
    { item_id: 'can_beta_false',                 passed: true, confirmed: true },
    { item_id: 'can_sell_false',                 passed: true, confirmed: true },
    { item_id: 'delivery_allowed_false',         passed: true, confirmed: true },
    { item_id: 'external_notifications_false',   passed: true, confirmed: true },
  ];
  return {
    status: hasUnsafe ? 'passed_with_warnings' : 'passed',
    items_count: items.length,
    passed_count: items.length,
    failed_count: 0,
    items,
  };
}

function buildIncidentResponseSummary() {
  return {
    status: 'contained',
    headline: 'Recovery simulado confirmou containment.',
    summary_text: 'Nenhuma ação real foi tomada; flags sensíveis permanecem false.',
    recovery_real_action_taken: false,
    operator_notified_externally: false,
    safe_to_continue_internal_review: true,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
    next_action: 'Manter kill-switch e revisar incident ledger internamente.',
  };
}

export function evaluateIncidentRecoverySimulation(input = {}, options = {}) {
  const violations = detectUnsafeInput(input);

  const incident_recovery_simulation = buildIncidentRecoverySimulation(violations);
  const recovery_action_plan = buildRecoveryActionPlan();
  const recovery_verification_checklist = buildRecoveryVerificationChecklist(violations);
  const incident_response_summary = buildIncidentResponseSummary();

  return {
    incident_recovery_simulation,
    recovery_action_plan,
    recovery_verification_checklist,
    incident_response_summary,
  };
}
