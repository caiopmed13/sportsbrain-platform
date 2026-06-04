// src/services/operatorDecisionPacket.js
// P3.8.15 — Operator Decision Packet, Beta Dry-Run Report & Launch-No-Launch Governance

const PACKET_VERSION = 'p3.8.15'

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeDecisionBoolean(value) {
  return value === true || value === 'true'
}

// ── Evidence Matrix ───────────────────────────────────────────────────────────

export function buildDecisionEvidenceMatrix(input = {}, options = {}) {
  const microTestActive    = normalizeDecisionBoolean(input.micro_test_active)
  const canMicroTest       = normalizeDecisionBoolean(input.can_micro_test)
  const resolvedValid      = Number(input.resolved_valid ?? 0)
  const threshold          = Number(input.micro_test_threshold ?? 50)
  const microTestReport    = input.micro_test_report  ?? {}
  const microTestPolicy    = input.micro_test_policy  ?? {}
  const candidateSegs      = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs           = Array.isArray(input.risk_segments) ? input.risk_segments : []
  const betaAdmission      = input.beta_admission_review ?? {}
  const sandbox            = input.private_beta_sandbox  ?? {}
  const auditSummary       = input.sandbox_audit_summary ?? {}
  const cohortMonitor      = input.simulated_cohort_monitor ?? {}
  const checklist          = input.operator_approval_checklist ?? {}

  const canBeta      = normalizeDecisionBoolean(input.can_beta)
  const canSell      = normalizeDecisionBoolean(input.can_sell)
  const realUsers    = normalizeDecisionBoolean(input.real_users)
  const realDelivery = normalizeDecisionBoolean(input.real_delivery)
  const hasCritical  = (auditSummary.status ?? '') === 'critical_violation' || realUsers || realDelivery

  // ── readiness (max 10) ──
  const readinessScore = resolvedValid >= threshold ? 10 : resolvedValid > 0 ? 5 : 0
  const readinessDomain = {
    domain:   'readiness',
    status:   resolvedValid >= threshold ? 'passed' : resolvedValid > 0 ? 'watch' : 'blocked',
    score:    readinessScore,
    grade:    readinessScore >= 8 ? 'healthy' : readinessScore >= 4 ? 'watch' : 'not_available',
    passed:   resolvedValid >= threshold,
    blockers: resolvedValid < threshold ? ['threshold_not_reached'] : [],
    warnings: [],
    evidence: { resolved_valid: resolvedValid, threshold },
  }

  // ── micro_test_gate (max 15) ──
  const microGateScore = microTestActive ? 15 : canMicroTest ? 7 : 0
  const microGateDomain = {
    domain:   'micro_test_gate',
    status:   microTestActive ? 'passed' : 'blocked',
    score:    microGateScore,
    grade:    microTestActive ? 'active' : 'not_available',
    passed:   microTestActive,
    blockers: microTestActive ? [] : ['micro_test_not_active'],
    warnings: [],
    evidence: { micro_test_active: microTestActive, can_micro_test: canMicroTest },
  }

  // ── micro_test_report (max 10) ──
  const sampleSize       = Number(microTestReport.sample_size ?? 0)
  const hitRate          = Number(microTestReport.hit_rate_pct ?? 0)
  const reportStatus     = microTestReport.status ?? 'not_started'
  const microReportScore = sampleSize >= 100 ? 10 : sampleSize >= 50 ? 7 : sampleSize > 0 ? 3 : 0
  const microReportDomain = {
    domain:   'micro_test_report',
    status:   sampleSize >= 100 ? 'passed' : sampleSize > 0 ? 'watch' : 'blocked',
    score:    microReportScore,
    grade:    microReportScore >= 8 ? 'healthy' : microReportScore >= 4 ? 'watch' : 'not_available',
    passed:   sampleSize >= 100,
    blockers: sampleSize < 100 ? ['minimum_sample_not_met'] : [],
    warnings: [],
    evidence: { sample_size: sampleSize, hit_rate_pct: hitRate, status: reportStatus },
  }

  // ── micro_test_policy (max 15) ──
  const qualityScore      = Number(microTestPolicy.quality_score ?? 0)
  const decisionState     = microTestPolicy.decision_state ?? 'not_available'
  const guardrailsPassed  = normalizeDecisionBoolean(microTestPolicy.guardrails?.passed)
  const policyScore       = guardrailsPassed ? 15 : qualityScore >= 60 ? 10 : qualityScore >= 40 ? 6 : 0
  const policyDomain = {
    domain:   'micro_test_policy',
    status:   guardrailsPassed ? 'passed' : qualityScore > 0 ? 'watch' : 'blocked',
    score:    policyScore,
    grade:    policyScore >= 12 ? 'healthy' : policyScore >= 6 ? 'watch' : 'not_available',
    passed:   guardrailsPassed,
    blockers: guardrailsPassed ? [] : ['policy_guardrails_failed'],
    warnings: [],
    evidence: { quality_score: qualityScore, decision_state: decisionState, guardrails_passed: guardrailsPassed },
  }

  // ── segment_health (max 10) ──
  const segScore = candidateSegs.length > 0 ? 10 : riskSegs.length > 0 ? 3 : 0
  const segDomain = {
    domain:   'segment_health',
    status:   candidateSegs.length > 0 ? 'passed' : 'blocked',
    score:    segScore,
    grade:    segScore >= 8 ? 'healthy' : segScore >= 4 ? 'watch' : 'not_available',
    passed:   candidateSegs.length > 0,
    blockers: candidateSegs.length === 0 ? ['no_candidate_segments'] : [],
    warnings: riskSegs.length > 0 ? ['risk_segments_present'] : [],
    evidence: { candidate_count: candidateSegs.length, risk_count: riskSegs.length },
  }

  // ── beta_admission (max 10) ──
  const admissionStatus = betaAdmission.status ?? 'blocked'
  const admissionOk     = ['can_start_private_beta', 'ready_for_review', 'passed', 'eligible_for_manual_review'].includes(admissionStatus)
  const admissionScore  = admissionOk ? 10 : admissionStatus !== 'blocked' ? 5 : 0
  const admissionDomain = {
    domain:   'beta_admission',
    status:   admissionOk ? 'passed' : 'blocked',
    score:    admissionScore,
    grade:    admissionScore >= 8 ? 'healthy' : admissionScore >= 4 ? 'watch' : 'not_available',
    passed:   admissionOk,
    blockers: admissionOk ? [] : ['admission_not_ready'],
    warnings: [],
    evidence: { admission_status: admissionStatus },
  }

  // ── private_beta_sandbox (max 10) ──
  const sandboxStatus   = sandbox.status ?? 'disabled'
  const sandboxEnabled  = normalizeDecisionBoolean(sandbox.enabled)
  const sandboxScore    = sandboxStatus === 'completed' ? 10 : sandboxEnabled ? 7 : 0
  const sandboxDomain = {
    domain:   'private_beta_sandbox',
    status:   sandboxEnabled ? (sandboxStatus === 'completed' ? 'passed' : 'watch') : 'blocked',
    score:    sandboxScore,
    grade:    sandboxScore >= 8 ? 'healthy' : sandboxScore >= 4 ? 'watch' : 'not_available',
    passed:   sandboxEnabled && sandboxStatus !== 'disabled',
    blockers: sandboxEnabled ? [] : ['sandbox_disabled'],
    warnings: sandboxStatus === 'blocked' ? ['sandbox_blocked'] : [],
    evidence: { sandbox_status: sandboxStatus, sandbox_enabled: sandboxEnabled },
  }

  // ── simulated_cohort_monitor (max 10) ──
  const monitorStatus = cohortMonitor.status ?? 'disabled'
  const monitorOk     = ['monitoring_active', 'completed'].includes(monitorStatus)
  const monitorScore  = monitorOk ? 10 : monitorStatus === 'not_started' ? 5 : 0
  const monitorDomain = {
    domain:   'simulated_cohort_monitor',
    status:   monitorOk ? 'passed' : monitorStatus === 'not_started' ? 'watch' : 'blocked',
    score:    monitorScore,
    grade:    monitorScore >= 8 ? 'healthy' : monitorScore >= 4 ? 'watch' : 'not_available',
    passed:   monitorOk,
    blockers: monitorOk ? [] : ['monitor_not_active'],
    warnings: [],
    evidence: { monitor_status: monitorStatus },
  }

  // ── operator_checklist (max 10) ──
  const checklistStatus = checklist.status ?? 'blocked'
  const checklistReady  = checklistStatus === 'ready_for_operator_review'
  const checklistScore  = checklistReady ? 10 : checklistStatus === 'needs_data' ? 5 : 0
  const checklistDomain = {
    domain:   'operator_checklist',
    status:   checklistReady ? 'passed' : 'blocked',
    score:    checklistScore,
    grade:    checklistScore >= 8 ? 'healthy' : checklistScore >= 4 ? 'watch' : 'not_available',
    passed:   checklistReady,
    blockers: checklistReady ? [] : ['checklist_not_ready'],
    warnings: [],
    evidence: { checklist_status: checklistStatus, passed_count: checklist.passed_count ?? 0 },
  }

  // ── safety_invariants (max 10) ──
  const safetyViolations = []
  if (canBeta)      safetyViolations.push('can_beta_true')
  if (canSell)      safetyViolations.push('can_sell_true')
  if (realUsers)    safetyViolations.push('real_users_true')
  if (realDelivery) safetyViolations.push('real_delivery_true')
  const safetyScore = safetyViolations.length === 0 ? 10 : 0
  const safetyDomain = {
    domain:   'safety_invariants',
    status:   safetyViolations.length === 0 ? 'passed' : 'critical_violation',
    score:    safetyScore,
    grade:    safetyScore >= 8 ? 'healthy' : 'not_available',
    passed:   safetyViolations.length === 0,
    blockers: safetyViolations,
    warnings: [],
    evidence: { can_beta: false, can_sell: false, real_users: false, real_delivery: false },
  }

  // ── commercial_block (structural lock, score 0) ──
  const commercialOk = !canSell && !canBeta
  const commercialDomain = {
    domain:   'commercial_block',
    status:   commercialOk ? 'passed' : 'critical_violation',
    score:    0,
    grade:    commercialOk ? 'locked' : 'critical_violation',
    passed:   commercialOk,
    blockers: commercialOk ? [] : ['commercial_release_attempted'],
    warnings: [],
    evidence: { can_sell: false, can_beta: false },
  }

  const domains = [
    readinessDomain, microGateDomain, microReportDomain, policyDomain,
    segDomain, admissionDomain, sandboxDomain, monitorDomain,
    checklistDomain, safetyDomain, commercialDomain,
  ]

  const rawScore    = domains.reduce((s, d) => s + d.score, 0)
  const overallScore = Math.min(100, rawScore)

  let overallGrade
  if (overallScore < 20)      overallGrade = 'blocked'
  else if (overallScore < 40) overallGrade = 'early'
  else if (overallScore < 60) overallGrade = 'watch'
  else if (overallScore < 75) overallGrade = 'review_candidate'
  else if (overallScore < 90) overallGrade = 'strong_hold'
  else                        overallGrade = 'exceptional_hold'

  const passedCount  = domains.filter(d => d.passed).length
  const blockedCount = domains.filter(d => !d.passed).length
  const warnCount    = domains.filter(d => d.warnings.length > 0).length

  return {
    status:                hasCritical ? 'critical_violation' : blockedCount > 0 ? 'blocked' : 'passed',
    overall_score:         overallScore,
    overall_grade:         overallGrade,
    domains,
    passed_domains_count:  passedCount,
    blocked_domains_count: blockedCount,
    warning_domains_count: warnCount,
  }
}

// ── Beta Dry-Run Report ───────────────────────────────────────────────────────

export function buildBetaDryRunReport(input = {}, options = {}) {
  const ledger       = input.simulated_delivery_ledger ?? {}
  const auditSummary = input.sandbox_audit_summary     ?? {}
  const sandbox      = input.private_beta_sandbox      ?? {}
  const candidateSegs = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs      = Array.isArray(input.risk_segments) ? input.risk_segments : []
  const ledgerHealth  = input.ledger_health          ?? {}
  const driftReport   = input.delivery_drift_report  ?? {}

  const hasCritical      = (auditSummary.status ?? '') === 'critical_violation'
  const sandboxEnabled   = normalizeDecisionBoolean(sandbox.enabled)
  const entriesCount     = Number(ledger.entries_count ?? 0)
  const delivCount       = Number(ledger.delivered_count ?? 0)
  const blockCount       = Number(ledger.blocked_count   ?? 0)
  const hasDriftBlockers = (driftReport.blockers ?? []).length > 0
  const hasDriftWarnings = (driftReport.warnings ?? []).length > 0

  let status, dryRunComplete, headline, description
  if (hasCritical) {
    status = 'critical_violation'; dryRunComplete = false
    headline = 'Dry-run bloqueado por violação crítica.'
    description = 'Violação de segurança detectada. Investigar antes de prosseguir.'
  } else if (!sandboxEnabled || entriesCount === 0) {
    status = 'not_started'; dryRunComplete = false
    headline = 'Beta dry-run ainda não iniciado.'
    description = 'O sandbox está desativado ou bloqueado.'
  } else if (hasDriftBlockers) {
    status = 'blocked'; dryRunComplete = false
    headline = 'Dry-run bloqueado por drift de política.'
    description = 'O ledger simulado apresenta violações de política que impedem o dry-run.'
  } else if (hasDriftWarnings || ledgerHealth.grade === 'weak') {
    status = 'completed_with_warnings'; dryRunComplete = true
    headline = `Dry-run simulado concluído com ${delivCount} entregas e ${blockCount} bloqueios.`
    description = `Ledger com ${entriesCount} entradas. Alertas de drift ou health fraca presentes.`
  } else {
    status = 'completed'; dryRunComplete = true
    headline = `Dry-run simulado concluído com ${delivCount} entregas e ${blockCount} bloqueios.`
    description = `Ledger com ${entriesCount} entradas. Nenhum blocker ou warning crítico detectado.`
  }

  const entries        = Array.isArray(ledger.entries) ? ledger.entries : []
  const deliverSegs    = [...new Set(entries.filter(e => e.status === 'would_deliver').map(e => e.segment_key).filter(Boolean))]
  const blockSegs      = [...new Set(entries.filter(e => e.status === 'would_block').map(e => e.segment_key).filter(Boolean))]

  const operatorNotes = []
  if ((driftReport.warnings ?? []).length > 0)
    operatorNotes.push(`Drift warnings: ${driftReport.warnings.join(', ')}`)
  if ((driftReport.blockers ?? []).length > 0)
    operatorNotes.push(`Drift blockers: ${driftReport.blockers.join(', ')}`)

  return {
    status,
    dry_run_complete: dryRunComplete,
    simulation_only:  true,
    real_users:       false,
    real_delivery:    false,
    summary:          { headline, description },
    inputs:           { candidate_segments_count: candidateSegs.length, risk_segments_count: riskSegs.length, ledger_entries_count: entriesCount },
    would_deliver:    { count: delivCount,  segments: deliverSegs },
    would_block:      { count: blockCount,  segments: blockSegs },
    operator_notes:   operatorNotes,
    limitations: [
      'Apenas simulação — nenhum usuário real',
      'Dados históricos podem ser limitados',
      'Resultados simulados não garantem performance real',
    ],
  }
}

// ── Launch Governance ─────────────────────────────────────────────────────────

export function buildLaunchGovernance(input = {}, options = {}) {
  const auditSummary   = input.sandbox_audit_summary     ?? {}
  const checklist      = input.operator_approval_checklist ?? {}
  const cohortReview   = input.cohort_monitoring_review  ?? {}

  const hasCritical    = (auditSummary.status ?? '') === 'critical_violation' ||
    normalizeDecisionBoolean(input.real_users) ||
    normalizeDecisionBoolean(input.real_delivery)
  const checklistReady = checklist.status === 'ready_for_operator_review'
  const cohortReady    = ['operator_review_ready', 'monitoring_ready'].includes(cohortReview.status ?? '')

  const policyNotes = []
  if (hasCritical) policyNotes.push('critical_violation_detected')
  if (normalizeDecisionBoolean(input.launch_allowed))          policyNotes.push('unsafe_launch_allowed_input_blocked')
  if (normalizeDecisionBoolean(input.sell_allowed))            policyNotes.push('unsafe_sell_allowed_input_blocked')
  if (normalizeDecisionBoolean(input.private_beta_allowed))    policyNotes.push('unsafe_private_beta_allowed_input_blocked')

  let status
  if (hasCritical)                    status = 'critical_violation'
  else if (checklistReady && cohortReady) status = 'manual_review_only'
  else                                status = 'locked'

  return {
    status,
    launch_allowed:           false,   // ALWAYS false — P3.8.15
    private_beta_allowed:     false,   // ALWAYS false
    public_beta_allowed:      false,   // ALWAYS false
    sell_allowed:             false,   // ALWAYS false
    requires_future_phase:    true,
    requires_manual_approval: true,
    required_future_phase:    'P3.8.16',
    hard_locks:               ['private_beta_locked', 'public_beta_locked', 'sell_locked'],
    policy_notes:             policyNotes,
  }
}

// ── Launch/No-Launch Decision ─────────────────────────────────────────────────

export function computeLaunchNoLaunchDecision(input = {}, options = {}) {
  const auditSummary    = input.sandbox_audit_summary      ?? {}
  const sandbox         = input.private_beta_sandbox       ?? {}
  const checklist       = input.operator_approval_checklist ?? {}
  const cohortReview    = input.cohort_monitoring_review   ?? {}

  const hasCritical     = (auditSummary.status ?? '') === 'critical_violation' ||
    normalizeDecisionBoolean(input.real_users) ||
    normalizeDecisionBoolean(input.real_delivery)
  const microTestActive = normalizeDecisionBoolean(input.micro_test_active)
  const sandboxEnabled  = normalizeDecisionBoolean(sandbox.enabled)
  const sandboxStatus   = sandbox.status ?? 'disabled'
  const checklistReady  = checklist.status === 'ready_for_operator_review'
  const cohortReady     = ['operator_review_ready', 'monitoring_ready'].includes(cohortReview.status ?? '')

  let decision, reason, confidence
  if (hasCritical) {
    decision = 'no_launch';             reason = 'critical_violation_detected';          confidence = 'high'
  } else if (!microTestActive) {
    decision = 'continue_shadow';       reason = 'micro_test_not_active';                confidence = 'high'
  } else if (!sandboxEnabled || sandboxStatus === 'disabled') {
    decision = 'hold';                  reason = 'sandbox_disabled';                     confidence = 'high'
  } else if (checklistReady && cohortReady) {
    decision = 'ready_for_manual_review'; reason = 'checklist_ready_pending_human_approval'; confidence = 'medium'
  } else {
    decision = 'hold';                  reason = 'conditions_not_met';                  confidence = 'medium'
  }

  const blockers = []
  if (!microTestActive)  blockers.push('micro_test_not_active')
  if (!sandboxEnabled)   blockers.push('sandbox_disabled')
  if (!checklistReady)   blockers.push('checklist_not_ready')
  if (hasCritical)       blockers.push('critical_violation')

  const warnings = []
  if (!cohortReady && sandboxEnabled) warnings.push('cohort_review_not_ready')

  return {
    decision,
    status:                                  hasCritical ? 'critical_violation' : 'evaluated',
    confidence,
    reason,
    can_launch:                              false,  // ALWAYS false
    can_invite_private_users:                false,  // ALWAYS false
    can_open_public_beta:                    false,  // ALWAYS false
    can_sell:                                false,  // ALWAYS false
    blockers,
    warnings,
    required_actions_before_reconsideration: blockers.map(b => `resolve_${b}`),
  }
}

// ── Operator Next Actions ─────────────────────────────────────────────────────

export function buildOperatorNextActions(input = {}, options = {}) {
  const decision        = input._decision ?? 'hold'
  const microTestActive = normalizeDecisionBoolean(input.micro_test_active)
  const sandboxEnabled  = normalizeDecisionBoolean(input.private_beta_sandbox?.enabled)
  const hasDrift        = (input.delivery_drift_report?.blockers ?? []).length > 0
  const hasCritical     = (input.sandbox_audit_summary?.status ?? '') === 'critical_violation'

  const actions = []

  if (hasCritical) {
    actions.push({ code: 'fix_critical_violations', label: 'Corrigir violações críticas',
      priority: 'critical', owner: 'operator', blocking: true,
      description: 'Investigar e corrigir violação de segurança antes de qualquer ação.' })
  }

  if (!microTestActive) {
    actions.push({ code: 'continue_accumulation', label: 'Continuar acumulando dados',
      priority: 'high', owner: 'operator', blocking: true,
      description: 'Aguardar resolved_valid atingir threshold e micro-test ser ativado.' })
    actions.push({ code: 'activate_micro_test_when_threshold_met', label: 'Ativar micro-test quando threshold for atingido',
      priority: 'high', owner: 'system', blocking: false,
      description: 'Sistema ativará micro-test automaticamente quando threshold for alcançado.' })
  }

  if (!sandboxEnabled && microTestActive) {
    actions.push({ code: 'enable_sandbox_only_after_admission_ready', label: 'Ativar sandbox após admissão estar pronta',
      priority: 'medium', owner: 'operator', blocking: false,
      description: 'Habilitar sandbox somente após contrato de admissão estar em estado válido.' })
  }

  if (hasDrift) {
    actions.push({ code: 'review_drift_report', label: 'Revisar relatório de drift',
      priority: 'medium', owner: 'operator', blocking: false,
      description: 'Revisar e corrigir desvios detectados no ledger simulado.' })
  }

  if (decision === 'ready_for_manual_review') {
    actions.push({ code: 'review_drift_report', label: 'Revisar relatório de drift',
      priority: 'medium', owner: 'operator', blocking: false,
      description: 'Revisar e corrigir desvios detectados no ledger simulado.' })
    actions.push({ code: 'prepare_next_phase_packet', label: 'Preparar pacote para próxima fase',
      priority: 'high', owner: 'operator', blocking: false,
      description: 'Preparar artifact de revisão manual para P3.8.16.' })
  }

  actions.push({ code: 'keep_beta_locked', label: 'Manter beta bloqueado',
    priority: 'high', owner: 'system', blocking: true,
    description: 'Beta privado e público permanecem bloqueados nesta fase.' })
  actions.push({ code: 'keep_sell_locked', label: 'Manter venda bloqueada',
    priority: 'high', owner: 'system', blocking: true,
    description: 'Venda permanece bloqueada nesta fase.' })

  const seen = new Set()
  const unique = actions.filter(a => {
    if (seen.has(a.code)) return false
    seen.add(a.code)
    return true
  })

  const priority = hasCritical ? 'critical' : !microTestActive ? 'high' : 'medium'

  return {
    status:   decision === 'ready_for_manual_review' ? 'review_ready' : 'action_required',
    priority,
    actions:  unique,
  }
}

// ── Governance Audit Summary ──────────────────────────────────────────────────

export function buildGovernanceAuditSummary(input = {}, options = {}) {
  const canBeta       = normalizeDecisionBoolean(input.can_beta)
  const canSell       = normalizeDecisionBoolean(input.can_sell)
  const realUsers     = normalizeDecisionBoolean(input.real_users)
  const realDelivery  = normalizeDecisionBoolean(input.real_delivery)
  const launchAllowed = normalizeDecisionBoolean(input.launch_allowed)
  const sellAllowed   = normalizeDecisionBoolean(input.sell_allowed)

  const criticalViolations = []
  if (canBeta)       criticalViolations.push({ code: 'can_beta_true',      description: 'Input can_beta=true violates safety invariant' })
  if (canSell)       criticalViolations.push({ code: 'can_sell_true',       description: 'Input can_sell=true violates safety invariant' })
  if (realUsers)     criticalViolations.push({ code: 'real_users_true',     description: 'Input real_users=true violates safety invariant' })
  if (realDelivery)  criticalViolations.push({ code: 'real_delivery_true',  description: 'Input real_delivery=true violates safety invariant' })
  if (launchAllowed) criticalViolations.push({ code: 'launch_allowed_true', description: 'Input launch_allowed=true violates governance policy' })
  if (sellAllowed)   criticalViolations.push({ code: 'sell_allowed_true',   description: 'Input sell_allowed=true violates governance policy' })

  return {
    status:                criticalViolations.length > 0 ? 'critical_violation' : 'clean',
    critical_violations:   criticalViolations,
    warnings:              [],
    safety_invariants: {
      can_beta_false:      true,   // output always enforces false
      can_sell_false:      true,
      real_users_false:    true,
      real_delivery_false: true,
      sell_locked:         true,
    },
    unsafe_input_detected: criticalViolations.length > 0,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateOperatorDecisionPacket(input = {}, options = {}) {
  const safeInput = input ?? {}

  const evidenceMatrix  = buildDecisionEvidenceMatrix(safeInput, options)
  const dryRunReport    = buildBetaDryRunReport(safeInput, options)
  const governance      = buildLaunchGovernance(safeInput, options)
  const auditSummary    = buildGovernanceAuditSummary(safeInput, options)
  const launchDecision  = computeLaunchNoLaunchDecision(safeInput, options)
  const nextActions     = buildOperatorNextActions({ ...safeInput, _decision: launchDecision.decision }, options)

  const decision     = launchDecision.decision
  const overallScore = evidenceMatrix.overall_score
  const overallGrade = evidenceMatrix.overall_grade
  const hasCritical  = auditSummary.unsafe_input_detected ||
    (safeInput.sandbox_audit_summary?.status ?? '') === 'critical_violation'

  let packetStatus
  if (hasCritical)                           packetStatus = 'critical_violation'
  else if (decision === 'continue_shadow')   packetStatus = 'shadow_continue'
  else if (decision === 'hold')              packetStatus = 'hold'
  else if (decision === 'ready_for_manual_review') packetStatus = 'manual_review_ready'
  else                                       packetStatus = 'blocked'

  let headline, execSummary
  if (hasCritical) {
    headline    = 'SportsBrain: violação crítica detectada.'
    execSummary = 'Violação de segurança impede qualquer avanço. Investigar imediatamente.'
  } else if (decision === 'continue_shadow') {
    headline    = 'SportsBrain ainda não está pronto para beta.'
    execSummary = 'O sistema permanece em shadow/sandbox por falta de micro-test ativo e amostra suficiente.'
  } else if (decision === 'hold') {
    headline    = 'SportsBrain em hold — aguardando condições.'
    execSummary = 'Micro-test ativo mas sandbox ou checklist não estão prontos para avançar.'
  } else if (decision === 'ready_for_manual_review') {
    headline    = 'SportsBrain pronto para revisão operacional humana.'
    execSummary = 'Sistema completou etapas técnicas. Decisão final requer aprovação manual do operador.'
  } else {
    headline    = 'SportsBrain em estado indeterminado.'
    execSummary = 'Verificar configurações e dados acumulados.'
  }

  const operatorDecisionPacket = {
    status:           packetStatus,
    packet_version:   PACKET_VERSION,
    generated_at:     new Date().toISOString(),
    decision,
    overall_score:    overallScore,
    overall_grade:    overallGrade,
    headline,
    executive_summary:               execSummary,
    evidence_matrix:                 evidenceMatrix,
    dry_run_report:                  dryRunReport,
    launch_governance:               governance,
    next_actions:                    nextActions,
    safe_to_invite_private_users:    false,  // ALWAYS false
    safe_to_sell:                    false,  // ALWAYS false
  }

  return {
    operator_decision_packet:  operatorDecisionPacket,
    beta_dry_run_report:       dryRunReport,
    launch_governance:         governance,
    launch_no_launch_decision: launchDecision,
    decision_evidence_matrix:  evidenceMatrix,
    operator_next_actions:     nextActions,
    governance_audit_summary:  auditSummary,
  }
}
