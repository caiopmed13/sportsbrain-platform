// src/services/firstRealQualitySnapshot.test.js
// P3.9.1 — 9 tests for First Real Quality Snapshot

import { evaluateFirstRealQualitySnapshot } from './firstRealQualitySnapshot.js'

let passed = 0
let failed = 0
const errors = []

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

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

test('T1: seed snapshot when inactive with sample', () => {
  const result = evaluateFirstRealQualitySnapshot({
    micro_test_active: false,
    resolved_sample_audit: { resolved_valid: 12, green_count: 7, red_count: 5 },
  })
  assert(
    ['seed_snapshot', 'insufficient_sample'].includes(result.first_real_quality_snapshot.status),
    `Expected seed_snapshot or insufficient_sample, got: ${result.first_real_quality_snapshot.status}`
  )
})

test('T2: active snapshot', () => {
  const result = evaluateFirstRealQualitySnapshot({
    micro_test_active: true,
    micro_test_report: {
      status: 'active',
      quality_score: 55,
      quality_grade: 'early_signal',
      decision_state: 'monitoring',
    },
    resolved_sample_audit: { resolved_valid: 30, green_count: 18, red_count: 12 },
  })
  assert(
    ['active_snapshot', 'quality_watch', 'quality_promising', 'quality_risky'].includes(result.first_real_quality_snapshot.status),
    `Expected active status, got: ${result.first_real_quality_snapshot.status}`
  )
  assert(
    result.first_real_quality_snapshot.micro_test_report_active === true,
    `Expected micro_test_report_active=true, got: ${result.first_real_quality_snapshot.micro_test_report_active}`
  )
})

test('T3: hit rate computed correctly', () => {
  const result = evaluateFirstRealQualitySnapshot({ green_count: 18, red_count: 12 })
  assert(
    Math.abs(result.first_real_quality_snapshot.hit_rate - 0.6) < 0.001,
    `Expected hit_rate≈0.6, got: ${result.first_real_quality_snapshot.hit_rate}`
  )
})

test('T4: risk sample_too_small triggered for sample_size=12', () => {
  const result = evaluateFirstRealQualitySnapshot({ sample_size: 12 })
  const flag = result.quality_snapshot_risk_flags.flags.find(f => f.name === 'sample_too_small')
  assert(flag !== undefined, 'Expected sample_too_small flag to exist')
  assert(
    flag.triggered === true,
    `Expected sample_too_small.triggered=true, got: ${flag.triggered}`
  )
})

test('T5: risk hit_rate_below_50 triggered for hit_rate=0.4', () => {
  const result = evaluateFirstRealQualitySnapshot({ green_count: 6, red_count: 9, sample_size: 15 })
  const flag = result.quality_snapshot_risk_flags.flags.find(f => f.name === 'hit_rate_below_50')
  assert(flag !== undefined, 'Expected hit_rate_below_50 flag to exist')
  assert(
    flag.triggered === true,
    `Expected hit_rate_below_50.triggered=true, got: ${flag.triggered}`
  )
})

test('T6: distribution has by_sport array', () => {
  const result = evaluateFirstRealQualitySnapshot({
    resolved_sample_distribution: {
      by_sport: [{ key: 'football', count: 10, green: 6, red: 4, hit_rate: 0.6 }],
    },
  })
  assert(
    Array.isArray(result.quality_snapshot_distribution.by_sport),
    'Expected by_sport to be an array'
  )
  assert(
    result.quality_snapshot_distribution.by_sport.length > 0,
    'Expected by_sport to have at least one entry'
  )
})

test('T7: summary safe_to_beta and safe_to_sell always false', () => {
  const result = evaluateFirstRealQualitySnapshot({})
  assert(
    result.quality_snapshot_summary.safe_to_beta === false,
    `Expected safe_to_beta=false, got: ${result.quality_snapshot_summary.safe_to_beta}`
  )
  assert(
    result.quality_snapshot_summary.safe_to_sell === false,
    `Expected safe_to_sell=false, got: ${result.quality_snapshot_summary.safe_to_sell}`
  )
})

test('T8: unsafe can_sell sanitized', () => {
  const result = evaluateFirstRealQualitySnapshot({ can_sell: true })
  assert(
    result.first_real_quality_snapshot.can_sell === false,
    `Expected can_sell=false in snapshot, got: ${result.first_real_quality_snapshot.can_sell}`
  )
  assert(
    result.quality_snapshot_summary.safe_to_sell === false,
    `Expected safe_to_sell=false in summary, got: ${result.quality_snapshot_summary.safe_to_sell}`
  )
})

test('T9: output is serializable', () => {
  let threw = false
  try {
    JSON.stringify(evaluateFirstRealQualitySnapshot({}))
  } catch (err) {
    threw = true
  }
  assert(!threw, 'Expected JSON.stringify not to throw')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
