// src/services/regressionLockdown.js
// P3.8.18 — Regression Lockdown
// Hard runtime checks to prevent any accidental release, beta, sell, or commercial claim.

const LOCKDOWN_VERSION = 'p3.8.18'

// ── Violation Collector ───────────────────────────────────────────────────────

export function collectLockdownViolations(input = {}, options = {}) {
  const FORBIDDEN_FLAT = [
    'download_enabled', 'download_publicly_available', 'physical_file_created',
    'webhook_enabled', 'email_enabled', 'can_beta', 'can_sell', 'release_allowed',
    'export_allows_beta', 'export_allows_sell', 'commercial_claims_allowed',
  ]
  return FORBIDDEN_FLAT
    .filter(f => input[f] === true || input[f] === 'true')
    .map(f => ({ field: f, value: true, severity: 'blocker' }))
}

// ── Lockdown Checks ───────────────────────────────────────────────────────────

export function buildRegressionLockdownChecks(input = {}, options = {}) {
  const checks = []

  function checkFalse(code, rawValue) {
    const actual = rawValue === true || rawValue === 'true'
    checks.push({ code, passed: !actual, severity: 'blocker', expected: false, actual })
  }

  // ── Flat field checks ─────────────────────────────────────────────────────
  checkFalse('download_not_enabled',         input.download_enabled)
  checkFalse('public_download_not_available', input.download_publicly_available)
  checkFalse('physical_file_not_created',    input.physical_file_created)
  checkFalse('webhook_not_enabled',          input.webhook_enabled)
  checkFalse('email_not_enabled',            input.email_enabled)
  checkFalse('can_beta_false',               input.can_beta)
  checkFalse('can_sell_false',               input.can_sell)
  checkFalse('release_allowed_false',        input.release_allowed)
  checkFalse('export_allows_beta_false',     input.export_allows_beta)
  checkFalse('export_allows_sell_false',     input.export_allows_sell)
  checkFalse('claims_not_allowed',           input.commercial_claims_allowed)

  // ── Nested checks ─────────────────────────────────────────────────────────

  // claims_not_detected — commercial_claims_guard.claims_detected must not be true
  const claimsDetected = input.commercial_claims_guard?.claims_detected === true
  checks.push({
    code:     'claims_not_detected',
    passed:   !claimsDetected,
    severity: 'blocker',
    expected: false,
    actual:   claimsDetected,
  })

  // snapshot_persistence_disabled — persistence must not be enabled
  const persistenceEnabled = input.historical_snapshot_simulation?.persistence_enabled === true
  checks.push({
    code:     'snapshot_persistence_disabled',
    passed:   !persistenceEnabled,
    severity: 'blocker',
    expected: false,
    actual:   persistenceEnabled,
  })

  // no_launch_lock_enabled — hard_lock_enabled must not be explicitly false
  const hardLockExplicitlyDisabled = input.no_launch_governance?.hard_lock_enabled === false
  checks.push({
    code:     'no_launch_lock_enabled',
    passed:   !hardLockExplicitlyDisabled,
    severity: 'blocker',
    expected: true,
    actual:   !hardLockExplicitlyDisabled,
  })

  // governance_regression_passed — governance suite must not have explicitly failed
  const regressionExplicitlyFailed = input.governance_regression_suite?.passed === false
  checks.push({
    code:     'governance_regression_passed',
    passed:   !regressionExplicitlyFailed,
    severity: 'blocker',
    expected: true,
    actual:   !regressionExplicitlyFailed,
  })

  return checks
}

// ── Lockdown Builder ──────────────────────────────────────────────────────────

export function buildRegressionLockdown(input = {}, options = {}) {
  const checks      = buildRegressionLockdownChecks(input, options)
  const failedChecks = checks.filter(c => !c.passed)
  const passed       = failedChecks.length === 0

  return {
    status:            passed ? 'locked' : 'failed',
    passed,
    lockdown_version:  LOCKDOWN_VERSION,
    checks_count:      checks.length,
    failed_count:      failedChecks.length,
    critical_failures: failedChecks.map(c => ({
      code:     c.code,
      severity: c.severity,
      actual:   c.actual,
      expected: c.expected,
    })),
    checks,
    hard_fail_on_regression: true,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateRegressionLockdown(input = {}, options = {}) {
  const lockdown = buildRegressionLockdown(input, options)
  return { regression_lockdown: lockdown }
}
