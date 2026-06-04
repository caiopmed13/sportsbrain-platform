// src/services/nonUserCohortContract.test.js
// P3.8.27 — Non-User Cohort Contract — test suite

import assert from 'assert'
import { evaluateNonUserCohortContract } from './nonUserCohortContract.js'

let passed = 0, failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1: default → contract status=enforced, real_users_allowed=false, real_emails_allowed=false
test('T1: default contract has enforced status and all real flags false', () => {
  const result = evaluateNonUserCohortContract()
  const c = result.non_user_cohort_contract
  assert.strictEqual(c.status, 'enforced')
  assert.strictEqual(c.real_users_allowed, false)
  assert.strictEqual(c.real_emails_allowed, false)
})

// T2: members_count >= 1, all real_user=false, all email=null
test('T2: members_count >= 1, all members have real_user=false and email=null', () => {
  const result = evaluateNonUserCohortContract()
  const m = result.non_user_cohort_members
  assert.ok(m.members_count >= 1, `members_count should be >= 1, got ${m.members_count}`)
  assert.ok(Array.isArray(m.members), 'members should be an array')
  for (const member of m.members) {
    assert.strictEqual(member.real_user, false, `member ${member.member_id} real_user should be false`)
    assert.strictEqual(member.email, null, `member ${member.member_id} email should be null`)
  }
})

// T3: input with member having email set → member's email is null in output, unsafe_input_sanitized=true on contract
test('T3: input member email is stripped to null and unsafe_input_sanitized=true', () => {
  const result = evaluateNonUserCohortContract({
    members: [{ member_id: 'x', email: 'user@example.com' }],
  })
  const c = result.non_user_cohort_contract
  const m = result.non_user_cohort_members
  assert.strictEqual(c.unsafe_input_sanitized, true, 'contract.unsafe_input_sanitized should be true')
  for (const member of m.members) {
    assert.strictEqual(member.email, null, `member ${member.member_id} email should be null even if input had email`)
  }
})

// T4: can_be_converted_to_real_users_now=false always
test('T4: can_be_converted_to_real_users_now is always false', () => {
  const r1 = evaluateNonUserCohortContract()
  const r2 = evaluateNonUserCohortContract({ real_users: true })
  assert.strictEqual(r1.non_user_cohort_contract.can_be_converted_to_real_users_now, false)
  assert.strictEqual(r2.non_user_cohort_contract.can_be_converted_to_real_users_now, false)
})

// T5: audit entries include ids real_users_blocked and real_emails_blocked
test('T5: audit entries include real_users_blocked and real_emails_blocked', () => {
  const result = evaluateNonUserCohortContract()
  const entries = result.non_user_cohort_audit.entries
  assert.ok(Array.isArray(entries), 'entries should be an array')
  const ids = entries.map(e => e.id)
  assert.ok(ids.includes('real_users_blocked'), 'should include real_users_blocked')
  assert.ok(ids.includes('real_emails_blocked'), 'should include real_emails_blocked')
})

// T6: summary → safe_for_simulation=true, safe_for_real_invites=false, safe_to_sell=false
test('T6: summary has safe_for_simulation=true, safe_for_real_invites=false, safe_to_sell=false', () => {
  const result = evaluateNonUserCohortContract()
  const s = result.non_user_cohort_summary
  assert.strictEqual(s.safe_for_simulation, true)
  assert.strictEqual(s.safe_for_real_invites, false)
  assert.strictEqual(s.safe_to_sell, false)
})

// T7: JSON.stringify does not throw
test('T7: JSON.stringify(evaluateNonUserCohortContract({})) does not throw', () => {
  let serialized
  assert.doesNotThrow(() => {
    serialized = JSON.stringify(evaluateNonUserCohortContract({}))
  })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'serialized result should be a non-empty string')
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const e of errors) console.error(`  - ${e.name}: ${e.error}`)
  process.exit(1)
}
