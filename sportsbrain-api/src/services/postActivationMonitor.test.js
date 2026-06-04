// postActivationMonitor.test.js
import { evaluatePostActivationMonitor } from './postActivationMonitor.js'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`)
    failed++
  }
}

// ─── T1: not active default ───────────────────────────────────────────────────
test('T1 — not active default', () => {
  const result = evaluatePostActivationMonitor({ micro_test_active: false })
  assert(
    result.post_activation_monitor.status === 'not_active',
    `expected 'not_active', got '${result.post_activation_monitor.status}'`,
  )
  assert(
    result.post_activation_monitor.monitoring_started === false,
    `expected monitoring_started=false, got ${result.post_activation_monitor.monitoring_started}`,
  )
})

// ─── T2: waiting for report ───────────────────────────────────────────────────
test('T2 — waiting for report', () => {
  const result = evaluatePostActivationMonitor({
    micro_test_active: true,
    micro_test_report: { status: 'not_started' },
  })
  assert(
    result.post_activation_monitor.status === 'waiting_for_report',
    `expected 'waiting_for_report', got '${result.post_activation_monitor.status}'`,
  )
})

// ─── T3: monitoring active ────────────────────────────────────────────────────
test('T3 — monitoring active', () => {
  const result = evaluatePostActivationMonitor({
    micro_test_active: true,
    micro_test_report: { status: 'active' },
  })
  const validStatuses = ['monitoring_active', 'quality_snapshot_available']
  assert(
    validStatuses.includes(result.post_activation_monitor.status),
    `expected one of ${JSON.stringify(validStatuses)}, got '${result.post_activation_monitor.status}'`,
  )
  assert(
    result.post_activation_monitor.monitoring_started === true,
    `expected monitoring_started=true, got ${result.post_activation_monitor.monitoring_started}`,
  )
})

// ─── T4: progress milestones with resolved_valid=12 ──────────────────────────
test('T4 — progress milestones with resolved_valid=12', () => {
  const result = evaluatePostActivationMonitor({ resolved_valid: 12 })
  const m30 = result.micro_test_progress_tracker.milestones.find((m) => m.target === 30)
  assert(
    m30 !== undefined,
    'milestone with target=30 not found',
  )
  assert(
    m30.remaining === 18,
    `expected remaining=18, got ${m30.remaining}`,
  )
  assert(
    result.micro_test_progress_tracker.progress_pct_to_30 === 40,
    `expected progress_pct_to_30=40, got ${result.micro_test_progress_tracker.progress_pct_to_30}`,
  )
})

// ─── T5: progress reached threshold ──────────────────────────────────────────
test('T5 — progress reached threshold', () => {
  const result = evaluatePostActivationMonitor({ resolved_valid: 30 })
  const m30 = result.micro_test_progress_tracker.milestones.find((m) => m.target === 30)
  assert(
    m30 !== undefined,
    'milestone with target=30 not found',
  )
  assert(
    m30.reached === true,
    `expected reached=true, got ${m30.reached}`,
  )
})

// ─── T6: post activation checks include micro_test_active and no_beta_no_sell ─
test('T6 — post activation checks include micro_test_active and no_beta_no_sell', () => {
  const result = evaluatePostActivationMonitor({})
  assert(
    result.post_activation_checks.checks.some((c) => c.name === 'micro_test_active'),
    'check micro_test_active not found',
  )
  assert(
    result.post_activation_checks.checks.some(
      (c) => c.name === 'no_beta_no_sell' && c.passed === true,
    ),
    'check no_beta_no_sell with passed=true not found',
  )
})

// ─── T7: operator notes status present ───────────────────────────────────────
test('T7 — operator notes status present', () => {
  const result = evaluatePostActivationMonitor({})
  assert(
    typeof result.post_activation_operator_notes.status === 'string',
    `expected status to be a string, got ${typeof result.post_activation_operator_notes.status}`,
  )
  assert(
    result.post_activation_operator_notes.can_beta === false,
    `expected can_beta=false, got ${result.post_activation_operator_notes.can_beta}`,
  )
  assert(
    result.post_activation_operator_notes.can_sell === false,
    `expected can_sell=false, got ${result.post_activation_operator_notes.can_sell}`,
  )
})

// ─── T8: output is serializable ──────────────────────────────────────────────
test('T8 — output is serializable', () => {
  let threw = false
  try {
    JSON.stringify(evaluatePostActivationMonitor({}))
  } catch (_e) {
    threw = true
  }
  assert(!threw, 'JSON.stringify threw an error — output is not serializable')
})

// ─── results ─────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests`)
if (failed > 0) process.exit(1)
