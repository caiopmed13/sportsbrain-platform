// betaSafetyIncidentLedger.test.js
import assert from 'assert';
import { evaluateBetaSafetyIncidentLedger } from './betaSafetyIncidentLedger.js';

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    errors.push({ name, error: err.message });
    failed++;
  }
}

// T1: ledger status=simulated or contained, persistence_enabled=false, real_actions_taken=false
test('T1: ledger status is simulated/contained, persistence_enabled=false, real_actions_taken=false', () => {
  const result = evaluateBetaSafetyIncidentLedger();
  const { beta_safety_incident_ledger } = result;
  assert(
    beta_safety_incident_ledger.status === 'simulated' || beta_safety_incident_ledger.status === 'contained',
    `Expected status 'simulated' or 'contained', got '${beta_safety_incident_ledger.status}'`
  );
  assert.strictEqual(beta_safety_incident_ledger.persistence_enabled, false, 'persistence_enabled must be false');
  assert.strictEqual(beta_safety_incident_ledger.real_actions_taken, false, 'real_actions_taken must be false');
});

// T2: simulated_incident_records includes specific scenario_ids
test('T2: simulated_incident_records includes real_invite_attempt, email_send_attempt, webhook_send_attempt, pick_delivery_attempt', () => {
  const result = evaluateBetaSafetyIncidentLedger();
  const { simulated_incident_records } = result;
  const scenarioIds = simulated_incident_records.map(r => r.scenario_id);
  assert(scenarioIds.includes('real_invite_attempt'), 'Missing scenario_id: real_invite_attempt');
  assert(scenarioIds.includes('email_send_attempt'), 'Missing scenario_id: email_send_attempt');
  assert(scenarioIds.includes('webhook_send_attempt'), 'Missing scenario_id: webhook_send_attempt');
  assert(scenarioIds.includes('pick_delivery_attempt'), 'Missing scenario_id: pick_delivery_attempt');
});

// T3: incident_severity_matrix — email_send_attempt severity=critical, webhook_send_attempt severity=critical
test('T3: incident_severity_matrix items — email_send_attempt and webhook_send_attempt are critical', () => {
  const result = evaluateBetaSafetyIncidentLedger();
  const { incident_severity_matrix } = result;
  const items = incident_severity_matrix.items;
  const emailItem = items.find(i => i.scenario_id === 'email_send_attempt');
  const webhookItem = items.find(i => i.scenario_id === 'webhook_send_attempt');
  assert(emailItem, 'email_send_attempt not found in severity matrix items');
  assert.strictEqual(emailItem.severity, 'critical', `email_send_attempt severity expected 'critical', got '${emailItem.severity}'`);
  assert(webhookItem, 'webhook_send_attempt not found in severity matrix items');
  assert.strictEqual(webhookItem.severity, 'critical', `webhook_send_attempt severity expected 'critical', got '${webhookItem.severity}'`);
});

// T4: all records have real_action_taken=false and status=contained
test('T4: all simulated_incident_records have real_action_taken=false and status=contained', () => {
  const result = evaluateBetaSafetyIncidentLedger();
  const { simulated_incident_records } = result;
  for (const record of simulated_incident_records) {
    assert.strictEqual(record.real_action_taken, false, `Record ${record.incident_id} has real_action_taken !== false`);
    assert.strictEqual(record.status, 'contained', `Record ${record.incident_id} has status !== 'contained'`);
  }
});

// T5: unsafe input {incident_real_action_taken: true} → real_actions_taken=false, violations.length > 0
test('T5: unsafe input incident_real_action_taken=true → real_actions_taken=false, violations.length > 0', () => {
  const result = evaluateBetaSafetyIncidentLedger({ incident_real_action_taken: true });
  const { beta_safety_incident_ledger } = result;
  assert.strictEqual(beta_safety_incident_ledger.real_actions_taken, false, 'real_actions_taken must be forced to false');
  assert(beta_safety_incident_ledger.violations.length > 0, 'violations array must be non-empty for unsafe input');
});

// T6: incident_ledger_summary fields
test('T6: incident_ledger_summary safe_to_continue_internal_review=true, safe_to_invite_private_users=false, safe_to_sell=false', () => {
  const result = evaluateBetaSafetyIncidentLedger();
  const { incident_ledger_summary } = result;
  assert.strictEqual(incident_ledger_summary.safe_to_continue_internal_review, true, 'safe_to_continue_internal_review must be true');
  assert.strictEqual(incident_ledger_summary.safe_to_invite_private_users, false, 'safe_to_invite_private_users must be false');
  assert.strictEqual(incident_ledger_summary.safe_to_sell, false, 'safe_to_sell must be false');
});

// T7: JSON.stringify does not throw
test('T7: JSON.stringify of full result does not throw', () => {
  const result = evaluateBetaSafetyIncidentLedger();
  let json;
  assert.doesNotThrow(() => {
    json = JSON.stringify(result);
  }, 'JSON.stringify threw an error');
  assert(typeof json === 'string' && json.length > 0, 'JSON.stringify returned empty or non-string');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:', errors);
  process.exit(1);
}
