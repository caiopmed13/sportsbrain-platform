// src/services/reportHistorySimulation.test.js
// P3.8.22 — Tests for Versioned Report History Simulation & Report History Diff

import assert from 'node:assert/strict';
import {
  buildCurrentReportVersion,
  buildSimulatedReportHistory,
  compareReportVersions,
  buildReportHistoryDiff,
  evaluateReportHistorySimulation,
} from './reportHistorySimulation.js';

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

// T1: current version basic shape
test('T1: current version has version_id=current, can_beta=false, can_sell=false, download_enabled=false', () => {
  const v = buildCurrentReportVersion({});
  assert.equal(v.version_id, 'current');
  assert.equal(v.can_beta, false);
  assert.equal(v.can_sell, false);
  assert.equal(v.download_enabled, false);
});

// T2: simulated history includes all expected version IDs
test('T2: simulated history versions include previous_shadow, manual_review_ready_simulated, unsafe_attempt_sanitized, redacted_preview', () => {
  const h = buildSimulatedReportHistory({});
  const ids = h.versions.map(v => v.version_id);
  assert.ok(ids.includes('previous_shadow'), 'missing previous_shadow');
  assert.ok(ids.includes('manual_review_ready_simulated'), 'missing manual_review_ready_simulated');
  assert.ok(ids.includes('unsafe_attempt_sanitized'), 'missing unsafe_attempt_sanitized');
  assert.ok(ids.includes('redacted_preview'), 'missing redacted_preview');
});

// T3: simulated history persistence_enabled=false, simulation_only=true
test('T3: simulated history → persistence_enabled=false, simulation_only=true', () => {
  const h = buildSimulatedReportHistory({});
  assert.equal(h.persistence_enabled, false);
  assert.equal(h.simulation_only, true);
});

// T4: diff detects fingerprint changes
test('T4: diff detects fingerprint changes when versions have different fingerprints', () => {
  const current = { version_id: 'current', fingerprint: 'fp-NEW', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false };
  const versions = [
    current,
    { version_id: 'previous_shadow', fingerprint: 'fp-OLD', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false },
  ];
  const result = compareReportVersions(current, versions);
  assert.ok(result.fingerprint_changes.length > 0, 'expected fingerprint_changes to be non-empty');
  assert.equal(result.fingerprint_changes[0].from, 'fp-OLD');
  assert.equal(result.fingerprint_changes[0].to, 'fp-NEW');
});

// T5: diff detects can_beta false→true as critical
test('T5: diff detects can_beta false→true as critical diff', () => {
  const current = { version_id: 'current', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false };
  const versions = [
    current,
    { version_id: 'v_beta', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: true, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false },
  ];
  // current has can_beta=false, version has can_beta=true
  // from=true, to=false → critical only if from=false & to=true
  // To get critical=true, current must have can_beta=true and version must have can_beta=false
  const currentWithBeta = { ...current, can_beta: true };
  const versionsForBeta = [
    currentWithBeta,
    { version_id: 'v_beta', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false },
  ];
  const result = compareReportVersions(currentWithBeta, versionsForBeta);
  const betaDiff = result.safety_diffs.find(d => d.flag === 'can_beta');
  assert.ok(betaDiff, 'expected can_beta safety diff');
  assert.equal(betaDiff.critical, true);
});

// T6: diff detects can_sell false→true as critical diff
test('T6: diff detects can_sell false→true as critical diff', () => {
  const current = { version_id: 'current', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: false, can_sell: true, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false };
  const versions = [
    current,
    { version_id: 'v_sell', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false },
  ];
  const result = compareReportVersions(current, versions);
  const sellDiff = result.safety_diffs.find(d => d.flag === 'can_sell');
  assert.ok(sellDiff, 'expected can_sell safety diff');
  assert.equal(sellDiff.critical, true);
});

// T7: diff detects download_enabled false→true as critical diff
test('T7: diff detects download_enabled false→true as critical diff', () => {
  const current = { version_id: 'current', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: true, archive_persistence_enabled: false, physical_file_created: false };
  const versions = [
    current,
    { version_id: 'v_dl', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false },
  ];
  const result = compareReportVersions(current, versions);
  const dlDiff = result.safety_diffs.find(d => d.flag === 'download_enabled');
  assert.ok(dlDiff, 'expected download_enabled safety diff');
  assert.equal(dlDiff.critical, true);
});

// T8: diff detects decision 'launch' as critical change
test('T8: diff detects decision launch as critical change', () => {
  const current = { version_id: 'current', fingerprint: 'fp-A', decision: 'continue_shadow', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false };
  const versions = [
    current,
    { version_id: 'v_launch', fingerprint: 'fp-A', decision: 'launch', can_beta: false, can_sell: false, download_enabled: false, archive_persistence_enabled: false, physical_file_created: false },
  ];
  const result = compareReportVersions(current, versions);
  const launchChange = result.decision_changes.find(d => d.version_id === 'v_launch');
  assert.ok(launchChange, 'expected decision change for v_launch');
  assert.equal(launchChange.critical, true);
});

// T9: evaluateReportHistorySimulation does not throw
test('T9: JSON.stringify(evaluateReportHistorySimulation({})) does not throw', () => {
  let result;
  assert.doesNotThrow(() => {
    result = evaluateReportHistorySimulation({});
    JSON.stringify(result);
  });
  assert.ok(result.versioned_report_history_simulation);
  assert.ok(result.report_history_diff);
});

// Summary
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
