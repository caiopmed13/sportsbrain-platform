// src/services/reportRedaction.test.js
// P3.8.20 — 8 tests for Report Redaction Layer

import assert from 'assert'
import {
  redactSensitiveString,
  redactSensitiveObject,
  detectSensitiveFields,
  buildReportRedactionPolicy,
  buildRedactedOperatorReport,
  evaluateReportRedaction,
} from './reportRedaction.js'

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

test('T1: clean string → no secret redaction applied', () => {
  const result = redactSensitiveString('SportsBrain Operator Review Report\nDecision: continue_shadow')
  assert.ok(!result.includes('[REDACTED_SECRET]'), 'Should not redact clean text')
  assert.ok(!result.includes('[REDACTED_EMAIL]'),  'Should not redact clean text')
  assert.ok(result.includes('continue_shadow'),    'Should preserve non-sensitive content')
})

test('T2: string with X-Admin-Key header → [REDACTED_SECRET]', () => {
  const result = redactSensitiveString('X-Admin-Key: abc123secret')
  assert.ok(result.includes('[REDACTED_SECRET]'), 'Expected [REDACTED_SECRET]')
  assert.ok(!result.includes('abc123secret'),     'Should not expose key value')
})

test('T3: string with Authorization Bearer → [REDACTED_SECRET]', () => {
  const result = redactSensitiveString('Authorization: Bearer token123longvalue')
  assert.ok(result.includes('[REDACTED_SECRET]'), 'Expected [REDACTED_SECRET]')
  assert.ok(!result.includes('token123'),         'Should not expose token')
})

test('T4: string with email → [REDACTED_EMAIL]', () => {
  const result = redactSensitiveString('Contact: user@example.com for support')
  assert.ok(result.includes('[REDACTED_EMAIL]'),      'Expected [REDACTED_EMAIL]')
  assert.ok(!result.includes('user@example.com'),     'Should not expose email')
  assert.ok(result.includes('Contact:'),              'Should preserve non-sensitive content')
})

test('T5: nested object with authorization field → redacted', () => {
  const input  = { headers: { authorization: 'Bearer mytoken123' }, safe_field: 'value' }
  const result = redactSensitiveObject(input)
  assert.ok(result.headers.authorization !== 'Bearer mytoken123', 'authorization should be redacted')
  assert.ok(
    result.headers.authorization === '[REDACTED_SECRET]' ||
    String(result.headers.authorization).includes('REDACTED'),
    'Expected REDACTED marker'
  )
  assert.strictEqual(result.safe_field, 'value', 'Safe fields should be preserved')
})

test('T6: policy active by default → redaction_enabled=true, public_share_allowed=false', () => {
  const policy = buildReportRedactionPolicy({})
  assert.strictEqual(policy.redaction_enabled,    true)
  assert.strictEqual(policy.public_share_allowed, false)
  assert.strictEqual(policy.redact_secrets,        true)
  assert.strictEqual(policy.redact_emails,         true)
  assert.ok(policy.sensitive_patterns.length > 0, 'Expected sensitive_patterns')
})

test('T7: report with secret/token/email → redacted_fields_count > 0, status=redacted', () => {
  const result = buildRedactedOperatorReport({
    operator_report_render: {
      text: 'Authorization: Bearer supersecrettoken123\nContact: admin@company.com',
    },
    internal_report_preview: {
      compact_json: { can_beta: false, can_sell: false },
    },
  })
  assert.strictEqual(result.status,              'redacted')
  assert.strictEqual(result.public_share_allowed, false)
  // The text_preview should have redacted the email/bearer
  assert.ok(!result.text_preview.includes('supersecrettoken123'), 'token should be redacted in preview')
  assert.ok(!result.text_preview.includes('admin@company.com'),   'email should be redacted in preview')
})

test('T8: JSON.stringify(evaluateReportRedaction({})) does not throw', () => {
  const result = evaluateReportRedaction({})
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
