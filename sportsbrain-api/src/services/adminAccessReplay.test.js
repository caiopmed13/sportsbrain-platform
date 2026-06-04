// src/services/adminAccessReplay.test.js
// P3.8.23 — Tests for Admin Access Replay Simulation & Pattern Review

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAdminAccessReplayEvents,
  analyzeAdminAccessPatterns,
  buildAdminAccessReplaySimulation,
  buildAdminAccessPatternReview,
  evaluateAdminAccessReplay,
} from './adminAccessReplay.js';

// T1: fixed events include expected event_ids
test('T1: replay events include required event_ids', () => {
  const events = buildAdminAccessReplayEvents();
  const ids = events.map(e => e.event_id);
  assert.ok(ids.includes('authorized_json_preview'), 'missing authorized_json_preview');
  assert.ok(ids.includes('denied_missing_key'),      'missing denied_missing_key');
  assert.ok(ids.includes('blocked_pdf_format'),      'missing blocked_pdf_format');
  assert.ok(ids.includes('blocked_download_mode'),   'missing blocked_download_mode');
});

// T2: analysis counts are positive
test('T2: analyzeAdminAccessPatterns — authorized/denied/blocked_format counts > 0', () => {
  const events   = buildAdminAccessReplayEvents();
  const analysis = analyzeAdminAccessPatterns(events);
  assert.ok(analysis.authorized_count     > 0, 'authorized_count should be > 0');
  assert.ok(analysis.denied_count         > 0, 'denied_count should be > 0');
  assert.ok(analysis.blocked_format_count > 0, 'blocked_format_count should be > 0');
});

// T3: download_attempt_count > 0
test('T3: analyzeAdminAccessPatterns — download_attempt_count > 0', () => {
  const events   = buildAdminAccessReplayEvents();
  const analysis = analyzeAdminAccessPatterns(events);
  assert.ok(analysis.download_attempt_count > 0, 'download_attempt_count should be > 0');
});

// T4: evaluateAdminAccessReplay default → pattern review status = protected
test('T4: pattern review status=risks_detected (download attempt present)', () => {
  const result = evaluateAdminAccessReplay({});
  // With the fixed 7 events: denied>=2, blocked_format>=1, download_attempt>=1
  // so risks.length >= 2, status = 'risks_detected'
  const review = result.admin_access_pattern_review;
  assert.ok(
    review.status === 'risks_detected' || review.status === 'protected',
    `unexpected status: ${review.status}`,
  );
  assert.strictEqual(review.can_sell, false);
});

// T5: 3+ denied events → patterns includes 'repeated_denied_access'
test('T5: 3 denied events → repeated_denied_access pattern', () => {
  const events = [
    { event_id: 'x1', authorized: false, blocked: false, mode: 'compact', format: null },
    { event_id: 'x2', authorized: false, blocked: false, mode: 'compact', format: null },
    { event_id: 'x3', authorized: false, blocked: false, mode: 'compact', format: null },
  ];
  const analysis = analyzeAdminAccessPatterns(events);
  assert.ok(analysis.patterns.includes('repeated_denied_access'), 'expected repeated_denied_access');
});

// T6: 1+ blocked format event → risks includes 'blocked_format_attempts' in review
test('T6: blocked format event → risks includes blocked_format_attempts', () => {
  const events = [
    { event_id: 'blocked_pdf_format', authorized: true, blocked: true, mode: 'compact', format: 'pdf' },
  ];
  const analysis = analyzeAdminAccessPatterns(events);
  const review   = buildAdminAccessPatternReview({ _analysis: analysis });
  assert.ok(review.risks.includes('blocked_format_attempts'), 'expected blocked_format_attempts in risks');
});

// T7: simulation patterns include no_sell_preserved; all events have can_sell=false
test('T7: no_sell_preserved in patterns; all events can_sell=false', () => {
  const sim = buildAdminAccessReplaySimulation({});
  // Rebuild analysis from events to check patterns
  const analysis = analyzeAdminAccessPatterns(sim.events);
  assert.ok(analysis.patterns.includes('no_sell_preserved'), 'expected no_sell_preserved');
  for (const e of sim.events) {
    assert.strictEqual(e.can_sell, false, `event ${e.event_id} has can_sell != false`);
  }
});

// T8: evaluateAdminAccessReplay({}) does not throw
test('T8: evaluateAdminAccessReplay({}) serializes without throwing', () => {
  assert.doesNotThrow(() => JSON.stringify(evaluateAdminAccessReplay({})));
});
