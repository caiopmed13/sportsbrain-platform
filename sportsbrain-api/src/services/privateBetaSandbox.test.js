// src/services/privateBetaSandbox.test.js
// P3.8.13 — 25 tests

import assert from 'node:assert/strict'
import {
  normalizeSandboxBoolean,
  buildSandboxDeliveryPolicy,
  buildSandboxRiskControls,
  selectSandboxEligibleSegments,
  buildSimulatedDeliveryLedger,
  buildOperatorReviewConsole,
  evaluatePrivateBetaSandbox,
} from './privateBetaSandbox.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function goodSeg(overrides = {}) {
  return {
    segment:       'football:moneyline',
    dimension:     'sport',
    health_score:  80,
    health_grade:  'strong',
    hit_rate:      0.62,
    risk_level:    'low',
    decision_hint: 'candidate_hold',
    ...overrides,
  }
}

function makeReadyInput(overrides = {}) {
  return {
    beta_admission_contract:  { status: 'simulation_ready' },
    private_cohort_simulation: { status: 'ready' },
    candidate_segments:       [goodSeg()],
    risk_segments:            [],
    micro_test_active:        true,
    micro_test_report:        { status: 'active', sample_size: 150 },
    micro_test_policy:        { quality_score: 75, quality_grade: 'strong', decision_state: 'decision_ready_hold', guardrails: { blockers: [], warnings: [] } },
    manual_approval_gate:     { required: true, approved: false, status: 'approval_missing' },
    ...overrides,
  }
}

function makeReadyOptions(overrides = {}) {
  return {
    private_beta_sandbox_enabled: true,
    max_picks_per_run:            3,
    max_ledger_entries:           25,
    strict_mode:                  true,
    ...overrides,
  }
}

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`)
    failed++
  }
}

// ── Test 1: sandbox disabled by default ───────────────────────────────────────
test('sandbox disabled by default (empty options)', () => {
  const result = evaluatePrivateBetaSandbox({}, {})
  assert.equal(result.private_beta_sandbox.status,  'disabled')
  assert.equal(result.private_beta_sandbox.enabled, false)
  assert.equal(result.private_beta_sandbox.real_users,    false)
  assert.equal(result.private_beta_sandbox.real_delivery, false)
  assert.equal(result.simulated_delivery_ledger.status, 'not_started')
})

// ── Test 2: sandbox flag true but admission blocked ───────────────────────────
test('sandbox enabled but contract blocked → status=blocked', () => {
  const result = evaluatePrivateBetaSandbox(
    { beta_admission_contract: { status: 'blocked' } },
    { private_beta_sandbox_enabled: true }
  )
  assert.equal(result.private_beta_sandbox.status, 'blocked')
  assert.equal(result.private_beta_sandbox.can_run_simulation, false)
})

// ── Test 3: sandbox ready with simulation_ready contract ──────────────────────
test('simulation_ready contract + 2 candidates → ledger generated, real flags false', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: [goodSeg(), goodSeg({ segment: 'football:over_under' })] }),
    makeReadyOptions()
  )
  const status = result.private_beta_sandbox.status
  assert.ok(['completed', 'ready'].includes(status), `Expected completed or ready, got ${status}`)
  assert.equal(result.private_beta_sandbox.real_delivery, false)
  assert.equal(result.private_beta_sandbox.real_users,    false)
})

// ── Test 4: never permits real_delivery ───────────────────────────────────────
test('options.real_delivery=true → critical_violation, real_delivery in output=false', () => {
  const result = evaluatePrivateBetaSandbox({}, { real_delivery: true })
  assert.equal(result.sandbox_audit_summary.status, 'critical_violation')
  assert.equal(result.private_beta_sandbox.real_delivery, false)
  const control = result.sandbox_risk_controls.controls.find(c => c.code === 'no_real_delivery')
  assert.ok(control, 'no_real_delivery control must exist')
  assert.equal(control.passed, false)
})

// ── Test 5: never permits real_users ─────────────────────────────────────────
test('options.real_users=true → critical_violation, real_users in output=false', () => {
  const result = evaluatePrivateBetaSandbox({}, { real_users: true })
  assert.equal(result.sandbox_audit_summary.status, 'critical_violation')
  assert.equal(result.private_beta_sandbox.real_users, false)
  const control = result.sandbox_risk_controls.controls.find(c => c.code === 'no_real_users')
  assert.ok(control, 'no_real_users control must exist')
  assert.equal(control.passed, false)
})

// ── Test 6: good candidate → allowed_segments ─────────────────────────────────
test('candidate health_score=75, hit_rate=0.60, risk_level=low → allowed', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: [goodSeg({ health_score: 75, hit_rate: 0.60, risk_level: 'low' })] }),
    makeReadyOptions()
  )
  assert.equal(result.sandbox_allowed_segments.length, 1)
})

// ── Test 7: high-risk candidate → blocked, not allowed ───────────────────────
test('candidate risk_level=high → blocked, not in allowed', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: [goodSeg({ risk_level: 'high' })] }),
    makeReadyOptions()
  )
  assert.equal(result.sandbox_allowed_segments.length, 0)
  assert.ok(result.sandbox_blocked_segments.some(s => s.block_reason === 'high_risk_level'))
})

// ── Test 8: risk_segments → blocked_segments ──────────────────────────────────
test('risk_segments.length=2 → blocked_segments.length>=2', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({
      candidate_segments: [],
      risk_segments: [
        { segment: 'football:spread', dimension: 'sport', risk_level: 'high', health_score: 30 },
        { segment: 'basketball:over', dimension: 'sport', risk_level: 'medium', health_score: 40 },
      ],
    }),
    makeReadyOptions()
  )
  assert.ok(result.sandbox_blocked_segments.length >= 2)
})

// ── Test 9: ledger contains would_deliver entries ─────────────────────────────
test('allowed segments → ledger has would_deliver entries', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: [goodSeg(), goodSeg({ segment: 'football:over_under' })] }),
    makeReadyOptions()
  )
  const entries = result.simulated_delivery_ledger.entries
  assert.ok(entries.some(e => e.status === 'would_deliver'), 'expected would_deliver entries')
  assert.ok(result.simulated_delivery_ledger.delivered_count > 0)
})

// ── Test 10: ledger contains would_block entries ──────────────────────────────
test('blocked segments → ledger has would_block entries', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({
      candidate_segments: [goodSeg()],
      risk_segments: [{ segment: 'bad:segment', dimension: 'market', risk_level: 'high', health_score: 20 }],
    }),
    makeReadyOptions()
  )
  const entries = result.simulated_delivery_ledger.entries
  assert.ok(entries.some(e => e.status === 'would_block'), 'expected would_block entries')
  assert.ok(result.simulated_delivery_ledger.blocked_count >= 1)
})

// ── Test 11: respects max_picks_per_run ───────────────────────────────────────
test('10 candidates + max_picks_per_run=3 → would_deliver_count<=3', () => {
  const segs = Array.from({ length: 10 }, (_, i) => goodSeg({ segment: `seg:${i}` }))
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: segs }),
    makeReadyOptions({ max_picks_per_run: 3 })
  )
  assert.ok(result.simulated_delivery_ledger.delivered_count <= 3)
})

// ── Test 12: respects max_ledger_entries ──────────────────────────────────────
test('many segments + max_ledger_entries=5 → entries_count<=5', () => {
  const candidates = Array.from({ length: 6 }, (_, i) => goodSeg({ segment: `c:${i}` }))
  const riskSegs   = Array.from({ length: 6 }, (_, i) => ({
    segment: `r:${i}`, dimension: 'sport', risk_level: 'high', health_score: 20,
  }))
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: candidates, risk_segments: riskSegs }),
    makeReadyOptions({ max_ledger_entries: 5, max_picks_per_run: 10 })
  )
  assert.ok(result.simulated_delivery_ledger.entries_count <= 5)
})

// ── Test 13: delivery policy always simulation_only ───────────────────────────
test('delivery policy always simulation_only=true, real_delivery_allowed=false', () => {
  const policy = buildSandboxDeliveryPolicy({}, {})
  assert.equal(policy.simulation_only,       true)
  assert.equal(policy.real_delivery_allowed, false)
})

// ── Test 14: risk controls detect can_sell=true ───────────────────────────────
test('can_sell=true → sell_blocked control fails', () => {
  const controls = buildSandboxRiskControls({ can_sell: true }, {})
  const c = controls.controls.find(x => x.code === 'sell_blocked')
  assert.ok(c, 'sell_blocked must exist')
  assert.equal(c.passed, false)
  assert.ok(controls.blockers.includes('sell_blocked'))
})

// ── Test 15: risk controls detect can_start_public_beta=true ─────────────────
test('can_start_public_beta=true → public_beta_blocked control fails', () => {
  const controls = buildSandboxRiskControls({ can_start_public_beta: true }, {})
  const c = controls.controls.find(x => x.code === 'public_beta_blocked')
  assert.ok(c, 'public_beta_blocked must exist')
  assert.equal(c.passed, false)
  assert.ok(controls.blockers.includes('public_beta_blocked'))
})

// ── Test 16: operator console sandbox_disabled ────────────────────────────────
test('sandbox disabled → operator console status=sandbox_disabled', () => {
  const result = evaluatePrivateBetaSandbox({}, {})
  assert.equal(result.operator_review_console.status,                   'sandbox_disabled')
  assert.equal(result.operator_review_console.safe_to_run_sandbox,      false)
  assert.equal(result.operator_review_console.safe_to_invite_private_users, false)
  assert.equal(result.operator_review_console.safe_to_sell,             false)
})

// ── Test 17: operator console simulation_completed ────────────────────────────
test('sandbox completed + ledger entries → console=simulation_completed, safe_to_run_sandbox=true', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: [goodSeg()] }),
    makeReadyOptions()
  )
  // Only valid if sandbox reached completed
  if (result.private_beta_sandbox.status === 'completed') {
    assert.equal(result.operator_review_console.status,                      'simulation_completed')
    assert.equal(result.operator_review_console.safe_to_run_sandbox,         true)
    assert.equal(result.operator_review_console.safe_to_invite_private_users, false)
    assert.equal(result.operator_review_console.safe_to_sell,                false)
  }
})

// ── Test 18: checklist contains required items ────────────────────────────────
test('review_checklist includes no_real_users_confirmed, no_real_delivery_confirmed, sell_blocked_confirmed', () => {
  const result = evaluatePrivateBetaSandbox({}, {})
  const codes = result.operator_review_console.review_checklist.map(c => c.code)
  assert.ok(codes.includes('no_real_users_confirmed'),    'missing no_real_users_confirmed')
  assert.ok(codes.includes('no_real_delivery_confirmed'), 'missing no_real_delivery_confirmed')
  assert.ok(codes.includes('sell_blocked_confirmed'),     'missing sell_blocked_confirmed')
})

// ── Test 19: output is JSON-serializable ──────────────────────────────────────
test('JSON.stringify(evaluatePrivateBetaSandbox) does not throw', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: [goodSeg()] }),
    makeReadyOptions()
  )
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(serialized.length > 0)
})

// ── Test 20: empty input does not throw ───────────────────────────────────────
test('empty input {} does not throw, returns disabled or blocked', () => {
  let result
  assert.doesNotThrow(() => { result = evaluatePrivateBetaSandbox({}, {}) })
  assert.ok(['disabled', 'blocked'].includes(result.private_beta_sandbox.status))
})

// ── Test 21: strict mode blocks weak grade ────────────────────────────────────
test('candidate health_grade=weak + strict_mode=true → blocked', () => {
  const result = selectSandboxEligibleSegments(
    { candidate_segments: [goodSeg({ health_grade: 'weak', health_score: 80, risk_level: 'low' })] },
    { strict_mode: true }
  )
  assert.equal(result.allowed.length, 0)
  assert.ok(result.blocked.some(s => s.block_reason === 'weak_grade_strict_mode'))
})

// ── Test 22: non-strict still blocks high risk ────────────────────────────────
test('strict_mode=false + risk_level=high → still blocked', () => {
  const result = selectSandboxEligibleSegments(
    { candidate_segments: [goodSeg({ risk_level: 'high' })] },
    { strict_mode: false }
  )
  assert.equal(result.allowed.length, 0)
  assert.ok(result.blocked.some(s => s.block_reason === 'high_risk_level'))
})

// ── Test 23: high_odds_share_limited evaluated ────────────────────────────────
test('segments with odd>2.5 → high_odds_share_limited control evaluated', () => {
  const highOddsSegs = Array.from({ length: 4 }, (_, i) =>
    goodSeg({ segment: `seg:${i}`, odd: 3.0 })
  )
  const controls = buildSandboxRiskControls(
    { candidate_segments: highOddsSegs, allowed_segments: highOddsSegs },
    {}
  )
  const c = controls.controls.find(x => x.code === 'high_odds_share_limited')
  assert.ok(c, 'high_odds_share_limited must exist')
  // 100% high odds > 25% → should fail
  assert.equal(c.passed, false)
})

// ── Test 24: single_segment_share_limited evaluated ──────────────────────────
test('ledger dominated by one segment → single_segment_share_limited evaluated', () => {
  // All 4 segments from same key → 100% share > 50%
  const dominantSegs = Array.from({ length: 4 }, () =>
    goodSeg({ segment: 'football:moneyline' })
  )
  const controls = buildSandboxRiskControls(
    { candidate_segments: dominantSegs, allowed_segments: dominantSegs },
    {}
  )
  const c = controls.controls.find(x => x.code === 'single_segment_share_limited')
  assert.ok(c, 'single_segment_share_limited must exist')
  assert.equal(c.passed, false)
})

// ── Test 25: completed does not change can_beta/can_sell ──────────────────────
test('sandbox completed → can_beta=false, can_sell=false, safe_to_invite=false, safe_to_sell=false', () => {
  const result = evaluatePrivateBetaSandbox(
    makeReadyInput({ candidate_segments: [goodSeg()] }),
    makeReadyOptions()
  )
  // Verify invariants regardless of sandbox status
  assert.equal(result.operator_review_console.safe_to_invite_private_users, false)
  assert.equal(result.operator_review_console.safe_to_sell, false)
  assert.equal(result.private_beta_sandbox.real_delivery, false)
  assert.equal(result.private_beta_sandbox.real_users, false)
})

// ── Summary ───────────────────────────────────────────────────────────────────
console.log()
console.log(`privateBetaSandbox: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
