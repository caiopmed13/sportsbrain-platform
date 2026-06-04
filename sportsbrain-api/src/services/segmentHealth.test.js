/**
 * segmentHealth.test.js
 * Run with: node src/services/segmentHealth.test.js
 */
import assert from 'assert';
import {
  getSampleStatus,
  scoreSegmentHealth,
  gradeSegmentHealth,
  getDecisionHint,
  detectSegmentRisks,
  buildSegmentMatrix,
  buildExpansionCandidates,
  buildRiskSegments,
  buildControlledExpansionReview,
  buildBetaHoldReview,
  evaluateSegmentHealth,
  EXPANSION_POLICY_DEFAULTS,
} from './segmentHealth.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActiveReport({ sample_size = 30, green_count, hit_rate } = {}) {
  const g = green_count ?? Math.round(sample_size * 0.6);
  const r = sample_size - g;
  const hr = hit_rate ?? (sample_size > 0 ? g / sample_size : null);
  return {
    status: 'active',
    sample_size,
    green_count: g,
    red_count: r,
    hit_rate: hr,
    by_sport: { football: { green: g, red: r, total: sample_size, hit_rate: hr } },
    by_market: { '1x2': { green: g, red: r, total: sample_size, hit_rate: hr } },
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: { verified: { green: g, red: r, total: sample_size, hit_rate: hr } },
  };
}

function makeNotStartedReport() {
  return { status: 'not_started', sample_size: 0 };
}

function makeInertPolicy(decisionState = 'not_started') {
  return {
    decision_state: decisionState,
    quality_score: 0,
    quality_grade: 'not_available',
    sample_policy: { enough_for_decision: false },
    guardrails: { passed: false, blockers: [], warnings: [] },
    risks: [],
    summary: { safe_to_expand: false, safe_to_sell: false },
    can_beta: false,
    can_sell: false,
  };
}

function makeActivePolicy({ decisionState = 'active_collecting', passed = true, sampleEnough = true } = {}) {
  return {
    decision_state: decisionState,
    quality_score: 65,
    quality_grade: 'promising',
    sample_policy: { enough_for_decision: sampleEnough },
    guardrails: { passed, blockers: [], warnings: [] },
    risks: [],
    summary: { safe_to_expand: false, safe_to_sell: false, next_action: 'Continuar coletando.' },
    can_beta: false,
    can_sell: false,
  };
}

// ---------------------------------------------------------------------------
// getSampleStatus
// ---------------------------------------------------------------------------
console.log('\ngetSampleStatus');
test('0 → no_data',       () => assert.strictEqual(getSampleStatus(0), 'no_data'));
test('1 → tiny_sample',   () => assert.strictEqual(getSampleStatus(1), 'tiny_sample'));
test('4 → tiny_sample',   () => assert.strictEqual(getSampleStatus(4), 'tiny_sample'));
test('5 → weak_sample',   () => assert.strictEqual(getSampleStatus(5), 'weak_sample'));
test('9 → weak_sample',   () => assert.strictEqual(getSampleStatus(9), 'weak_sample'));
test('10 → watch_sample', () => assert.strictEqual(getSampleStatus(10), 'watch_sample'));
test('24 → watch_sample', () => assert.strictEqual(getSampleStatus(24), 'watch_sample'));
test('25 → useful_sample',() => assert.strictEqual(getSampleStatus(25), 'useful_sample'));
test('49 → useful_sample',() => assert.strictEqual(getSampleStatus(49), 'useful_sample'));
test('50 → strong_sample',() => assert.strictEqual(getSampleStatus(50), 'strong_sample'));
test('100→ strong_sample',() => assert.strictEqual(getSampleStatus(100), 'strong_sample'));

// ---------------------------------------------------------------------------
// scoreSegmentHealth & gradeSegmentHealth
// ---------------------------------------------------------------------------
console.log('\nscoreSegmentHealth / gradeSegmentHealth');

test('sample=0 → score 0, grade blocked', () => {
  const { score } = scoreSegmentHealth({ sample_size: 0, hit_rate: null });
  assert.ok(score === 0);
  assert.strictEqual(gradeSegmentHealth(score), 'blocked');
});

test('sample=3, hit_rate=1.0 → risk_penalty applied, score stays low', () => {
  const { score, components } = scoreSegmentHealth({ sample_size: 3, hit_rate: 1.0, red_count: 0 });
  assert.ok(components.risk_penalty < 0, 'expected negative risk_penalty');
  assert.ok(score < 20, `expected score < 20, got ${score}`);
});

test('sample=60, hit_rate=0.65 → expansion_candidate or strong_watch', () => {
  const { score } = scoreSegmentHealth({ sample_size: 60, hit_rate: 0.65 });
  const grade = gradeSegmentHealth(score);
  assert.ok(['expansion_candidate', 'strong_watch'].includes(grade), `unexpected grade: ${grade}`);
});

test('sample=30, hit_rate=0.40 → score penalized', () => {
  const { score, components } = scoreSegmentHealth({ sample_size: 30, hit_rate: 0.40 });
  assert.ok(components.hit_rate_score <= 5, 'low hit_rate should give low hit_rate_score');
  assert.ok(components.risk_penalty < 0, 'low hit_rate with useful sample should penalize');
});

test('trust_level dimension, verified key, hit_rate=0.60, sample=15 → trust_bonus > 0', () => {
  const { components } = scoreSegmentHealth({ sample_size: 15, hit_rate: 0.60, dimension: 'trust_level', segment: 'verified' });
  assert.ok(components.trust_bonus > 0, 'expected trust_bonus > 0 for verified + good hit_rate');
});

// ---------------------------------------------------------------------------
// gradeSegmentHealth boundaries
// ---------------------------------------------------------------------------
console.log('\ngradeSegmentHealth');
test('0 → blocked',              () => assert.strictEqual(gradeSegmentHealth(0),   'blocked'));
test('19 → blocked',             () => assert.strictEqual(gradeSegmentHealth(19),  'blocked'));
test('20 → weak',                () => assert.strictEqual(gradeSegmentHealth(20),  'weak'));
test('39 → weak',                () => assert.strictEqual(gradeSegmentHealth(39),  'weak'));
test('40 → watch',               () => assert.strictEqual(gradeSegmentHealth(40),  'watch'));
test('54 → watch',               () => assert.strictEqual(gradeSegmentHealth(54),  'watch'));
test('55 → promising',           () => assert.strictEqual(gradeSegmentHealth(55),  'promising'));
test('69 → promising',           () => assert.strictEqual(gradeSegmentHealth(69),  'promising'));
test('70 → strong_watch',        () => assert.strictEqual(gradeSegmentHealth(70),  'strong_watch'));
test('84 → strong_watch',        () => assert.strictEqual(gradeSegmentHealth(84),  'strong_watch'));
test('85 → expansion_candidate', () => assert.strictEqual(gradeSegmentHealth(85),  'expansion_candidate'));
test('100→ expansion_candidate', () => assert.strictEqual(gradeSegmentHealth(100), 'expansion_candidate'));

// ---------------------------------------------------------------------------
// getDecisionHint
// ---------------------------------------------------------------------------
console.log('\ngetDecisionHint');
test('no_data → no_data',                     () => assert.strictEqual(getDecisionHint('no_data', 'watch', 'low'), 'no_data'));
test('tiny_sample → ignore_for_now',          () => assert.strictEqual(getDecisionHint('tiny_sample', 'watch', 'low'), 'ignore_for_now'));
test('weak_sample → ignore_for_now',          () => assert.strictEqual(getDecisionHint('weak_sample', 'watch', 'low'), 'ignore_for_now'));
test('watch_sample + promising → watchlist',  () => assert.strictEqual(getDecisionHint('watch_sample', 'promising', 'low'), 'watchlist'));
test('watch_sample + weak → shadow_only',     () => assert.strictEqual(getDecisionHint('watch_sample', 'weak', 'low'), 'shadow_only'));
test('useful_sample + promising → candidate_hold', () => assert.strictEqual(getDecisionHint('useful_sample', 'promising', 'low'), 'candidate_hold'));
test('strong_sample + expansion_candidate → candidate_for_future_expansion', () => assert.strictEqual(getDecisionHint('strong_sample', 'expansion_candidate', 'low'), 'candidate_for_future_expansion'));
test('useful_sample + blocked → risk_review', () => assert.strictEqual(getDecisionHint('useful_sample', 'blocked', 'low'), 'risk_review'));
test('strong_sample + high_risk → risk_review', () => assert.strictEqual(getDecisionHint('strong_sample', 'promising', 'high'), 'risk_review'));

// ---------------------------------------------------------------------------
// detectSegmentRisks
// ---------------------------------------------------------------------------
console.log('\ndetectSegmentRisks');

// Teste 8 — tiny_sample_overperformance
test('tiny_sample=3, hit_rate=1.0 → tiny_sample_overperformance', () => {
  const risks = detectSegmentRisks('football', 'sport', { sample_size: 3, hit_rate: 1.0, green_count: 3, red_count: 0 });
  assert.ok(risks.some(r => r.code === 'tiny_sample_overperformance'), 'expected tiny_sample_overperformance risk');
});

test('tiny_sample=4, hit_rate=0.90 → tiny_sample_overperformance', () => {
  const risks = detectSegmentRisks('football', 'sport', { sample_size: 4, hit_rate: 0.90, green_count: 4, red_count: 0 });
  assert.ok(risks.some(r => r.code === 'tiny_sample_overperformance'));
});

test('tiny_sample=4, hit_rate=0.50 → no tiny_sample_overperformance', () => {
  const risks = detectSegmentRisks('football', 'sport', { sample_size: 4, hit_rate: 0.50, green_count: 2, red_count: 2 });
  assert.ok(!risks.some(r => r.code === 'tiny_sample_overperformance'));
});

// low_hit_rate
test('sample=10, hit_rate=0.40 → low_hit_rate risk', () => {
  const risks = detectSegmentRisks('football', 'sport', { sample_size: 10, hit_rate: 0.40, green_count: 4, red_count: 6 });
  assert.ok(risks.some(r => r.code === 'low_hit_rate'));
});

test('sample=10, hit_rate=0.50 → no low_hit_rate', () => {
  const risks = detectSegmentRisks('football', 'sport', { sample_size: 10, hit_rate: 0.50, green_count: 5, red_count: 5 });
  assert.ok(!risks.some(r => r.code === 'low_hit_rate'));
});

// zero_red_small_sample
test('sample=5, red_count=0 → zero_red_small_sample', () => {
  const risks = detectSegmentRisks('football', 'sport', { sample_size: 5, hit_rate: 1.0, green_count: 5, red_count: 0 });
  assert.ok(risks.some(r => r.code === 'zero_red_small_sample'));
});

// Teste 12 — unknown_trust_level
test('trust_level=unknown, sample=20 → unknown_trust_level', () => {
  const risks = detectSegmentRisks('unknown', 'trust_level', { sample_size: 20, hit_rate: 0.5, green_count: 10, red_count: 10 });
  assert.ok(risks.some(r => r.code === 'unknown_trust_level'));
});

test('trust_level=unknown, sample=5 → no unknown_trust_level (below threshold)', () => {
  const risks = detectSegmentRisks('unknown', 'trust_level', { sample_size: 5, hit_rate: 0.5, green_count: 3, red_count: 2 });
  assert.ok(!risks.some(r => r.code === 'unknown_trust_level'));
});

// Teste 13 — unknown_odds
test('odds_bucket=unknown, sample=20 → unknown_odds', () => {
  const risks = detectSegmentRisks('unknown', 'odds_bucket', { sample_size: 20, hit_rate: 0.5, green_count: 10, red_count: 10 });
  assert.ok(risks.some(r => r.code === 'unknown_odds'));
});

// Teste 14 — high_odds_volatility
test('odds=2.50+, hit_rate=0.40, sample=20 → high_odds_volatility', () => {
  const risks = detectSegmentRisks('2.50+', 'odds_bucket', { sample_size: 20, hit_rate: 0.40, green_count: 8, red_count: 12 });
  assert.ok(risks.some(r => r.code === 'high_odds_volatility'));
});

test('odds=2.50+, hit_rate=0.50, sample=20 → no high_odds_volatility', () => {
  const risks = detectSegmentRisks('2.50+', 'odds_bucket', { sample_size: 20, hit_rate: 0.50, green_count: 10, red_count: 10 });
  assert.ok(!risks.some(r => r.code === 'high_odds_volatility'));
});

// Teste 15 — low_odds_dependency
test('odds=<1.50, sample=50 → low_odds_dependency', () => {
  const risks = detectSegmentRisks('<1.50', 'odds_bucket', { sample_size: 50, hit_rate: 0.70, green_count: 35, red_count: 15 });
  assert.ok(risks.some(r => r.code === 'low_odds_dependency'));
  const r = risks.find(r => r.code === 'low_odds_dependency');
  assert.ok(['warning', 'info'].includes(r.severity));
});

// segment_underperformance
test('sample=30, hit_rate=0.38 → segment_underperformance (blocker)', () => {
  const risks = detectSegmentRisks('football', 'sport', { sample_size: 30, hit_rate: 0.38, green_count: 11, red_count: 19 });
  const r = risks.find(r => r.code === 'segment_underperformance');
  assert.ok(r, 'expected segment_underperformance');
  assert.strictEqual(r.severity, 'blocker');
});

// ---------------------------------------------------------------------------
// buildSegmentMatrix
// ---------------------------------------------------------------------------
console.log('\nbuildSegmentMatrix');

// Teste 1 — not_started → empty
test('not_started report → empty matrix', () => {
  const matrix = buildSegmentMatrix(makeNotStartedReport());
  assert.deepStrictEqual(matrix, {});
});

test('null report → empty matrix', () => {
  assert.deepStrictEqual(buildSegmentMatrix(null), {});
});

test('active report → matrix has sport and market dimensions', () => {
  const report = makeActiveReport({ sample_size: 30, hit_rate: 0.60 });
  const matrix = buildSegmentMatrix(report);
  assert.ok(matrix.sport, 'expected sport dimension');
  assert.ok(matrix.market, 'expected market dimension');
});

test('each segment entry has required fields', () => {
  const report = makeActiveReport({ sample_size: 30, hit_rate: 0.60 });
  const matrix = buildSegmentMatrix(report);
  const entry = matrix.sport?.[0];
  assert.ok(entry, 'expected at least one sport entry');
  assert.ok(typeof entry.sample_size === 'number');
  assert.ok(typeof entry.health_score === 'number');
  assert.ok(typeof entry.health_grade === 'string');
  assert.ok(typeof entry.decision_hint === 'string');
  assert.ok(Array.isArray(entry.risks));
});

// ---------------------------------------------------------------------------
// buildExpansionCandidates — Teste 16 (policy threshold)
// ---------------------------------------------------------------------------
console.log('\nbuildExpansionCandidates');

test('segment below minimum_candidate_sample → not a candidate', () => {
  const report = makeActiveReport({ sample_size: 20, hit_rate: 0.65 });
  const matrix = buildSegmentMatrix(report);
  const candidates = buildExpansionCandidates(matrix);
  assert.strictEqual(candidates.length, 0, 'sample below 25 should not be a candidate');
});

// Teste 10 — strong sample with strong hit rate
test('sample=60, hit_rate=0.63 → could be expansion candidate', () => {
  const report = {
    status: 'active',
    by_sport: { football: { green: 38, red: 22, total: 60, hit_rate: 0.633 } },
    by_market: {},
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: {},
  };
  const matrix = buildSegmentMatrix(report);
  const candidates = buildExpansionCandidates(matrix);
  // The segment might or might not qualify depending on health_score — verify can_expand stays false
  // The key invariant: if it enters candidates, can_expand is still never set
  assert.ok(candidates.every(c => c.health_score >= EXPANSION_POLICY_DEFAULTS.candidate_score_threshold ||
    c.hit_rate >= EXPANSION_POLICY_DEFAULTS.candidate_hit_rate_floor));
});

test('candidates never have can_expand=true', () => {
  const report = {
    status: 'active',
    by_sport: { football: { green: 40, red: 20, total: 60, hit_rate: 0.667 } },
    by_market: {},
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: {},
  };
  const matrix = buildSegmentMatrix(report);
  const candidates = buildExpansionCandidates(matrix);
  // Candidates list itself doesn't have can_expand — the expansion review does, verify it stays false
  const review = buildControlledExpansionReview(matrix, makeActivePolicy(), candidates, []);
  assert.strictEqual(review.can_expand, false);
  assert.strictEqual(review.can_beta, false);
  assert.strictEqual(review.can_sell, false);
});

// ---------------------------------------------------------------------------
// buildRiskSegments — Teste 17
// ---------------------------------------------------------------------------
console.log('\nbuildRiskSegments');

test('sample>=10, hit_rate<0.45 → enters risk_segments', () => {
  const report = {
    status: 'active',
    by_sport: { football: { green: 4, red: 16, total: 20, hit_rate: 0.20 } },
    by_market: {},
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: {},
  };
  const matrix = buildSegmentMatrix(report);
  const risks = buildRiskSegments(matrix);
  assert.ok(risks.length > 0, 'expected at least one risk segment');
});

test('sample=10, hit_rate=0.40 → risk segment', () => {
  const report = {
    status: 'active',
    by_sport: {},
    by_market: { '1x2': { green: 4, red: 6, total: 10, hit_rate: 0.40 } },
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: {},
  };
  const matrix = buildSegmentMatrix(report);
  const risks = buildRiskSegments(matrix);
  assert.ok(risks.length > 0);
});

// ---------------------------------------------------------------------------
// Teste 9 — useful sample, good hit rate
// ---------------------------------------------------------------------------
console.log('\nTest 9 — useful sample good hit rate');

test('sample=30, hit_rate=0.60 → grade promising or better, hint candidate_hold+', () => {
  const { score } = scoreSegmentHealth({ sample_size: 30, hit_rate: 0.60 });
  const grade = gradeSegmentHealth(score);
  assert.ok(['promising', 'strong_watch', 'expansion_candidate'].includes(grade), `unexpected grade: ${grade}`);
  const hint = getDecisionHint(getSampleStatus(30), grade, 'low');
  assert.ok(['candidate_hold', 'candidate_for_future_expansion'].includes(hint), `unexpected hint: ${hint}`);
});

// ---------------------------------------------------------------------------
// Teste 11 — useful sample, bad hit rate → risk
// ---------------------------------------------------------------------------
console.log('\nTest 11 — useful sample bad hit rate');

test('sample=30, hit_rate=0.40 → enters risk_segments', () => {
  const report = {
    status: 'active',
    by_sport: { football: { green: 12, red: 18, total: 30, hit_rate: 0.40 } },
    by_market: {},
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: {},
  };
  const matrix = buildSegmentMatrix(report);
  const risks = buildRiskSegments(matrix);
  assert.ok(risks.length > 0, 'expected football to be in risk_segments');
  const hint = matrix.sport?.[0]?.decision_hint;
  assert.ok(['risk_review', 'shadow_only'].includes(hint ?? 'risk_review'), `unexpected hint: ${hint}`);
});

// ---------------------------------------------------------------------------
// buildControlledExpansionReview
// ---------------------------------------------------------------------------
console.log('\nbuildControlledExpansionReview');

test('not_started policy → status not_started, can_expand=false', () => {
  const review = buildControlledExpansionReview({}, makeInertPolicy('not_started'), [], []);
  assert.strictEqual(review.status, 'not_started');
  assert.strictEqual(review.can_expand, false);
  assert.strictEqual(review.can_beta, false);
  assert.strictEqual(review.can_sell, false);
});

test('waiting_for_activation → status hold, can_expand=false', () => {
  const review = buildControlledExpansionReview({}, makeInertPolicy('waiting_for_activation'), [], []);
  assert.strictEqual(review.status, 'hold');
  assert.strictEqual(review.can_expand, false);
});

test('active policy with candidates and no risks → candidate_segments_found', () => {
  const fakeCandidate = { segment: 'football', dimension: 'sport', health_score: 80, health_grade: 'strong_watch', hit_rate: 0.65 };
  const review = buildControlledExpansionReview({}, makeActivePolicy({ decisionState: 'decision_ready_hold' }), [fakeCandidate], []);
  assert.strictEqual(review.status, 'candidate_segments_found');
  assert.strictEqual(review.can_expand, false);
  assert.strictEqual(review.candidate_segments_count, 1);
});

test('active policy with risk segments → risk_detected', () => {
  const fakeRisk = { segment: 'football', dimension: 'sport', health_score: 20, risk_level: 'high' };
  const review = buildControlledExpansionReview({}, makeActivePolicy({ decisionState: 'decision_ready_hold' }), [], [fakeRisk]);
  assert.strictEqual(review.status, 'risk_detected');
  assert.strictEqual(review.can_expand, false);
});

// ---------------------------------------------------------------------------
// buildBetaHoldReview — Testes 19-23
// ---------------------------------------------------------------------------
console.log('\nbuildBetaHoldReview');

// Teste 19 — micro-test not active
test('not_started policy → blocker micro_test_not_active, can_beta=false', () => {
  const result = buildBetaHoldReview(makeInertPolicy('not_started'), [], []);
  assert.strictEqual(result.status, 'hold');
  assert.strictEqual(result.can_beta, false);
  assert.ok(result.current_blockers.includes('micro_test_not_active'));
  assert.strictEqual(result.manual_approval_required, true);
});

// Teste 20 — active but sample below decision minimum
test('active policy, sample not enough → sample_below_decision_minimum', () => {
  const policy = makeActivePolicy({ sampleEnough: false });
  const result = buildBetaHoldReview(policy, [], []);
  assert.ok(result.current_blockers.includes('sample_below_decision_minimum'), JSON.stringify(result.current_blockers));
  assert.strictEqual(result.can_beta, false);
});

// Teste 21 — no candidate segments (when active)
test('active policy, no candidates → no_candidate_segments', () => {
  const policy = makeActivePolicy({ decisionState: 'active_collecting', sampleEnough: true });
  const result = buildBetaHoldReview(policy, [], []);
  assert.ok(result.current_blockers.includes('no_candidate_segments'), JSON.stringify(result.current_blockers));
});

// Teste 22 — high risk segments present
test('risk segments present → high_risk_segments_present', () => {
  const policy = makeActivePolicy();
  const fakeRisk = { segment: 'football', dimension: 'sport', health_score: 10, risk_level: 'high' };
  const result = buildBetaHoldReview(policy, [], [fakeRisk]);
  assert.ok(result.current_blockers.includes('high_risk_segments_present'), JSON.stringify(result.current_blockers));
  assert.strictEqual(result.can_beta, false);
});

// Teste 23 — everything good but still manual hold
test('good policy, candidates present, no risks → still can_beta=false, manual_approval_missing', () => {
  const policy = makeActivePolicy({ decisionState: 'decision_ready_hold', passed: true, sampleEnough: true });
  const fakeCandidate = { segment: 'football', dimension: 'sport', health_score: 85 };
  const result = buildBetaHoldReview(policy, [fakeCandidate], []);
  assert.strictEqual(result.can_beta, false);
  assert.strictEqual(result.manual_approval_required, true);
  assert.ok(result.current_blockers.includes('manual_approval_missing'), JSON.stringify(result.current_blockers));
});

// ---------------------------------------------------------------------------
// evaluateSegmentHealth (integration)
// ---------------------------------------------------------------------------
console.log('\nevaluateSegmentHealth — integration');

test('not_started report → safe empty output', () => {
  const out = evaluateSegmentHealth(makeNotStartedReport(), makeInertPolicy());
  assert.deepStrictEqual(out.segment_health_matrix, {});
  assert.deepStrictEqual(out.candidate_segments, []);
  assert.deepStrictEqual(out.risk_segments, []);
  assert.strictEqual(out.controlled_expansion_review.can_expand, false);
  assert.strictEqual(out.beta_hold_review.can_beta, false);
});

test('active report → matrix populated, all safety invariants hold', () => {
  const report = makeActiveReport({ sample_size: 60, hit_rate: 0.65 });
  const policy = makeActivePolicy();
  const out = evaluateSegmentHealth(report, policy);
  assert.ok(Object.keys(out.segment_health_matrix).length > 0);
  assert.strictEqual(out.controlled_expansion_review.can_expand, false);
  assert.strictEqual(out.controlled_expansion_review.can_beta, false);
  assert.strictEqual(out.controlled_expansion_review.can_sell, false);
  assert.strictEqual(out.beta_hold_review.can_beta, false);
  assert.strictEqual(out.beta_hold_review.status, 'hold');
  assert.strictEqual(out.beta_hold_review.manual_approval_required, true);
});

// Teste 18 — serializable
test('output is JSON serializable with nulls and missing buckets', () => {
  const report = {
    status: 'active',
    by_sport: { football: { green: 18, red: 12, total: 30, hit_rate: 0.6 } },
    by_market: {},
    by_confidence_bucket: {},
    by_odds_bucket: {},
    by_trust_level: {},
  };
  const out = evaluateSegmentHealth(report, makeActivePolicy());
  assert.doesNotThrow(() => JSON.stringify(out));
});

test('null report is JSON serializable', () => {
  const out = evaluateSegmentHealth(null, makeInertPolicy());
  assert.doesNotThrow(() => JSON.stringify(out));
});

// safety regression: can_beta/can_sell always false across scenarios
console.log('\nSafety regression — can_beta/can_sell always false');
const scenarios = [
  ['not_started', makeNotStartedReport(), makeInertPolicy('not_started')],
  ['waiting_for_activation', makeNotStartedReport(), makeInertPolicy('waiting_for_activation')],
  ['active_collecting small', makeActiveReport({ sample_size: 30 }), makeActivePolicy({ decisionState: 'active_collecting', sampleEnough: false })],
  ['active_collecting large', makeActiveReport({ sample_size: 60, hit_rate: 0.70 }), makeActivePolicy({ decisionState: 'active_collecting', sampleEnough: true })],
  ['decision_ready_hold', makeActiveReport({ sample_size: 100, hit_rate: 0.65 }), makeActivePolicy({ decisionState: 'decision_ready_hold', sampleEnough: true })],
];
for (const [label, report, policy] of scenarios) {
  test(`can_beta=false always (${label})`, () => {
    const out = evaluateSegmentHealth(report, policy);
    assert.strictEqual(out.beta_hold_review.can_beta, false);
    assert.strictEqual(out.controlled_expansion_review.can_beta, false);
    assert.strictEqual(out.controlled_expansion_review.can_sell, false);
    assert.strictEqual(out.controlled_expansion_review.can_expand, false);
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nSegment Health: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
