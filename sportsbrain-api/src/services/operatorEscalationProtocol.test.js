// operatorEscalationProtocol.test.js

import assert from 'assert';
import { evaluateOperatorEscalationProtocol } from './operatorEscalationProtocol.js';

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

// T1: operator_escalation_protocol status=defined, external_escalation_allowed=false, operator_notified_externally=false
test('T1: operator_escalation_protocol base safety flags', () => {
  const result = evaluateOperatorEscalationProtocol();
  const p = result.operator_escalation_protocol;
  assert.strictEqual(p.status, 'defined');
  assert.strictEqual(p.external_escalation_allowed, false);
  assert.strictEqual(p.operator_notified_externally, false);
});

// T2: blocked_channels_now includes email, webhook, public_page
test('T2: blocked_channels_now includes email, webhook, public_page', () => {
  const result = evaluateOperatorEscalationProtocol();
  const blocked = result.operator_escalation_protocol.blocked_channels_now;
  assert.ok(blocked.includes('email'), 'email should be blocked');
  assert.ok(blocked.includes('webhook'), 'webhook should be blocked');
  assert.ok(blocked.includes('public_page'), 'public_page should be blocked');
});

// T3: escalation_decision_matrix decisions include trigger=critical_incident_detected and trigger=recovery_simulated
test('T3: escalation_decision_matrix has critical_incident_detected and recovery_simulated triggers', () => {
  const result = evaluateOperatorEscalationProtocol();
  const decisions = result.escalation_decision_matrix.decisions;
  const triggers = decisions.map((d) => d.trigger);
  assert.ok(triggers.includes('critical_incident_detected'), 'missing critical_incident_detected');
  assert.ok(triggers.includes('recovery_simulated'), 'missing recovery_simulated');
});

// T4: all decisions have external_action=false and can_override_freeze=false
test('T4: all decisions have external_action=false and can_override_freeze=false', () => {
  const result = evaluateOperatorEscalationProtocol();
  const decisions = result.escalation_decision_matrix.decisions;
  for (const d of decisions) {
    assert.strictEqual(d.external_action, false, `decision ${d.trigger} external_action should be false`);
    assert.strictEqual(d.can_override_freeze, false, `decision ${d.trigger} can_override_freeze should be false`);
  }
});

// T5: internal_escalation_audit entries include external_channels_blocked and no_external_notification_confirmed
test('T5: internal_escalation_audit has external_channels_blocked and no_external_notification_confirmed', () => {
  const result = evaluateOperatorEscalationProtocol();
  const entries = result.internal_escalation_audit.entries;
  const ids = entries.map((e) => e.entry_id);
  assert.ok(ids.includes('external_channels_blocked'), 'missing external_channels_blocked');
  assert.ok(ids.includes('no_external_notification_confirmed'), 'missing no_external_notification_confirmed');
});

// T6: unsafe input {external_escalation_sent: true} → output external_escalation_sent=false, violations.length > 0
test('T6: unsafe input sanitized, violations recorded, external_escalation_sent=false', () => {
  const result = evaluateOperatorEscalationProtocol({ external_escalation_sent: true });
  const p = result.operator_escalation_protocol;
  const s = result.escalation_protocol_summary;
  assert.strictEqual(s.external_escalation_sent, false, 'external_escalation_sent must be false in summary');
  assert.ok(p.violations.length > 0, 'violations should be non-empty');
  assert.strictEqual(p.unsafe_input_sanitized, true, 'unsafe_input_sanitized should be true');
});

// T7: escalation_protocol_summary safe_to_invite_private_users=false, safe_to_sell=false, can_enable_beta=false, can_enable_sell=false
test('T7: escalation_protocol_summary all safety fields false', () => {
  const result = evaluateOperatorEscalationProtocol();
  const s = result.escalation_protocol_summary;
  assert.strictEqual(s.safe_to_invite_private_users, false);
  assert.strictEqual(s.safe_to_sell, false);
  assert.strictEqual(s.can_enable_beta, false);
  assert.strictEqual(s.can_enable_sell, false);
});

// T8: JSON.stringify does not throw
test('T8: result is JSON-serializable', () => {
  const result = evaluateOperatorEscalationProtocol();
  let json;
  assert.doesNotThrow(() => {
    json = JSON.stringify(result);
  });
  assert.ok(typeof json === 'string' && json.length > 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:', errors);
  process.exit(1);
}
