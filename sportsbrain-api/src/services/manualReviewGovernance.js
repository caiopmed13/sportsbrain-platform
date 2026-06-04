// src/services/manualReviewGovernance.js
// P3.8.16 — Manual Review Artifact, Approval Simulation & No-Launch Governance Hardening

const REVIEW_VERSION = 'p3.8.16'

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeReviewBoolean(value) {
  return value === true || value === 'true'
}

// ── Build Manual Review Artifact ──────────────────────────────────────────────

export function buildManualReviewArtifact(input = {}, options = {}) {
  const decisionPacket  = input.operator_decision_packet    ?? {}
  const launchDecision  = input.launch_no_launch_decision   ?? {}
  const evidenceMatrix  = input.decision_evidence_matrix    ?? {}
  const microTestReport = input.micro_test_report           ?? {}
  const microTestPolicy = input.micro_test_policy           ?? {}
  const candidateSegs   = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs        = Array.isArray(input.risk_segments) ? input.risk_segments : []
  const betaAdmission   = input.beta_admission_review       ?? {}
  const sandbox         = input.private_beta_sandbox        ?? {}
  const ledger          = input.simulated_delivery_ledger   ?? {}
  const cohortMonitor   = input.simulated_cohort_monitor    ?? {}
  const checklist       = input.operator_approval_checklist ?? {}
  const dryRunReport    = input.beta_dry_run_report         ?? {}
  const governance      = input.launch_governance           ?? {}
  const auditSummary    = input.governance_audit_summary    ?? {}

  const hasCritical    = (auditSummary.status ?? '') === 'critical_violation' ||
    normalizeReviewBoolean(input.real_users) ||
    normalizeReviewBoolean(input.real_delivery)
  const decisionStatus = decisionPacket.status ?? ''
  const decision       = launchDecision.decision ?? 'continue_shadow'
  const microTestActive = normalizeReviewBoolean(input.micro_test_active)
  const isReadyForReview = decisionStatus === 'manual_review_ready' ||
    decision === 'ready_for_manual_review'

  // ── Artifact status ────────────────────────────────────────────────────────
  let artifactStatus
  if (hasCritical) {
    artifactStatus = 'critical_violation'
  } else if (isReadyForReview) {
    const hasWarnings = (auditSummary.warnings ?? []).length > 0 ||
      dryRunReport.status === 'completed_with_warnings' ||
      riskSegs.length > 0
    artifactStatus = hasWarnings ? 'ready_with_warnings' : 'ready'
  } else {
    artifactStatus = 'blocked'
  }

  const blockers = []
  if (!isReadyForReview) blockers.push('decision_not_ready_for_review')
  if (hasCritical)       blockers.push('critical_violation_detected')

  const now = new Date().toISOString()

  // ── 12 required sections ───────────────────────────────────────────────────
  const sections = [
    {
      code:       'executive_summary',
      title:      'Executive Summary',
      status:     hasCritical ? 'critical_violation' : isReadyForReview ? 'ready' : 'blocked',
      summary:    hasCritical
        ? 'Violação crítica detectada. Nenhuma ação pode ser tomada.'
        : isReadyForReview
          ? 'SportsBrain completou etapas técnicas e está pronto para revisão manual do operador.'
          : 'SportsBrain permanece em shadow/sandbox. Revisão manual ainda não está disponível.',
      key_points: [
        `decision=${decision}`,
        `overall_score=${evidenceMatrix.overall_score ?? 0}`,
        `overall_grade=${evidenceMatrix.overall_grade ?? 'blocked'}`,
      ],
      evidence: {
        decision,
        overall_score:  evidenceMatrix.overall_score ?? 0,
        overall_grade:  evidenceMatrix.overall_grade ?? 'blocked',
      },
    },
    {
      code:       'current_decision',
      title:      'Current Decision',
      status:     hasCritical ? 'critical_violation' : decision === 'ready_for_manual_review' ? 'ready' : 'blocked',
      summary:    `Decisão atual: ${decision}`,
      key_points: [`decision=${decision}`, 'can_launch=false', 'can_sell=false'],
      evidence:   { decision, can_launch: false, can_sell: false, can_beta: false },
    },
    {
      code:       'readiness_snapshot',
      title:      'Readiness Snapshot',
      status:     (evidenceMatrix.overall_score ?? 0) >= 50 ? 'ready' : 'blocked',
      summary:    `Overall score: ${evidenceMatrix.overall_score ?? 0}/100. Grade: ${evidenceMatrix.overall_grade ?? 'blocked'}.`,
      key_points: [
        `passed_domains=${evidenceMatrix.passed_domains_count ?? 0}`,
        `blocked_domains=${evidenceMatrix.blocked_domains_count ?? 0}`,
      ],
      evidence: {
        overall_score:         evidenceMatrix.overall_score ?? 0,
        overall_grade:         evidenceMatrix.overall_grade ?? 'blocked',
        passed_domains_count:  evidenceMatrix.passed_domains_count ?? 0,
        blocked_domains_count: evidenceMatrix.blocked_domains_count ?? 0,
      },
    },
    {
      code:       'micro_test_snapshot',
      title:      'Micro-Test Snapshot',
      status:     microTestActive ? 'ready' : 'blocked',
      summary:    `Micro-test: ${microTestActive ? 'ativo' : 'não ativo'}. Sample: ${microTestReport.sample_size ?? 0}.`,
      key_points: [
        `micro_test_active=${microTestActive}`,
        `sample_size=${microTestReport.sample_size ?? 0}`,
        `quality_grade=${microTestPolicy.quality_grade ?? 'not_available'}`,
      ],
      evidence: {
        micro_test_active: microTestActive,
        sample_size:       microTestReport.sample_size ?? 0,
        quality_grade:     microTestPolicy.quality_grade ?? 'not_available',
        quality_score:     microTestPolicy.quality_score ?? 0,
      },
    },
    {
      code:       'segment_health_snapshot',
      title:      'Segment Health Snapshot',
      status:     candidateSegs.length > 0 ? 'ready' : 'blocked',
      summary:    `${candidateSegs.length} candidatos, ${riskSegs.length} de risco.`,
      key_points: [
        `candidate_segments=${candidateSegs.length}`,
        `risk_segments=${riskSegs.length}`,
      ],
      evidence: {
        candidate_count: candidateSegs.length,
        risk_count:      riskSegs.length,
      },
    },
    {
      code:   'beta_admission_snapshot',
      title:  'Beta Admission Snapshot',
      status: ['can_start_private_beta', 'ready_for_review', 'passed', 'eligible_for_manual_review']
        .includes(betaAdmission.status ?? '') ? 'ready' : 'blocked',
      summary:    `Admissão: ${betaAdmission.status ?? 'blocked'}.`,
      key_points: [`admission_status=${betaAdmission.status ?? 'blocked'}`],
      evidence:   { admission_status: betaAdmission.status ?? 'blocked' },
    },
    {
      code:   'sandbox_snapshot',
      title:  'Private Beta Sandbox Snapshot',
      status: normalizeReviewBoolean(sandbox.enabled)
        ? (sandbox.status === 'completed' ? 'ready' : 'watch')
        : 'blocked',
      summary:    `Sandbox: ${sandbox.status ?? 'disabled'}.`,
      key_points: [
        `sandbox_status=${sandbox.status ?? 'disabled'}`,
        `sandbox_enabled=${normalizeReviewBoolean(sandbox.enabled)}`,
      ],
      evidence: {
        sandbox_status:  sandbox.status ?? 'disabled',
        sandbox_enabled: normalizeReviewBoolean(sandbox.enabled),
      },
    },
    {
      code:   'cohort_monitor_snapshot',
      title:  'Simulated Cohort Monitor Snapshot',
      status: ['monitoring_active', 'completed'].includes(cohortMonitor.status ?? '') ? 'ready' : 'blocked',
      summary:    `Monitor: ${cohortMonitor.status ?? 'disabled'}. Checklist: ${checklist.status ?? 'blocked'}.`,
      key_points: [
        `monitor_status=${cohortMonitor.status ?? 'disabled'}`,
        `checklist_status=${checklist.status ?? 'blocked'}`,
        `checklist_passed=${checklist.passed_count ?? 0}`,
      ],
      evidence: {
        monitor_status:   cohortMonitor.status ?? 'disabled',
        checklist_status: checklist.status ?? 'blocked',
        passed_count:     checklist.passed_count ?? 0,
      },
    },
    {
      code:   'dry_run_snapshot',
      title:  'Beta Dry-Run Snapshot',
      status: dryRunReport.dry_run_complete ? 'ready' : 'blocked',
      summary:    `Dry-run: ${dryRunReport.status ?? 'not_started'}.`,
      key_points: [
        `dry_run_status=${dryRunReport.status ?? 'not_started'}`,
        `dry_run_complete=${dryRunReport.dry_run_complete ?? false}`,
        'real_users=false',
        'real_delivery=false',
      ],
      evidence: {
        dry_run_status:    dryRunReport.status ?? 'not_started',
        dry_run_complete:  dryRunReport.dry_run_complete ?? false,
        real_users:        false,
        real_delivery:     false,
      },
    },
    {
      code:   'governance_snapshot',
      title:  'Launch Governance Snapshot',
      status: 'locked',
      summary:    `Governança: ${governance.status ?? 'locked'}. Launch: bloqueado. Sell: bloqueado.`,
      key_points: [
        `governance_status=${governance.status ?? 'locked'}`,
        'launch_allowed=false',
        'sell_allowed=false',
        'can_beta=false',
        'can_sell=false',
      ],
      evidence: {
        governance_status: governance.status ?? 'locked',
        launch_allowed:    false,
        sell_allowed:      false,
        can_beta:          false,
        can_sell:          false,
      },
    },
    {
      code:   'risk_summary',
      title:  'Risk Summary',
      status: hasCritical ? 'critical_violation' : riskSegs.length > 0 ? 'watch' : 'ok',
      summary: hasCritical
        ? 'Violações críticas detectadas. Investigar imediatamente.'
        : riskSegs.length > 0
          ? `${riskSegs.length} segmentos de risco identificados. Revisar antes de avançar.`
          : 'Sem riscos críticos identificados.',
      key_points: [
        `risk_segments=${riskSegs.length}`,
        `critical_violations=${hasCritical ? 1 : 0}`,
        'unsafe_inputs=none',
      ],
      evidence: {
        risk_segments_count: riskSegs.length,
        has_critical:        hasCritical,
        can_beta:            false,
        can_sell:            false,
      },
    },
    {
      code:   'required_operator_actions',
      title:  'Required Operator Actions',
      status: isReadyForReview ? 'ready' : 'blocked',
      summary: isReadyForReview
        ? 'Revisar artifact, responder perguntas do operador e aguardar próxima fase.'
        : 'Continuar acumulando dados. Beta e venda permanecem bloqueados.',
      key_points: [
        'keep_beta_locked',
        'keep_sell_locked',
        'continue_shadow_until_next_phase',
      ],
      evidence: {
        can_beta:         false,
        can_sell:         false,
        simulation_only:  true,
      },
    },
  ]

  // ── Required Evidence (12 items) ───────────────────────────────────────────
  const required_evidence = [
    {
      code:                  'micro_test_status',
      label:                 'Status do Micro-Test',
      value:                 microTestReport.status ?? 'not_started',
      required:              true,
      present:               (microTestReport.status ?? 'not_started') !== 'not_started',
      acceptable_for_review: microTestActive,
    },
    {
      code:                  'micro_test_sample_size',
      label:                 'Tamanho da Amostra do Micro-Test',
      value:                 microTestReport.sample_size ?? 0,
      required:              true,
      present:               (microTestReport.sample_size ?? 0) > 0,
      acceptable_for_review: (microTestReport.sample_size ?? 0) >= 50,
    },
    {
      code:                  'micro_test_quality_grade',
      label:                 'Grade de Qualidade do Micro-Test',
      value:                 microTestPolicy.quality_grade ?? 'not_available',
      required:              true,
      present:               (microTestPolicy.quality_grade ?? 'not_available') !== 'not_available',
      acceptable_for_review: ['good', 'excellent', 'acceptable'].includes(microTestPolicy.quality_grade ?? ''),
    },
    {
      code:                  'candidate_segments_count',
      label:                 'Quantidade de Segmentos Candidatos',
      value:                 candidateSegs.length,
      required:              true,
      present:               candidateSegs.length > 0,
      acceptable_for_review: candidateSegs.length > 0,
    },
    {
      code:                  'risk_segments_count',
      label:                 'Quantidade de Segmentos de Risco',
      value:                 riskSegs.length,
      required:              false,
      present:               true,
      acceptable_for_review: true,
    },
    {
      code:                  'beta_admission_status',
      label:                 'Status de Admissão Beta',
      value:                 betaAdmission.status ?? 'blocked',
      required:              true,
      present:               true,
      acceptable_for_review: ['can_start_private_beta', 'ready_for_review', 'passed', 'eligible_for_manual_review']
        .includes(betaAdmission.status ?? ''),
    },
    {
      code:                  'sandbox_status',
      label:                 'Status do Sandbox',
      value:                 sandbox.status ?? 'disabled',
      required:              true,
      present:               (sandbox.status ?? 'disabled') !== 'disabled',
      acceptable_for_review: normalizeReviewBoolean(sandbox.enabled),
    },
    {
      code:                  'ledger_status',
      label:                 'Status do Ledger Simulado',
      value:                 ledger.status ?? 'not_started',
      required:              true,
      present:               (ledger.entries_count ?? 0) > 0,
      acceptable_for_review: (ledger.entries_count ?? 0) > 0,
    },
    {
      code:                  'cohort_monitor_status',
      label:                 'Status do Monitor de Cohort',
      value:                 cohortMonitor.status ?? 'disabled',
      required:              true,
      present:               (cohortMonitor.status ?? 'disabled') !== 'disabled',
      acceptable_for_review: ['monitoring_active', 'completed'].includes(cohortMonitor.status ?? ''),
    },
    {
      code:                  'operator_decision',
      label:                 'Decisão do Operador',
      value:                 decision,
      required:              true,
      present:               true,
      acceptable_for_review: decision === 'ready_for_manual_review',
    },
    {
      code:                  'launch_governance_status',
      label:                 'Status da Governança de Launch',
      value:                 governance.status ?? 'locked',
      required:              true,
      present:               true,
      acceptable_for_review: false,  // always blocked in P3.8.16
    },
    {
      code:                  'governance_audit_status',
      label:                 'Status da Auditoria de Governança',
      value:                 auditSummary.status ?? 'clean',
      required:              true,
      present:               true,
      acceptable_for_review: (auditSummary.status ?? 'clean') === 'clean',
    },
  ]

  // ── Operator Questions (8 required) ───────────────────────────────────────
  const operator_questions = [
    {
      code:                   'review_sample_size',
      question:               'A amostra do Micro-Test é suficiente para revisar a próxima fase?',
      required:               true,
      suggested_answer:       'Não, continuar acumulando dados.',
      blocking_if_unanswered: true,
    },
    {
      code:                   'review_segment_stability',
      question:               'Os segmentos candidatos estão estáveis?',
      required:               true,
      suggested_answer:       'Revisar após mais dados acumulados.',
      blocking_if_unanswered: true,
    },
    {
      code:                   'review_segment_risks',
      question:               'Os riscos por segmento foram revisados?',
      required:               true,
      suggested_answer:       'Não, aguardar análise de drift.',
      blocking_if_unanswered: true,
    },
    {
      code:                   'review_ledger_coherence',
      question:               'O ledger simulado está coerente?',
      required:               true,
      suggested_answer:       'Verificar após mais acumulação.',
      blocking_if_unanswered: false,
    },
    {
      code:                   'review_drift_relevance',
      question:               'Há drift relevante no ledger simulado?',
      required:               true,
      suggested_answer:       'Monitorar nas próximas iterações.',
      blocking_if_unanswered: false,
    },
    {
      code:                   'review_safety_violations',
      question:               'Existe qualquer violação de safety nos dados?',
      required:               true,
      suggested_answer:       'Não, nenhuma violação crítica detectada.',
      blocking_if_unanswered: true,
    },
    {
      code:                   'keep_beta_blocked',
      question:               'O beta deve permanecer bloqueado?',
      required:               true,
      suggested_answer:       'Sim, manter beta bloqueado nesta fase.',
      blocking_if_unanswered: true,
    },
    {
      code:                   'keep_sell_blocked',
      question:               'A venda deve permanecer bloqueada?',
      required:               true,
      suggested_answer:       'Sim, manter venda bloqueada nesta fase.',
      blocking_if_unanswered: true,
    },
  ]

  const warnings = []
  if (!isReadyForReview && !hasCritical) warnings.push('conditions_not_met_for_review')

  return {
    status:          artifactStatus,
    artifact_version: REVIEW_VERSION,
    generated_at:    now,
    review_type:     'manual_operator_review',
    simulation_only: true,
    ready_for_review: artifactStatus === 'ready' || artifactStatus === 'ready_with_warnings',
    sections,
    required_evidence,
    blockers,
    warnings,
    operator_questions,
  }
}

// ── Approval Simulation ────────────────────────────────────────────────────────

export function evaluateApprovalSimulation(input = {}, options = {}) {
  const simulationEnabled  = normalizeReviewBoolean(options.MANUAL_REVIEW_SIMULATION_ENABLED ?? false)
  const simulatedApproval  = normalizeReviewBoolean(options.MANUAL_REVIEW_SIMULATED_APPROVAL ?? false)
  const simulatedRejection = normalizeReviewBoolean(options.MANUAL_REVIEW_SIMULATED_REJECTION ?? false)
  const noLaunchHardLock   = options.NO_LAUNCH_HARD_LOCK !== undefined
    ? normalizeReviewBoolean(options.NO_LAUNCH_HARD_LOCK)
    : true  // default: always locked

  const hasCritical = normalizeReviewBoolean(input.can_beta) ||
    normalizeReviewBoolean(input.can_sell) ||
    normalizeReviewBoolean(input.real_users) ||
    normalizeReviewBoolean(input.real_delivery)

  // Simulation disabled
  if (!simulationEnabled) {
    return {
      status:               'disabled',
      enabled:              false,
      simulated_approval:   false,
      simulated_rejection:  false,
      effective_result:     'not_requested',
      can_override_no_launch: false,
      can_enable_beta:      false,  // ALWAYS false
      can_enable_sell:      false,  // ALWAYS false
      reason:               'simulation_disabled',
    }
  }

  // Critical violation (unsafe input detected)
  if (hasCritical) {
    return {
      status:               'critical_violation',
      enabled:              true,
      simulated_approval:   false,
      simulated_rejection:  false,
      effective_result:     'critical_violation',
      can_override_no_launch: false,
      can_enable_beta:      false,
      can_enable_sell:      false,
      reason:               'critical_violation_detected',
    }
  }

  // Conflict: both approval and rejection
  if (simulatedApproval && simulatedRejection) {
    return {
      status:               'conflict',
      enabled:              true,
      simulated_approval:   false,
      simulated_rejection:  false,
      effective_result:     'conflict',
      can_override_no_launch: false,
      can_enable_beta:      false,
      can_enable_sell:      false,
      reason:               'conflict_approval_and_rejection_both_true',
    }
  }

  // Rejection
  if (simulatedRejection) {
    return {
      status:               'rejected',
      enabled:              true,
      simulated_approval:   false,
      simulated_rejection:  true,
      effective_result:     'rejected',
      can_override_no_launch: false,
      can_enable_beta:      false,
      can_enable_sell:      false,
      reason:               'simulated_rejection_active',
    }
  }

  // Approval with hard lock
  if (simulatedApproval && noLaunchHardLock) {
    return {
      status:               'blocked_by_no_launch_lock',
      enabled:              true,
      simulated_approval:   true,
      simulated_rejection:  false,
      effective_result:     'blocked_by_no_launch_lock',
      can_override_no_launch: false,
      can_enable_beta:      false,  // ALWAYS false even with approval
      can_enable_sell:      false,  // ALWAYS false even with approval
      reason:               'no_launch_hard_lock_blocks_approval',
    }
  }

  // Approval without hard lock (still can't enable beta/sell in P3.8.16)
  if (simulatedApproval && !noLaunchHardLock) {
    return {
      status:               'approved',
      enabled:              true,
      simulated_approval:   true,
      simulated_rejection:  false,
      effective_result:     'approved',
      can_override_no_launch: false,
      can_enable_beta:      false,  // ALWAYS false — P3.8.16
      can_enable_sell:      false,  // ALWAYS false — P3.8.16
      reason:               'simulated_approval_active_no_launch_lock_disabled',
    }
  }

  // Simulation enabled but no action
  return {
    status:               'not_requested',
    enabled:              true,
    simulated_approval:   false,
    simulated_rejection:  false,
    effective_result:     'not_requested',
    can_override_no_launch: false,
    can_enable_beta:      false,
    can_enable_sell:      false,
    reason:               'simulation_enabled_no_action_requested',
  }
}

// ── No-Launch Governance ───────────────────────────────────────────────────────

export function buildNoLaunchGovernance(input = {}, options = {}) {
  const approvalSimulation = input._approval_simulation ?? {}
  const approvalStatus     = approvalSimulation.status ?? 'disabled'

  const hasCritical = normalizeReviewBoolean(input.real_users) ||
    normalizeReviewBoolean(input.real_delivery) ||
    (input.governance_audit_summary?.status ?? '') === 'critical_violation'

  let status
  if (hasCritical) {
    status = 'critical_violation'
  } else if (approvalStatus === 'approved' || approvalStatus === 'blocked_by_no_launch_lock') {
    status = 'locked_with_approval_simulation'
  } else {
    status = 'locked'
  }

  return {
    status,
    hard_lock_enabled:    true,   // ALWAYS true in P3.8.16
    no_launch_enforced:   true,
    release_allowed:      false,  // ALWAYS false
    beta_allowed:         false,  // ALWAYS false
    sell_allowed:         false,  // ALWAYS false
    override_allowed:     false,
    requires_future_phase: true,
    required_future_phase: 'P3.8.17',
    locks: ['private_beta_locked', 'public_beta_locked', 'sell_locked', 'release_locked'],
  }
}

// ── Release Hard Locks ─────────────────────────────────────────────────────────

export function buildReleaseHardLocks(input = {}, options = {}) {
  return [
    {
      code:                 'no_real_users_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Nenhum usuário real permitido nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'no_real_delivery_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Nenhuma entrega real permitida nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'private_beta_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Beta privado permanece bloqueado nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'public_beta_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Beta público permanece bloqueado nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'sell_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Venda permanece bloqueada nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'checkout_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Checkout permanece bloqueado nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'webhook_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Webhook de entrega real permanece bloqueado nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'email_delivery_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Entrega por email permanece bloqueada nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'claim_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Claims comerciais permanecem bloqueados nesta fase.',
      can_be_overridden_now: false,
    },
    {
      code:                 'future_phase_required_lock',
      locked:               true,
      severity:             'blocker',
      description:          'Fase futura requerida (P3.8.17) antes de qualquer liberação.',
      can_be_overridden_now: false,
    },
  ]
}

// ── Operator Review Audit Trail ────────────────────────────────────────────────

export function buildOperatorReviewAuditTrail(input = {}, options = {}) {
  const now             = new Date().toISOString()
  const hasCritical     = input._unsafe_input_detected === true
  const approvalSim     = input._approval_simulation ?? {}
  const evidenceMatrix  = input.decision_evidence_matrix ?? {}

  const entries = [
    {
      code:       'artifact_generated',
      level:      'info',
      message:    'Manual review artifact generated.',
      evidence:   { artifact_version: REVIEW_VERSION, simulation_only: true },
      created_at: now,
    },
    {
      code:       'evidence_matrix_read',
      level:      'info',
      message:    'Decision evidence matrix read and processed.',
      evidence:   {
        overall_score: evidenceMatrix.overall_score ?? 0,
        overall_grade: evidenceMatrix.overall_grade ?? 'blocked',
      },
      created_at: now,
    },
    {
      code:       'approval_simulation_checked',
      level:      'info',
      message:    `Approval simulation checked. Status: ${approvalSim.status ?? 'disabled'}.`,
      evidence:   {
        simulation_status: approvalSim.status ?? 'disabled',
        can_enable_beta:   false,
        can_enable_sell:   false,
      },
      created_at: now,
    },
    {
      code:       'no_launch_lock_checked',
      level:      'info',
      message:    'No-launch hard lock checked. Lock active.',
      evidence:   { hard_lock_enabled: true, release_allowed: false },
      created_at: now,
    },
    {
      code:       'hard_locks_applied',
      level:      'info',
      message:    'All 10 release hard locks applied.',
      evidence:   { locks_count: 10, all_locked: true },
      created_at: now,
    },
  ]

  // Unsafe input entry only when detected
  if (hasCritical) {
    entries.push({
      code:       'unsafe_input_detected',
      level:      'critical',
      message:    'Unsafe input detected and overridden. Safety invariants enforced.',
      evidence:   {
        can_beta:         false,
        can_sell:         false,
        real_users:       false,
        real_delivery:    false,
        release_allowed:  false,
      },
      created_at: now,
    })
  }

  entries.push({
    code:       'final_no_launch_enforced',
    level:      'info',
    message:    'Final no-launch decision enforced. Release blocked.',
    evidence:   {
      release_allowed: false,
      beta_allowed:    false,
      sell_allowed:    false,
      can_beta:        false,
      can_sell:        false,
    },
    created_at: now,
  })

  return {
    status:          'recorded',
    simulation_only: true,
    entries_count:   entries.length,
    entries,
  }
}

// ── Manual Review Summary ──────────────────────────────────────────────────────

export function buildManualReviewSummary(input = {}, options = {}) {
  const decisionPacket   = input.operator_decision_packet  ?? {}
  const approvalSim      = input._approval_simulation      ?? {}
  const launchDecision   = input.launch_no_launch_decision ?? {}
  const auditSummary     = input.governance_audit_summary  ?? {}

  const hasCritical    = (auditSummary.status ?? '') === 'critical_violation' ||
    normalizeReviewBoolean(input.real_users) ||
    normalizeReviewBoolean(input.real_delivery)
  const decisionStatus = decisionPacket.status ?? ''
  const decision       = launchDecision.decision ?? 'continue_shadow'
  const approvalStatus = approvalSim.status ?? 'disabled'

  const isReadyForReview = decisionStatus === 'manual_review_ready' ||
    decision === 'ready_for_manual_review'
  const isApproved = approvalStatus === 'approved' || approvalStatus === 'blocked_by_no_launch_lock'
  const isRejected = approvalStatus === 'rejected'

  let status, headline, summary_text, operator_instruction, next_action

  if (hasCritical) {
    status               = 'critical_violation'
    headline             = 'Violação crítica. Nenhuma ação pode ser tomada.'
    summary_text         = 'O sistema detectou violação de segurança. Investigar imediatamente.'
    operator_instruction = 'Não convidar usuários. Não vender. Investigar violação crítica.'
    next_action          = 'Investigar e corrigir violações antes de prosseguir.'
  } else if (isRejected) {
    status               = 'rejected'
    headline             = 'Aprovação simulada rejeitada. Sistema continua no-launch.'
    summary_text         = 'A simulação de aprovação foi rejeitada. Sistema permanece bloqueado.'
    operator_instruction = 'Não convidar usuários. Não vender. Revisão rejeitada.'
    next_action          = 'Revisar razões da rejeição e corrigir antes de próxima tentativa.'
  } else if (isApproved) {
    status               = 'approved_but_locked'
    headline             = 'Aprovação simulada registrada, mas sistema permanece no-launch por política.'
    summary_text         = 'A aprovação simulada foi registrada. Governança no-launch mantém sistema bloqueado.'
    operator_instruction = 'Não convidar usuários reais. Não vender. Sistema ainda em fase simulada.'
    next_action          = 'Iniciar P3.8.17 para habilitar possibilidade de release controlado.'
  } else if (isReadyForReview) {
    status               = 'ready_for_review'
    headline             = 'Sistema pronto para revisão manual do operador.'
    summary_text         = 'SportsBrain completou etapas técnicas. Aguardando revisão manual e aprovação do operador.'
    operator_instruction = 'Revisar artifact de decisão. Responder perguntas obrigatórias. Não convidar usuários ainda.'
    next_action          = 'Completar revisão manual e aguardar próxima fase antes de qualquer liberação.'
  } else {
    status               = 'blocked'
    headline             = 'Revisão manual ainda não pode liberar beta.'
    summary_text         = 'O sistema permanece em no-launch por política.'
    operator_instruction = 'Não convidar usuários. Não vender. Continuar shadow/sandbox.'
    next_action          = 'Continuar shadow/sandbox e manter beta/venda bloqueados.'
  }

  return {
    status,
    headline,
    summary_text,
    operator_instruction,
    next_action,
    safe_to_invite_private_users: false,  // ALWAYS false
    safe_to_sell:                 false,  // ALWAYS false
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateManualReviewGovernance(input = {}, options = {}) {
  const safeInput = input ?? {}

  // Normalize flag options (with safe defaults)
  const safeOptions = {
    ...options,
    MANUAL_REVIEW_SIMULATION_ENABLED:  normalizeReviewBoolean(options.MANUAL_REVIEW_SIMULATION_ENABLED  ?? false),
    MANUAL_REVIEW_SIMULATED_APPROVAL:  normalizeReviewBoolean(options.MANUAL_REVIEW_SIMULATED_APPROVAL  ?? false),
    MANUAL_REVIEW_SIMULATED_REJECTION: normalizeReviewBoolean(options.MANUAL_REVIEW_SIMULATED_REJECTION ?? false),
    NO_LAUNCH_HARD_LOCK: options.NO_LAUNCH_HARD_LOCK !== undefined
      ? normalizeReviewBoolean(options.NO_LAUNCH_HARD_LOCK)
      : true,  // default: always locked
  }

  // Detect unsafe inputs BEFORE sanitising
  const unsafeInputDetected =
    normalizeReviewBoolean(safeInput.can_beta) ||
    normalizeReviewBoolean(safeInput.can_sell) ||
    normalizeReviewBoolean(safeInput.real_users) ||
    normalizeReviewBoolean(safeInput.real_delivery) ||
    normalizeReviewBoolean(safeInput.release_allowed) ||
    normalizeReviewBoolean(safeInput.launch_allowed)

  // Sanitised input — all unsafe flags forced to false
  const cleanInput = {
    ...safeInput,
    can_beta:                     false,
    can_sell:                     false,
    real_users:                   false,
    real_delivery:                false,
    release_allowed:              false,
    launch_allowed:               false,
    safe_to_invite_private_users: false,
    safe_to_sell:                 false,
  }

  // Build components in dependency order
  const approvalSimulation  = evaluateApprovalSimulation(cleanInput, safeOptions)
  const inputWithApproval   = { ...cleanInput, _approval_simulation: approvalSimulation }

  const artifact            = buildManualReviewArtifact(cleanInput, safeOptions)
  const noLaunchGovernance  = buildNoLaunchGovernance(inputWithApproval, safeOptions)
  const hardLocks           = buildReleaseHardLocks(cleanInput, safeOptions)
  const auditTrail          = buildOperatorReviewAuditTrail(
    { ...inputWithApproval, _unsafe_input_detected: unsafeInputDetected },
    safeOptions
  )
  const summary             = buildManualReviewSummary(inputWithApproval, safeOptions)

  return {
    manual_review_artifact:      artifact,
    approval_simulation:         approvalSimulation,
    no_launch_governance:        noLaunchGovernance,
    release_hard_locks:          hardLocks,
    operator_review_audit_trail: auditTrail,
    manual_review_summary:       summary,
  }
}
