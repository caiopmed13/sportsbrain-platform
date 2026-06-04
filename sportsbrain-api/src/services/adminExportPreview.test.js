// src/services/adminExportPreview.test.js
// P3.8.19 — 10 tests for Admin Export Preview

import assert from 'assert'
import {
  buildAdminExportAccessControl,
  buildProtectedExportRouteContract,
  buildInternalReportPreview,
  buildAdminExportAudit,
  buildAdminPreviewSummary,
  evaluateAdminExportPreview,
} from './adminExportPreview.js'

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

test('T1: no admin key → authorized=false, status in [denied, protected]', () => {
  const result = evaluateAdminExportPreview({ admin_key_present: false })
  const ac     = result.admin_export_access_control
  assert.strictEqual(ac.authorized,            false)
  const allowed = ['denied', 'protected', 'misconfigured']
  assert.ok(allowed.includes(ac.status),
    `Expected status in ${JSON.stringify(allowed)}, got "${ac.status}"`)
  assert.strictEqual(ac.public_access_allowed, false)
  assert.strictEqual(ac.requires_admin_key,    true)
})

test('T2: admin_key_present=true, admin_key_valid=true → authorized=true, status=authorized', () => {
  const result = evaluateAdminExportPreview({ admin_key_present: true, admin_key_valid: true })
  const ac     = result.admin_export_access_control
  assert.strictEqual(ac.authorized, true)
  assert.strictEqual(ac.status,     'authorized')
})

test('T3: route contract → requires_admin_key=true, public=false, download_enabled=false, physical_file_created=false', () => {
  const result = evaluateAdminExportPreview({})
  const rc     = result.protected_export_route_contract
  assert.strictEqual(rc.requires_admin_key,    true)
  assert.strictEqual(rc.public,                false)
  assert.strictEqual(rc.download_enabled,      false)
  assert.strictEqual(rc.physical_file_created, false)
  assert.ok(rc.allowed_formats.includes('json'),         'Missing json format')
  assert.ok(rc.blocked_formats.includes('pdf'),          'Missing pdf in blocked')
  assert.ok(rc.blocked_formats.includes('email'),        'Missing email in blocked')
})

test('T4: with operator_report_render.text → internal_report_preview.status=ready, text_preview present, public_share_allowed=false', () => {
  const result  = evaluateAdminExportPreview({
    operator_report_render: {
      text: 'SportsBrain Operator Review Report\nGenerated: 2026-05-14\nDecision: continue_shadow',
      status: 'rendered',
    },
    decision_fingerprint: { value: 'sb-p3.8.17-aabbccdd' },
  })
  const preview = result.internal_report_preview
  assert.strictEqual(preview.status,              'ready')
  assert.ok(preview.text_preview.length > 0,      'Expected non-empty text_preview')
  assert.strictEqual(preview.public_share_allowed, false)
  assert.ok(preview.compact_json,                 'Expected compact_json')
  assert.strictEqual(preview.compact_json.can_beta, false)
  assert.strictEqual(preview.compact_json.can_sell, false)
})

test('T5: no auth → summary preview_available=false, safe_for_public_share=false, safe_to_sell=false', () => {
  const result  = evaluateAdminExportPreview({ admin_key_present: false })
  const summary = result.admin_preview_summary
  assert.strictEqual(summary.preview_available,    false)
  assert.strictEqual(summary.safe_for_public_share, false)
  assert.strictEqual(summary.safe_to_sell,          false)
})

test('T6: authorized → summary preview_available=true, safe_to_sell=false', () => {
  const result  = evaluateAdminExportPreview({ admin_key_present: true, admin_key_valid: true })
  const summary = result.admin_preview_summary
  assert.strictEqual(summary.preview_available, true)
  assert.strictEqual(summary.safe_to_sell,       false)   // ALWAYS false
})

test('T7: audit contains required entries: access_control_checked, no_sell_enforced, public_access_blocked_confirmed', () => {
  const result = evaluateAdminExportPreview({})
  const audit  = result.admin_export_audit
  const codes  = audit.entries.map(e => e.code)
  assert.ok(codes.includes('access_control_checked'),         'Missing access_control_checked')
  assert.ok(codes.includes('no_sell_enforced'),               'Missing no_sell_enforced')
  assert.ok(codes.includes('public_access_blocked_confirmed'), 'Missing public_access_blocked_confirmed')
  assert.strictEqual(audit.simulation_only, true)
  assert.strictEqual(audit.entries_count,   audit.entries.length)
})

test('T8: commercial_claims_guard.status=blocked → warnings/blockers registered, safe_for_public_share=false', () => {
  const result  = evaluateAdminExportPreview({
    commercial_claims_guard: { status: 'blocked', claims_detected: true },
  })
  const summary = result.admin_preview_summary
  const preview = result.internal_report_preview
  assert.strictEqual(summary.safe_for_public_share, false)
  // At least one of summary or preview should register the warning
  const hasWarning = summary.warnings.length > 0 || preview.warnings.length > 0
  assert.ok(hasWarning, 'Expected warnings for claims guard blocked')
})

test('T9: can_sell=true → output can_sell=false, immutable_no_sell_enforcement has violations', () => {
  const result      = evaluateAdminExportPreview({ can_sell: true })
  const enforcement = result.immutable_no_sell_enforcement
  // Violations detected on raw input
  assert.ok(enforcement.violations_detected.length > 0, 'Expected violations for can_sell=true')
  assert.strictEqual(enforcement.can_sell, false)
  // Summary should still have safe_to_sell=false
  assert.strictEqual(result.admin_preview_summary.safe_to_sell, false)
})

test('T10: JSON.stringify(evaluateAdminExportPreview({})) does not throw', () => {
  const result = evaluateAdminExportPreview({})
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
