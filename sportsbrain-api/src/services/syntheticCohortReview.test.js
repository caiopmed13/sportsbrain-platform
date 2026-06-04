// syntheticCohortReview.test.js
// No external test libraries — uses built-in assert only.
import assert from 'assert'
import { evaluateSyntheticCohortReview } from './syntheticCohortReview.js'

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

// T1: default input → review status passed, passed=true, no real users
test('T1: default input produces passed review', () => {
  const r = evaluateSyntheticCohortReview({})
  assert.strictEqual(r.synthetic_cohort_review.status, 'passed')
  assert.strictEqual(r.synthetic_cohort_review.passed, true)
  assert.strictEqual(r.synthetic_cohort_review.real_users_detected, false)
})

// T2: safety matrix has members, all passed, all real_user=false
test('T2: default safety matrix all members pass, real_user always false', () => {
  const r = evaluateSyntheticCohortReview({})
  assert.ok(r.synthetic_member_safety_matrix.members_count >= 1)
  assert.ok(r.synthetic_member_safety_matrix.members.every(m => m.passed === true))
  assert.ok(r.synthetic_member_safety_matrix.members.every(m => m.real_user === false))
})

// T3: member with email → email_present=true, member passed=false, review blocked/critical_violation
test('T3: member with email flags violation and blocks review', () => {
  const input = {
    non_user_cohort_members: {
      members: [{ member_id: 'test-001', email: 'test@example.com', real_user: false }],
    },
  }
  const r = evaluateSyntheticCohortReview(input)
  const member = r.synthetic_member_safety_matrix.members.find(m => m.member_id === 'test-001')
  assert.ok(member.email_present === true)
  assert.strictEqual(member.passed, false)
  assert.ok(
    ['blocked', 'critical_violation'].includes(r.synthetic_cohort_review.status),
    `Expected blocked or critical_violation, got: ${r.synthetic_cohort_review.status}`
  )
})

// T4: member with user_id → user_id_present=true, failed_members_count > 0
test('T4: member with user_id increments failed_members_count', () => {
  const input = {
    non_user_cohort_members: {
      members: [{ member_id: 'test-002', user_id: 'real-user-123', real_user: false }],
    },
  }
  const r = evaluateSyntheticCohortReview(input)
  const member = r.synthetic_member_safety_matrix.members.find(m => m.member_id === 'test-002')
  assert.ok(member.user_id_present === true)
  assert.ok(r.synthetic_member_safety_matrix.failed_members_count > 0)
})

// T5: findings include synthetic_members_only and no_real_emails
test('T5: findings include synthetic_members_only and no_real_emails', () => {
  const r = evaluateSyntheticCohortReview({})
  const ids = r.synthetic_cohort_findings.findings.map(f => f.finding_id)
  assert.ok(ids.includes('synthetic_members_only'), 'Missing synthetic_members_only finding')
  assert.ok(ids.includes('no_real_emails'), 'Missing no_real_emails finding')
})

// T6: summary invariants — safe_for_dry_invite=true, safe_for_real_invite=false, safe_to_sell=false
test('T6: summary safety flags are correct for clean cohort', () => {
  const r = evaluateSyntheticCohortReview({})
  assert.strictEqual(r.synthetic_cohort_review_summary.safe_for_dry_invite, true)
  assert.strictEqual(r.synthetic_cohort_review_summary.safe_for_real_invite, false)
  assert.strictEqual(r.synthetic_cohort_review_summary.safe_to_sell, false)
})

// T7: output is JSON-serialisable
test('T7: JSON.stringify does not throw', () => {
  const r = evaluateSyntheticCohortReview({})
  assert.doesNotThrow(() => JSON.stringify(r))
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('FAILURES:', errors)
  process.exit(1)
}
