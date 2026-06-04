import assert from 'assert'
import {
  evaluatePreBetaGovernanceGate,
  buildPreBetaGovernanceGate,
  buildPreBetaBlockerMatrix,
  buildPreBetaOperatorReview,
  buildFinalPreBetaSummary,
} from './preBetaGovernanceGate.js'

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

// T1: default call → gate blocked, can_enter_private_beta=false, can_sell=false
test('T1: default → status=blocked, can_enter_private_beta=false, can_sell=false', () => {
  const result = evaluatePreBetaGovernanceGate({})
  const gate = result.pre_beta_governance_gate
  assert.strictEqual(gate.status, 'blocked', `expected status=blocked, got ${gate.status}`)
  assert.strictEqual(gate.can_enter_private_beta, false, 'can_enter_private_beta should be false')
  assert.strictEqual(gate.can_sell, false, 'can_sell should be false')
})

// T2: blocker matrix includes required blocker codes
test('T2: blocker matrix includes real_beta_still_forbidden, sell_still_forbidden, explicit_future_phase_missing', () => {
  const result = evaluatePreBetaGovernanceGate({})
  const blockers = result.pre_beta_blocker_matrix.blockers
  const codes = blockers.map(b => b.code)
  assert.ok(codes.includes('real_beta_still_forbidden'), 'missing real_beta_still_forbidden')
  assert.ok(codes.includes('sell_still_forbidden'), 'missing sell_still_forbidden')
  assert.ok(codes.includes('explicit_future_phase_missing'), 'missing explicit_future_phase_missing')
})

// T3: gate_score is between 0 and 100 inclusive
test('T3: gate_score is between 0 and 100 inclusive', () => {
  const result = evaluatePreBetaGovernanceGate({})
  const score = result.pre_beta_governance_gate.gate_score
  assert.ok(typeof score === 'number', `gate_score must be a number, got ${typeof score}`)
  assert.ok(score >= 0 && score <= 100, `gate_score ${score} out of range [0,100]`)
})

// T4: even with all favourable inputs → can_enter_private_beta=false, can_enter_public_beta=false
test('T4: all-favourable inputs → can_enter_private_beta=false, can_enter_public_beta=false', () => {
  const fullInput = {
    release_freeze_sentinel:        { passed: true },
    safety_invariant_snapshot:      { all_passed: true },
    micro_test_policy:              { passed: true },
    simulated_cohort_monitor:       { status: 'active' },
    admin_access_audit:             { authorized: true },
    manual_review_artifact:         { present: true },
    capability_unlock_matrix:       { status: 'evaluated' },
    controlled_unfreeze_simulation: { status: 'simulated' },
  }
  const gate = buildPreBetaGovernanceGate(fullInput)
  assert.strictEqual(gate.can_enter_private_beta, false, 'can_enter_private_beta should always be false')
  assert.strictEqual(gate.can_enter_public_beta, false, 'can_enter_public_beta should always be false')
})

// T5: operator review status and flags
test('T5: operator_review.status=ready_for_internal_review, operator_can_approve_beta_now=false, operator_can_approve_sell_now=false', () => {
  const result = evaluatePreBetaGovernanceGate({})
  const review = result.pre_beta_operator_review
  assert.strictEqual(review.status, 'ready_for_internal_review', `expected ready_for_internal_review, got ${review.status}`)
  assert.strictEqual(review.operator_can_approve_beta_now, false, 'operator_can_approve_beta_now should be false')
  assert.strictEqual(review.operator_can_approve_sell_now, false, 'operator_can_approve_sell_now should be false')
})

// T6: review_items includes specific item_ids
test('T6: review_items includes review_freeze_baseline, confirm_no_sell, confirm_no_real_users', () => {
  const result = evaluatePreBetaGovernanceGate({})
  const ids = result.pre_beta_operator_review.review_items.map(r => r.item_id)
  assert.ok(ids.includes('review_freeze_baseline'), 'missing review_freeze_baseline')
  assert.ok(ids.includes('confirm_no_sell'), 'missing confirm_no_sell')
  assert.ok(ids.includes('confirm_no_real_users'), 'missing confirm_no_real_users')
})

// T7: final summary → status=blocked, can_unlock_any_now=false, can_sell=false
test('T7: final_pre_beta_summary → status=blocked, can_unlock_any_now=false, can_sell=false', () => {
  const result = evaluatePreBetaGovernanceGate({})
  const summary = result.final_pre_beta_summary
  assert.strictEqual(summary.status, 'blocked', `expected status=blocked, got ${summary.status}`)
  assert.strictEqual(summary.can_unlock_any_now, false, 'can_unlock_any_now should be false')
  assert.strictEqual(summary.can_sell, false, 'can_sell should be false')
})

// T8: private_beta_enabled=true → extra blocker recorded, can_enter_private_beta still false
test('T8: private_beta_enabled=true → extra blocker recorded, can_enter_private_beta=false', () => {
  const result = evaluatePreBetaGovernanceGate({ private_beta_enabled: true })
  const codes = result.pre_beta_blocker_matrix.blockers.map(b => b.code)
  assert.ok(
    codes.includes('private_beta_unsafe_input_detected'),
    'missing private_beta_unsafe_input_detected blocker'
  )
  assert.strictEqual(result.pre_beta_governance_gate.can_enter_private_beta, false, 'can_enter_private_beta should still be false')
})

// T9: JSON.stringify does not throw
test('T9: JSON.stringify(evaluatePreBetaGovernanceGate({})) does not throw', () => {
  let str
  assert.doesNotThrow(() => {
    str = JSON.stringify(evaluatePreBetaGovernanceGate({}))
  }, 'JSON.stringify threw an error')
  assert.ok(typeof str === 'string' && str.length > 0, 'serialized string is empty')
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
