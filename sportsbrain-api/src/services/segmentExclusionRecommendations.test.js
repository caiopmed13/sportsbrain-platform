// src/services/segmentExclusionRecommendations.test.js
// p3.9.2 — 9 tests for Segment Exclusion Recommendations

import assert from 'assert'
import {
  evaluateSegmentExclusionRecommendations,
  buildSegmentRecommendationPolicy,
} from './segmentExclusionRecommendations.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('T1: policy invariants', () => {
  const result = evaluateSegmentExclusionRecommendations({})
  assert.strictEqual(result.segment_recommendation_policy.auto_apply_exclusions, false)
  assert.strictEqual(result.segment_recommendation_policy.manual_operator_review_required, true)
  assert.strictEqual(result.segment_recommendation_policy.can_change_pick_engine_now, false)
})

test('T2: recommend exclude', () => {
  const result = evaluateSegmentExclusionRecommendations({
    all_segments: [
      {
        segment_type: 'market',
        segment_key: 'player_props',
        sample_size: 14,
        green: 5,
        red: 9,
        hit_rate: 0.357,
        edge_vs_break_even: -0.15,
      },
    ],
  })
  assert.strictEqual(result.segment_exclusion_recommendations.recommendations[0].recommendation, 'recommend_exclude')
  assert.strictEqual(result.segment_exclusion_recommendations.recommendations[0].auto_applied, false)
})

test('T3: watch recommendation (small negative edge)', () => {
  const result = evaluateSegmentExclusionRecommendations({
    all_segments: [
      {
        segment_type: 'sport',
        segment_key: 'football',
        sample_size: 7,
        green: 3,
        red: 4,
        hit_rate: 0.43,
        edge_vs_break_even: -0.07,
      },
    ],
  })
  assert.strictEqual(result.segment_exclusion_recommendations.recommendations[0].recommendation, 'watch')
})

test('T4: continue collecting (small sample)', () => {
  const result = evaluateSegmentExclusionRecommendations({
    all_segments: [
      {
        segment_type: 'sport',
        segment_key: 'basketball',
        sample_size: 3,
        green: 2,
        red: 1,
        hit_rate: 0.667,
        edge_vs_break_even: null,
      },
    ],
  })
  assert.ok(
    ['continue_collecting', 'insufficient_sample'].includes(
      result.segment_exclusion_recommendations.recommendations[0].recommendation
    )
  )
})

test('T5: candidate keep', () => {
  const result = evaluateSegmentExclusionRecommendations({
    all_segments: [
      {
        segment_type: 'sport',
        segment_key: 'tennis',
        sample_size: 15,
        green: 10,
        red: 5,
        hit_rate: 0.667,
        edge_vs_break_even: 0.12,
      },
    ],
  })
  assert.strictEqual(result.segment_exclusion_recommendations.recommendations[0].recommendation, 'candidate_keep')
})

test('T6: watchlist generated', () => {
  const result = evaluateSegmentExclusionRecommendations({
    all_segments: [
      {
        segment_type: 'market',
        segment_key: 'corners',
        sample_size: 8,
        green: 3,
        red: 5,
        hit_rate: 0.375,
        edge_vs_break_even: -0.05,
      },
    ],
  })
  assert.ok(result.segment_watchlist.watchlist_count > 0)
  assert.ok(result.segment_watchlist.watchlist.some(w => w.segment_key === 'corners'))
})

test('T7: unsafe auto_apply_exclusions sanitized', () => {
  const result = evaluateSegmentExclusionRecommendations({ auto_apply_exclusions: true })
  assert.strictEqual(result.segment_recommendation_policy.auto_apply_exclusions, false)
  assert.strictEqual(result.segment_exclusion_summary.auto_apply_exclusions, false)
})

test('T8: summary safe invariants', () => {
  const result = evaluateSegmentExclusionRecommendations({})
  assert.strictEqual(result.segment_exclusion_summary.safe_to_beta, false)
  assert.strictEqual(result.segment_exclusion_summary.safe_to_sell, false)
})

test('T9: serializable', () => {
  assert.doesNotThrow(() => JSON.stringify(evaluateSegmentExclusionRecommendations({})))
})

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  console.error('BLOCKED:', errors.map(e => e.name).join(', '))
  process.exit(1)
} else {
  console.log('DONE — all 9 tests pass')
}
