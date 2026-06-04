// incidentRecoverySimulation.test.js
// Cloudflare Workers Node.js ESM

import assert from 'assert';
import { evaluateIncidentRecoverySimulation } from './incidentRecoverySimulation.js';

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

// T1: safety invariants on base output
test('T1: incident_recovery_simulation has safe invariants', () => {
  const result = evaluateIncidentRecoverySimulation();
  const sim = result.incident_recovery_simulation;
  assert.ok(
    sim.status === 'simulated' || sim.status === 'contained',
    `status should be simulated or contained, got: ${sim.status}`
  );
  assert.strictEqual(sim.recovery_real_action_taken, false);
  assert.strictEqual(sim.automatic_recovery_executed, false);
});

// T2: recovery_action_plan steps and external_actions_allowed
test('T2: recovery_action_plan has required steps and external_actions_allowed=false', () => {
  const result = evaluateIncidentRecoverySimulation();
  const plan = result.recovery_action_plan;
  assert.strictEqual(plan.external_actions_allowed, false);
  const stepIds = plan.steps.map((s) => s.step_id);
  assert.ok(
    stepIds.includes('confirm_global_kill_switch_armed'),
    'missing step: confirm_global_kill_switch_armed'
  );
  assert.ok(
    stepIds.includes('relock_all_delivery_channels'),
    'missing step: relock_all_delivery_channels'
  );
  assert.ok(
    stepIds.includes('operator_manual_review'),
    'missing step: operator_manual_review'
  );
});

// T3: recovery_verification_checklist status and key items
test('T3: recovery_verification_checklist passed with can_beta_false and can_sell_false items', () => {
  const result = evaluateIncidentRecoverySimulation();
  const checklist = result.recovery_verification_checklist;
  assert.strictEqual(checklist.status, 'passed');
  const itemIds = checklist.items.map((i) => i.item_id);
  assert.ok(itemIds.includes('can_beta_false'), 'missing item: can_beta_false');
  assert.ok(itemIds.includes('can_sell_false'), 'missing item: can_sell_false');
});

// T4: unsafe input recovery_real_action_taken forced to false, violations recorded
test('T4: unsafe input recovery_real_action_taken=true → forced false, violations recorded', () => {
  const result = evaluateIncidentRecoverySimulation({ recovery_real_action_taken: true });
  const sim = result.incident_recovery_simulation;
  assert.strictEqual(sim.recovery_real_action_taken, false);
  assert.ok(
    Array.isArray(sim.violations) && sim.violations.length > 0,
    'violations should be non-empty array'
  );
});

// T5: unsafe input operator_notified_externally forced to false
test('T5: unsafe input operator_notified_externally=true → output forces false', () => {
  const result = evaluateIncidentRecoverySimulation({ operator_notified_externally: true });
  const summary = result.incident_response_summary;
  assert.strictEqual(summary.operator_notified_externally, false);
  // Also verify violations were recorded
  const sim = result.incident_recovery_simulation;
  assert.ok(
    Array.isArray(sim.violations) && sim.violations.length > 0,
    'violations should be non-empty array'
  );
});

// T6: incident_response_summary safe flags
test('T6: incident_response_summary has correct safe flags', () => {
  const result = evaluateIncidentRecoverySimulation();
  const summary = result.incident_response_summary;
  assert.strictEqual(summary.safe_to_continue_internal_review, true);
  assert.strictEqual(summary.safe_to_invite_private_users, false);
  assert.strictEqual(summary.safe_to_sell, false);
});

// T7: JSON.stringify does not throw
test('T7: JSON.stringify of full result does not throw', () => {
  const result = evaluateIncidentRecoverySimulation({ can_beta: true, can_sell: true });
  let json;
  assert.doesNotThrow(() => {
    json = JSON.stringify(result);
  });
  assert.ok(typeof json === 'string' && json.length > 0, 'JSON output should be non-empty string');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:', errors);
  process.exit(1);
}
