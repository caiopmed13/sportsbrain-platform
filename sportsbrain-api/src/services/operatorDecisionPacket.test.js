// src/services/operatorDecisionPacket.test.js
// P3.8.15 — 25 tests for Operator Decision Packet

import assert from 'assert'
import {
  normalizeDecisionBoolean,
  buildDecisionEvidenceMatrix,
  buildBetaDryRunReport,
  buildLaunchGovernance,
  computeLaunchNoLaunchDecision,
  buildOperatorNextActions,
  buildGovernanceAuditSummary,
  evaluateOperatorDecisionPacket,
} from './operatorDecisionPacket.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function reviewReadyInput() {
  return {
    micro_test_active: true,
    private_beta_sandbox: { enabled: true, status: 'completed' },
    operator_approval_checklist: { status: 'ready_for_operator_review', passed_count: 15 },
    cohort_monitoring_review: { status: 'operator_review_ready' },
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

test('T1: empty input → packet blocked/shadow_continue, decision continue_shadow/no_launch, can_beta=false, can_sell=false', () => {
  const result = evaluateOperatorDecisionPacket({})
  assert.ok(
    ['blocked', 'shadow_continue', 'hold'].includes(result.operator_decision_packet.status),
    `Unexpected packet status: ${result.operator_decision_packet.status}`
  )
  assert.ok(
    ['continue_shadow', 'no_launch', 'hold'].includes(result.launch_no_launch_decision.decision),
    `Unexpected decision: ${result.launch_no_launch_decision.decision}`
  )
  assert.strictEqual(result.launch_no_launch_decision.can_sell, false)
  assert.strictEqual(result.launch_no_launch_decision.can_launch, false)
  assert.strictEqual(result.operator_decision_packet.safe_to_sell, false)
  assert.strictEqual(result.operator_decision_packet.safe_to_invite_private_users, false)
})

test('T2: micro_test_active=false → decision=continue_shadow, reason contains micro_test_not_active', () => {
  const result = computeLaunchNoLaunchDecision({ micro_test_active: false })
  assert.strictEqual(result.decision, 'continue_shadow')
  assert.ok(
    result.reason.includes('micro_test_not_active') || result.blockers.includes('micro_test_not_active'),
    `Expected micro_test_not_active in reason or blockers: reason=${result.reason}, blockers=${JSON.stringify(result.blockers)}`
  )
})

test('T3: micro_test_active=true, sandbox disabled → decision=hold, governance.status=locked', () => {
  const result = evaluateOperatorDecisionPacket({
    micro_test_active: true,
    private_beta_sandbox: { status: 'disabled', enabled: false },
  })
  assert.strictEqual(result.launch_no_launch_decision.decision, 'hold')
  assert.strictEqual(result.launch_governance.status, 'locked')
  assert.strictEqual(result.launch_governance.launch_allowed, false)
})

test('T4: sandbox_audit_summary.status=critical_violation → packet=critical_violation, decision=no_launch', () => {
  const result = evaluateOperatorDecisionPacket({
    sandbox_audit_summary: { status: 'critical_violation' },
  })
  assert.strictEqual(result.operator_decision_packet.status, 'critical_violation')
  assert.strictEqual(result.launch_no_launch_decision.decision, 'no_launch')
})

test('T5: checklist ready + cohort review ready → decision=ready_for_manual_review, governance blocked', () => {
  const result = evaluateOperatorDecisionPacket(reviewReadyInput())
  assert.strictEqual(result.launch_no_launch_decision.decision, 'ready_for_manual_review')
  assert.strictEqual(result.launch_governance.private_beta_allowed, false)
  assert.strictEqual(result.launch_no_launch_decision.can_launch, false)
  assert.strictEqual(result.launch_no_launch_decision.can_sell, false)
})

test('T6: evidence matrix has minimum required domains', () => {
  const result = evaluateOperatorDecisionPacket({})
  const domainCodes = result.decision_evidence_matrix.domains.map(d => d.domain)
  const required = ['readiness', 'micro_test_gate', 'micro_test_policy', 'segment_health',
    'beta_admission', 'private_beta_sandbox', 'simulated_cohort_monitor',
    'safety_invariants', 'commercial_block']
  for (const code of required) {
    assert.ok(domainCodes.includes(code), `Missing domain: ${code}`)
  }
})

test('T7: overall_score is >= 0 and <= 100', () => {
  const r1 = evaluateOperatorDecisionPacket({})
  assert.ok(r1.decision_evidence_matrix.overall_score >= 0, 'Expected >= 0')
  assert.ok(r1.decision_evidence_matrix.overall_score <= 100, 'Expected <= 100')

  const r2 = evaluateOperatorDecisionPacket(reviewReadyInput())
  assert.ok(r2.decision_evidence_matrix.overall_score >= 0, 'Expected >= 0')
  assert.ok(r2.decision_evidence_matrix.overall_score <= 100, 'Expected <= 100')
})

test('T8: ledger not_started → dry_run.status=not_started, dry_run_complete=false', () => {
  const result = evaluateOperatorDecisionPacket({
    simulated_delivery_ledger: { status: 'not_started', entries: [], entries_count: 0 },
  })
  assert.strictEqual(result.beta_dry_run_report.status, 'not_started')
  assert.strictEqual(result.beta_dry_run_report.dry_run_complete, false)
  assert.strictEqual(result.beta_dry_run_report.simulation_only, true)
  assert.strictEqual(result.beta_dry_run_report.real_users, false)
  assert.strictEqual(result.beta_dry_run_report.real_delivery, false)
})

test('T9: sandbox enabled + entries > 0 → dry_run.status=completed or completed_with_warnings, dry_run_complete=true', () => {
  const entries = [
    { status: 'would_deliver', segment_key: 'seg_a' },
    { status: 'would_deliver', segment_key: 'seg_b' },
    { status: 'would_deliver', segment_key: 'seg_c' },
    { status: 'would_block',   segment_key: 'seg_d' },
    { status: 'would_block',   segment_key: 'seg_e' },
  ]
  const result = evaluateOperatorDecisionPacket({
    private_beta_sandbox: { enabled: true, status: 'completed' },
    simulated_delivery_ledger: { entries, entries_count: 5, delivered_count: 3, blocked_count: 2 },
  })
  assert.ok(
    ['completed', 'completed_with_warnings'].includes(result.beta_dry_run_report.status),
    `Expected completed/completed_with_warnings, got: ${result.beta_dry_run_report.status}`
  )
  assert.strictEqual(result.beta_dry_run_report.dry_run_complete, true)
})

test('T10: launch governance always locked (launch_allowed/private_beta_allowed/sell_allowed=false)', () => {
  const strongResult = evaluateOperatorDecisionPacket(reviewReadyInput())
  assert.strictEqual(strongResult.launch_governance.launch_allowed, false)
  assert.strictEqual(strongResult.launch_governance.private_beta_allowed, false)
  assert.strictEqual(strongResult.launch_governance.public_beta_allowed, false)
  assert.strictEqual(strongResult.launch_governance.sell_allowed, false)

  const emptyResult = evaluateOperatorDecisionPacket({})
  assert.strictEqual(emptyResult.launch_governance.launch_allowed, false)
  assert.strictEqual(emptyResult.launch_governance.sell_allowed, false)
})

test('T11: can_beta=true in input → output can_sell=false, audit critical violation registered', () => {
  const result = evaluateOperatorDecisionPacket({ can_beta: true })
  assert.strictEqual(result.operator_decision_packet.safe_to_invite_private_users, false)
  assert.ok(
    result.governance_audit_summary.critical_violations.some(v => v.code === 'can_beta_true'),
    `Expected can_beta_true in violations: ${JSON.stringify(result.governance_audit_summary.critical_violations)}`
  )
})

test('T12: can_sell=true in input → output can_sell=false, sell_locked violation registered', () => {
  const result = evaluateOperatorDecisionPacket({ can_sell: true })
  assert.strictEqual(result.launch_governance.sell_allowed, false)
  assert.ok(
    result.governance_audit_summary.critical_violations.some(v => v.code === 'can_sell_true'),
    `Expected can_sell_true in violations: ${JSON.stringify(result.governance_audit_summary.critical_violations)}`
  )
})

test('T13: real_users=true in input → output real_users=false, violation registered', () => {
  const result = evaluateOperatorDecisionPacket({ real_users: true })
  assert.strictEqual(result.beta_dry_run_report.real_users, false)
  assert.ok(
    result.governance_audit_summary.critical_violations.some(v => v.code === 'real_users_true'),
    `Expected real_users_true violation: ${JSON.stringify(result.governance_audit_summary.critical_violations)}`
  )
})

test('T14: real_delivery=true in input → output real_delivery=false, violation registered', () => {
  const result = evaluateOperatorDecisionPacket({ real_delivery: true })
  assert.strictEqual(result.beta_dry_run_report.real_delivery, false)
  assert.ok(
    result.governance_audit_summary.critical_violations.some(v => v.code === 'real_delivery_true'),
    `Expected real_delivery_true violation: ${JSON.stringify(result.governance_audit_summary.critical_violations)}`
  )
})

test('T15: launch_allowed=true in input → output launch_allowed=false, violation registered', () => {
  const result = evaluateOperatorDecisionPacket({ launch_allowed: true })
  assert.strictEqual(result.launch_governance.launch_allowed, false)
  assert.ok(
    result.governance_audit_summary.critical_violations.some(v => v.code === 'launch_allowed_true'),
    `Expected launch_allowed_true violation: ${JSON.stringify(result.governance_audit_summary.critical_violations)}`
  )
})

test('T16: blocked state → actions include continue_accumulation, keep_beta_locked, keep_sell_locked', () => {
  const result = evaluateOperatorDecisionPacket({ micro_test_active: false })
  const codes = result.operator_next_actions.actions.map(a => a.code)
  assert.ok(codes.includes('continue_accumulation'), `Expected continue_accumulation: ${JSON.stringify(codes)}`)
  assert.ok(codes.includes('keep_beta_locked'),      `Expected keep_beta_locked: ${JSON.stringify(codes)}`)
  assert.ok(codes.includes('keep_sell_locked'),      `Expected keep_sell_locked: ${JSON.stringify(codes)}`)
})

test('T17: decision=ready_for_manual_review → actions include prepare_next_phase_packet and review_drift_report', () => {
  const result = evaluateOperatorDecisionPacket(reviewReadyInput())
  const codes = result.operator_next_actions.actions.map(a => a.code)
  assert.ok(codes.includes('prepare_next_phase_packet'), `Expected prepare_next_phase_packet: ${JSON.stringify(codes)}`)
  assert.ok(codes.includes('review_drift_report'),       `Expected review_drift_report: ${JSON.stringify(codes)}`)
})

test('T18: safe input → governance_audit_summary.status=clean', () => {
  const result = buildGovernanceAuditSummary({ can_beta: false, can_sell: false, real_users: false, real_delivery: false })
  assert.strictEqual(result.status, 'clean')
  assert.strictEqual(result.critical_violations.length, 0)
  assert.strictEqual(result.unsafe_input_detected, false)
})

test('T19: can_sell=true + real_delivery=true → audit.status=critical_violation, violations.length > 0', () => {
  const result = buildGovernanceAuditSummary({ can_sell: true, real_delivery: true })
  assert.strictEqual(result.status, 'critical_violation')
  assert.ok(result.critical_violations.length > 0, 'Expected violations')
  assert.ok(result.critical_violations.some(v => v.code === 'can_sell_true'), 'Expected can_sell_true')
  assert.ok(result.critical_violations.some(v => v.code === 'real_delivery_true'), 'Expected real_delivery_true')
})

test('T20: checklist ready → safe_to_invite_private_users=false, safe_to_sell=false', () => {
  const result = evaluateOperatorDecisionPacket({
    operator_approval_checklist: { status: 'ready_for_operator_review' },
  })
  assert.strictEqual(result.operator_decision_packet.safe_to_invite_private_users, false)
  assert.strictEqual(result.operator_decision_packet.safe_to_sell, false)
  assert.strictEqual(result.launch_no_launch_decision.can_invite_private_users, false)
})

test('T21: JSON.stringify(evaluateOperatorDecisionPacket({})) does not throw', () => {
  const result = evaluateOperatorDecisionPacket({})
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

test('T22: partial input { micro_test_report: {} } → no exception', () => {
  assert.doesNotThrow(() => {
    evaluateOperatorDecisionPacket({ micro_test_report: {} })
  })
})

test('T23: launch decision never returns "launch" for multiple scenarios', () => {
  const scenarios = [
    {},
    { micro_test_active: true },
    reviewReadyInput(),
    { micro_test_active: true, private_beta_sandbox: { enabled: true, status: 'completed' } },
    { can_beta: true, can_sell: true },
    { sandbox_audit_summary: { status: 'critical_violation' } },
  ]
  for (const input of scenarios) {
    const result = computeLaunchNoLaunchDecision(input)
    assert.notStrictEqual(result.decision, 'launch', `Decision must never be "launch", got it for input: ${JSON.stringify(input)}`)
  }
})

test('T24: can_sell=false → commercial_block domain passed=true', () => {
  const result = buildDecisionEvidenceMatrix({ can_sell: false, can_beta: false })
  const domain = result.domains.find(d => d.domain === 'commercial_block')
  assert.ok(domain, 'Expected commercial_block domain')
  assert.strictEqual(domain.passed, true)
})

test('T25: can_sell=true → commercial_block domain passed=false, violation registered', () => {
  const result = evaluateOperatorDecisionPacket({ can_sell: true })
  const matrix = result.decision_evidence_matrix
  const domain = matrix.domains.find(d => d.domain === 'commercial_block')
  assert.ok(domain, 'Expected commercial_block domain')
  assert.strictEqual(domain.passed, false)
  assert.ok(
    result.governance_audit_summary.critical_violations.some(v => v.code === 'can_sell_true'),
    'Expected can_sell_true violation in audit'
  )
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
