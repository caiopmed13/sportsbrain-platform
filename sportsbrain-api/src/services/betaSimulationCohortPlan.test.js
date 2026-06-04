import { evaluateBetaSimulationCohortPlan } from './betaSimulationCohortPlan.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — cohort plan default
test('cohort plan default', () => {
  const result = evaluateBetaSimulationCohortPlan({})
  assert(result.beta_simulation_cohort_plan.status === 'planned', `status should be 'planned', got '${result.beta_simulation_cohort_plan.status}'`)
  assert(result.beta_simulation_cohort_plan.real_users_allowed === false, 'real_users_allowed should be false')
  assert(result.beta_simulation_cohort_plan.delivery_allowed === false, 'delivery_allowed should be false')
})

// Test 2 — synthetic members generated
test('synthetic members generated', () => {
  const result = evaluateBetaSimulationCohortPlan({})
  assert(result.synthetic_beta_cohort_members.members_count === 5, `members_count should be 5, got ${result.synthetic_beta_cohort_members.members_count}`)
  assert(result.synthetic_beta_cohort_members.members.every(m => m.synthetic === true), 'all members should have synthetic=true')
  assert(result.synthetic_beta_cohort_members.members.every(m => m.email === null), 'all members should have email=null')
  assert(result.synthetic_beta_cohort_members.members.every(m => m.real_user === false), 'all members should have real_user=false')
})

// Test 3 — no real delivery target
test('no real delivery target', () => {
  const result = evaluateBetaSimulationCohortPlan({})
  assert(result.synthetic_beta_cohort_members.members.every(m => m.delivery_target === null), 'all members should have delivery_target=null')
  assert(result.synthetic_beta_cohort_members.members.every(m => m.allowed_to_receive_real_picks === false), 'all members should have allowed_to_receive_real_picks=false')
})

// Test 4 — risk review contains leakage risks
test('risk review contains leakage risks', () => {
  const result = evaluateBetaSimulationCohortPlan({})
  assert(result.beta_cohort_risk_review.risks.some(r => r.risk === 'real_user_leakage'), 'should have real_user_leakage risk')
  assert(result.beta_cohort_risk_review.risks.some(r => r.risk === 'email_delivery_leakage'), 'should have email_delivery_leakage risk')
})

// Test 5 — summary safe
test('summary safe', () => {
  const result = evaluateBetaSimulationCohortPlan({})
  assert(result.beta_simulation_cohort_summary.ready_for_real_beta === false, 'ready_for_real_beta should be false')
  assert(result.beta_simulation_cohort_summary.safe_to_invite_private_users === false, 'safe_to_invite_private_users should be false')
  assert(result.beta_simulation_cohort_summary.safe_to_sell === false, 'safe_to_sell should be false')
})

// Test 6 — unsafe real_users_allowed sanitized
test('unsafe real_users_allowed sanitized', () => {
  const result = evaluateBetaSimulationCohortPlan({ real_users_allowed: true, real_users: true })
  assert(result.beta_simulation_cohort_plan.real_users_allowed === false, 'real_users_allowed should be false after sanitization')
  assert(result.beta_simulation_cohort_plan.violations.length > 0, `violations should be non-empty, got ${result.beta_simulation_cohort_plan.violations.length}`)
})

// Test 7 — output serializable
test('output serializable', () => {
  const result = evaluateBetaSimulationCohortPlan({})
  let threw = false
  try { JSON.stringify(result) } catch(e) { threw = true }
  assert(!threw, 'JSON.stringify should not throw')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
