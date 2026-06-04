// syntheticDeliveryUxContract.js
// P3.9.6 — Synthetic Delivery UX Contract
// Pure functions only. No external imports.

const UNSAFE_FIELDS = [
  'can_beta', 'can_sell', 'allows_real_delivery', 'allows_real_users',
  'delivery_allowed', 'real_delivery', 'real_users',
  'email_delivery_enabled', 'webhook_enabled', 'checkout_enabled', 'pricing_enabled',
  'synthetic_delivery_allows_real_users', 'synthetic_delivery_allows_real_delivery'
]

function sanitizeInput(rawInput) {
  const safe = Object.assign({}, rawInput)
  for (const field of UNSAFE_FIELDS) {
    delete safe[field]
  }
  return safe
}

export function buildSyntheticDeliveryUxContract(input, violations, options = {}) {
  const hasViolations = violations.length > 0
  return {
    status: hasViolations ? 'critical_violation' : 'defined',
    contract_version: 'p3.9.6',
    simulation_only: true,
    synthetic_delivery_only: true,
    allows_real_users: false,
    allows_real_delivery: false,
    allows_email: false,
    allows_webhook: false,
    allows_public_page: false,
    allows_paid_access: false,
    internal_preview_only: true,
    requires_future_phase_for_real_delivery: true,
    synthetic_delivery_allows_real_users: false,
    synthetic_delivery_allows_real_delivery: false,
    violations: hasViolations ? violations : [],
  }
}

export function buildSyntheticDeliveryChannelMatrix(input, options = {}) {
  const channels = [
    { channel: 'internal_preview',  synthetic_allowed: true,  real_allowed: false, locked: false, reason: 'internal_simulation_only' },
    { channel: 'email',             synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'webhook',           synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'sms',               synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'dm',                synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'public_page',       synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'api_delivery',      synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'push_notification', synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'paid_access',       synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
    { channel: 'manual_copy',       synthetic_allowed: false, real_allowed: false, locked: true,  reason: 'real_channel_blocked' },
  ]
  return {
    status: 'locked',
    channels_count: channels.length,
    channels,
  }
}

export function buildSyntheticUxArtifacts(input, options = {}) {
  const artifacts = [
    { artifact: 'simulated_pick_card',       description: 'Internal-only preview of how a pick card could look.',    internal_only: true, public: false, contains_real_user_data: false, contains_real_delivery: false },
    { artifact: 'simulated_reasoning_panel', description: 'Internal preview of reasoning/confidence breakdown.',     internal_only: true, public: false, contains_real_user_data: false, contains_real_delivery: false },
    { artifact: 'simulated_result_history',  description: 'Internal preview of result history visualization.',       internal_only: true, public: false, contains_real_user_data: false, contains_real_delivery: false },
    { artifact: 'simulated_risk_disclaimer', description: 'Required disclaimer to be shown in any beta simulation.', internal_only: true, public: false, contains_real_user_data: false, contains_real_delivery: false },
    { artifact: 'simulated_feedback_form',   description: 'Internal-only simulated feedback form for QA purposes.',  internal_only: true, public: false, contains_real_user_data: false, contains_real_delivery: false },
  ]
  return {
    status: 'generated',
    artifacts_count: artifacts.length,
    artifacts,
  }
}

export function buildSyntheticDeliveryUxSummary(input, options = {}) {
  return {
    status: 'defined',
    headline: 'Contrato de UX sintética definido.',
    summary_text: 'A simulação permite apenas preview interno; todos os canais reais continuam bloqueados.',
    internal_preview_allowed: true,
    real_delivery_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function evaluateSyntheticDeliveryUxContract(rawInput = {}, options = {}) {
  const violations = []
  for (const field of UNSAFE_FIELDS) {
    if (rawInput[field] === true) violations.push({ field, value: true, rejected: false })
  }
  const input = sanitizeInput(rawInput)
  const synthetic_delivery_ux_contract    = buildSyntheticDeliveryUxContract(input, violations, options)
  const synthetic_delivery_channel_matrix = buildSyntheticDeliveryChannelMatrix(input, options)
  const synthetic_ux_artifacts            = buildSyntheticUxArtifacts(input, options)
  const synthetic_delivery_ux_summary     = buildSyntheticDeliveryUxSummary(input, options)
  return {
    synthetic_delivery_ux_contract,
    synthetic_delivery_channel_matrix,
    synthetic_ux_artifacts,
    synthetic_delivery_ux_summary,
  }
}
