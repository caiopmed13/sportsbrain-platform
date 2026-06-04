// src/services/governanceRegression.test.js
// P3.8.17 — 13 tests for Governance Regression Suite

import assert from 'assert'
import {
  collectForbiddenTruths,
  assertNoLaunchInvariants,
  assertRequiredGovernanceBlocks,
  buildGovernanceRegressionSuite,
  evaluateGovernanceRegression,
} from './governanceRegression.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeInput() {
  return {
    can_beta:        false,
    can_sell:        false,
    release_allowed: false,
    launch_allowed:  false,
    real_users:      false,
    real_delivery:   false,
    launch_governance: {
      private_beta_allowed: false,
      public_beta_allowed:  false,
      sell_allowed:         false,
    },
    manual_review_summary: {
      safe_to_invite_private_users: false,
      safe_to_sell:                 false,
    },
    approval_simulation: { status: 'disabled', can_enable_beta: false, can_enable_sell: false },
    launch_no_launch_decision: { decision: 'continue_shadow' },
  }
}

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

test('T1: safe input → status=passed, passed=true, failed_count=0', () => {
  const result = evaluateGovernanceRegression({
    can_beta: false, can_sell: false, release_allowed: false,
  })
  assert.strictEqual(result.governance_regression_suite.status,       'passed')
  assert.strictEqual(result.governance_regression_suite.passed,       true)
  assert.strictEqual(result.governance_regression_suite.failed_count, 0)
})

test('T2: can_beta=true → failed check can_beta_false, passed=false', () => {
  const result = evaluateGovernanceRegression({ can_beta: true })
  const suite = result.governance_regression_suite
  assert.strictEqual(suite.passed, false)
  const check = suite.checks.find(c => c.code === 'can_beta_false')
  assert.ok(check, 'Expected can_beta_false check')
  assert.strictEqual(check.passed, false)
})

test('T3: can_sell=true → failed check can_sell_false', () => {
  const result = evaluateGovernanceRegression({ can_sell: true })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'can_sell_false')
  assert.ok(check, 'Expected can_sell_false check')
  assert.strictEqual(check.passed, false)
})

test('T4: release_allowed=true → failed check release_allowed_false', () => {
  const result = evaluateGovernanceRegression({ release_allowed: true })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'release_allowed_false')
  assert.ok(check, 'Expected release_allowed_false check')
  assert.strictEqual(check.passed, false)
})

test('T5: launch_allowed=true → failed check launch_allowed_false', () => {
  const result = evaluateGovernanceRegression({ launch_allowed: true })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'launch_allowed_false')
  assert.ok(check, 'Expected launch_allowed_false check')
  assert.strictEqual(check.passed, false)
})

test('T6: real_users=true → failed check real_users_false', () => {
  const result = evaluateGovernanceRegression({ real_users: true })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'real_users_false')
  assert.ok(check, 'Expected real_users_false check')
  assert.strictEqual(check.passed, false)
})

test('T7: real_delivery=true → failed check real_delivery_false', () => {
  const result = evaluateGovernanceRegression({ real_delivery: true })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'real_delivery_false')
  assert.ok(check, 'Expected real_delivery_false check')
  assert.strictEqual(check.passed, false)
})

test('T8: launch_no_launch_decision.decision=launch → failed check operator_decision_never_launch', () => {
  const result = evaluateGovernanceRegression({
    launch_no_launch_decision: { decision: 'launch' },
  })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'operator_decision_never_launch')
  assert.ok(check, 'Expected operator_decision_never_launch check')
  assert.strictEqual(check.passed, false)
})

test('T9: approval approved + can_beta=false → approval_does_not_enable_beta passed=true', () => {
  const result = evaluateGovernanceRegression({
    approval_simulation: { status: 'approved', can_enable_beta: false, can_enable_sell: false },
    can_beta: false,
  })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'approval_does_not_enable_beta')
  assert.ok(check, 'Expected approval_does_not_enable_beta check')
  assert.strictEqual(check.passed, true)
})

test('T10: approval approved + can_beta=true → approval_does_not_enable_beta failed', () => {
  const result = evaluateGovernanceRegression({
    approval_simulation: { status: 'approved', can_enable_beta: false },
    can_beta: true,
  })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'approval_does_not_enable_beta')
  assert.ok(check, 'Expected approval_does_not_enable_beta check')
  assert.strictEqual(check.passed, false)
})

test('T11: empty input → warnings for missing blocks, no exception, suite still returns', () => {
  assert.doesNotThrow(() => {
    const result = evaluateGovernanceRegression({})
    const suite = result.governance_regression_suite
    assert.ok(typeof suite.status === 'string', 'Expected status string')
    // Missing governance blocks become warnings (not blocker failures)
    assert.ok(suite.warnings.length > 0, 'Expected warnings for missing blocks')
  })
})

test('T12: release_hard_locks.length >= 8 → hard_locks_present passed=true', () => {
  const locks = Array.from({ length: 10 }, (_, i) => ({
    code: `lock_${i}`, locked: true, severity: 'blocker', can_be_overridden_now: false,
  }))
  const result = evaluateGovernanceRegression({ release_hard_locks: locks })
  const suite = result.governance_regression_suite
  const check = suite.checks.find(c => c.code === 'hard_locks_present')
  assert.ok(check, 'Expected hard_locks_present check')
  assert.strictEqual(check.passed, true)
})

test('T13: JSON.stringify(evaluateGovernanceRegression({})) does not throw', () => {
  const result = evaluateGovernanceRegression({})
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
