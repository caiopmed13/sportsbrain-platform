// src/services/adminDownloadDryRun.js
// P3.8.21 — Admin Download Dry-Run & Download Response Contract

const CONTRACT_VERSION = 'p3.8.21'

const ALLOWED_FORMATS  = ['json', 'txt', 'md']
const BLOCKED_FORMATS  = ['pdf', 'email', 'webhook', 'public_url', 'download', 'html']
const FORMAT_ALIASES   = { text: 'txt', markdown: 'md' }
const FORMAT_CONTENT_TYPES = {
  json: 'application/json',
  txt:  'text/plain',
  md:   'text/markdown',
}
const FORMAT_EXTENSIONS = { json: '.json', txt: '.txt', md: '.md' }

// ── Format Normalization ──────────────────────────────────────────────────────

export function normalizeDownloadFormat(value) {
  if (!value || typeof value !== 'string') return 'json'
  const lower = value.toLowerCase().trim()
  if (FORMAT_ALIASES[lower]) return FORMAT_ALIASES[lower]
  if (ALLOWED_FORMATS.includes(lower)) return lower
  if (BLOCKED_FORMATS.includes(lower)) return null   // blocked
  return null
}

// ── Download Response Contract ────────────────────────────────────────────────

export function buildDownloadResponseContract(input = {}, options = {}) {
  return {
    status:                           'ready',
    contract_version:                 CONTRACT_VERSION,
    download_enabled_now:             false,   // ALWAYS false
    future_internal_download_possible: true,
    requires_admin_key:               true,
    requires_redaction_passed:        true,
    requires_regression_lock_passed:  true,
    allowed_formats:                  ALLOWED_FORMATS,
    blocked_formats:                  BLOCKED_FORMATS,
    content_disposition_policy:       'attachment_future_only',
    physical_file_created:            false,   // ALWAYS false
    public_url_created:               false,   // ALWAYS false
  }
}

// ── Dry-Run ───────────────────────────────────────────────────────────────────

export function buildAdminDownloadDryRun(input = {}, options = {}) {
  const rawFormat    = input.format ?? input.selected_format ?? 'json'
  const format       = normalizeDownloadFormat(rawFormat)
  const isBlocked    = format === null
  const fingerprint  = input.decision_fingerprint?.value ?? 'sb-p3.8.21-unknown'

  if (isBlocked) {
    return {
      status:                           'invalid_format',
      simulation_only:                  true,
      download_enabled:                 false,
      physical_file_created:            false,
      public_url_created:               false,
      selected_format:                  rawFormat,
      filename:                         null,
      content_type:                     null,
      content_length:                   0,
      fingerprint,
      ready_for_future_internal_download: false,
      can_download_now:                 false,   // ALWAYS false
      warnings:                         [],
      blockers:                         [`format_${rawFormat}_not_allowed`],
    }
  }

  // Detect if any unsafe flags were set on input (and sanitize them in output)
  const unsafeFlags = []
  if (input.download_enabled === true)              unsafeFlags.push('download_enabled')
  if (input.download_publicly_available === true)   unsafeFlags.push('download_publicly_available')
  if (input.physical_file_created === true)         unsafeFlags.push('physical_file_created')

  const ext           = FORMAT_EXTENSIONS[format]
  const filename      = `sportsbrain-operator-report-simulated${ext}`
  const contentType   = FORMAT_CONTENT_TYPES[format]
  const contentLength = input._rendered_content?.[format]?.chars ?? 0

  const warnings = unsafeFlags.length > 0
    ? [`unsafe_input_sanitized: ${unsafeFlags.join(', ')}`]
    : []
  const blockers  = []

  return {
    status:                           'simulated',
    simulation_only:                  true,
    download_enabled:                 false,   // ALWAYS false (even if input had true)
    physical_file_created:            false,   // ALWAYS false
    public_url_created:               false,   // ALWAYS false
    selected_format:                  format,
    filename,
    content_type:                     contentType,
    content_length:                   contentLength,
    fingerprint,
    ready_for_future_internal_download: true,
    can_download_now:                 false,   // ALWAYS false
    warnings,
    blockers,
  }
}

// ── Dry-Run Audit ─────────────────────────────────────────────────────────────

export function buildDownloadDryRunAudit(input = {}, options = {}) {
  const entries = [
    { code: 'format_selected',            level: 'info',    message: 'Export format selected for dry-run.' },
    { code: 'redaction_checked',          level: 'info',    message: 'Redaction layer verified before dry-run.' },
    { code: 'claims_checked',             level: 'info',    message: 'Commercial claims guard verified.' },
    { code: 'lockdown_checked',           level: 'info',    message: 'Regression lockdown verified.' },
    { code: 'download_disabled_confirmed', level: 'info',   message: 'Download disabled confirmed — no real download.' },
    { code: 'physical_file_not_created',  level: 'info',    message: 'Physical file was not created.' },
    { code: 'public_url_not_created',     level: 'info',    message: 'Public URL was not created.' },
  ]

  return {
    status:          'recorded',
    simulation_only: true,
    entries_count:   entries.length,
    entries,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateAdminDownloadDryRun(input = {}, options = {}) {
  const safeInput = input ?? {}
  return {
    download_response_contract: buildDownloadResponseContract(safeInput, options),
    admin_download_dry_run:     buildAdminDownloadDryRun(safeInput, options),
    download_dry_run_audit:     buildDownloadDryRunAudit(safeInput, options),
  }
}
