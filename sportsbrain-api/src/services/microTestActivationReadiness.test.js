// microTestActivationReadiness.test.js
// Node.js ESM test runner — no external dependencies

import assert from 'assert'
import { evaluateMicroTestActivationReadiness } from './microTestActivationReadiness.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

// ─── T1 ── waiting_for_threshold ────────────────────────────────────────────
test('T1 — resolved_valid:12 → waiting_for_threshold, activation_allowed_now=false, remaining=18', () => {
  const result = evaluateMicroTestActivationReadiness({ resolved_valid: 12 })
  const r = result.micro_test_activation_readiness
  assert.strictEqual(r.status, 'waiting_for_threshold', `status should be 'waiting_for_threshold', got '${r.status}'`)
  assert.strictEqual(r.activation_allowed_now, false, 'activation_allowed_now should be false')
  assert.strictEqual(r.remaining_to_threshold, 18, `remaining_to_threshold should be 18, got ${r.remaining_to_threshold}`)
})

// ─── T2 ── ready_for_manual_activation ──────────────────────────────────────
test('T2 — resolved_valid:30, micro_test_enabled:false → ready_for_manual_activation', () => {
  const result = evaluateMicroTestActivationReadiness({ resolved_valid: 30, micro_test_enabled: false })
  const r = result.micro_test_activation_readiness
  assert.strictEqual(r.status, 'ready_for_manual_activation', `status should be 'ready_for_manual_activation', got '${r.status}'`)
  assert.strictEqual(r.activation_allowed_now, true, 'activation_allowed_now should be true')
  assert.strictEqual(r.manual_activation_only, true, 'manual_activation_only should be true')
  assert.strictEqual(r.auto_activation_allowed, false, 'auto_activation_allowed should be false')
})

// ─── T3 ── already_active ───────────────────────────────────────────────────
test('T3 — resolved_valid:30, micro_test_enabled:true, micro_test_active:true → already_active', () => {
  const result = evaluateMicroTestActivationReadiness({
    resolved_valid: 30,
    micro_test_enabled: true,
    micro_test_active: true,
  })
  const r = result.micro_test_activation_readiness
  assert.strictEqual(r.status, 'already_active', `status should be 'already_active', got '${r.status}'`)
})

// ─── T4 ── prerequisites include hardcoded passed=true checks ───────────────
test('T4 — default input → green_red_only_counting and no_pending_counted_as_resolved have passed=true', () => {
  const result = evaluateMicroTestActivationReadiness()
  const required = result.activation_prerequisites.required
  const greenRed = required.find((c) => c.check_id === 'green_red_only_counting')
  const noPending = required.find(
    (c) => c.check_id === 'no_pending_counted_as_resolved'
  )
  assert.ok(greenRed, 'green_red_only_counting check should exist')
  assert.strictEqual(greenRed.passed, true, 'green_red_only_counting should be passed=true')
  assert.ok(noPending, 'no_pending_counted_as_resolved check should exist')
  assert.strictEqual(noPending.passed, true, 'no_pending_counted_as_resolved should be passed=true')
})

// ─── T5 ── checklist blocked when below threshold ───────────────────────────
test('T5 — resolved_valid:12 → checklist status=blocked, confirm_resolved_valid_at_least_30 blocked', () => {
  const result = evaluateMicroTestActivationReadiness({ resolved_valid: 12 })
  const checklist = result.micro_test_manual_activation_checklist
  assert.strictEqual(checklist.status, 'blocked', `checklist.status should be 'blocked', got '${checklist.status}'`)
  const item = checklist.items.find((i) => i.item_id === 'confirm_resolved_valid_at_least_30')
  assert.ok(item, 'confirm_resolved_valid_at_least_30 item should exist')
  assert.strictEqual(item.status, 'blocked', `confirm_resolved_valid_at_least_30 should be 'blocked', got '${item.status}'`)
})

// ─── T6 ── checklist ready at threshold ─────────────────────────────────────
test('T6 — resolved_valid:30, micro_test_enabled:false → checklist status=ready', () => {
  const result = evaluateMicroTestActivationReadiness({ resolved_valid: 30, micro_test_enabled: false })
  const checklist = result.micro_test_manual_activation_checklist
  assert.strictEqual(checklist.status, 'ready', `checklist.status should be 'ready', got '${checklist.status}'`)
})

// ─── T7 ── unsafe input sanitized ───────────────────────────────────────────
test('T7 — auto_activate_micro_test:true → auto_activation_allowed=false, risks not empty', () => {
  const result = evaluateMicroTestActivationReadiness({ auto_activate_micro_test: true })
  const r = result.micro_test_activation_readiness
  assert.strictEqual(r.auto_activation_allowed, false, 'auto_activation_allowed must always be false')
  assert.strictEqual(r.unsafe_input_sanitized, true, 'unsafe_input_sanitized should be true')
  assert.ok(r.violations.includes('auto_activate_micro_test'), 'violations should include auto_activate_micro_test')
  const risks = result.activation_risk_review.risks
  assert.ok(Array.isArray(risks) && risks.length > 0, 'activation_risk_review.risks should not be empty')
})

// ─── T8 ── no-throw default call ────────────────────────────────────────────
test('T8 — JSON.stringify(evaluateMicroTestActivationReadiness()) does not throw', () => {
  let str
  assert.doesNotThrow(() => {
    str = JSON.stringify(evaluateMicroTestActivationReadiness())
  }, 'evaluateMicroTestActivationReadiness() should not throw and result should be JSON-serializable')
  assert.ok(typeof str === 'string' && str.length > 0, 'serialized result should be a non-empty string')
})

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('')
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const e of errors) {
    console.error(`  - ${e.name}: ${e.error}`)
  }
}
if (failed > 0) process.exit(1)
