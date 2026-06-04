// src/services/regressionLockdown.test.js
// P3.8.18 — 11 tests for Regression Lockdown

import assert from 'assert'
import {
  collectLockdownViolations,
  buildRegressionLockdownChecks,
  buildRegressionLockdown,
  evaluateRegressionLockdown,
} from './regressionLockdown.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('T1: safe empty input → status=locked, passed=true, failed_count=0', () => {
  const result = evaluateRegressionLockdown({})
  const rl     = result.regression_lockdown
  assert.strictEqual(rl.status,       'locked')
  assert.strictEqual(rl.passed,        true)
  assert.strictEqual(rl.failed_count,  0)
  assert.strictEqual(rl.hard_fail_on_regression, true)
})

test('T2: download_enabled=true → failed check download_not_enabled', () => {
  const result = evaluateRegressionLockdown({ download_enabled: true })
  const rl     = result.regression_lockdown
  assert.strictEqual(rl.passed, false)
  const check = rl.checks.find(c => c.code === 'download_not_enabled')
  assert.ok(check,                    'Expected download_not_enabled check')
  assert.strictEqual(check.passed,     false)
})

test('T3: download_publicly_available=true → failed check public_download_not_available', () => {
  const result = evaluateRegressionLockdown({ download_publicly_available: true })
  const rl     = result.regression_lockdown
  const check  = rl.checks.find(c => c.code === 'public_download_not_available')
  assert.ok(check,                   'Expected public_download_not_available check')
  assert.strictEqual(check.passed,    false)
})

test('T4: can_beta=true → failed check can_beta_false, status=failed', () => {
  const result = evaluateRegressionLockdown({ can_beta: true })
  const rl     = result.regression_lockdown
  assert.strictEqual(rl.status, 'failed')
  const check  = rl.checks.find(c => c.code === 'can_beta_false')
  assert.ok(check,                  'Expected can_beta_false check')
  assert.strictEqual(check.passed,   false)
})

test('T5: can_sell=true → failed check can_sell_false', () => {
  const result = evaluateRegressionLockdown({ can_sell: true })
  const rl     = result.regression_lockdown
  const check  = rl.checks.find(c => c.code === 'can_sell_false')
  assert.ok(check,                  'Expected can_sell_false check')
  assert.strictEqual(check.passed,   false)
})

test('T6: export_allows_beta=true → failed check export_allows_beta_false', () => {
  const result = evaluateRegressionLockdown({ export_allows_beta: true })
  const rl     = result.regression_lockdown
  const check  = rl.checks.find(c => c.code === 'export_allows_beta_false')
  assert.ok(check,                  'Expected export_allows_beta_false check')
  assert.strictEqual(check.passed,   false)
})

test('T7: commercial_claims_guard.claims_detected=true → failed check claims_not_detected', () => {
  const result = evaluateRegressionLockdown({
    commercial_claims_guard: { claims_detected: true },
  })
  const rl    = result.regression_lockdown
  const check = rl.checks.find(c => c.code === 'claims_not_detected')
  assert.ok(check,                  'Expected claims_not_detected check')
  assert.strictEqual(check.passed,   false)
})

test('T8: historical_snapshot_simulation.persistence_enabled=true → failed check snapshot_persistence_disabled', () => {
  const result = evaluateRegressionLockdown({
    historical_snapshot_simulation: { persistence_enabled: true },
  })
  const rl    = result.regression_lockdown
  const check = rl.checks.find(c => c.code === 'snapshot_persistence_disabled')
  assert.ok(check,                  'Expected snapshot_persistence_disabled check')
  assert.strictEqual(check.passed,   false)
})

test('T9: no_launch_governance.hard_lock_enabled=false → failed check no_launch_lock_enabled', () => {
  const result = evaluateRegressionLockdown({
    no_launch_governance: { hard_lock_enabled: false },
  })
  const rl    = result.regression_lockdown
  const check = rl.checks.find(c => c.code === 'no_launch_lock_enabled')
  assert.ok(check,                  'Expected no_launch_lock_enabled check')
  assert.strictEqual(check.passed,   false)
})

test('T10: governance_regression_suite.passed=false → failed check governance_regression_passed', () => {
  const result = evaluateRegressionLockdown({
    governance_regression_suite: { passed: false },
  })
  const rl    = result.regression_lockdown
  const check = rl.checks.find(c => c.code === 'governance_regression_passed')
  assert.ok(check,                  'Expected governance_regression_passed check')
  assert.strictEqual(check.passed,   false)
})

test('T11: JSON.stringify(evaluateRegressionLockdown({})) does not throw', () => {
  const result = evaluateRegressionLockdown({})
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
