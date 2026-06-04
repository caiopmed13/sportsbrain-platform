// src/services/immutableNoSell.js
// P3.8.19 — Immutable No-Sell Enforcement
// Centralised layer that forces all commercial flags to false, regardless of input.

const ENFORCEMENT_VERSION = 'p3.8.19'

// All flags that must ALWAYS remain false
const COMMERCIAL_FLAGS = [
  'can_beta',
  'can_sell',
  'can_start_private_beta',
  'can_start_public_beta',
  'safe_to_invite_private_users',
  'safe_to_open_public_beta',
  'safe_to_sell',
  'release_allowed',
  'sell_allowed',
  'checkout_enabled',
  'pricing_enabled',
  'commercial_claims_allowed',
]

const HARD_LOCKS = ['sell_lock', 'checkout_lock', 'pricing_lock', 'public_beta_lock']

// ── Helpers ────────────────────────────────────────────────────────────────────

export function normalizeNoSellBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  return false
}

// ── Sanitize ──────────────────────────────────────────────────────────────────

export function sanitizeCommercialFlags(input = {}, options = {}) {
  const sanitized = { ...input }
  for (const flag of COMMERCIAL_FLAGS) {
    sanitized[flag] = false   // ALWAYS force to false
  }
  return sanitized
}

// ── Collect Violations ────────────────────────────────────────────────────────

export function collectNoSellViolations(input = {}, options = {}) {
  return COMMERCIAL_FLAGS
    .filter(f => normalizeNoSellBoolean(input[f]))
    .map(f => ({
      field:        f,
      value:        true,
      severity:     'blocker',
      sanitized_to: false,
      message:      `Field ${f}=true violates immutable no-sell invariant`,
    }))
}

// ── Enforcement Block ─────────────────────────────────────────────────────────

export function buildImmutableNoSellEnforcement(input = {}, options = {}) {
  const violations = collectNoSellViolations(input, options)
  const hasViolations = violations.length > 0

  let status
  if (violations.some(v => ['can_sell', 'checkout_enabled', 'pricing_enabled'].includes(v.field))) {
    status = 'enforced_with_violations'
  } else if (hasViolations) {
    status = 'enforced_with_violations'
  } else {
    status = 'enforced'
  }

  return {
    status,
    enforcement_version:   ENFORCEMENT_VERSION,
    immutable:             true,
    can_be_overridden:     false,
    sell_allowed:          false,   // ALWAYS false
    can_sell:              false,   // ALWAYS false
    checkout_enabled:      false,   // ALWAYS false
    pricing_enabled:       false,   // ALWAYS false
    violations_detected:   violations,
    sanitized_fields:      violations.map(v => v.field),
    hard_locks:            HARD_LOCKS,
  }
}

// ── Envelope ──────────────────────────────────────────────────────────────────

export function applyImmutableNoSellEnvelope(payload = {}, options = {}) {
  const enforcement = buildImmutableNoSellEnforcement(payload, options)
  const sanitized   = sanitizeCommercialFlags(payload, options)
  return {
    ...sanitized,
    immutable_no_sell_enforcement: enforcement,
  }
}
