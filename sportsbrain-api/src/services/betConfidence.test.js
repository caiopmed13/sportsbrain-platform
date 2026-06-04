/**
 * betConfidence.test.js
 * Run with: node src/services/betConfidence.test.js
 */
import assert from 'assert';
import {
  calcBetConfidenceScore,
  explainBetConfidenceScore,
  mapBetConfidenceTier,
  recommendStake,
} from './betConfidence.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// 1. mapBetConfidenceTier
// ---------------------------------------------------------------------------
console.log('\nmapBetConfidenceTier');

test('0  → no_bet',      () => assert.strictEqual(mapBetConfidenceTier(0),   'no_bet'));
test('39 → no_bet',      () => assert.strictEqual(mapBetConfidenceTier(39),  'no_bet'));
test('40 → lab_only',    () => assert.strictEqual(mapBetConfidenceTier(40),  'lab_only'));
test('59 → lab_only',    () => assert.strictEqual(mapBetConfidenceTier(59),  'lab_only'));
test('60 → micro_test',  () => assert.strictEqual(mapBetConfidenceTier(60),  'micro_test'));
test('74 → micro_test',  () => assert.strictEqual(mapBetConfidenceTier(74),  'micro_test'));
test('75 → valid_bet',   () => assert.strictEqual(mapBetConfidenceTier(75),  'valid_bet'));
test('84 → valid_bet',   () => assert.strictEqual(mapBetConfidenceTier(84),  'valid_bet'));
test('85 → premium_bet', () => assert.strictEqual(mapBetConfidenceTier(85),  'premium_bet'));
test('100 → premium_bet',() => assert.strictEqual(mapBetConfidenceTier(100), 'premium_bet'));

// ---------------------------------------------------------------------------
// 2. calcBetConfidenceScore
// ---------------------------------------------------------------------------
console.log('\ncalcBetConfidenceScore');

const perfectPick = {
  audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: true },
  market_available: true, availability_confidence: 'high',
  odds_snapshot_count: 3,
  odds_movement: { last_seen_at: new Date().toISOString(), latest_odd: 2.1, snapshots_count: 3 },
  clv_status: 'positive_clv',
  golden_score: 9, golden_support_score: 0.8,
  ev_pct: 6, prob: 0.58,
  resolvability: { can_resolve: true },
  odd: 2.10,
};

test('null input → score 0, tier no_bet', () => {
  const r = calcBetConfidenceScore(null);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.tier, 'no_bet');
});

test('perfect pick scores ≥ 85 (premium_bet)', () => {
  const r = calcBetConfidenceScore(perfectPick);
  assert.ok(r.score >= 85, `Expected ≥85, got ${r.score}`);
  assert.strictEqual(r.tier, 'premium_bet');
});

test('returns all 8 component keys', () => {
  const r = calcBetConfidenceScore(perfectPick);
  const keys = ['audit_component','market_component','odds_snapshot_component',
    'clv_component','historical_component','validation_component','bankroll_component','risk_penalty'];
  for (const k of keys) assert.ok(k in r.components, `Missing component: ${k}`);
});

test('blocked audit_status → audit_component = 0', () => {
  const r = calcBetConfidenceScore({
    ...perfectPick,
    audit_status: { pickAuditStatus: 'blocked', trust_level: 'blocked', can_post: false },
  });
  assert.strictEqual(r.components.audit_component, 0);
});

test('observation audit → audit_component = 5', () => {
  const r = calcBetConfidenceScore({
    ...perfectPick,
    audit_status: { pickAuditStatus: 'observation', trust_level: 'weak', can_post: false },
  });
  assert.strictEqual(r.components.audit_component, 5);
});

test('market_available false → market_component = 0', () => {
  const r = calcBetConfidenceScore({ ...perfectPick, market_available: false });
  assert.strictEqual(r.components.market_component, 0);
});

test('market_available null → market_component = 5 (fallback safe)', () => {
  const r = calcBetConfidenceScore({ ...perfectPick, market_available: null });
  assert.strictEqual(r.components.market_component, 5);
});

test('clv_status unknown → clv_component ≥ 0 (never negative)', () => {
  const r = calcBetConfidenceScore({ ...perfectPick, clv_status: 'unknown' });
  assert.ok(r.components.clv_component >= 0, `CLV unknown must not be negative, got ${r.components.clv_component}`);
});

test('clv_status negative_clv → clv_component = 0 (not minus)', () => {
  const r = calcBetConfidenceScore({ ...perfectPick, clv_status: 'negative_clv' });
  assert.strictEqual(r.components.clv_component, 0);
});

test('odd > 10 adds risk_penalty', () => {
  const r1 = calcBetConfidenceScore(perfectPick);
  const r2 = calcBetConfidenceScore({ ...perfectPick, odd: 12 });
  assert.ok(r2.score < r1.score, 'high odd should reduce score');
});

test('4-leg combo adds big risk_penalty', () => {
  const r = calcBetConfidenceScore({ ...perfectPick, legs_count: 4 });
  assert.ok(r.components.risk_penalty <= -12, `Expected penalty ≤ -12, got ${r.components.risk_penalty}`);
});

test('jackpot source adds risk_penalty', () => {
  const r1 = calcBetConfidenceScore(perfectPick);
  const r2 = calcBetConfidenceScore({ ...perfectPick, source_family: 'jackpot' });
  assert.ok(r2.score <= r1.score, 'jackpot source should not score higher');
});

test('score clamped 0..100', () => {
  const r = calcBetConfidenceScore(perfectPick);
  assert.ok(r.score >= 0 && r.score <= 100, `score ${r.score} out of range`);
});

test('score is a number rounded to 1dp', () => {
  const r = calcBetConfidenceScore(perfectPick);
  assert.strictEqual(typeof r.score, 'number');
  assert.ok(String(r.score).split('.')[1]?.length <= 1 ?? true);
});

// ---------------------------------------------------------------------------
// 3. recommendStake
// ---------------------------------------------------------------------------
console.log('\nrecommendStake');

test('no_bet → stake 0, blocked true', () => {
  const r = recommendStake('no_bet', {});
  assert.strictEqual(r.stake, 0);
  assert.strictEqual(r.blocked, true);
});

test('lab_only → stake 0, blocked true', () => {
  const r = recommendStake('lab_only', {});
  assert.strictEqual(r.stake, 0);
  assert.strictEqual(r.blocked, true);
});

test('micro_test → stake 0.50, blocked false', () => {
  const r = recommendStake('micro_test', {});
  assert.strictEqual(r.stake, 0.50);
  assert.strictEqual(r.blocked, false);
});

test('valid_bet → stake ≥ 0.50', () => {
  const r = recommendStake('valid_bet', {}, { default_bankroll: 100 });
  assert.ok(r.stake >= 0.50, `Expected ≥ 0.50, got ${r.stake}`);
});

test('premium_bet → stake ≥ 0.50', () => {
  const r = recommendStake('premium_bet', {}, { default_bankroll: 100 });
  assert.ok(r.stake >= 0.50);
});

test('jackpot source always caps at 0.50 regardless of tier', () => {
  const r = recommendStake('premium_bet', { source_family: 'jackpot' });
  assert.strictEqual(r.stake, 0.50);
  assert.strictEqual(r.reason, 'jackpot_mega_cap');
});

test('mega source always caps at 0.50', () => {
  const r = recommendStake('premium_bet', { source_family: 'mega' });
  assert.strictEqual(r.stake, 0.50);
});

test('stake never exceeds max_stake_pct * bankroll', () => {
  const r = recommendStake('premium_bet', {}, { default_bankroll: 1000, max_stake_pct: 0.01 });
  assert.ok(r.stake <= 10, `Stake ${r.stake} exceeds 1% of R$1000`);
});

test('reason field always present', () => {
  for (const tier of ['no_bet','lab_only','micro_test','valid_bet','premium_bet']) {
    const r = recommendStake(tier, {});
    assert.ok(r.reason, `Missing reason for tier ${tier}`);
  }
});

// ---------------------------------------------------------------------------
// 4. explainBetConfidenceScore (P3.8.5.2 / P3.8.5.9)
// ---------------------------------------------------------------------------
console.log('\nexplainBetConfidenceScore');

test('returns score, tier, components, input_flags, blockers, notes', () => {
  const r = explainBetConfidenceScore(perfectPick);
  assert.ok('score'       in r, 'missing score');
  assert.ok('tier'        in r, 'missing tier');
  assert.ok('components'  in r, 'missing components');
  assert.ok('input_flags' in r, 'missing input_flags');
  assert.ok('blockers'    in r, 'missing blockers');
  assert.ok('notes'       in r, 'missing notes');
});

test('null input → blockers includes null_item', () => {
  const r = explainBetConfidenceScore(null);
  assert.ok(r.blockers.includes('null_item'));
  assert.strictEqual(r.score, 0);
});

test('valid+verified+can_post=false+CLV unknown → score > 0', () => {
  const r = explainBetConfidenceScore({
    audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: false },
    clv_status: 'unknown',
    market_available: null,
    odd: 2.1,
  });
  assert.ok(r.score > 0, `Expected score > 0, got ${r.score}`);
  assert.ok(['no_bet','lab_only'].includes(r.tier), `Expected no_bet or lab_only, got ${r.tier}`);
});

test('missing CLV (undefined) does not zero entire score', () => {
  const r = explainBetConfidenceScore({
    audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: true },
    market_available: null,
    odd: 2.1,
    // clv_status: undefined
  });
  assert.ok(r.score > 0, `Expected score > 0 even with missing CLV, got ${r.score}`);
  assert.ok(r.blockers.includes('missing_clv'), 'Should flag missing_clv blocker');
});

test('missing validation history (golden_score=0) does not zero entire score', () => {
  const r = explainBetConfidenceScore({
    audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: true },
    market_available: null,
    clv_status: 'unknown',
    golden_score: 0, golden_support_score: 0,
    odd: 2.1,
  });
  assert.ok(r.score > 0, `Expected score > 0 with no history, got ${r.score}`);
  assert.ok(r.blockers.includes('validation_sample_missing'), 'Should flag validation_sample_missing');
});

test('market_available null → fallback safe, not zero blocker', () => {
  const r = explainBetConfidenceScore({ ...perfectPick, market_available: null });
  assert.ok(!r.blockers.includes('market_unavailable'), 'null market_available should not block');
  assert.ok(r.input_flags.market_available === null);
  assert.ok(r.components.market_component === 5, `Expected 5, got ${r.components.market_component}`);
});

test('explain score matches calcBetConfidenceScore for same input', () => {
  const calc = calcBetConfidenceScore(perfectPick);
  const expl = explainBetConfidenceScore(perfectPick);
  assert.strictEqual(expl.score, calc.score, 'explain score must match calc score');
  assert.strictEqual(expl.tier,  calc.tier,  'explain tier must match calc tier');
});

test('input_flags.has_odds_snapshot true when odds_snapshot_id present', () => {
  const r = explainBetConfidenceScore({ ...perfectPick, odds_snapshot_id: 'snap_001' });
  assert.ok(r.input_flags.has_odds_snapshot, 'Should detect odds_snapshot_id');
});

test('input_flags.has_odds_snapshot false when neither id nor count', () => {
  const r = explainBetConfidenceScore({ ...perfectPick, odds_snapshot_id: null, odds_snapshot_count: 0 });
  assert.ok(!r.input_flags.has_odds_snapshot);
  assert.ok(r.blockers.includes('missing_odds_snapshot'));
});

test('flat audit_status string accepted (DB row format)', () => {
  const r = explainBetConfidenceScore({ audit_status: 'valid', trust_level: 'verified', can_post: 1, odd: 2.0 });
  assert.strictEqual(r.input_flags.audit_status, 'valid');
  assert.ok(r.components.audit_component >= 15, `Expected ≥15 for valid+verified, got ${r.components.audit_component}`);
});

test('nested audit_status object accepted (premium pick format)', () => {
  const r = explainBetConfidenceScore({
    audit_status: { pickAuditStatus: 'valid', trust_level: 'supported', can_post: true },
    odd: 2.0,
  });
  assert.strictEqual(r.input_flags.audit_status, 'valid');
  assert.strictEqual(r.components.audit_component, 15);
});

test('risk_penalty_maxed blocker when penalty ≤ -10', () => {
  const r = explainBetConfidenceScore({ ...perfectPick, odd: 12, legs_count: 4 });
  assert.ok(r.blockers.includes('risk_penalty_maxed'), `Blockers: ${r.blockers}`);
});

test('blockers array is always an array', () => {
  const r = explainBetConfidenceScore({});
  assert.ok(Array.isArray(r.blockers));
  assert.ok(Array.isArray(r.notes));
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
