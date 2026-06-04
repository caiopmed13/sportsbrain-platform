// src/services/adminExportPreview.js
// P3.8.19 — Admin Export Preview, Access Control, Route Contract,
//           Internal Report Preview, Audit, Preview Summary

import { buildImmutableNoSellEnforcement, sanitizeCommercialFlags } from './immutableNoSell.js'

// ── Access Control ─────────────────────────────────────────────────────────────

export function buildAdminExportAccessControl(input = {}, options = {}) {
  const keyPresent = input.admin_key_present === true
  const keyValid   = input.admin_key_valid   === true

  let status, authorized
  if (keyPresent && keyValid) {
    status     = 'authorized'
    authorized = true
  } else if (keyPresent && !keyValid) {
    status     = 'denied'
    authorized = false
  } else {
    // No key presented
    status     = 'protected'
    authorized = false
  }

  return {
    status,
    requires_admin_key:   true,
    admin_key_present:    keyPresent,
    authorized,
    fail_closed:          true,
    public_access_allowed: false,
    allowed_headers:      ['X-Admin-Key'],
    blocked_without_key:  true,
  }
}

// ── Route Contract ─────────────────────────────────────────────────────────────

export function buildProtectedExportRouteContract(input = {}, options = {}) {
  return {
    status:                   'protected',
    route:                    '/v1/admin/operator-report-preview',
    method:                   'GET',
    requires_admin_key:       true,
    public:                   false,
    download_enabled:         false,   // ALWAYS false
    physical_file_created:    false,   // ALWAYS false
    allowed_formats:          ['json', 'text_preview'],
    blocked_formats:          ['pdf', 'email', 'webhook', 'public_url'],
    rate_limit_recommended:   true,
    can_enable_beta:          false,
    can_enable_sell:          false,
  }
}

// ── Internal Report Preview ────────────────────────────────────────────────────

export function buildInternalReportPreview(input = {}, options = {}) {
  const fingerprint    = input.decision_fingerprint?.value ?? null
  const rawText        = input.operator_report_render?.text ?? ''
  // Truncate at 1000 chars for safety
  const textPreview    = rawText.length > 1000
    ? rawText.slice(0, 1000) + '\n[...truncated for preview]'
    : rawText

  const claimsBlocked  = input.commercial_claims_guard?.status === 'blocked'

  const compactJson = {
    decision:               input.launch_no_launch_decision?.decision          ?? 'continue_shadow',
    overall_grade:          input.decision_evidence_matrix?.overall_grade      ?? 'blocked',
    manual_review_status:   input.manual_review_artifact?.status               ?? 'blocked',
    no_launch_status:       input.no_launch_governance?.status                 ?? 'locked',
    download_contract_status: input.operator_report_download_contract?.status  ?? 'not_ready',
    lockdown_status:        input.regression_lockdown?.status                  ?? 'locked',
    can_beta:               false,   // ALWAYS false
    can_sell:               false,   // ALWAYS false
  }

  const warnings = claimsBlocked ? ['commercial_claims_blocked'] : []
  const blockers = claimsBlocked ? ['claims_guard_blocked']      : []

  return {
    status:                'ready',
    format:                'internal_json_plus_text',
    simulation_only:       true,
    public_share_allowed:  false,   // ALWAYS false
    contains_personal_data: false,
    contains_payment_data:  false,
    contains_claims:        claimsBlocked,
    fingerprint,
    text_preview:          textPreview,
    compact_json:          compactJson,
    warnings,
    blockers,
  }
}

// ── Audit ──────────────────────────────────────────────────────────────────────

export function buildAdminExportAudit(input = {}, options = {}) {
  const entries = [
    { code: 'access_control_checked',          result: 'checked',   simulation_only: true },
    { code: 'route_contract_built',             result: 'built',     simulation_only: true },
    { code: 'no_sell_enforced',                 result: 'enforced',  simulation_only: true },
    { code: 'preview_built',                    result: 'built',     simulation_only: true },
    { code: 'claims_guard_checked',             result: 'checked',   simulation_only: true },
    { code: 'download_disabled_confirmed',      result: 'confirmed', simulation_only: true },
    { code: 'public_access_blocked_confirmed',  result: 'confirmed', simulation_only: true },
  ]

  return {
    status:          'recorded',
    simulation_only: true,
    entries_count:   entries.length,
    entries,
  }
}

// ── Preview Summary ────────────────────────────────────────────────────────────

export function buildAdminPreviewSummary(input = {}, options = {}) {
  // Private key passed by orchestrator
  const accessControl  = input._admin_export_access_control
  const authorized     = accessControl?.authorized ?? (input.admin_key_valid === true)
  const claimsBlocked  = input.commercial_claims_guard?.status === 'blocked'

  return {
    status:                   'ready',
    headline:                 'Preview interno disponível apenas para admin.',
    operator_instruction:     'Usar apenas para revisão interna. Não vender. Não compartilhar publicamente.',
    authorized,
    preview_available:        authorized,   // only available when authorized
    safe_for_internal_review: true,
    safe_for_public_share:    false,        // ALWAYS false
    safe_to_sell:             false,        // ALWAYS false
    warnings:                 claimsBlocked ? ['commercial_claims_blocked'] : [],
    blockers:                 claimsBlocked ? ['claims_guard_blocked'] : [],
    next_action:              'Revisar relatório internamente e manter no-sell enforcement ativo.',
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateAdminExportPreview(input = {}, options = {}) {
  const safeInput = input ?? {}

  // Run enforcement on raw input to detect violations
  const enforcement = buildImmutableNoSellEnforcement(safeInput, options)

  // Sanitize all commercial flags
  const cleanInput = sanitizeCommercialFlags(safeInput, options)

  const accessControl  = buildAdminExportAccessControl(cleanInput, options)
  const routeContract  = buildProtectedExportRouteContract(cleanInput, options)
  const preview        = buildInternalReportPreview(cleanInput, options)
  const audit          = buildAdminExportAudit({
    ...cleanInput,
    _admin_export_access_control: accessControl,
  }, options)
  const summary        = buildAdminPreviewSummary({
    ...cleanInput,
    _admin_export_access_control: accessControl,
  }, options)

  return {
    admin_export_access_control:     accessControl,
    protected_export_route_contract: routeContract,
    internal_report_preview:         preview,
    admin_export_audit:              audit,
    admin_preview_summary:           summary,
    immutable_no_sell_enforcement:   enforcement,
  }
}
