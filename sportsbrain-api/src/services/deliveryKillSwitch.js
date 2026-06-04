// deliveryKillSwitch.js
// Pure functions — no imports, no DB, no side effects.
// KILL_SWITCH_VERSION: p3.8.27

const KILL_SWITCH_VERSION = 'p3.8.27'

export function normalizeKillSwitchBoolean(value) {
  return value === true
}

export function buildDeliveryKillSwitch(input = {}, options = {}) {
  const deliveryAttempted =
    input.real_delivery === true ||
    input.email_delivery_enabled === true ||
    input.webhook_enabled === true ||
    input.private_beta_delivery_enabled === true ||
    input.dm_delivery_enabled === true ||
    input.paid_access_enabled === true

  const status = deliveryAttempted ? 'triggered' : 'armed'

  return {
    status,
    kill_switch_version: KILL_SWITCH_VERSION,
    global_delivery_disabled: true,
    can_be_disabled_now: false,
    real_delivery_allowed: false,
    invitation_delivery_allowed: false,
    pick_delivery_allowed: false,
    email_delivery_allowed: false,
    webhook_delivery_allowed: false,
    dm_delivery_allowed: false,
    public_posting_allowed: false,
    paid_access_allowed: false,
    hard_fail_on_delivery_attempt: true,
    delivery_attempt_detected: deliveryAttempted,
  }
}

export function buildChannelKillSwitchMatrix(input = {}, options = {}) {
  const channelDefs = [
    { channel: 'email',             attempted: input.email_delivery_enabled === true },
    { channel: 'webhook',           attempted: input.webhook_enabled === true },
    { channel: 'dm',                attempted: input.dm_delivery_enabled === true },
    { channel: 'sms',               attempted: false },
    { channel: 'public_page',       attempted: input.public_posting_enabled === true },
    { channel: 'paid_access',       attempted: input.paid_access_enabled === true },
    { channel: 'manual_copy',       attempted: false },
    { channel: 'api_delivery',      attempted: input.real_delivery === true },
    { channel: 'push_notification', attempted: false },
  ]

  const channels = channelDefs.map(({ channel, attempted }) => ({
    channel,
    locked: true,
    allowed: false,
    attempted,
    triggered: attempted,
    severity: 'blocker',
  }))

  return {
    status: 'locked',
    channels_count: 9,
    channels,
  }
}

export function buildDeliveryKillSwitchAudit(input = {}, options = {}) {
  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: 7,
    entries: [
      { id: 'global_kill_switch_armed',     status: 'confirmed' },
      { id: 'channel_matrix_built',         status: 'confirmed' },
      { id: 'delivery_attempts_checked',    status: 'confirmed' },
      { id: 'all_channels_locked',          status: 'confirmed' },
      { id: 'real_delivery_blocked',        status: 'confirmed' },
      { id: 'invitation_delivery_blocked',  status: 'confirmed' },
      { id: 'pick_delivery_blocked',        status: 'confirmed' },
    ],
  }
}

export function buildDeliveryKillSwitchSummary(input = {}, options = {}) {
  return {
    status: 'armed',
    headline: 'Kill-switch de entrega ativo.',
    summary_text: 'Todos os canais reais de convite e entrega permanecem bloqueados.',
    delivery_allowed: false,
    real_delivery_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function evaluateDeliveryKillSwitch(input = {}, options = {}) {
  return {
    delivery_kill_switch:         buildDeliveryKillSwitch(input, options),
    channel_kill_switch_matrix:   buildChannelKillSwitchMatrix(input, options),
    delivery_kill_switch_audit:   buildDeliveryKillSwitchAudit(input, options),
    delivery_kill_switch_summary: buildDeliveryKillSwitchSummary(input, options),
  }
}
