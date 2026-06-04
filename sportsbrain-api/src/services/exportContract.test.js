// src/services/exportContract.test.js
// P3.8.18 — 12 tests for Export Contract

import assert from 'assert'
import {
  normalizeExportBoolean,
  buildOperatorReportDownloadContract,
  buildSafeExportManifest,
  buildCommercialClaimsGuard,
  buildExportIntegrityContract,
  buildDownloadReadinessSummary,
  evaluateExportContract,
} from './exportContract.js'

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

test('T1: empty input → download contract status in allowed values, download_enabled=false, download_publicly_available=false', () => {
  const result = evaluateExportContract({})
  const contract = result.operator_report_download_contract
  const allowed  = ['contract_ready', 'not_ready', 'ready_with_warnings']
  assert.ok(allowed.includes(contract.status),
    `Expected status in ${JSON.stringify(allowed)}, got "${contract.status}"`)
  assert.strictEqual(contract.download_enabled,            false)
  assert.strictEqual(contract.download_publicly_available, false)
})

test('T2: contract lists correct allowed_future_formats and blocked_formats_now', () => {
  const result   = evaluateExportContract({})
  const contract = result.operator_report_download_contract
  for (const fmt of ['json', 'txt', 'md']) {
    assert.ok(contract.allowed_future_formats.includes(fmt), `Missing allowed format: ${fmt}`)
  }
  for (const fmt of ['pdf', 'email', 'webhook', 'public_url']) {
    assert.ok(contract.blocked_formats_now.includes(fmt), `Missing blocked format: ${fmt}`)
  }
})

test('T3: safe input → manifest status=valid, contains_personal_data=false, contains_real_users=false, contains_payment_data=false', () => {
  const result = evaluateExportContract({})
  const mf = result.safe_export_manifest
  assert.strictEqual(mf.status,               'valid')
  assert.strictEqual(mf.contains_personal_data, false)
  assert.strictEqual(mf.contains_real_users,    false)
  assert.strictEqual(mf.contains_payment_data,  false)
})

test('T4: clean input → claims guard status=clean, claims_detected=false', () => {
  const result = evaluateExportContract({
    operator_report_render:  { text: 'SportsBrain Operator Review Report', status: 'rendered' },
    operator_report_summary: { headline: 'SportsBrain shadow mode.' },
  })
  const guard = result.commercial_claims_guard
  assert.strictEqual(guard.status,         'clean')
  assert.strictEqual(guard.claims_detected, false)
  assert.strictEqual(guard.blocked_terms_found.length, 0)
})

test('T5: PT-BR forbidden term "lucro garantido" in report text → claims_detected=true, status=blocked', () => {
  const result = evaluateExportContract({
    operator_report_render: { text: 'Sistema oferece lucro garantido para o operador.', status: 'rendered' },
  })
  const guard = result.commercial_claims_guard
  assert.strictEqual(guard.claims_detected, true)
  assert.strictEqual(guard.status,          'blocked')
  assert.ok(guard.blocked_terms_found.length > 0, 'Expected blocked_terms_found to be non-empty')
})

test('T6: EN forbidden term "guaranteed profit" → claims_detected=true', () => {
  const result = evaluateExportContract({
    operator_report_render: { text: 'This system offers guaranteed profit per week.', status: 'rendered' },
  })
  const guard = result.commercial_claims_guard
  assert.strictEqual(guard.claims_detected, true)
  assert.ok(guard.blocked_terms_found.includes('guaranteed profit'))
})

test('T7: fingerprint + report rendered + validation passed + regression passed → integrity score >= 70, status=valid', () => {
  const result = evaluateExportContract({
    decision_fingerprint:        { value: 'sb-p3.8.17-abc12345' },
    operator_report_render:      { status: 'rendered', text: 'SportsBrain Operator Review Report' },
    export_validation_summary:   { valid: true, status: 'valid' },
    governance_regression_suite: { passed: true, status: 'passed' },
  })
  const ic = result.export_integrity_contract
  assert.strictEqual(ic.status,        'valid')
  assert.ok(ic.integrity_score >= 70,  `Expected score >= 70, got ${ic.integrity_score}`)
  assert.strictEqual(ic.fingerprint_present, true)
  assert.strictEqual(ic.report_rendered,     true)
  assert.strictEqual(ic.validation_passed,   true)
  assert.strictEqual(ic.regression_passed,   true)
})

test('T8: no fingerprint → fingerprint_present=false, integrity_score < 100', () => {
  const result = evaluateExportContract({
    operator_report_render:      { status: 'rendered', text: 'SportsBrain Operator Review Report' },
    export_validation_summary:   { valid: true },
    governance_regression_suite: { passed: true },
  })
  const ic = result.export_integrity_contract
  assert.strictEqual(ic.fingerprint_present, false)
  assert.ok(ic.integrity_score < 100, `Expected score < 100, got ${ic.integrity_score}`)
})

test('T9: download readiness summary → download_enabled_now=false, safe_for_public_share=false, safe_to_sell=false', () => {
  const result  = evaluateExportContract({})
  const summary = result.download_readiness_summary
  assert.strictEqual(summary.download_enabled_now,  false)
  assert.strictEqual(summary.safe_for_public_share, false)
  assert.strictEqual(summary.safe_to_sell,          false)
})

test('T10: unsafe download_enabled=true, download_publicly_available=true → output=false, violations registered', () => {
  const result   = evaluateExportContract({ download_enabled: true, download_publicly_available: true })
  const contract = result.operator_report_download_contract
  assert.strictEqual(contract.download_enabled,            false, 'download_enabled must always be false')
  assert.strictEqual(contract.download_publicly_available, false, 'download_publicly_available must always be false')
  assert.strictEqual(contract.violations_detected, true, 'violations_detected must be true')
  assert.ok(contract.violations.length >= 2, 'Expected at least 2 violations')
})

test('T11: export_allows_beta=true → safe_export_manifest.safety_invariants.export_allows_beta=false', () => {
  const result = evaluateExportContract({ export_allows_beta: true })
  const mf = result.safe_export_manifest
  assert.strictEqual(mf.safety_invariants.export_allows_beta, false)
  assert.strictEqual(mf.safety_invariants.export_allows_sell, false)
})

test('T12: JSON.stringify(evaluateExportContract({})) does not throw', () => {
  const result = evaluateExportContract({})
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
