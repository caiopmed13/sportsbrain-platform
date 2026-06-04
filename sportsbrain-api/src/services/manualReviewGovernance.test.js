// src/services/manualReviewGovernance.test.js
// P3.8.16 — 25 tests for Manual Review Governance

import assert from 'assert'
import {
  normalizeReviewBoolean,
  buildManualReviewArtifact,
  evaluateApprovalSimulation,
  buildNoLaunchGovernance,
  buildReleaseHardLocks,
  buildOperatorReviewAuditTrail,
  buildManualReviewSummary,
  evaluateManualReviewGovernance,
} from './manualReviewGovernance.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function manualReviewReadyInput() {
  return {
    operator_decision_packet:  { status: 'manual_review_ready',  decision: 'ready_for_manual_review' },
    launch_no_launch_decision: { decision: 'ready_for_manual_review', can_launch: false, can_sell: false },
    decision_evidence_matrix:  { overall_score: 70, overall_grade: 'review_candidate',
      passed_domains_count: 7, blocked_domains_count: 4 },
    governance_audit_summary:  { status: 'clean', unsafe_input_detected: false },
    can_beta: false, can_sell: false, real_users: false, real_delivery: false,
  }
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

test('T1: empty input → artifact blocked/not_ready, simulation disabled, governance locked, release_allowed=false', () => {
  const result = evaluateManualReviewGovernance({})
  assert.ok(
    ['blocked', 'not_ready'].includes(result.manual_review_artifact.status),
    `Expected blocked or not_ready, got: ${result.manual_review_artifact.status}`
  )
  assert.strictEqual(result.approval_simulation.status, 'disabled')
  assert.strictEqual(result.no_launch_governance.status, 'locked')
  assert.strictEqual(result.no_launch_governance.release_allowed, false)
  assert.strictEqual(result.manual_review_summary.safe_to_invite_private_users, false)
  assert.strictEqual(result.manual_review_summary.safe_to_sell, false)
})

test('T2: artifact sections include minimum required codes', () => {
  const result = evaluateManualReviewGovernance({})
  const codes = result.manual_review_artifact.sections.map(s => s.code)
  const required = [
    'executive_summary', 'current_decision', 'readiness_snapshot',
    'governance_snapshot', 'risk_summary',
  ]
  for (const code of required) {
    assert.ok(codes.includes(code), `Missing section: ${code}`)
  }
})

test('T3: required_evidence includes micro_test_status, beta_admission_status, launch_governance_status', () => {
  const result = evaluateManualReviewGovernance({})
  const codes = result.manual_review_artifact.required_evidence.map(e => e.code)
  assert.ok(codes.includes('micro_test_status'),       'Missing micro_test_status')
  assert.ok(codes.includes('beta_admission_status'),   'Missing beta_admission_status')
  assert.ok(codes.includes('launch_governance_status'),'Missing launch_governance_status')
})

test('T4: operator_questions includes review_sample_size, review_segment_risks, keep_sell_blocked', () => {
  const result = evaluateManualReviewGovernance({})
  const codes = result.manual_review_artifact.operator_questions.map(q => q.code)
  assert.ok(codes.includes('review_sample_size'),   'Missing review_sample_size')
  assert.ok(codes.includes('review_segment_risks'), 'Missing review_segment_risks')
  assert.ok(codes.includes('keep_sell_blocked'),    'Missing keep_sell_blocked')
})

test('T5: approval simulation disabled by default', () => {
  const result = evaluateApprovalSimulation({})
  assert.strictEqual(result.status,           'disabled')
  assert.strictEqual(result.enabled,          false)
  assert.strictEqual(result.effective_result, 'not_requested')
})

test('T6: approval=true + rejection=true → conflict, can_enable_beta=false', () => {
  const result = evaluateApprovalSimulation({}, {
    MANUAL_REVIEW_SIMULATION_ENABLED:  true,
    MANUAL_REVIEW_SIMULATED_APPROVAL:  true,
    MANUAL_REVIEW_SIMULATED_REJECTION: true,
  })
  assert.strictEqual(result.status,          'conflict')
  assert.strictEqual(result.can_enable_beta, false)
  assert.strictEqual(result.can_enable_sell, false)
})

test('T7: approval=true with hard_lock=true → blocked_by_no_launch_lock, can_enable_beta=false', () => {
  const result = evaluateApprovalSimulation({}, {
    MANUAL_REVIEW_SIMULATION_ENABLED: true,
    MANUAL_REVIEW_SIMULATED_APPROVAL: true,
    NO_LAUNCH_HARD_LOCK:              true,
  })
  assert.strictEqual(result.status,               'blocked_by_no_launch_lock')
  assert.strictEqual(result.can_override_no_launch, false)
  assert.strictEqual(result.can_enable_beta,      false)
  assert.strictEqual(result.can_enable_sell,      false)
})

test('T8: approval=true without hard_lock → approved, but can_enable_beta=false, release_allowed=false', () => {
  const result = evaluateManualReviewGovernance({}, {
    MANUAL_REVIEW_SIMULATION_ENABLED: true,
    MANUAL_REVIEW_SIMULATED_APPROVAL: true,
    NO_LAUNCH_HARD_LOCK:              false,
  })
  assert.strictEqual(result.approval_simulation.status,           'approved')
  assert.strictEqual(result.approval_simulation.can_enable_beta,  false)
  assert.strictEqual(result.approval_simulation.can_enable_sell,  false)
  assert.strictEqual(result.no_launch_governance.release_allowed, false)
})

test('T9: rejection=true → approval_simulation=rejected, summary=rejected', () => {
  const result = evaluateManualReviewGovernance({}, {
    MANUAL_REVIEW_SIMULATION_ENABLED:  true,
    MANUAL_REVIEW_SIMULATED_REJECTION: true,
  })
  assert.strictEqual(result.approval_simulation.status,   'rejected')
  assert.strictEqual(result.manual_review_summary.status, 'rejected')
})

test('T10: no_launch governance always has release/beta/sell_allowed=false, requires_future_phase=true', () => {
  const result = buildNoLaunchGovernance({})
  assert.strictEqual(result.release_allowed,      false)
  assert.strictEqual(result.beta_allowed,         false)
  assert.strictEqual(result.sell_allowed,         false)
  assert.strictEqual(result.requires_future_phase, true)
})

test('T11: release_hard_locks length >= 8, all locked=true, all can_be_overridden_now=false', () => {
  const locks = buildReleaseHardLocks({})
  assert.ok(locks.length >= 8, `Expected >= 8 locks, got ${locks.length}`)
  for (const lock of locks) {
    assert.strictEqual(lock.locked,               true,  `Lock ${lock.code} should be locked`)
    assert.strictEqual(lock.can_be_overridden_now, false, `Lock ${lock.code} should not be overrideable`)
  }
})

test('T12: audit trail includes artifact_generated, approval_simulation_checked, no_launch_lock_checked, final_no_launch_enforced', () => {
  const result = evaluateManualReviewGovernance({})
  const codes = result.operator_review_audit_trail.entries.map(e => e.code)
  assert.ok(codes.includes('artifact_generated'),          'Missing artifact_generated')
  assert.ok(codes.includes('approval_simulation_checked'), 'Missing approval_simulation_checked')
  assert.ok(codes.includes('no_launch_lock_checked'),      'Missing no_launch_lock_checked')
  assert.ok(codes.includes('final_no_launch_enforced'),    'Missing final_no_launch_enforced')
})

test('T13: operator_decision_packet.status=shadow_continue → summary blocked, safe_to_invite=false', () => {
  const result = evaluateManualReviewGovernance({
    operator_decision_packet: { status: 'shadow_continue', decision: 'continue_shadow' },
  })
  assert.strictEqual(result.manual_review_summary.status,                      'blocked')
  assert.strictEqual(result.manual_review_summary.safe_to_invite_private_users, false)
  assert.strictEqual(result.manual_review_summary.safe_to_sell,                 false)
})

test('T14: approval simulation approved → summary approved_but_locked, safe invariants preserved', () => {
  const result = evaluateManualReviewGovernance({}, {
    MANUAL_REVIEW_SIMULATION_ENABLED: true,
    MANUAL_REVIEW_SIMULATED_APPROVAL: true,
    NO_LAUNCH_HARD_LOCK:              false,
  })
  assert.strictEqual(result.manual_review_summary.status,                      'approved_but_locked')
  assert.strictEqual(result.manual_review_summary.safe_to_invite_private_users, false)
  assert.strictEqual(result.manual_review_summary.safe_to_sell,                 false)
})

test('T15: unsafe can_beta=true → output can_beta=false, audit trail records unsafe_input_detected', () => {
  const result = evaluateManualReviewGovernance({ can_beta: true })
  // Safe: the artifact's governance_snapshot confirms false
  const govSection = result.manual_review_artifact.sections.find(s => s.code === 'governance_snapshot')
  assert.strictEqual(govSection.evidence.can_beta, false)
  // Audit trail
  const auditCodes = result.operator_review_audit_trail.entries.map(e => e.code)
  assert.ok(auditCodes.includes('unsafe_input_detected'),
    `Expected unsafe_input_detected in audit: ${JSON.stringify(auditCodes)}`)
})

test('T16: unsafe can_sell=true → output can_sell=false, sell_lock remains locked', () => {
  const result = evaluateManualReviewGovernance({ can_sell: true })
  // Safe: governance locks
  assert.strictEqual(result.no_launch_governance.sell_allowed, false)
  // sell_lock is locked
  const sellLock = result.release_hard_locks.find(l => l.code === 'sell_lock')
  assert.ok(sellLock, 'Expected sell_lock')
  assert.strictEqual(sellLock.locked, true)
})

test('T17: unsafe real_users=true → output real_users=false, audit records violation', () => {
  const result = evaluateManualReviewGovernance({ real_users: true })
  // Dry run section shows real_users=false
  const drySection = result.manual_review_artifact.sections.find(s => s.code === 'dry_run_snapshot')
  assert.strictEqual(drySection.evidence.real_users, false)
  // Audit records unsafe input
  const auditCodes = result.operator_review_audit_trail.entries.map(e => e.code)
  assert.ok(auditCodes.includes('unsafe_input_detected'),
    `Expected unsafe_input_detected: ${JSON.stringify(auditCodes)}`)
})

test('T18: unsafe real_delivery=true → output real_delivery=false, audit records violation', () => {
  const result = evaluateManualReviewGovernance({ real_delivery: true })
  const drySection = result.manual_review_artifact.sections.find(s => s.code === 'dry_run_snapshot')
  assert.strictEqual(drySection.evidence.real_delivery, false)
  const auditCodes = result.operator_review_audit_trail.entries.map(e => e.code)
  assert.ok(auditCodes.includes('unsafe_input_detected'),
    `Expected unsafe_input_detected: ${JSON.stringify(auditCodes)}`)
})

test('T19: unsafe release_allowed=true → output release_allowed=false in governance', () => {
  const result = evaluateManualReviewGovernance({ release_allowed: true })
  assert.strictEqual(result.no_launch_governance.release_allowed, false)
  assert.strictEqual(result.no_launch_governance.hard_lock_enabled, true)
})

test('T20: operator_decision_packet.status=manual_review_ready → artifact ready/ready_with_warnings, summary ready_for_review', () => {
  const result = evaluateManualReviewGovernance(manualReviewReadyInput())
  assert.ok(
    ['ready', 'ready_with_warnings'].includes(result.manual_review_artifact.status),
    `Expected ready or ready_with_warnings, got: ${result.manual_review_artifact.status}`
  )
  assert.ok(result.manual_review_artifact.ready_for_review, 'Expected ready_for_review=true')
  assert.ok(
    ['ready_for_review', 'blocked'].includes(result.manual_review_summary.status),
    `Expected ready_for_review or blocked, got: ${result.manual_review_summary.status}`
  )
})

test('T21: JSON.stringify(evaluateManualReviewGovernance({})) does not throw', () => {
  const result = evaluateManualReviewGovernance({})
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

test('T22: partial input { operator_decision_packet: {} } → no exception', () => {
  assert.doesNotThrow(() => {
    evaluateManualReviewGovernance({ operator_decision_packet: {} })
  })
})

test('T23: approval never changes can_beta across scenarios', () => {
  const scenarios = [
    { options: { MANUAL_REVIEW_SIMULATION_ENABLED: true, MANUAL_REVIEW_SIMULATED_APPROVAL: true, NO_LAUNCH_HARD_LOCK: false } },
    { options: { MANUAL_REVIEW_SIMULATION_ENABLED: true, MANUAL_REVIEW_SIMULATED_REJECTION: true } },
    { options: { MANUAL_REVIEW_SIMULATION_ENABLED: true, MANUAL_REVIEW_SIMULATED_APPROVAL: true, MANUAL_REVIEW_SIMULATED_REJECTION: true } },
  ]
  for (const { options } of scenarios) {
    const result = evaluateManualReviewGovernance({}, options)
    assert.strictEqual(result.approval_simulation.can_enable_beta, false,
      `can_enable_beta should be false for options: ${JSON.stringify(options)}`)
  }
})

test('T24: approval never changes can_sell across scenarios', () => {
  const scenarios = [
    { options: { MANUAL_REVIEW_SIMULATION_ENABLED: true, MANUAL_REVIEW_SIMULATED_APPROVAL: true, NO_LAUNCH_HARD_LOCK: false } },
    { options: { MANUAL_REVIEW_SIMULATION_ENABLED: true, MANUAL_REVIEW_SIMULATED_REJECTION: true } },
    { options: { MANUAL_REVIEW_SIMULATION_ENABLED: true, MANUAL_REVIEW_SIMULATED_APPROVAL: true, NO_LAUNCH_HARD_LOCK: true } },
  ]
  for (const { options } of scenarios) {
    const result = evaluateManualReviewGovernance({}, options)
    assert.strictEqual(result.approval_simulation.can_enable_sell, false,
      `can_enable_sell should be false for options: ${JSON.stringify(options)}`)
  }
})

test('T25: hard_lock=true always beats approval → release_allowed=false, status=blocked_by_no_launch_lock', () => {
  const result = evaluateManualReviewGovernance({}, {
    MANUAL_REVIEW_SIMULATION_ENABLED: true,
    MANUAL_REVIEW_SIMULATED_APPROVAL: true,
    NO_LAUNCH_HARD_LOCK:              true,
  })
  assert.strictEqual(result.no_launch_governance.release_allowed,        false)
  assert.strictEqual(result.approval_simulation.status, 'blocked_by_no_launch_lock')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
