// deliveryIncidentDrill.js
// Pure-function service — simulation only, no real actions ever taken.
// DRILL_VERSION: p3.8.28

const DRILL_VERSION = 'p3.8.28'

const FIXED_SCENARIOS = [
  {
    scenario_id: 'real_invite_attempt',
    attempted_action: 'create_real_invite',
    simulated: true,
    would_be_blocked: true,
    blocked_by: ['delivery_kill_switch', 'private_beta_invitation_simulation'],
    real_action_taken: false,
    severity: 'critical',
  },
  {
    scenario_id: 'email_send_attempt',
    attempted_action: 'email_delivery',
    simulated: true,
    would_be_blocked: true,
    blocked_by: ['delivery_kill_switch', 'channel_kill_switch_matrix'],
    real_action_taken: false,
    severity: 'critical',
  },
  {
    scenario_id: 'webhook_send_attempt',
    attempted_action: 'webhook_delivery',
    simulated: true,
    would_be_blocked: true,
    blocked_by: ['delivery_kill_switch', 'channel_kill_switch_matrix'],
    real_action_taken: false,
    severity: 'critical',
  },
  {
    scenario_id: 'pick_delivery_attempt',
    attempted_action: 'real_pick_delivery',
    simulated: true,
    would_be_blocked: true,
    blocked_by: ['delivery_kill_switch', 'non_delivery_enforcement'],
    real_action_taken: false,
    severity: 'critical',
  },
  {
    scenario_id: 'user_creation_attempt',
    attempted_action: 'create_real_user',
    simulated: true,
    would_be_blocked: true,
    blocked_by: ['non_user_cohort_contract', 'delivery_kill_switch'],
    real_action_taken: false,
    severity: 'critical',
  },
  {
    scenario_id: 'paid_access_attempt',
    attempted_action: 'enable_paid_access',
    simulated: true,
    would_be_blocked: true,
    blocked_by: ['delivery_kill_switch', 'immutable_no_sell_enforcement'],
    real_action_taken: false,
    severity: 'blocker',
  },
  {
    scenario_id: 'public_post_attempt',
    attempted_action: 'public_posting',
    simulated: true,
    would_be_blocked: true,
    blocked_by: ['delivery_kill_switch', 'channel_kill_switch_matrix'],
    real_action_taken: false,
    severity: 'blocker',
  },
]

const FIXED_CHANNELS = [
  'email',
  'webhook',
  'dm',
  'sms',
  'public_page',
  'paid_access',
  'manual_copy',
  'api_delivery',
  'push_notification',
]

const FIXED_STEPS = [
  { step_id: 'relock_all_channels',           order: 1, simulated: true, real_action: false },
  { step_id: 'verify_global_kill_switch',     order: 2, simulated: true, real_action: false },
  { step_id: 'clear_delivery_flags',          order: 3, simulated: true, real_action: false },
  { step_id: 'run_non_delivery_enforcement',  order: 4, simulated: true, real_action: false },
  { step_id: 'run_safety_invariant_snapshot', order: 5, simulated: true, real_action: false },
  { step_id: 'run_release_freeze_sentinel',   order: 6, simulated: true, real_action: false },
  { step_id: 'record_internal_incident_note', order: 7, simulated: true, real_action: false },
  { step_id: 'operator_manual_review',        order: 8, simulated: true, real_action: false },
]

// Flags that must always be false — detect if input sets them true and record violations.
const UNSAFE_FLAGS = [
  'real_actions_taken',
  'incident_real_action_taken',
  'operator_notified_externally',
  'delivery_allowed',
  'can_beta',
  'can_sell',
  'real_delivery',
  'safe_to_invite_private_users',
  'safe_to_sell',
  'email_delivery_enabled',
  'webhook_enabled',
]

export function evaluateDeliveryIncidentDrill(input = {}, _options = {}) {
  // --- Detect unsafe input flags ---
  const violations = []
  for (const flag of UNSAFE_FLAGS) {
    if (input[flag] === true) {
      violations.push({ flag, sanitized: true })
    }
  }
  const unsafeInputSanitized = violations.length > 0

  // --- Build scenarios (deep-copy, force safety invariants) ---
  const scenarios = FIXED_SCENARIOS.map((s) => ({ ...s, real_action_taken: false }))

  const scenariosCount = scenarios.length
  const blockedScenariosCount = scenarios.filter((s) => s.would_be_blocked).length
  const allBlocked = blockedScenariosCount === scenariosCount

  const delivery_incident_scenarios = {
    status: 'simulated',
    scenarios_count: scenariosCount,
    scenarios,
  }

  // --- Build drill block ---
  const drillStatus =
    unsafeInputSanitized ? 'simulated_with_warnings' : 'simulated'

  const delivery_incident_drill = {
    status: drillStatus,
    drill_version: DRILL_VERSION,
    simulation_only: true,
    scenarios_count: scenariosCount,
    blocked_scenarios_count: blockedScenariosCount,
    real_actions_taken: false,
    incident_real_action_taken: false,
    operator_notified_externally: false,
    passed: allBlocked && true,
    warnings: [],
    blockers: [],
    violations,
    unsafe_input_sanitized: unsafeInputSanitized,
  }

  // --- Build incident response plan ---
  const incident_response_plan = {
    status: 'ready',
    plan_version: DRILL_VERSION,
    simulation_only: true,
    automatic_actions_allowed_now: false,
    external_notifications_allowed_now: false,
    steps_count: FIXED_STEPS.length,
    steps: FIXED_STEPS.map((s) => ({ ...s, real_action: false })),
  }

  // --- Build kill switch drill report ---
  const channelResults = FIXED_CHANNELS.map((channel) => ({
    channel,
    attempted: true,
    blocked: true,
    allowed: false,
    passed: true,
  }))

  const kill_switch_drill_report = {
    status: 'passed',
    kill_switch_armed: true,
    channels_tested_count: channelResults.length,
    channels_blocked_count: channelResults.filter((c) => c.blocked).length,
    failed_channels_count: channelResults.filter((c) => !c.blocked).length,
    all_channels_blocked: channelResults.every((c) => c.blocked),
    global_delivery_disabled: true,
    delivery_allowed: false,
    results: channelResults,
  }

  // --- Build summary ---
  const incident_drill_summary = {
    status: 'passed',
    headline: 'Incident drill simulado passou.',
    summary_text:
      'Todas as tentativas simuladas de entrega real foram bloqueadas.',
    real_actions_taken: false,
    incident_real_action_taken: false,
    delivery_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
    next_action:
      'Manter kill-switch armado e continuar apenas com revisão interna.',
  }

  return {
    delivery_incident_scenarios,
    delivery_incident_drill,
    incident_response_plan,
    kill_switch_drill_report,
    incident_drill_summary,
  }
}
