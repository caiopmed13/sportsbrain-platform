import { evaluateBetaSimulationReadiness } from './betaSimulationReadiness.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — default not ready
test('default not ready', () => {
  const result = evaluateBetaSimulationReadiness({})
  assert(result.beta_simulation_readiness_review.ready_for_beta_simulation === false, 'ready_for_beta_simulation should be false')
  assert(result.beta_simulation_readiness_review.ready_for_real_beta === false, 'ready_for_real_beta should be false')
})

// Test 2 — real beta blockers always active
test('real beta blockers always active', () => {
  const result = evaluateBetaSimulationReadiness({})
  assert(result.beta_simulation_blocker_matrix.blockers.some(b => b.code === 'real_beta_not_allowed' && b.active === true), 'real_beta_not_allowed should be active')
  assert(result.beta_simulation_blocker_matrix.blockers.some(b => b.code === 'sell_not_allowed' && b.active === true), 'sell_not_allowed should be active')
  assert(result.beta_simulation_blocker_matrix.blockers.some(b => b.code === 'real_users_not_allowed' && b.active === true), 'real_users_not_allowed should be active')
})

// Test 3 — beta simulation blocked by sample
test('beta simulation blocked by sample', () => {
  const result = evaluateBetaSimulationReadiness({
    first_real_quality_snapshot: { resolved_valid_count: 3 },
    quality_proof_decision_gate: { gate_score: 10, can_advance_quality_proof: false }
  })
  assert(result.beta_simulation_blocker_matrix.blockers.some(b => b.code === 'resolved_sample_too_small' && b.active === true), 'resolved_sample_too_small should be active')
})

// Test 4 — review score bounded
test('review score bounded', () => {
  const result = evaluateBetaSimulationReadiness({})
  assert(result.beta_simulation_readiness_review.review_score >= 0, 'review_score should be >= 0')
  assert(result.beta_simulation_readiness_review.review_score <= 100, 'review_score should be <= 100')
})

// Test 5 — can be ready for simulation review but not real beta
test('can be ready for simulation review but not real beta', () => {
  const result = evaluateBetaSimulationReadiness({
    quality_proof_decision_gate: { gate_score: 80, decision: 'quality_promising_shadow_only', can_advance_quality_proof: true },
    recommendation_stability_check: { stability_level: 'stable', requires_more_runs: false },
    shadow_policy_enforcement: { status: 'enforced' },
    quality_proof_trend_monitor: { trend_direction: 'up', requires_more_real_runs: false },
    segment_decision_history_simulation: { stable_segments_count: 3 }
  })
  assert(result.beta_simulation_readiness_review.ready_for_beta_simulation === true, 'ready_for_beta_simulation should be true')
  assert(result.beta_simulation_readiness_review.ready_for_real_beta === false, 'ready_for_real_beta should be false')
  assert(result.beta_simulation_readiness_review.beta_simulation_allows_real_users === false, 'beta_simulation_allows_real_users should be false')
  assert(result.beta_simulation_readiness_review.beta_simulation_allows_delivery === false, 'beta_simulation_allows_delivery should be false')
})

// Test 6 — evidence items
test('evidence items', () => {
  const result = evaluateBetaSimulationReadiness({})
  assert(result.beta_simulation_readiness_evidence.evidence_items.some(e => e.code === 'quality_gate_decision'), 'quality_gate_decision evidence missing')
  assert(result.beta_simulation_readiness_evidence.evidence_items.some(e => e.code === 'no_beta_no_sell'), 'no_beta_no_sell evidence missing')
})

// Test 7 — unsafe ready_for_real_beta sanitized
test('unsafe ready_for_real_beta sanitized', () => {
  const result = evaluateBetaSimulationReadiness({ ready_for_real_beta: true, beta_simulation_allows_real_users: true })
  assert(result.beta_simulation_readiness_review.ready_for_real_beta === false, 'ready_for_real_beta should be false after sanitization')
  assert(result.beta_simulation_readiness_review.beta_simulation_allows_real_users === false, 'beta_simulation_allows_real_users should be false after sanitization')
  assert(result.beta_simulation_readiness_review.violations.length > 0, 'violations should be non-empty')
})

// Test 8 — summary safe
test('summary safe', () => {
  const result = evaluateBetaSimulationReadiness({})
  assert(result.p39_beta_simulation_summary.safe_to_invite_private_users === false, 'safe_to_invite_private_users should be false')
  assert(result.p39_beta_simulation_summary.safe_to_sell === false, 'safe_to_sell should be false')
})

// Test 9 — output serializable
test('output serializable', () => {
  const result = evaluateBetaSimulationReadiness({
    quality_proof_decision_gate: { gate_score: 45 },
    shadow_policy_enforcement: { status: 'enforced' }
  })
  let threw = false
  try { JSON.stringify(result) } catch(e) { threw = true }
  assert(!threw, 'result should be JSON serializable')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
