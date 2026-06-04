// src/services/internalExportStorage.test.js
// P3.8.23 — Internal Export Storage tests

import assert from 'node:assert/strict';
import {
  buildInternalExportStorageContract,
  buildStorageWriteSimulation,
  buildStorageRetentionPolicy,
  buildStorageSafetyManifest,
  evaluateInternalExportStorage,
} from './internalExportStorage.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// T1: default contract → correct flags all false
test('T1: default contract — status=contract_ready, storage flags all false', () => {
  const contract = buildInternalExportStorageContract();
  assert.equal(contract.status, 'contract_ready');
  assert.equal(contract.storage_enabled, false);
  assert.equal(contract.storage_write_enabled, false);
  assert.equal(contract.database_write_enabled, false);
});

// T2: input storage_write_enabled=true → output flag stays false, blockers includes entry
test('T2: storage_write_enabled=true → output false, simulation blocker present', () => {
  const contract = buildInternalExportStorageContract({ storage_write_enabled: true });
  assert.equal(contract.storage_write_enabled, false);

  const sim = buildStorageWriteSimulation({ storage_write_enabled: true });
  assert.equal(sim.write_allowed_now, false);
  assert.ok(sim.blockers.includes('storage_write_requested'));
});

// T3: input database_write_enabled=true → output stays false, blocker present
test('T3: database_write_enabled=true → output false, blocker present', () => {
  const contract = buildInternalExportStorageContract({ database_write_enabled: true });
  assert.equal(contract.database_write_enabled, false);

  const sim = buildStorageWriteSimulation({ database_write_enabled: true });
  assert.equal(sim.database_write_enabled, false);
  assert.ok(sim.blockers.includes('database_write_requested'));
});

// T4: retention policy → correct flags
test('T4: retention policy — retention_enabled_now=false, delete_enabled_now=false, future_retention_possible=true', () => {
  const policy = buildStorageRetentionPolicy();
  assert.equal(policy.retention_enabled_now, false);
  assert.equal(policy.delete_enabled_now, false);
  assert.equal(policy.future_retention_possible, true);
});

// T5: safety manifest clean input → contains_secrets=false, contains_real_users=false, can_sell=false
test('T5: safety manifest clean input — no secrets, no real users, can_sell=false', () => {
  const manifest = buildStorageSafetyManifest();
  assert.equal(manifest.contains_secrets, false);
  assert.equal(manifest.contains_real_users, false);
  assert.equal(manifest.can_sell, false);
});

// T6: commercial_claims_guard.claims_detected=true → status=warning or contains_commercial_claims=true
test('T6: commercial claims detected → manifest status=warning and contains_commercial_claims=true', () => {
  const manifest = buildStorageSafetyManifest({
    commercial_claims_guard: { claims_detected: true },
  });
  assert.equal(manifest.contains_commercial_claims, true);
  assert.ok(
    manifest.status === 'warning',
    `Expected status='warning', got '${manifest.status}'`
  );
});

// T7: evaluateInternalExportStorage({}) does not throw
test('T7: evaluateInternalExportStorage({}) serializes without throwing', () => {
  let result;
  assert.doesNotThrow(() => {
    result = evaluateInternalExportStorage({});
    JSON.stringify(result);
  });
  assert.ok(result.internal_export_storage_contract);
  assert.ok(result.storage_write_simulation);
  assert.ok(result.storage_retention_policy);
  assert.ok(result.storage_safety_manifest);
});

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
