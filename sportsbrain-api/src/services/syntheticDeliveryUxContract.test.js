import { evaluateSyntheticDeliveryUxContract } from './syntheticDeliveryUxContract.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — ux contract default
test('ux contract default', () => {
  const result = evaluateSyntheticDeliveryUxContract({})
  assert(result.synthetic_delivery_ux_contract.status === 'defined', `status should be 'defined', got '${result.synthetic_delivery_ux_contract.status}'`)
  assert(result.synthetic_delivery_ux_contract.internal_preview_only === true, 'internal_preview_only should be true')
  assert(result.synthetic_delivery_ux_contract.allows_real_delivery === false, 'allows_real_delivery should be false')
})

// Test 2 — channel matrix locks real channels
test('channel matrix locks real channels', () => {
  const result = evaluateSyntheticDeliveryUxContract({})
  const email = result.synthetic_delivery_channel_matrix.channels.find(c => c.channel === 'email')
  const webhook = result.synthetic_delivery_channel_matrix.channels.find(c => c.channel === 'webhook')
  assert(email.real_allowed === false, 'email real_allowed should be false')
  assert(email.locked === true, 'email locked should be true')
  assert(webhook.real_allowed === false, 'webhook real_allowed should be false')
  assert(webhook.locked === true, 'webhook locked should be true')
})

// Test 3 — internal preview allowed synthetic only
test('internal preview allowed synthetic only', () => {
  const result = evaluateSyntheticDeliveryUxContract({})
  const preview = result.synthetic_delivery_channel_matrix.channels.find(c => c.channel === 'internal_preview')
  assert(preview.synthetic_allowed === true, 'internal_preview synthetic_allowed should be true')
  assert(preview.real_allowed === false, 'internal_preview real_allowed should be false')
})

// Test 4 — synthetic artifacts generated
test('synthetic artifacts generated', () => {
  const result = evaluateSyntheticDeliveryUxContract({})
  assert(result.synthetic_ux_artifacts.artifacts.some(a => a.artifact === 'simulated_pick_card'), 'missing simulated_pick_card artifact')
  assert(result.synthetic_ux_artifacts.artifacts.some(a => a.artifact === 'simulated_risk_disclaimer'), 'missing simulated_risk_disclaimer artifact')
  assert(result.synthetic_ux_artifacts.artifacts.every(a => a.internal_only === true), 'all artifacts should have internal_only=true')
})

// Test 5 — unsafe allows_real_delivery sanitized
test('unsafe allows_real_delivery sanitized', () => {
  const result = evaluateSyntheticDeliveryUxContract({ allows_real_delivery: true, delivery_allowed: true })
  assert(result.synthetic_delivery_ux_contract.allows_real_delivery === false, 'allows_real_delivery should be false after sanitization')
  assert(result.synthetic_delivery_ux_contract.violations.length > 0, 'violations should be non-empty for unsafe fields')
})

// Test 6 — summary safe
test('summary safe', () => {
  const result = evaluateSyntheticDeliveryUxContract({})
  assert(result.synthetic_delivery_ux_summary.real_delivery_allowed === false, 'real_delivery_allowed should be false')
  assert(result.synthetic_delivery_ux_summary.safe_to_invite_private_users === false, 'safe_to_invite_private_users should be false')
  assert(result.synthetic_delivery_ux_summary.safe_to_sell === false, 'safe_to_sell should be false')
})

// Test 7 — output serializable
test('output serializable', () => {
  const result = evaluateSyntheticDeliveryUxContract({})
  let threw = false
  try { JSON.stringify(result) } catch(e) { threw = true }
  assert(!threw, 'result should be JSON serializable')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
