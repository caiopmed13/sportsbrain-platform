export const MATRIX_VERSION = 'p3.8.25'

// 16 capabilities with their classification
const CAPABILITIES = [
  { code: 'internal_download',              label: 'Internal admin download',       category: 'export',      classification: 'future_review_only' },
  { code: 'internal_storage',               label: 'Internal storage simulation',   category: 'storage',     classification: 'future_review_only' },
  { code: 'admin_report_archive',           label: 'Admin report archive',          category: 'export',      classification: 'future_review_only' },
  { code: 'manual_review_unlock',           label: 'Manual review unlock',          category: 'governance',  classification: 'future_review_only' },
  { code: 'private_beta_invite_simulation', label: 'Private beta invite simulation',category: 'beta',        classification: 'future_review_only' },
  { code: 'private_beta_real',              label: 'Private beta (real)',            category: 'beta',        classification: 'hard_blocked' },
  { code: 'public_beta',                    label: 'Public beta',                   category: 'beta',        classification: 'hard_blocked' },
  { code: 'sell',                           label: 'Sell / commercial',             category: 'commercial',  classification: 'hard_blocked' },
  { code: 'checkout',                       label: 'Checkout',                      category: 'commercial',  classification: 'hard_blocked' },
  { code: 'pricing',                        label: 'Pricing',                       category: 'commercial',  classification: 'hard_blocked' },
  { code: 'real_delivery',                  label: 'Real delivery',                 category: 'delivery',    classification: 'hard_blocked' },
  { code: 'webhook_delivery',               label: 'Webhook delivery',              category: 'delivery',    classification: 'hard_blocked' },
  { code: 'email_delivery',                 label: 'Email delivery',                category: 'delivery',    classification: 'hard_blocked' },
  { code: 'public_export',                  label: 'Public export',                 category: 'export',      classification: 'hard_blocked' },
  { code: 'claims',                         label: 'Commercial claims',             category: 'commercial',  classification: 'hard_blocked' },
  { code: 'unfreeze_control',               label: 'Unfreeze control',              category: 'governance',  classification: 'design_only' },
]

const RISK_TYPES = [
  'commercial_exposure',
  'public_distribution',
  'real_user_exposure',
  'compliance_claims',
  'financial_checkout',
  'data_persistence',
  'admin_abuse',
  'premature_beta',
]

/**
 * Normalize a value to boolean true only for true, 'true', 1, or '1'.
 */
export function normalizeCapabilityBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/**
 * Detect unsafe inputs in the provided input object.
 */
function detectUnsafeInputs(input) {
  const unsafe = []
  const checks = [
    { key: 'can_sell',         label: 'can_sell flag set — commercial unlock not permitted this phase' },
    { key: 'can_beta',         label: 'can_beta flag set — real beta unlock not permitted this phase' },
    { key: 'can_checkout',     label: 'can_checkout flag set — checkout unlock not permitted this phase' },
    { key: 'can_deliver',      label: 'can_deliver flag set — real delivery unlock not permitted this phase' },
    { key: 'can_publish',      label: 'can_publish flag set — public distribution not permitted this phase' },
  ]
  for (const { key, label } of checks) {
    if (input && normalizeCapabilityBoolean(input[key])) {
      unsafe.push(label)
    }
  }
  return unsafe
}

/**
 * Map classification to simulated_unlock_status and risk_level.
 */
function classificationToStatus(classification) {
  switch (classification) {
    case 'hard_blocked':       return { simulated_unlock_status: 'blocked',           risk_level: 'high' }
    case 'future_review_only': return { simulated_unlock_status: 'future_review_only', risk_level: 'medium' }
    case 'design_only':        return { simulated_unlock_status: 'design_only',        risk_level: 'low' }
    default:                   return { simulated_unlock_status: 'unknown',            risk_level: 'medium' }
  }
}

/**
 * Build the full capability unlock matrix.
 */
export function buildCapabilityUnlockMatrix(input = {}, options = {}) {
  const safetyBlockers = detectUnsafeInputs(input)
  const unsafeInputDetected = safetyBlockers.length > 0

  let futureReviewCount = 0
  let hardBlockedCount = 0
  let designOnlyCount = 0

  const capabilities = CAPABILITIES.map((cap) => {
    const { simulated_unlock_status, risk_level } = classificationToStatus(cap.classification)

    if (cap.classification === 'future_review_only') futureReviewCount++
    else if (cap.classification === 'hard_blocked') hardBlockedCount++
    else if (cap.classification === 'design_only') designOnlyCount++

    return {
      code: cap.code,
      label: cap.label,
      category: cap.category,
      current_state: 'frozen',
      simulated_unlock_status,
      unlockable_now: false,
      can_be_unlocked_this_phase: false,
      requires_future_phase: true,
      risk_level,
      preconditions_met: false,
      blockers: [],
      warnings: [],
      safe_output_value: false,
    }
  })

  const result = {
    status: 'evaluated',
    matrix_version: MATRIX_VERSION,
    simulation_only: true,
    capabilities_count: CAPABILITIES.length,
    unlockable_now_count: 0,
    future_review_count: futureReviewCount,
    hard_blocked_count: hardBlockedCount,
    design_only_count: designOnlyCount,
    capabilities,
  }

  if (unsafeInputDetected) {
    result.unsafe_input_detected = true
    result.safety_blockers = safetyBlockers
  }

  return result
}

/**
 * Build the capability risk profile.
 */
export function buildCapabilityRiskProfile(input = {}, options = {}) {
  const riskByCapability = [
    { code: 'commercial_exposure', level: 'high',   capabilities_affected: ['sell', 'checkout', 'pricing', 'claims'] },
    { code: 'public_distribution', level: 'high',   capabilities_affected: ['public_beta', 'public_export'] },
    { code: 'real_user_exposure',  level: 'high',   capabilities_affected: ['private_beta_real', 'real_delivery'] },
    { code: 'compliance_claims',   level: 'high',   capabilities_affected: ['claims'] },
    { code: 'financial_checkout',  level: 'high',   capabilities_affected: ['checkout', 'pricing'] },
    { code: 'data_persistence',    level: 'medium', capabilities_affected: ['internal_storage', 'admin_report_archive'] },
    { code: 'admin_abuse',         level: 'medium', capabilities_affected: ['internal_download', 'manual_review_unlock'] },
    { code: 'premature_beta',      level: 'high',   capabilities_affected: ['private_beta_real', 'public_beta'] },
  ]

  // Count risks from capabilities
  const caps = CAPABILITIES
  const highRiskCount  = caps.filter(c => classificationToStatus(c.classification).risk_level === 'high').length
  const mediumRiskCount = caps.filter(c => classificationToStatus(c.classification).risk_level === 'medium').length
  const lowRiskCount   = caps.filter(c => classificationToStatus(c.classification).risk_level === 'low').length

  return {
    status: 'evaluated',
    overall_risk: 'high',
    high_risk_count: highRiskCount,
    medium_risk_count: mediumRiskCount,
    low_risk_count: lowRiskCount,
    risk_by_capability: riskByCapability,
  }
}

/**
 * Build the capability unlock summary.
 */
export function buildCapabilityUnlockSummary(input = {}, options = {}) {
  const matrix = buildCapabilityUnlockMatrix(input, options)

  return {
    status: 'hold',
    headline: 'Nenhuma capacidade foi destravada.',
    summary_text: 'Todas as capacidades permanecem congeladas; algumas foram marcadas apenas para revisão futura.',
    unlockable_now_count: 0,
    future_review_count: matrix.future_review_count,
    hard_blocked_count: matrix.hard_blocked_count,
    can_unlock_any_now: false,
    safe_to_sell: false,
    safe_to_invite_private_users: false,
  }
}

/**
 * Evaluate the full capability unlock matrix, returning all three sub-reports.
 */
export function evaluateCapabilityUnlockMatrix(input = {}, options = {}) {
  return {
    capability_unlock_matrix: buildCapabilityUnlockMatrix(input, options),
    capability_risk_profile: buildCapabilityRiskProfile(input, options),
    capability_unlock_summary: buildCapabilityUnlockSummary(input, options),
  }
}
