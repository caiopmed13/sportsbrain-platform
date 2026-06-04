// src/services/exportAbuseProtection.js
// P3.8.20 — Export Abuse Protection

const PREFLIGHT_VERSION = 'p3.8.20'

const LIMITS = {
  MAX_TEXT_CHARS:  8000,
  MAX_JSON_CHARS:  25000,
  MAX_SECTIONS:    30,
  MAX_LINES:       300,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeAbuseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

// ── Payload Measurement ───────────────────────────────────────────────────────

export function measurePreviewPayload(input = {}, options = {}) {
  const text     = input.operator_report_render?.text ?? input.text_preview ?? ''
  const jsonStr  = JSON.stringify(input.compact_json ?? input.evidence_export_packet ?? {})
  const sections = input.evidence_export_packet?.sections ?? []
  const textStr  = typeof text === 'string' ? text : ''
  const lines    = textStr.length > 0 ? textStr.split('\n').length : 0

  return {
    text_chars:  textStr.length,
    json_chars:  jsonStr.length,
    sections:    Array.isArray(sections) ? sections.length : 0,
    lines,
  }
}

// ── Risk Detection ────────────────────────────────────────────────────────────

export function detectExportAbuseRisks(input = {}, options = {}) {
  const risks = []

  if (normalizeAbuseBoolean(input.public_export_enabled))        risks.push('public_export_requested')
  if (normalizeAbuseBoolean(input.download_enabled))             risks.push('download_requested')
  if (normalizeAbuseBoolean(input.download_publicly_available))  risks.push('download_requested')
  if (normalizeAbuseBoolean(input.webhook_enabled))              risks.push('webhook_requested')
  if (normalizeAbuseBoolean(input.email_delivery_enabled))       risks.push('email_requested')
  if (normalizeAbuseBoolean(input.physical_file_created))        risks.push('physical_file_requested')
  if (normalizeAbuseBoolean(input.bulk_export_enabled))          risks.push('bulk_export_requested')

  const measures = measurePreviewPayload(input, options)
  if (
    measures.text_chars > LIMITS.MAX_TEXT_CHARS ||
    measures.json_chars > LIMITS.MAX_JSON_CHARS ||
    measures.sections   > LIMITS.MAX_SECTIONS   ||
    measures.lines      > LIMITS.MAX_LINES
  ) {
    risks.push('payload_too_large')
  }

  const sensitiveCount =
    input.redacted_operator_report?.sensitive_fields_detected ??
    input.report_redaction?.sensitive_fields_detected ?? 0
  if (sensitiveCount > 0) risks.push('sensitive_data_detected')

  if (input.commercial_claims_guard?.claims_detected === true) risks.push('claims_detected')

  return [...new Set(risks)]
}

// ── Payload Limits ────────────────────────────────────────────────────────────

export function buildPreviewPayloadLimits(input = {}, options = {}) {
  const measures   = measurePreviewPayload(input, options)
  const overText   = measures.text_chars > LIMITS.MAX_TEXT_CHARS
  const overJson   = measures.json_chars > LIMITS.MAX_JSON_CHARS
  const overSec    = measures.sections   > LIMITS.MAX_SECTIONS
  const overLines  = measures.lines      > LIMITS.MAX_LINES
  const overAny    = overText || overJson || overSec || overLines
  const nearLimit  = measures.text_chars > LIMITS.MAX_TEXT_CHARS * 0.9 && !overText

  let status = 'within_limits'
  const warnings = []
  const blockers = []

  if (overAny) {
    status = 'over_limit'
    blockers.push('payload_exceeds_limits')
  } else if (nearLimit) {
    status = 'truncated'
    warnings.push('text_near_limit')
  }

  return {
    status,
    max_text_chars:    LIMITS.MAX_TEXT_CHARS,
    max_json_chars:    LIMITS.MAX_JSON_CHARS,
    max_sections:      LIMITS.MAX_SECTIONS,
    max_lines:         LIMITS.MAX_LINES,
    actual_text_chars: measures.text_chars,
    actual_json_chars: measures.json_chars,
    actual_sections:   measures.sections,
    actual_lines:      measures.lines,
    truncated:         nearLimit || overText,
    warnings,
    blockers,
  }
}

// ── Abuse Protection ──────────────────────────────────────────────────────────

export function buildExportAbuseProtection(input = {}, options = {}) {
  const risks = detectExportAbuseRisks(input, options)

  const BLOCKER_RISKS = [
    'public_export_requested', 'download_requested', 'physical_file_requested',
    'webhook_requested', 'email_requested', 'bulk_export_requested',
  ]
  const hasBlocker = risks.some(r => BLOCKER_RISKS.includes(r))
  const status = hasBlocker ? 'blocked' : 'protected'

  const warnings = []
  const blockers = []
  if (risks.includes('sensitive_data_detected'))  warnings.push('sensitive_data_in_payload')
  if (risks.includes('claims_detected'))           warnings.push('commercial_claims_in_payload')
  if (risks.includes('payload_too_large'))         warnings.push('payload_exceeds_limits')
  if (hasBlocker)                                  blockers.push('blocked_export_attempt_detected')

  return {
    status,
    abuse_protection_enabled:  true,
    public_export_blocked:     true,   // ALWAYS true
    bulk_export_blocked:       true,   // ALWAYS true
    webhook_blocked:           true,   // ALWAYS true
    email_blocked:             true,   // ALWAYS true
    physical_file_blocked:     true,   // ALWAYS true
    rate_limit_recommended:    true,
    risks,
    blockers,
    warnings,
  }
}

// ── Internal Download Preflight ───────────────────────────────────────────────

export function buildInternalDownloadPreflight(input = {}, options = {}) {
  const claimsClean    = input.commercial_claims_guard?.claims_detected !== true
  const lockdownPassed = input.regression_lockdown?.passed === true
  const noSellOk       = input.immutable_no_sell_enforcement?.status !== 'critical_violation'
  const preflightReady = claimsClean && lockdownPassed && noSellOk

  return {
    status:                       preflightReady ? 'preflight_ready' : 'not_enabled',
    preflight_version:            PREFLIGHT_VERSION,
    download_enabled_now:         false,   // ALWAYS false
    future_internal_download_possible: true,
    requires_admin_key:           true,
    requires_redaction:           true,
    requires_claims_clean:        true,
    requires_lockdown_passed:     true,
    requires_no_sell_enforcement: true,
    physical_file_created:        false,   // ALWAYS false
    public_url_created:           false,   // ALWAYS false
    allowed_future_formats:       ['json', 'txt', 'md'],
    blocked_now:                  ['pdf', 'public_url', 'email', 'webhook'],
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateExportAbuseProtection(input = {}, options = {}) {
  const safeInput = input ?? {}
  return {
    preview_payload_limits:      buildPreviewPayloadLimits(safeInput, options),
    export_abuse_protection:     buildExportAbuseProtection(safeInput, options),
    internal_download_preflight: buildInternalDownloadPreflight(safeInput, options),
  }
}
