// src/services/safetyInvariantSnapshot.js
// P3.8.24 — Safety Invariant Snapshot, Validation & Summary

export const SNAPSHOT_VERSION = 'p3.8.24'

// ── Invariant Definitions ─────────────────────────────────────────────────────

const INVARIANTS = [
  { code: 'can_beta_false',                     flag: 'can_beta',                     category: 'beta',        severity: 'blocker' },
  { code: 'can_sell_false',                     flag: 'can_sell',                     category: 'commercial',  severity: 'blocker' },
  { code: 'can_start_private_beta_false',       flag: 'can_start_private_beta',       category: 'beta',        severity: 'blocker' },
  { code: 'can_start_public_beta_false',        flag: 'can_start_public_beta',        category: 'beta',        severity: 'blocker' },
  { code: 'safe_to_invite_private_users_false', flag: 'safe_to_invite_private_users', category: 'beta',        severity: 'blocker' },
  { code: 'safe_to_open_public_beta_false',     flag: 'safe_to_open_public_beta',     category: 'beta',        severity: 'blocker' },
  { code: 'safe_to_sell_false',                 flag: 'safe_to_sell',                 category: 'commercial',  severity: 'blocker' },
  { code: 'real_users_false',                   flag: 'real_users',                   category: 'delivery',    severity: 'blocker' },
  { code: 'real_delivery_false',                flag: 'real_delivery',                category: 'delivery',    severity: 'blocker' },
  { code: 'release_allowed_false',              flag: 'release_allowed',              category: 'governance',  severity: 'blocker' },
  { code: 'download_enabled_false',             flag: 'download_enabled',             category: 'download',    severity: 'blocker' },
  { code: 'download_publicly_available_false',  flag: 'download_publicly_available',  category: 'download',    severity: 'blocker' },
  { code: 'public_export_enabled_false',        flag: 'public_export_enabled',        category: 'export',      severity: 'blocker' },
  { code: 'physical_file_created_false',        flag: 'physical_file_created',        category: 'storage',     severity: 'blocker' },
  { code: 'archive_persistence_enabled_false',  flag: 'archive_persistence_enabled',  category: 'storage',     severity: 'blocker' },
  { code: 'archive_download_enabled_false',     flag: 'archive_download_enabled',     category: 'download',    severity: 'blocker' },
  { code: 'storage_enabled_false',              flag: 'storage_enabled',              category: 'storage',     severity: 'blocker' },
  { code: 'storage_write_enabled_false',        flag: 'storage_write_enabled',        category: 'storage',     severity: 'blocker' },
  { code: 'database_write_enabled_false',       flag: 'database_write_enabled',       category: 'storage',     severity: 'blocker' },
  { code: 'checkout_enabled_false',             flag: 'checkout_enabled',             category: 'commercial',  severity: 'blocker' },
  { code: 'pricing_enabled_false',              flag: 'pricing_enabled',              category: 'commercial',  severity: 'blocker' },
  { code: 'webhook_enabled_false',              flag: 'webhook_enabled',              category: 'delivery',    severity: 'blocker' },
  { code: 'email_delivery_enabled_false',       flag: 'email_delivery_enabled',       category: 'delivery',    severity: 'blocker' },
  { code: 'commercial_claims_allowed_false',    flag: 'commercial_claims_allowed',    category: 'claims',      severity: 'blocker' },
  { code: 'unfreeze_enabled_false',             flag: 'unfreeze_enabled',             category: 'unfreeze',    severity: 'blocker' },
  { code: 'controlled_unfreeze_active_false',   flag: 'controlled_unfreeze_active',   category: 'unfreeze',    severity: 'blocker' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

// ── collectSafetyInvariantValues ──────────────────────────────────────────────

export function collectSafetyInvariantValues(input = {}, options = {}) {
  const values = {}
  for (const inv of INVARIANTS) {
    values[inv.code] = normalizeFlag(input[inv.flag])
  }
  return values
}

// ── buildSafetyInvariantSnapshot ─────────────────────────────────────────────

export function buildSafetyInvariantSnapshot(input = {}, options = {}) {
  const values = collectSafetyInvariantValues(input, options)

  const invariants = INVARIANTS.map(inv => {
    const actual = values[inv.code]
    const passed = actual === false
    return {
      code:     inv.code,
      expected: false,
      actual,
      passed,
      severity: inv.severity,
      category: inv.category,
    }
  })

  const allPassed       = invariants.every(i => i.passed)
  const failedCount     = invariants.filter(i => !i.passed).length
  const criticalFailures = invariants.filter(i => !i.passed).map(i => i.code)

  return {
    status:            allPassed ? 'captured' : 'captured_with_failures',
    snapshot_version:  SNAPSHOT_VERSION,
    simulation_only:   true,
    invariants_count:  INVARIANTS.length,
    invariants,
    all_passed:        allPassed,
    failed_count:      failedCount,
    critical_failures: criticalFailures,
  }
}

// ── validateSafetyInvariantSnapshot ──────────────────────────────────────────

export function validateSafetyInvariantSnapshot(input = {}, options = {}) {
  const snapshot = input.safety_invariant_snapshot ?? buildSafetyInvariantSnapshot(input, options)

  const blockerInvariants = (snapshot.invariants ?? []).filter(i => i.severity === 'blocker' && !i.passed)
  const blockers          = blockerInvariants.map(i => i.code)
  const passed            = blockers.length === 0

  return {
    status:      passed ? 'passed' : 'failed',
    passed,
    failed_count: blockers.length,
    warnings:    [],
    blockers,
  }
}

// ── buildSafetyInvariantSummary ───────────────────────────────────────────────

export function buildSafetyInvariantSummary(input = {}, options = {}) {
  const snapshot = input.safety_invariant_snapshot ?? buildSafetyInvariantSnapshot(input, options)

  const invariants = snapshot.invariants ?? []

  function categoryAllPassed(category) {
    const catInvariants = invariants.filter(i => i.category === category)
    return catInvariants.length === 0 || catInvariants.every(i => i.passed)
  }

  const allPassed        = snapshot.all_passed ?? invariants.every(i => i.passed)
  const commercialLocked = categoryAllPassed('commercial')
  const betaLocked       = categoryAllPassed('beta')
  const downloadLocked   = categoryAllPassed('download')
  const storageLocked    = categoryAllPassed('storage')
  const unfreezeLocked   = categoryAllPassed('unfreeze')

  return {
    status:                        allPassed ? 'safe' : 'unsafe',
    headline:                      allPassed
      ? 'Invariantes de segurança preservadas.'
      : 'Falha em invariantes de segurança detectada.',
    commercial_locked:             commercialLocked,
    beta_locked:                   betaLocked,
    download_locked:               downloadLocked,
    storage_locked:                storageLocked,
    unfreeze_locked:               unfreezeLocked,
    safe_to_sell:                  false,   // ALWAYS false
    safe_to_invite_private_users:  false,   // ALWAYS false
  }
}

// ── evaluateSafetyInvariantSnapshot ──────────────────────────────────────────

export function evaluateSafetyInvariantSnapshot(input = {}, options = {}) {
  const safeInput = input ?? {}

  const safety_invariant_snapshot   = buildSafetyInvariantSnapshot(safeInput, options)
  const safety_invariant_validation  = validateSafetyInvariantSnapshot(
    { ...safeInput, safety_invariant_snapshot },
    options
  )
  const safety_invariant_summary     = buildSafetyInvariantSummary(
    { ...safeInput, safety_invariant_snapshot },
    options
  )

  return {
    safety_invariant_snapshot,
    safety_invariant_validation,
    safety_invariant_summary,
  }
}
