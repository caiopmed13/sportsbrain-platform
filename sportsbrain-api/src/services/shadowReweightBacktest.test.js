import { evaluateShadowReweightBacktest, computeShadowAdjustedScore } from './shadowReweightBacktest.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — empty backtest
test('empty backtest returns rows_evaluated === 0', () => {
  const result = evaluateShadowReweightBacktest({})
  assert(result.shadow_reweight_backtest.rows_evaluated === 0,
    `expected rows_evaluated 0, got ${result.shadow_reweight_backtest.rows_evaluated}`)
})

// Test 2 — compute shadow adjusted score (market match)
test('computeShadowAdjustedScore applies market-matched weight correctly', () => {
  const result = computeShadowAdjustedScore(
    { bet_confidence_score: 80, market: 'moneyline' },
    [{ segment_key: 'moneyline', proposed_weight: 1.1, change: 'increase_weight' }]
  )
  assert(result.shadow_score === 88,
    `expected shadow_score 88, got ${result.shadow_score}`)
})

// Test 3 — score capped at 100
test('computeShadowAdjustedScore returns base score when no match', () => {
  const r1 = computeShadowAdjustedScore(
    { bet_confidence_score: 95 },
    [{ segment_key: 'football', proposed_weight: 1.25, change: 'increase_weight' }]
  )
  assert(r1.shadow_score === 95,
    `expected shadow_score 95 (no match, weight 1.0), got ${r1.shadow_score}`)
})

test('computeShadowAdjustedScore clamps score to 100 when match exceeds ceiling', () => {
  const r2 = computeShadowAdjustedScore(
    { bet_confidence_score: 95, market: 'x' },
    [{ segment_key: 'x', proposed_weight: 1.25 }]
  )
  assert(r2.shadow_score === 100,
    `expected shadow_score 100 (95*1.25=118.75 clamped), got ${r2.shadow_score}`)
})

// Test 4 — rank promotion
test('rank promotion: promoted_count > 0 when weight boosts lower-scored rows', () => {
  const rows = [
    { sport: 'basketball', market: 'moneyline', bet_confidence_score: 50, result_status: 'green' },
    { sport: 'basketball', market: 'moneyline', bet_confidence_score: 40, result_status: 'green' },
    { sport: 'basketball', market: 'moneyline', bet_confidence_score: 60, result_status: 'green' },
    { sport: 'basketball', market: 'moneyline', bet_confidence_score: 70, result_status: 'green' },
    { sport: 'basketball', market: 'moneyline', bet_confidence_score: 30, result_status: 'green' },
  ]
  const result = evaluateShadowReweightBacktest({
    resolved_rows: rows,
    proposed_weight_changes: {
      changes: [{ segment_key: 'moneyline', proposed_weight: 1.2 }]
    }
  })
  // All rows get same multiplier → no delta (uniform scale preserves order)
  // Actually with same weight all ranks are preserved → promoted_count could be 0
  // Let's use mixed weights to force promotion
  const result2 = evaluateShadowReweightBacktest({
    resolved_rows: [
      { sport: 'basketball', market: 'moneyline', bet_confidence_score: 50, result_status: 'green' },
      { sport: 'basketball', market: 'spread', bet_confidence_score: 40, result_status: 'green' },
      { sport: 'basketball', market: 'moneyline', bet_confidence_score: 60, result_status: 'green' },
      { sport: 'basketball', market: 'spread', bet_confidence_score: 70, result_status: 'green' },
      { sport: 'basketball', market: 'moneyline', bet_confidence_score: 30, result_status: 'green' },
    ],
    proposed_weight_changes: {
      changes: [
        { segment_key: 'moneyline', proposed_weight: 1.5 },  // boosts moneyline rows
        { segment_key: 'spread', proposed_weight: 0.5 },     // demotes spread rows
      ]
    }
  })
  assert(result2.shadow_ranking_delta_report.promoted_count > 0,
    `expected promoted_count > 0, got ${result2.shadow_ranking_delta_report.promoted_count}`)
})

// Test 5 — rank demotion
test('rank demotion: demoted_count > 0 when weight penalizes higher-scored rows', () => {
  const result = evaluateShadowReweightBacktest({
    resolved_rows: [
      { sport: 'basketball', market: 'moneyline', bet_confidence_score: 50, result_status: 'green' },
      { sport: 'basketball', market: 'spread', bet_confidence_score: 40, result_status: 'green' },
      { sport: 'basketball', market: 'moneyline', bet_confidence_score: 60, result_status: 'green' },
      { sport: 'basketball', market: 'spread', bet_confidence_score: 70, result_status: 'green' },
      { sport: 'basketball', market: 'moneyline', bet_confidence_score: 30, result_status: 'green' },
    ],
    proposed_weight_changes: {
      changes: [
        { segment_key: 'moneyline', proposed_weight: 1.5 },
        { segment_key: 'spread', proposed_weight: 0.5 },
      ]
    }
  })
  assert(result.shadow_ranking_delta_report.demoted_count > 0,
    `expected demoted_count > 0, got ${result.shadow_ranking_delta_report.demoted_count}`)
})

// Test 6 — no real change invariants
test('no real change: reweight_applied, engine_weights_changed, real_ranking_changed all false', () => {
  const result = evaluateShadowReweightBacktest({
    resolved_rows: [
      { sport: 'football', market: 'moneyline', bet_confidence_score: 70, result_status: 'green' }
    ],
    proposed_weight_changes: { changes: [{ segment_key: 'moneyline', proposed_weight: 1.1 }] }
  })
  const bt = result.shadow_reweight_backtest
  assert(bt.reweight_applied === false, `reweight_applied should be false`)
  assert(bt.engine_weights_changed === false, `engine_weights_changed should be false`)
  assert(bt.real_ranking_changed === false, `real_ranking_changed should be false`)
})

// Test 7 — audit entries
test('audit entries include shadow_scores_computed and no_real_ranking_change_confirmed', () => {
  const result = evaluateShadowReweightBacktest({
    resolved_rows: [
      { sport: 'football', market: 'moneyline', bet_confidence_score: 70, result_status: 'green' }
    ],
    proposed_weight_changes: { changes: [] }
  })
  const entries = result.shadow_backtest_audit.entries
  assert(entries.some(e => e.event === 'shadow_scores_computed'),
    'audit missing shadow_scores_computed entry')
  assert(entries.some(e => e.event === 'no_real_ranking_change_confirmed'),
    'audit missing no_real_ranking_change_confirmed entry')
})

// Test 8 — unsafe real_ranking_changed sanitized
test('real_ranking_changed: true input is sanitized to false and violation recorded', () => {
  const result = evaluateShadowReweightBacktest({ real_ranking_changed: true })
  const bt = result.shadow_reweight_backtest
  assert(bt.real_ranking_changed === false,
    `expected real_ranking_changed false, got ${bt.real_ranking_changed}`)
  assert(bt.violations.length > 0,
    `expected violations.length > 0, got ${bt.violations.length}`)
})

// Test 9 — output serializable
test('output is JSON-serializable', () => {
  let threw = false
  try {
    JSON.stringify(
      evaluateShadowReweightBacktest({
        resolved_rows: [
          { sport: 'football', market: 'moneyline', bet_confidence_score: 70, result_status: 'green' }
        ],
        proposed_weight_changes: { changes: [] }
      })
    )
  } catch (e) {
    threw = true
  }
  assert(!threw, 'JSON.stringify threw an error')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
