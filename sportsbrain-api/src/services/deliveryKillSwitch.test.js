import assert from 'assert'
import { evaluateDeliveryKillSwitch } from './deliveryKillSwitch.js'

let passed = 0, failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1: default → armed status, global_delivery_disabled always true
test('T1: default → delivery_kill_switch.status=armed, global_delivery_disabled=true', () => {
  const result = evaluateDeliveryKillSwitch()
  const ks = result.delivery_kill_switch
  assert.strictEqual(ks.status, 'armed')
  assert.strictEqual(ks.global_delivery_disabled, true)
})

// T2: channel matrix includes required channels, all allowed=false
test('T2: channel_kill_switch_matrix includes email, webhook, api_delivery; all allowed=false', () => {
  const result = evaluateDeliveryKillSwitch()
  const channels = result.channel_kill_switch_matrix.channels
  const names = channels.map(c => c.channel)
  assert.ok(names.includes('email'),        'missing email channel')
  assert.ok(names.includes('webhook'),      'missing webhook channel')
  assert.ok(names.includes('api_delivery'), 'missing api_delivery channel')
  for (const ch of channels) {
    assert.strictEqual(ch.allowed, false, `channel ${ch.channel} has allowed=true`)
  }
})

// T3: real_delivery:true → status triggered, real_delivery_allowed still false
test('T3: real_delivery:true → status=triggered, real_delivery_allowed=false', () => {
  const result = evaluateDeliveryKillSwitch({ real_delivery: true })
  const ks = result.delivery_kill_switch
  assert.strictEqual(ks.status, 'triggered')
  assert.strictEqual(ks.real_delivery_allowed, false)
})

// T4: email_delivery_enabled:true → email channel attempted=true, allowed=false
test('T4: email_delivery_enabled:true → email channel attempted=true, allowed=false', () => {
  const result = evaluateDeliveryKillSwitch({ email_delivery_enabled: true })
  const channels = result.channel_kill_switch_matrix.channels
  const emailCh = channels.find(c => c.channel === 'email')
  assert.ok(emailCh, 'email channel not found')
  assert.strictEqual(emailCh.attempted, true)
  assert.strictEqual(emailCh.allowed, false)
})

// T5: webhook_enabled:true → webhook channel attempted=true, allowed=false
test('T5: webhook_enabled:true → webhook channel attempted=true, allowed=false', () => {
  const result = evaluateDeliveryKillSwitch({ webhook_enabled: true })
  const channels = result.channel_kill_switch_matrix.channels
  const webhookCh = channels.find(c => c.channel === 'webhook')
  assert.ok(webhookCh, 'webhook channel not found')
  assert.strictEqual(webhookCh.attempted, true)
  assert.strictEqual(webhookCh.allowed, false)
})

// T6: paid_access_enabled:true → paid_access_allowed always false
test('T6: paid_access_enabled:true → paid_access_allowed=false', () => {
  const result = evaluateDeliveryKillSwitch({ paid_access_enabled: true })
  assert.strictEqual(result.delivery_kill_switch.paid_access_allowed, false)
})

// T7: audit entries include required ids
test('T7: delivery_kill_switch_audit entries include global_kill_switch_armed and all_channels_locked', () => {
  const result = evaluateDeliveryKillSwitch()
  const ids = result.delivery_kill_switch_audit.entries.map(e => e.id)
  assert.ok(ids.includes('global_kill_switch_armed'), 'missing global_kill_switch_armed')
  assert.ok(ids.includes('all_channels_locked'),      'missing all_channels_locked')
})

// T8: summary flags always false
test('T8: summary → delivery_allowed=false, safe_to_invite_private_users=false, safe_to_sell=false', () => {
  const result = evaluateDeliveryKillSwitch()
  const s = result.delivery_kill_switch_summary
  assert.strictEqual(s.delivery_allowed,             false)
  assert.strictEqual(s.safe_to_invite_private_users, false)
  assert.strictEqual(s.safe_to_sell,                 false)
})

// T9: JSON.stringify does not throw
test('T9: JSON.stringify(evaluateDeliveryKillSwitch({})) does not throw', () => {
  let json
  assert.doesNotThrow(() => { json = JSON.stringify(evaluateDeliveryKillSwitch({})) })
  assert.ok(typeof json === 'string' && json.length > 0)
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const e of errors) console.error(`  - ${e.name}: ${e.error}`)
  process.exit(1)
}
