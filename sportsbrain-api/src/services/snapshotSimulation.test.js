// src/services/snapshotSimulation.test.js
// P3.8.18 — 8 tests for Snapshot Simulation

import assert from 'assert'
import {
  buildCurrentDecisionSnapshot,
  buildSyntheticHistoricalSnapshots,
  compareDecisionSnapshots,
  buildSnapshotDiffReport,
  evaluateSnapshotSimulation,
} from './snapshotSimulation.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('T1: current snapshot has snapshot_id=current, fingerprint present, can_beta=false, can_sell=false', () => {
  const result  = evaluateSnapshotSimulation({
    decision_fingerprint: { value: 'sb-p3.8.17-aabbccdd' },
  })
  const current = result.historical_snapshot_simulation.current_snapshot
  assert.strictEqual(current.snapshot_id, 'current')
  assert.strictEqual(current.fingerprint,  'sb-p3.8.17-aabbccdd')
  assert.strictEqual(current.can_beta,     false)
  assert.strictEqual(current.can_sell,     false)
})

test('T2: synthetic snapshots include previous_shadow_state, unsafe_input_scenario, manual_review_ready_scenario', () => {
  const result  = evaluateSnapshotSimulation({})
  const snapIds = result.historical_snapshot_simulation.snapshots.map(s => s.snapshot_id)
  assert.ok(snapIds.includes('previous_shadow_state'),       'Missing previous_shadow_state')
  assert.ok(snapIds.includes('unsafe_input_scenario'),       'Missing unsafe_input_scenario')
  assert.ok(snapIds.includes('manual_review_ready_scenario'),'Missing manual_review_ready_scenario')
})

test('T3: simulation has persistence_enabled=false, simulation_only=true', () => {
  const result = evaluateSnapshotSimulation({})
  const sim    = result.historical_snapshot_simulation
  assert.strictEqual(sim.persistence_enabled, false)
  assert.strictEqual(sim.simulation_only,      true)
  assert.strictEqual(sim.status,              'simulated')
})

test('T4: compareDecisionSnapshots with identical snapshots → critical_diffs_count=0', () => {
  const snap = {
    snapshot_id:      'test',
    fingerprint:      'sb-p3.8.17-aabbccdd',
    decision:         'continue_shadow',
    overall_grade:    'blocked',
    can_beta:         false,
    can_sell:         false,
    release_allowed:  false,
    real_delivery:    false,
    hard_lock_enabled: true,
  }
  const result = compareDecisionSnapshots(snap, snap)
  assert.strictEqual(result.critical_diffs_count, 0)
})

test('T5: compareDecisionSnapshots detects can_beta=true as critical diff', () => {
  const current = { snapshot_id: 'current', can_beta: false, can_sell: false, decision: 'continue_shadow' }
  const unsafe  = { snapshot_id: 'unsafe',  can_beta: true,  can_sell: false, decision: 'continue_shadow' }
  const result  = compareDecisionSnapshots(current, unsafe)
  assert.ok(result.critical_diffs_count > 0, 'Expected critical diffs for can_beta=true')
  const criticalDiff = result.diffs.find(d => d.field === 'can_beta' && d.critical)
  assert.ok(criticalDiff, 'Expected can_beta critical diff in diffs array')
})

test('T6: compareDecisionSnapshots detects decision=launch as critical diff', () => {
  const current  = { snapshot_id: 'current', decision: 'continue_shadow', can_beta: false }
  const launcher = { snapshot_id: 'launch',  decision: 'launch',          can_beta: false }
  const result   = compareDecisionSnapshots(current, launcher)
  assert.ok(result.critical_diffs_count > 0, 'Expected critical diffs for decision=launch')
  const criticalDiff = result.diffs.find(d => d.field === 'decision' && d.critical)
  assert.ok(criticalDiff, 'Expected decision critical diff in diffs array')
})

test('T7: different fingerprints → fingerprint_changed=true in compareDecisionSnapshots', () => {
  const snap1 = { snapshot_id: 's1', fingerprint: 'sb-p3.8.17-aaaaaaaa', decision: 'continue_shadow' }
  const snap2 = { snapshot_id: 's2', fingerprint: 'sb-p3.8.17-bbbbbbbb', decision: 'continue_shadow' }
  const result = compareDecisionSnapshots(snap1, snap2)
  assert.strictEqual(result.fingerprint_changed, true)
})

test('T8: JSON.stringify(evaluateSnapshotSimulation({})) does not throw', () => {
  const result = evaluateSnapshotSimulation({})
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
