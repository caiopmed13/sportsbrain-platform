// src/services/controlledUnfreezeDesign.test.js
// P3.8.24 — 9 tests for Controlled Unfreeze Design

import assert from 'assert'
import {
  buildControlledUnfreezeDesign,
  buildUnfreezePreconditionsMatrix,
  buildUnfreezeRiskAssessment,
  buildUnfreezeSimulationGuard,
  buildControlledUnfreezeSummary,
  evaluateControlledUnfreezeDesign,
} from './controlledUnfreezeDesign.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('T1: default input → status=designed, unfreeze_enabled=false, controlled_unfreeze_active=false, can_unfreeze_now=false', () => {
  const result = evaluateControlledUnfreezeDesign({})
  const d = result.controlled_unfreeze_design
  assert.strictEqual(d.status, 'designed')
  assert.strictEqual(d.unfreeze_enabled, false)
  assert.strictEqual(d.controlled_unfreeze_active, false)
  assert.strictEqual(d.can_unfreeze_now, false)
})

test('T2: capabilities_under_design includes internal_download, internal_storage, manual_review_unlock', () => {
  const result = evaluateControlledUnfreezeDesign({})
  const caps = result.controlled_unfreeze_design.capabilities_under_design
  assert.ok(caps.includes('internal_download'),           'Expected internal_download')
  assert.ok(caps.includes('internal_storage'),            'Expected internal_storage')
  assert.ok(caps.includes('manual_review_unlock'),        'Expected manual_review_unlock')
})

test('T3: capabilities_not_eligible includes sell, public_beta, real_delivery, checkout, pricing', () => {
  const result = evaluateControlledUnfreezeDesign({})
  const caps = result.controlled_unfreeze_design.capabilities_not_eligible
  assert.ok(caps.includes('sell'),         'Expected sell')
  assert.ok(caps.includes('public_beta'),  'Expected public_beta')
  assert.ok(caps.includes('real_delivery'),'Expected real_delivery')
  assert.ok(caps.includes('checkout'),     'Expected checkout')
  assert.ok(caps.includes('pricing'),      'Expected pricing')
})

test('T4: unfreeze_preconditions_matrix.all_met=false, preconditions include explicit_future_phase_approval with met=false', () => {
  const result = evaluateControlledUnfreezeDesign({})
  const matrix = result.unfreeze_preconditions_matrix
  assert.strictEqual(matrix.all_met, false)
  const ep = matrix.preconditions.find(p => p.code === 'explicit_future_phase_approval')
  assert.ok(ep, 'Expected explicit_future_phase_approval precondition')
  assert.strictEqual(ep.met, false)
})

test('T5: unfreeze_risk_assessment.overall_risk=high, safe_to_unfreeze=false, risks include premature_sell_release', () => {
  const result = evaluateControlledUnfreezeDesign({})
  const ra = result.unfreeze_risk_assessment
  assert.strictEqual(ra.overall_risk, 'high')
  assert.strictEqual(ra.safe_to_unfreeze, false)
  assert.ok(
    ra.risks.some(r => r.code === 'premature_sell_release'),
    'Expected premature_sell_release in risks'
  )
})

test('T6: unfreeze_simulation_guard.real_unfreeze_allowed=false, can_enable_beta=false, can_enable_sell=false, can_enable_download=false, can_enable_storage=false', () => {
  const result = evaluateControlledUnfreezeDesign({})
  const guard = result.unfreeze_simulation_guard
  assert.strictEqual(guard.real_unfreeze_allowed, false)
  assert.strictEqual(guard.can_enable_beta,       false)
  assert.strictEqual(guard.can_enable_sell,        false)
  assert.strictEqual(guard.can_enable_download,    false)
  assert.strictEqual(guard.can_enable_storage,     false)
})

test('T7: input unfreeze_enabled=true, controlled_unfreeze_active=true → output values forced false; blocker/unsafe flag recorded', () => {
  const result = evaluateControlledUnfreezeDesign({ unfreeze_enabled: true, controlled_unfreeze_active: true })
  const d = result.controlled_unfreeze_design
  assert.strictEqual(d.unfreeze_enabled,          false)
  assert.strictEqual(d.controlled_unfreeze_active, false)
  assert.strictEqual(d.unsafe_input_sanitized,    true)
  assert.ok(
    Array.isArray(d.blockers) && d.blockers.includes('unfreeze_requested_but_blocked'),
    `Expected unfreeze_requested_but_blocked in blockers: ${JSON.stringify(d.blockers)}`
  )
})

test('T8: controlled_unfreeze_summary.status=design_only, safe_to_unfreeze=false, safe_to_sell=false', () => {
  const result = evaluateControlledUnfreezeDesign({})
  const s = result.controlled_unfreeze_summary
  assert.strictEqual(s.status,          'design_only')
  assert.strictEqual(s.safe_to_unfreeze, false)
  assert.strictEqual(s.safe_to_sell,    false)
})

test('T9: JSON.stringify(evaluateControlledUnfreezeDesign({})) does not throw', () => {
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(evaluateControlledUnfreezeDesign({})) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
