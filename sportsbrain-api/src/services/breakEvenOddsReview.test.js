import {
  evaluateBreakEvenOddsReview,
  normalizeDecimalOdds,
  computeBreakEvenHitRate,
  computeSegmentBreakEven,
} from './breakEvenOddsReview.js'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`)
    failed++
  }
}

// ─── T1 — normalizeDecimalOdds ───────────────────────────────────────────────

test('T1 — normalizeDecimalOdds', () => {
  assert(normalizeDecimalOdds(2.0) === 2.0, 'expected 2.0 for numeric 2.0')
  assert(normalizeDecimalOdds('1.50') === 1.5, 'expected 1.5 for string "1.50"')
  assert(normalizeDecimalOdds(null) === null, 'expected null for null')
  assert(normalizeDecimalOdds(0.9) === null, 'expected null for odds <= 1.0 (0.9)')
  assert(normalizeDecimalOdds('abc') === null, 'expected null for non-numeric string "abc"')
})

// ─── T2 — computeBreakEvenHitRate ────────────────────────────────────────────

test('T2 — computeBreakEvenHitRate', () => {
  assert(computeBreakEvenHitRate(2.0) === 0.5, 'expected 0.5 for odds=2.0')
  assert(Math.abs(computeBreakEvenHitRate(1.5) - 0.6667) < 0.0001, 'expected ~0.6667 for odds=1.5')
  assert(Math.abs(computeBreakEvenHitRate(3.0) - 0.3333) < 0.0001, 'expected ~0.3333 for odds=3.0')
})

// ─── T3 — positive edge segment ──────────────────────────────────────────────

test('T3 — positive edge segment', () => {
  const result = computeSegmentBreakEven({
    segment_type: 'sport',
    segment_key: 'football',
    sample_size: 20,
    green: 12,
    red: 8,
    hit_rate: 0.6,
    average_odds: 2.0,
  })
  assert(Math.abs(result.edge_vs_break_even - 0.1) < 0.001, `expected edge ~0.1, got ${result.edge_vs_break_even}`)
  assert(result.status === 'positive_edge', `expected status=positive_edge, got ${result.status}`)
})

// ─── T4 — negative edge segment ──────────────────────────────────────────────

test('T4 — negative edge segment', () => {
  const result = computeSegmentBreakEven({
    segment_type: 'market',
    segment_key: 'player_props',
    sample_size: 15,
    green: 6,
    red: 9,
    hit_rate: 0.4,
    average_odds: 2.0,
  })
  assert(result.status === 'negative_edge', `expected status=negative_edge, got ${result.status}`)
})

// ─── T5 — insufficient sample ────────────────────────────────────────────────

test('T5 — insufficient sample', () => {
  const result = computeSegmentBreakEven({
    sample_size: 3,
    green: 2,
    red: 1,
    hit_rate: 0.667,
  })
  assert(result.status === 'insufficient_sample', `expected status=insufficient_sample, got ${result.status}`)
})

// ─── T6 — not available odds ─────────────────────────────────────────────────

test('T6 — not available odds', () => {
  const result = computeSegmentBreakEven({
    sample_size: 10,
    green: 6,
    red: 4,
    hit_rate: 0.6,
  })
  assert(result.status === 'not_available', `expected status=not_available, got ${result.status}`)
})

// ─── T7 — matrix summary counts ──────────────────────────────────────────────

test('T7 — matrix summary counts', () => {
  const result = evaluateBreakEvenOddsReview({
    segments: [
      {
        segment_type: 'sport',
        segment_key: 'football',
        sample_size: 20,
        green: 12,
        red: 8,
        hit_rate: 0.6,
        average_odds: 2.0,
      },
      {
        segment_type: 'market',
        segment_key: 'player_props',
        sample_size: 15,
        green: 6,
        red: 9,
        hit_rate: 0.4,
        average_odds: 2.0,
      },
    ],
  })
  assert(result.break_even_odds_review.positive_edge_count >= 1, `expected positive_edge_count >= 1, got ${result.break_even_odds_review.positive_edge_count}`)
  assert(result.break_even_odds_review.negative_edge_count >= 1, `expected negative_edge_count >= 1, got ${result.break_even_odds_review.negative_edge_count}`)
  assert(result.break_even_odds_review.can_beta === false, 'expected can_beta=false')
  assert(result.break_even_odds_review.can_sell === false, 'expected can_sell=false')
})

// ─── T8 — serializable ───────────────────────────────────────────────────────

test('T8 — serializable', () => {
  let threw = false
  try {
    JSON.stringify(evaluateBreakEvenOddsReview({}))
  } catch {
    threw = true
  }
  assert(!threw, 'JSON.stringify should not throw on evaluateBreakEvenOddsReview({})')
})

// ─── Results ─────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests`)
if (failed > 0) process.exit(1)
