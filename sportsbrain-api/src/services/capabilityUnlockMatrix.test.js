import assert from 'assert'
import { evaluateCapabilityUnlockMatrix } from './capabilityUnlockMatrix.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1: default → capability_unlock_matrix.status=evaluated, unlockable_now_count=0
test('T1: default call → status=evaluated and unlockable_now_count=0', () => {
  const result = evaluateCapabilityUnlockMatrix({})
  const matrix = result.capability_unlock_matrix
  assert.strictEqual(matrix.status, 'evaluated')
  assert.strictEqual(matrix.unlockable_now_count, 0)
})

// T2: capabilities include required codes
test('T2: capabilities include internal_download, internal_storage, private_beta_real, public_beta, sell, real_delivery', () => {
  const result = evaluateCapabilityUnlockMatrix({})
  const codes = result.capability_unlock_matrix.capabilities.map(c => c.code)
  const required = ['internal_download', 'internal_storage', 'private_beta_real', 'public_beta', 'sell', 'real_delivery']
  for (const code of required) {
    assert.ok(codes.includes(code), `Missing capability: ${code}`)
  }
})

// T3: internal_download has unlockable_now=false, requires_future_phase=true
test('T3: internal_download has unlockable_now=false, requires_future_phase=true', () => {
  const result = evaluateCapabilityUnlockMatrix({})
  const cap = result.capability_unlock_matrix.capabilities.find(c => c.code === 'internal_download')
  assert.ok(cap, 'internal_download not found')
  assert.strictEqual(cap.unlockable_now, false)
  assert.strictEqual(cap.requires_future_phase, true)
})

// T4: sell has simulated_unlock_status=blocked (hard_blocked), unlockable_now=false
test('T4: sell has simulated_unlock_status=blocked and unlockable_now=false', () => {
  const result = evaluateCapabilityUnlockMatrix({})
  const cap = result.capability_unlock_matrix.capabilities.find(c => c.code === 'sell')
  assert.ok(cap, 'sell not found')
  assert.ok(
    cap.simulated_unlock_status === 'blocked' || cap.simulated_unlock_status === 'hard_blocked',
    `Expected blocked or hard_blocked, got ${cap.simulated_unlock_status}`
  )
  assert.strictEqual(cap.unlockable_now, false)
})

// T5: private_beta_real has can_be_unlocked_this_phase=false
test('T5: private_beta_real has can_be_unlocked_this_phase=false', () => {
  const result = evaluateCapabilityUnlockMatrix({})
  const cap = result.capability_unlock_matrix.capabilities.find(c => c.code === 'private_beta_real')
  assert.ok(cap, 'private_beta_real not found')
  assert.strictEqual(cap.can_be_unlocked_this_phase, false)
})

// T6: capability_risk_profile.overall_risk=high and risk_by_capability includes commercial_exposure
test('T6: risk_profile overall_risk=high and risk_by_capability includes commercial_exposure', () => {
  const result = evaluateCapabilityUnlockMatrix({})
  const profile = result.capability_risk_profile
  assert.strictEqual(profile.overall_risk, 'high')
  const entry = profile.risk_by_capability.find(r => r.code === 'commercial_exposure')
  assert.ok(entry, 'commercial_exposure not found in risk_by_capability')
})

// T7: summary can_unlock_any_now=false, safe_to_sell=false, safe_to_invite_private_users=false
test('T7: summary can_unlock_any_now=false, safe_to_sell=false, safe_to_invite_private_users=false', () => {
  const result = evaluateCapabilityUnlockMatrix({})
  const summary = result.capability_unlock_summary
  assert.strictEqual(summary.can_unlock_any_now, false)
  assert.strictEqual(summary.safe_to_sell, false)
  assert.strictEqual(summary.safe_to_invite_private_users, false)
})

// T8: can_sell=true input → safety invariant preserved (can_unlock_any_now=false, safe_to_sell=false)
test('T8: can_sell=true input → safety invariant preserved', () => {
  const result = evaluateCapabilityUnlockMatrix({ can_sell: true })
  const summary = result.capability_unlock_summary
  assert.strictEqual(summary.can_unlock_any_now, false)
  assert.strictEqual(summary.safe_to_sell, false)
})

// T9: JSON.stringify(evaluateCapabilityUnlockMatrix({})) does not throw
test('T9: JSON.stringify of full result does not throw', () => {
  let serialized
  assert.doesNotThrow(() => {
    serialized = JSON.stringify(evaluateCapabilityUnlockMatrix({}))
  })
  assert.ok(typeof serialized === 'string' && serialized.length > 0)
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
