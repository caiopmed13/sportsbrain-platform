// src/services/safetyInvariantSnapshot.test.js
// P3.8.24 — 9 tests for Safety Invariant Snapshot

import assert from 'assert'
import {
  collectSafetyInvariantValues,
  buildSafetyInvariantSnapshot,
  validateSafetyInvariantSnapshot,
  buildSafetyInvariantSummary,
  evaluateSafetyInvariantSnapshot,
} from './safetyInvariantSnapshot.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('T1: safe input → snapshot.status=captured, all_passed=true', () => {
  const result = evaluateSafetyInvariantSnapshot({})
  assert.strictEqual(result.safety_invariant_snapshot.status, 'captured')
  assert.strictEqual(result.safety_invariant_snapshot.all_passed, true)
})

test('T2: categories in invariants include all required categories', () => {
  const result = buildSafetyInvariantSnapshot({})
  const categories = new Set(result.invariants.map(i => i.category))
  const required = ['commercial', 'beta', 'delivery', 'download', 'storage', 'export', 'claims', 'unfreeze', 'governance']
  for (const cat of required) {
    assert.ok(categories.has(cat), `Missing category: ${cat}`)
  }
})

test('T3: can_beta=true → can_beta_false has passed=false, validation.passed=false', () => {
  const result = evaluateSafetyInvariantSnapshot({ can_beta: true })
  const inv = result.safety_invariant_snapshot.invariants.find(i => i.code === 'can_beta_false')
  assert.ok(inv, 'Expected invariant can_beta_false')
  assert.strictEqual(inv.passed, false)
  assert.strictEqual(result.safety_invariant_validation.passed, false)
})

test('T4: can_sell=true → can_sell_false has passed=false', () => {
  const result = evaluateSafetyInvariantSnapshot({ can_sell: true })
  const inv = result.safety_invariant_snapshot.invariants.find(i => i.code === 'can_sell_false')
  assert.ok(inv, 'Expected invariant can_sell_false')
  assert.strictEqual(inv.passed, false)
})

test('T5: download_enabled=true → download_enabled_false has passed=false', () => {
  const result = evaluateSafetyInvariantSnapshot({ download_enabled: true })
  const inv = result.safety_invariant_snapshot.invariants.find(i => i.code === 'download_enabled_false')
  assert.ok(inv, 'Expected invariant download_enabled_false')
  assert.strictEqual(inv.passed, false)
})

test('T6: storage_write_enabled=true → storage_write_enabled_false has passed=false', () => {
  const result = evaluateSafetyInvariantSnapshot({ storage_write_enabled: true })
  const inv = result.safety_invariant_snapshot.invariants.find(i => i.code === 'storage_write_enabled_false')
  assert.ok(inv, 'Expected invariant storage_write_enabled_false')
  assert.strictEqual(inv.passed, false)
})

test('T7: unfreeze_enabled=true and controlled_unfreeze_active=true → both unfreeze invariants failed', () => {
  const result = evaluateSafetyInvariantSnapshot({ unfreeze_enabled: true, controlled_unfreeze_active: true })
  const invUnfreeze = result.safety_invariant_snapshot.invariants.find(i => i.code === 'unfreeze_enabled_false')
  const invControlled = result.safety_invariant_snapshot.invariants.find(i => i.code === 'controlled_unfreeze_active_false')
  assert.ok(invUnfreeze, 'Expected invariant unfreeze_enabled_false')
  assert.strictEqual(invUnfreeze.passed, false)
  assert.ok(invControlled, 'Expected invariant controlled_unfreeze_active_false')
  assert.strictEqual(invControlled.passed, false)
})

test('T8: safe input → summary.status=safe, safe_to_sell=false, safe_to_invite_private_users=false', () => {
  const result = evaluateSafetyInvariantSnapshot({})
  assert.strictEqual(result.safety_invariant_summary.status, 'safe')
  assert.strictEqual(result.safety_invariant_summary.safe_to_sell, false)
  assert.strictEqual(result.safety_invariant_summary.safe_to_invite_private_users, false)
})

test('T9: JSON.stringify(evaluateSafetyInvariantSnapshot({})) does not throw', () => {
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(evaluateSafetyInvariantSnapshot({})) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
