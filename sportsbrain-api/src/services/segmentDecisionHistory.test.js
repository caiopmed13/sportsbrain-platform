import { evaluateSegmentDecisionHistory } from './segmentDecisionHistory.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — empty history
test('empty history - segments_tracked is 0 and status is empty or simulated', () => {
  const result = evaluateSegmentDecisionHistory({})
  assert(result.segment_decision_history_simulation.segments_tracked === 0, 'segments_tracked should be 0')
  assert(
    ['empty', 'simulated'].includes(result.segment_decision_history_simulation.status),
    `status should be empty or simulated, got: ${result.segment_decision_history_simulation.status}`
  )
})

// Test 2 — synthetic history matrix
test('synthetic history matrix has round_1, round_2, current rounds', () => {
  const result = evaluateSegmentDecisionHistory({
    segment_exclusion_recommendations: {
      recommendations: [{
        segment_type: 'market',
        segment_key: 'moneyline',
        recommendation: 'watch',
        sample_size: 8,
        hit_rate: 0.5,
        edge_vs_break_even: -0.02,
        confidence: 'medium'
      }]
    }
  })
  const history = result.segment_decision_history_matrix.segments[0].history
  assert(history.some(h => h.round === 'round_1'), 'should have round_1')
  assert(history.some(h => h.round === 'round_2'), 'should have round_2')
  assert(history.some(h => h.round === 'current'), 'should have current')
})

// Test 3 — stable segment
test('continue_collecting segment is stable', () => {
  const result = evaluateSegmentDecisionHistory({
    segment_exclusion_recommendations: {
      recommendations: [{
        segment_type: 'sport',
        segment_key: 'football',
        recommendation: 'continue_collecting',
        sample_size: 5,
        hit_rate: 0.6,
        edge_vs_break_even: 0.01,
        confidence: 'low'
      }]
    }
  })
  const seg = result.segment_decision_history_matrix.segments[0]
  assert(seg.stable === true, 'segment should be stable')
  assert(seg.trend === 'stable', `trend should be stable, got: ${seg.trend}`)
})

// Test 4 — declining segment
test('recommend_exclude segment is declining and not stable', () => {
  const result = evaluateSegmentDecisionHistory({
    segment_exclusion_recommendations: {
      recommendations: [{
        segment_type: 'market',
        segment_key: 'spread',
        recommendation: 'recommend_exclude',
        sample_size: 15,
        hit_rate: 0.3,
        edge_vs_break_even: -0.12,
        confidence: 'high'
      }]
    }
  })
  const seg = result.segment_decision_history_matrix.segments[0]
  assert(seg.trend === 'declining', `trend should be declining, got: ${seg.trend}`)
  assert(seg.stable === false, 'segment should not be stable')
})

// Test 5 — improving segment
test('candidate_keep segment is improving', () => {
  const result = evaluateSegmentDecisionHistory({
    segment_exclusion_recommendations: {
      recommendations: [{
        segment_type: 'market',
        segment_key: 'totals',
        recommendation: 'candidate_keep',
        sample_size: 20,
        hit_rate: 0.65,
        edge_vs_break_even: 0.08,
        confidence: 'high'
      }]
    }
  })
  const seg = result.segment_decision_history_matrix.segments[0]
  assert(seg.trend === 'improving', `trend should be improving, got: ${seg.trend}`)
})

// Test 6 — requires more runs
test('requires_more_runs is true for empty input', () => {
  const result = evaluateSegmentDecisionHistory({})
  assert(result.segment_decision_history_simulation.requires_more_runs === true, 'requires_more_runs should be true')
})

// Test 7 — summary safe
test('summary safe_to_beta and safe_to_sell are false for empty input', () => {
  const result = evaluateSegmentDecisionHistory({})
  assert(result.segment_decision_history_summary.safe_to_beta === false, 'safe_to_beta should be false')
  assert(result.segment_decision_history_summary.safe_to_sell === false, 'safe_to_sell should be false')
})

// Test 8 — output serializable
test('output is JSON-serializable with 2 mixed segments', () => {
  const result = evaluateSegmentDecisionHistory({
    segment_exclusion_recommendations: {
      recommendations: [
        {
          segment_type: 'market',
          segment_key: 'moneyline',
          recommendation: 'recommend_exclude',
          sample_size: 12,
          hit_rate: 0.35,
          edge_vs_break_even: -0.1,
          confidence: 'high'
        },
        {
          segment_type: 'sport',
          segment_key: 'basketball',
          recommendation: 'candidate_keep',
          sample_size: 25,
          hit_rate: 0.7,
          edge_vs_break_even: 0.09,
          confidence: 'high'
        }
      ]
    }
  })
  let threw = false
  try { JSON.stringify(result) } catch(e) { threw = true }
  assert(!threw, 'result should be JSON-serializable')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
