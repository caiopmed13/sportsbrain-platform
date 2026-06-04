// src/services/exportContract.js
// P3.8.18 — Operator Report Download Contract, Safe Export Manifest,
//           Commercial Claims Guard, Export Integrity Contract, Download Readiness

// ── Constants ──────────────────────────────────────────────────────────────────

const CONTRACT_VERSION = 'p3.8.18'

const BLOCKED_TERMS = [
  'lucro garantido', 'roi garantido', 'pronto para vender', 'assertividade garantida',
  'edge comprovado', 'renda garantida', 'garantia de lucro',
  'validated for sale', 'ready to sell', 'guaranteed profit',
  'guaranteed roi', 'guaranteed return', 'rendimento garantido',
]

const FORBIDDEN_FLAT_FIELDS = [
  'download_enabled', 'download_publicly_available', 'physical_file_created',
  'webhook_enabled', 'email_enabled', 'can_beta', 'can_sell', 'release_allowed',
  'export_allows_beta', 'export_allows_sell', 'commercial_claims_allowed',
  'real_users', 'real_delivery',
]

// ── Helpers ────────────────────────────────────────────────────────────────────

export function normalizeExportBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  return false
}

// ── Download Contract ─────────────────────────────────────────────────────────

export function buildOperatorReportDownloadContract(input = {}, options = {}) {
  const hasRegression   = input.governance_regression_suite?.passed !== false
  const hasFingerprint  = input.decision_fingerprint?.value != null
  const hasValidation   = input.export_validation_summary?.valid === true

  // Detect unsafe fields in raw input
  const dangerFields = ['download_enabled', 'download_publicly_available', 'can_beta', 'can_sell',
                        'release_allowed', 'export_allows_beta', 'export_allows_sell']
  const violations = dangerFields
    .filter(f => normalizeExportBoolean(input[f]))
    .map(f => ({ field: f, value: true, sanitized_to: false }))

  let status
  if (violations.length > 0)                 status = 'ready_with_warnings'
  else if (hasValidation && hasFingerprint)   status = 'contract_ready'
  else if (hasRegression || hasFingerprint)   status = 'contract_ready'
  else                                        status = 'not_ready'

  return {
    status,
    contract_version:                   CONTRACT_VERSION,
    download_enabled:                   false,   // ALWAYS false
    download_publicly_available:        false,   // ALWAYS false
    future_download_allowed:            true,
    current_phase_allows_physical_file: false,
    allowed_future_formats:             ['json', 'txt', 'md'],
    blocked_formats_now:                ['pdf', 'email', 'webhook', 'public_url'],
    requires_admin_access:              true,
    requires_no_launch_lock:            true,
    simulation_only:                    true,
    can_enable_beta:                    false,
    can_enable_sell:                    false,
    violations_detected:                violations.length > 0,
    violations,
  }
}

// ── Safe Export Manifest ──────────────────────────────────────────────────────

export function buildSafeExportManifest(input = {}, options = {}) {
  // Run on raw input to detect forbidden truths
  const manifestForbiddenFields = [
    'real_users', 'real_delivery', 'can_beta', 'can_sell',
    'export_allows_beta', 'export_allows_sell',
  ]
  const violations = manifestForbiddenFields
    .filter(f => normalizeExportBoolean(input[f]))
    .map(f => ({ field: f, sanitized: true }))

  const hasViolations = violations.length > 0

  // Scan section summaries for claims (belt-and-suspenders)
  const sections = input.evidence_export_packet?.sections ?? []
  const claimsInSections = BLOCKED_TERMS.some(term =>
    sections.some(s => (s.summary ?? '').toLowerCase().includes(term))
  )

  let status
  if (hasViolations || claimsInSections) status = 'invalid'
  else                                   status = 'valid'

  return {
    status,
    manifest_version:                       CONTRACT_VERSION,
    contains_personal_data:                 false,   // always false — no PII
    contains_real_users:                    false,   // always false
    contains_real_delivery:                 false,   // always false
    contains_payment_data:                  false,   // always false
    contains_claims:                        claimsInSections,
    contains_picks_for_public_distribution: false,
    redacted_fields:                        ['user_ids', 'email_addresses', 'payment_data'],
    included_sections:                      sections.map(s => s.code),
    excluded_sections:                      ['real_user_data', 'payment_data', 'personal_identifiers'],
    safety_invariants: {
      can_beta:           false,
      can_sell:           false,
      export_allows_beta: false,   // ALWAYS false
      export_allows_sell: false,
    },
    violations_detected: hasViolations,
    violations,
  }
}

// ── Commercial Claims Guard ───────────────────────────────────────────────────

export function buildCommercialClaimsGuard(input = {}, options = {}) {
  // Gather all text sources to scan
  const textSources = [
    input.operator_report_render?.text                      ?? '',
    input.operator_report_summary?.headline                 ?? '',
    input.operator_report_summary?.operator_instruction     ?? '',
    input.manual_review_summary?.summary_text               ?? '',
    ...(input.evidence_export_packet?.sections ?? []).map(s => s.summary ?? ''),
  ]

  const combined = textSources.join(' ').toLowerCase()
  const foundTerms = BLOCKED_TERMS.filter(t => combined.includes(t))
  const claimsDetected = foundTerms.length > 0

  return {
    status:             claimsDetected ? 'blocked' : 'clean',
    claims_allowed:     false,   // ALWAYS false
    claims_detected:    claimsDetected,
    blocked_terms_found: foundTerms,
    warnings:           [],
    blockers:           claimsDetected ? foundTerms.map(t => `forbidden_term:${t}`) : [],
  }
}

// ── Export Integrity Contract ─────────────────────────────────────────────────

export function buildExportIntegrityContract(input = {}, options = {}) {
  const fingerprintPresent = input.decision_fingerprint?.value != null
  const reportRendered     = input.operator_report_render?.status === 'rendered'
  const validationPassed   = input.export_validation_summary?.valid === true
  const regressionPassed   = input.governance_regression_suite?.passed !== false
  // _safe_export_manifest and _commercial_claims_guard are private keys set by orchestrator
  const manifestValid      = ['valid', 'valid_with_warnings'].includes(
    input._safe_export_manifest?.status ?? '')
  const claimsClean        = input._commercial_claims_guard?.status === 'clean'

  const score = (fingerprintPresent ? 20 : 0)
              + (reportRendered     ? 15 : 0)
              + (validationPassed   ? 20 : 0)
              + (regressionPassed   ? 20 : 0)
              + (manifestValid      ? 15 : 0)
              + (claimsClean        ? 10 : 0)

  const grade  = score >= 90 ? 'export_ready'
               : score >= 70 ? 'strong'
               : score >= 40 ? 'usable'
               :               'weak'

  const status = score >= 40 ? 'valid' : 'weak'

  return {
    status,
    fingerprint_present:    fingerprintPresent,
    fingerprint:            input.decision_fingerprint?.value ?? null,
    report_rendered:        reportRendered,
    validation_passed:      validationPassed,
    regression_passed:      regressionPassed,
    manifest_valid:         manifestValid,
    claims_clean:           claimsClean,
    required_blocks_present: fingerprintPresent && reportRendered,
    integrity_score:        score,
    integrity_grade:        grade,
  }
}

// ── Download Readiness Summary ─────────────────────────────────────────────────

export function buildDownloadReadinessSummary(input = {}, options = {}) {
  const contractStatus  = input._operator_report_download_contract?.status ?? 'not_ready'
  const integrityScore  = input._export_integrity_contract?.integrity_score ?? 0

  let status, headline, next_action
  if (contractStatus === 'contract_ready') {
    status       = 'contract_ready'
    headline     = 'Contrato de export pronto para fase futura.'
    next_action  = 'Manter export como contrato e avançar apenas para snapshot simulation/regression.'
  } else if (contractStatus === 'ready_with_warnings') {
    status       = 'contract_ready'
    headline     = 'Contrato de export pronto com avisos — violações registradas e sanitizadas.'
    next_action  = 'Revisar violações registradas antes de avançar.'
  } else {
    status       = 'not_ready'
    headline     = 'SportsBrain permanece em shadow/no-launch. Export não disponível.'
    next_action  = 'Continuar acumulando dados.'
  }

  return {
    status,
    headline,
    summary_text:                    'O relatório pode ser preparado para export futuro, mas nenhum download público ou arquivo físico é criado nesta fase.',
    download_enabled_now:            false,   // ALWAYS false
    safe_for_internal_export_future: integrityScore >= 40,
    safe_for_public_share:           false,   // ALWAYS false
    safe_to_sell:                    false,   // ALWAYS false
    next_action,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateExportContract(input = {}, options = {}) {
  const safeInput = input ?? {}

  // Sanitize unsafe flags — always force to false in clean path
  const cleanInput = {
    ...safeInput,
    can_beta:                    false,
    can_sell:                    false,
    real_users:                  false,
    real_delivery:               false,
    release_allowed:             false,
    export_allows_beta:          false,
    export_allows_sell:          false,
    download_enabled:            false,
    download_publicly_available: false,
    commercial_claims_allowed:   false,
  }

  // Download contract and manifest run on raw input to detect violations
  const downloadContract = buildOperatorReportDownloadContract(safeInput, options)
  const manifest         = buildSafeExportManifest(safeInput, options)
  // Claims guard scans text (raw source is fine since text isn't modified by sanitization)
  const claimsGuard      = buildCommercialClaimsGuard(safeInput, options)
  // Integrity contract uses private keys from above results
  const integrityContract = buildExportIntegrityContract({
    ...cleanInput,
    _safe_export_manifest:    manifest,
    _commercial_claims_guard: claimsGuard,
  }, options)
  // Readiness summary uses private keys from contract and integrity
  const readinessSummary = buildDownloadReadinessSummary({
    ...cleanInput,
    _operator_report_download_contract: downloadContract,
    _export_integrity_contract:         integrityContract,
  }, options)

  return {
    operator_report_download_contract: downloadContract,
    safe_export_manifest:              manifest,
    commercial_claims_guard:           claimsGuard,
    export_integrity_contract:         integrityContract,
    download_readiness_summary:        readinessSummary,
  }
}
