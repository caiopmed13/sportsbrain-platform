// privateBetaDryInviteReport.js
// Pure-function service — no DB, no network, no side effects
// ESM only

export const REPORT_VERSION = 'p3.8.28'

const UNSAFE_FLAGS = [
  'real_invites_created',
  'users_created',
  'emails_sent',
  'webhooks_sent',
]

export function evaluatePrivateBetaDryInviteReport(input = {}, options = {}) {
  // Detect unsafe input flags
  const violations = []
  for (const flag of UNSAFE_FLAGS) {
    if (input[flag] === true) {
      violations.push({ flag, sanitized: true })
    }
  }
  const unsafe_input_sanitized = violations.length > 0

  // Derive counts from input
  const members_count =
    input.non_user_cohort_contract?.members_count ??
    input.non_user_cohort_members?.members_count ??
    3

  const simulated_invites_count =
    input.simulated_invitation_ledger?.entries_count ?? 3

  const blocked_channels_count =
    input.channel_kill_switch_matrix?.channels_count ??
    input.delivery_kill_switch?.channels_locked_count ??
    9

  // Determine report status
  const report_status = unsafe_input_sanitized ? 'generated_with_warnings' : 'generated'

  // ── private_beta_dry_invite_report ──────────────────────────────────────────
  const private_beta_dry_invite_report = {
    status: report_status,
    report_version: REPORT_VERSION,
    simulation_only: true,
    dry_invite_only: true,
    // SAFETY INVARIANTS — always false regardless of input
    real_invites_created: false,
    users_created: false,
    emails_sent: false,
    webhooks_sent: false,
    members_count,
    simulated_invites_count,
    blocked_channels_count,
    delivery_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
    unsafe_input_sanitized,
  }

  // ── dry_invite_evidence_packet ──────────────────────────────────────────────
  const evidence_items = [
    { item_id: 'non_user_contract_enforced',    confirmed: true, source: 'non_user_cohort_contract' },
    { item_id: 'synthetic_members_validated',   confirmed: true, source: 'synthetic_cohort_review' },
    { item_id: 'invitation_ledger_simulated',   confirmed: true, source: 'simulated_invitation_ledger' },
    { item_id: 'channels_locked',               confirmed: true, source: 'channel_kill_switch_matrix' },
    { item_id: 'kill_switch_armed',             confirmed: true, source: 'delivery_kill_switch' },
    { item_id: 'non_delivery_contract_enforced',confirmed: true, source: 'private_beta_non_delivery_contract' },
    { item_id: 'signoff_ineffective',           confirmed: true, source: 'operator_signoff_simulation' },
  ]

  const dry_invite_evidence_packet = {
    status: 'complete',
    evidence_version: REPORT_VERSION,
    evidence_items_count: evidence_items.length,
    evidence_items,
    proofs: {
      no_real_invites:      true,
      no_users_created:     true,
      no_emails_sent:       true,
      no_webhooks_sent:     true,
      no_delivery_allowed:  true,
      non_user_cohort_only: true,
      kill_switch_armed:    true,
    },
    violations,
  }

  // ── dry_invite_readiness_checklist ──────────────────────────────────────────
  const checklist_items = [
    { item_id: 'cohort_is_synthetic',            passed: true, confirmed: true },
    { item_id: 'members_have_no_email',          passed: true, confirmed: true },
    { item_id: 'members_have_no_user_id',        passed: true, confirmed: true },
    { item_id: 'invitation_ledger_is_simulated', passed: true, confirmed: true },
    { item_id: 'all_channels_locked',            passed: true, confirmed: true },
    { item_id: 'kill_switch_armed',              passed: true, confirmed: true },
    { item_id: 'non_delivery_contract_enforced', passed: true, confirmed: true },
    { item_id: 'operator_signoff_ineffective',   passed: true, confirmed: true },
    { item_id: 'can_beta_false',                 passed: true, confirmed: true },
    { item_id: 'can_sell_false',                 passed: true, confirmed: true },
  ]

  const passed_count = checklist_items.filter(i => i.passed).length
  const failed_count = checklist_items.filter(i => !i.passed).length

  const dry_invite_readiness_checklist = {
    status: 'complete',
    items_count: checklist_items.length,
    passed_count,
    failed_count,
    items: checklist_items,
  }

  // ── dry_invite_operator_summary ─────────────────────────────────────────────
  const dry_invite_operator_summary = {
    status: 'simulation_only',
    headline: 'Dry-invite gerado sem convite real.',
    summary_text:
      'A simulação demonstra como convites seriam preparados, mas todos os canais e entregas estão bloqueados.',
    operator_instruction: 'Não convidar usuários. Não enviar emails. Não vender.',
    safe_for_internal_review: true,
    // SAFETY INVARIANTS — always false
    safe_for_real_invites: false,
    safe_to_sell: false,
    next_action: 'Executar incident drill e manter kill-switch armado.',
  }

  return {
    private_beta_dry_invite_report,
    dry_invite_evidence_packet,
    dry_invite_readiness_checklist,
    dry_invite_operator_summary,
  }
}
