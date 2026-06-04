// src/services/adminDownloadDryRun.test.js
// P3.8.21 — 8 tests for Admin Download Dry-Run

import assert from 'assert'
import {
  normalizeDownloadFormat,
  buildDownloadResponseContract,
  buildAdminDownloadDryRun,
  buildDownloadDryRunAudit,
  evaluateAdminDownloadDryRun,
} from './adminDownloadDryRun.js'

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

test('T1: dry-run json → selected_format=json, content_type=application/json, can_download_now=false, physical_file_created=false', () => {
  const result = buildAdminDownloadDryRun({ format: 'json' })
  assert.strictEqual(result.status,                'simulated')
  assert.strictEqual(result.selected_format,       'json')
  assert.strictEqual(result.content_type,          'application/json')
  assert.strictEqual(result.can_download_now,      false)
  assert.strictEqual(result.physical_file_created, false)
  assert.strictEqual(result.download_enabled,      false)
})

test('T2: dry-run txt → content_type=text/plain, filename ends .txt', () => {
  const result = buildAdminDownloadDryRun({ format: 'txt' })
  assert.strictEqual(result.content_type, 'text/plain')
  assert.ok(result.filename?.endsWith('.txt'), `Expected filename to end .txt, got "${result.filename}"`)
})

test('T3: dry-run md → content_type=text/markdown, filename ends .md', () => {
  const result = buildAdminDownloadDryRun({ format: 'md' })
  assert.strictEqual(result.content_type, 'text/markdown')
  assert.ok(result.filename?.endsWith('.md'), `Expected filename to end .md, got "${result.filename}"`)
})

test('T4: format=pdf → status=invalid_format or blocked, can_download_now=false', () => {
  const result = buildAdminDownloadDryRun({ format: 'pdf' })
  const allowed = ['invalid_format', 'blocked']
  assert.ok(allowed.includes(result.status), `Expected blocked status, got "${result.status}"`)
  assert.strictEqual(result.can_download_now, false)
  assert.ok(result.blockers.length > 0, 'Expected blockers for invalid format')
})

test('T5: download contract → download_enabled_now=false, future_internal_download_possible=true, requires_admin_key=true', () => {
  const contract = buildDownloadResponseContract({})
  assert.strictEqual(contract.download_enabled_now,              false)
  assert.strictEqual(contract.future_internal_download_possible, true)
  assert.strictEqual(contract.requires_admin_key,                true)
  assert.strictEqual(contract.physical_file_created,             false)
  assert.ok(contract.allowed_formats.includes('json'), 'json should be allowed')
  assert.ok(contract.blocked_formats.includes('pdf'),  'pdf should be blocked')
})

test('T6: audit entries include redaction_checked, download_disabled_confirmed, physical_file_not_created', () => {
  const audit = buildDownloadDryRunAudit({})
  const codes = audit.entries.map(e => e.code)
  assert.ok(codes.includes('redaction_checked'),            'Missing redaction_checked')
  assert.ok(codes.includes('download_disabled_confirmed'),  'Missing download_disabled_confirmed')
  assert.ok(codes.includes('physical_file_not_created'),    'Missing physical_file_not_created')
})

test('T7: input download_enabled=true → output download_enabled=false, warning registered', () => {
  const result = buildAdminDownloadDryRun({ format: 'json', download_enabled: true })
  assert.strictEqual(result.download_enabled, false)
  assert.ok(result.warnings.length > 0, 'Expected warning for unsafe input sanitized')
})

test('T8: JSON.stringify(evaluateAdminDownloadDryRun({})) does not throw', () => {
  const result = evaluateAdminDownloadDryRun({})
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
