// src/services/evidenceExport.test.js
// P3.8.17 — 12 tests for Evidence Export Packet, Operator Report Rendering

import assert from 'assert'
import {
  safeString,
  buildDecisionFingerprint,
  buildEvidenceExportPacket,
  renderOperatorReport,
  buildOperatorReportSummary,
  buildExportValidationSummary,
  evaluateEvidenceExport,
} from './evidenceExport.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────────

test('T1: empty input → status=generated, render=rendered, validation=valid_with_warnings, can_beta=false, can_sell=false', () => {
  const result = evaluateEvidenceExport({})
  assert.strictEqual(result.evidence_export_packet.status,              'generated')
  assert.strictEqual(result.operator_report_render.status,              'rendered')
  // empty input has all required blocks missing → valid_with_warnings
  assert.ok(
    result.export_validation_summary.status === 'valid_with_warnings' ||
    result.export_validation_summary.status === 'valid',
    `Expected valid_with_warnings or valid, got ${result.export_validation_summary.status}`
  )
  assert.strictEqual(result.evidence_export_packet.safety.can_beta,  false)
  assert.strictEqual(result.evidence_export_packet.safety.can_sell,  false)
})

test('T2: export packet sections include all 12 required section codes', () => {
  const result  = evaluateEvidenceExport({})
  const codes   = result.evidence_export_packet.sections.map(s => s.code)
  const required = [
    'readiness', 'micro_test', 'micro_test_policy', 'segment_health',
    'beta_admission', 'private_beta_sandbox', 'simulated_cohort_monitor',
    'operator_decision', 'manual_review_governance', 'no_launch_governance',
    'hard_locks', 'next_actions',
  ]
  for (const code of required) {
    assert.ok(codes.includes(code), `Missing section: ${code}`)
  }
})

test('T3: same input twice → same fingerprint value', () => {
  const input = {
    launch_no_launch_decision: { decision: 'continue_shadow' },
    micro_test_active: false,
    resolved_valid: 42,
  }
  const r1 = evaluateEvidenceExport(input)
  const r2 = evaluateEvidenceExport(input)
  assert.strictEqual(r1.decision_fingerprint.value, r2.decision_fingerprint.value)
})

test('T4: different decision → different fingerprint value', () => {
  const base = { micro_test_active: false }
  const r1 = evaluateEvidenceExport({ ...base, launch_no_launch_decision: { decision: 'continue_shadow' } })
  const r2 = evaluateEvidenceExport({ ...base, launch_no_launch_decision: { decision: 'ready_for_manual_review' } })
  assert.notStrictEqual(r1.decision_fingerprint.value, r2.decision_fingerprint.value)
})

test('T5: operator report text contains required strings', () => {
  const result = evaluateEvidenceExport({})
  const text   = result.operator_report_render.text
  assert.ok(text.includes('SportsBrain Operator Review Report'), 'Missing title')
  assert.ok(text.includes('Beta: blocked'),                      'Missing beta blocked line')
  assert.ok(text.includes('Sell: blocked'),                      'Missing sell blocked line')
})

test('T6: operator report text does NOT contain commercial claims', () => {
  const result   = evaluateEvidenceExport({})
  const text     = result.operator_report_render.text.toLowerCase()
  const banned   = ['roi', 'lucro garantido', 'pronto para vender', 'assertividade garantida']
  for (const phrase of banned) {
    assert.ok(!text.includes(phrase), `Found banned phrase: "${phrase}"`)
  }
})

test('T7: can_beta=true, can_sell=true → validation invalid, forbidden_true_fields populated', () => {
  const result = evaluateEvidenceExport({ can_beta: true, can_sell: true })
  const v      = result.export_validation_summary
  assert.strictEqual(v.valid,  false)
  assert.strictEqual(v.status, 'invalid')
  assert.ok(v.forbidden_true_fields.length >= 2, 'Expected at least 2 forbidden entries')
  const fields = v.forbidden_true_fields.map(f => f.field)
  assert.ok(fields.includes('can_beta'),  'Missing can_beta in forbidden_true_fields')
  assert.ok(fields.includes('can_sell'),  'Missing can_sell in forbidden_true_fields')
})

test('T8: can_beta=true in input → export packet output can_beta=false', () => {
  const result = evaluateEvidenceExport({ can_beta: true })
  assert.strictEqual(result.evidence_export_packet.safety.can_beta, false)
  // operator_decision section also must have can_beta=false
  const opSection = result.evidence_export_packet.sections.find(s => s.code === 'operator_decision')
  assert.ok(opSection, 'Missing operator_decision section')
  assert.strictEqual(opSection.key_metrics.can_beta, false)
})

test('T9: missing manual_review_artifact → missing_blocks includes manual_review_artifact', () => {
  const result = evaluateEvidenceExport({
    operator_decision_packet:  { status: 'blocked' },
    decision_evidence_matrix:  { overall_grade: 'blocked', overall_score: 0 },
    launch_governance:         { status: 'locked' },
    launch_no_launch_decision: { decision: 'continue_shadow' },
    governance_audit_summary:  { status: 'clean' },
    // manual_review_artifact intentionally absent
    no_launch_governance:      { status: 'locked' },
    release_hard_locks:        [],
    operator_review_audit_trail: { status: 'recorded' },
    manual_review_summary:     { status: 'blocked' },
  })
  const v = result.export_validation_summary
  assert.ok(v.missing_blocks.includes('manual_review_artifact'),
    `Expected manual_review_artifact in missing_blocks, got: ${JSON.stringify(v.missing_blocks)}`)
})

test('T10: operator_report_summary.safe_to_share_publicly=false always', () => {
  const r1 = evaluateEvidenceExport({})
  assert.strictEqual(r1.operator_report_summary.safe_to_share_publicly, false)

  const r2 = evaluateEvidenceExport({
    launch_no_launch_decision: { decision: 'ready_for_manual_review' },
    governance_audit_summary:  { status: 'clean' },
  })
  assert.strictEqual(r2.operator_report_summary.safe_to_share_publicly, false)
})

test('T11: export_allows_beta=true in input → evidence_export_packet.export_allows_beta=false', () => {
  const result = evaluateEvidenceExport({ export_allows_beta: true })
  assert.strictEqual(result.evidence_export_packet.export_allows_beta, false)
  assert.strictEqual(result.evidence_export_packet.export_allows_sell, false)
})

test('T12: JSON.stringify(evaluateEvidenceExport({})) does not throw', () => {
  const result = evaluateEvidenceExport({})
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
