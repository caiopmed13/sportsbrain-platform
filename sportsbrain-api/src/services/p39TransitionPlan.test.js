import assert from 'assert'
import { evaluateP39TransitionPlan } from './p39TransitionPlan.js'

let passed = 0, failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1 — default call
test('T1: default output shape and safe values', () => {
  const result = evaluateP39TransitionPlan()
  assert.strictEqual(result.p39_transition_plan.status, 'ready')
  assert.strictEqual(result.p39_transition_plan.target_phase, 'P3.9')
  assert.strictEqual(result.p39_transition_plan.auto_activate_micro_test, false)
})

// T2 — resolved_valid=12
test('T2: resolved_valid=12 blocks activation and sets remaining correctly', () => {
  const result = evaluateP39TransitionPlan({ resolved_valid: 12 })
  const plan = result.p39_micro_test_activation_plan
  assert.strictEqual(plan.activation_allowed_now, false)
  assert.ok(plan.activation_blockers.includes('resolved_valid_below_threshold'))
  assert.strictEqual(plan.remaining_to_threshold, 18)
})

// T3 — resolved_valid=30
test('T3: resolved_valid=30 allows activation, keeps manual flags', () => {
  const result = evaluateP39TransitionPlan({ resolved_valid: 30 })
  const plan = result.p39_micro_test_activation_plan
  assert.strictEqual(plan.activation_allowed_now, true)
  assert.strictEqual(plan.manual_activation_only, true)
  assert.strictEqual(plan.auto_activation_allowed, false)
})

// T4 — quality proof requirements
test('T4: quality proof requirements contain required IDs and no-sell policy', () => {
  const result = evaluateP39TransitionPlan()
  const qp = result.p39_quality_proof_requirements
  const ids = qp.requirements.map(r => r.requirement_id)
  assert.ok(ids.includes('minimum_micro_test_sample_met'))
  assert.ok(ids.includes('hit_rate_available'))
  assert.ok(ids.includes('segment_health_available'))
  assert.strictEqual(qp.can_sell_after_quality_proof, false)
})

// T5 — operator checklist
test('T5: operator checklist contains required item IDs', () => {
  const result = evaluateP39TransitionPlan()
  const itemIds = result.p39_operator_checklist.items.map(i => i.item_id)
  assert.ok(itemIds.includes('check_resolved_valid'))
  assert.ok(itemIds.includes('manually_enable_micro_test_only_if_threshold_met'))
  assert.ok(itemIds.includes('confirm_no_beta_no_sell_before_activation'))
})

// T6 — unsafe auto_activate_micro_test=true
test('T6: unsafe auto_activate_micro_test=true is sanitized and violation recorded', () => {
  const result = evaluateP39TransitionPlan({ auto_activate_micro_test: true })
  assert.strictEqual(result.p39_transition_plan.auto_activate_micro_test, false)
  assert.ok(result.p39_transition_plan.violations.length > 0)
})

// T7 — summary fields
test('T7: operator summary has correct next_phase, can_beta, can_sell', () => {
  const result = evaluateP39TransitionPlan()
  const summary = result.p38_to_p39_operator_summary
  assert.strictEqual(summary.next_phase, 'P3.9')
  assert.strictEqual(summary.can_beta, false)
  assert.strictEqual(summary.can_sell, false)
})

// T8 — serializable with no throws
test('T8: JSON.stringify does not throw', () => {
  JSON.stringify(evaluateP39TransitionPlan())
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error('FAILURES:', errors); process.exit(1) }
