// src/services/simulatedCohortMonitor.test.js
// P3.8.14 — 25 tests for Simulated Cohort Performance Monitor

import assert from 'assert'
import {
  normalizeMonitorNumber,
  classifyLedgerHealth,
  computeLedgerExposure,
  detectDeliveryDrift,
  buildOperatorApprovalChecklist,
  buildSandboxPerformanceSummary,
  buildCohortMonitoringReview,
  evaluateSimulatedCohortMonitor,
} from './simulatedCohortMonitor.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function deliverEntry(segKey = 'seg_a', dim = 'market') {
  return { status: 'would_deliver', segment_key: segKey, dimension: dim, odd: 1.8, created_at: new Date().toISOString() }
}

function blockEntry(segKey = 'seg_a', dim = 'market') {
  return { status: 'would_block', segment_key: segKey, dimension: dim, odd: 1.8, created_at: new Date().toISOString() }
}

function makeLedger(entries) {
  const delivered = entries.filter(e => e.status === 'would_deliver').length
  const blocked   = entries.filter(e => e.status === 'would_block').length
  return { entries, entries_count: entries.length, delivered_count: delivered, blocked_count: blocked }
}

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

test('T1: empty input → disabled/not_started, empty ledger, not_available drift, blocked checklist', () => {
  const result = evaluateSimulatedCohortMonitor({})
  assert.ok(
    ['disabled', 'not_started'].includes(result.simulated_cohort_monitor.status),
    `Expected disabled/not_started, got ${result.simulated_cohort_monitor.status}`
  )
  assert.strictEqual(result.ledger_health.status, 'empty')
  assert.strictEqual(result.delivery_drift_report.status, 'not_available')
  assert.strictEqual(result.operator_approval_checklist.status, 'blocked')
  assert.strictEqual(result.cohort_monitoring_review.can_sell, false)
  assert.strictEqual(result.cohort_monitoring_review.can_invite_private_users, false)
})

test('T2: empty ledger entries → score=0, grade=not_available, no deliveries/blocks', () => {
  const health = classifyLedgerHealth({ entries: [] })
  assert.strictEqual(health.score, 0)
  assert.strictEqual(health.grade, 'not_available')
  assert.strictEqual(health.has_deliveries, false)
  assert.strictEqual(health.has_blocks, false)
  assert.strictEqual(health.entries_count, 0)
})

test('T3: 3 would_deliver entries → delivered_count=3, has_deliveries=true, score>0', () => {
  const entries = [deliverEntry('seg_a'), deliverEntry('seg_b'), deliverEntry('seg_c')]
  const health = classifyLedgerHealth(makeLedger(entries))
  assert.strictEqual(health.delivered_count, 3)
  assert.strictEqual(health.has_deliveries, true)
  assert.ok(health.score > 0, `Expected score > 0, got ${health.score}`)
})

test('T4: 2 would_block entries → blocked_count=2, has_blocks=true', () => {
  const entries = [blockEntry('seg_a'), blockEntry('seg_b')]
  const health = classifyLedgerHealth(makeLedger(entries))
  assert.strictEqual(health.blocked_count, 2)
  assert.strictEqual(health.has_blocks, true)
})

test('T5: entries at max_ledger_entries → truncated=true or warning', () => {
  const entries = Array.from({ length: 5 }, (_, i) => deliverEntry(`seg_${i}`))
  const health = classifyLedgerHealth({ entries }, { max_ledger_entries: 5 })
  const flagged = health.truncated === true || health.warnings.includes('ledger_at_max_capacity')
  assert.ok(flagged, `Expected truncated=true or ledger_at_max_capacity warning, got ${JSON.stringify({ truncated: health.truncated, warnings: health.warnings })}`)
})

test('T6: 80% same segment_key → single_segment_share>=0.8, segment_exposure_drift warning', () => {
  const entries = [
    deliverEntry('seg_a'), deliverEntry('seg_a'), deliverEntry('seg_a'),
    deliverEntry('seg_a'), deliverEntry('seg_b'),
  ]
  const result = evaluateSimulatedCohortMonitor({
    simulated_delivery_ledger: makeLedger(entries),
    private_beta_sandbox: { status: 'running_simulation', enabled: true },
  })
  assert.ok(
    result.ledger_exposure.single_segment_share >= 0.8,
    `Expected >=0.8, got ${result.ledger_exposure.single_segment_share}`
  )
  assert.ok(
    result.delivery_drift_report.warnings.includes('segment_exposure_drift'),
    `Expected segment_exposure_drift in warnings: ${JSON.stringify(result.delivery_drift_report.warnings)}`
  )
})

test('T7: entries with odds_bucket=2.50+ above limit → odds_exposure_drift warning', () => {
  const entries = [
    { status: 'would_deliver', segment_key: 'seg_a', odds_bucket: '2.50+', dimension: 'market' },
    { status: 'would_deliver', segment_key: 'seg_b', odds_bucket: '2.50+', dimension: 'market' },
    { status: 'would_deliver', segment_key: 'seg_c', odds_bucket: '2.50+', dimension: 'market' },
    { status: 'would_block',   segment_key: 'seg_d', dimension: 'market' },
  ]
  const result = evaluateSimulatedCohortMonitor({
    simulated_delivery_ledger: makeLedger(entries),
    private_beta_sandbox: { status: 'running_simulation', enabled: true },
  })
  assert.ok(
    result.delivery_drift_report.warnings.includes('odds_exposure_drift'),
    `Expected odds_exposure_drift warning, got: ${JSON.stringify(result.delivery_drift_report.warnings)}`
  )
})

test('T8: candidate_segments present, no delivery, sandbox enabled → candidate_to_delivery_drift', () => {
  const entries = [blockEntry('seg_a'), blockEntry('seg_b')]
  const result = evaluateSimulatedCohortMonitor({
    simulated_delivery_ledger: makeLedger(entries),
    candidate_segments: [{ segment: 'seg_a', health_score: 80 }, { segment: 'seg_b', health_score: 75 }],
    private_beta_sandbox: { status: 'running_simulation', enabled: true },
  })
  assert.ok(
    result.delivery_drift_report.top_drift_factors.includes('candidate_to_delivery_drift'),
    `Expected candidate_to_delivery_drift, got: ${JSON.stringify(result.delivery_drift_report.top_drift_factors)}`
  )
})

test('T9: risk_segments present, no block in ledger → risk_to_block_drift warning', () => {
  const entries = [deliverEntry('seg_a'), deliverEntry('seg_b')]
  const result = evaluateSimulatedCohortMonitor({
    simulated_delivery_ledger: makeLedger(entries),
    risk_segments: [{ segment: 'seg_x', risk_level: 'high' }, { segment: 'seg_y', risk_level: 'high' }],
  })
  assert.ok(
    result.delivery_drift_report.warnings.includes('risk_to_block_drift'),
    `Expected risk_to_block_drift warning: ${JSON.stringify(result.delivery_drift_report.warnings)}`
  )
})

test('T10: delivered_count=5 > max_picks_per_run=3 → policy_vs_ledger_drift blocker', () => {
  const entries = Array.from({ length: 5 }, (_, i) => deliverEntry(`seg_${i}`))
  const result = evaluateSimulatedCohortMonitor(
    { simulated_delivery_ledger: makeLedger(entries) },
    { max_picks_per_run: 3 }
  )
  assert.ok(
    result.delivery_drift_report.blockers.includes('policy_vs_ledger_drift'),
    `Expected policy_vs_ledger_drift blocker: ${JSON.stringify(result.delivery_drift_report.blockers)}`
  )
})

test('T11: sandbox_audit_summary.status=critical_violation → monitor=critical_violation, review=critical_violation', () => {
  const result = evaluateSimulatedCohortMonitor({
    sandbox_audit_summary: { status: 'critical_violation' },
  })
  assert.strictEqual(result.simulated_cohort_monitor.status, 'critical_violation')
  assert.strictEqual(result.cohort_monitoring_review.status, 'critical_violation')
})

test('T12: micro_test_active=false → checklist=blocked, micro_test_active item passed=false', () => {
  const result = evaluateSimulatedCohortMonitor({ micro_test_active: false })
  assert.strictEqual(result.operator_approval_checklist.status, 'blocked')
  const item = result.operator_approval_checklist.items.find(i => i.code === 'micro_test_active')
  assert.ok(item, 'Expected micro_test_active item in checklist')
  assert.strictEqual(item.passed, false)
})

test('T13: empty ledger → ledger_generated item passed=false', () => {
  const result = evaluateSimulatedCohortMonitor({
    simulated_delivery_ledger: { entries: [], entries_count: 0 },
  })
  const item = result.operator_approval_checklist.items.find(i => i.code === 'ledger_generated')
  assert.ok(item, 'Expected ledger_generated item in checklist')
  assert.strictEqual(item.passed, false)
})

test('T14: ledger with entries → ledger_generated=true, ledger_health_usable=true', () => {
  const entries = [
    deliverEntry('seg_a'), deliverEntry('seg_b'), deliverEntry('seg_c'),
    blockEntry('seg_a'), blockEntry('seg_b'),
  ]
  const result = evaluateSimulatedCohortMonitor({
    simulated_delivery_ledger: makeLedger(entries),
  })
  const itemGen = result.operator_approval_checklist.items.find(i => i.code === 'ledger_generated')
  assert.ok(itemGen, 'Expected ledger_generated item')
  assert.strictEqual(itemGen.passed, true)
  const itemHealth = result.operator_approval_checklist.items.find(i => i.code === 'ledger_health_usable')
  assert.ok(itemHealth, 'Expected ledger_health_usable item')
  assert.strictEqual(itemHealth.passed, true)
})

test('T15: safe flags false → no_real_users/no_real_delivery/sell_blocked passed', () => {
  const result = evaluateSimulatedCohortMonitor({ real_users: false, real_delivery: false, can_sell: false })
  const noRealUsers    = result.operator_approval_checklist.items.find(i => i.code === 'no_real_users')
  const noRealDelivery = result.operator_approval_checklist.items.find(i => i.code === 'no_real_delivery')
  const sellBlocked    = result.operator_approval_checklist.items.find(i => i.code === 'sell_blocked')
  assert.strictEqual(noRealUsers.passed, true)
  assert.strictEqual(noRealDelivery.passed, true)
  assert.strictEqual(sellBlocked.passed, true)
})

test('T16: can_sell=true in input → output can_sell=false, sell_blocked failed, blocker registered', () => {
  const result = evaluateSimulatedCohortMonitor({ can_sell: true })
  assert.strictEqual(result.cohort_monitoring_review.can_sell, false)
  const sellBlocked = result.operator_approval_checklist.items.find(i => i.code === 'sell_blocked')
  assert.ok(sellBlocked, 'Expected sell_blocked item')
  assert.strictEqual(sellBlocked.passed, false)
  assert.ok(
    result.operator_approval_checklist.blockers.includes('sell_blocked'),
    `Expected sell_blocked in blockers: ${JSON.stringify(result.operator_approval_checklist.blockers)}`
  )
})

test('T17: real_users=true in input → output real_users=false, critical violation or blocker', () => {
  const result = evaluateSimulatedCohortMonitor({ real_users: true })
  assert.strictEqual(result.simulated_cohort_monitor.real_users, false)
  const isViolation =
    result.simulated_cohort_monitor.status === 'critical_violation' ||
    result.operator_approval_checklist.blockers.includes('no_real_users') ||
    result.cohort_monitoring_review.status === 'critical_violation'
  assert.ok(isViolation, 'Expected critical violation or no_real_users blocker when real_users=true')
})

test('T18: real_delivery=true in input → output real_delivery=false, critical violation or blocker', () => {
  const result = evaluateSimulatedCohortMonitor({ real_delivery: true })
  assert.strictEqual(result.simulated_cohort_monitor.real_delivery, false)
  const isViolation =
    result.simulated_cohort_monitor.status === 'critical_violation' ||
    result.operator_approval_checklist.blockers.includes('no_real_delivery') ||
    result.cohort_monitoring_review.status === 'critical_violation'
  assert.ok(isViolation, 'Expected critical violation or no_real_delivery blocker when real_delivery=true')
})

test('T19: empty ledger, no sandbox → performance_summary.status=not_started, safe flags false', () => {
  const result = evaluateSimulatedCohortMonitor({
    simulated_delivery_ledger: { entries: [], entries_count: 0 },
  })
  assert.ok(
    ['not_started', 'blocked', 'needs_data'].includes(result.sandbox_performance_summary.status),
    `Unexpected performance status: ${result.sandbox_performance_summary.status}`
  )
  assert.strictEqual(result.sandbox_performance_summary.safe_to_invite_private_users, false)
  assert.strictEqual(result.sandbox_performance_summary.safe_to_sell, false)
})

test('T20: healthy ledger, sandbox enabled, no drift blockers → performance_summary healthy or watch, safe flags false', () => {
  const entries = [
    deliverEntry('seg_0'), deliverEntry('seg_1'), deliverEntry('seg_2'), deliverEntry('seg_3'),
    blockEntry('seg_0'), blockEntry('seg_1'), blockEntry('seg_2'),
  ]
  const result = evaluateSimulatedCohortMonitor(
    {
      simulated_delivery_ledger: makeLedger(entries),
      private_beta_sandbox: { status: 'running_simulation', enabled: true },
    },
    { max_picks_per_run: 10 }
  )
  assert.ok(
    ['healthy_simulation', 'watch'].includes(result.sandbox_performance_summary.status),
    `Expected healthy_simulation or watch, got: ${result.sandbox_performance_summary.status}`
  )
  assert.strictEqual(result.sandbox_performance_summary.safe_to_invite_private_users, false)
  assert.strictEqual(result.sandbox_performance_summary.safe_to_sell, false)
})

test('T21: private_beta_sandbox.status=disabled → review=sandbox_disabled, can_run_sandbox=false', () => {
  const result = evaluateSimulatedCohortMonitor({
    private_beta_sandbox: { status: 'disabled' },
  })
  assert.strictEqual(result.cohort_monitoring_review.status, 'sandbox_disabled')
  assert.strictEqual(result.cohort_monitoring_review.can_run_sandbox, false)
})

test('T22: sandbox completed + healthy ledger + micro_test_active → review=operator_review_ready or monitoring_ready', () => {
  const entries = [
    deliverEntry('seg_0'), deliverEntry('seg_1'), deliverEntry('seg_2'), deliverEntry('seg_3'),
    blockEntry('seg_0'), blockEntry('seg_1'), blockEntry('seg_2'),
  ]
  const result = evaluateSimulatedCohortMonitor(
    {
      simulated_delivery_ledger: makeLedger(entries),
      private_beta_sandbox: { status: 'completed', enabled: true },
      micro_test_active: true,
      beta_admission_contract: { status: 'simulation_ready' },
      manual_approval_gate: { required: true, status: 'pending' },
      private_cohort_simulation: { enabled: false, status: 'not_started' },
    },
    { max_picks_per_run: 10, max_ledger_entries: 25 }
  )
  assert.ok(
    ['operator_review_ready', 'monitoring_ready'].includes(result.cohort_monitoring_review.status),
    `Expected operator_review_ready or monitoring_ready, got: ${result.cohort_monitoring_review.status}`
  )
  assert.strictEqual(result.cohort_monitoring_review.can_invite_private_users, false)
  assert.strictEqual(result.cohort_monitoring_review.can_sell, false)
})

test('T23: JSON.stringify(evaluateSimulatedCohortMonitor({})) does not throw', () => {
  const result = evaluateSimulatedCohortMonitor({})
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON string')
})

test('T24: partial input (only ledger entries) → no exception', () => {
  const entries = [deliverEntry()]
  assert.doesNotThrow(() => {
    evaluateSimulatedCohortMonitor({ simulated_delivery_ledger: { entries } })
  })
})

test('T25: completed monitoring → can_beta=false, can_sell=false, safe flags false throughout', () => {
  const entries = [
    deliverEntry('seg_0'), deliverEntry('seg_1'), deliverEntry('seg_2'),
    deliverEntry('seg_3'), deliverEntry('seg_4'),
    blockEntry('seg_0'), blockEntry('seg_1'), blockEntry('seg_2'), blockEntry('seg_3'),
  ]
  const result = evaluateSimulatedCohortMonitor(
    {
      simulated_delivery_ledger: makeLedger(entries),
      private_beta_sandbox: { status: 'completed', enabled: true },
      micro_test_active: true,
    },
    { max_picks_per_run: 10 }
  )
  assert.strictEqual(result.cohort_monitoring_review.can_sell, false)
  assert.strictEqual(result.cohort_monitoring_review.can_invite_private_users, false)
  assert.strictEqual(result.cohort_monitoring_review.can_open_public_beta, false)
  assert.strictEqual(result.sandbox_performance_summary.safe_to_invite_private_users, false)
  assert.strictEqual(result.sandbox_performance_summary.safe_to_sell, false)
  assert.strictEqual(result.simulated_cohort_monitor.real_users, false)
  assert.strictEqual(result.simulated_cohort_monitor.real_delivery, false)
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
