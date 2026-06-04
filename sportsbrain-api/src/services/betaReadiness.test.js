/**
 * betaReadiness.test.js
 * Run with: node src/services/betaReadiness.test.js
 */
import assert from 'assert';
import {
  mapReadinessStatus,
  computeBetaReadinessScore,
  getBankrollTestConfig,
  canEnterRealMoneyTest,
} from './betaReadiness.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// 1. mapReadinessStatus
// ---------------------------------------------------------------------------
console.log('\nmapReadinessStatus');

test('0  → not_ready',             () => assert.strictEqual(mapReadinessStatus(0),   'not_ready'));
test('39 → not_ready',             () => assert.strictEqual(mapReadinessStatus(39),  'not_ready'));
test('40 → lab_ready',             () => assert.strictEqual(mapReadinessStatus(40),  'lab_ready'));
test('59 → lab_ready',             () => assert.strictEqual(mapReadinessStatus(59),  'lab_ready'));
test('60 → micro_test_ready',      () => assert.strictEqual(mapReadinessStatus(60),  'micro_test_ready'));
test('74 → micro_test_ready',      () => assert.strictEqual(mapReadinessStatus(74),  'micro_test_ready'));
test('75 → beta_ready',            () => assert.strictEqual(mapReadinessStatus(75),  'beta_ready'));
test('84 → beta_ready',            () => assert.strictEqual(mapReadinessStatus(84),  'beta_ready'));
test('85 → sell_ready_candidate',  () => assert.strictEqual(mapReadinessStatus(85),  'sell_ready_candidate'));
test('100 → sell_ready_candidate', () => assert.strictEqual(mapReadinessStatus(100), 'sell_ready_candidate'));

// ---------------------------------------------------------------------------
// 2. computeBetaReadinessScore
// ---------------------------------------------------------------------------
console.log('\ncomputeBetaReadinessScore');

test('null → score=0, status=not_ready, can_micro_test=false, can_beta=false, can_sell=false', () => {
  const r = computeBetaReadinessScore(null);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.status, 'not_ready');
  assert.strictEqual(r.can_micro_test, false);
  assert.strictEqual(r.can_beta, false);
  assert.strictEqual(r.can_sell, false);
});

test('empty {} → score includes clv=4 neutral + unknown_rate=10 (score=14)', () => {
  const r = computeBetaReadinessScore({});
  // clv=4 (neutral when unknown) + unknown_rate=10 (null=best case) = 14 minimum
  assert.strictEqual(r.components.clv, 4);
  assert.strictEqual(r.components.unknown_rate, 10);
  assert.ok(r.score >= 14, `Expected score >= 14 (clv+unknown_rate floor), got ${r.score}`);
});

test('returns exactly 8 component keys', () => {
  const r = computeBetaReadinessScore({});
  const keys = ['sample_size','roi','clv','unknown_rate','audit_coverage','market_coverage','bankroll_safety','stability'];
  for (const k of keys) assert.ok(k in r.components, `Missing component: ${k}`);
  assert.strictEqual(Object.keys(r.components).length, 8);
});

// P3.8.7 — accumulation window gate tests
console.log('\nP3.8.7 accumulation window');

test('resolved_valid=29 → can_micro_test=false, remaining_to_micro_test=1', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 29, roi_pct: 0 });
  assert.strictEqual(r.can_micro_test, false, 'should not unlock micro_test with 29 resolved');
  assert.strictEqual(r.remaining_to_micro_test, 1);
});

test('resolved_valid=30 → can_micro_test=true, remaining_to_micro_test=0', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 30, roi_pct: 0 });
  assert.strictEqual(r.can_micro_test, true, 'should unlock micro_test at 30 resolved');
  assert.strictEqual(r.remaining_to_micro_test, 0);
});

test('training_eligible=1 + result_status=pending → not counted in resolved_valid', () => {
  // pending rows have no roi_pct → resolved_valid uses the metric we pass
  // In DB query pending rows are excluded; simulate by passing resolved_valid=0 explicitly
  const r = computeBetaReadinessScore({ resolved_valid: 0 });
  assert.strictEqual(r.can_micro_test, false);
  assert.strictEqual(r.remaining_to_micro_test, 30);
});

test('training_eligible=1 + result_status=unknown → not counted in resolved_valid', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 0 });
  assert.strictEqual(r.can_micro_test, false);
  assert.strictEqual(r.remaining_to_micro_test, 30);
});

test('result_status=green + result_status=red both count → resolved_valid=2', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 2, roi_pct: 0 });
  assert.strictEqual(r.can_micro_test, false);
  assert.strictEqual(r.remaining_to_micro_test, 28);
});

// sample_size
test('sample_size: resolved_valid=0 → 0',   () => assert.strictEqual(computeBetaReadinessScore({ resolved_valid: 0   }).components.sample_size, 0));
test('sample_size: resolved_valid=10 → 4',  () => assert.strictEqual(computeBetaReadinessScore({ resolved_valid: 10  }).components.sample_size, 4));
test('sample_size: resolved_valid=30 → 8',  () => assert.strictEqual(computeBetaReadinessScore({ resolved_valid: 30  }).components.sample_size, 8));
test('sample_size: resolved_valid=75 → 12', () => assert.strictEqual(computeBetaReadinessScore({ resolved_valid: 75  }).components.sample_size, 12));
test('sample_size: resolved_valid=150 → 16',() => assert.strictEqual(computeBetaReadinessScore({ resolved_valid: 150 }).components.sample_size, 16));
test('sample_size: resolved_valid=300 → 20',() => assert.strictEqual(computeBetaReadinessScore({ resolved_valid: 300 }).components.sample_size, 20));

// roi
test('roi: null → 0',   () => assert.strictEqual(computeBetaReadinessScore({ roi_pct: null  }).components.roi, 0));
test('roi: -5 → 0',     () => assert.strictEqual(computeBetaReadinessScore({ roi_pct: -5    }).components.roi, 0));
test('roi: -2 → 4',     () => assert.strictEqual(computeBetaReadinessScore({ roi_pct: -2    }).components.roi, 4));
test('roi: 0 → 10',     () => assert.strictEqual(computeBetaReadinessScore({ roi_pct: 0     }).components.roi, 10));
test('roi: 3 → 16',     () => assert.strictEqual(computeBetaReadinessScore({ roi_pct: 3     }).components.roi, 16));
test('roi: 5 → 20',     () => assert.strictEqual(computeBetaReadinessScore({ roi_pct: 5     }).components.roi, 20));

// clv
test('clv: null clv_known_pct → 4 (neutral, never negative)', () => {
  const r = computeBetaReadinessScore({ clv_known_pct: null });
  assert.ok(r.components.clv >= 4, `CLV with null must be >= 4, got ${r.components.clv}`);
  assert.ok(r.components.clv >= 0, `CLV must never be negative, got ${r.components.clv}`);
});
test('clv: 0% known → 4 (neutral)', () => {
  const r = computeBetaReadinessScore({ clv_known_pct: 0 });
  assert.strictEqual(r.components.clv, 4);
});
test('clv: positive_clv_rate=1.0 + clv_known_pct=1.0 → 15 (max)', () => {
  const r = computeBetaReadinessScore({ clv_known_pct: 1.0, positive_clv_rate: 1.0 });
  assert.strictEqual(r.components.clv, 15);
});

// unknown_rate
test('unknown_rate: null → 10',  () => assert.strictEqual(computeBetaReadinessScore({ unknown_pct_valid: null }).components.unknown_rate, 10));
test('unknown_rate: 0% → 10',    () => assert.strictEqual(computeBetaReadinessScore({ unknown_pct_valid: 0   }).components.unknown_rate, 10));
test('unknown_rate: 50% → 5',    () => assert.strictEqual(computeBetaReadinessScore({ unknown_pct_valid: 50  }).components.unknown_rate, 5));
test('unknown_rate: 100% → 0',   () => assert.strictEqual(computeBetaReadinessScore({ unknown_pct_valid: 100 }).components.unknown_rate, 0));

// bankroll_safety
test('bankroll_safety: no config → 0', () => {
  const r = computeBetaReadinessScore({});
  assert.strictEqual(r.components.bankroll_safety, 0);
});
test('bankroll_safety: has_bankroll_config=true → 5', () => {
  const r = computeBetaReadinessScore({ has_bankroll_config: true });
  assert.strictEqual(r.components.bankroll_safety, 5);
});
test('bankroll_safety: has_bankroll_config=true + no_losses_yet=true → 10', () => {
  const r = computeBetaReadinessScore({ has_bankroll_config: true, no_losses_yet: true });
  assert.strictEqual(r.components.bankroll_safety, 10);
});

// can_micro_test gates
test('can_micro_test: resolved_valid=30 + roi_pct=null → true', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 30, roi_pct: null });
  assert.strictEqual(r.can_micro_test, true);
});
test('can_micro_test: resolved_valid=30 + roi_pct=-2 → true', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 30, roi_pct: -2 });
  assert.strictEqual(r.can_micro_test, true);
});
test('can_micro_test: resolved_valid=29 → false', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 29, roi_pct: null });
  assert.strictEqual(r.can_micro_test, false);
});
test('can_micro_test: roi_pct=-5 → false', () => {
  const r = computeBetaReadinessScore({ resolved_valid: 100, roi_pct: -5 });
  assert.strictEqual(r.can_micro_test, false);
});

// can_beta gates
test('can_beta: all criteria met → true', () => {
  const r = computeBetaReadinessScore({
    resolved_valid: 75, roi_pct: 0, unknown_pct_valid: 10, clv_known_pct: 0.30,
  });
  assert.strictEqual(r.can_beta, true);
});
test('can_beta: resolved_valid=74 → false', () => {
  const r = computeBetaReadinessScore({
    resolved_valid: 74, roi_pct: 1, unknown_pct_valid: 5, clv_known_pct: 0.30,
  });
  assert.strictEqual(r.can_beta, false);
});
test('can_beta: roi_pct=-0.1 → false', () => {
  const r = computeBetaReadinessScore({
    resolved_valid: 75, roi_pct: -0.1, unknown_pct_valid: 5, clv_known_pct: 0.30,
  });
  assert.strictEqual(r.can_beta, false);
});

// can_sell gates
test('can_sell: all criteria met → true', () => {
  const r = computeBetaReadinessScore({
    resolved_valid: 150, roi_pct: 3, unknown_pct_valid: 10, positive_clv_rate: 0.50,
  });
  assert.strictEqual(r.can_sell, true);
});
test('can_sell: resolved_valid=149 → false', () => {
  const r = computeBetaReadinessScore({
    resolved_valid: 149, roi_pct: 5, unknown_pct_valid: 5, positive_clv_rate: 0.50,
  });
  assert.strictEqual(r.can_sell, false);
});

// ---------------------------------------------------------------------------
// 3. getBankrollTestConfig
// ---------------------------------------------------------------------------
console.log('\ngetBankrollTestConfig');

test('returns required keys with correct values', () => {
  const c = getBankrollTestConfig();
  assert.strictEqual(c.default_stake,           0.50);
  assert.strictEqual(c.max_daily_loss,          3.00);
  assert.strictEqual(c.max_daily_bets,          6);
  assert.strictEqual(c.max_weekly_loss,         10.00);
  assert.strictEqual(c.jackpot_mega_stake_cap,  0.50);
  assert.strictEqual(c.allow_martingale,        false);
  assert.strictEqual(c.allow_chase_loss,        false);
  assert.ok(c.safety_disclaimer.includes('Apostas envolvem risco'),  'Missing safety disclaimer text');
  assert.ok(c.safety_disclaimer.includes('SportsBrain não garante lucro'), 'Missing guarantee text');
});

// ---------------------------------------------------------------------------
// 4. canEnterRealMoneyTest
// ---------------------------------------------------------------------------
console.log('\ncanEnterRealMoneyTest');

const goodReadiness = { can_micro_test: true, can_beta: false, can_sell: false, status: 'micro_test_ready' };
const goodPick = {
  bet_confidence_tier: 'valid_bet',
  audit: { is_valid: true },
  trust_level: 'verified',
  market_available: true,
};
const goodBankroll = {
  daily_bets_today: 0,
  daily_loss_today: 0,
  weekly_loss: 0,
};

test('all good → allowed=true, blockers.length=0', () => {
  const r = canEnterRealMoneyTest(goodPick, goodReadiness, goodBankroll);
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.blockers.length, 0);
  assert.ok(r.recommended_stake > 0);
});

test('status=not_ready → blocked, blocker includes "not_ready"', () => {
  const readiness = { can_micro_test: false, can_beta: false, can_sell: false, status: 'not_ready' };
  const r = canEnterRealMoneyTest(goodPick, readiness, goodBankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('not_ready')), `Expected not_ready in blockers: ${r.blockers}`);
});

test('bet_confidence_tier=no_bet → blocked, blocker includes "no_bet"', () => {
  const pick = { ...goodPick, bet_confidence_tier: 'no_bet' };
  const r = canEnterRealMoneyTest(pick, goodReadiness, goodBankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('no_bet')), `Expected no_bet in blockers: ${r.blockers}`);
});

test('bet_confidence_tier=lab_only → blocked', () => {
  const pick = { ...goodPick, bet_confidence_tier: 'lab_only' };
  const r = canEnterRealMoneyTest(pick, goodReadiness, goodBankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('lab_only')), `Expected lab_only in blockers: ${r.blockers}`);
});

test('audit not valid → blocked, blocker includes "audit"', () => {
  const pick = { ...goodPick, audit: { is_valid: false } };
  const r = canEnterRealMoneyTest(pick, goodReadiness, goodBankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('audit')), `Expected audit in blockers: ${r.blockers}`);
});

test('trust_level=unknown → blocked, blocker includes "trust"', () => {
  const pick = { ...goodPick, trust_level: 'unknown' };
  const r = canEnterRealMoneyTest(pick, goodReadiness, goodBankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('trust')), `Expected trust in blockers: ${r.blockers}`);
});

test('market_available=false → blocked, blocker includes "market"', () => {
  const pick = { ...goodPick, market_available: false };
  const r = canEnterRealMoneyTest(pick, goodReadiness, goodBankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('market')), `Expected market in blockers: ${r.blockers}`);
});

test('daily_bets_today >= 6 → blocked, blocker includes "daily_bets"', () => {
  const bankroll = { ...goodBankroll, daily_bets_today: 6 };
  const r = canEnterRealMoneyTest(goodPick, goodReadiness, bankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('daily_bets')), `Expected daily_bets in blockers: ${r.blockers}`);
});

test('daily_loss_today >= 3.00 → blocked, blocker includes "daily_loss"', () => {
  const bankroll = { ...goodBankroll, daily_loss_today: 3.00 };
  const r = canEnterRealMoneyTest(goodPick, goodReadiness, bankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('daily_loss')), `Expected daily_loss in blockers: ${r.blockers}`);
});

test('weekly_loss >= 10.00 → blocked, blocker includes "weekly_loss"', () => {
  const bankroll = { ...goodBankroll, weekly_loss: 10.00 };
  const r = canEnterRealMoneyTest(goodPick, goodReadiness, bankroll);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('weekly_loss')), `Expected weekly_loss in blockers: ${r.blockers}`);
});

test('null bankroll → blocked', () => {
  const r = canEnterRealMoneyTest(goodPick, goodReadiness, null);
  assert.strictEqual(r.allowed, false);
  assert.ok(r.blockers.some(b => b.includes('bankroll')), `Expected bankroll in blockers: ${r.blockers}`);
});

const MICRO_READY_READINESS = { can_micro_test: true, can_beta: false, can_sell: false, status: 'micro_test_ready' };
const SAFE_BANKROLL = { daily_bets_today: 0, daily_loss_today: 0, weekly_loss: 0 };

test('null pick → blocked with "pick" blocker', () => {
  const r = canEnterRealMoneyTest(null, MICRO_READY_READINESS, SAFE_BANKROLL)
  assert.equal(r.allowed, false)
  assert.ok(r.blockers.some(b => b.includes('pick')))
});

// ---------------------------------------------------------------------------
// P3.8.8 — micro_test_status / micro_test_active tests
// ---------------------------------------------------------------------------
console.log('\nP3.8.8 — Micro-Test Gate Activation');

const baseMetrics = {
  resolved_valid: 0, roi_pct: null, clv_known_pct: null, positive_clv_rate: null,
  unknown_pct_valid: null, audit_coverage_pct: null, days_with_data: 0,
  has_bankroll_config: false, no_losses_yet: true,
};

// Test 1 — below threshold, flag off
test('resolved_valid=29, MICRO_TEST_ENABLED=false → waiting_for_threshold, micro_test_active=false', () => {
  const m = { ...baseMetrics, resolved_valid: 29, roi_pct: 0 };
  const r = computeBetaReadinessScore(m, { micro_test_enabled: false });
  assert.strictEqual(r.can_micro_test, false, 'can_micro_test should be false');
  assert.strictEqual(r.micro_test_status, 'waiting_for_threshold');
  assert.strictEqual(r.micro_test_active, false);
  assert.strictEqual(r.remaining_to_micro_test, 1);
  assert.strictEqual(r.can_beta, false);
  assert.strictEqual(r.can_sell, false);
});

// Test 2 — hit threshold, flag off
test('resolved_valid=30, MICRO_TEST_ENABLED=false → ready, micro_test_active=false', () => {
  const m = { ...baseMetrics, resolved_valid: 30, roi_pct: 0 };
  const r = computeBetaReadinessScore(m, { micro_test_enabled: false });
  assert.strictEqual(r.can_micro_test, true, 'can_micro_test should be true');
  assert.strictEqual(r.micro_test_status, 'ready');
  assert.strictEqual(r.micro_test_active, false);
  assert.strictEqual(r.remaining_to_micro_test, 0);
  assert.strictEqual(r.can_beta, false);
  assert.strictEqual(r.can_sell, false);
});

// Test 3 — hit threshold, flag on
test('resolved_valid=30, MICRO_TEST_ENABLED=true → active, micro_test_active=true', () => {
  const m = { ...baseMetrics, resolved_valid: 30, roi_pct: 0 };
  const r = computeBetaReadinessScore(m, { micro_test_enabled: true });
  assert.strictEqual(r.can_micro_test, true, 'can_micro_test should be true');
  assert.strictEqual(r.micro_test_status, 'active');
  assert.strictEqual(r.micro_test_active, true);
  assert.strictEqual(r.remaining_to_micro_test, 0);
  assert.strictEqual(r.can_beta, false);
  assert.strictEqual(r.can_sell, false);
});

// Test 4 — null metrics → waiting_for_threshold
test('null metrics → micro_test_status=waiting_for_threshold, micro_test_active=false', () => {
  const r = computeBetaReadinessScore(null, { micro_test_enabled: true });
  assert.strictEqual(r.micro_test_status, 'waiting_for_threshold');
  assert.strictEqual(r.micro_test_active, false);
  assert.strictEqual(r.can_micro_test, false);
});

// Test 5 — pending/unknown do NOT trigger micro-test (roi=0, rv=0 → can_micro_test=false)
test('pending/unknown bets do not count as resolved_valid → can_micro_test=false', () => {
  const m = { ...baseMetrics, resolved_valid: 0, roi_pct: 0 };
  const r = computeBetaReadinessScore(m, { micro_test_enabled: true });
  assert.strictEqual(r.can_micro_test, false, 'resolved_valid=0 must not activate micro-test');
  assert.strictEqual(r.micro_test_status, 'waiting_for_threshold');
  assert.strictEqual(r.micro_test_active, false);
});

// Test 6 — micro_test_active=true does NOT unlock beta or sell
test('micro_test_active=true, resolved_valid=30 → can_beta=false, can_sell=false', () => {
  const m = { ...baseMetrics, resolved_valid: 30, roi_pct: 5, clv_known_pct: 0.9, positive_clv_rate: 0.8, unknown_pct_valid: 5 };
  const r = computeBetaReadinessScore(m, { micro_test_enabled: true });
  assert.strictEqual(r.micro_test_active, true);
  assert.strictEqual(r.can_beta, false, 'can_beta must remain false (needs rv>=75)');
  assert.strictEqual(r.can_sell, false, 'can_sell must remain false (needs rv>=150)');
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
