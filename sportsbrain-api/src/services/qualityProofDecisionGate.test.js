import { evaluateQualityProofDecisionGate } from './qualityProofDecisionGate.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — gate default collect more data
test('gate default collect more data', () => {
  const result = evaluateQualityProofDecisionGate({})
  assert(result.quality_proof_decision_gate.decision === 'collect_more_data',
    `expected 'collect_more_data', got '${result.quality_proof_decision_gate.decision}'`)
  assert(result.quality_proof_decision_gate.quality_gate_allows_beta === false,
    'quality_gate_allows_beta should be false')
})

// Test 2 — evidence items minimum
test('evidence items minimum', () => {
  const result = evaluateQualityProofDecisionGate({})
  const items = result.quality_proof_gate_evidence.evidence_items
  assert(items.some(e => e.code === 'resolved_sample_size'),
    'missing resolved_sample_size evidence')
  assert(items.some(e => e.code === 'shadow_policy_enforced'),
    'missing shadow_policy_enforced evidence')
  assert(items.some(e => e.code === 'no_beta_no_sell'),
    'missing no_beta_no_sell evidence')
})

// Test 3 — gate score bounded
test('gate score bounded', () => {
  const result = evaluateQualityProofDecisionGate({})
  const score = result.quality_proof_decision_gate.gate_score
  assert(score >= 0 && score <= 100,
    `gate_score ${score} out of [0, 100]`)
})

// Test 4 — promising still shadow only
test('promising still shadow only', () => {
  const result = evaluateQualityProofDecisionGate({
    resolved_sample_audit: { resolved_valid: 50 },
    first_real_quality_snapshot: { status: 'active_snapshot', hit_rate: 0.65 },
    segment_quality_proof: { quality_proof_level: 'segment_promising' },
    break_even_odds_review: { status: 'evaluated' },
    recommendation_stability_check: { stability_level: 'stable', stability_rate: 0.9 },
    shadow_reweight_backtest: { status: 'simulated' },
    shadow_policy_enforcement: { passed: true }
  })
  const gate = result.quality_proof_decision_gate
  assert(gate.quality_gate_allows_beta === false,
    'quality_gate_allows_beta must be false')
  assert(gate.quality_gate_allows_sell === false,
    'quality_gate_allows_sell must be false')
})

// Test 5 — blocked when policy failed
test('blocked when policy failed', () => {
  const result = evaluateQualityProofDecisionGate({
    shadow_policy_enforcement: { passed: false, failed_count: 1 }
  })
  assert(result.quality_proof_decision_gate.decision === 'blocked',
    `expected 'blocked', got '${result.quality_proof_decision_gate.decision}'`)
})

// Test 6 — operator actions
test('operator actions', () => {
  const result = evaluateQualityProofDecisionGate({})
  const actions = result.quality_proof_operator_actions.actions
  assert(actions.some(a => a.action === 'do_not_apply_engine_changes'),
    'missing do_not_apply_engine_changes action')
  assert(actions.some(a => a.action === 'do_not_enable_beta'),
    'missing do_not_enable_beta action')
  assert(actions.some(a => a.action === 'do_not_sell'),
    'missing do_not_sell action')
})

// Test 7 — unsafe quality_gate_allows_beta sanitized
test('unsafe quality_gate_allows_beta sanitized', () => {
  const result = evaluateQualityProofDecisionGate({ quality_gate_allows_beta: true })
  assert(result.quality_proof_decision_gate.quality_gate_allows_beta === false,
    'quality_gate_allows_beta must be forced false')
  assert(result.quality_proof_decision_gate.violations.length > 0,
    'violations should be non-empty when safety invariant is breached')
})

// Test 8 — summary safe
test('summary safe', () => {
  const result = evaluateQualityProofDecisionGate({})
  const summary = result.p39_quality_decision_summary
  assert(summary.safe_to_beta === false, 'safe_to_beta must be false')
  assert(summary.safe_to_sell === false, 'safe_to_sell must be false')
})

// Test 9 — output serializable
test('output serializable', () => {
  let threw = false
  try {
    JSON.stringify(evaluateQualityProofDecisionGate({}))
  } catch(e) {
    threw = true
  }
  assert(!threw, 'JSON.stringify should not throw')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
