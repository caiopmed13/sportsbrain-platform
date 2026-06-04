// src/services/simulatedCohortMonitor.js
// P3.8.14 — Simulated Cohort Performance Monitor, Delivery Drift Detection & Operator Approval Checklist

const PROCESSABLE_CONTRACT_STATUSES = ['eligible_for_manual_review', 'simulation_ready', 'simulation_active']

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeMonitorNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// ── Ledger health ─────────────────────────────────────────────────────────────

export function classifyLedgerHealth(ledger = {}, options = {}) {
  const entries        = Array.isArray(ledger.entries) ? ledger.entries : []
  const maxLedger      = normalizeMonitorNumber(options.max_ledger_entries, 25)
  const maxPicksPerRun = normalizeMonitorNumber(options.max_picks_per_run, 3)
  const total          = entries.length

  if (total === 0) {
    return {
      status: 'empty', score: 0, grade: 'not_available',
      entries_count: 0, delivered_count: 0, blocked_count: 0, skipped_count: 0,
      has_deliveries: false, has_blocks: false, truncated: false,
      dominant_segment_share: null, warnings: [], blockers: [],
    }
  }

  const delivered = entries.filter(e => e.status === 'would_deliver').length
  const blocked   = entries.filter(e => e.status === 'would_block').length
  const skipped   = entries.filter(e => e.status === 'skipped').length
  const truncated = total >= maxLedger

  const segCounts = {}
  for (const e of entries) {
    const k = e.segment_key ?? 'unknown'
    segCounts[k] = (segCounts[k] ?? 0) + 1
  }
  const uniqueSegments = Object.keys(segCounts).length
  const maxSegCount    = Math.max(...Object.values(segCounts))
  const dominantShare  = maxSegCount / total

  // Score components (max 100)
  const entriesScore  = total >= 11 ? 25 : total >= 6 ? 20 : total >= 3 ? 15 : 10
  const balanceScore  = delivered > 0 && blocked > 0 ? 20 : delivered > 0 ? 12 : blocked > 0 ? 8 : 0
  const diversityScore = uniqueSegments >= 3 ? 20 : uniqueSegments === 2 ? 10 : 5
  let   policyScore   = 25
  if (delivered > maxPicksPerRun) policyScore = Math.max(0, policyScore - 15)
  if (truncated)                  policyScore = Math.max(0, policyScore - 10)
  let   freshnessScore = 5
  const lastEntry = entries[entries.length - 1]
  if (lastEntry?.created_at) {
    const ageH = (Date.now() - new Date(lastEntry.created_at).getTime()) / 3_600_000
    freshnessScore = ageH <= 1 ? 10 : ageH <= 24 ? 5 : 0
  }

  const score = Math.max(0, Math.min(100, entriesScore + balanceScore + diversityScore + policyScore + freshnessScore))

  let grade
  if (score >= 80)      grade = 'strong'
  else if (score >= 60) grade = 'healthy'
  else if (score >= 40) grade = 'usable'
  else if (score >= 20) grade = 'weak'
  else                  grade = 'not_available'

  let status
  if (truncated)        status = 'truncated'
  else if (score >= 60) status = 'healthy'
  else if (score >= 40) status = 'usable'
  else                  status = 'weak'

  const warnings = []
  const blockers = []
  if (truncated)              warnings.push('ledger_at_max_capacity')
  if (dominantShare > 0.7)    warnings.push('dominant_segment_concentration')
  if (delivered > maxPicksPerRun) blockers.push('exceeds_max_picks_per_run')

  return {
    status, score, grade,
    entries_count: total, delivered_count: delivered, blocked_count: blocked, skipped_count: skipped,
    has_deliveries: delivered > 0, has_blocks: blocked > 0, truncated,
    dominant_segment_share: Math.round(dominantShare * 1000) / 1000,
    warnings, blockers,
  }
}

// ── Ledger exposure ───────────────────────────────────────────────────────────

export function computeLedgerExposure(ledger = {}, options = {}) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : []
  const total   = entries.length

  const by_segment  = {}
  const by_dimension = {}
  let   highOddsCount = 0

  for (const e of entries) {
    const sk  = e.segment_key ?? 'unknown'
    const dim = e.dimension   ?? 'unknown'
    by_segment[sk]    = (by_segment[sk]    ?? 0) + 1
    by_dimension[dim] = (by_dimension[dim] ?? 0) + 1
    if ((e.odd ?? 0) > 2.5 || e.odds_bucket === '2.50+') highOddsCount++
  }

  const highOddsShare  = total > 0 ? highOddsCount / total : 0
  const maxSegCount    = total > 0 ? Math.max(...Object.values(by_segment)) : 0
  const singleSegShare = total > 0 ? maxSegCount / total : 0

  const delivered = entries.filter(e => e.status === 'would_deliver').length
  const blocked   = entries.filter(e => e.status === 'would_block').length
  const deliveryToBlockRatio = blocked > 0 ? Math.round((delivered / blocked) * 100) / 100 : null

  return {
    entries_count:           total,
    by_segment,
    by_dimension,
    high_odds_share:         Math.round(highOddsShare  * 1000) / 1000,
    single_segment_share:    Math.round(singleSegShare * 1000) / 1000,
    delivery_to_block_ratio: deliveryToBlockRatio,
  }
}

// ── Delivery drift ────────────────────────────────────────────────────────────

export function detectDeliveryDrift(input = {}, options = {}) {
  const ledger        = input.simulated_delivery_ledger ?? {}
  const entries       = Array.isArray(ledger.entries) ? ledger.entries : []
  const policy        = input.sandbox_delivery_policy  ?? {}
  const maxPicksPerRun = normalizeMonitorNumber(options.max_picks_per_run ?? policy.max_picks_per_run, 3)
  const maxHighOdds   = normalizeMonitorNumber(options.max_high_odds_share ?? policy.max_high_odds_share, 0.25)

  if (entries.length === 0) {
    return {
      status: 'not_available', drift_detected: false, drift_score: 0, drift_grade: 'not_available',
      checks: [], warnings: [], blockers: [], top_drift_factors: [],
    }
  }

  const exposure       = input.ledger_exposure ?? computeLedgerExposure(ledger, options)
  const candidateSegs  = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs       = Array.isArray(input.risk_segments) ? input.risk_segments : []
  const sandbox        = input.private_beta_sandbox ?? {}
  const sandboxEnabled = sandbox.enabled === true

  const delivered = entries.filter(e => e.status === 'would_deliver').length
  const blocked   = entries.filter(e => e.status === 'would_block').length

  const checks = []

  // 1. candidate_to_delivery_drift
  const c2dFail = candidateSegs.length > 0 && delivered === 0 && sandboxEnabled
  checks.push({ code: 'candidate_to_delivery_drift', passed: !c2dFail, severity: c2dFail ? 'warning' : 'info',
    details: c2dFail ? 'Candidates present but no would_deliver in ledger' : 'ok' })

  // 2. risk_to_block_drift
  const r2bFail = riskSegs.length > 0 && blocked === 0
  checks.push({ code: 'risk_to_block_drift', passed: !r2bFail, severity: r2bFail ? 'warning' : 'info',
    details: r2bFail ? 'Risk segments present but no would_block in ledger' : 'ok' })

  // 3. segment_exposure_drift (>60% concentration)
  const segFail = exposure.single_segment_share > 0.60
  checks.push({ code: 'segment_exposure_drift', passed: !segFail, severity: segFail ? 'warning' : 'info',
    details: segFail ? `Single segment share ${exposure.single_segment_share} > 0.60` : 'ok' })

  // 4. odds_exposure_drift
  const oddsFail = exposure.high_odds_share > maxHighOdds
  checks.push({ code: 'odds_exposure_drift', passed: !oddsFail, severity: oddsFail ? 'warning' : 'info',
    details: oddsFail ? `High odds share ${exposure.high_odds_share} > policy ${maxHighOdds}` : 'ok' })

  // 5. confidence_alignment_drift (informational only — no resolved data)
  checks.push({ code: 'confidence_alignment_drift', passed: true, severity: 'info',
    details: 'not_computable_without_resolved_data' })

  // 6. market_concentration_drift
  const marketCount = entries.filter(e => e.dimension === 'market').length
  const marketShare = entries.length > 0 ? marketCount / entries.length : 0
  const mktFail     = marketShare > 0.7
  checks.push({ code: 'market_concentration_drift', passed: !mktFail, severity: mktFail ? 'warning' : 'info',
    details: mktFail ? `Market concentration ${marketShare}` : 'ok' })

  // 7. sport_concentration_drift
  const sportCount = entries.filter(e => e.dimension === 'sport').length
  const sportShare = entries.length > 0 ? sportCount / entries.length : 0
  const sptFail    = sportShare > 0.95
  checks.push({ code: 'sport_concentration_drift', passed: !sptFail, severity: sptFail ? 'warning' : 'info',
    details: sptFail ? `Sport concentration ${sportShare}` : 'ok' })

  // 8. policy_vs_ledger_drift
  const policyFail = delivered > maxPicksPerRun
  checks.push({ code: 'policy_vs_ledger_drift', passed: !policyFail, severity: policyFail ? 'blocker' : 'info',
    details: policyFail ? `delivered_count ${delivered} > max_picks_per_run ${maxPicksPerRun}` : 'ok' })

  const failed   = checks.filter(c => !c.passed)
  const blockers = failed.filter(c => c.severity === 'blocker').map(c => c.code)
  const warnings = failed.filter(c => c.severity === 'warning').map(c => c.code)

  const driftScore = Math.min(100, failed.length * 15)
  const driftGrade = driftScore === 0 ? 'none' : driftScore < 30 ? 'low' : driftScore < 60 ? 'moderate' : 'high'
  const driftDetected = failed.length > 0

  return {
    status:            driftDetected ? 'drift_detected' : 'checked',
    drift_detected:    driftDetected,
    drift_score:       driftScore,
    drift_grade:       driftGrade,
    checks,
    warnings,
    blockers,
    top_drift_factors: failed.map(c => c.code),
  }
}

// ── Operator approval checklist ───────────────────────────────────────────────

export function buildOperatorApprovalChecklist(input = {}, options = {}) {
  const microTestActive = input.micro_test_active === true
  const sampleSize      = normalizeMonitorNumber(input.micro_test_report?.sample_size, 0)
  const qualityScore    = normalizeMonitorNumber(input.micro_test_policy?.quality_score, 0)
  const candidateSegs   = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs        = Array.isArray(input.risk_segments) ? input.risk_segments : []
  const contract        = input.beta_admission_contract ?? {}
  const manualGate      = input.manual_approval_gate
  const cohortSim       = input.private_cohort_simulation
  const sandbox         = input.private_beta_sandbox ?? {}
  const ledger          = input.simulated_delivery_ledger ?? {}
  const ledgerHealth    = input.ledger_health ?? {}
  const driftReport     = input.delivery_drift_report ?? {}
  const auditSummary    = input.sandbox_audit_summary ?? {}
  const operatorConsole = input.operator_review_console

  // Safety: detect unsafe flags in input
  const realUsers    = input.real_users    === true || sandbox.real_users    === true
  const realDelivery = input.real_delivery === true || sandbox.real_delivery === true
  const canSell      = input.can_sell             === true
  const canPublicBeta = input.can_start_public_beta === true

  const contractOk  = PROCESSABLE_CONTRACT_STATUSES.includes(contract.status ?? '')
  const ledgerUsable = ['usable', 'healthy', 'truncated', 'strong'].includes(ledgerHealth.status ?? '') ||
    normalizeMonitorNumber(ledgerHealth.score, 0) >= 40
  const driftChecked = (driftReport.status ?? 'not_available') !== 'not_available'
  const noCritical   = (auditSummary.status ?? 'clean') !== 'critical_violation'

  const items = [
    { code: 'micro_test_active',              label: 'Micro-test ativo',                       required: true,  severity: 'blocker', passed: microTestActive,                         evidence: { micro_test_active: microTestActive } },
    { code: 'minimum_decision_sample_met',    label: 'Amostra mínima de decisão atingida',      required: false, severity: 'warning', passed: sampleSize >= 100,                       evidence: { sample_size: sampleSize, required: 100 } },
    { code: 'micro_test_quality_policy_passed', label: 'Política de qualidade aprovada',        required: false, severity: 'warning', passed: qualityScore >= 60,                      evidence: { quality_score: qualityScore, required: 60 } },
    { code: 'candidate_segments_available',   label: 'Segmentos candidatos disponíveis',        required: false, severity: 'warning', passed: candidateSegs.length > 0,               evidence: { count: candidateSegs.length } },
    { code: 'risk_segments_reviewed',         label: 'Segmentos de risco revisados',            required: false, severity: 'info',    passed: true,                                    evidence: { count: riskSegs.length } },
    { code: 'beta_admission_contract_ready',  label: 'Contrato de admissão em estado válido',   required: false, severity: 'warning', passed: contractOk,                              evidence: { contract_status: contract.status ?? 'unknown' } },
    { code: 'manual_approval_checked',        label: 'Gate de aprovação manual avaliado',       required: false, severity: 'info',    passed: manualGate != null,                      evidence: { gate_present: manualGate != null } },
    { code: 'private_cohort_simulation_checked', label: 'Simulação de coorte verificada',       required: false, severity: 'info',    passed: cohortSim != null,                       evidence: { simulation_present: cohortSim != null } },
    { code: 'sandbox_enabled_checked',        label: 'Flag de sandbox configurada',             required: false, severity: 'warning', passed: sandbox.enabled === true,                evidence: { sandbox_enabled: sandbox.enabled ?? false } },
    { code: 'ledger_generated',               label: 'Ledger simulado gerado',                  required: false, severity: 'warning', passed: normalizeMonitorNumber(ledger.entries_count, 0) > 0, evidence: { entries_count: ledger.entries_count ?? 0 } },
    { code: 'ledger_health_usable',           label: 'Saúde do ledger utilizável',              required: false, severity: 'warning', passed: ledgerUsable,                            evidence: { status: ledgerHealth.status ?? 'unknown', score: ledgerHealth.score ?? 0 } },
    { code: 'delivery_drift_checked',         label: 'Drift de entrega verificado',             required: false, severity: 'info',    passed: driftChecked,                            evidence: { drift_status: driftReport.status ?? 'not_available' } },
    { code: 'no_critical_sandbox_violations', label: 'Sem violações críticas no sandbox',       required: true,  severity: 'blocker', passed: noCritical,                              evidence: { audit_status: auditSummary.status ?? 'clean' } },
    { code: 'no_real_users',                  label: 'Nenhum usuário real envolvido',           required: true,  severity: 'blocker', passed: !realUsers,                              evidence: { real_users: false } },
    { code: 'no_real_delivery',               label: 'Nenhuma entrega real realizada',          required: true,  severity: 'blocker', passed: !realDelivery,                           evidence: { real_delivery: false } },
    { code: 'sell_blocked',                   label: 'Venda bloqueada',                         required: true,  severity: 'blocker', passed: !canSell,                                evidence: { can_sell: false } },
    { code: 'public_beta_blocked',            label: 'Beta público bloqueado',                  required: true,  severity: 'blocker', passed: !canPublicBeta,                          evidence: { can_start_public_beta: false } },
    { code: 'operator_review_console_present', label: 'Console de revisão do operador presente', required: false, severity: 'info',  passed: operatorConsole != null,                 evidence: { console_present: operatorConsole != null } },
  ]

  const passedCount   = items.filter(i => i.passed).length
  const failedCount   = items.filter(i => !i.passed).length
  const requiredCount = items.filter(i => i.required).length
  const blockers      = items.filter(i => !i.passed && i.severity === 'blocker').map(i => i.code)
  const warnings      = items.filter(i => !i.passed && i.severity === 'warning').map(i => i.code)

  const hasCriticalViolation = !noCritical || realUsers || realDelivery
  let status
  if (hasCriticalViolation) {
    status = 'critical_violation'
  } else if (blockers.length > 0) {
    status = 'blocked'
  } else if (warnings.length > 3) {
    status = 'needs_data'
  } else {
    status = 'ready_for_operator_review'
  }

  return {
    status,
    ready_for_operator_review: status === 'ready_for_operator_review',
    passed_count:   passedCount,
    failed_count:   failedCount,
    required_count: requiredCount,
    items,
    blockers,
    warnings,
    operator_instruction: 'Não convidar usuários. Não vender.',
  }
}

// ── Sandbox performance summary ───────────────────────────────────────────────

export function buildSandboxPerformanceSummary(input = {}, options = {}) {
  const ledger       = input.simulated_delivery_ledger ?? {}
  const ledgerH      = input.ledger_health             ?? {}
  const driftReport  = input.delivery_drift_report     ?? {}
  const sandbox      = input.private_beta_sandbox      ?? {}
  const auditSummary = input.sandbox_audit_summary     ?? {}

  const entriesCount    = normalizeMonitorNumber(ledger.entries_count,  0)
  const deliveredCount  = normalizeMonitorNumber(ledger.delivered_count, 0)
  const blockedCount    = normalizeMonitorNumber(ledger.blocked_count,   0)
  const healthGrade     = ledgerH.grade    ?? 'not_available'
  const driftGrade      = driftReport.drift_grade ?? 'not_available'
  const hasDriftBlocker = (driftReport.blockers ?? []).length > 0
  const hasCritical     = (auditSummary.status ?? 'clean') === 'critical_violation'
  const sandboxEnabled  = sandbox.enabled === true

  let status, headline, summaryText, nextAction
  let safeToRunSandbox = false

  if (hasCritical) {
    status      = 'critical_violation'
    headline    = 'Violação crítica detectada no sandbox.'
    summaryText = 'O sistema detectou uso inseguro. Investigar imediatamente.'
    nextAction  = 'Corrigir violação crítica antes de prosseguir.'
  } else if (!sandboxEnabled) {
    status      = 'not_started'
    headline    = 'Sandbox ainda não gerou entregas simuladas.'
    summaryText = 'O ledger está vazio porque o sandbox está desativado ou bloqueado.'
    nextAction  = 'Aguardar contrato de admissão e ativação segura do sandbox.'
  } else if (entriesCount === 0) {
    status      = 'needs_data'
    headline    = 'Sandbox ativo mas ledger está vazio.'
    summaryText = 'O sandbox está configurado mas ainda não gerou entradas no ledger.'
    nextAction  = 'Verificar segmentos candidatos e configuração do sandbox.'
  } else if (hasDriftBlocker) {
    status      = 'drift_detected'
    headline    = 'Drift crítico detectado no ledger simulado.'
    summaryText = `Ledger com ${entriesCount} entradas mas apresenta desvios de política.`
    nextAction  = 'Revisar e corrigir drift antes de prosseguir.'
  } else if (['healthy', 'strong'].includes(healthGrade) && ['none', 'low'].includes(driftGrade)) {
    status           = 'healthy_simulation'
    headline         = 'Simulação de sandbox com saúde adequada.'
    summaryText      = `Ledger com ${deliveredCount} entregas e ${blockedCount} bloqueios. Sem drift crítico.`
    nextAction       = 'Revisão operacional pode ser iniciada.'
    safeToRunSandbox = true
  } else if (entriesCount > 0) {
    status           = 'watch'
    headline         = 'Ledger gerado com pontos de atenção.'
    summaryText      = `Ledger com ${entriesCount} entradas. Health: ${healthGrade}. Drift: ${driftGrade}.`
    nextAction       = 'Revisar warnings antes de avançar.'
    safeToRunSandbox = true
  } else {
    status      = 'blocked'
    headline    = 'Sandbox bloqueado.'
    summaryText = 'Sandbox bloqueado por condições não atendidas.'
    nextAction  = 'Verificar blockers no sandbox e contrato de admissão.'
  }

  return {
    status,
    headline,
    summary_text:                summaryText,
    ledger_entries:              entriesCount,
    simulated_deliveries:        deliveredCount,
    simulated_blocks:            blockedCount,
    health_grade:                healthGrade,
    drift_grade:                 driftGrade,
    next_action:                 nextAction,
    safe_to_continue_shadow:     true,
    safe_to_run_sandbox:         safeToRunSandbox,
    safe_to_invite_private_users: false,
    safe_to_sell:                false,
  }
}

// ── Cohort monitoring review ──────────────────────────────────────────────────

export function buildCohortMonitoringReview(input = {}, options = {}) {
  const sandbox      = input.private_beta_sandbox        ?? {}
  const auditSummary = input.sandbox_audit_summary       ?? {}
  const checklist    = input.operator_approval_checklist ?? {}
  const driftReport  = input.delivery_drift_report       ?? {}
  const ledger       = input.simulated_delivery_ledger   ?? {}

  const sandboxEnabled  = sandbox.enabled === true
  const sandboxStatus   = sandbox.status  ?? 'disabled'
  const hasCritical     = (auditSummary.status ?? 'clean') === 'critical_violation'
  const checklistReady  = checklist.ready_for_operator_review === true
  const hasDriftBlocker = (driftReport.blockers ?? []).length > 0
  const hasLedger       = normalizeMonitorNumber(ledger.entries_count, 0) > 0

  const blockers = [...new Set([...(checklist.blockers ?? []), ...(driftReport.blockers ?? [])])]
  const warnings = [...new Set([...(checklist.warnings ?? []), ...(driftReport.warnings ?? [])])]

  let status, nextAction, canRunSandbox = false

  if (hasCritical) {
    status     = 'critical_violation'
    nextAction = 'Corrigir violação crítica antes de prosseguir.'
  } else if (!sandboxEnabled || sandboxStatus === 'disabled') {
    status     = 'sandbox_disabled'
    nextAction = 'Ativar sandbox quando contrato de admissão estiver pronto.'
  } else if (sandboxStatus === 'blocked') {
    status     = 'blocked'
    nextAction = 'Resolver blockers no sandbox e contrato de admissão.'
  } else if (checklistReady && hasLedger && !hasDriftBlocker) {
    status         = 'operator_review_ready'
    nextAction     = 'Submeter para revisão operacional humana.'
    canRunSandbox  = true
  } else if (hasLedger) {
    status         = 'monitoring_ready'
    nextAction     = 'Revisar checklist e corrigir itens pendentes.'
    canRunSandbox  = true
  } else {
    status     = 'blocked'
    nextAction = 'Continuar acumulando dados e manter sandbox desativado.'
  }

  return {
    status,
    can_continue_shadow:      true,
    can_run_sandbox:          canRunSandbox,
    can_invite_private_users: false,
    can_open_public_beta:     false,
    can_sell:                 false,
    blockers,
    warnings,
    next_action:              nextAction,
    next_phase_recommendation: 'P3.8.15',
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateSimulatedCohortMonitor(input = {}, options = {}) {
  const safeInput    = input ?? {}
  const sandbox      = safeInput.private_beta_sandbox      ?? {}
  const auditSummary = safeInput.sandbox_audit_summary     ?? {}
  const ledger       = safeInput.simulated_delivery_ledger ?? {}
  const candidateSegs = Array.isArray(safeInput.candidate_segments) ? safeInput.candidate_segments : []
  const riskSegs      = Array.isArray(safeInput.risk_segments) ? safeInput.risk_segments : []
  const maxLedger     = normalizeMonitorNumber(options.max_ledger_entries, 25)
  const maxPicks      = normalizeMonitorNumber(options.max_picks_per_run, 3)

  // Safety: detect unsafe flags in input
  const realUsers    = safeInput.real_users    === true || sandbox.real_users    === true
  const realDelivery = safeInput.real_delivery === true || sandbox.real_delivery === true
  const hasCritical  = (auditSummary.status ?? 'clean') === 'critical_violation' || realUsers || realDelivery

  const sandboxStatus = sandbox.status ?? 'disabled'
  const entriesCount  = normalizeMonitorNumber(ledger.entries_count, 0)

  let monitorStatus, monitorEnabled, monitorReason
  if (hasCritical) {
    monitorStatus  = 'critical_violation'; monitorEnabled = false; monitorReason = 'critical_violation_detected'
  } else if (sandboxStatus === 'disabled') {
    monitorStatus  = 'disabled'; monitorEnabled = false; monitorReason = 'sandbox_disabled'
  } else if (entriesCount === 0) {
    monitorStatus  = 'not_started'; monitorEnabled = true; monitorReason = 'ledger_empty'
  } else {
    monitorStatus  = sandboxStatus === 'completed' ? 'completed' : 'monitoring_active'
    monitorEnabled = true; monitorReason = 'ledger_available'
  }

  const simulatedCohortMonitor = {
    status:           monitorStatus,
    enabled:          monitorEnabled,
    simulation_only:  true,
    real_users:       false,
    real_delivery:    false,
    monitoring_ready: ['monitoring_active', 'completed'].includes(monitorStatus),
    reason:           monitorReason,
    sample: {
      ledger_entries:     entriesCount,
      would_deliver:      normalizeMonitorNumber(ledger.delivered_count, 0),
      would_block:        normalizeMonitorNumber(ledger.blocked_count,   0),
      candidate_segments: candidateSegs.length,
      risk_segments:      riskSegs.length,
    },
    generated_at: new Date().toISOString(),
  }

  const ledgerHealth  = classifyLedgerHealth(ledger, { max_ledger_entries: maxLedger, max_picks_per_run: maxPicks })
  const ledgerExposure = computeLedgerExposure(ledger, {})

  const driftReport = detectDeliveryDrift(
    { ...safeInput, ledger_exposure: ledgerExposure },
    { max_picks_per_run: maxPicks }
  )

  const approvalChecklist = buildOperatorApprovalChecklist(
    { ...safeInput, ledger_health: ledgerHealth, delivery_drift_report: driftReport, real_users: realUsers, real_delivery: realDelivery },
    options
  )

  const performanceSummary = buildSandboxPerformanceSummary(
    { ...safeInput, ledger_health: ledgerHealth, delivery_drift_report: driftReport },
    options
  )

  const cohortReview = buildCohortMonitoringReview(
    { ...safeInput, operator_approval_checklist: approvalChecklist, delivery_drift_report: driftReport },
    options
  )

  return {
    simulated_cohort_monitor:    simulatedCohortMonitor,
    ledger_health:               ledgerHealth,
    ledger_exposure:             ledgerExposure,
    delivery_drift_report:       driftReport,
    sandbox_performance_summary: performanceSummary,
    operator_approval_checklist: approvalChecklist,
    cohort_monitoring_review:    cohortReview,
  }
}
