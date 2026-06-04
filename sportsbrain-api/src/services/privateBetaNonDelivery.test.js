import assert from 'assert'
import { evaluatePrivateBetaNonDelivery } from './privateBetaNonDelivery.js'

let passed = 0, failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1: default call — contract status + always-false delivery flags
test('T1: default → contract enforced, delivery flags always false', () => {
  const result = evaluatePrivateBetaNonDelivery()
  const c = result.private_beta_non_delivery_contract
  assert.strictEqual(c.status, 'enforced')
  assert.strictEqual(c.private_beta_delivery_allowed, false)
  assert.strictEqual(c.real_users_allowed, false)
})

// T2: enforcement check ids present
test('T2: enforcement checks include required ids', () => {
  const result = evaluatePrivateBetaNonDelivery()
  const ids = result.non_delivery_enforcement.checks.map(c => c.id)
  assert.ok(ids.includes('no_real_users'),              'missing no_real_users')
  assert.ok(ids.includes('no_real_delivery'),           'missing no_real_delivery')
  assert.ok(ids.includes('no_private_beta_delivery'),   'missing no_private_beta_delivery')
  assert.ok(ids.includes('no_paid_access'),             'missing no_paid_access')
})

// T3: real_users: true → enforcement fails no_real_users; contract still false
test('T3: real_users:true → no_real_users fails, contract real_users_allowed still false', () => {
  const result = evaluatePrivateBetaNonDelivery({ real_users: true })
  const check = result.non_delivery_enforcement.checks.find(c => c.id === 'no_real_users')
  assert.ok(check, 'check no_real_users not found')
  assert.strictEqual(check.passed, false)
  assert.strictEqual(result.private_beta_non_delivery_contract.real_users_allowed, false)
})

// T4: real_delivery: true → no_real_delivery fails
test('T4: real_delivery:true → no_real_delivery fails', () => {
  const result = evaluatePrivateBetaNonDelivery({ real_delivery: true })
  const check = result.non_delivery_enforcement.checks.find(c => c.id === 'no_real_delivery')
  assert.ok(check, 'check no_real_delivery not found')
  assert.strictEqual(check.passed, false)
})

// T5: email + webhook enabled → both checks fail
test('T5: email_delivery_enabled+webhook_enabled → no_email_delivery and no_webhook_delivery fail', () => {
  const result = evaluatePrivateBetaNonDelivery({ email_delivery_enabled: true, webhook_enabled: true })
  const checks = result.non_delivery_enforcement.checks
  const emailCheck   = checks.find(c => c.id === 'no_email_delivery')
  const webhookCheck = checks.find(c => c.id === 'no_webhook_delivery')
  assert.ok(emailCheck,   'no_email_delivery check missing')
  assert.ok(webhookCheck, 'no_webhook_delivery check missing')
  assert.strictEqual(emailCheck.passed,   false)
  assert.strictEqual(webhookCheck.passed, false)
})

// T6: paid_access + checkout + pricing → all three fail
test('T6: paid_access_enabled+checkout_enabled+pricing_enabled → no_paid_access, no_checkout, no_pricing fail', () => {
  const result = evaluatePrivateBetaNonDelivery({
    paid_access_enabled: true,
    checkout_enabled: true,
    pricing_enabled: true,
  })
  const failures = result.non_delivery_enforcement.critical_failures
  assert.ok(failures.includes('no_paid_access'), 'no_paid_access not in critical_failures')
  assert.ok(failures.includes('no_checkout'),    'no_checkout not in critical_failures')
  assert.ok(failures.includes('no_pricing'),     'no_pricing not in critical_failures')
})

// T7: checklist items present and passed_count=8
test('T7: checklist includes required items, passed_count=8', () => {
  const result = evaluatePrivateBetaNonDelivery()
  const cl = result.non_delivery_checklist
  const ids = cl.items.map(i => i.id)
  assert.ok(ids.includes('confirm_no_users_invited'),                   'missing confirm_no_users_invited')
  assert.ok(ids.includes('confirm_no_picks_sent'),                      'missing confirm_no_picks_sent')
  assert.ok(ids.includes('confirm_operator_understands_no_delivery'),   'missing confirm_operator_understands_no_delivery')
  assert.strictEqual(cl.passed_count, 8)
})

// T8: summary delivery flags always false
test('T8: summary → delivery_allowed, safe_to_invite_private_users, safe_to_sell all false', () => {
  const result = evaluatePrivateBetaNonDelivery()
  const s = result.non_delivery_summary
  assert.strictEqual(s.delivery_allowed,              false)
  assert.strictEqual(s.safe_to_invite_private_users,  false)
  assert.strictEqual(s.safe_to_sell,                  false)
})

// T9: JSON.stringify does not throw
test('T9: JSON.stringify(evaluatePrivateBetaNonDelivery({})) does not throw', () => {
  let json
  assert.doesNotThrow(() => { json = JSON.stringify(evaluatePrivateBetaNonDelivery({})) })
  assert.ok(typeof json === 'string' && json.length > 0)
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const e of errors) console.error(`  - ${e.name}: ${e.error}`)
  process.exit(1)
}
