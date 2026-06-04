/**
 * microTestPolicy.test.js
 * Run with: node src/services/microTestPolicy.test.js
 */
import assert from 'assert';
import {
  mapQualityGrade,
  computeSamplePolicy,
  computeQualityScore,
  detectRisks,
  evaluateGuardrails,
  computeDecisionState,
  buildDecisionSummary,
  evaluateMicroTestPolicy,
  SAMPLE_POLICY_DEFAULTS,
} from './microTestPolicy.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// Helper: build a minimal active report
// ---------------------------------------------------------------------------
function makeReport({ sample_size = 30, green_count, hit_rate, by_sport, by_market, by_confidence_bucket, by_odds_bucket, by_trust_level, status = 'active' } = {}) {
  const g = green_count ?? Math.round(sample_size * 0.6);
  const r = sample_size - g;
  return {
    status,
    sample_size,
    green_count: g,
    red_count: r,
    hit_rate:     hit_rate   ?? (sample_size > 0 ? g / sample_size : null),
    hit_rate_pct: hit_rate   ?? (sample_size > 0 ? Math.round((g / sample_size) * 1000) / 10 : null),
    by_sport:             by_sport             ?? { football: { green: g, red: r, total: sample_size, hit_rate: g / sample_size } },
    by_market:            by_market            ?? { '1x2': { green: g, red: r, total: sample_size, hit_rate: g / sample_size } },
    by_confidence_bucket: by_confidence_bucket ?? {},
    by_odds_bucket:       by_odds_bucket       ?? {},
    by_trust_level:       by_trust_level       ?? { verified: { green: g, red: r, total: sample_size, hit_rate: g / sample_size } },
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// mapQualityGrade
// ---------------------------------------------------------------------------
console.log('\nmapQualityGrade');
test('0  → blocked',     () => assert.strictEqual(mapQualityGrade(0),   'blocked'));
test('19 → blocked',     () => assert.strictEqual(mapQualityGrade(19),  'blocked'));
test('20 → weak',        () => assert.strictEqual(mapQualityGrade(20),  'weak'));
test('39 → weak',        () => assert.strictEqual(mapQualityGrade(39),  'weak'));
test('40 → watch',       () => assert.strictEqual(mapQualityGrade(40),  'watch'));
test('59 → watch',       () => assert.strictEqual(mapQualityGrade(59),  'watch'));
test('60 → promising',   () => assert.strictEqual(mapQualityGrade(60),  'promising'));
test('74 → promising',   () => assert.strictEqual(mapQualityGrade(74),  'promising'));
test('75 → strong',      () => assert.strictEqual(mapQualityGrade(75),  'strong'));
test('89 → strong',      () => assert.strictEqual(mapQualityGrade(89),  'strong'));
test('90 → exceptional', () => assert.strictEqual(mapQualityGrade(90),  'exceptional'));
test('100 → exceptional',() => assert.strictEqual(mapQualityGrade(100), 'exceptional'));

// ---------------------------------------------------------------------------
// computeSamplePolicy
// ---------------------------------------------------------------------------
console.log('\ncomputeSamplePolicy');
test('sample_size=0 → not enough', () => {
  const p = computeSamplePolicy({ sample_size: 0 });
  assert.strictEqual(p.enough_for_micro_test, false);
  assert.strictEqual(p.enough_for_decision, false);
});
test('sample_size=30 → enough_for_micro_test=true, enough_for_decision=false', () => {
  const p = computeSamplePolicy({ sample_size: 30 });
  assert.strictEqual(p.enough_for_micro_test, true);
  assert.strictEqual(p.enough_for_decision, false);
});
test('sample_size=100 → enough_for_decision=true', () => {
  const p = computeSamplePolicy({ sample_size: 100 });
  assert.strictEqual(p.enough_for_decision, true);
});

// ---------------------------------------------------------------------------
// computeQualityScore
// ---------------------------------------------------------------------------
console.log('\ncomputeQualityScore');
test('status=not_started → score=0', () => {
  const { score } = computeQualityScore({ status: 'not_started', sample_size: 0 });
  assert.strictEqual(score, 0);
});
test('sample_size=30 → sample_size_score=10', () => {
  const { components } = computeQualityScore(makeReport({ sample_size: 30, hit_rate: 0.6 }));
  assert.strictEqual(components.sample_size_score, 10);
});
test('sample_size=100 → sample_size_score=15', () => {
  const { components } = computeQualityScore(makeReport({ sample_size: 100, hit_rate: 0.6 }));
  assert.strictEqual(components.sample_size_score, 15);
});
test('sample_size=250 → sample_size_score=20', () => {
  const { components } = computeQualityScore(makeReport({ sample_size: 250, hit_rate: 0.65 }));
  assert.strictEqual(components.sample_size_score, 20);
});
test('hit_rate=0.42 → hit_rate_score=5', () => {
  const { components } = computeQualityScore(makeReport({ hit_rate: 0.42 }));
  assert.strictEqual(components.hit_rate_score, 5);
});
test('hit_rate=0.60 → hit_rate_score=20', () => {
  const { components } = computeQualityScore(makeReport({ hit_rate: 0.60 }));
  assert.strictEqual(components.hit_rate_score, 20);
});
test('hit_rate=0.65 → hit_rate_score=25', () => {
  const { components } = computeQualityScore(makeReport({ hit_rate: 0.65 }));
  assert.strictEqual(components.hit_rate_score, 25);
});
test('elite>low → confidence_alignment_score=20', () => {
  const { components } = computeQualityScore(makeReport({
    by_confidence_bucket: {
      elite:  { green: 8, red: 2, total: 10, hit_rate: 0.80 },
      low:    { green: 4, red: 6, total: 10, hit_rate: 0.40 },
    },
  }));
  assert.strictEqual(components.confidence_alignment_score, 20);
});
test('elite(0.40)<low(0.65) by 0.25 → confidence_alignment_score=0', () => {
  const { components } = computeQualityScore(makeReport({
    by_confidence_bucket: {
      elite: { green: 4, red: 6,  total: 10, hit_rate: 0.40 },
      low:   { green: 7, red: 3,  total: 10, hit_rate: 0.70 },
    },
  }));
  assert.strictEqual(components.confidence_alignment_score, 0);
});

// ---------------------------------------------------------------------------
// Test 1 — not_started
// ---------------------------------------------------------------------------
console.log('\nTest 1 — not_started');
test('not_started → decision_state=not_started, quality_score=0, not_available, safe_to_*=false', () => {
  const report = { status: 'not_started', reason: 'threshold_not_reached', sample_size: 0, green_count: 0, red_count: 0, hit_rate: null };
  const policy = evaluateMicroTestPolicy(report);
  assert.strictEqual(policy.decision_state, 'not_started');
  assert.strictEqual(policy.quality_score, 0);
  assert.strictEqual(policy.quality_grade, 'not_available');
  assert.strictEqual(policy.summary.safe_to_expand, false);
  assert.strictEqual(policy.summary.safe_to_sell, false);
  assert.strictEqual(policy.can_beta, false);
  assert.strictEqual(policy.can_sell, false);
  assert.strictEqual(policy.sample_policy.enough_for_micro_test, false);
  assert.strictEqual(policy.sample_policy.enough_for_decision, false);
});

// ---------------------------------------------------------------------------
// Test 2 — waiting_for_activation
// ---------------------------------------------------------------------------
console.log('\nTest 2 — waiting_for_activation');
test('waiting_for_activation → decision_state=waiting_for_activation, decision blocked', () => {
  const report = { status: 'waiting_for_activation', reason: 'micro_test_enabled_false', sample_size: 0, hit_rate: null };
  const policy = evaluateMicroTestPolicy(report);
  assert.strictEqual(policy.decision_state, 'waiting_for_activation');
  assert.strictEqual(policy.can_beta, false);
  assert.strictEqual(policy.can_sell, false);
});

// ---------------------------------------------------------------------------
// Test 3 — active sample=30
// ---------------------------------------------------------------------------
console.log('\nTest 3 — active sample=30');
test('active, sample=30 → active_collecting, enough_for_micro_test=true, enough_for_decision=false', () => {
  const policy = evaluateMicroTestPolicy(makeReport({ sample_size: 30 }));
  assert.strictEqual(policy.decision_state, 'active_collecting');
  assert.strictEqual(policy.sample_policy.enough_for_micro_test, true);
  assert.strictEqual(policy.sample_policy.enough_for_decision, false);
  const minDecCheck = policy.guardrails.checks.find(c => c.name === 'minimum_decision_sample');
  assert.ok(minDecCheck, 'minimum_decision_sample check must exist');
  assert.strictEqual(minDecCheck.passed, false, 'minimum_decision_sample should fail with 30 samples');
});

// ---------------------------------------------------------------------------
// Test 4 — active sample=99
// ---------------------------------------------------------------------------
console.log('\nTest 4 — active sample=99');
test('active, sample=99 → enough_for_decision=false, active_collecting', () => {
  const policy = evaluateMicroTestPolicy(makeReport({ sample_size: 99 }));
  assert.strictEqual(policy.sample_policy.enough_for_decision, false);
  assert.strictEqual(policy.decision_state, 'active_collecting');
});

// ---------------------------------------------------------------------------
// Test 5 — active sample=100, hit_rate=0.42
// ---------------------------------------------------------------------------
console.log('\nTest 5 — active sample=100, hit_rate=0.42');
test('active, sample=100, hit_rate=0.42 → hit_rate_floor fails, low quality grade', () => {
  const policy = evaluateMicroTestPolicy(makeReport({ sample_size: 100, hit_rate: 0.42, green_count: 42 }));
  // decision_state is quality_watch or risk_detected — both signal problems
  assert.ok(
    ['risk_detected', 'quality_watch'].includes(policy.decision_state),
    `decision_state=${policy.decision_state} should indicate a problem`
  );
  const hrCheck = policy.guardrails.checks.find(c => c.name === 'hit_rate_floor');
  assert.ok(hrCheck, 'hit_rate_floor check must exist');
  assert.strictEqual(hrCheck.passed, false);
  // grade must not be 'promising', 'strong', or 'exceptional'
  assert.ok(['weak', 'blocked', 'watch'].includes(policy.quality_grade), `grade=${policy.quality_grade} should be weak/blocked/watch`);
});

test('active, sample=100, hit_rate=0.35 with bad data → risk_detected', () => {
  // Explicitly bad report: confidence inversion + low hit_rate
  const badReport = makeReport({
    sample_size: 100, hit_rate: 0.35, green_count: 35,
    by_confidence_bucket: {
      elite: { green: 3,  red: 7,  total: 10, hit_rate: 0.30 },
      low:   { green: 7,  red: 3,  total: 10, hit_rate: 0.70 },
    },
    by_odds_bucket: { '2.50+': { green: 35, red: 65, total: 100, hit_rate: 0.35 } },
    by_trust_level: { unknown: { green: 35, red: 65, total: 100, hit_rate: 0.35 } },
  });
  const policy = evaluateMicroTestPolicy(badReport);
  assert.strictEqual(policy.decision_state, 'risk_detected');
});

// ---------------------------------------------------------------------------
// Test 6 — active sample=100, hit_rate=0.60
// ---------------------------------------------------------------------------
console.log('\nTest 6 — active sample=100, hit_rate=0.60');
test('active, sample=100, hit_rate=0.60 → quality_score > 50, not not_started, can_beta=false', () => {
  const policy = evaluateMicroTestPolicy(makeReport({ sample_size: 100, hit_rate: 0.60, green_count: 60 }));
  assert.ok(policy.quality_score > 50, `quality_score=${policy.quality_score} should be > 50`);
  assert.notStrictEqual(policy.decision_state, 'not_started');
  assert.strictEqual(policy.can_beta, false);
  assert.strictEqual(policy.can_sell, false);
});

// ---------------------------------------------------------------------------
// Test 7 — large sample and high score NEVER unlocks beta/sell
// ---------------------------------------------------------------------------
console.log('\nTest 7 — sample=250, hit_rate=0.65 → beta/sell still blocked');
test('sample=250, hit_rate=0.65 → can_beta=false, can_sell=false, safe_to_*=false', () => {
  const policy = evaluateMicroTestPolicy(makeReport({ sample_size: 250, hit_rate: 0.65, green_count: 162 }));
  assert.strictEqual(policy.can_beta, false);
  assert.strictEqual(policy.can_sell, false);
  assert.strictEqual(policy.summary.safe_to_expand, false);
  assert.strictEqual(policy.summary.safe_to_sell, false);
});

// ---------------------------------------------------------------------------
// Test 8 — market concentration >80%
// ---------------------------------------------------------------------------
console.log('\nTest 8 — market concentration');
test('90% in one market → market_concentration risk + warning', () => {
  const report = makeReport({
    sample_size: 100,
    by_market: {
      '1x2': { green: 55, red: 35, total: 90, hit_rate: 0.61 },
      'btts': { green: 6,  red: 4,  total: 10, hit_rate: 0.60 },
    },
  });
  const policy = evaluateMicroTestPolicy(report);
  const riskCodes = policy.risks.map(r => r.code);
  assert.ok(riskCodes.includes('market_concentration'), `risks=${JSON.stringify(riskCodes)}`);
  assert.ok(policy.guardrails.warnings.includes('single_market_concentration'), `warnings=${JSON.stringify(policy.guardrails.warnings)}`);
});

// ---------------------------------------------------------------------------
// Test 9 — sport concentration >80%
// ---------------------------------------------------------------------------
console.log('\nTest 9 — sport concentration');
test('90% in one sport → sport_concentration risk + warning', () => {
  const report = makeReport({
    sample_size: 100,
    by_sport: {
      football:   { green: 55, red: 35, total: 90, hit_rate: 0.61 },
      basketball: { green: 6,  red: 4,  total: 10, hit_rate: 0.60 },
    },
  });
  const policy = evaluateMicroTestPolicy(report);
  const riskCodes = policy.risks.map(r => r.code);
  assert.ok(riskCodes.includes('sport_concentration'), `risks=${JSON.stringify(riskCodes)}`);
  assert.ok(policy.guardrails.warnings.includes('single_sport_concentration'), `warnings=${JSON.stringify(policy.guardrails.warnings)}`);
});

// ---------------------------------------------------------------------------
// Test 10 — elite(0.40) < low(0.65)
// ---------------------------------------------------------------------------
console.log('\nTest 10 — confidence inversion');
test('elite(0.40) < low(0.65) → confidence_inversion/elite_underperformance risk + penalized score', () => {
  const report = makeReport({
    by_confidence_bucket: {
      elite:  { green: 4, red: 6,  total: 10, hit_rate: 0.40 },
      strong: { green: 5, red: 5,  total: 10, hit_rate: 0.50 },
      medium: { green: 6, red: 4,  total: 10, hit_rate: 0.60 },
      low:    { green: 7, red: 3,  total: 10, hit_rate: 0.65 },
    },
  });
  const policy = evaluateMicroTestPolicy(report);
  const riskCodes = policy.risks.map(r => r.code);
  assert.ok(
    riskCodes.includes('confidence_inversion') || riskCodes.includes('elite_underperformance'),
    `Expected confidence_inversion or elite_underperformance in: ${JSON.stringify(riskCodes)}`
  );
  const { components } = computeQualityScore(report);
  assert.ok(components.confidence_alignment_score <= 5, `alignment_score=${components.confidence_alignment_score} should be penalized (<=5)`);
});

// ---------------------------------------------------------------------------
// Test 11 — 85% odds <1.50
// ---------------------------------------------------------------------------
console.log('\nTest 11 — low odds dependency');
test('85% in <1.50 odds → low_odds_dependency risk', () => {
  const report = makeReport({
    by_odds_bucket: {
      '<1.50':    { green: 50, red: 35, total: 85, hit_rate: 0.59 },
      '1.50-1.79': { green: 9,  red: 6,  total: 15, hit_rate: 0.60 },
    },
  });
  const policy = evaluateMicroTestPolicy(report);
  const riskCodes = policy.risks.map(r => r.code);
  assert.ok(riskCodes.includes('low_odds_dependency'), `risks=${JSON.stringify(riskCodes)}`);
});

// ---------------------------------------------------------------------------
// Test 12 — high odds volatility
// ---------------------------------------------------------------------------
console.log('\nTest 12 — high odds volatility');
test('70% in 2.50+ odds with hit_rate=0.30 → high_odds_volatility risk', () => {
  const report = makeReport({
    by_odds_bucket: {
      '2.50+':    { green: 21, red: 49, total: 70, hit_rate: 0.30 },
      '1.80-2.09': { green: 18, red: 12, total: 30, hit_rate: 0.60 },
    },
  });
  const policy = evaluateMicroTestPolicy(report);
  const riskCodes = policy.risks.map(r => r.code);
  assert.ok(riskCodes.includes('high_odds_volatility'), `risks=${JSON.stringify(riskCodes)}`);
});

// ---------------------------------------------------------------------------
// Test 13 — trust_level_gap
// ---------------------------------------------------------------------------
console.log('\nTest 13 — trust_level_gap');
test('by_trust_level empty → trust_level_gap risk', () => {
  const report = makeReport({ by_trust_level: {} });
  const policy = evaluateMicroTestPolicy(report);
  const riskCodes = policy.risks.map(r => r.code);
  assert.ok(riskCodes.includes('trust_level_gap'), `risks=${JSON.stringify(riskCodes)}`);
});

test('75% unknown trust → trust_level_gap risk', () => {
  const report = makeReport({
    by_trust_level: {
      unknown:  { green: 45, red: 30, total: 75, hit_rate: 0.60 },
      verified: { green: 15, red: 10, total: 25, hit_rate: 0.60 },
    },
  });
  const policy = evaluateMicroTestPolicy(report);
  const riskCodes = policy.risks.map(r => r.code);
  assert.ok(riskCodes.includes('trust_level_gap'), `risks=${JSON.stringify(riskCodes)}`);
});

// ---------------------------------------------------------------------------
// Test 14 — output always serializable
// ---------------------------------------------------------------------------
console.log('\nTest 14 — JSON serializable');
test('evaluateMicroTestPolicy(null) does not throw and is serializable', () => {
  const policy = evaluateMicroTestPolicy(null);
  assert.doesNotThrow(() => JSON.stringify(policy));
});

test('evaluateMicroTestPolicy(not_started report) is serializable', () => {
  const policy = evaluateMicroTestPolicy({ status: 'not_started', sample_size: 0, hit_rate: null });
  assert.doesNotThrow(() => JSON.stringify(policy));
});

test('evaluateMicroTestPolicy(active report with empty buckets) is serializable', () => {
  const policy = evaluateMicroTestPolicy(makeReport({ by_confidence_bucket: {}, by_odds_bucket: {} }));
  assert.doesNotThrow(() => JSON.stringify(policy));
});

// ---------------------------------------------------------------------------
// Regression: can_beta and can_sell are ALWAYS false
// ---------------------------------------------------------------------------
console.log('\nRegression — can_beta / can_sell never true');
test('evaluateMicroTestPolicy always returns can_beta=false', () => {
  for (const report of [
    null,
    { status: 'not_started', sample_size: 0, hit_rate: null },
    makeReport({ sample_size: 30 }),
    makeReport({ sample_size: 100, hit_rate: 0.65 }),
    makeReport({ sample_size: 250, hit_rate: 0.80 }),
  ]) {
    const policy = evaluateMicroTestPolicy(report);
    assert.strictEqual(policy.can_beta, false, `can_beta should always be false, got ${policy.can_beta} for sample=${report?.sample_size}`);
    assert.strictEqual(policy.can_sell, false, `can_sell should always be false, got ${policy.can_sell} for sample=${report?.sample_size}`);
  }
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
