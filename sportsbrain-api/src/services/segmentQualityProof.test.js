// segmentQualityProof.test.js
import { evaluateSegmentQualityProof, buildSegmentsFromResolvedRows, buildConfidenceCalibrationReview } from './segmentQualityProof.js'

let passed = 0, failed = 0
function assert(cond, msg) { if (!cond) throw new Error(msg) }
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (e) { console.error(`  FAIL  ${name}: ${e.message}`); failed++ }
}

const SAMPLE_ROWS = [
  { sport: 'football', market: 'moneyline', result_status: 'green', bet_confidence_tier: 'high', odd: 1.9, trust_level: 'high' },
  { sport: 'football', market: 'moneyline', result_status: 'red',   bet_confidence_tier: 'medium', odd: 2.1, trust_level: 'medium' },
  { sport: 'basketball', market: 'totals',  result_status: 'green', bet_confidence_tier: 'low',  odd: 1.7, trust_level: 'low' },
]

// T1 — proof empty (no input)
test('T1: proof empty — no input', () => {
  const result = evaluateSegmentQualityProof({})
  assert(result.segment_quality_proof.sample_size === 0,
    `expected sample_size=0, got ${result.segment_quality_proof.sample_size}`)
  assert(
    ['insufficient_data', 'empty', 'none'].includes(result.segment_quality_proof.quality_proof_level),
    `expected quality_proof_level to be insufficient_data/empty/none, got ${result.segment_quality_proof.quality_proof_level}`
  )
})

// T2 — build segments from rows
test('T2: build segments from rows — segments_count > 0', () => {
  const result = evaluateSegmentQualityProof({ rows: SAMPLE_ROWS })
  assert(result.segment_quality_proof.segments_count > 0,
    `expected segments_count > 0, got ${result.segment_quality_proof.segments_count}`)
})

// T3 — quality proof evaluated
test('T3: quality proof evaluated', () => {
  const result = evaluateSegmentQualityProof({ rows: SAMPLE_ROWS })
  assert(result.segment_quality_proof.status === 'evaluated',
    `expected status=evaluated, got ${result.segment_quality_proof.status}`)
})

// T4 — rankings exist
test('T4: rankings arrays exist', () => {
  const result = evaluateSegmentQualityProof({ rows: SAMPLE_ROWS })
  assert(Array.isArray(result.segment_quality_rankings.top_segments),
    'expected top_segments to be an array')
  assert(Array.isArray(result.segment_quality_rankings.bottom_segments),
    'expected bottom_segments to be an array')
})

// T5 — confidence aligned
test('T5: confidence aligned', () => {
  const result = evaluateSegmentQualityProof({
    resolved_sample_distribution: {
      by_confidence_bucket: [
        { key: 'high',   count: 20, green: 15, red: 5  },
        { key: 'medium', count: 20, green: 12, red: 8  },
        { key: 'low',    count: 20, green: 8,  red: 12 },
      ],
    },
  })
  assert(result.confidence_calibration_review.calibration_status === 'aligned',
    `expected calibration_status=aligned, got ${result.confidence_calibration_review.calibration_status}`)
})

// T6 — confidence inverted
test('T6: confidence inverted', () => {
  const result = evaluateSegmentQualityProof({
    resolved_sample_distribution: {
      by_confidence_bucket: [
        { key: 'high', count: 20, green: 6,  red: 14 },
        { key: 'low',  count: 20, green: 15, red: 5  },
      ],
    },
  })
  assert(result.confidence_calibration_review.calibration_status === 'inverted',
    `expected calibration_status=inverted, got ${result.confidence_calibration_review.calibration_status}`)
})

// T7 — confidence insufficient
test('T7: confidence insufficient — small sample', () => {
  const result = evaluateSegmentQualityProof({
    resolved_sample_distribution: {
      by_confidence_bucket: [
        { key: 'high', count: 2, green: 1, red: 1 },
      ],
    },
  })
  assert(
    ['insufficient_data', 'not_available'].includes(result.confidence_calibration_review.calibration_status),
    `expected insufficient_data or not_available, got ${result.confidence_calibration_review.calibration_status}`
  )
})

// T8 — safe output invariants
test('T8: safe output invariants — can_beta/can_sell/safe_to_beta/safe_to_sell are always false', () => {
  const result = evaluateSegmentQualityProof({ rows: SAMPLE_ROWS })
  assert(result.segment_quality_proof.can_beta === false,
    `expected can_beta=false, got ${result.segment_quality_proof.can_beta}`)
  assert(result.segment_quality_proof.can_sell === false,
    `expected can_sell=false, got ${result.segment_quality_proof.can_sell}`)
  assert(result.p39_segment_quality_summary.safe_to_beta === false,
    `expected safe_to_beta=false, got ${result.p39_segment_quality_summary.safe_to_beta}`)
  assert(result.p39_segment_quality_summary.safe_to_sell === false,
    `expected safe_to_sell=false, got ${result.p39_segment_quality_summary.safe_to_sell}`)
})

// T9 — serializable
test('T9: output is serializable', () => {
  let threw = false
  try {
    JSON.stringify(evaluateSegmentQualityProof({}))
  } catch (e) {
    threw = true
  }
  assert(!threw, 'JSON.stringify threw — output is not serializable')
})

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests`)
if (failed > 0) process.exit(1)
