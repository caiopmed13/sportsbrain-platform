// src/services/preBetaReadinessCouncil.test.js
// P3.8.26 — 8 tests for Pre-Beta Readiness Council

import assert from 'assert'
import { evaluatePreBetaReadinessCouncil } from './preBetaReadinessCouncil.js'

let passed = 0, failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('T1: default call → pre_beta_readiness_council.status=convened, can_approve_beta=false, can_approve_sell=false', () => {
  const result = evaluatePreBetaReadinessCouncil({})
  assert.strictEqual(result.pre_beta_readiness_council.status, 'convened')
  assert.strictEqual(result.pre_beta_readiness_council.can_approve_beta, false)
  assert.strictEqual(result.pre_beta_readiness_council.can_approve_sell, false)
})

test('T2: readiness_council_votes includes domains: data_quality, micro_test_readiness, commercial_safety, freeze_integrity', () => {
  const result = evaluatePreBetaReadinessCouncil({})
  const domains = result.readiness_council_votes.map(v => v.domain)
  const required = ['data_quality', 'micro_test_readiness', 'commercial_safety', 'freeze_integrity']
  for (const d of required) {
    assert.ok(domains.includes(d), `Missing domain: ${d}`)
  }
})

test('T3: commercial_safety vote always block, can_override=false', () => {
  const result = evaluatePreBetaReadinessCouncil({})
  const vote = result.readiness_council_votes.find(v => v.domain === 'commercial_safety')
  assert.ok(vote, 'Expected commercial_safety vote')
  assert.strictEqual(vote.vote, 'block')
  assert.strictEqual(vote.can_override, false)
})

test('T4: strong inputs with release_freeze_sentinel passed → can_approve_beta=false, overall_recommendation not start_beta', () => {
  const result = evaluatePreBetaReadinessCouncil({
    release_freeze_sentinel: { passed: true },
    pre_beta_operator_review: { status: 'ready_for_internal_review' },
  })
  assert.strictEqual(result.pre_beta_readiness_council.can_approve_beta, false)
  assert.notStrictEqual(result.pre_beta_readiness_council.overall_recommendation, 'start_beta')
})

test('T5: pre_beta_decision_record → persistence_enabled=false, private_beta_allowed=false, delivery_allowed=false', () => {
  const result = evaluatePreBetaReadinessCouncil({})
  assert.strictEqual(result.pre_beta_decision_record.persistence_enabled, false)
  assert.strictEqual(result.pre_beta_decision_record.private_beta_allowed, false)
  assert.strictEqual(result.pre_beta_decision_record.delivery_allowed, false)
})

test('T6: pre_beta_council_summary → safe_to_invite_private_users=false, safe_to_sell=false', () => {
  const result = evaluatePreBetaReadinessCouncil({})
  assert.strictEqual(result.pre_beta_council_summary.safe_to_invite_private_users, false)
  assert.strictEqual(result.pre_beta_council_summary.safe_to_sell, false)
})

test('T7: input with can_beta=true → pre_beta_readiness_council.can_approve_beta=false, unsafe_input_sanitized=true', () => {
  const result = evaluatePreBetaReadinessCouncil({ can_beta: true })
  assert.strictEqual(result.pre_beta_readiness_council.can_approve_beta, false)
  assert.strictEqual(result.pre_beta_readiness_council.unsafe_input_sanitized, true)
})

test('T8: JSON.stringify(evaluatePreBetaReadinessCouncil({})) does not throw', () => {
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(evaluatePreBetaReadinessCouncil({})) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const e of errors) console.error(`  - ${e.name}: ${e.error}`)
  process.exit(1)
}
