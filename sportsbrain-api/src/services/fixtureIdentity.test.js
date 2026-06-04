/**
 * fixtureIdentity.test.js
 * =============================================================================
 * Unit tests for fixtureIdentity.js using Node's built-in assert module.
 * Run with: node src/services/fixtureIdentity.test.js
 * =============================================================================
 */

import assert from 'assert';
import {
  buildFixtureIdentity,
  makeFallbackFixtureKey,
  normalizeTeamForIdentity,
  attachFixtureIdentity,
  isHighConfidenceFixtureIdentity,
} from './fixtureIdentity.js';

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
// 1. buildFixtureIdentity — fixture_id path
// ---------------------------------------------------------------------------
console.log('\nbuildFixtureIdentity — fixture_id path');

test('fixture_id → confidence "high", source "fixture_id"', () => {
  const id = buildFixtureIdentity({ fixture_id: 'FIX-001' });
  assert.strictEqual(id.identity_source, 'fixture_id');
  assert.strictEqual(id.identity_confidence, 'high');
  assert.strictEqual(id.fixture_id, 'FIX-001');
  assert.strictEqual(id.bet365_event_id, null);
});

// ---------------------------------------------------------------------------
// 2. buildFixtureIdentity — bet365_event_id path
// ---------------------------------------------------------------------------
console.log('\nbuildFixtureIdentity — bet365_event_id path');

test('bet365_event_id → confidence "high", source "bet365_event_id"', () => {
  const id = buildFixtureIdentity({ bet365_event_id: 'B365-777' });
  assert.strictEqual(id.identity_source, 'bet365_event_id');
  assert.strictEqual(id.identity_confidence, 'high');
  assert.strictEqual(id.bet365_event_id, 'B365-777');
  assert.strictEqual(id.fixture_id, null);
});

// ---------------------------------------------------------------------------
// 3. buildFixtureIdentity — camelCase fixtureId alias
// ---------------------------------------------------------------------------
console.log('\nbuildFixtureIdentity — fixtureId camelCase alias');

test('fixtureId (camelCase) → treated as bet365_event_id, confidence "high"', () => {
  const id = buildFixtureIdentity({ fixtureId: '98765' });
  assert.strictEqual(id.identity_source, 'bet365_event_id');
  assert.strictEqual(id.identity_confidence, 'high');
  assert.strictEqual(id.bet365_event_id, '98765');
});

test('fixtureId is overridden by explicit bet365_event_id when both present', () => {
  const id = buildFixtureIdentity({ bet365_event_id: 'explicit', fixtureId: 'alias' });
  assert.strictEqual(id.bet365_event_id, 'explicit');
});

// ---------------------------------------------------------------------------
// 4. buildFixtureIdentity — fallback with kickoff
// ---------------------------------------------------------------------------
console.log('\nbuildFixtureIdentity — fallback with kickoff');

test('home + away + kickoff → confidence "medium", source "fallback"', () => {
  const id = buildFixtureIdentity({
    home_team: 'Flamengo',
    away_team: 'Atlético',
    kickoff:   '2026-05-12T20:00:00Z',
  });
  assert.strictEqual(id.identity_source, 'fallback');
  assert.strictEqual(id.identity_confidence, 'medium');
  assert.strictEqual(id.kickoff_date, '2026-05-12');
  assert.ok(id.fallback_key, 'fallback_key should be set');
});

test('numeric timestamp kickoff is handled', () => {
  const ts = new Date('2026-06-01T18:00:00Z').getTime();
  const id = buildFixtureIdentity({ home_team: 'A', away_team: 'B', kickoff: ts });
  assert.strictEqual(id.kickoff_date, '2026-06-01');
  assert.strictEqual(id.identity_confidence, 'medium');
});

// ---------------------------------------------------------------------------
// 5. buildFixtureIdentity — fallback without kickoff
// ---------------------------------------------------------------------------
console.log('\nbuildFixtureIdentity — fallback without kickoff');

test('home + away with no kickoff → confidence "low"', () => {
  const id = buildFixtureIdentity({ home_team: 'Team A', away_team: 'Team B' });
  assert.strictEqual(id.identity_source, 'fallback');
  assert.strictEqual(id.identity_confidence, 'low');
  assert.strictEqual(id.kickoff_date, null);
});

// ---------------------------------------------------------------------------
// 6. buildFixtureIdentity — empty/nothing
// ---------------------------------------------------------------------------
console.log('\nbuildFixtureIdentity — empty input');

test('empty object → confidence "none", source "none"', () => {
  const id = buildFixtureIdentity({});
  assert.strictEqual(id.identity_source, 'none');
  assert.strictEqual(id.identity_confidence, 'none');
  assert.strictEqual(id.fixture_id, null);
  assert.strictEqual(id.fallback_key, null);
});

test('null input → confidence "none"', () => {
  const id = buildFixtureIdentity(null);
  assert.strictEqual(id.identity_source, 'none');
  assert.strictEqual(id.identity_confidence, 'none');
});

// ---------------------------------------------------------------------------
// 7. makeFallbackFixtureKey — alphabetical sort on team pair
// ---------------------------------------------------------------------------
console.log('\nmakeFallbackFixtureKey — alphabetical sort');

test('team pair is alphabetically sorted (home > away alphabetically)', () => {
  const key = makeFallbackFixtureKey({
    home_team: 'Sporting',
    away_team: 'Benfica',
    kickoff:   '2026-05-12T20:00:00Z',
  });
  // After normalization: "sporting" → stripped "sporting" suffix → "" ... let's check actual
  // benfica < sporting => benfica first
  const parts = key.split('|');
  assert.ok(parts[0].length > 0, `Expected non-empty first team slot, got: "${parts[0]}"`);
  assert.ok(parts[1].length > 0, `Expected non-empty second team slot, got: "${parts[1]}"`);
  assert.ok(parts[0] <= parts[1], `Expected alphabetical order but got: ${parts[0]} > ${parts[1]}`);
  assert.strictEqual(parts[2], '2026-05-12');
});

test('makeFallbackFixtureKey is stable regardless of home/away order', () => {
  const k1 = makeFallbackFixtureKey({ home_team: 'Flamengo', away_team: 'Vasco', kickoff: '2026-05-12' });
  const k2 = makeFallbackFixtureKey({ home_team: 'Vasco', away_team: 'Flamengo', kickoff: '2026-05-12' });
  assert.strictEqual(k1, k2, 'Keys must be identical regardless of home/away order');
});

test('makeFallbackFixtureKey with no kickoff has empty date part', () => {
  const key = makeFallbackFixtureKey({ home_team: 'A', away_team: 'B' });
  assert.ok(key.endsWith('|'), 'Should end with pipe followed by empty date');
});

// ---------------------------------------------------------------------------
// 8. isHighConfidenceFixtureIdentity
// ---------------------------------------------------------------------------
console.log('\nisHighConfidenceFixtureIdentity');

test('returns true for "high" confidence', () => {
  assert.strictEqual(isHighConfidenceFixtureIdentity({ identity_confidence: 'high' }), true);
});

test('returns false for "medium" confidence', () => {
  assert.strictEqual(isHighConfidenceFixtureIdentity({ identity_confidence: 'medium' }), false);
});

test('returns false for "low" confidence', () => {
  assert.strictEqual(isHighConfidenceFixtureIdentity({ identity_confidence: 'low' }), false);
});

test('returns false for "none" confidence', () => {
  assert.strictEqual(isHighConfidenceFixtureIdentity({ identity_confidence: 'none' }), false);
});

test('returns false for null/undefined identity', () => {
  assert.strictEqual(isHighConfidenceFixtureIdentity(null), false);
  assert.strictEqual(isHighConfidenceFixtureIdentity(undefined), false);
});

// ---------------------------------------------------------------------------
// 9. attachFixtureIdentity
// ---------------------------------------------------------------------------
console.log('\nattachFixtureIdentity');

test('sets fixture_identity on target', () => {
  const target = {};
  attachFixtureIdentity(target, { bet365_event_id: 'B365-999' });
  assert.ok(target.fixture_identity, 'fixture_identity should be set');
  assert.strictEqual(target.fixture_identity.identity_source, 'bet365_event_id');
});

test('sets bet365_event_id on target when not already present', () => {
  const target = {};
  attachFixtureIdentity(target, { bet365_event_id: 'B365-42' });
  assert.strictEqual(target.bet365_event_id, 'B365-42');
});

test('does NOT overwrite bet365_event_id already on target', () => {
  const target = { bet365_event_id: 'EXISTING' };
  attachFixtureIdentity(target, { bet365_event_id: 'NEW' });
  assert.strictEqual(target.bet365_event_id, 'EXISTING');
});

test('sets fixture_id on target when not already present', () => {
  const target = {};
  attachFixtureIdentity(target, { fixture_id: 'FIX-77' });
  assert.strictEqual(target.fixture_id, 'FIX-77');
});

test('does NOT overwrite fixture_id already on target', () => {
  const target = { fixture_id: 'EXISTING-FIX' };
  attachFixtureIdentity(target, { fixture_id: 'NEW-FIX' });
  assert.strictEqual(target.fixture_id, 'EXISTING-FIX');
});

test('returns target', () => {
  const target = {};
  const result = attachFixtureIdentity(target, {});
  assert.strictEqual(result, target);
});

// ---------------------------------------------------------------------------
// 10. normalizeTeamForIdentity
// ---------------------------------------------------------------------------
console.log('\nnormalizeTeamForIdentity');

test('strips accents (é→e, ã→a)', () => {
  assert.strictEqual(normalizeTeamForIdentity('Atlético'), 'atletico');
  assert.strictEqual(normalizeTeamForIdentity('São Paulo'), 'sao paulo');
});

test('lowercases the result', () => {
  assert.strictEqual(normalizeTeamForIdentity('FLAMENGO'), 'flamengo');
});

test('removes FC suffix', () => {
  const result = normalizeTeamForIdentity('Manchester FC');
  assert.ok(!result.includes('fc'), `Expected no "fc" in "${result}"`);
});

test('removes Club suffix', () => {
  const result = normalizeTeamForIdentity('Chelsea Club');
  assert.ok(!result.includes('club'), `Expected no "club" in "${result}"`);
});

test('truncates to 25 chars', () => {
  const long = 'A'.repeat(50);
  assert.strictEqual(normalizeTeamForIdentity(long).length, 25);
});

test('returns empty string for null/undefined', () => {
  assert.strictEqual(normalizeTeamForIdentity(null), '');
  assert.strictEqual(normalizeTeamForIdentity(undefined), '');
  assert.strictEqual(normalizeTeamForIdentity(''), '');
});

test('does not erase name when the entire name is a stripped suffix', () => {
  assert.ok(normalizeTeamForIdentity('Sporting').length > 0, 'Sporting should not normalize to empty');
  assert.ok(normalizeTeamForIdentity('Club').length > 0, 'Club should not normalize to empty');
  assert.ok(normalizeTeamForIdentity('FC').length > 0, 'FC should not normalize to empty');
});

// ---------------------------------------------------------------------------
// Additional edge-case tests
// ---------------------------------------------------------------------------
console.log('\nEdge cases');

test('source_event_id path → confidence "medium"', () => {
  const id = buildFixtureIdentity({ source_event_id: 'SRC-999' });
  assert.strictEqual(id.identity_source, 'source_event_id');
  assert.strictEqual(id.identity_confidence, 'medium');
  assert.strictEqual(id.source_event_id, 'SRC-999');
});

test('fixture_id takes priority over bet365_event_id', () => {
  const id = buildFixtureIdentity({ fixture_id: 'FIX-1', bet365_event_id: 'B365-1' });
  assert.strictEqual(id.identity_source, 'fixture_id');
  // Both should be present in the output
  assert.strictEqual(id.fixture_id, 'FIX-1');
  assert.strictEqual(id.bet365_event_id, 'B365-1');
});

test('sport and league are passed through', () => {
  const id = buildFixtureIdentity({ fixture_id: 'F1', sport: 'football', league: 'Serie A' });
  assert.strictEqual(id.sport, 'football');
  assert.strictEqual(id.league, 'Serie A');
});

test('kickoff passed through as string', () => {
  const id = buildFixtureIdentity({ home_team: 'A', away_team: 'B', kickoff: '2026-05-12T20:00:00Z' });
  assert.strictEqual(id.kickoff, '2026-05-12T20:00:00Z');
});

test('normalized_home and normalized_away set when teams present', () => {
  const id = buildFixtureIdentity({ home_team: 'Fluminense FC', away_team: 'Cruzeiro' });
  assert.ok(id.normalized_home, 'normalized_home should be set');
  assert.ok(id.normalized_away, 'normalized_away should be set');
  assert.ok(!id.normalized_home.includes('fc'), 'normalized_home should not include "fc"');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
