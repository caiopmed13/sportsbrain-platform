// src/services/nonUserCohortContract.js
// P3.8.27 — Non-User Cohort Contract, Synthetic Members & Safety Enforcement

const CONTRACT_VERSION = 'p3.8.27'

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeCohortBoolean(value) {
  return value === true
}

// ── Contract ──────────────────────────────────────────────────────────────────

export function buildNonUserCohortContract(input = {}, options = {}) {
  const unsafeRealUsers    = input.real_users === true
  const unsafePersonalData = input.personal_data_allowed === true
  const unsafeInputSanitized = unsafeRealUsers || unsafePersonalData

  return {
    status:                          'enforced',
    contract_version:                CONTRACT_VERSION,
    simulation_only:                 true,
    real_users_allowed:              false,   // ALWAYS false
    real_emails_allowed:             false,   // ALWAYS false
    real_accounts_allowed:           false,   // ALWAYS false
    personal_data_allowed:           false,   // ALWAYS false
    cohort_members_are_synthetic:    true,
    cohort_size:                     3,
    can_be_converted_to_real_users_now: false, // ALWAYS false
    requires_future_phase_to_change: true,
    unsafe_input_sanitized:          unsafeInputSanitized,
  }
}

// ── Members ───────────────────────────────────────────────────────────────────

export function buildNonUserCohortMembers(input = {}, options = {}) {
  const inputMembers = Array.isArray(input.members) ? input.members : []
  const hasEmailInInput = inputMembers.some(m => m != null && m.email != null && m.email !== '')

  const members = [
    {
      member_id:                    'sim-cohort-001',
      type:                         'synthetic_non_user',
      email:                        null,   // ALWAYS null
      user_id:                      null,   // ALWAYS null
      real_user:                    false,  // ALWAYS false
      eligible_for_real_delivery:   false,  // ALWAYS false
      notes:                        'Synthetic placeholder only.',
    },
    {
      member_id:                    'sim-cohort-002',
      type:                         'synthetic_non_user',
      email:                        null,
      user_id:                      null,
      real_user:                    false,
      eligible_for_real_delivery:   false,
      notes:                        'Synthetic placeholder only.',
    },
    {
      member_id:                    'sim-cohort-003',
      type:                         'synthetic_non_user',
      email:                        null,
      user_id:                      null,
      real_user:                    false,
      eligible_for_real_delivery:   false,
      notes:                        'Synthetic placeholder only.',
    },
  ]

  return {
    status:                  'generated',
    simulation_only:         true,
    members_count:           3,
    unsafe_input_sanitized:  hasEmailInInput,
    members,
  }
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function buildNonUserCohortAudit(input = {}, options = {}) {
  const entries = [
    { id: 'cohort_contract_built',            status: 'confirmed' },
    { id: 'synthetic_members_generated',      status: 'confirmed' },
    { id: 'real_users_blocked',               status: 'confirmed' },
    { id: 'real_emails_blocked',              status: 'confirmed' },
    { id: 'personal_data_blocked',            status: 'confirmed' },
    { id: 'conversion_to_real_users_blocked', status: 'confirmed' },
  ]

  return {
    status:          'recorded',
    simulation_only: true,
    entries_count:   entries.length,
    entries,
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function buildNonUserCohortSummary(input = {}, options = {}) {
  return {
    status:               'safe',
    headline:             'Coorte não-usuário ativa para simulação.',
    summary_text:         'A coorte contém apenas placeholders sintéticos e não pode receber entrega real.',
    members_count:        3,
    real_users:           false,  // ALWAYS false
    real_emails:          false,  // ALWAYS false
    safe_for_simulation:  true,
    safe_for_real_invites: false, // ALWAYS false
    safe_to_sell:         false,  // ALWAYS false
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateNonUserCohortContract(input = {}, options = {}) {
  const safeInput = input ?? {}

  const non_user_cohort_contract = buildNonUserCohortContract(safeInput, options)
  const non_user_cohort_members  = buildNonUserCohortMembers(safeInput, options)
  const non_user_cohort_audit    = buildNonUserCohortAudit(safeInput, options)
  const non_user_cohort_summary  = buildNonUserCohortSummary(safeInput, options)

  // Propagate unsafe_input_sanitized from members back into contract if needed
  if (non_user_cohort_members.unsafe_input_sanitized && !non_user_cohort_contract.unsafe_input_sanitized) {
    non_user_cohort_contract.unsafe_input_sanitized = true
  }

  return {
    non_user_cohort_contract,
    non_user_cohort_members,
    non_user_cohort_audit,
    non_user_cohort_summary,
  }
}
