// src/services/releaseFreezeSentinel.test.js
// P3.8.23 — Tests for Release Freeze Sentinel, Policy & Enforcement

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildReleaseFreezePolicy,
  buildFreezeBaseline,
  buildFreezeDiffReport,
  buildReleaseFreezeSentinel,
  buildFreezeEnforcementSummary,
  evaluateReleaseFreezeSentinel,
} from './releaseFreezeSentinel.js';

// T1: default input → freeze_enabled=true, sentinel status=frozen, passed=true
test('T1: default input — freeze_enabled=true, sentinel frozen, passed=true', () => {
  const result = evaluateReleaseFreezeSentinel({});
  assert.strictEqual(result.release_freeze_policy.freeze_enabled, true);
  assert.strictEqual(result.release_freeze_sentinel.status,        'frozen');
  assert.strictEqual(result.release_freeze_sentinel.passed,        true);
});

// T2: can_beta=true → diff report has critical diff for can_beta, sentinel passed=false
test('T2: can_beta=true → drift detected, sentinel passed=false', () => {
  const result = evaluateReleaseFreezeSentinel({ can_beta: true });
  const diff   = result.freeze_diff_report;
  assert.ok(diff.diffs.some(d => d.flag === 'can_beta' && d.critical), 'expected critical diff for can_beta');
  assert.strictEqual(result.release_freeze_sentinel.passed, false);
});

// T3: can_sell=true → sell_frozen check fails
test('T3: can_sell=true → sell_frozen check fails', () => {
  const sentinel = buildReleaseFreezeSentinel({ can_sell: true });
  assert.ok(sentinel.critical_failures.includes('sell_frozen'), 'expected sell_frozen in critical_failures');
  assert.strictEqual(sentinel.passed, false);
});

// T4: download_enabled=true → download_frozen check fails
test('T4: download_enabled=true → download_frozen check fails', () => {
  const sentinel = buildReleaseFreezeSentinel({ download_enabled: true });
  assert.ok(sentinel.critical_failures.includes('download_frozen'), 'expected download_frozen');
  assert.strictEqual(sentinel.passed, false);
});

// T5: storage_write_enabled=true → storage_write_frozen check fails
test('T5: storage_write_enabled=true → storage_write_frozen check fails', () => {
  const sentinel = buildReleaseFreezeSentinel({ storage_write_enabled: true });
  assert.ok(sentinel.critical_failures.includes('storage_write_frozen'), 'expected storage_write_frozen');
});

// T6: archive_persistence_enabled=true → archive_persistence_frozen check fails
test('T6: archive_persistence_enabled=true → archive_persistence_frozen check fails', () => {
  const sentinel = buildReleaseFreezeSentinel({ archive_persistence_enabled: true });
  assert.ok(sentinel.critical_failures.includes('archive_persistence_frozen'), 'expected archive_persistence_frozen');
});

// T7: real_delivery=true → real_delivery_frozen check fails
test('T7: real_delivery=true → real_delivery_frozen check fails', () => {
  const sentinel = buildReleaseFreezeSentinel({ real_delivery: true });
  assert.ok(sentinel.critical_failures.includes('real_delivery_frozen'), 'expected real_delivery_frozen');
});

// T8: checkout_enabled=true OR pricing_enabled=true → respective checks fail
test('T8: checkout_enabled=true → checkout_frozen fails; pricing_enabled=true → pricing_frozen fails', () => {
  const s1 = buildReleaseFreezeSentinel({ checkout_enabled: true });
  assert.ok(s1.critical_failures.includes('checkout_frozen'), 'expected checkout_frozen');

  const s2 = buildReleaseFreezeSentinel({ pricing_enabled: true });
  assert.ok(s2.critical_failures.includes('pricing_frozen'), 'expected pricing_frozen');
});

// T9: regression_lockdown.passed=false → regression_lockdown_passed check fails
test('T9: regression_lockdown.passed=false → regression_lockdown_passed check fails', () => {
  const sentinel = buildReleaseFreezeSentinel({ regression_lockdown: { passed: false } });
  assert.ok(sentinel.critical_failures.includes('regression_lockdown_passed'), 'expected regression_lockdown_passed');
});

// T10: redaction_regression_lock.passed=false → redaction_regression_lock_passed check fails
test('T10: redaction_regression_lock.passed=false → redaction_regression_lock_passed check fails', () => {
  const sentinel = buildReleaseFreezeSentinel({ redaction_regression_lock: { passed: false } });
  assert.ok(sentinel.critical_failures.includes('redaction_regression_lock_passed'), 'expected redaction_regression_lock_passed');
});

// T11: enforcement summary — release_allowed=false, safe_to_sell=false always
test('T11: freeze_enforcement_summary always has release_allowed=false, safe_to_sell=false', () => {
  const summary = buildFreezeEnforcementSummary({ release_allowed: true, safe_to_sell: true });
  assert.strictEqual(summary.release_allowed, false);
  assert.strictEqual(summary.safe_to_sell,    false);
});

// T12: evaluateReleaseFreezeSentinel({}) serializes without throwing
test('T12: evaluateReleaseFreezeSentinel({}) does not throw on JSON.stringify', () => {
  assert.doesNotThrow(() => JSON.stringify(evaluateReleaseFreezeSentinel({})));
});
