// p38GovernanceClosure.test.js
// Pure-node test runner — no jest, no external deps

import assert from 'assert'
import { evaluateP38GovernanceClosure } from './p38GovernanceClosure.js'

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

// T1 — default call basic guarantees
test('T1 default call: status, ready_for_p39_transition, can_beta, can_sell', () => {
  const result = evaluateP38GovernanceClosure()
  const pkt = result.p38_governance_closure_packet
  assert.ok(
    pkt.status === 'closed' || pkt.status === 'closed_with_warnings',
    `Expected status "closed" or "closed_with_warnings", got "${pkt.status}"`,
  )
  assert.strictEqual(pkt.ready_for_p39_transition, true, 'ready_for_p39_transition must be true')
  assert.strictEqual(pkt.can_beta, false, 'can_beta must be false')
  assert.strictEqual(pkt.can_sell, false, 'can_sell must be false')
})

// T2 — completion matrix contains required modules
test('T2 completion matrix has delivery_kill_switch, incident_ledger, operator_escalation, micro_test_policy', () => {
  const result = evaluateP38GovernanceClosure()
  const moduleCodes = result.p38_completion_matrix.modules.map((m) => m.module)
  for (const required of [
    'delivery_kill_switch',
    'incident_ledger',
    'operator_escalation',
    'micro_test_policy',
  ]) {
    assert.ok(moduleCodes.includes(required), `Module "${required}" not found in completion matrix`)
  }
})

// T3 — open risks register contains critical risk codes
test('T3 open risks include quality_not_proven_with_real_results, micro_test_not_active, real_user_beta_not_allowed', () => {
  const result = evaluateP38GovernanceClosure()
  const riskCodes = result.p38_open_risks_register.risks.map((r) => r.code)
  for (const required of [
    'quality_not_proven_with_real_results',
    'micro_test_not_active',
    'real_user_beta_not_allowed',
  ]) {
    assert.ok(riskCodes.includes(required), `Risk code "${required}" not found in risks register`)
  }
})

// T4 — closure audit has required entry_ids
test('T4 closure audit entries: closure_started, p39_transition_prepared, closure_completed', () => {
  const result = evaluateP38GovernanceClosure()
  const entryIds = result.p38_closure_audit.entries.map((e) => e.entry_id)
  for (const required of ['closure_started', 'p39_transition_prepared', 'closure_completed']) {
    assert.ok(entryIds.includes(required), `Audit entry "${required}" not found`)
  }
})

// T5 — closure summary safety flags
test('T5 closure summary: ready_for_p39=true, safe_to_activate_beta=false, safe_to_sell=false', () => {
  const result = evaluateP38GovernanceClosure()
  const summary = result.p38_closure_summary
  assert.strictEqual(summary.ready_for_p39, true, 'ready_for_p39 must be true')
  assert.strictEqual(summary.safe_to_activate_beta, false, 'safe_to_activate_beta must be false')
  assert.strictEqual(summary.safe_to_sell, false, 'safe_to_sell must be false')
})

// T6 — unsafe can_sell=true input is sanitized
test('T6 unsafe can_sell=true is sanitized: output can_sell=false, violations.length > 0', () => {
  const result = evaluateP38GovernanceClosure({ can_sell: true })
  const pkt = result.p38_governance_closure_packet
  assert.strictEqual(pkt.can_sell, false, 'can_sell must be forced to false')
  assert.ok(
    Array.isArray(pkt.violations) && pkt.violations.length > 0,
    'violations array must be non-empty when unsafe input detected',
  )
})

// T7 — JSON.stringify does not throw
test('T7 JSON.stringify(evaluateP38GovernanceClosure()) does not throw', () => {
  let json
  assert.doesNotThrow(() => {
    json = JSON.stringify(evaluateP38GovernanceClosure())
  }, 'JSON.stringify must not throw')
  assert.ok(typeof json === 'string' && json.length > 0, 'Serialized output must be a non-empty string')
})

// ── Results ────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('FAILURES:', errors)
  process.exit(1)
}
