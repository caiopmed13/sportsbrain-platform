// betaSafetyIncidentLedger.js
// LEDGER_VERSION = 'p3.8.29'

const LEDGER_VERSION = 'p3.8.29';

const DEFAULT_INCIDENT_RECORDS = [
  {
    incident_id: 'sim-inc-001',
    scenario_id: 'real_invite_attempt',
    incident_type: 'real_invitation_attempt',
    severity: 'critical',
    status: 'contained',
    simulated: true,
    real_action_taken: false,
    blocked_by: ['delivery_kill_switch', 'private_beta_invitation_simulation'],
    recovery_required: true,
    external_notification_sent: false,
    safe_output: true,
  },
  {
    incident_id: 'sim-inc-002',
    scenario_id: 'email_send_attempt',
    incident_type: 'email_delivery_attempt',
    severity: 'critical',
    status: 'contained',
    simulated: true,
    real_action_taken: false,
    blocked_by: ['delivery_kill_switch', 'channel_kill_switch_matrix'],
    recovery_required: true,
    external_notification_sent: false,
    safe_output: true,
  },
  {
    incident_id: 'sim-inc-003',
    scenario_id: 'webhook_send_attempt',
    incident_type: 'webhook_delivery_attempt',
    severity: 'critical',
    status: 'contained',
    simulated: true,
    real_action_taken: false,
    blocked_by: ['delivery_kill_switch', 'channel_kill_switch_matrix'],
    recovery_required: true,
    external_notification_sent: false,
    safe_output: true,
  },
  {
    incident_id: 'sim-inc-004',
    scenario_id: 'pick_delivery_attempt',
    incident_type: 'real_pick_delivery_attempt',
    severity: 'critical',
    status: 'contained',
    simulated: true,
    real_action_taken: false,
    blocked_by: ['delivery_kill_switch', 'non_delivery_enforcement'],
    recovery_required: true,
    external_notification_sent: false,
    safe_output: true,
  },
  {
    incident_id: 'sim-inc-005',
    scenario_id: 'user_creation_attempt',
    incident_type: 'real_user_creation_attempt',
    severity: 'critical',
    status: 'contained',
    simulated: true,
    real_action_taken: false,
    blocked_by: ['non_user_cohort_contract', 'delivery_kill_switch'],
    recovery_required: false,
    external_notification_sent: false,
    safe_output: true,
  },
  {
    incident_id: 'sim-inc-006',
    scenario_id: 'paid_access_attempt',
    incident_type: 'paid_access_attempt',
    severity: 'critical',
    status: 'contained',
    simulated: true,
    real_action_taken: false,
    blocked_by: ['delivery_kill_switch', 'immutable_no_sell_enforcement'],
    recovery_required: false,
    external_notification_sent: false,
    safe_output: true,
  },
  {
    incident_id: 'sim-inc-007',
    scenario_id: 'public_post_attempt',
    incident_type: 'public_posting_attempt',
    severity: 'high',
    status: 'contained',
    simulated: true,
    real_action_taken: false,
    blocked_by: ['delivery_kill_switch', 'channel_kill_switch_matrix'],
    recovery_required: false,
    external_notification_sent: false,
    safe_output: true,
  },
];

const UNSAFE_INPUT_KEYS = [
  'incident_real_action_taken',
  'real_delivery',
  'email_delivery_enabled',
  'webhook_enabled',
  'delivery_allowed',
  'external_notifications_sent',
];

export function evaluateBetaSafetyIncidentLedger(input = {}, options = {}) {
  // Detect unsafe inputs
  const violations = [];
  let unsafe_input_sanitized = false;

  for (const key of UNSAFE_INPUT_KEYS) {
    if (input[key] === true) {
      violations.push({
        field: key,
        provided_value: true,
        enforced_value: false,
        reason: 'Safety invariant: real actions and delivery are never permitted in beta simulation mode.',
      });
      unsafe_input_sanitized = true;
    }
  }

  // Build simulated incident records (use input overrides if provided, else defaults)
  const simulated_incident_records =
    Array.isArray(input.delivery_incident_scenarios) && input.delivery_incident_scenarios.length > 0
      ? input.delivery_incident_scenarios.map((scenario, idx) => ({
          incident_id: scenario.incident_id || `sim-inc-${String(idx + 1).padStart(3, '0')}`,
          scenario_id: scenario.scenario_id || `scenario_${idx + 1}`,
          incident_type: scenario.incident_type || 'unknown_incident_type',
          severity: scenario.severity || 'high',
          status: 'contained',
          simulated: true,
          real_action_taken: false,
          blocked_by: scenario.blocked_by || ['delivery_kill_switch'],
          recovery_required: scenario.recovery_required !== undefined ? scenario.recovery_required : false,
          external_notification_sent: false,
          safe_output: true,
        }))
      : DEFAULT_INCIDENT_RECORDS.map(r => ({ ...r }));

  // Count severities
  const critical_count = simulated_incident_records.filter(r => r.severity === 'critical').length;
  const high_count = simulated_incident_records.filter(r => r.severity === 'high').length;
  const medium_count = simulated_incident_records.filter(r => r.severity === 'medium').length;
  const low_count = simulated_incident_records.filter(r => r.severity === 'low').length;
  const contained_count = simulated_incident_records.filter(r => r.status === 'contained').length;
  const total_count = simulated_incident_records.length;

  // incident_severity_matrix
  const incident_severity_matrix = {
    status: 'evaluated',
    matrix_version: LEDGER_VERSION,
    severity_levels: ['low', 'medium', 'high', 'critical'],
    critical_count,
    high_count,
    medium_count,
    low_count,
    items: simulated_incident_records.map(r => ({
      scenario_id: r.scenario_id,
      severity: r.severity,
      contained: r.status === 'contained',
    })),
  };

  // beta_safety_incident_ledger
  const ledger_status = unsafe_input_sanitized ? 'simulated_with_warnings' : 'simulated';

  const beta_safety_incident_ledger = {
    status: ledger_status,
    ledger_version: LEDGER_VERSION,
    simulation_only: true,
    persistence_enabled: false,
    incidents_count: total_count,
    critical_incidents_count: critical_count,
    contained_incidents_count: contained_count,
    real_actions_taken: false,
    external_notifications_sent: false,
    delivery_allowed: false,
    unsafe_input_sanitized,
    violations,
  };

  // incident_ledger_summary
  const incident_ledger_summary = {
    status: 'contained',
    headline: 'Incident ledger simulado sem ação real.',
    summary_text:
      'Todos os incidentes simulados foram contidos por kill-switch e políticas de não-entrega.',
    incidents_count: total_count,
    contained_incidents_count: contained_count,
    real_actions_taken: false,
    external_notifications_sent: false,
    safe_to_continue_internal_review: true,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  };

  return {
    beta_safety_incident_ledger,
    simulated_incident_records,
    incident_severity_matrix,
    incident_ledger_summary,
  };
}
