// src/services/adminPreviewUx.test.js
// P3.8.20 — 7 tests for Admin Preview UX Contract

import assert from 'assert'
import {
  buildAdminPreviewModes,
  buildAdminPreviewUxContract,
  buildAdminPreviewCards,
  buildAdminPreviewHealth,
  evaluateAdminPreviewUx,
} from './adminPreviewUx.js'

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

test('T1: modes → compact/detailed/text_only/json_only available=true, download available=false', () => {
  const modes = buildAdminPreviewModes({})
  assert.strictEqual(modes.compact.available,    true)
  assert.strictEqual(modes.detailed.available,   true)
  assert.strictEqual(modes.text_only.available,  true)
  assert.strictEqual(modes.json_only.available,  true)
  assert.strictEqual(modes.download.available,   false)
  assert.strictEqual(modes.compact.public,       false)
  assert.strictEqual(modes.download.public,      false)
})

test('T2: UX cards include required codes: no_sell_lock, micro_test_status, admin_access, redaction_status, download_preflight', () => {
  const contract = buildAdminPreviewUxContract({})
  const codes    = contract.cards.map(c => c.code)
  assert.ok(codes.includes('no_sell_lock'),       'Missing no_sell_lock card')
  assert.ok(codes.includes('micro_test_status'),  'Missing micro_test_status card')
  assert.ok(codes.includes('admin_access'),        'Missing admin_access card')
  assert.ok(codes.includes('redaction_status'),    'Missing redaction_status card')
  assert.ok(codes.includes('download_preflight'),  'Missing download_preflight card')
})

test('T3: UX contract public_share_allowed=false', () => {
  const contract = buildAdminPreviewUxContract({})
  assert.strictEqual(contract.public_share_allowed, false)
  assert.strictEqual(contract.status,               'ready')
})

test('T4: health healthy with safe inputs → status in [healthy, healthy_with_warnings], preview_ready=true, no_sell_enforced=true', () => {
  const health = buildAdminPreviewHealth({
    immutable_no_sell_enforcement: { status: 'enforced' },
    report_redaction_policy:       { redaction_enabled: true },
    admin_export_access_control:   { public_access_allowed: false },
  })
  const allowed = ['healthy', 'healthy_with_warnings']
  assert.ok(allowed.includes(health.status), `Expected healthy status, got "${health.status}"`)
  assert.strictEqual(health.preview_ready,    true)
  assert.strictEqual(health.no_sell_enforced, true)
  assert.strictEqual(health.public_share_allowed, false)
})

test('T5: health blocked when no-sell enforcement is critical_violation', () => {
  const health = buildAdminPreviewHealth({
    immutable_no_sell_enforcement: { status: 'critical_violation' },
  })
  const blocked = ['blocked', 'critical_violation']
  assert.ok(blocked.includes(health.status), `Expected blocked/critical status, got "${health.status}"`)
  assert.ok(health.blockers.length > 0, 'Expected blockers for critical violation')
})

test('T6: blocked_actions include download_now, share_publicly, enable_sell', () => {
  const contract = buildAdminPreviewUxContract({})
  const codes    = contract.blocked_actions.map(a => a.code)
  assert.ok(codes.includes('download_now'),    'Missing download_now in blocked_actions')
  assert.ok(codes.includes('share_publicly'),  'Missing share_publicly in blocked_actions')
  assert.ok(codes.includes('enable_sell'),     'Missing enable_sell in blocked_actions')
})

test('T7: JSON.stringify(evaluateAdminPreviewUx({})) does not throw', () => {
  const result = evaluateAdminPreviewUx({})
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
