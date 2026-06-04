// privateBetaInvitationSimulation.js
// Pure simulation — no imports, no DB, no side effects.
// All real invite/delivery booleans are hardcoded false.

const SIMULATION_VERSION = 'p3.8.27'

export function buildInvitationChannelPolicy(input = {}, options = {}) {
  return {
    status: 'locked',
    policy_version: SIMULATION_VERSION,
    email_allowed: false,
    webhook_allowed: false,
    dm_allowed: false,
    sms_allowed: false,
    public_page_allowed: false,
    paid_access_allowed: false,
    manual_copy_allowed: false,
    simulation_only: true,
    blocked_channels: ['email', 'webhook', 'dm', 'sms', 'public_page', 'paid_access'],
  }
}

export function buildPrivateBetaInvitationSimulation(input = {}, options = {}) {
  const unsafeKeys = ['real_invites_created', 'users_created', 'emails_sent', 'webhooks_sent']
  const unsafeTrueFound = unsafeKeys.some((k) => input[k] === true)

  return {
    status: 'simulated',
    simulation_version: SIMULATION_VERSION,
    simulation_only: true,
    invitation_delivery_allowed: false,
    real_invites_enabled: false,
    real_invites_created: false,
    users_created: false,
    emails_sent: false,
    webhooks_sent: false,
    invites_count: 0,
    blocked_invites_count: 3,
    simulated_invites_count: 3,
    unsafe_input_sanitized: unsafeTrueFound,
  }
}

export function buildSimulatedInvitationLedger(input = {}, options = {}) {
  return {
    status: 'simulated',
    simulation_only: true,
    persistence_enabled: false,
    entries_count: 3,
    entries: [
      {
        invitation_id: 'sim-invite-001',
        member_id: 'sim-cohort-001',
        status: 'would_prepare_invite_but_blocked',
        channel: 'none',
        real_invite_created: false,
        email_sent: false,
        webhook_sent: false,
        user_created: false,
        delivery_allowed: false,
        block_reason: 'non_delivery_contract',
      },
      {
        invitation_id: 'sim-invite-002',
        member_id: 'sim-cohort-002',
        status: 'would_prepare_invite_but_blocked',
        channel: 'none',
        real_invite_created: false,
        email_sent: false,
        webhook_sent: false,
        user_created: false,
        delivery_allowed: false,
        block_reason: 'non_delivery_contract',
      },
      {
        invitation_id: 'sim-invite-003',
        member_id: 'sim-cohort-003',
        status: 'would_prepare_invite_but_blocked',
        channel: 'none',
        real_invite_created: false,
        email_sent: false,
        webhook_sent: false,
        user_created: false,
        delivery_allowed: false,
        block_reason: 'non_delivery_contract',
      },
    ],
  }
}

export function buildInvitationSimulationAudit(input = {}, options = {}) {
  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: 7,
    entries: [
      { id: 'simulation_started',            status: 'confirmed' },
      { id: 'channel_policy_checked',        status: 'confirmed' },
      { id: 'non_user_cohort_checked',       status: 'confirmed' },
      { id: 'non_delivery_contract_checked', status: 'confirmed' },
      { id: 'ledger_generated',              status: 'confirmed' },
      { id: 'real_invites_blocked',          status: 'confirmed' },
      { id: 'final_no_delivery_confirmed',   status: 'confirmed' },
    ],
  }
}

export function buildInvitationSimulationSummary(input = {}, options = {}) {
  return {
    status: 'blocked_simulation_only',
    headline: 'Convites de beta privado simulados sem entrega.',
    summary_text: 'Nenhum convite real, usuário real, email ou webhook foi criado.',
    simulated_invites_count: 3,
    real_invites_created: false,
    users_created: false,
    emails_sent: false,
    webhooks_sent: false,
    delivery_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function evaluatePrivateBetaInvitationSimulation(input = {}, options = {}) {
  return {
    invitation_channel_policy: buildInvitationChannelPolicy(input, options),
    private_beta_invitation_simulation: buildPrivateBetaInvitationSimulation(input, options),
    simulated_invitation_ledger: buildSimulatedInvitationLedger(input, options),
    invitation_simulation_audit: buildInvitationSimulationAudit(input, options),
    invitation_simulation_summary: buildInvitationSimulationSummary(input, options),
  }
}
