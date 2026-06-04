// src/services/redactionRegressionLock.test.js
// P3.8.21 — 11 tests for Redaction Regression Lock

import assert from 'assert'
import {
  scanRenderedContentForLeaks,
  buildRedactionRegressionChecks,
  buildRedactionRegressionLock,
  evaluateRedactionRegressionLock,
} from './redactionRegressionLock.js'

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

function makeInput(content) {
  const safeContent = content ?? ''
  return {
    rendered_export_formats: {
      json: { content: JSON.stringify({ text: safeContent }), preview: '' },
      txt:  { content: safeContent, preview: '' },
      md:   { content: safeContent, preview: '' },
    },
    report_redaction_policy: { redaction_enabled: true },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('T1: clean input → status=locked, passed=true, failed_count=0', () => {
  const input  = makeInput('SportsBrain Internal Export\nDecision: continue_shadow\nSell: blocked')
  const result = buildRedactionRegressionLock(input)
  assert.strictEqual(result.status,       'locked')
  assert.strictEqual(result.passed,       true)
  assert.strictEqual(result.failed_count, 0)
})

test('T2: X-Admin-Key in content → fails no_admin_key_leak', () => {
  const input  = makeInput('X-Admin-Key: supersecretkey123')
  const result = buildRedactionRegressionLock(input)
  assert.ok(result.critical_failures.includes('no_admin_key_leak'), 'Expected no_admin_key_leak failure')
  assert.strictEqual(result.passed, false)
})

test('T3: Bearer token in content → fails no_bearer_token_leak', () => {
  const input  = makeInput('Authorization: Bearer abcdeftoken123456')
  const result = buildRedactionRegressionLock(input)
  assert.ok(
    result.critical_failures.includes('no_bearer_token_leak') ||
    result.critical_failures.includes('no_authorization_leak'),
    'Expected bearer_token_leak or authorization_leak failure'
  )
  assert.strictEqual(result.passed, false)
})

test('T4: email in content → fails no_email_leak', () => {
  const input  = makeInput('Contact admin@example.com for help')
  const result = buildRedactionRegressionLock(input)
  const failedCodes = result.checks.filter(c => !c.passed).map(c => c.code)
  assert.ok(failedCodes.includes('no_email_leak'), 'Expected no_email_leak failure')
  assert.strictEqual(result.passed, false)
})

test('T5: claim term in content → fails no_claim_terms', () => {
  const input  = makeInput('This system has guaranteed profit for operators')
  const result = buildRedactionRegressionLock(input)
  const failedCodes = result.checks.filter(c => !c.passed).map(c => c.code)
  assert.ok(failedCodes.includes('no_claim_terms'), 'Expected no_claim_terms failure')
  assert.strictEqual(result.passed, false)
})

test('T6: can_sell=true in rendered JSON → fails no_can_sell_true', () => {
  const input  = makeInput('"can_sell": true')
  const result = buildRedactionRegressionLock(input)
  const failedCodes = result.checks.filter(c => !c.passed).map(c => c.code)
  assert.ok(failedCodes.includes('no_can_sell_true'), 'Expected no_can_sell_true failure')
  assert.strictEqual(result.passed, false)
})

test('T7: can_beta=true in rendered content → fails no_can_beta_true', () => {
  const input  = makeInput('"can_beta": true')
  const result = buildRedactionRegressionLock(input)
  const failedCodes = result.checks.filter(c => !c.passed).map(c => c.code)
  assert.ok(failedCodes.includes('no_can_beta_true'), 'Expected no_can_beta_true failure')
  assert.strictEqual(result.passed, false)
})

test('T8: download_enabled=true in rendered content → fails no_download_enabled_true', () => {
  const input  = makeInput('"download_enabled": true')
  const result = buildRedactionRegressionLock(input)
  const failedCodes = result.checks.filter(c => !c.passed).map(c => c.code)
  assert.ok(failedCodes.includes('no_download_enabled_true'), 'Expected no_download_enabled_true failure')
  assert.strictEqual(result.passed, false)
})

test('T9: public URL in content → fails no_public_url', () => {
  const input  = makeInput('Download from https://public.example.com/downloads/report.pdf now')
  const result = buildRedactionRegressionLock(input)
  const failedCodes = result.checks.filter(c => !c.passed).map(c => c.code)
  assert.ok(failedCodes.includes('no_public_url'), 'Expected no_public_url failure')
  assert.strictEqual(result.passed, false)
})

test('T10: redaction_policy.redaction_enabled=false → fails redaction_policy_active', () => {
  const input = {
    rendered_export_formats: {
      json: { content: '{}', preview: '' },
      txt:  { content: 'safe text', preview: '' },
      md:   { content: '# Safe', preview: '' },
    },
    report_redaction_policy: { redaction_enabled: false },
  }
  const result = buildRedactionRegressionLock(input)
  assert.ok(result.critical_failures.includes('redaction_policy_active'), 'Expected redaction_policy_active failure')
  assert.strictEqual(result.passed, false)
})

test('T11: JSON.stringify(evaluateRedactionRegressionLock({})) does not throw', () => {
  const result = evaluateRedactionRegressionLock({})
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
