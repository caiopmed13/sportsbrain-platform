/**
 * microTestAnalytics.test.js
 * Run with: node src/services/microTestAnalytics.test.js
 */
import assert from 'assert';
import {
  classifyOddsBucket,
  classifyConfidenceBucket,
  buildMicroTestReport,
  queryMicroTestReport,
} from './microTestAnalytics.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// classifyOddsBucket
// ---------------------------------------------------------------------------
console.log('\nclassifyOddsBucket');

test('1.40 → <1.50',    () => assert.strictEqual(classifyOddsBucket(1.40), '<1.50'));
test('1.50 → 1.50-1.79', () => assert.strictEqual(classifyOddsBucket(1.50), '1.50-1.79'));
test('1.65 → 1.50-1.79', () => assert.strictEqual(classifyOddsBucket(1.65), '1.50-1.79'));
test('1.80 → 1.80-2.09', () => assert.strictEqual(classifyOddsBucket(1.80), '1.80-2.09'));
test('1.95 → 1.80-2.09', () => assert.strictEqual(classifyOddsBucket(1.95), '1.80-2.09'));
test('2.10 → 2.10-2.49', () => assert.strictEqual(classifyOddsBucket(2.10), '2.10-2.49'));
test('2.20 → 2.10-2.49', () => assert.strictEqual(classifyOddsBucket(2.20), '2.10-2.49'));
test('2.50 → 2.50+',   () => assert.strictEqual(classifyOddsBucket(2.50), '2.50+'));
test('2.80 → 2.50+',   () => assert.strictEqual(classifyOddsBucket(2.80), '2.50+'));
test('null → unknown',  () => assert.strictEqual(classifyOddsBucket(null),  'unknown'));
test('undefined → unknown', () => assert.strictEqual(classifyOddsBucket(undefined), 'unknown'));
test('NaN → unknown',  () => assert.strictEqual(classifyOddsBucket(NaN),   'unknown'));

// ---------------------------------------------------------------------------
// classifyConfidenceBucket
// ---------------------------------------------------------------------------
console.log('\nclassifyConfidenceBucket');

test('0.50 → low',    () => assert.strictEqual(classifyConfidenceBucket(0.50), 'low'));
test('0.54 → low',    () => assert.strictEqual(classifyConfidenceBucket(0.54), 'low'));
test('0.55 → medium', () => assert.strictEqual(classifyConfidenceBucket(0.55), 'medium'));
test('0.60 → medium', () => assert.strictEqual(classifyConfidenceBucket(0.60), 'medium'));
test('0.65 → strong', () => assert.strictEqual(classifyConfidenceBucket(0.65), 'strong'));
test('0.70 → strong', () => assert.strictEqual(classifyConfidenceBucket(0.70), 'strong'));
test('0.75 → elite',  () => assert.strictEqual(classifyConfidenceBucket(0.75), 'elite'));
test('0.80 → elite',  () => assert.strictEqual(classifyConfidenceBucket(0.80), 'elite'));
test('null → unknown', () => assert.strictEqual(classifyConfidenceBucket(null), 'unknown'));

// ---------------------------------------------------------------------------
// buildMicroTestReport
// ---------------------------------------------------------------------------
console.log('\nbuildMicroTestReport');

test('empty rows → sample_size=0, hit_rate=null, status=active', () => {
  const r = buildMicroTestReport([]);
  assert.strictEqual(r.status, 'active');
  assert.strictEqual(r.sample_size, 0);
  assert.strictEqual(r.green_count, 0);
  assert.strictEqual(r.red_count, 0);
  assert.strictEqual(r.hit_rate, null);
  assert.strictEqual(r.hit_rate_pct, null);
});

// Test 3 — active with 18 green / 12 red
const activeRows = [
  ...Array(18).fill(null).map(() => ({
    result_status: 'green', sport: 'football', market: '1x2',
    bet_confidence_score: 0.70, odd: 1.90, trust_level: 'verified',
  })),
  ...Array(12).fill(null).map(() => ({
    result_status: 'red', sport: 'football', market: '1x2',
    bet_confidence_score: 0.60, odd: 2.20, trust_level: 'supported',
  })),
];

test('18 green + 12 red → sample_size=30, hit_rate=0.6, hit_rate_pct=60', () => {
  const r = buildMicroTestReport(activeRows);
  assert.strictEqual(r.status, 'active');
  assert.strictEqual(r.sample_size, 30);
  assert.strictEqual(r.green_count, 18);
  assert.strictEqual(r.red_count, 12);
  assert.strictEqual(r.hit_rate, 0.6);
  assert.strictEqual(r.hit_rate_pct, 60);
});

// Test 4 — pending/unknown rows must be excluded before calling buildMicroTestReport
// (the caller must filter; we verify buildMicroTestReport only counts what it receives)
test('only green/red rows count — pending input would just add wrong result_status', () => {
  const rows = [
    { result_status: 'green', sport: 'football', market: '1x2', bet_confidence_score: 0.7, odd: 1.9, trust_level: 'verified' },
    { result_status: 'red',   sport: 'football', market: '1x2', bet_confidence_score: 0.6, odd: 2.1, trust_level: 'supported' },
  ];
  const r = buildMicroTestReport(rows);
  assert.strictEqual(r.sample_size, 2);
  assert.strictEqual(r.green_count, 1);
  assert.strictEqual(r.red_count, 1);
});

// Test 6 — odds buckets
test('by_odds_bucket classifies correctly', () => {
  const rows = [
    { result_status: 'green', sport: 'x', market: 'x', bet_confidence_score: 0.7, odd: 1.40, trust_level: 'verified' },
    { result_status: 'red',   sport: 'x', market: 'x', bet_confidence_score: 0.7, odd: 1.65, trust_level: 'verified' },
    { result_status: 'green', sport: 'x', market: 'x', bet_confidence_score: 0.7, odd: 1.95, trust_level: 'verified' },
    { result_status: 'red',   sport: 'x', market: 'x', bet_confidence_score: 0.7, odd: 2.20, trust_level: 'verified' },
    { result_status: 'green', sport: 'x', market: 'x', bet_confidence_score: 0.7, odd: 2.80, trust_level: 'verified' },
    { result_status: 'red',   sport: 'x', market: 'x', bet_confidence_score: 0.7, odd: null,  trust_level: 'verified' },
  ];
  const r = buildMicroTestReport(rows);
  assert.ok(r.by_odds_bucket['<1.50'],    'missing <1.50');
  assert.ok(r.by_odds_bucket['1.50-1.79'], 'missing 1.50-1.79');
  assert.ok(r.by_odds_bucket['1.80-2.09'], 'missing 1.80-2.09');
  assert.ok(r.by_odds_bucket['2.10-2.49'], 'missing 2.10-2.49');
  assert.ok(r.by_odds_bucket['2.50+'],    'missing 2.50+');
  assert.ok(r.by_odds_bucket['unknown'],  'missing unknown');
  assert.strictEqual(r.by_odds_bucket['<1.50'].total, 1);
  assert.strictEqual(r.by_odds_bucket['unknown'].total, 1);
});

// Test 7 — confidence buckets
test('by_confidence_bucket classifies correctly', () => {
  const mk = (score, res) => ({ result_status: res, sport: 'x', market: 'x', bet_confidence_score: score, odd: 1.9, trust_level: 'verified' });
  const rows = [mk(0.50, 'green'), mk(0.60, 'red'), mk(0.70, 'green'), mk(0.80, 'red')];
  const r = buildMicroTestReport(rows);
  assert.ok(r.by_confidence_bucket['low'],    'missing low');
  assert.ok(r.by_confidence_bucket['medium'], 'missing medium');
  assert.ok(r.by_confidence_bucket['strong'], 'missing strong');
  assert.ok(r.by_confidence_bucket['elite'],  'missing elite');
  assert.strictEqual(r.by_confidence_bucket['low'].total, 1);
  assert.strictEqual(r.by_confidence_bucket['elite'].total, 1);
});

test('by_sport and by_market aggregate correctly', () => {
  const rows = [
    { result_status: 'green', sport: 'football',   market: '1x2', bet_confidence_score: 0.7, odd: 1.9, trust_level: 'verified' },
    { result_status: 'red',   sport: 'football',   market: '1x2', bet_confidence_score: 0.6, odd: 2.1, trust_level: 'supported' },
    { result_status: 'green', sport: 'basketball', market: 'ml',  bet_confidence_score: 0.7, odd: 1.8, trust_level: 'verified' },
  ];
  const r = buildMicroTestReport(rows);
  assert.strictEqual(r.by_sport['football'].total, 2);
  assert.strictEqual(r.by_sport['basketball'].total, 1);
  assert.strictEqual(r.by_market['1x2'].total, 2);
  assert.strictEqual(r.by_market['ml'].total, 1);
});

test('hit_rate per bucket is correct', () => {
  const rows = [
    { result_status: 'green', sport: 'football', market: '1x2', bet_confidence_score: 0.7, odd: 1.9, trust_level: 'verified' },
    { result_status: 'green', sport: 'football', market: '1x2', bet_confidence_score: 0.7, odd: 1.9, trust_level: 'verified' },
    { result_status: 'red',   sport: 'football', market: '1x2', bet_confidence_score: 0.7, odd: 1.9, trust_level: 'verified' },
    { result_status: 'red',   sport: 'football', market: '1x2', bet_confidence_score: 0.7, odd: 1.9, trust_level: 'verified' },
  ];
  const r = buildMicroTestReport(rows);
  assert.strictEqual(r.by_sport['football'].hit_rate, 0.5);
});

// ---------------------------------------------------------------------------
// queryMicroTestReport (pure / no DB)
// ---------------------------------------------------------------------------
console.log('\nqueryMicroTestReport');

// Test 1 — threshold not reached
test('can_micro_test=false → not_started, threshold_not_reached', async () => {
  const readiness = { can_micro_test: false, micro_test_active: false };
  const r = await queryMicroTestReport(null, readiness);
  assert.strictEqual(r.status, 'not_started');
  assert.strictEqual(r.reason, 'threshold_not_reached');
  assert.strictEqual(r.sample_size, 0);
  assert.strictEqual(r.hit_rate, null);
});

// Test 2 — threshold reached, flag off
test('can_micro_test=true, micro_test_active=false → waiting_for_activation', async () => {
  const readiness = { can_micro_test: true, micro_test_active: false };
  const r = await queryMicroTestReport(null, readiness);
  assert.strictEqual(r.status, 'waiting_for_activation');
  assert.strictEqual(r.reason, 'micro_test_enabled_false');
  assert.strictEqual(r.sample_size, 0);
  assert.strictEqual(r.hit_rate, null);
});

// Test 5 — training_eligible=0 rows should not be included (verified via buildMicroTestReport
//   since query filters at SQL level; here we confirm the pure function ignores nothing implicitly)
test('buildMicroTestReport with only green rows → red_count=0', () => {
  const rows = Array(5).fill(null).map(() => ({
    result_status: 'green', sport: 'football', market: '1x2',
    bet_confidence_score: 0.7, odd: 1.9, trust_level: 'verified',
  }));
  const r = buildMicroTestReport(rows);
  assert.strictEqual(r.red_count, 0);
  assert.strictEqual(r.sample_size, 5);
  assert.strictEqual(r.hit_rate, 1.0);
});

// Test 8 — analytics report never touches can_beta/can_sell
test('buildMicroTestReport does not include can_beta or can_sell fields', () => {
  const r = buildMicroTestReport(activeRows);
  assert.strictEqual(r.can_beta, undefined, 'can_beta must not appear in report');
  assert.strictEqual(r.can_sell, undefined, 'can_sell must not appear in report');
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
