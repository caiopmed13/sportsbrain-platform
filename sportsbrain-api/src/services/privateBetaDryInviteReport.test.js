import assert from 'assert'
import { evaluatePrivateBetaDryInviteReport } from './privateBetaDryInviteReport.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

// T1: report generated, dry_invite_only=true
test('T1: report generated, dry_invite_only=true', () => {
  const r = evaluatePrivateBetaDryInviteReport({})
  assert.strictEqual(r.private_beta_dry_invite_report.status, 'generated')
  assert.strictEqual(r.private_beta_dry_invite_report.dry_invite_only, true)
  assert.strictEqual(r.private_beta_dry_invite_report.simulation_only, true)
})

// T2: no real side effects
test('T2: no real side effects', () => {
  const r = evaluatePrivateBetaDryInviteReport({})
  assert.strictEqual(r.private_beta_dry_invite_report.real_invites_created, false)
  assert.strictEqual(r.private_beta_dry_invite_report.users_created, false)
  assert.strictEqual(r.private_beta_dry_invite_report.emails_sent, false)
  assert.strictEqual(r.private_beta_dry_invite_report.webhooks_sent, false)
  assert.strictEqual(r.private_beta_dry_invite_report.delivery_allowed, false)
  assert.strictEqual(r.private_beta_dry_invite_report.safe_to_sell, false)
})

// T3: evidence packet complete, proofs all true
test('T3: evidence packet complete, proofs all true', () => {
  const r = evaluatePrivateBetaDryInviteReport({})
  assert.strictEqual(r.dry_invite_evidence_packet.status, 'complete')
  assert.strictEqual(r.dry_invite_evidence_packet.proofs.no_real_invites, true)
  assert.strictEqual(r.dry_invite_evidence_packet.proofs.kill_switch_armed, true)
  assert.strictEqual(r.dry_invite_evidence_packet.proofs.no_delivery_allowed, true)
  assert.ok(r.dry_invite_evidence_packet.evidence_items_count >= 7)
})

// T4: checklist includes required items
test('T4: checklist includes required items', () => {
  const r = evaluatePrivateBetaDryInviteReport({})
  const ids = r.dry_invite_readiness_checklist.items.map(i => i.item_id)
  assert.ok(ids.includes('cohort_is_synthetic'))
  assert.ok(ids.includes('all_channels_locked'))
  assert.ok(ids.includes('can_sell_false'))
  assert.strictEqual(r.dry_invite_readiness_checklist.failed_count, 0)
})

// T5: unsafe input real_invites_created=true → sanitized to false, violation recorded
test('T5: unsafe input real_invites_created=true → sanitized to false, violation recorded', () => {
  const r = evaluatePrivateBetaDryInviteReport({ real_invites_created: true })
  assert.strictEqual(r.private_beta_dry_invite_report.real_invites_created, false)
  assert.strictEqual(r.private_beta_dry_invite_report.unsafe_input_sanitized, true)
  assert.ok(r.dry_invite_evidence_packet.violations.length > 0)
})

// T6: operator summary simulation_only, safe_for_real_invites=false, safe_to_sell=false
test('T6: operator summary simulation_only, safe_for_real_invites=false, safe_to_sell=false', () => {
  const r = evaluatePrivateBetaDryInviteReport({})
  assert.strictEqual(r.dry_invite_operator_summary.status, 'simulation_only')
  assert.strictEqual(r.dry_invite_operator_summary.safe_for_internal_review, true)
  assert.strictEqual(r.dry_invite_operator_summary.safe_for_real_invites, false)
  assert.strictEqual(r.dry_invite_operator_summary.safe_to_sell, false)
})

// T7: JSON.stringify does not throw
test('T7: JSON.stringify does not throw', () => {
  const r = evaluatePrivateBetaDryInviteReport({})
  assert.doesNotThrow(() => JSON.stringify(r))
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error('FAILURES:', errors); process.exit(1) }
