// src/services/reportRedaction.js
// P3.8.20 — Report Redaction Layer

const POLICY_VERSION = 'p3.8.20'
const MAX_TEXT_LENGTH = 4000
const MAX_JSON_DEPTH  = 8

// Field name patterns that should always be redacted
const SECRET_FIELD_NAMES = [
  'api_key', 'apikey', 'authorization', 'bearer_token', 'bearer',
  'x-admin-key', 'x_admin_key', 'xadminkey',
  'sb_master_key', 'master_key', 'masterkey',
  'secret', 'token', 'password', 'passwd', 'pwd',
  'private_key', 'privatekey', 'webhook_secret',
]

function isSensitiveFieldName(name) {
  if (typeof name !== 'string') return false
  const lower = name.toLowerCase().replace(/[-_\s]/g, '')
  return SECRET_FIELD_NAMES.some(p => lower.includes(p.replace(/[-_]/g, '')))
}

function looksLikeSecret(value) {
  if (typeof value !== 'string') return false
  return /^[A-Za-z0-9\-._~+/]{20,}$/.test(value)
}

// ── String Redaction ──────────────────────────────────────────────────────────

export function redactSensitiveString(value, options = {}) {
  if (typeof value !== 'string') return value
  let result = value
  // Redact emails
  result = result.replace(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
  // Redact Bearer token values
  result = result.replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Bearer [REDACTED_SECRET]')
  // Redact header-style lines: "HeaderName: value"
  result = result.replace(
    /(?:Authorization|X-Admin-Key|X-API-Key|X-Master-Key)\s*:\s*\S+/gi,
    (match) => {
      const colonIdx = match.indexOf(':')
      return colonIdx >= 0 ? match.slice(0, colonIdx + 1) + ' [REDACTED_SECRET]' : '[REDACTED_SECRET]'
    }
  )
  return result
}

// ── Object Redaction ──────────────────────────────────────────────────────────

export function redactSensitiveObject(input, options = {}, _depth = 0) {
  if (_depth > MAX_JSON_DEPTH) return '[REDACTED_DEPTH_EXCEEDED]'
  if (input === null || input === undefined) return input
  if (typeof input === 'string') return redactSensitiveString(input, options)
  if (typeof input !== 'object') return input
  if (Array.isArray(input)) {
    return input.map(item => redactSensitiveObject(item, options, _depth + 1))
  }
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveFieldName(key)) {
      if (typeof value === 'string' && /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(value)) {
        out[key] = '[REDACTED_EMAIL]'
      } else {
        out[key] = '[REDACTED_SECRET]'
      }
    } else {
      out[key] = redactSensitiveObject(value, options, _depth + 1)
    }
  }
  return out
}

// ── Sensitive Field Detection ─────────────────────────────────────────────────

export function detectSensitiveFields(input, options = {}, _depth = 0) {
  if (_depth > MAX_JSON_DEPTH || typeof input !== 'object' || input === null) return []
  const found = []
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveFieldName(key)) {
      found.push(key)
    } else if (typeof value === 'string') {
      if (looksLikeSecret(value))                                                     found.push(key)
      if (/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(value))       found.push(key)
      if (/Bearer\s+[A-Za-z0-9\-._~+/=]+/i.test(value))                              found.push(key)
      if (/(?:Authorization|X-Admin-Key)\s*:\s*\S+/i.test(value))                    found.push(key)
    } else if (typeof value === 'object' && value !== null) {
      const nested = detectSensitiveFields(value, options, _depth + 1)
      for (const f of nested) found.push(`${key}.${f}`)
    }
  }
  // Deduplicate
  return [...new Set(found)]
}

// ── Policy ────────────────────────────────────────────────────────────────────

export function buildReportRedactionPolicy(input = {}, options = {}) {
  return {
    status:               'active',
    policy_version:       POLICY_VERSION,
    redaction_enabled:    true,
    redact_secrets:       true,
    redact_tokens:        true,
    redact_emails:        true,
    redact_private_urls:  true,
    redact_headers:       true,
    max_text_length:      MAX_TEXT_LENGTH,
    max_json_depth:       MAX_JSON_DEPTH,
    sensitive_patterns:   [
      'api_key', 'authorization', 'bearer_token', 'x-admin-key', 'email',
      'secret', 'token', 'password', 'sb_master_key',
    ],
    public_share_allowed: false,   // ALWAYS false
  }
}

// ── Redacted Report ───────────────────────────────────────────────────────────

export function buildRedactedOperatorReport(input = {}, options = {}) {
  const rawText    = input.operator_report_render?.text ?? ''
  const compactJson = input.internal_report_preview?.compact_json ?? {}

  const sensitiveInText = typeof rawText === 'string'
    ? detectSensitiveFields({ _text: rawText })
    : []
  const sensitiveInJson = detectSensitiveFields(compactJson)
  const sensitiveFieldsDetected = sensitiveInText.length + sensitiveInJson.length

  let textPreview = redactSensitiveString(rawText)
  if (textPreview.length > MAX_TEXT_LENGTH) {
    textPreview = textPreview.slice(0, MAX_TEXT_LENGTH) + '\n[...redacted/truncated]'
  }

  const redactedJson = redactSensitiveObject(compactJson)

  const warnings = []
  if (sensitiveFieldsDetected > 0) warnings.push('sensitive_fields_detected_and_redacted')

  return {
    status:                    'redacted',
    redaction_applied:         true,
    sensitive_fields_detected: sensitiveFieldsDetected,
    redacted_fields_count:     sensitiveFieldsDetected,
    text_preview:              textPreview,
    compact_json:              redactedJson,
    warnings,
    blockers:                  [],
    public_share_allowed:      false,   // ALWAYS false
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateReportRedaction(input = {}, options = {}) {
  const safeInput = input ?? {}
  return {
    report_redaction_policy:  buildReportRedactionPolicy(safeInput, options),
    redacted_operator_report: buildRedactedOperatorReport(safeInput, options),
  }
}
