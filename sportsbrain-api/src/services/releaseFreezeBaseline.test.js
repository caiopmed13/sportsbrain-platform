// src/services/releaseFreezeBaseline.test.js
// P3.8.24 — 9 tests for Release Freeze Baseline Registry & Audit

import assert from 'assert'
import {
  evaluateReleaseFreezeBaseline,
  buildBaselineComparisonReport,
  FROZEN_CAPABILITIES,
} from './releaseFreezeBaseline.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1: default input → registry.status=registered, baseline_locked=true, persistence_enabled=false
test('T1: default input → registry.status=registered, baseline_locked=true, persistence_enabled=false', () => {
  const result = evaluateReleaseFreezeBaseline({})
  const reg = result.release_freeze_baseline_registry
  assert.strictEqual(reg.status,              'registered')
  assert.strictEqual(reg.baseline_locked,     true)
  assert.strictEqual(reg.persistence_enabled, false)
})

// T2: frozen capabilities include beta, sell, download, storage_write, real_delivery, unfreeze
test('T2: frozen capabilities include beta, sell, download, storage_write, real_delivery, unfreeze', () => {
  const result = evaluateReleaseFreezeBaseline({})
  const codes = result.release_freeze_baseline_registry.frozen_capabilities.map(c => c.code)
  for (const cap of ['beta', 'sell', 'download', 'storage_write', 'real_delivery', 'unfreeze']) {
    assert.ok(codes.includes(cap), `Expected frozen capability: ${cap}`)
  }
})

// T3: baseline_flags always false (can_beta, can_sell, storage_write_enabled, unfreeze_enabled)
test('T3: baseline_flags.can_beta, can_sell, storage_write_enabled, unfreeze_enabled all false', () => {
  const result = evaluateReleaseFreezeBaseline({})
  const flags = result.release_freeze_baseline_registry.baseline_flags
  assert.strictEqual(flags.can_beta,               false)
  assert.strictEqual(flags.can_sell,               false)
  assert.strictEqual(flags.storage_write_enabled,  false)
  assert.strictEqual(flags.unfreeze_enabled,       false)
})

// T4: safe input → comparison_report.matched=true, critical_mismatches_count=0
test('T4: safe input → comparison_report.matched=true, critical_mismatches_count=0', () => {
  const result = evaluateReleaseFreezeBaseline({})
  const report = result.baseline_comparison_report
  assert.strictEqual(report.matched,                   true)
  assert.strictEqual(report.critical_mismatches_count, 0)
})

// T5: input can_sell=true → matched=false, mismatch for can_sell, freeze_registry_summary.can_sell=false
test('T5: input can_sell=true → matched=false, mismatch entry for can_sell, summary.can_sell=false', () => {
  const result = evaluateReleaseFreezeBaseline({ can_sell: true })
  const report = result.baseline_comparison_report
  assert.strictEqual(report.matched, false)
  assert.ok(
    report.mismatches.some(m => m.flag === 'can_sell'),
    `Expected mismatch entry for can_sell: ${JSON.stringify(report.mismatches)}`
  )
  assert.strictEqual(result.freeze_registry_summary.can_sell, false)
})

// T6: input unfreeze_enabled=true → mismatch entry for unfreeze_enabled in comparison report
test('T6: input unfreeze_enabled=true → mismatch entry for unfreeze_enabled', () => {
  const result = evaluateReleaseFreezeBaseline({ unfreeze_enabled: true })
  const report = result.baseline_comparison_report
  assert.ok(
    report.mismatches.some(m => m.flag === 'unfreeze_enabled'),
    `Expected mismatch for unfreeze_enabled: ${JSON.stringify(report.mismatches)}`
  )
})

// T7: audit.entries includes baseline_registry_built and no_unfreeze_confirmed
test('T7: audit.entries includes baseline_registry_built and no_unfreeze_confirmed', () => {
  const result = evaluateReleaseFreezeBaseline({})
  const entryIds = result.freeze_baseline_audit.entries.map(e => e.entry_id)
  assert.ok(entryIds.includes('baseline_registry_built'),  'Expected baseline_registry_built entry')
  assert.ok(entryIds.includes('no_unfreeze_confirmed'),    'Expected no_unfreeze_confirmed entry')
})

// T8: freeze_registry_summary.can_unfreeze_now=false, can_beta=false, can_sell=false
test('T8: freeze_registry_summary.can_unfreeze_now=false, can_beta=false, can_sell=false', () => {
  const result = evaluateReleaseFreezeBaseline({})
  const summary = result.freeze_registry_summary
  assert.strictEqual(summary.can_unfreeze_now, false)
  assert.strictEqual(summary.can_beta,         false)
  assert.strictEqual(summary.can_sell,         false)
})

// T9: JSON.stringify(evaluateReleaseFreezeBaseline({})) does not throw
test('T9: JSON.stringify(evaluateReleaseFreezeBaseline({})) does not throw', () => {
  assert.doesNotThrow(() => JSON.stringify(evaluateReleaseFreezeBaseline({})))
})

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
