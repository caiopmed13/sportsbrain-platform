// src/services/immutableNoSell.test.js
// P3.8.19 — 6 tests for Immutable No-Sell Enforcement

import assert from 'assert'
import {
  normalizeNoSellBoolean,
  sanitizeCommercialFlags,
  collectNoSellViolations,
  buildImmutableNoSellEnforcement,
  applyImmutableNoSellEnvelope,
} from './immutableNoSell.js'

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

test('T1: safe input (can_sell=false, can_beta=false) → status=enforced, violations_detected empty, flags=false', () => {
  const result = buildImmutableNoSellEnforcement({ can_sell: false, can_beta: false })
  assert.strictEqual(result.status,        'enforced')
  assert.strictEqual(result.can_sell,       false)
  assert.strictEqual(result.can_be_overridden, false)
  assert.strictEqual(result.immutable,      true)
  assert.strictEqual(result.violations_detected.length, 0)
})

test('T2: can_sell=true → output can_sell=false, violations contain can_sell, status=enforced_with_violations', () => {
  const result = buildImmutableNoSellEnforcement({ can_sell: true })
  assert.strictEqual(result.status,    'enforced_with_violations')
  assert.strictEqual(result.can_sell,   false)   // sanitized in output
  const violation = result.violations_detected.find(v => v.field === 'can_sell')
  assert.ok(violation, 'Expected can_sell violation')
  assert.ok(result.sanitized_fields.includes('can_sell'), 'Expected can_sell in sanitized_fields')
})

test('T3: checkout_enabled=true, pricing_enabled=true → output=false, violations registered', () => {
  const result = applyImmutableNoSellEnvelope({ checkout_enabled: true, pricing_enabled: true })
  assert.strictEqual(result.checkout_enabled, false)
  assert.strictEqual(result.pricing_enabled,  false)
  const enforcement = result.immutable_no_sell_enforcement
  assert.strictEqual(enforcement.checkout_enabled, false)
  assert.strictEqual(enforcement.pricing_enabled,  false)
  assert.ok(enforcement.violations_detected.length >= 2, 'Expected at least 2 violations')
})

test('T4: can_start_public_beta=true → output can_start_public_beta=false', () => {
  const sanitized = sanitizeCommercialFlags({ can_start_public_beta: true })
  assert.strictEqual(sanitized.can_start_public_beta, false)

  const violations = collectNoSellViolations({ can_start_public_beta: true })
  assert.ok(violations.some(v => v.field === 'can_start_public_beta'), 'Expected violation for can_start_public_beta')
})

test('T5: neutral fields preserved, all commercial flags forced to false', () => {
  const input = {
    resolved_valid:   42,
    score:            75,
    micro_test_active: true,   // non-commercial field — preserved
    can_sell:         false,
    can_beta:         false,
  }
  const result = applyImmutableNoSellEnvelope(input)
  // Neutral fields preserved
  assert.strictEqual(result.resolved_valid,    42)
  assert.strictEqual(result.score,             75)
  assert.strictEqual(result.micro_test_active, true)
  // Commercial flags forced false
  assert.strictEqual(result.can_sell,          false)
  assert.strictEqual(result.can_beta,          false)
  assert.strictEqual(result.checkout_enabled,  false)
  assert.strictEqual(result.pricing_enabled,   false)
  // No violations (all already false)
  assert.strictEqual(result.immutable_no_sell_enforcement.violations_detected.length, 0)
})

test('T6: JSON.stringify(applyImmutableNoSellEnvelope({})) does not throw', () => {
  const result = applyImmutableNoSellEnvelope({})
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
