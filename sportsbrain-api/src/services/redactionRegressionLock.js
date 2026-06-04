// src/services/redactionRegressionLock.js
// P3.8.21 — Redaction Regression Lock

const LOCK_VERSION = 'p3.8.21'

const CLAIM_TERMS = [
  'lucro garantido', 'roi garantido', 'pronto para vender', 'assertividade garantida',
  'edge comprovado', 'renda garantida', 'garantia de lucro',
  'validated for sale', 'ready to sell', 'guaranteed profit',
  'guaranteed roi', 'guaranteed return', 'rendimento garantido',
]

// ── Content Scanner ───────────────────────────────────────────────────────────

export function scanRenderedContentForLeaks(input = {}, options = {}) {
  const formats  = input.rendered_export_formats ?? {}
  const contents = [
    formats.json?.content ?? formats.json?.preview ?? '',
    formats.txt?.content  ?? formats.txt?.preview  ?? '',
    formats.md?.content   ?? formats.md?.preview   ?? '',
  ].filter(Boolean)
  const combined = contents.join('\n')

  return {
    has_admin_key_leak:    /X-Admin-Key\s*:\s*\S+/i.test(combined),
    has_authorization_leak: /Authorization\s*:\s*(?!Bearer \[REDACTED)/i.test(combined) && /Authorization\s*:/i.test(combined)
      ? /Authorization\s*:\s*(?!\[REDACTED)/.test(combined)
      : false,
    has_bearer_token_leak: /Bearer\s+(?!\[REDACTED)[A-Za-z0-9\-._~+/=]{6,}/i.test(combined),
    has_email_leak:        /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(combined),
    has_secret_key_leak:   /(?:api_key|secret|password)\s*[=:]\s*\S{8,}/i.test(combined),
    has_claim_terms:       CLAIM_TERMS.some(t => combined.toLowerCase().includes(t)),
    has_can_sell_true:     /"can_sell"\s*:\s*true/i.test(combined),
    has_can_beta_true:     /"can_beta"\s*:\s*true/i.test(combined),
    has_download_enabled:  /"download_enabled"\s*:\s*true/i.test(combined),
    has_public_url:        /https?:\/\/(?!localhost)[^\s"']{20,}/i.test(combined),
    combined_length:       combined.length,
  }
}

// ── Checks Builder ────────────────────────────────────────────────────────────

export function buildRedactionRegressionChecks(input = {}, options = {}) {
  const scan  = scanRenderedContentForLeaks(input, options)
  const rdpOk = input.report_redaction_policy?.redaction_enabled !== false

  const jsonContent = input.rendered_export_formats?.json?.content ?? ''
  const txtContent  = input.rendered_export_formats?.txt?.content  ?? ''
  const mdContent   = input.rendered_export_formats?.md?.content   ?? ''

  const jsonSafe = typeof jsonContent === 'string' &&
    (jsonContent.length === 0 || (() => { try { JSON.parse(jsonContent); return true } catch { return false } })())
  const txtSafe  = typeof txtContent === 'string'
  const mdSafe   = typeof mdContent  === 'string'

  const checks = [
    { code: 'no_admin_key_leak',       passed: !scan.has_admin_key_leak,       severity: 'critical' },
    { code: 'no_authorization_leak',   passed: !scan.has_authorization_leak,   severity: 'critical' },
    { code: 'no_bearer_token_leak',    passed: !scan.has_bearer_token_leak,    severity: 'critical' },
    { code: 'no_email_leak',           passed: !scan.has_email_leak,           severity: 'blocker'  },
    { code: 'no_secret_key_leak',      passed: !scan.has_secret_key_leak,      severity: 'critical' },
    { code: 'no_claim_terms',          passed: !scan.has_claim_terms,          severity: 'blocker'  },
    { code: 'no_can_sell_true',        passed: !scan.has_can_sell_true,        severity: 'critical' },
    { code: 'no_can_beta_true',        passed: !scan.has_can_beta_true,        severity: 'critical' },
    { code: 'no_download_enabled_true', passed: !scan.has_download_enabled,   severity: 'critical' },
    { code: 'no_public_url',           passed: !scan.has_public_url,           severity: 'blocker'  },
    { code: 'json_format_safe',        passed: jsonSafe,                        severity: 'blocker'  },
    { code: 'txt_format_safe',         passed: txtSafe,                         severity: 'info'     },
    { code: 'md_format_safe',          passed: mdSafe,                          severity: 'info'     },
    { code: 'redaction_policy_active', passed: rdpOk,                           severity: 'critical' },
  ]

  return checks
}

// ── Lock Builder ──────────────────────────────────────────────────────────────

export function buildRedactionRegressionLock(input = {}, options = {}) {
  const checks         = buildRedactionRegressionChecks(input, options)
  const failedChecks   = checks.filter(c => !c.passed)
  const criticalFailed = failedChecks.filter(c => c.severity === 'critical')
  const passed         = failedChecks.length === 0

  return {
    status:            passed ? 'locked' : 'failed',
    passed,
    lock_version:      LOCK_VERSION,
    checks_count:      checks.length,
    failed_count:      failedChecks.length,
    critical_failures: criticalFailed.map(c => c.code),
    checks,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateRedactionRegressionLock(input = {}, options = {}) {
  const safeInput = input ?? {}
  return {
    redaction_regression_lock: buildRedactionRegressionLock(safeInput, options),
  }
}
