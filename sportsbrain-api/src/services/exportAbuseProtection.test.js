// src/services/exportAbuseProtection.test.js
// P3.8.20 — 9 tests for Export Abuse Protection

import assert from 'assert'
import {
  normalizeAbuseBoolean,
  measurePreviewPayload,
  detectExportAbuseRisks,
  buildPreviewPayloadLimits,
  buildExportAbuseProtection,
  buildInternalDownloadPreflight,
  evaluateExportAbuseProtection,
} from './exportAbuseProtection.js'

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

test('T1: empty input → payload within_limits', () => {
  const result = buildPreviewPayloadLimits({})
  assert.strictEqual(result.status, 'within_limits')
  assert.strictEqual(result.truncated, false)
  assert.strictEqual(result.blockers.length, 0)
})

test('T2: text exceeding max_text_chars → over_limit or truncated', () => {
  const bigText = 'x'.repeat(9000)   // > 8000
  const result  = buildPreviewPayloadLimits({
    operator_report_render: { text: bigText },
  })
  const allowed = ['truncated', 'over_limit', 'blocked']
  assert.ok(allowed.includes(result.status), `Expected over_limit status, got "${result.status}"`)
  assert.ok(result.actual_text_chars > 8000, 'Should measure actual chars')
})

test('T3: public_export_enabled=true → status=blocked, risks has public_export_requested', () => {
  const result = buildExportAbuseProtection({ public_export_enabled: true })
  assert.strictEqual(result.status, 'blocked')
  assert.ok(result.risks.includes('public_export_requested'), 'Expected public_export_requested risk')
})

test('T4: download_enabled=true → risks has download_requested, download_enabled_now=false', () => {
  const result   = buildExportAbuseProtection({ download_enabled: true })
  assert.ok(result.risks.includes('download_requested'), 'Expected download_requested risk')
  // download_enabled_now is on the preflight
  const preflight = buildInternalDownloadPreflight({ download_enabled: true })
  assert.strictEqual(preflight.download_enabled_now, false)
})

test('T5: webhook_enabled=true → webhook_blocked=true, risk webhook_requested', () => {
  const result = buildExportAbuseProtection({ webhook_enabled: true })
  assert.strictEqual(result.webhook_blocked, true)
  assert.ok(result.risks.includes('webhook_requested'), 'Expected webhook_requested risk')
})

test('T6: email_delivery_enabled=true → email_blocked=true', () => {
  const result = buildExportAbuseProtection({ email_delivery_enabled: true })
  assert.strictEqual(result.email_blocked, true)
  assert.ok(result.risks.includes('email_requested'), 'Expected email_requested risk')
})

test('T7: sensitive_fields_detected > 0 → risk sensitive_data_detected', () => {
  const result = buildExportAbuseProtection({
    redacted_operator_report: { sensitive_fields_detected: 2 },
  })
  assert.ok(result.risks.includes('sensitive_data_detected'), 'Expected sensitive_data_detected risk')
})

test('T8: internal download preflight → download_enabled_now=false, physical_file_created=false, public_url_created=false', () => {
  const result = buildInternalDownloadPreflight({})
  assert.strictEqual(result.download_enabled_now,  false)
  assert.strictEqual(result.physical_file_created, false)
  assert.strictEqual(result.public_url_created,    false)
  assert.ok(result.allowed_future_formats.includes('json'), 'json should be allowed future format')
  assert.ok(result.blocked_now.includes('pdf'),             'pdf should be blocked now')
})

test('T9: JSON.stringify(evaluateExportAbuseProtection({})) does not throw', () => {
  const result = evaluateExportAbuseProtection({})
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
