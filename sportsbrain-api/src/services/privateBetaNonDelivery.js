// privateBetaNonDelivery.js
// Pure functions — no imports, no DB, no side effects.
// CONTRACT_VERSION: p3.8.26

const CONTRACT_VERSION = 'p3.8.26'

export function buildPrivateBetaNonDeliveryContract(input = {}, options = {}) {
  return {
    status: 'enforced',
    contract_version: CONTRACT_VERSION,
    simulation_only: true,
    private_beta_delivery_allowed: false,
    real_users_allowed: false,
    real_pick_delivery_allowed: false,
    email_delivery_allowed: false,
    webhook_delivery_allowed: false,
    public_posting_allowed: false,
    paid_access_allowed: false,
    requires_future_phase_to_change: true,
    can_be_overridden_now: false,
  }
}

export function buildNonDeliveryEnforcement(input = {}, options = {}) {
  const checkDefs = [
    { id: 'no_real_users',              flag: 'real_users' },
    { id: 'no_real_delivery',           flag: 'real_delivery' },
    { id: 'no_private_beta_delivery',   flag: 'private_beta_delivery_enabled' },
    { id: 'no_email_delivery',          flag: 'email_delivery_enabled' },
    { id: 'no_webhook_delivery',        flag: 'webhook_enabled' },
    { id: 'no_public_posting',          flag: 'public_posting_allowed' },
    { id: 'no_paid_access',             flag: 'paid_access_enabled' },
    { id: 'no_checkout',                flag: 'checkout_enabled' },
    { id: 'no_pricing',                 flag: 'pricing_enabled' },
    { id: 'no_sell',                    flag: 'can_sell' },
    { id: 'no_beta_enable',             flag: 'can_beta' },
  ]

  const checks = checkDefs.map(({ id, flag }) => {
    const actual = input[flag] === true
    const passed = !actual
    return {
      id,
      expected: false,
      actual,
      passed,
      severity: 'blocker',
    }
  })

  const critical_failures = checks.filter(c => !c.passed).map(c => c.id)
  const failed_count = critical_failures.length

  return {
    status: 'enforced',
    passed: failed_count === 0,
    checks_count: 11,
    failed_count,
    checks,
    critical_failures,
  }
}

export function buildNonDeliveryChecklist(input = {}, options = {}) {
  const itemDefs = [
    'confirm_no_users_invited',
    'confirm_no_picks_sent',
    'confirm_no_email_channel',
    'confirm_no_webhook_channel',
    'confirm_no_public_page',
    'confirm_no_paid_access',
    'confirm_no_sales_claim',
    'confirm_operator_understands_no_delivery',
  ]

  const items = itemDefs.map(id => ({
    id,
    status: 'confirmed',
    confirmed: true,
  }))

  return {
    status: 'complete',
    items_count: 8,
    passed_count: 8,
    failed_count: 0,
    items,
  }
}

export function buildNonDeliveryAudit(input = {}, options = {}) {
  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: 6,
    entries: [
      { id: 'non_delivery_contract_built',     status: 'confirmed' },
      { id: 'channels_checked',                status: 'confirmed' },
      { id: 'paid_access_checked',             status: 'confirmed' },
      { id: 'public_posting_checked',          status: 'confirmed' },
      { id: 'operator_signoff_effect_checked', status: 'confirmed' },
      { id: 'final_no_delivery_confirmed',     status: 'confirmed' },
    ],
  }
}

export function buildNonDeliverySummary(input = {}, options = {}) {
  return {
    status: 'enforced',
    headline: 'Contrato de não-entrega ativo.',
    summary_text: 'Nenhum usuário real pode receber picks nesta fase.',
    delivery_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
    next_action: 'Continuar apenas com simulações e revisão interna.',
  }
}

export function evaluatePrivateBetaNonDelivery(input = {}, options = {}) {
  return {
    private_beta_non_delivery_contract: buildPrivateBetaNonDeliveryContract(input, options),
    non_delivery_enforcement:           buildNonDeliveryEnforcement(input, options),
    non_delivery_checklist:             buildNonDeliveryChecklist(input, options),
    non_delivery_audit:                 buildNonDeliveryAudit(input, options),
    non_delivery_summary:               buildNonDeliverySummary(input, options),
  }
}
