// src/routes/operatorReportPreview.js
// GET /v1/admin/operator-report-preview
// Admin-only, requires X-Admin-Key = SB_MASTER_KEY
// P3.8.19 — internal report preview + immutable no-sell enforcement + audit
// P3.8.20 — UX contract, redaction, abuse protection, modes, health
// P3.8.21 — internal export renderer, format param, download dry-run, regression lock
// P3.8.22 — archive contract, versioned history, access audit
// P3.8.23 — storage contract, access replay, release freeze sentinel
// P3.8.24 — freeze baseline registry, safety invariant snapshot, controlled unfreeze design
// P3.8.25 — capability unlock matrix, controlled unfreeze simulation, pre-beta governance gate
// P3.8.26 — pre-beta readiness council, operator sign-off simulation, private beta non-delivery contract
// P3.8.27 — non-user cohort contract, private beta invitation simulation, delivery kill-switch
// P3.8.28 — private beta dry-invite report, synthetic cohort review, delivery incident drill
// P3.8.29 — beta safety incident ledger, incident recovery simulation, operator escalation protocol
// P3.8.30 — P3.8 governance closure packet, safety freeze finalization, P3.9 transition plan
// No DB queries, no physical file, no public access.

import { corsHeaders } from './health.js'
import { evaluateAdminExportPreview } from '../services/adminExportPreview.js'
import { applyImmutableNoSellEnvelope } from '../services/immutableNoSell.js'
import { evaluateReportRedaction } from '../services/reportRedaction.js'
import { evaluateExportAbuseProtection } from '../services/exportAbuseProtection.js'
import { evaluateAdminPreviewUx } from '../services/adminPreviewUx.js'
import { evaluateInternalExportRenderer } from '../services/internalExportRenderer.js'
import { evaluateAdminDownloadDryRun } from '../services/adminDownloadDryRun.js'
import { evaluateRedactionRegressionLock } from '../services/redactionRegressionLock.js'
import { evaluateAdminExportArchive } from '../services/adminExportArchive.js'
import { evaluateReportHistorySimulation } from '../services/reportHistorySimulation.js'
import { evaluateAdminAccessAudit } from '../services/adminAccessAudit.js'
import { evaluateInternalExportStorage } from '../services/internalExportStorage.js'
import { evaluateAdminAccessReplay } from '../services/adminAccessReplay.js'
import { evaluateReleaseFreezeSentinel } from '../services/releaseFreezeSentinel.js'
import { evaluateReleaseFreezeBaseline } from '../services/releaseFreezeBaseline.js'
import { evaluateSafetyInvariantSnapshot } from '../services/safetyInvariantSnapshot.js'
import { evaluateControlledUnfreezeDesign } from '../services/controlledUnfreezeDesign.js'
import { evaluateCapabilityUnlockMatrix } from '../services/capabilityUnlockMatrix.js'
import { evaluateControlledUnfreezeSimulation } from '../services/controlledUnfreezeSimulation.js'
import { evaluatePreBetaGovernanceGate } from '../services/preBetaGovernanceGate.js'
import { evaluatePreBetaReadinessCouncil } from '../services/preBetaReadinessCouncil.js'
import { evaluateOperatorSignoffSimulation } from '../services/operatorSignoffSimulation.js'
import { evaluatePrivateBetaNonDelivery } from '../services/privateBetaNonDelivery.js'
import { evaluateNonUserCohortContract } from '../services/nonUserCohortContract.js'
import { evaluatePrivateBetaInvitationSimulation } from '../services/privateBetaInvitationSimulation.js'
import { evaluateDeliveryKillSwitch } from '../services/deliveryKillSwitch.js'
import { evaluateSyntheticCohortReview } from '../services/syntheticCohortReview.js'
import { evaluatePrivateBetaDryInviteReport } from '../services/privateBetaDryInviteReport.js'
import { evaluateDeliveryIncidentDrill } from '../services/deliveryIncidentDrill.js'
import { evaluateBetaSafetyIncidentLedger } from '../services/betaSafetyIncidentLedger.js'
import { evaluateIncidentRecoverySimulation } from '../services/incidentRecoverySimulation.js'
import { evaluateOperatorEscalationProtocol } from '../services/operatorEscalationProtocol.js'
import { evaluateP38GovernanceClosure } from '../services/p38GovernanceClosure.js'
import { evaluateP38SafetyFinalization } from '../services/p38SafetyFinalization.js'
import { evaluateP39TransitionPlan } from '../services/p39TransitionPlan.js'

// ── Auth Helper (exported for unit testing) ───────────────────────────────────

export function verifyAdminKeyAccess(headerKey, masterKey) {
  if (!masterKey) {
    return { authorized: false, reason: 'no_master_key_configured', status_code: 403 }
  }
  if (!headerKey) {
    return { authorized: false, reason: 'no_key_provided', status_code: 401 }
  }
  if (headerKey !== masterKey) {
    return { authorized: false, reason: 'invalid_key', status_code: 401 }
  }
  return { authorized: true, reason: 'key_valid', status_code: 200 }
}

// ── Mode Parsing ──────────────────────────────────────────────────────────────

const ALLOWED_MODES   = ['compact', 'detailed', 'text', 'json']
const FORBIDDEN_MODES = ['download', 'public', 'pdf', 'email', 'webhook']

// ── Export Format Parsing ─────────────────────────────────────────────────────

const ALLOWED_EXPORT_FORMATS  = ['json', 'txt', 'md']
const BLOCKED_EXPORT_FORMATS  = ['pdf', 'html_public', 'email', 'webhook', 'public_url', 'download', 'html']
const EXPORT_FORMAT_ALIASES   = { text: 'txt', markdown: 'md', text_only: 'txt', json_only: 'json' }

export function parseExportFormat(url) {
  try {
    const raw = new URL(url).searchParams.get('format')
    if (!raw) return { format: null, blocked: false }
    const lower = raw.toLowerCase().trim()
    if (BLOCKED_EXPORT_FORMATS.includes(lower)) {
      return { format: null, blocked: true, reason: `format_${lower}_not_allowed` }
    }
    const resolved = EXPORT_FORMAT_ALIASES[lower] ?? (ALLOWED_EXPORT_FORMATS.includes(lower) ? lower : null)
    if (!resolved) {
      return { format: 'json', blocked: false, warning: `unknown_format_defaulted_to_json` }
    }
    return { format: resolved, blocked: false }
  } catch {
    return { format: null, blocked: false }
  }
}

export function parsePreviewMode(url) {
  try {
    const mode = new URL(url).searchParams.get('mode') || 'compact'
    if (FORBIDDEN_MODES.includes(mode)) {
      return { mode: null, blocked: true, reason: `mode_${mode}_not_allowed` }
    }
    if (!ALLOWED_MODES.includes(mode)) {
      return { mode: 'compact', blocked: false, warning: `unknown_mode_defaulted_to_compact` }
    }
    return { mode, blocked: false }
  } catch {
    return { mode: 'compact', blocked: false }
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function handleOperatorReportPreview(request, env) {
  const adminKey  = request.headers.get('X-Admin-Key') || ''
  const masterKey = env?.SB_MASTER_KEY || ''

  const access = verifyAdminKeyAccess(adminKey, masterKey)

  if (!access.authorized) {
    const isMisconfigured = access.reason === 'no_master_key_configured'
    // Compact access audit (no internal data leak)
    const deniedAudit = evaluateAdminAccessAudit({
      authorized:            false,
      admin_key_present:     !!adminKey,
      admin_key_valid:       false,
      sb_master_key_present: !!masterKey,
      selected_format:       'json',
      selected_mode:         'compact',
    })
    return new Response(JSON.stringify({
      ok:    false,
      error: isMisconfigured ? 'SERVER_MISCONFIGURED' : 'UNAUTHORIZED',
      admin_export_access_control: {
        status:                isMisconfigured ? 'misconfigured' : 'denied',
        authorized:            false,
        requires_admin_key:    true,
        public_access_allowed: false,
        fail_closed:           true,
      },
      access_audit_summary: deniedAudit.access_audit_summary,
      can_beta: false,
      can_sell: false,
    }), {
      status:  access.status_code,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  // ── Mode validation ───────────────────────────────────────────────────────
  const { mode, blocked: modeBlocked, reason: modeReason, warning: modeWarning } =
    parsePreviewMode(request.url)

  if (modeBlocked) {
    return new Response(JSON.stringify({
      ok:    false,
      error: 'MODE_NOT_ALLOWED',
      reason: modeReason,
      admin_preview_modes: {
        download: { available: false, requires_future_phase: true, public: false },
      },
      can_beta: false,
      can_sell: false,
    }), {
      status:  400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  // ── Format validation (P3.8.21) ───────────────────────────────────────────
  const { format: exportFormat, blocked: formatBlocked, reason: formatReason, warning: formatWarning } =
    parseExportFormat(request.url)

  if (formatBlocked) {
    return new Response(JSON.stringify({
      ok:    false,
      error: 'FORMAT_NOT_ALLOWED',
      reason: formatReason,
      download_response_contract: {
        download_enabled_now:  false,
        physical_file_created: false,
        public_url_created:    false,
        blocked_formats:       BLOCKED_EXPORT_FORMATS,
      },
      can_beta: false,
      can_sell: false,
    }), {
      status:  400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  // ── Authorized — build full preview ──────────────────────────────────────
  const adminPreview = evaluateAdminExportPreview({
    admin_key_present: true,
    admin_key_valid:   true,
  })

  const redactionResult = evaluateReportRedaction({
    operator_report_render:      adminPreview.internal_report_preview,
    internal_report_preview:     adminPreview.internal_report_preview,
    report_redaction_policy:     null,
  })

  const abuseResult = evaluateExportAbuseProtection({
    redacted_operator_report: redactionResult.redacted_operator_report,
  })

  const uxResult = evaluateAdminPreviewUx({
    admin_export_access_control:  adminPreview.admin_export_access_control,
    internal_download_preflight:  abuseResult.internal_download_preflight,
    report_redaction_policy:      redactionResult.report_redaction_policy,
    export_abuse_protection:      abuseResult.export_abuse_protection,
    immutable_no_sell_enforcement: adminPreview.immutable_no_sell_enforcement,
  })

  // ── P3.8.21 services ─────────────────────────────────────────────────────
  const rendererResult = evaluateInternalExportRenderer({
    operator_report_render:        adminPreview.internal_report_preview,
    decision_fingerprint:          null,
    launch_no_launch_decision:     null,
    decision_evidence_matrix:      null,
    manual_review_artifact:        null,
    no_launch_governance:          null,
    regression_lockdown:           null,
    commercial_claims_guard:       null,
    immutable_no_sell_enforcement: adminPreview.immutable_no_sell_enforcement,
    operator_next_actions:         null,
    evidence_export_packet:        null,
  })

  const selectedFormat = exportFormat ?? 'json'

  const dryRunResult = evaluateAdminDownloadDryRun({
    format:              selectedFormat,
    _rendered_content:   rendererResult._rendered_content,
    decision_fingerprint: null,
  })

  const regressionLockResult = evaluateRedactionRegressionLock({
    rendered_export_formats: rendererResult._rendered_content,
    report_redaction_policy: redactionResult.report_redaction_policy,
  })

  // ── P3.8.22 services ─────────────────────────────────────────────────────
  const archiveResult = evaluateAdminExportArchive({
    internal_export_renderer:      rendererResult.internal_export_renderer,
    rendered_export_formats:       rendererResult.rendered_export_formats,
    export_format_validation:      rendererResult.export_format_validation,
    format_render_summary:         rendererResult.format_render_summary,
    download_response_contract:    dryRunResult.download_response_contract,
    admin_download_dry_run:        dryRunResult.admin_download_dry_run,
    download_dry_run_audit:        dryRunResult.download_dry_run_audit,
    redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
    immutable_no_sell_enforcement: adminPreview.immutable_no_sell_enforcement,
  })

  const historyResult = evaluateReportHistorySimulation({})

  const accessAuditResult = evaluateAdminAccessAudit({
    authorized:            true,
    admin_key_present:     true,
    admin_key_valid:       true,
    sb_master_key_present: true,
    selected_format:       selectedFormat,
    selected_mode:         mode ?? 'compact',
  })

  // ── P3.8.23 services ─────────────────────────────────────────────────────
  const storageResult = evaluateInternalExportStorage({
    redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
    immutable_no_sell_enforcement: adminPreview.immutable_no_sell_enforcement,
    export_format_validation:      rendererResult.export_format_validation,
    internal_export_renderer:      rendererResult.internal_export_renderer,
  })

  const replayResult = evaluateAdminAccessReplay({})

  const freezeResult = evaluateReleaseFreezeSentinel({
    regression_lockdown:       null,
    redaction_regression_lock: regressionLockResult.redaction_regression_lock,
  })

  // ── P3.8.24 services ─────────────────────────────────────────────────────
  const baselineResult = evaluateReleaseFreezeBaseline({
    release_freeze_policy:         freezeResult.release_freeze_policy,
    freeze_baseline:               freezeResult.freeze_baseline,
    freeze_diff_report:            freezeResult.freeze_diff_report,
    release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
    freeze_enforcement_summary:    freezeResult.freeze_enforcement_summary,
    internal_export_storage_contract: storageResult.internal_export_storage_contract,
    storage_write_simulation:      storageResult.storage_write_simulation,
    admin_access_replay_simulation: replayResult.admin_access_replay_simulation,
    admin_access_pattern_review:   replayResult.admin_access_pattern_review,
    redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
    immutable_no_sell_enforcement: adminPreview.immutable_no_sell_enforcement,
  })

  const invariantResult = evaluateSafetyInvariantSnapshot({})

  const unfreezeResult = evaluateControlledUnfreezeDesign({
    release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
    redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
    immutable_no_sell_enforcement: adminPreview.immutable_no_sell_enforcement,
    admin_access_audit:            accessAuditResult.admin_access_audit,
  })

  // ── P3.8.25 services ─────────────────────────────────────────────────────
  const matrixResult = evaluateCapabilityUnlockMatrix({
    release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
    freeze_enforcement_summary:    freezeResult.freeze_enforcement_summary,
    controlled_unfreeze_design:    unfreezeResult.controlled_unfreeze_design,
    unfreeze_preconditions_matrix: unfreezeResult.unfreeze_preconditions_matrix,
    immutable_no_sell_enforcement: adminPreview.immutable_no_sell_enforcement,
  })

  const simulationResult = evaluateControlledUnfreezeSimulation({
    capability_unlock_matrix:      matrixResult.capability_unlock_matrix,
    capability_risk_profile:       matrixResult.capability_risk_profile,
    controlled_unfreeze_design:    unfreezeResult.controlled_unfreeze_design,
    release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
  })

  const gateResult = evaluatePreBetaGovernanceGate({
    release_freeze_baseline_registry: baselineResult.release_freeze_baseline_registry,
    baseline_comparison_report:       baselineResult.baseline_comparison_report,
    safety_invariant_snapshot:        invariantResult.safety_invariant_snapshot,
    safety_invariant_validation:      invariantResult.safety_invariant_validation,
    controlled_unfreeze_design:       unfreezeResult.controlled_unfreeze_design,
    capability_unlock_matrix:         matrixResult.capability_unlock_matrix,
    controlled_unfreeze_simulation:   simulationResult.controlled_unfreeze_simulation,
    immutable_no_sell_enforcement:    adminPreview.immutable_no_sell_enforcement,
  })

  // ── P3.8.26 services ─────────────────────────────────────────────────────
  const councilResult = evaluatePreBetaReadinessCouncil({
    pre_beta_governance_gate:         gateResult.pre_beta_governance_gate,
    pre_beta_blocker_matrix:          gateResult.pre_beta_blocker_matrix,
    pre_beta_operator_review:         gateResult.pre_beta_operator_review,
    final_pre_beta_summary:           gateResult.final_pre_beta_summary,
    capability_unlock_matrix:         matrixResult.capability_unlock_matrix,
    controlled_unfreeze_simulation:   simulationResult.controlled_unfreeze_simulation,
    release_freeze_sentinel:          freezeResult.release_freeze_sentinel,
    release_freeze_baseline_registry: baselineResult.release_freeze_baseline_registry,
    safety_invariant_snapshot:        invariantResult.safety_invariant_snapshot,
    can_beta:                         false,
    can_sell:                         false,
  })

  const signoffResult = evaluateOperatorSignoffSimulation({}, {
    OPERATOR_SIGNOFF_SIMULATION_ENABLED: false,
    SIGNOFF_NO_OVERRIDE_LOCK:            true,
  })

  const nonDeliveryResult = evaluatePrivateBetaNonDelivery({
    can_beta: false,
    can_sell: false,
  })

  // ── P3.8.27 services ─────────────────────────────────────────────────────
  const cohortResult = evaluateNonUserCohortContract({})

  const invitationResult = evaluatePrivateBetaInvitationSimulation({
    real_invites_created: false,
    users_created:        false,
  })

  const killSwitchResult = evaluateDeliveryKillSwitch({
    real_delivery: false,
  })

  // ── P3.8.28 services ─────────────────────────────────────────────────────
  const cohortReviewResult = evaluateSyntheticCohortReview({
    non_user_cohort_contract:           cohortResult.non_user_cohort_contract,
    non_user_cohort_members:            cohortResult.non_user_cohort_members,
    non_user_cohort_audit:              cohortResult.non_user_cohort_audit,
    non_user_cohort_summary:            cohortResult.non_user_cohort_summary,
    private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
    simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
    can_beta:                           false,
    can_sell:                           false,
    real_users:                         false,
    real_delivery:                      false,
  })

  const dryInviteResult = evaluatePrivateBetaDryInviteReport({
    non_user_cohort_contract:           cohortResult.non_user_cohort_contract,
    non_user_cohort_members:            cohortResult.non_user_cohort_members,
    synthetic_cohort_review:            cohortReviewResult.synthetic_cohort_review,
    synthetic_member_safety_matrix:     cohortReviewResult.synthetic_member_safety_matrix,
    private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
    simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
    invitation_channel_policy:          invitationResult.invitation_channel_policy,
    delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
    channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
    private_beta_non_delivery_contract: nonDeliveryResult.private_beta_non_delivery_contract,
    non_delivery_enforcement:           nonDeliveryResult.non_delivery_enforcement,
    pre_beta_readiness_council:         councilResult.pre_beta_readiness_council,
    operator_signoff_simulation:        signoffResult.operator_signoff_simulation,
    can_beta:                           false,
    can_sell:                           false,
  })

  const drillResult = evaluateDeliveryIncidentDrill({
    delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
    channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
    delivery_kill_switch_audit:         killSwitchResult.delivery_kill_switch_audit,
    private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
    simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
    invitation_channel_policy:          invitationResult.invitation_channel_policy,
    non_delivery_enforcement:           nonDeliveryResult.non_delivery_enforcement,
    can_beta:                           false,
    can_sell:                           false,
    real_delivery:                      false,
    email_delivery_enabled:             false,
    webhook_enabled:                    false,
  })

  // ── P3.8.29 services ─────────────────────────────────────────────────────
  const ledgerResult = evaluateBetaSafetyIncidentLedger({
    delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
    channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
    private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
    simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
    delivery_incident_scenarios:        drillResult.delivery_incident_scenarios,
    delivery_incident_drill:            drillResult.delivery_incident_drill,
    incident_real_action_taken:         false,
    real_actions_taken:                 false,
  })

  const recoveryResult = evaluateIncidentRecoverySimulation({
    beta_safety_incident_ledger:        ledgerResult.beta_safety_incident_ledger,
    simulated_incident_records:         ledgerResult.simulated_incident_records,
    incident_severity_matrix:           ledgerResult.incident_severity_matrix,
    delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
    channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
    recovery_real_action_taken:         false,
    operator_notified_externally:       false,
  })

  const escalationResult = evaluateOperatorEscalationProtocol({
    incident_recovery_simulation:       recoveryResult.incident_recovery_simulation,
    recovery_action_plan:               recoveryResult.recovery_action_plan,
    recovery_verification_checklist:    recoveryResult.recovery_verification_checklist,
    beta_safety_incident_ledger:        ledgerResult.beta_safety_incident_ledger,
    incident_severity_matrix:           ledgerResult.incident_severity_matrix,
    external_escalation_sent:           false,
    operator_notified_externally:       false,
  })

  // ── P3.8.30 services ─────────────────────────────────────────────────────
  const closureResult = evaluateP38GovernanceClosure({
    delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
    private_beta_non_delivery_contract: nonDeliveryResult.private_beta_non_delivery_contract,
    beta_safety_incident_ledger:        ledgerResult.beta_safety_incident_ledger,
    incident_recovery_simulation:       recoveryResult.incident_recovery_simulation,
    operator_escalation_protocol:       escalationResult.operator_escalation_protocol,
    pre_beta_governance_gate:           gateResult.pre_beta_governance_gate,
    can_beta:                           false,
    can_sell:                           false,
  })

  const finalizationResult = evaluateP38SafetyFinalization({
    delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
    release_freeze_sentinel:            freezeResult.release_freeze_sentinel,
    immutable_no_sell_enforcement:      adminPreview.immutable_no_sell_enforcement,
    can_beta:                           false,
    can_sell:                           false,
    delivery_allowed:                   false,
    real_delivery:                      false,
    operator_notified_externally:       false,
  })

  const transitionResult = evaluateP39TransitionPlan({
    resolved_valid:                     0,
    auto_activate_micro_test:           false,
    can_beta:                           false,
    can_sell:                           false,
  })

  // Apply immutable no-sell envelope over the final response
  const safeResponse = applyImmutableNoSellEnvelope({
    ok:           true,
    generated_at: new Date().toISOString(),
    preview_mode: mode,
    selected_format: selectedFormat,
    ...(modeWarning    ? { mode_warning:    modeWarning    } : {}),
    ...(formatWarning  ? { format_warning:  formatWarning  } : {}),
    ...adminPreview,
    ...redactionResult,
    ...abuseResult,
    ...uxResult,
    rendered_export:              rendererResult._rendered_content[selectedFormat],
    internal_export_renderer:     rendererResult.internal_export_renderer,
    rendered_export_formats:      rendererResult.rendered_export_formats,
    export_format_validation:     rendererResult.export_format_validation,
    format_render_summary:        rendererResult.format_render_summary,
    download_response_contract:   dryRunResult.download_response_contract,
    admin_download_dry_run:       dryRunResult.admin_download_dry_run,
    download_dry_run_audit:       dryRunResult.download_dry_run_audit,
    redaction_regression_lock:    regressionLockResult.redaction_regression_lock,
    admin_export_archive_contract:        archiveResult.admin_export_archive_contract,
    report_version_manifest:              archiveResult.report_version_manifest,
    archive_integrity_summary:            archiveResult.archive_integrity_summary,
    archive_simulation_summary:           archiveResult.archive_simulation_summary,
    versioned_report_history_simulation:  historyResult.versioned_report_history_simulation,
    report_history_diff:                  historyResult.report_history_diff,
    admin_access_audit:                   accessAuditResult.admin_access_audit,
    admin_access_risk_review:             accessAuditResult.admin_access_risk_review,
    access_audit_summary:                 accessAuditResult.access_audit_summary,
    internal_export_storage_contract:     storageResult.internal_export_storage_contract,
    storage_write_simulation:             storageResult.storage_write_simulation,
    storage_retention_policy:             storageResult.storage_retention_policy,
    storage_safety_manifest:              storageResult.storage_safety_manifest,
    admin_access_replay_simulation:       replayResult.admin_access_replay_simulation,
    admin_access_pattern_review:          replayResult.admin_access_pattern_review,
    release_freeze_policy:                freezeResult.release_freeze_policy,
    freeze_baseline:                      freezeResult.freeze_baseline,
    freeze_diff_report:                   freezeResult.freeze_diff_report,
    release_freeze_sentinel:              freezeResult.release_freeze_sentinel,
    freeze_enforcement_summary:           freezeResult.freeze_enforcement_summary,
    release_freeze_baseline_registry:     baselineResult.release_freeze_baseline_registry,
    baseline_comparison_report:           baselineResult.baseline_comparison_report,
    freeze_baseline_audit:                baselineResult.freeze_baseline_audit,
    freeze_registry_summary:              baselineResult.freeze_registry_summary,
    safety_invariant_snapshot:            invariantResult.safety_invariant_snapshot,
    safety_invariant_validation:          invariantResult.safety_invariant_validation,
    safety_invariant_summary:             invariantResult.safety_invariant_summary,
    controlled_unfreeze_design:           unfreezeResult.controlled_unfreeze_design,
    unfreeze_preconditions_matrix:        unfreezeResult.unfreeze_preconditions_matrix,
    unfreeze_risk_assessment:             unfreezeResult.unfreeze_risk_assessment,
    unfreeze_simulation_guard:            unfreezeResult.unfreeze_simulation_guard,
    controlled_unfreeze_summary:          unfreezeResult.controlled_unfreeze_summary,
    capability_unlock_matrix:             matrixResult.capability_unlock_matrix,
    capability_risk_profile:              matrixResult.capability_risk_profile,
    capability_unlock_summary:            matrixResult.capability_unlock_summary,
    controlled_unfreeze_simulation:       simulationResult.controlled_unfreeze_simulation,
    capability_unlock_attempts:           simulationResult.capability_unlock_attempts,
    unlock_rollback_plan:                 simulationResult.unlock_rollback_plan,
    unlock_simulation_audit:              simulationResult.unlock_simulation_audit,
    pre_beta_governance_gate:             gateResult.pre_beta_governance_gate,
    pre_beta_blocker_matrix:              gateResult.pre_beta_blocker_matrix,
    pre_beta_operator_review:             gateResult.pre_beta_operator_review,
    final_pre_beta_summary:               gateResult.final_pre_beta_summary,
    pre_beta_readiness_council:           councilResult.pre_beta_readiness_council,
    readiness_council_votes:              councilResult.readiness_council_votes,
    pre_beta_decision_record:             councilResult.pre_beta_decision_record,
    pre_beta_council_summary:             councilResult.pre_beta_council_summary,
    operator_signoff_simulation:          signoffResult.operator_signoff_simulation,
    signoff_effectiveness_policy:         signoffResult.signoff_effectiveness_policy,
    signoff_audit_trail:                  signoffResult.signoff_audit_trail,
    signoff_summary:                      signoffResult.signoff_summary,
    private_beta_non_delivery_contract:   nonDeliveryResult.private_beta_non_delivery_contract,
    non_delivery_enforcement:             nonDeliveryResult.non_delivery_enforcement,
    non_delivery_checklist:               nonDeliveryResult.non_delivery_checklist,
    non_delivery_audit:                   nonDeliveryResult.non_delivery_audit,
    non_delivery_summary:                 nonDeliveryResult.non_delivery_summary,
    non_user_cohort_contract:             cohortResult.non_user_cohort_contract,
    non_user_cohort_members:              cohortResult.non_user_cohort_members,
    non_user_cohort_audit:                cohortResult.non_user_cohort_audit,
    non_user_cohort_summary:              cohortResult.non_user_cohort_summary,
    invitation_channel_policy:            invitationResult.invitation_channel_policy,
    private_beta_invitation_simulation:   invitationResult.private_beta_invitation_simulation,
    simulated_invitation_ledger:          invitationResult.simulated_invitation_ledger,
    invitation_simulation_audit:          invitationResult.invitation_simulation_audit,
    invitation_simulation_summary:        invitationResult.invitation_simulation_summary,
    delivery_kill_switch:                 killSwitchResult.delivery_kill_switch,
    channel_kill_switch_matrix:           killSwitchResult.channel_kill_switch_matrix,
    delivery_kill_switch_audit:           killSwitchResult.delivery_kill_switch_audit,
    delivery_kill_switch_summary:         killSwitchResult.delivery_kill_switch_summary,
    synthetic_cohort_review:              cohortReviewResult.synthetic_cohort_review,
    synthetic_member_safety_matrix:       cohortReviewResult.synthetic_member_safety_matrix,
    synthetic_cohort_findings:            cohortReviewResult.synthetic_cohort_findings,
    synthetic_cohort_review_summary:      cohortReviewResult.synthetic_cohort_review_summary,
    private_beta_dry_invite_report:       dryInviteResult.private_beta_dry_invite_report,
    dry_invite_evidence_packet:           dryInviteResult.dry_invite_evidence_packet,
    dry_invite_readiness_checklist:       dryInviteResult.dry_invite_readiness_checklist,
    dry_invite_operator_summary:          dryInviteResult.dry_invite_operator_summary,
    delivery_incident_scenarios:          drillResult.delivery_incident_scenarios,
    delivery_incident_drill:              drillResult.delivery_incident_drill,
    incident_response_plan:               drillResult.incident_response_plan,
    kill_switch_drill_report:             drillResult.kill_switch_drill_report,
    incident_drill_summary:               drillResult.incident_drill_summary,
    beta_safety_incident_ledger:          ledgerResult.beta_safety_incident_ledger,
    simulated_incident_records:           ledgerResult.simulated_incident_records,
    incident_severity_matrix:             ledgerResult.incident_severity_matrix,
    incident_ledger_summary:              ledgerResult.incident_ledger_summary,
    incident_recovery_simulation:         recoveryResult.incident_recovery_simulation,
    recovery_action_plan:                 recoveryResult.recovery_action_plan,
    recovery_verification_checklist:      recoveryResult.recovery_verification_checklist,
    incident_response_summary:            recoveryResult.incident_response_summary,
    operator_escalation_protocol:         escalationResult.operator_escalation_protocol,
    escalation_decision_matrix:           escalationResult.escalation_decision_matrix,
    internal_escalation_audit:            escalationResult.internal_escalation_audit,
    escalation_protocol_summary:          escalationResult.escalation_protocol_summary,
    p38_governance_closure_packet:        closureResult.p38_governance_closure_packet,
    p38_completion_matrix:                closureResult.p38_completion_matrix,
    p38_open_risks_register:              closureResult.p38_open_risks_register,
    p38_closure_audit:                    closureResult.p38_closure_audit,
    p38_closure_summary:                  closureResult.p38_closure_summary,
    p38_safety_freeze_finalization:       finalizationResult.p38_safety_freeze_finalization,
    final_safety_invariant_check:         finalizationResult.final_safety_invariant_check,
    final_no_sell_no_delivery_check:      finalizationResult.final_no_sell_no_delivery_check,
    p38_safety_finalization_summary:      finalizationResult.p38_safety_finalization_summary,
    p39_transition_plan:                  transitionResult.p39_transition_plan,
    p39_micro_test_activation_plan:       transitionResult.p39_micro_test_activation_plan,
    p39_quality_proof_requirements:       transitionResult.p39_quality_proof_requirements,
    p39_operator_checklist:               transitionResult.p39_operator_checklist,
    p38_to_p39_operator_summary:          transitionResult.p38_to_p39_operator_summary,
    can_beta:     false,
    can_sell:     false,
  })

  return new Response(JSON.stringify(safeResponse), {
    status:  200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}
