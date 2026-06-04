// src/services/releaseFreezeBaseline.js
// P3.8.24 — Release Freeze Baseline Registry & Audit

export const BASELINE_VERSION = 'p3.8.24'

export const BASELINE_FLAGS = Object.freeze({
  can_beta:                      false,
  can_sell:                      false,
  can_start_private_beta:        false,
  can_start_public_beta:         false,
  download_enabled:              false,
  download_publicly_available:   false,
  archive_persistence_enabled:   false,
  archive_download_enabled:      false,
  storage_enabled:               false,
  storage_write_enabled:         false,
  database_write_enabled:        false,
  real_users:                    false,
  real_delivery:                 false,
  checkout_enabled:              false,
  pricing_enabled:               false,
  webhook_enabled:               false,
  email_delivery_enabled:        false,
  commercial_claims_allowed:     false,
  unfreeze_enabled:              false,
})

export const FROZEN_CAPABILITIES = Object.freeze([
  'beta',
  'sell',
  'private_beta',
  'public_beta',
  'download',
  'public_export',
  'archive_persistence',
  'storage_write',
  'database_write',
  'real_users',
  'real_delivery',
  'checkout',
  'pricing',
  'webhook',
  'email_delivery',
  'commercial_claims',
  'unfreeze',
])

export function normalizeBaselineBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

export function buildReleaseFreezeBaselineRegistry(input = {}, options = {}) {
  const warnings = []

  // Detect any truthy input flags that are in BASELINE_FLAGS
  for (const flag of Object.keys(BASELINE_FLAGS)) {
    if (normalizeBaselineBoolean(input[flag])) {
      warnings.push({ flag, input_value: input[flag], expected_value: false, severity: 'warning' })
    }
  }

  // Status escalation
  let status = 'registered'
  if (input.release_freeze_sentinel?.passed === false ||
      input.immutable_no_sell_enforcement?.status === 'critical_violation') {
    status = 'critical_violation'
  } else if (warnings.length > 0) {
    status = 'registered_with_warnings'
  }

  const frozen_capabilities = FROZEN_CAPABILITIES.map(code => ({
    code,
    frozen:                 true,
    expected_value:         false,
    current_value:          false,
    severity:               'blocker',
    can_be_unfrozen_now:    false,
    requires_future_phase:  true,
  }))

  const result = {
    status,
    registry_version:                 BASELINE_VERSION,
    simulation_only:                  true,
    persistence_enabled:              false,
    baseline_id:                      `release-freeze-baseline-${BASELINE_VERSION}`,
    baseline_locked:                  true,
    can_be_modified_now:              false,
    requires_future_phase_to_modify:  true,
    source:                           'runtime',
    frozen_capabilities,
    baseline_flags:                   { ...BASELINE_FLAGS },
  }

  if (status === 'registered_with_warnings') {
    result.warnings = warnings
  }

  return result
}

export function buildBaselineComparisonReport(input = {}, options = {}) {
  const mismatches = []

  for (const flag of Object.keys(BASELINE_FLAGS)) {
    const inputValue = normalizeBaselineBoolean(input[flag])
    if (inputValue) {
      // baseline is always false; if input is true → critical mismatch
      mismatches.push({
        flag,
        baseline_value: false,
        input_value:    inputValue,
        critical:       true,
      })
    }
  }

  const mismatches_count          = mismatches.length
  const critical_mismatches_count = mismatches.filter(m => m.critical).length
  const matched                   = mismatches_count === 0
  const status                    = matched ? 'matched' : 'critical_mismatch'

  return {
    status,
    matched,
    checked_flags_count:      Object.keys(BASELINE_FLAGS).length,
    mismatches_count,
    critical_mismatches_count,
    mismatches,
    warnings:                 [],
    blockers:                 matched ? [] : [`critical_mismatches: ${critical_mismatches_count}`],
  }
}

export function buildFreezeBaselineAudit(input = {}, options = {}) {
  const entries = [
    { entry_id: 'baseline_registry_built',        status: 'recorded' },
    { entry_id: 'frozen_capabilities_checked',    status: 'recorded' },
    { entry_id: 'baseline_flags_checked',         status: 'recorded' },
    { entry_id: 'comparison_completed',           status: 'recorded' },
    { entry_id: 'release_freeze_sentinel_checked', status: 'recorded' },
    { entry_id: 'no_unfreeze_confirmed',          status: 'recorded' },
  ]

  return {
    status:          'recorded',
    simulation_only: true,
    entries_count:   entries.length,
    entries,
  }
}

export function buildFreezeRegistrySummary(input = {}, options = {}) {
  // Build comparison inline to determine mismatch counts
  const comparison = buildBaselineComparisonReport(input, options)

  const baseline_matched          = comparison.matched
  const critical_mismatches_count = comparison.critical_mismatches_count
  const status                    = baseline_matched ? 'locked' : 'locked_with_violations'

  return {
    status,
    headline:                 'Release freeze baseline registrado.',
    summary_text:             'O baseline de freeze permanece ativo e não pode ser modificado nesta fase.',
    baseline_matched,
    frozen_capabilities_count: FROZEN_CAPABILITIES.length,
    critical_mismatches_count,
    can_unfreeze_now:          false,
    can_beta:                  false,
    can_sell:                  false,
    next_action:               'Manter freeze ativo até fase futura de design controlado.',
  }
}

export function evaluateReleaseFreezeBaseline(input = {}, options = {}) {
  return {
    release_freeze_baseline_registry: buildReleaseFreezeBaselineRegistry(input, options),
    baseline_comparison_report:       buildBaselineComparisonReport(input, options),
    freeze_baseline_audit:            buildFreezeBaselineAudit(input, options),
    freeze_registry_summary:          buildFreezeRegistrySummary(input, options),
  }
}
