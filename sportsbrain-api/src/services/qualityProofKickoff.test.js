// qualityProofKickoff.test.js — P3.9 Quality Proof Kickoff tests
// Run: node src/services/qualityProofKickoff.test.js (from sportsbrain-api dir)

import assert from 'assert'
import { evaluateQualityProofKickoff } from './qualityProofKickoff.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

console.log('\nP3.9 Quality Proof Kickoff — test suite\n')

// T1 — insufficient sample
test('T1: resolved_valid=12 → sample_quality=insufficient, minimum_sample_met=false', () => {
  const result = evaluateQualityProofKickoff({ resolved_valid: 12 })
  const r = result.resolved_quality_seed_report
  assert.strictEqual(r.sample_quality, 'insufficient', `expected 'insufficient', got '${r.sample_quality}'`)
  assert.strictEqual(r.minimum_sample_met, false, `expected minimum_sample_met=false`)
})

// T2 — threshold reached
test('T2: resolved_valid=30 → minimum_sample_met=true, sample_quality threshold_ready or early_signal', () => {
  const result = evaluateQualityProofKickoff({ resolved_valid: 30, green_count: 20, red_count: 10 })
  const r = result.resolved_quality_seed_report
  assert.strictEqual(r.minimum_sample_met, true, `expected minimum_sample_met=true`)
  assert.ok(
    r.sample_quality === 'threshold_ready' || r.sample_quality === 'early_signal',
    `expected 'threshold_ready' or 'early_signal', got '${r.sample_quality}'`
  )
})

// T3 — hit_rate calculation
test('T3: green_count=18, red_count=12 → hit_rate=0.6', () => {
  const result = evaluateQualityProofKickoff({ resolved_valid: 30, green_count: 18, red_count: 12 })
  const r = result.resolved_quality_seed_report
  assert.strictEqual(r.hit_rate, 0.6, `expected hit_rate=0.6, got ${r.hit_rate}`)
})

// T4 — waiting_for_sample
test('T4: resolved_valid=12 → quality_proof_kickoff.status=waiting_for_sample', () => {
  const result = evaluateQualityProofKickoff({ resolved_valid: 12 })
  const k = result.quality_proof_kickoff
  assert.strictEqual(k.status, 'waiting_for_sample', `expected 'waiting_for_sample', got '${k.status}'`)
})

// T5 — waiting_for_manual_activation
test('T5: resolved_valid=30, micro_test_active=false → status=waiting_for_manual_activation', () => {
  const result = evaluateQualityProofKickoff({ resolved_valid: 30, micro_test_active: false })
  const k = result.quality_proof_kickoff
  assert.strictEqual(
    k.status,
    'waiting_for_manual_activation',
    `expected 'waiting_for_manual_activation', got '${k.status}'`
  )
})

// T6 — quality_proof_started
test('T6: resolved_valid=30, micro_test_active=true, micro_test_report.status=active → quality_proof_started=true', () => {
  const result = evaluateQualityProofKickoff({
    resolved_valid: 30,
    micro_test_active: true,
    micro_test_report: { status: 'active' },
  })
  const k = result.quality_proof_kickoff
  assert.strictEqual(k.quality_proof_started, true, `expected quality_proof_started=true`)
  assert.strictEqual(k.status, 'quality_proof_started', `expected status='quality_proof_started', got '${k.status}'`)
})

// T7 — initial questions
test('T7: default → quality_proof_initial_questions has >= 6 questions covering key topics', () => {
  const result = evaluateQualityProofKickoff()
  const q = result.quality_proof_initial_questions
  assert.ok(Array.isArray(q.questions), 'expected questions to be an array')
  assert.ok(q.questions.length >= 6, `expected >= 6 questions, got ${q.questions.length}`)
  const ids = q.questions.map((x) => x.question_id)
  const oddsQ = ids.find((id) => id.includes('odds'))
  const confidenceQ = ids.find((id) => id.includes('confidence') || id.includes('trust'))
  const segmentQ = ids.find((id) => id.includes('segment'))
  assert.ok(oddsQ, 'expected a question about odds')
  assert.ok(confidenceQ, 'expected a question about confidence or trust')
  assert.ok(segmentQ, 'expected a question about segments')
})

// T8 — safe_to_beta and safe_to_sell always false
test('T8: default → p39_quality_kickoff_summary.safe_to_beta=false, safe_to_sell=false', () => {
  const result = evaluateQualityProofKickoff()
  const s = result.p39_quality_kickoff_summary
  assert.strictEqual(s.safe_to_beta, false, `expected safe_to_beta=false`)
  assert.strictEqual(s.safe_to_sell, false, `expected safe_to_sell=false`)
})

// T9 — no throw on default call
test('T9: JSON.stringify(evaluateQualityProofKickoff()) does not throw', () => {
  let serialized
  assert.doesNotThrow(() => {
    serialized = JSON.stringify(evaluateQualityProofKickoff())
  }, 'expected no throw on JSON.stringify')
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'expected non-empty JSON string')
})

// Summary
console.log(`\n${'─'.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const e of errors) {
    console.error(`  - ${e.name}: ${e.error}`)
  }
}
console.log('')
process.exit(failed > 0 ? 1 : 0)
