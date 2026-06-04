import { evaluateQualityProofReviewBoard } from './qualityProofReviewBoard.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch(e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

// Test 1 — board convened
test('board convened', () => {
  const result = evaluateQualityProofReviewBoard({})
  assert(
    ['convened', 'simulation_review_ready'].includes(result.quality_proof_review_board.status),
    `status was ${result.quality_proof_review_board.status}`
  )
  assert(result.quality_proof_review_board.real_authority === false, 'real_authority should be false')
  assert(result.quality_proof_review_board.can_approve_real_beta === false, 'can_approve_real_beta should be false')
})

// Test 2 — votes minimum domains
test('votes minimum domains', () => {
  const result = evaluateQualityProofReviewBoard({})
  assert(result.quality_review_board_votes.votes.some(v => v.domain === 'sample_size'), 'missing sample_size domain')
  assert(result.quality_review_board_votes.votes.some(v => v.domain === 'quality_gate'), 'missing quality_gate domain')
  assert(result.quality_review_board_votes.votes.some(v => v.domain === 'commercial_safety'), 'missing commercial_safety domain')
})

// Test 3 — commercial safety blocks real beta
test('commercial safety blocks real beta', () => {
  const result = evaluateQualityProofReviewBoard({})
  const commercialVote = result.quality_review_board_votes.votes.find(v => v.domain === 'commercial_safety')
  assert(commercialVote.vote === 'block_real_beta', `commercial_safety vote was ${commercialVote.vote}`)
  assert(commercialVote.can_override === false, 'can_override should be false')
})

// Test 4 — governance packet safe
test('governance packet safe', () => {
  const result = evaluateQualityProofReviewBoard({})
  assert(result.beta_simulation_governance_packet.ready_for_real_beta === false, 'ready_for_real_beta should be false')
  assert(result.beta_simulation_governance_packet.allows_real_users === false, 'allows_real_users should be false')
  assert(result.beta_simulation_governance_packet.allows_sell === false, 'allows_sell should be false')
})

// Test 5 — simulation review ready but real beta false
test('simulation review ready but real beta false', () => {
  const result = evaluateQualityProofReviewBoard({
    quality_proof_decision_gate: { gate_score: 75, can_advance_quality_proof: true },
    quality_proof_trend_monitor: { trend_direction: 'up' },
    shadow_policy_enforcement:   { status: 'enforced' },
    segment_decision_history_simulation: { stable_segments_count: 3 },
  })
  assert(result.beta_simulation_governance_packet.ready_for_beta_simulation_review === true, 'ready_for_beta_simulation_review should be true')
  assert(result.beta_simulation_governance_packet.ready_for_real_beta === false, 'ready_for_real_beta should be false')
})

// Test 6 — unsafe can_sell sanitized
test('unsafe can_sell sanitized', () => {
  const result = evaluateQualityProofReviewBoard({ can_sell: true, allows_sell: true })
  assert(result.beta_simulation_governance_packet.allows_sell === false, 'allows_sell should be false after sanitization')
  assert(result.quality_proof_review_board.violations.length > 0, 'violations should be non-empty')
})

// Test 7 — operator summary safe
test('operator summary safe', () => {
  const result = evaluateQualityProofReviewBoard({})
  assert(result.p39_beta_simulation_operator_summary.safe_to_invite_private_users === false, 'safe_to_invite_private_users should be false')
  assert(result.p39_beta_simulation_operator_summary.safe_to_sell === false, 'safe_to_sell should be false')
})

// Test 8 — output serializable
test('output serializable', () => {
  const result = evaluateQualityProofReviewBoard({})
  let threw = false
  try { JSON.stringify(result) } catch(e) { threw = true }
  assert(!threw, 'JSON.stringify should not throw')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
