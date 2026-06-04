import {
  evaluateRecommendationStabilityCheck,
  buildSyntheticPreviousRecommendation,
} from './recommendationStabilityCheck.js';

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Test 1 — empty stability
test('empty stability returns recommendations_evaluated === 0', () => {
  const result = evaluateRecommendationStabilityCheck({});
  assert(
    result.recommendation_stability_check.recommendations_evaluated === 0,
    `Expected 0, got ${result.recommendation_stability_check.recommendations_evaluated}`
  );
});

// Test 2 — synthetic previous generated
test('synthetic previous is generated (simulated_previous === true)', () => {
  const result = evaluateRecommendationStabilityCheck({
    segment_exclusion_recommendations: {
      recommendations: [
        { recommendation: 'watch', sample_size: 12, segment_type: 'market', segment_key: 'moneyline' },
      ],
    },
  });
  const seg = result.recommendation_stability_matrix.segments[0];
  assert(seg.simulated_previous === true, `Expected simulated_previous=true, got ${seg.simulated_previous}`);
});

// Test 3 — stable recommendation (candidate_keep, sample>=15)
test('candidate_keep with sample_size=20 is stable with change_direction=same', () => {
  const result = evaluateRecommendationStabilityCheck({
    segment_exclusion_recommendations: {
      recommendations: [
        { recommendation: 'candidate_keep', sample_size: 20, segment_type: 'market', segment_key: 'spread' },
      ],
    },
  });
  const seg = result.recommendation_stability_matrix.segments[0];
  assert(seg.stable === true, `Expected stable=true, got ${seg.stable}`);
  assert(seg.change_direction === 'same', `Expected change_direction=same, got ${seg.change_direction}`);
});

// Test 4 — changed worse (recommend_exclude, sample>=15 → previous=watch → worse)
test('recommend_exclude with sample_size=20 is unstable with change_direction=worse', () => {
  const result = evaluateRecommendationStabilityCheck({
    segment_exclusion_recommendations: {
      recommendations: [
        { recommendation: 'recommend_exclude', sample_size: 20, segment_type: 'market', segment_key: 'total' },
      ],
    },
  });
  const seg = result.recommendation_stability_matrix.segments[0];
  assert(seg.stable === false, `Expected stable=false, got ${seg.stable}`);
  assert(seg.change_direction === 'worse', `Expected change_direction=worse, got ${seg.change_direction}`);
});

// Test 5 — stability rate = 0.5 with one stable, one changed
test('stability_rate = 0.5 with 1 stable and 1 changed recommendation', () => {
  const result = evaluateRecommendationStabilityCheck({
    segment_exclusion_recommendations: {
      recommendations: [
        { recommendation: 'candidate_keep', sample_size: 20, segment_type: 'market', segment_key: 'A' },
        { recommendation: 'recommend_exclude', sample_size: 20, segment_type: 'market', segment_key: 'B' },
      ],
    },
  });
  const check = result.recommendation_stability_check;
  assert(
    check.stability_rate === 0.5,
    `Expected stability_rate=0.5, got ${check.stability_rate}`
  );
});

// Test 6 — requires_more_runs always true
test('requires_more_runs is always true', () => {
  const result = evaluateRecommendationStabilityCheck({
    segment_exclusion_recommendations: {
      recommendations: [
        { recommendation: 'watch', sample_size: 15, segment_type: 'market', segment_key: 'ml' },
      ],
    },
  });
  assert(
    result.recommendation_stability_check.requires_more_runs === true,
    `Expected requires_more_runs=true`
  );
});

// Test 7 — summary safe flags always false
test('summary safe_to_beta and safe_to_sell are always false', () => {
  const result = evaluateRecommendationStabilityCheck({
    can_beta: true,
    can_sell: true,
    segment_exclusion_recommendations: {
      recommendations: [
        { recommendation: 'candidate_keep', sample_size: 30, segment_type: 'market', segment_key: 'x' },
      ],
    },
  });
  const summary = result.recommendation_stability_summary;
  assert(summary.safe_to_beta === false, `Expected safe_to_beta=false, got ${summary.safe_to_beta}`);
  assert(summary.safe_to_sell === false, `Expected safe_to_sell=false, got ${summary.safe_to_sell}`);
});

// Test 8 — output is JSON serializable
test('full output is JSON serializable', () => {
  let threw = false;
  try {
    JSON.stringify(
      evaluateRecommendationStabilityCheck({
        segment_exclusion_recommendations: {
          recommendations: [
            { segment_type: 'market', segment_key: 'x', recommendation: 'watch', sample_size: 10 },
          ],
        },
      })
    );
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'JSON.stringify threw an error');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
