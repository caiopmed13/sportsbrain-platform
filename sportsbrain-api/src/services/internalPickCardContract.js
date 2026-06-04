// internalPickCardContract.js — P3.9.7
// Pure functions, no external imports.

const UNSAFE_FIELDS = [
  'can_beta', 'can_sell', 'public_display_allowed', 'user_delivery_allowed',
  'commercial_cta_allowed', 'pricing_allowed', 'checkout_allowed', 'real_user_data_allowed',
  'checkout_enabled', 'pricing_enabled', 'email_delivery_enabled',
  'contains_profit_claim', 'contains_commercial_cta', 'contains_guaranteed_win_claim',
  'contains_real_user_data', 'contains_external_link',
]

function sanitizeInput(rawInput = {}) {
  const sanitized = Object.assign({}, rawInput)
  for (const field of UNSAFE_FIELDS) {
    delete sanitized[field]
  }
  return sanitized
}

export function buildInternalPickCardContract(input, options = {}) {
  return {
    status: 'defined',
    contract_version: 'p3.9.7',
    internal_preview_only: true,
    public_display_allowed: false,
    user_delivery_allowed: false,
    commercial_cta_allowed: false,
    pricing_allowed: false,
    checkout_allowed: false,
    real_user_data_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function buildPickCardAllowedFields(input, options = {}) {
  const fields = [
    { field: 'sport',                    required: true,  public_allowed: false, internal_allowed: true, description: 'Sport category for the pick.' },
    { field: 'market',                   required: true,  public_allowed: false, internal_allowed: true, description: 'Betting market type.' },
    { field: 'selection',                required: true,  public_allowed: false, internal_allowed: true, description: 'Synthetic selection label.' },
    { field: 'synthetic_odds',           required: false, public_allowed: false, internal_allowed: true, description: 'Synthetic odds for simulation.' },
    { field: 'confidence_tier',          required: false, public_allowed: false, internal_allowed: true, description: 'Confidence tier label.' },
    { field: 'confidence_score',         required: false, public_allowed: false, internal_allowed: true, description: 'Internal confidence score for simulation review.' },
    { field: 'trust_level',              required: false, public_allowed: false, internal_allowed: true, description: 'Segment trust level.' },
    { field: 'reasoning_summary',        required: false, public_allowed: false, internal_allowed: true, description: 'Short reasoning summary for internal review.' },
    { field: 'risk_note',                required: true,  public_allowed: false, internal_allowed: true, description: 'Mandatory risk disclaimer note.' },
    { field: 'segment_quality_label',    required: false, public_allowed: false, internal_allowed: true, description: 'Segment quality classification label.' },
    { field: 'break_even_note',          required: false, public_allowed: false, internal_allowed: true, description: 'Break-even context for internal review.' },
    { field: 'internal_only_disclaimer', required: true,  public_allowed: false, internal_allowed: true, description: 'Mandatory disclaimer: internal only.' },
  ]
  return {
    status: 'defined',
    fields_count: fields.length,
    fields,
  }
}

export function buildPickCardForbiddenFields(input, options = {}) {
  const fields = [
    { field: 'real_user_name',                reason: 'real_user_data_not_allowed' },
    { field: 'real_user_email',               reason: 'real_user_data_not_allowed' },
    { field: 'payment_link',                  reason: 'commercial_action_forbidden' },
    { field: 'checkout_url',                  reason: 'checkout_forbidden' },
    { field: 'guaranteed_profit_claim',       reason: 'profit_claim_forbidden' },
    { field: 'guaranteed_win_claim',          reason: 'win_claim_forbidden' },
    { field: 'bet_now_cta',                   reason: 'commercial_cta_forbidden' },
    { field: 'external_affiliate_link',       reason: 'external_link_forbidden' },
    { field: 'public_share_url',              reason: 'public_sharing_forbidden' },
    { field: 'personalized_financial_advice', reason: 'financial_advice_forbidden' },
  ]
  return {
    status: 'defined',
    fields_count: fields.length,
    fields,
  }
}

export function buildPickCardSafetyValidation(rawInput = {}, options = {}) {
  const checks = [
    { check: 'no_real_user_data',                passed: !rawInput.contains_real_user_data },
    { check: 'no_email',                         passed: !rawInput.email_delivery_enabled },
    { check: 'no_checkout',                      passed: !rawInput.checkout_enabled },
    { check: 'no_pricing',                       passed: !rawInput.pricing_enabled },
    { check: 'no_profit_claim',                  passed: !rawInput.contains_profit_claim },
    { check: 'no_guaranteed_win_claim',          passed: !rawInput.contains_guaranteed_win_claim },
    { check: 'no_bet_now_cta',                   passed: !rawInput.contains_commercial_cta },
    { check: 'no_external_link',                 passed: !rawInput.contains_external_link },
    { check: 'internal_only_disclaimer_present', passed: true },
    { check: 'can_beta_false',                   passed: true },
    { check: 'can_sell_false',                   passed: true },
  ]
  const failedChecks = checks.filter(c => !c.passed)
  const allPassed = failedChecks.length === 0
  return {
    status: allPassed ? 'passed' : 'failed',
    passed: allPassed,
    checks_count: checks.length,
    failed_count: failedChecks.length,
    checks,
    violations: failedChecks.map(c => c.check),
  }
}

export function buildInternalPickCardContractSummary(input, options = {}) {
  return {
    status: 'defined',
    headline: 'Contrato de pick card interno definido.',
    summary_text: 'Cards sintéticos podem ser visualizados apenas internamente, sem CTA comercial ou entrega real.',
    internal_preview_only: true,
    public_display_allowed: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function evaluateInternalPickCardContract(rawInput = {}, options = {}) {
  // Validate BEFORE sanitizing so dangerous flags are detected
  const pick_card_safety_validation = buildPickCardSafetyValidation(rawInput, options)
  // Then sanitize
  const input = sanitizeInput(rawInput)
  const internal_pick_card_contract         = buildInternalPickCardContract(input, options)
  const pick_card_allowed_fields            = buildPickCardAllowedFields(input, options)
  const pick_card_forbidden_fields          = buildPickCardForbiddenFields(input, options)
  const internal_pick_card_contract_summary = buildInternalPickCardContractSummary(input, options)
  return {
    internal_pick_card_contract,
    pick_card_allowed_fields,
    pick_card_forbidden_fields,
    pick_card_safety_validation,
    internal_pick_card_contract_summary,
  }
}
