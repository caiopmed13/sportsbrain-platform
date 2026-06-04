import assert from 'assert'
import { evaluateP38SafetyFinalization } from './p38SafetyFinalization.js'

let passed = 0, failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1 — default: freeze finalized, freeze_active, no_sell_active
test('T1 — default output: status finalized, freeze_active, no_sell_active', () => {
  const result = evaluateP38SafetyFinalization()
  const f = result.p38_safety_freeze_finalization
  assert.strictEqual(f.status, 'finalized')
  assert.strictEqual(f.freeze_active, true)
  assert.strictEqual(f.no_sell_active, true)
})

// T2 — invariant checks include specific check_ids
test('T2 — invariant checks include can_beta_false, can_sell_false, incident_real_action_taken_false', () => {
  const result = evaluateP38SafetyFinalization()
  const checks = result.final_safety_invariant_check.checks
  const ids = checks.map(c => c.check_id)
  assert.ok(ids.includes('can_beta_false'), 'missing can_beta_false')
  assert.ok(ids.includes('can_sell_false'), 'missing can_sell_false')
  assert.ok(ids.includes('incident_real_action_taken_false'), 'missing incident_real_action_taken_false')
})

// T3 — no-sell / no-delivery confirmed, safe_to_sell false
test('T3 — no_sell_confirmed=true, no_delivery_confirmed=true, safe_to_sell=false', () => {
  const result = evaluateP38SafetyFinalization()
  const c = result.final_no_sell_no_delivery_check
  assert.strictEqual(c.no_sell_confirmed, true)
  assert.strictEqual(c.no_delivery_confirmed, true)
  assert.strictEqual(c.safe_to_sell, false)
})

// T4 — unsafe delivery_allowed=true input is sanitized
test('T4 — unsafe delivery_allowed=true: output delivery_allowed=false, invariant check failed', () => {
  const result = evaluateP38SafetyFinalization({ delivery_allowed: true })
  assert.strictEqual(result.p38_safety_freeze_finalization.delivery_allowed, false)
  const inv = result.final_safety_invariant_check
  assert.ok(!inv.passed || inv.failed_count > 0, 'expected invariant check to fail')
})

// T5 — unsafe operator_notified_externally=true is sanitized in no-sell check
test('T5 — unsafe operator_notified_externally=true: output operator_notified_externally=false', () => {
  const result = evaluateP38SafetyFinalization({ operator_notified_externally: true })
  assert.strictEqual(result.final_no_sell_no_delivery_check.operator_notified_externally, false)
})

// T6 — summary fields
test('T6 — summary: ready_for_quality_proof=true, can_beta=false, can_sell=false', () => {
  const result = evaluateP38SafetyFinalization()
  const s = result.p38_safety_finalization_summary
  assert.strictEqual(s.ready_for_quality_proof, true)
  assert.strictEqual(s.can_beta, false)
  assert.strictEqual(s.can_sell, false)
})

// T7 — JSON.stringify does not throw
test('T7 — JSON.stringify does not throw', () => {
  assert.doesNotThrow(() => JSON.stringify(evaluateP38SafetyFinalization()))
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error('FAILURES:', errors); process.exit(1) }
