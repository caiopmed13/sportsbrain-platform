import assert from 'assert'
import { evaluatePrivateBetaInvitationSimulation } from './privateBetaInvitationSimulation.js'

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

// T1: channel policy locked, email and webhook disallowed
test('T1: invitation_channel_policy.status=locked, email_allowed=false, webhook_allowed=false', () => {
  const result = evaluatePrivateBetaInvitationSimulation({})
  const p = result.invitation_channel_policy
  assert.strictEqual(p.status, 'locked')
  assert.strictEqual(p.email_allowed, false)
  assert.strictEqual(p.webhook_allowed, false)
})

// T2: simulation status and hard invariants
test('T2: private_beta_invitation_simulation.status=simulated, real_invites_created=false, users_created=false', () => {
  const result = evaluatePrivateBetaInvitationSimulation({})
  const s = result.private_beta_invitation_simulation
  assert.strictEqual(s.status, 'simulated')
  assert.strictEqual(s.real_invites_created, false)
  assert.strictEqual(s.users_created, false)
})

// T3: ledger status, entries count, and all entries have real_invite_created=false
test('T3: simulated_invitation_ledger.status=simulated, entries_count>=1, all entries real_invite_created=false', () => {
  const result = evaluatePrivateBetaInvitationSimulation({})
  const l = result.simulated_invitation_ledger
  assert.strictEqual(l.status, 'simulated')
  assert.ok(l.entries_count >= 1)
  for (const entry of l.entries) {
    assert.strictEqual(entry.real_invite_created, false)
  }
})

// T4: emails_sent=false, webhooks_sent=false on simulation
test('T4: private_beta_invitation_simulation emails_sent=false, webhooks_sent=false', () => {
  const result = evaluatePrivateBetaInvitationSimulation({})
  const s = result.private_beta_invitation_simulation
  assert.strictEqual(s.emails_sent, false)
  assert.strictEqual(s.webhooks_sent, false)
})

// T5: unsafe input real_invites_created=true is sanitized
test('T5: input {real_invites_created:true} => output real_invites_created=false, unsafe_input_sanitized=true', () => {
  const result = evaluatePrivateBetaInvitationSimulation({ real_invites_created: true })
  const s = result.private_beta_invitation_simulation
  assert.strictEqual(s.real_invites_created, false)
  assert.strictEqual(s.unsafe_input_sanitized, true)
})

// T6: unsafe input users_created=true is sanitized
test('T6: input {users_created:true} => output users_created=false', () => {
  const result = evaluatePrivateBetaInvitationSimulation({ users_created: true })
  const s = result.private_beta_invitation_simulation
  assert.strictEqual(s.users_created, false)
})

// T7: summary invariants
test('T7: invitation_simulation_summary delivery_allowed=false, safe_to_invite_private_users=false, safe_to_sell=false', () => {
  const result = evaluatePrivateBetaInvitationSimulation({})
  const sum = result.invitation_simulation_summary
  assert.strictEqual(sum.delivery_allowed, false)
  assert.strictEqual(sum.safe_to_invite_private_users, false)
  assert.strictEqual(sum.safe_to_sell, false)
})

// T8: full serialization does not throw
test('T8: JSON.stringify(evaluatePrivateBetaInvitationSimulation({})) does not throw', () => {
  const result = evaluatePrivateBetaInvitationSimulation({})
  const serialized = JSON.stringify(result)
  assert.ok(typeof serialized === 'string' && serialized.length > 0)
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const e of errors) {
    console.error(`  - ${e.name}: ${e.error}`)
  }
  process.exit(1)
}
