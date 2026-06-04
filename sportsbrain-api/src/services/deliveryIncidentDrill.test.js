// deliveryIncidentDrill.test.js
import assert from 'assert'
import { evaluateDeliveryIncidentDrill } from './deliveryIncidentDrill.js'

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

// T1: scenarios include required IDs
test('T1: scenarios include required IDs', () => {
  const r = evaluateDeliveryIncidentDrill({})
  const ids = r.delivery_incident_scenarios.scenarios.map(s => s.scenario_id)
  assert.ok(ids.includes('real_invite_attempt'))
  assert.ok(ids.includes('email_send_attempt'))
  assert.ok(ids.includes('webhook_send_attempt'))
  assert.ok(ids.includes('pick_delivery_attempt'))
})

// T2: drill simulated, passed=true, real_actions_taken=false
test('T2: drill simulated, passed=true, real_actions_taken=false', () => {
  const r = evaluateDeliveryIncidentDrill({})
  assert.ok(['simulated', 'passed'].includes(r.delivery_incident_drill.status))
  assert.strictEqual(r.delivery_incident_drill.passed, true)
  assert.strictEqual(r.delivery_incident_drill.real_actions_taken, false)
  assert.strictEqual(r.delivery_incident_drill.incident_real_action_taken, false)
})

// T3: incident response plan has required steps
test('T3: incident response plan has required steps', () => {
  const r = evaluateDeliveryIncidentDrill({})
  const stepIds = r.incident_response_plan.steps.map(s => s.step_id)
  assert.ok(stepIds.includes('relock_all_channels'))
  assert.ok(stepIds.includes('verify_global_kill_switch'))
  assert.ok(stepIds.includes('operator_manual_review'))
  assert.strictEqual(r.incident_response_plan.automatic_actions_allowed_now, false)
  assert.strictEqual(r.incident_response_plan.external_notifications_allowed_now, false)
})

// T4: kill switch drill all channels blocked
test('T4: kill switch drill all channels blocked', () => {
  const r = evaluateDeliveryIncidentDrill({})
  assert.strictEqual(r.kill_switch_drill_report.all_channels_blocked, true)
  assert.strictEqual(r.kill_switch_drill_report.failed_channels_count, 0)
  assert.strictEqual(r.kill_switch_drill_report.delivery_allowed, false)
  assert.strictEqual(r.kill_switch_drill_report.global_delivery_disabled, true)
  assert.ok(r.kill_switch_drill_report.results.length >= 9)
})

// T5: unsafe email_delivery_enabled=true — email scenario still would_be_blocked, unsafe input sanitized
test('T5: unsafe email_delivery_enabled=true sanitized', () => {
  const r = evaluateDeliveryIncidentDrill({ email_delivery_enabled: true })
  const emailScenario = r.delivery_incident_scenarios.scenarios.find(s => s.scenario_id === 'email_send_attempt')
  assert.strictEqual(emailScenario.would_be_blocked, true)
  assert.strictEqual(emailScenario.real_action_taken, false)
  // unsafe input sanitized
  assert.strictEqual(r.delivery_incident_drill.unsafe_input_sanitized, true)
})

// T6: unsafe incident_real_action_taken=true → sanitized to false, violation recorded
test('T6: unsafe incident_real_action_taken=true → sanitized, violation recorded', () => {
  const r = evaluateDeliveryIncidentDrill({ incident_real_action_taken: true })
  assert.strictEqual(r.delivery_incident_drill.incident_real_action_taken, false)
  assert.ok(r.delivery_incident_drill.violations.length > 0)
  assert.strictEqual(r.delivery_incident_drill.unsafe_input_sanitized, true)
})

// T7: summary passed, all safety flags false
test('T7: summary passed, all safety flags false', () => {
  const r = evaluateDeliveryIncidentDrill({})
  assert.strictEqual(r.incident_drill_summary.real_actions_taken, false)
  assert.strictEqual(r.incident_drill_summary.safe_to_invite_private_users, false)
  assert.strictEqual(r.incident_drill_summary.safe_to_sell, false)
  assert.strictEqual(r.incident_drill_summary.delivery_allowed, false)
})

// T8: JSON.stringify does not throw
test('T8: JSON.stringify does not throw', () => {
  const r = evaluateDeliveryIncidentDrill({})
  assert.doesNotThrow(() => JSON.stringify(r))
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error('FAILURES:', errors); process.exit(1) }
