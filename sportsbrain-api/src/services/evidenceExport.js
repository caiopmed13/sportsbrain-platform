// src/services/evidenceExport.js
// P3.8.17 — Evidence Export Packet, Operator Report Rendering

import { evaluateGovernanceRegression } from './governanceRegression.js'

const EXPORT_VERSION = 'p3.8.17'

// ── Helpers ───────────────────────────────────────────────────────────────────

export function safeString(value, fallback = '') {
  if (value == null) return fallback
  const s = String(value)
  return s.length > 0 ? s : fallback
}

// djb2 hash — deterministic, no external deps, Worker-safe
function djb2(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    hash = hash >>> 0  // unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0')
}

// ── Decision Fingerprint ──────────────────────────────────────────────────────

export function buildDecisionFingerprint(input = {}, options = {}) {
  // Extract stable source fields in deterministic order
  const fields = {
    beta_admission_contract_status:   input.beta_admission_contract?.status    ?? 'not_available',
    can_beta:                         false,  // always false — never fingerprint a true value
    can_sell:                         false,
    can_micro_test:                   input.can_micro_test                     ?? false,
    controlled_expansion_status:      input.controlled_expansion_review?.status ?? 'not_available',
    launch_no_launch_decision:        input.launch_no_launch_decision?.decision ?? 'continue_shadow',
    manual_review_artifact_status:    input.manual_review_artifact?.status     ?? 'blocked',
    micro_test_active:                input.micro_test_active                  ?? false,
    micro_test_policy_decision_state: input.micro_test_policy?.decision_state  ?? 'not_available',
    micro_test_policy_quality_grade:  input.micro_test_policy?.quality_grade   ?? 'not_available',
    micro_test_report_status:         input.micro_test_report?.status          ?? 'not_started',
    micro_test_status:                input.micro_test_status                  ?? 'not_started',
    no_launch_governance_status:      input.no_launch_governance?.status       ?? 'locked',
    operator_decision_packet_status:  input.operator_decision_packet?.status   ?? 'blocked',
    approval_simulation_status:       input.approval_simulation?.status        ?? 'disabled',
    private_beta_sandbox_status:      input.private_beta_sandbox?.status       ?? 'disabled',
    resolved_valid:                   input.resolved_valid                     ?? 0,
    simulated_cohort_monitor_status:  input.simulated_cohort_monitor?.status   ?? 'disabled',
  }

  // Stable serialization — keys already sorted alphabetically by declaration
  const stable = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('&')

  const value = `sb-p3.8.17-${djb2(stable)}`

  return {
    value,
    algorithm:    'stable-json-fingerprint-v1',
    source_fields: Object.keys(fields).sort(),
    stable:       true,
  }
}

// ── Evidence Export Packet ────────────────────────────────────────────────────

export function buildEvidenceExportPacket(input = {}, options = {}) {
  const decisionPacket  = input.operator_decision_packet    ?? {}
  const launchDecision  = input.launch_no_launch_decision   ?? {}
  const evidenceMatrix  = input.decision_evidence_matrix    ?? {}
  const microTestReport = input.micro_test_report           ?? {}
  const microTestPolicy = input.micro_test_policy           ?? {}
  const candidateSegs   = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs        = Array.isArray(input.risk_segments)      ? input.risk_segments       : []
  const betaAdmission   = input.beta_admission_review       ?? {}
  const sandbox         = input.private_beta_sandbox        ?? {}
  const ledger          = input.simulated_delivery_ledger   ?? {}
  const cohortMonitor   = input.simulated_cohort_monitor    ?? {}
  const governance      = input.launch_governance           ?? {}
  const noLaunchGov     = input.no_launch_governance        ?? {}
  const hardLocks       = Array.isArray(input.release_hard_locks) ? input.release_hard_locks : []
  const nextActions     = input.operator_next_actions       ?? {}
  const manualReview    = input.manual_review_artifact      ?? {}
  const approvalSim     = input.approval_simulation         ?? {}
  const dryRunReport    = input.beta_dry_run_report         ?? {}

  const decision    = launchDecision.decision ?? 'continue_shadow'
  const packetStatus = decisionPacket.status  ?? 'blocked'
  const now         = new Date().toISOString()

  const sections = [
    {
      code:        'readiness',
      title:       'Readiness',
      status:      evidenceMatrix.overall_grade === 'blocked' ? 'blocked' : 'available',
      grade:       evidenceMatrix.overall_grade ?? 'blocked',
      summary:     `Overall score: ${evidenceMatrix.overall_score ?? 0}/100. Grade: ${evidenceMatrix.overall_grade ?? 'blocked'}.`,
      key_metrics: {
        overall_score:         evidenceMatrix.overall_score         ?? 0,
        passed_domains_count:  evidenceMatrix.passed_domains_count  ?? 0,
        blocked_domains_count: evidenceMatrix.blocked_domains_count ?? 0,
      },
      blockers: (evidenceMatrix.overall_score ?? 0) < 20 ? ['score_below_threshold'] : [],
      warnings: [],
    },
    {
      code:        'micro_test',
      title:       'Micro-Test',
      status:      microTestReport.status ?? 'not_started',
      grade:       microTestPolicy.quality_grade ?? 'not_available',
      summary:     `Micro-Test: ${microTestReport.status ?? 'not_started'}. Sample: ${microTestReport.sample_size ?? 0}.`,
      key_metrics: {
        micro_test_active: input.micro_test_active ?? false,
        sample_size:       microTestReport.sample_size ?? 0,
        hit_rate_pct:      microTestReport.hit_rate_pct ?? 0,
      },
      blockers: !(input.micro_test_active ?? false) ? ['micro_test_not_active'] : [],
      warnings: [],
    },
    {
      code:        'micro_test_policy',
      title:       'Micro-Test Policy',
      status:      microTestPolicy.decision_state ?? 'not_available',
      grade:       microTestPolicy.quality_grade  ?? 'not_available',
      summary:     `Quality: ${microTestPolicy.quality_grade ?? 'not_available'}. Score: ${microTestPolicy.quality_score ?? 0}.`,
      key_metrics: {
        quality_score:     microTestPolicy.quality_score  ?? 0,
        quality_grade:     microTestPolicy.quality_grade  ?? 'not_available',
        decision_state:    microTestPolicy.decision_state ?? 'not_available',
        guardrails_passed: microTestPolicy.guardrails?.passed ?? false,
      },
      blockers: [],
      warnings: [],
    },
    {
      code:        'segment_health',
      title:       'Segment Health',
      status:      candidateSegs.length > 0 ? 'available' : 'not_available',
      grade:       candidateSegs.length > 0 ? 'available' : 'not_available',
      summary:     `${candidateSegs.length} candidatos, ${riskSegs.length} de risco.`,
      key_metrics: { candidate_count: candidateSegs.length, risk_count: riskSegs.length },
      blockers:    candidateSegs.length === 0 ? ['no_candidate_segments'] : [],
      warnings:    riskSegs.length > 0 ? ['risk_segments_present'] : [],
    },
    {
      code:   'beta_admission',
      title:  'Beta Admission',
      status: betaAdmission.status ?? 'blocked',
      grade:  ['can_start_private_beta', 'passed', 'eligible_for_manual_review'].includes(betaAdmission.status ?? '')
        ? 'eligible' : 'blocked',
      summary:     `Admissão: ${betaAdmission.status ?? 'blocked'}.`,
      key_metrics: { admission_status: betaAdmission.status ?? 'blocked' },
      blockers:    ['can_start_private_beta', 'ready_for_review', 'passed', 'eligible_for_manual_review']
        .includes(betaAdmission.status ?? '') ? [] : ['admission_not_ready'],
      warnings:    [],
    },
    {
      code:        'private_beta_sandbox',
      title:       'Private Beta Sandbox',
      status:      sandbox.status ?? 'disabled',
      grade:       sandbox.status === 'completed' ? 'completed' : 'not_ready',
      summary:     `Sandbox: ${sandbox.status ?? 'disabled'}. Ledger: ${ledger.entries_count ?? 0} entradas.`,
      key_metrics: {
        sandbox_status:   sandbox.status          ?? 'disabled',
        sandbox_enabled:  sandbox.enabled         ?? false,
        ledger_entries:   ledger.entries_count    ?? 0,
        dry_run_complete: dryRunReport.dry_run_complete ?? false,
      },
      blockers: sandbox.enabled ? [] : ['sandbox_disabled'],
      warnings: [],
    },
    {
      code:        'simulated_cohort_monitor',
      title:       'Simulated Cohort Monitor',
      status:      cohortMonitor.status ?? 'disabled',
      grade:       ['monitoring_active', 'completed'].includes(cohortMonitor.status ?? '') ? 'active' : 'not_active',
      summary:     `Monitor: ${cohortMonitor.status ?? 'disabled'}.`,
      key_metrics: { monitor_status: cohortMonitor.status ?? 'disabled' },
      blockers:    ['monitoring_active', 'completed'].includes(cohortMonitor.status ?? '') ? [] : ['monitor_not_active'],
      warnings:    [],
    },
    {
      code:        'operator_decision',
      title:       'Operator Decision',
      status:      packetStatus,
      grade:       evidenceMatrix.overall_grade ?? 'blocked',
      summary:     `Decisão: ${decision}. Status: ${packetStatus}.`,
      key_metrics: {
        decision,
        packet_status:  packetStatus,
        overall_score:  evidenceMatrix.overall_score ?? 0,
        overall_grade:  evidenceMatrix.overall_grade ?? 'blocked',
        can_launch:     false,
        can_sell:       false,
        can_beta:       false,
      },
      blockers: decision === 'no_launch' ? ['no_launch'] : decision === 'continue_shadow' ? ['continue_shadow'] : [],
      warnings: [],
    },
    {
      code:        'manual_review_governance',
      title:       'Manual Review Governance',
      status:      manualReview.status ?? 'blocked',
      grade:       manualReview.status ?? 'blocked',
      summary:     `Revisão manual: ${manualReview.status ?? 'blocked'}. Aprovação: ${approvalSim.status ?? 'disabled'}.`,
      key_metrics: {
        artifact_status:       manualReview.status      ?? 'blocked',
        ready_for_review:      manualReview.ready_for_review ?? false,
        approval_sim_status:   approvalSim.status       ?? 'disabled',
        safe_to_invite_users:  false,
        safe_to_sell:          false,
      },
      blockers: manualReview.ready_for_review ? [] : ['artifact_not_ready_for_review'],
      warnings: [],
    },
    {
      code:        'no_launch_governance',
      title:       'No-Launch Governance',
      status:      noLaunchGov.status ?? 'locked',
      grade:       'locked',
      summary:     `No-launch: ${noLaunchGov.status ?? 'locked'}. Release: bloqueado. Beta: bloqueado.`,
      key_metrics: {
        no_launch_status:      noLaunchGov.status            ?? 'locked',
        release_allowed:       false,
        beta_allowed:          false,
        sell_allowed:          false,
        hard_lock_enabled:     noLaunchGov.hard_lock_enabled ?? true,
        requires_future_phase: noLaunchGov.requires_future_phase ?? true,
      },
      blockers: [],
      warnings: [],
    },
    {
      code:        'hard_locks',
      title:       'Release Hard Locks',
      status:      hardLocks.length >= 10 ? 'all_locked' : 'partial',
      grade:       'locked',
      summary:     `${hardLocks.length} hard locks ativos. Todos locked=true.`,
      key_metrics: {
        locks_count:  hardLocks.length,
        all_locked:   hardLocks.length > 0 ? hardLocks.every(l => l.locked) : false,
        can_override: false,
      },
      blockers: [],
      warnings: hardLocks.length < 10 ? ['incomplete_hard_locks'] : [],
    },
    {
      code:        'next_actions',
      title:       'Next Actions',
      status:      (nextActions.actions ?? []).length > 0 ? 'available' : 'not_available',
      grade:       nextActions.status ?? 'action_required',
      summary:     `${(nextActions.actions ?? []).length} ações recomendadas.`,
      key_metrics: {
        actions_count: (nextActions.actions ?? []).length,
        status:        nextActions.status   ?? 'action_required',
        priority:      nextActions.priority ?? 'medium',
      },
      blockers: [],
      warnings: [],
    },
  ]

  const requiredBlocks = [
    'operator_decision_packet', 'decision_evidence_matrix', 'launch_governance',
    'launch_no_launch_decision', 'governance_audit_summary',
    'manual_review_artifact',   'no_launch_governance', 'release_hard_locks',
  ]
  const missingBlocks  = requiredBlocks.filter(b => input[b] == null)
  const presentBlocks  = requiredBlocks.filter(b => input[b] != null)
  const fingerprint    = buildDecisionFingerprint(input, options)

  return {
    status:               'generated',  // ALWAYS generated
    packet_version:       EXPORT_VERSION,
    simulation_only:      true,
    export_allows_beta:   false,  // ALWAYS false
    export_allows_sell:   false,  // ALWAYS false
    decision_fingerprint: fingerprint.value,
    generated_at:         now,
    summary: {
      decision:             decision,
      overall_grade:        evidenceMatrix.overall_grade ?? 'blocked',
      manual_review_status: manualReview.status          ?? 'blocked',
      no_launch_status:     noLaunchGov.status           ?? 'locked',
    },
    sections,
    required_blocks_present: presentBlocks,
    missing_blocks:          missingBlocks,
    redacted_fields:         ['user_ids', 'email_addresses', 'payment_data'],
    safety: {
      can_beta:        false,
      can_sell:        false,
      real_users:      false,
      real_delivery:   false,
      release_allowed: false,
    },
  }
}

// ── Operator Report Render ────────────────────────────────────────────────────

export function renderOperatorReport(input = {}, options = {}) {
  const decision       = input.launch_no_launch_decision?.decision          ?? 'continue_shadow'
  const packetStatus   = input.operator_decision_packet?.status             ?? 'blocked'
  const govStatus      = input.launch_governance?.status                    ?? 'locked'
  const microStatus    = input.micro_test_report?.status                    ?? 'not_started'
  const microActive    = input.micro_test_active                            ?? false
  const sandboxStatus  = input.private_beta_sandbox?.status                 ?? 'disabled'
  const manualStatus   = input.manual_review_artifact?.status               ?? 'blocked'
  const noLaunchSt     = input.no_launch_governance?.status                 ?? 'locked'
  const summaryStatus  = input.manual_review_summary?.status                ?? 'blocked'
  const nextActList    = input.operator_next_actions?.actions               ?? []
  const hardLocksCount = Array.isArray(input.release_hard_locks) ? input.release_hard_locks.length : 0

  const actionLines = nextActList.length > 0
    ? nextActList.slice(0, 5).map((a, i) =>
        `${i + 1}. ${safeString(a.description, safeString(a.label, 'Pending action'))}`)
    : [
        '1. Continue accumulating resolved picks.',
        '2. Keep beta locked.',
        '3. Keep sell locked.',
      ]

  const lines = [
    'SportsBrain Operator Review Report',
    `Generated: ${new Date().toISOString()}`,
    '---',
    `Decision: ${decision}`,
    `Status: ${packetStatus}`,
    `Launch: ${govStatus}`,
    'Beta: blocked',
    'Sell: blocked',
    '',
    'Current State:',
    `- Micro-Test: ${microActive ? 'active' : 'waiting_for_threshold'}`,
    `- Report: ${microStatus}`,
    `- Sandbox: ${sandboxStatus}`,
    `- Manual Review: ${manualStatus}`,
    `- No-Launch: ${noLaunchSt}`,
    `- Summary: ${summaryStatus}`,
    '',
    'Governance Locks:',
    `- Hard Locks: ${hardLocksCount} active`,
    '- Release: blocked',
    '- Beta: blocked',
    '- Sell: blocked',
    '',
    'Required Next Actions:',
    ...actionLines,
    '',
    'Safety Notice:',
    '- Simulation only — no real users',
    '- No commercial claims — internal review only',
    '- Beta and sell remain blocked',
  ]

  return {
    status:      'rendered',
    format:      'plain_text',
    title:       'SportsBrain Operator Review Report',
    lines_count: lines.length,
    text:        lines.join('\n'),
    sections:    [
      { code: 'header',        lines: 3 },
      { code: 'state',         lines: 5 },
      { code: 'current_state', lines: 7 },
      { code: 'governance',    lines: 4 },
      { code: 'next_actions',  lines: actionLines.length + 1 },
      { code: 'safety',        lines: 3 },
    ],
  }
}

// ── Operator Report Summary ────────────────────────────────────────────────────

export function buildOperatorReportSummary(input = {}, options = {}) {
  const decision      = input.launch_no_launch_decision?.decision ?? 'continue_shadow'
  const summaryStatus = input.manual_review_summary?.status       ?? 'blocked'
  const auditSummary  = input.governance_audit_summary            ?? {}
  const nextActList   = input.operator_next_actions?.actions      ?? []

  const hasCritical = (auditSummary.status ?? '') === 'critical_violation'

  let status, headline, operator_instruction
  if (hasCritical) {
    status               = 'critical_violation'
    headline             = 'SportsBrain: violação crítica detectada.'
    operator_instruction = 'Não convidar usuários. Não vender. Investigar violação crítica.'
  } else if (summaryStatus === 'approved_but_locked') {
    status               = 'approved_but_locked'
    headline             = 'SportsBrain: aprovação simulada registrada, no-launch mantido.'
    operator_instruction = 'Não convidar usuários. Não vender. Sistema em fase simulada.'
  } else if (decision === 'ready_for_manual_review') {
    status               = 'ready_for_review'
    headline             = 'SportsBrain pronto para revisão manual do operador.'
    operator_instruction = 'Revisar artifact. Não convidar usuários ainda. Aguardar próxima fase.'
  } else {
    status               = 'blocked'
    headline             = 'SportsBrain permanece em shadow/no-launch.'
    operator_instruction = 'Não convidar usuários. Não vender. Continuar acumulando dados.'
  }

  const topBlockers = []
  if (!(input.micro_test_active ?? false))           topBlockers.push('micro_test_not_active')
  if (!(input.private_beta_sandbox?.enabled ?? false)) topBlockers.push('sandbox_disabled')
  if (hasCritical)                                   topBlockers.push('critical_violation')

  const topWarnings = []
  if ((input.risk_segments ?? []).length > 0) topWarnings.push('risk_segments_present')

  return {
    status,
    headline,
    decision,
    operator_instruction,
    top_blockers:           topBlockers,
    top_warnings:           topWarnings,
    next_actions_count:     nextActList.length,
    safe_to_share_internally: true,
    safe_to_share_publicly:   false,  // ALWAYS false
  }
}

// ── Export Validation Summary ──────────────────────────────────────────────────

export function buildExportValidationSummary(input = {}, options = {}) {
  // Check forbidden true fields in the RAW input
  const forbiddenFields = [
    'can_beta', 'can_sell',
    'can_start_private_beta', 'can_start_public_beta',
    'safe_to_invite_private_users', 'safe_to_open_public_beta', 'safe_to_sell',
    'real_users', 'real_delivery',
    'release_allowed', 'launch_allowed', 'sell_allowed',
    'export_allows_beta', 'export_allows_sell',
  ]

  const forbiddenTrueFields = []
  for (const field of forbiddenFields) {
    if (input[field] === true || input[field] === 'true') {
      forbiddenTrueFields.push({
        field,
        value:    true,
        severity: 'blocker',
        message:  `Field ${field}=true violates safety invariant`,
      })
    }
  }

  // Check required blocks present
  const requiredBlocks = [
    'operator_decision_packet', 'decision_evidence_matrix', 'launch_governance',
    'launch_no_launch_decision', 'governance_audit_summary',
    'manual_review_artifact',   'no_launch_governance', 'release_hard_locks',
    'operator_review_audit_trail', 'manual_review_summary',
  ]

  const missingBlocks  = requiredBlocks.filter(b => input[b] == null)
  const presentBlocks  = requiredBlocks.filter(b => input[b] != null)

  const hasViolations   = forbiddenTrueFields.length > 0
  const hasMissingBlocks = missingBlocks.length > 0

  let status
  if (hasViolations)       status = 'invalid'
  else if (hasMissingBlocks) status = 'valid_with_warnings'
  else                     status = 'valid'

  return {
    status,
    valid:                 !hasViolations,
    required_blocks_count: requiredBlocks.length,
    present_blocks_count:  presentBlocks.length,
    missing_blocks:        missingBlocks,
    forbidden_true_fields: forbiddenTrueFields,
    warnings:              missingBlocks.map(b => `missing_block:${b}`),
    blockers:              forbiddenTrueFields.map(f => `forbidden_true_field:${f.field}`),
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateEvidenceExport(input = {}, options = {}) {
  const safeInput = input ?? {}

  // Validation runs on RAW input to detect violations
  const validationSummary = buildExportValidationSummary(safeInput, options)

  // Sanitised input — all unsafe flags forced to false
  const cleanInput = {
    ...safeInput,
    can_beta:           false,
    can_sell:           false,
    real_users:         false,
    real_delivery:      false,
    release_allowed:    false,
    launch_allowed:     false,
    export_allows_beta: false,
    export_allows_sell: false,
  }

  const fingerprint   = buildDecisionFingerprint(cleanInput, options)
  const exportPacket  = buildEvidenceExportPacket(cleanInput, options)
  const reportRender  = renderOperatorReport(cleanInput, options)
  const reportSummary = buildOperatorReportSummary(cleanInput, options)

  // Governance regression uses cleanInput + the just-built export packet
  const { governance_regression_suite } = evaluateGovernanceRegression(
    { ...cleanInput, evidence_export_packet: exportPacket },
    options
  )

  return {
    evidence_export_packet:     exportPacket,
    operator_report_render:     reportRender,
    operator_report_summary:    reportSummary,
    decision_fingerprint:       fingerprint,
    export_validation_summary:  validationSummary,
    governance_regression_suite,
  }
}
