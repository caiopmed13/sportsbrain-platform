import { evaluateQualityProofTrendMonitor } from './qualityProofTrendMonitor.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — synthetic history generated
test('synthetic history generated (3 snapshots)', () => {
  const result = evaluateQualityProofTrendMonitor({ quality_proof_decision_gate: { gate_score: 32, decision: 'collect_more_data' } })
  assert(result.quality_proof_trend_monitor.snapshots_count === 3, `expected snapshots_count 3, got ${result.quality_proof_trend_monitor.snapshots_count}`)
  assert(result.quality_proof_trend_monitor.history_persistence_enabled === false, 'history_persistence_enabled should be false')
})

// Test 2 — trend up
test('trend direction up (default synthetic previous = current - 4)', () => {
  const result = evaluateQualityProofTrendMonitor({ quality_proof_decision_gate: { gate_score: 32 } })
  assert(result.quality_gate_trend_report.trend_direction === 'up', `expected trend_direction 'up', got '${result.quality_gate_trend_report.trend_direction}'`)
})

// Test 3 — trend down
test('trend direction down (synthetic_previous_score > current)', () => {
  const result = evaluateQualityProofTrendMonitor(
    { quality_proof_decision_gate: { gate_score: 32 } },
    { synthetic_previous_score: 40 }
  )
  assert(result.quality_gate_trend_report.trend_direction === 'down', `expected trend_direction 'down', got '${result.quality_gate_trend_report.trend_direction}'`)
})

// Test 4 — trend flat
test('trend direction flat (synthetic_previous_score === current)', () => {
  const result = evaluateQualityProofTrendMonitor(
    { quality_proof_decision_gate: { gate_score: 32 } },
    { synthetic_previous_score: 32 }
  )
  assert(result.quality_gate_trend_report.trend_direction === 'flat', `expected trend_direction 'flat', got '${result.quality_gate_trend_report.trend_direction}'`)
})

// Test 5 — requires more real runs
test('requires_more_real_runs is always true', () => {
  const result = evaluateQualityProofTrendMonitor({})
  assert(result.quality_proof_trend_monitor.requires_more_real_runs === true, 'requires_more_real_runs should be true')
})

// Test 6 — operator actions
test('operator actions contain required entries', () => {
  const result = evaluateQualityProofTrendMonitor({})
  assert(result.quality_trend_operator_actions.actions.some(a => a.action === 'continue_collecting_real_results'), 'missing continue_collecting_real_results')
  assert(result.quality_trend_operator_actions.actions.some(a => a.action === 'do_not_enable_beta'), 'missing do_not_enable_beta')
  assert(result.quality_trend_operator_actions.actions.some(a => a.action === 'do_not_sell'), 'missing do_not_sell')
})

// Test 7 — unsafe can_beta/can_sell sanitized
test('unsafe fields sanitized and violations recorded', () => {
  const result = evaluateQualityProofTrendMonitor({ can_beta: true, can_sell: true })
  assert(result.quality_proof_trend_monitor.can_beta === false, `can_beta should be false, got ${result.quality_proof_trend_monitor.can_beta}`)
  assert(result.quality_proof_trend_monitor.can_sell === false, `can_sell should be false, got ${result.quality_proof_trend_monitor.can_sell}`)
  assert(result.quality_proof_trend_monitor.violations.length > 0, 'violations should be non-empty')
})

// Test 8 — output serializable
test('output is JSON serializable', () => {
  const result = evaluateQualityProofTrendMonitor({ quality_proof_decision_gate: { gate_score: 45, decision: 'collect_more_data' } })
  JSON.stringify(result)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
