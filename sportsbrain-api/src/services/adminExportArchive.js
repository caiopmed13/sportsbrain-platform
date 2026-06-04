// src/services/adminExportArchive.js
// P3.8.22 — Admin Export Archive Simulation

const ARCHIVE_VERSION = 'p3.8.22'
const ALLOWED_FUTURE_FORMATS = ['json', 'txt', 'md']
const BLOCKED_NOW = ['pdf', 'public_url', 'email', 'webhook', 'database_persist']

export function normalizeArchiveBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

export function buildAdminExportArchiveContract(input = {}, options = {}) {
  const unsafe_flags_sanitized = []

  if (normalizeArchiveBoolean(input.archive_persistence_enabled)) {
    unsafe_flags_sanitized.push('archive_persistence_enabled')
  }
  if (normalizeArchiveBoolean(input.database_write_enabled)) {
    unsafe_flags_sanitized.push('database_write_enabled')
  }

  let status = 'ready'
  if (unsafe_flags_sanitized.length > 0) {
    status = 'ready_with_warnings'
  }
  if (input.immutable_no_sell_enforcement?.status === 'critical_violation') {
    status = 'critical_violation'
  }
  if (input.internal_export_renderer?.status === 'critical_violation') {
    status = 'blocked'
  }

  const result = {
    status,
    contract_version: ARCHIVE_VERSION,
    simulation_only: true,
    archive_enabled: false,
    archive_persistence_enabled: false,
    archive_download_enabled: false,
    physical_file_created: false,
    database_write_enabled: false,
    future_archive_possible: true,
    allowed_future_formats: ALLOWED_FUTURE_FORMATS,
    blocked_now: BLOCKED_NOW,
    requires_admin_key: true,
    requires_redaction_lock: true,
    requires_no_sell_enforcement: true,
  }

  if (unsafe_flags_sanitized.length > 0) {
    result.unsafe_flags_sanitized = unsafe_flags_sanitized
  }

  return result
}

export function buildReportVersionManifest(input = {}, options = {}) {
  const decisionValue = input.launch_no_launch_decision?.decision ?? 'continue_shadow'
  const fingerprintValue = input.decision_fingerprint?.value

  const versionTypes = [
    'current',
    'previous_shadow',
    'manual_review_ready_simulated',
    'unsafe_attempt_sanitized',
    'redacted_preview',
  ]

  const versions = versionTypes.map((type) => {
    const fingerprint = type === 'current' && fingerprintValue
      ? fingerprintValue
      : `sb-${ARCHIVE_VERSION}-${type}`

    const base = {
      version_id: `${ARCHIVE_VERSION}-${type}`,
      type,
      fingerprint,
      format: 'json',
      decision: decisionValue,
      overall_grade: 'simulated',
      created_at: null,
      simulation_only: true,
      can_beta: false,
      can_sell: false,
      download_enabled: false,
      physical_file_created: false,
    }

    if (type === 'unsafe_attempt_sanitized') {
      base.sanitized = true
      base.decision = 'continue_shadow'
      base.overall_grade = 'unsafe_sanitized'
      // preserve what the original attempt was
      base.original_decision = 'launch'
    }

    if (type === 'redacted_preview') {
      base.redacted = true
    }

    return base
  })

  const currentVersion = versions.find((v) => v.type === 'current')

  return {
    status: 'generated',
    manifest_version: ARCHIVE_VERSION,
    versions_count: 5,
    current_version: currentVersion,
    versions,
    latest_fingerprint: fingerprintValue ?? `sb-${ARCHIVE_VERSION}-current`,
    all_versions_simulated: true,
    persistence_enabled: false,
  }
}

export function buildArchiveIntegritySummary(input = {}, options = {}) {
  const warnings = []
  const blockers = []
  let score = 0

  const fingerprint_present = Boolean(input.decision_fingerprint?.value)
  if (fingerprint_present) {
    score += 20
  } else {
    warnings.push('fingerprint_missing')
  }

  const formats_rendered =
    input.internal_export_renderer?.status === 'ready' ||
    Boolean(input.rendered_export_formats)
  if (formats_rendered) score += 20

  const redaction_lock_passed = input.redaction_regression_lock?.passed !== false
  if (redaction_lock_passed) {
    score += 20
  } else {
    blockers.push('redaction_lock_failed')
  }

  const download_disabled = input.admin_download_dry_run?.download_enabled !== true
  if (download_disabled) {
    score += 15
  } else {
    blockers.push('download_not_disabled')
  }

  const archive_not_persisted = !normalizeArchiveBoolean(input.archive_persistence_enabled)
  if (archive_not_persisted) score += 15

  const no_sell_enforced = input.immutable_no_sell_enforcement?.status !== 'critical_violation'
  if (no_sell_enforced) {
    score += 10
  } else {
    blockers.push('no_sell_not_enforced')
  }

  let integrity_grade
  if (score < 40) integrity_grade = 'weak'
  else if (score < 60) integrity_grade = 'usable'
  else if (score < 85) integrity_grade = 'strong'
  else integrity_grade = 'archive_ready'

  const status = blockers.length > 0 ? 'invalid' : 'valid'

  return {
    status,
    integrity_score: score,
    integrity_grade,
    fingerprint_present,
    formats_rendered,
    redaction_lock_passed,
    download_disabled,
    archive_not_persisted,
    no_sell_enforced,
    warnings,
    blockers,
  }
}

export function buildArchiveSimulationSummary(input = {}, options = {}) {
  const manifest = input._manifest ?? buildReportVersionManifest(input, options)
  const versions_count = manifest.versions_count ?? 5

  return {
    status: 'simulated',
    headline: 'Archive interno simulado sem persistência.',
    summary_text:
      'O sistema preparou contrato e histórico simulado, mas não criou arquivo físico nem gravou em banco.',
    versions_count,
    persistence_enabled: false,
    archive_download_enabled: false,
    safe_for_internal_review: true,
    safe_for_public_share: false,
    safe_to_sell: false,
    next_action:
      'Manter archive em simulação até fase futura com persistência aprovada.',
  }
}

export function evaluateAdminExportArchive(input = {}, options = {}) {
  const admin_export_archive_contract = buildAdminExportArchiveContract(input, options)
  const report_version_manifest = buildReportVersionManifest(input, options)
  const archive_integrity_summary = buildArchiveIntegritySummary(input, options)
  const archive_simulation_summary = buildArchiveSimulationSummary(input, options)

  return {
    admin_export_archive_contract,
    report_version_manifest,
    archive_integrity_summary,
    archive_simulation_summary,
  }
}
