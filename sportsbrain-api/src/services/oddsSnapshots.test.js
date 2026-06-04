/**
 * oddsSnapshots.test.js
 * =============================================================================
 * Unit tests for oddsSnapshots.js using Node's built-in assert module.
 * Run with: node src/services/oddsSnapshots.test.js
 * =============================================================================
 */

import assert from 'assert';
import {
  makeOddsSnapshotId,
  buildOddsSnapshot,
  computeOddsMovement,
  computeLineMovement,
  computeCLV,
  computeOddsFreshness,
  ingestOddsSnapshots,
  loadOddsSnapshotsBulk,
} from './oddsSnapshots.js';

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. makeOddsSnapshotId
// ---------------------------------------------------------------------------
console.log('\nmakeOddsSnapshotId');

test('contains fixture anchor in output', () => {
  const id = makeOddsSnapshotId({
    fixture_id: 'FIX-123', bookmaker: 'bet365', market: 'match_winner',
    selection: 'home', odd: 2.10, captured_at: '2026-05-12T10:30:00Z',
  });
  assert.ok(id.includes('FIX-123'), `Expected "FIX-123" in: ${id}`);
});

test('same odd + same minute → same ID (dedup)', () => {
  const params = {
    fixture_id: 'FIX-001', bookmaker: 'bet365', market: 'match_winner',
    selection: 'home', odd: 2.10, captured_at: '2026-05-12T10:30:00Z',
  };
  const id1 = makeOddsSnapshotId({ ...params });
  const id2 = makeOddsSnapshotId({ ...params });
  assert.strictEqual(id1, id2, 'Identical params must produce identical ID');
});

test('different odd → different ID', () => {
  const base = {
    fixture_id: 'FIX-001', bookmaker: 'bet365', market: 'match_winner',
    selection: 'home', captured_at: '2026-05-12T10:30:00Z',
  };
  const id1 = makeOddsSnapshotId({ ...base, odd: 2.10 });
  const id2 = makeOddsSnapshotId({ ...base, odd: 2.20 });
  assert.notStrictEqual(id1, id2, 'Different odd must produce different ID');
});

test('different minute → different ID', () => {
  const base = {
    fixture_id: 'FIX-001', bookmaker: 'bet365', market: 'match_winner',
    selection: 'home', odd: 2.10,
  };
  const id1 = makeOddsSnapshotId({ ...base, captured_at: '2026-05-12T10:30:00Z' });
  const id2 = makeOddsSnapshotId({ ...base, captured_at: '2026-05-12T10:31:00Z' });
  assert.notStrictEqual(id1, id2, 'Different minute must produce different ID');
});

test('prefers fixture_id over bet365_event_id', () => {
  const idWithFixture = makeOddsSnapshotId({
    fixture_id: 'FIX-999', bet365_event_id: 'B365-999', bookmaker: 'bet365',
    market: 'match_winner', selection: 'home', odd: 2.10, captured_at: '2026-05-12T10:30:00Z',
  });
  const idB365Only = makeOddsSnapshotId({
    bet365_event_id: 'B365-999', bookmaker: 'bet365',
    market: 'match_winner', selection: 'home', odd: 2.10, captured_at: '2026-05-12T10:30:00Z',
  });
  assert.ok(idWithFixture.startsWith('FIX-999'), `Expected ID to start with FIX-999, got: ${idWithFixture}`);
  assert.notStrictEqual(idWithFixture, idB365Only, 'fixture_id and bet365_event_id only must differ');
});

test('max length ≤ 250', () => {
  const id = makeOddsSnapshotId({
    fixture_id: 'F'.repeat(100), bookmaker: 'bet365',
    market: 'M'.repeat(100), selection: 'S'.repeat(100),
    odd: 2.10, captured_at: '2026-05-12T10:30:00Z',
  });
  assert.ok(id.length <= 250, `ID length ${id.length} exceeds 250`);
});

// ---------------------------------------------------------------------------
// 2. buildOddsSnapshot
// ---------------------------------------------------------------------------
console.log('\nbuildOddsSnapshot');

test('returns record with correct fields for bet365 pick', () => {
  const pick = {
    bet365_event_id: 12345,
    bet365: true,
    stat: 'match_winner',
    selection: 'home',
    odd: 2.10,
  };
  const rec = buildOddsSnapshot(pick, '2026-05-12T10:30:00Z');
  assert.ok(rec, 'Should return a record');
  assert.strictEqual(rec.bet365_event_id, '12345', 'bet365_event_id should be stringified');
  assert.strictEqual(rec.bookmaker, 'bet365');
  assert.ok(rec.normalized_market, 'normalized_market should be set');
  assert.ok(rec.implied_probability > 0, 'implied_probability should be > 0');
  assert.ok(rec.id, 'id should be set');
});

test('returns null for odd ≤ 1', () => {
  const pick = { fixture_id: 'FIX-1', stat: 'match_winner', odd: 1.0, bet365: true };
  assert.strictEqual(buildOddsSnapshot(pick), null);
});

test('returns null for odd exactly 1', () => {
  const pick = { fixture_id: 'FIX-1', stat: 'match_winner', odd: 1, bet365: true };
  assert.strictEqual(buildOddsSnapshot(pick), null);
});

test('returns null for no fixture anchor', () => {
  const pick = { stat: 'match_winner', odd: 2.10, bet365: true };
  assert.strictEqual(buildOddsSnapshot(pick), null);
});

test('returns null for null input', () => {
  assert.strictEqual(buildOddsSnapshot(null), null);
});

test('returns null when no market (no stat, no market field)', () => {
  const pick = { fixture_id: 'FIX-1', odd: 2.10, bet365: true };
  assert.strictEqual(buildOddsSnapshot(pick), null);
});

test('stringifies integer bet365_event_id', () => {
  const rec = buildOddsSnapshot({ bet365_event_id: 99999, stat: 'btts', odd: 1.80, bet365: true });
  assert.strictEqual(typeof rec.bet365_event_id, 'string');
  assert.strictEqual(rec.bet365_event_id, '99999');
});

test('match_id used as raw_ref', () => {
  const rec = buildOddsSnapshot({ fixture_id: 'FIX-1', match_id: 'MATCH-42', stat: 'btts', odd: 1.80, bet365: true });
  assert.strictEqual(rec.raw_ref, 'MATCH-42');
});

test('pinnacle pick → bookmaker="pinnacle", source_confidence="medium"', () => {
  const rec = buildOddsSnapshot({ fixture_id: 'FIX-1', pinnacle: true, stat: 'btts', odd: 1.80 });
  assert.strictEqual(rec.bookmaker, 'pinnacle');
  assert.strictEqual(rec.source_confidence, 'medium');
});

test('unknown bookmaker pick → bookmaker="unknown", source_confidence="low"', () => {
  const rec = buildOddsSnapshot({ fixture_id: 'FIX-1', stat: 'btts', odd: 1.80 });
  assert.strictEqual(rec.bookmaker, 'unknown');
  assert.strictEqual(rec.source_confidence, 'low');
});

test('implied_probability is 1/odd rounded to 6dp', () => {
  const rec = buildOddsSnapshot({ fixture_id: 'FIX-1', stat: 'match_winner', odd: 2.00, bet365: true });
  assert.strictEqual(rec.implied_probability, 0.5);
});

test('odd is stored at 4dp', () => {
  const rec = buildOddsSnapshot({ fixture_id: 'FIX-1', stat: 'match_winner', odd: 2.123456, bet365: true });
  assert.strictEqual(rec.odd, 2.1235);
});

// ---------------------------------------------------------------------------
// 3. computeOddsMovement
// ---------------------------------------------------------------------------
console.log('\ncomputeOddsMovement');

test('returns null for null input', () => {
  assert.strictEqual(computeOddsMovement(null), null);
});

test('returns null for empty array', () => {
  assert.strictEqual(computeOddsMovement([]), null);
});

test('returns null when no snapshots have odd', () => {
  assert.strictEqual(computeOddsMovement([{ captured_at: '2026-05-12T10:00:00Z' }]), null);
});

test('correct fields for rising odds (direction="up")', () => {
  const snapshots = [
    { odd: 2.00, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 2.10, captured_at: '2026-05-12T10:30:00Z' },
    { odd: 2.20, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeOddsMovement(snapshots);
  assert.ok(result, 'Should return a result');
  assert.strictEqual(result.direction, 'up');
  assert.strictEqual(result.opening_odd, 2.0);
  assert.strictEqual(result.latest_odd, 2.2);
  assert.ok(result.movement_pct > 0, 'movement_pct should be positive');
  assert.strictEqual(result.snapshots_count, 3);
});

test('direction="down" for falling odds', () => {
  const snapshots = [
    { odd: 2.20, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 2.10, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeOddsMovement(snapshots);
  assert.strictEqual(result.direction, 'down');
  assert.ok(result.movement_abs < 0, 'movement_abs should be negative');
});

test('direction="flat" for unchanged odds', () => {
  const snapshots = [
    { odd: 2.10, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 2.10, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeOddsMovement(snapshots);
  assert.strictEqual(result.direction, 'flat');
  assert.strictEqual(result.movement_abs, 0);
});

test('sorts by captured_at regardless of input order', () => {
  // Provide in reverse order — function must sort before computing opening/latest
  const snapshots = [
    { odd: 2.50, captured_at: '2026-05-12T12:00:00Z' },
    { odd: 2.00, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 2.30, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeOddsMovement(snapshots);
  assert.strictEqual(result.opening_odd, 2.0, 'Opening odd must be from earliest snapshot');
  assert.strictEqual(result.latest_odd, 2.5, 'Latest odd must be from most recent snapshot');
});

test('returns correct min_odd and max_odd', () => {
  const snapshots = [
    { odd: 2.00, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 1.80, captured_at: '2026-05-12T10:30:00Z' },
    { odd: 2.30, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeOddsMovement(snapshots);
  assert.strictEqual(result.min_odd, 1.8);
  assert.strictEqual(result.max_odd, 2.3);
});

test('first_seen_at and last_seen_at are set correctly', () => {
  const snapshots = [
    { odd: 2.00, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 2.20, captured_at: '2026-05-12T12:00:00Z' },
  ];
  const result = computeOddsMovement(snapshots);
  assert.strictEqual(result.first_seen_at, '2026-05-12T10:00:00Z');
  assert.strictEqual(result.last_seen_at, '2026-05-12T12:00:00Z');
});

// ---------------------------------------------------------------------------
// 4. computeLineMovement
// ---------------------------------------------------------------------------
console.log('\ncomputeLineMovement');

test('returns null for empty input', () => {
  assert.strictEqual(computeLineMovement([]), null);
});

test('returns null for null input', () => {
  assert.strictEqual(computeLineMovement(null), null);
});

test('returns null when <2 snapshots have line', () => {
  const snapshots = [{ line: 2.5, captured_at: '2026-05-12T10:00:00Z' }];
  assert.strictEqual(computeLineMovement(snapshots), null);
});

test('returns null when no snapshots have line', () => {
  const snapshots = [
    { odd: 2.10, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 2.20, captured_at: '2026-05-12T11:00:00Z' },
  ];
  assert.strictEqual(computeLineMovement(snapshots), null);
});

test('detects "up" when line rises', () => {
  const snapshots = [
    { line: 2.5, captured_at: '2026-05-12T10:00:00Z' },
    { line: 3.0, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeLineMovement(snapshots);
  assert.ok(result, 'Should return a result');
  assert.strictEqual(result.direction, 'up');
  assert.strictEqual(result.opening_line, 2.5);
  assert.strictEqual(result.latest_line, 3.0);
});

test('detects "flat" when line unchanged', () => {
  const snapshots = [
    { line: 2.5, captured_at: '2026-05-12T10:00:00Z' },
    { line: 2.5, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeLineMovement(snapshots);
  assert.strictEqual(result.direction, 'flat');
});

test('detects "down" when line falls', () => {
  const snapshots = [
    { line: 3.0, captured_at: '2026-05-12T10:00:00Z' },
    { line: 2.5, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeLineMovement(snapshots);
  assert.strictEqual(result.direction, 'down');
});

test('ignores snapshots without line when counting', () => {
  // 3 snapshots but only 2 have line
  const snapshots = [
    { line: 2.5, captured_at: '2026-05-12T10:00:00Z' },
    { odd: 2.10, captured_at: '2026-05-12T10:30:00Z' }, // no line
    { line: 3.0, captured_at: '2026-05-12T11:00:00Z' },
  ];
  const result = computeLineMovement(snapshots);
  assert.ok(result, 'Should return result when 2 snapshots have line');
  assert.strictEqual(result.snapshots_count, 2);
});

// ---------------------------------------------------------------------------
// 5. computeCLV
// ---------------------------------------------------------------------------
console.log('\ncomputeCLV');

test('returns null for null inputs', () => {
  assert.strictEqual(computeCLV(null, 2.00), null);
  assert.strictEqual(computeCLV(2.00, null), null);
  assert.strictEqual(computeCLV(null, null), null);
});

test('returns null for odd ≤ 1 (entryOdd)', () => {
  assert.strictEqual(computeCLV(1.0, 2.00), null);
  assert.strictEqual(computeCLV(0.9, 2.00), null);
});

test('returns null for odd ≤ 1 (closingOdd)', () => {
  assert.strictEqual(computeCLV(2.00, 1.0), null);
});

test('positive CLV when entry > closing (~10% for 2.20 vs 2.00)', () => {
  const clv = computeCLV(2.20, 2.00);
  assert.ok(clv > 0, `Expected positive CLV, got: ${clv}`);
  assert.ok(Math.abs(clv - 10) < 0.1, `Expected ~10%, got: ${clv}`);
});

test('negative CLV when entry < closing', () => {
  const clv = computeCLV(1.80, 2.00);
  assert.ok(clv < 0, `Expected negative CLV, got: ${clv}`);
});

test('zero CLV when identical odds', () => {
  const clv = computeCLV(2.00, 2.00);
  assert.strictEqual(clv, 0);
});

test('CLV is percentage (not decimal)', () => {
  const clv = computeCLV(2.10, 2.00);
  // (2.10 - 2.00) / 2.00 * 100 = 5.00
  assert.strictEqual(clv, 5.00);
});

// ---------------------------------------------------------------------------
// 6. computeOddsFreshness
// ---------------------------------------------------------------------------
console.log('\ncomputeOddsFreshness');

test('returns null for null input', () => {
  assert.strictEqual(computeOddsFreshness(null), null);
});

test('returns null for undefined input', () => {
  assert.strictEqual(computeOddsFreshness(undefined), null);
});

test('returns null for invalid date string', () => {
  assert.strictEqual(computeOddsFreshness('not-a-date'), null);
});

test('returns ~10 for 10-minutes-ago timestamp', () => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const result = computeOddsFreshness(tenMinutesAgo);
  assert.ok(result >= 9 && result <= 11, `Expected ~10, got: ${result}`);
});

test('returns 0 or 1 for just-now timestamp', () => {
  const justNow = new Date().toISOString();
  const result = computeOddsFreshness(justNow);
  assert.ok(result === 0 || result === 1, `Expected 0 or 1, got: ${result}`);
});

test('returns a number (not throws) for valid date', () => {
  const result = computeOddsFreshness('2020-01-01T00:00:00Z');
  assert.strictEqual(typeof result, 'number');
  assert.ok(result > 0, 'Timestamp from 2020 should yield positive minutes');
});

// ---------------------------------------------------------------------------
// 7. ingestOddsSnapshots — D1 guard checks (null env)
// ---------------------------------------------------------------------------
console.log('\ningestOddsSnapshots — guard checks');

test('null env returns {ingested:0, skipped_invalid:0, skipped_dedup:0}', async () => {
  const result = await ingestOddsSnapshots([{ id: 'snap-1', odd: 2.10 }], null);
  assert.strictEqual(result.ingested, 0);
  assert.strictEqual(result.skipped_invalid, 0);
  assert.strictEqual(result.skipped_dedup, 0);
});

test('empty records returns {ingested:0}', async () => {
  const fakeEnv = { SB_DB: {} };
  const result = await ingestOddsSnapshots([], fakeEnv);
  assert.strictEqual(result.ingested, 0);
});

test('null records returns {ingested:0}', async () => {
  const fakeEnv = { SB_DB: {} };
  const result = await ingestOddsSnapshots(null, fakeEnv);
  assert.strictEqual(result.ingested, 0);
});

test('returns skipped_no_table=false initially', async () => {
  const result = await ingestOddsSnapshots([], { SB_DB: {} });
  assert.strictEqual(result.skipped_no_table, false);
});

test('skipped_invalid counts null/undefined and records without id', async () => {
  const fakeEnv = { SB_DB: {
    batch: async () => [{ success: true, meta: { changes: 1 } }],
    prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
  const records = [null, undefined, { odd: 2.10 }, { id: 'snap-1', odd: 2.10 }];
  const result = await ingestOddsSnapshots(records, fakeEnv);
  assert.strictEqual(result.skipped_invalid, 3, `Expected 3 skipped_invalid, got ${result.skipped_invalid}`);
});

test('skipped_dedup counts duplicate IDs dropped', async () => {
  const fakeEnv = { SB_DB: {
    batch: async () => [{ success: true, meta: { changes: 1 } }, { success: true, meta: { changes: 1 } }],
    prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
  const records = [
    { id: 'snap-1', odd: 2.10 },
    { id: 'snap-1', odd: 2.20 }, // duplicate
    { id: 'snap-2', odd: 1.80 },
  ];
  const result = await ingestOddsSnapshots(records, fakeEnv);
  assert.strictEqual(result.skipped_dedup, 1, `Expected 1 skipped_dedup, got ${result.skipped_dedup}`);
});

test('error field is null on success', async () => {
  const result = await ingestOddsSnapshots([], { SB_DB: {} });
  assert.strictEqual(result.error, null);
});

// ---------------------------------------------------------------------------
// 8. loadOddsSnapshotsBulk — D1 guard checks (null env)
// ---------------------------------------------------------------------------
console.log('\nloadOddsSnapshotsBulk — guard checks');

test('null env returns Map of size 0', async () => {
  const result = await loadOddsSnapshotsBulk([{ bet365_event_id: '123' }], null);
  assert.strictEqual(result.byAnchorMarket.size, 0);
});

test('empty picks returns Map of size 0', async () => {
  const fakeEnv = { SB_DB: {} };
  const result = await loadOddsSnapshotsBulk([], fakeEnv);
  assert.strictEqual(result.byAnchorMarket.size, 0);
});

test('null picks returns Map of size 0', async () => {
  const fakeEnv = { SB_DB: {} };
  const result = await loadOddsSnapshotsBulk(null, fakeEnv);
  assert.strictEqual(result.byAnchorMarket.size, 0);
});

test('coverage object has expected keys', async () => {
  const result = await loadOddsSnapshotsBulk([], { SB_DB: {} });
  assert.ok('total_loaded' in result.coverage, 'missing total_loaded');
  assert.ok('fixtures_queried' in result.coverage, 'missing fixtures_queried');
  assert.ok('queries_used' in result.coverage, 'missing queries_used');
  assert.ok('table_missing' in result.coverage, 'missing table_missing');
  assert.ok('last_snapshot_at' in result.coverage, 'missing last_snapshot_at');
});

test('coverage.total_loaded is 0 and last_snapshot_at is null when no data', async () => {
  const result = await loadOddsSnapshotsBulk([], { SB_DB: {} });
  assert.strictEqual(result.coverage.total_loaded, 0);
  assert.strictEqual(result.coverage.last_snapshot_at, null);
});

test('coverage.fixtures_queried is a number', async () => {
  const result = await loadOddsSnapshotsBulk([], { SB_DB: {} });
  assert.strictEqual(typeof result.coverage.fixtures_queried, 'number');
});

// ---------------------------------------------------------------------------
// 9. Integration: buildOddsSnapshot → makeOddsSnapshotId consistency
// ---------------------------------------------------------------------------
console.log('\nIntegration checks');

test('two identical picks built at same captured_at produce same snapshot ID', () => {
  const capturedAt = '2026-05-12T10:30:00Z';
  const pick = { fixture_id: 'FIX-42', bet365_event_id: 'B365-42', bet365: true, stat: 'match_winner', selection: 'home', odd: 2.10 };
  const r1 = buildOddsSnapshot(pick, capturedAt);
  const r2 = buildOddsSnapshot(pick, capturedAt);
  assert.strictEqual(r1.id, r2.id);
});

test('two picks with different odds built at same captured_at produce different IDs', () => {
  const capturedAt = '2026-05-12T10:30:00Z';
  const base = { fixture_id: 'FIX-42', bet365: true, stat: 'match_winner', selection: 'home' };
  const r1 = buildOddsSnapshot({ ...base, odd: 2.10 }, capturedAt);
  const r2 = buildOddsSnapshot({ ...base, odd: 2.20 }, capturedAt);
  assert.notStrictEqual(r1.id, r2.id);
});

test('buildOddsSnapshot uses pick.market when pick.stat is absent', () => {
  const rec = buildOddsSnapshot({ fixture_id: 'FIX-1', market: 'btts', odd: 1.80, bet365: true });
  assert.ok(rec, 'Should build record from market field');
  assert.strictEqual(rec.market, 'btts');
});

test('buildOddsSnapshot uses pick.direction as selection when selection absent', () => {
  const rec = buildOddsSnapshot({ fixture_id: 'FIX-1', stat: 'match_winner', direction: 'away', odd: 3.50, bet365: true });
  assert.strictEqual(rec.selection, 'away');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
