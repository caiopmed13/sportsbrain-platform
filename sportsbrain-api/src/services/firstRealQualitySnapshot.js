// src/services/firstRealQualitySnapshot.js
// P3.9.1 — First Real Quality Snapshot

const SNAPSHOT_VERSION = 'p3.9.1'

// ── Unsafe fields — always sanitized to false in output ───────────────────────
// can_beta, can_sell, auto_activate_micro_test, auto_activation_allowed,
// delivery_allowed, real_delivery

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveCore(input = {}) {
  const microTestActive = input.micro_test_active ?? input.post_activation_monitor?.micro_test_active ?? false
  const microTestReportActive = input.micro_test_report?.status === 'active'

  const greenCount = input.green_count ?? input.resolved_sample_audit?.green_count ?? 0
  const redCount   = input.red_count   ?? input.resolved_sample_audit?.red_count   ?? 0
  const sampleSize = input.sample_size ?? input.resolved_sample_audit?.resolved_valid ?? (greenCount + redCount)

  const totalResolved = greenCount + redCount
  const hitRate = totalResolved === 0 ? 0 : greenCount / totalResolved

  const qualityScore = input.micro_test_report?.quality_score ?? input.resolved_quality_seed_report?.quality_score ?? 0
  const qualityGrade = input.micro_test_report?.quality_grade ?? input.resolved_quality_seed_report?.quality_grade ?? 'not_available'
  const decisionState = input.micro_test_report?.decision_state ?? 'not_started'

  return { microTestActive, microTestReportActive, greenCount, redCount, sampleSize, hitRate, qualityScore, qualityGrade, decisionState }
}

function computeSnapshotStatus(core, violations) {
  const { microTestActive, microTestReportActive, sampleSize, hitRate, qualityScore, qualityGrade } = core

  if (violations.length > 0) return 'critical_violation'
  if (sampleSize === 0) return 'not_available'

  if (microTestActive && microTestReportActive) {
    const gradeStr = String(qualityGrade).toLowerCase()
    if (gradeStr.includes('promising') || qualityScore >= 60) return 'quality_promising'
    if (gradeStr.includes('risk') || (hitRate < 0.4 && sampleSize >= 30)) return 'quality_risky'
    if (gradeStr.includes('watch') || (hitRate < 0.5 && sampleSize >= 30)) return 'quality_watch'
    return 'active_snapshot'
  }

  if (sampleSize < 30 && sampleSize > 0) return 'insufficient_sample'
  if (sampleSize >= 30 && !microTestActive) return 'seed_snapshot'
  return 'seed_snapshot'
}

// ── First Real Quality Snapshot Block ─────────────────────────────────────────

export function buildFirstRealQualitySnapshot(input = {}, violations = []) {
  const core = deriveCore(input)
  const status = computeSnapshotStatus(core, violations)

  return {
    status,
    snapshot_version:        SNAPSHOT_VERSION,
    sample_size:             core.sampleSize,
    green_count:             core.greenCount,
    red_count:               core.redCount,
    hit_rate:                core.hitRate,
    micro_test_active:       core.microTestActive,
    micro_test_report_active: core.microTestReportActive,
    quality_score:           core.qualityScore,
    quality_grade:           core.qualityGrade,
    decision_state:          core.decisionState,
    // Unsafe fields — always false
    can_beta:                false,
    can_sell:                false,
  }
}

// ── Quality Snapshot Distribution Block ───────────────────────────────────────

export function buildQualitySnapshotDistribution(input = {}) {
  const core = deriveCore(input)
  const dist = input.resolved_sample_distribution ?? {}

  const bySport  = dist.by_sport  ?? []
  const byMarket = dist.by_market ?? []

  const sortedBySport = [...bySport].sort((a, b) => (b.hit_rate ?? 0) - (a.hit_rate ?? 0))

  const strongestSegments = sortedBySport.filter(s => (s.hit_rate ?? 0) > 0.6).slice(0, 2).length > 0
    ? sortedBySport.filter(s => (s.hit_rate ?? 0) > 0.6).slice(0, 2)
    : sortedBySport.slice(0, 2)

  const weakestSegments = bySport.filter(s => (s.hit_rate ?? 1) < 0.4)

  return {
    status:                'available',
    sample_size:           core.sampleSize,
    by_sport:              bySport,
    by_market:             byMarket,
    by_confidence_bucket:  dist.by_confidence_bucket ?? [],
    by_odds_bucket:        dist.by_odds_bucket       ?? [],
    by_trust_level:        dist.by_trust_level       ?? [],
    strongest_segments:    strongestSegments,
    weakest_segments:      weakestSegments,
  }
}

// ── Quality Snapshot Risk Flags Block ─────────────────────────────────────────

export function buildQualitySnapshotRiskFlags(input = {}, violations = []) {
  const core = deriveCore(input)
  const { sampleSize, hitRate, greenCount, redCount, microTestActive } = core
  const dist = input.resolved_sample_distribution ?? {}
  const bySport  = dist.by_sport  ?? []
  const byMarket = dist.by_market ?? []

  const flags = [
    {
      name:      'sample_too_small',
      level:     'blocker',
      triggered: sampleSize < 30,
      note:      `Sample size ${sampleSize} is below minimum threshold of 30.`,
    },
    {
      name:      'hit_rate_below_50',
      level:     'warning',
      triggered: sampleSize >= 5 && hitRate < 0.5,
      note:      `Hit rate ${hitRate.toFixed(3)} is below 50%.`,
    },
    {
      name:      'hit_rate_below_break_even',
      level:     'blocker',
      triggered: sampleSize >= 5 && hitRate < 0.45,
      note:      `Hit rate ${hitRate.toFixed(3)} is below break-even threshold of 45%.`,
    },
    {
      name:      'too_many_reds',
      level:     'warning',
      triggered: sampleSize >= 5 && redCount > greenCount * 1.5,
      note:      `Red count ${redCount} exceeds 1.5x green count ${greenCount}.`,
    },
    {
      name:      'single_sport_dominance',
      level:     'warning',
      triggered: bySport.length > 0 && (bySport[0]?.count ?? 0) > sampleSize * 0.8,
      note:      `First sport dominates ${Math.round(((bySport[0]?.count ?? 0) / (sampleSize || 1)) * 100)}% of sample.`,
    },
    {
      name:      'single_market_dominance',
      level:     'warning',
      triggered: byMarket.length > 0 && (byMarket[0]?.count ?? 0) > sampleSize * 0.8,
      note:      `First market dominates ${Math.round(((byMarket[0]?.count ?? 0) / (sampleSize || 1)) * 100)}% of sample.`,
    },
    {
      name:      'insufficient_distribution',
      level:     'warning',
      triggered: bySport.length <= 1 && sampleSize >= 10,
      note:      `Only ${bySport.length} sport(s) in sample of ${sampleSize}.`,
    },
    {
      name:      'micro_test_not_active',
      level:     'warning',
      triggered: !microTestActive,
      note:      'Micro-test is not active yet.',
    },
    {
      name:      'quality_policy_not_available',
      level:     'warning',
      triggered: !input.micro_test_policy,
      note:      'Micro-test policy object is not available.',
    },
  ]

  const triggeredFlags = flags.filter(f => f.triggered)
  const blockers       = triggeredFlags.filter(f => f.level === 'blocker')
  const warnings       = triggeredFlags.filter(f => f.level === 'warning')

  let riskLevel
  if (blockers.length > 0)   riskLevel = 'high'
  else if (warnings.length >= 3) riskLevel = 'medium'
  else if (warnings.length >= 1) riskLevel = 'low'
  else                           riskLevel = 'unknown'

  return {
    status:      'evaluated',
    risk_level:  riskLevel,
    flags_count: triggeredFlags.length,
    flags,
    blockers,
    warnings,
  }
}

// ── Quality Snapshot Summary Block ────────────────────────────────────────────

export function buildQualitySnapshotSummary(input = {}, violations = []) {
  const core = deriveCore(input)
  const snapshotStatus = computeSnapshotStatus(core, violations)

  let status, headline, summaryText, nextAction

  switch (snapshotStatus) {
    case 'not_available':
      status      = 'not_available'
      headline    = 'Snapshot real de qualidade ainda indisponível.'
      summaryText = 'Nenhuma amostra resolvida disponível para análise de qualidade.'
      nextAction  = 'Aguardar acumulação de picks resolvidos.'
      break
    case 'insufficient_sample':
    case 'seed_snapshot':
      status      = 'seed'
      headline    = 'Amostra inicial disponível, aguardando threshold.'
      summaryText = `Amostra de ${core.sampleSize} picks com hit rate de ${(core.hitRate * 100).toFixed(1)}%. Threshold de 30 picks necessário.`
      nextAction  = 'Continuar acumulando dados até atingir threshold de 30 picks.'
      break
    case 'active_snapshot':
    case 'quality_watch':
    case 'quality_promising':
      status      = 'active'
      headline    = 'Micro-test ativo e monitorado.'
      summaryText = `Micro-test em execução. Qualidade: ${core.qualityGrade} (score: ${core.qualityScore}). Hit rate: ${(core.hitRate * 100).toFixed(1)}%.`
      nextAction  = 'Monitorar métricas de qualidade continuamente.'
      break
    case 'quality_risky':
      status      = 'quality_watch'
      headline    = 'Atenção: qualidade abaixo do esperado.'
      summaryText = `Hit rate de ${(core.hitRate * 100).toFixed(1)}% está abaixo do esperado. Revisar sinais antes de avançar.`
      nextAction  = 'Investigar causas do hit rate baixo e revisar segmentos de risco.'
      break
    case 'critical_violation':
      status      = 'not_available'
      headline    = 'Violação crítica detectada no snapshot.'
      summaryText = 'Violação de segurança impede análise de qualidade. Investigar imediatamente.'
      nextAction  = 'Resolver violações críticas antes de prosseguir.'
      break
    default:
      status      = 'not_available'
      headline    = 'Snapshot real de qualidade ainda indisponível.'
      summaryText = 'Estado do snapshot não determinado.'
      nextAction  = 'Verificar configurações e dados acumulados.'
  }

  return {
    status,
    headline,
    summary_text:  summaryText,
    sample_size:   core.sampleSize,
    hit_rate:      core.hitRate,
    quality_grade: core.qualityGrade,
    // Unsafe fields — always false
    safe_to_beta:  false,
    safe_to_sell:  false,
    next_action:   nextAction,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateFirstRealQualitySnapshot(input = {}, options = {}) {
  const safeInput = input ?? {}

  // Detect critical violations from unsafe input fields
  const violations = []
  if (safeInput.can_beta === true || safeInput.can_beta === 'true')
    violations.push({ code: 'can_beta_true', description: 'Input can_beta=true violates safety invariant' })
  if (safeInput.can_sell === true || safeInput.can_sell === 'true')
    violations.push({ code: 'can_sell_true', description: 'Input can_sell=true violates safety invariant' })
  if (safeInput.auto_activate_micro_test === true || safeInput.auto_activate_micro_test === 'true')
    violations.push({ code: 'auto_activate_micro_test_true', description: 'Input auto_activate_micro_test=true violates safety invariant' })
  if (safeInput.auto_activation_allowed === true || safeInput.auto_activation_allowed === 'true')
    violations.push({ code: 'auto_activation_allowed_true', description: 'Input auto_activation_allowed=true violates safety invariant' })
  if (safeInput.delivery_allowed === true || safeInput.delivery_allowed === 'true')
    violations.push({ code: 'delivery_allowed_true', description: 'Input delivery_allowed=true violates safety invariant' })
  if (safeInput.real_delivery === true || safeInput.real_delivery === 'true')
    violations.push({ code: 'real_delivery_true', description: 'Input real_delivery=true violates safety invariant' })

  const firstRealQualitySnapshot     = buildFirstRealQualitySnapshot(safeInput, violations)
  const qualitySnapshotDistribution  = buildQualitySnapshotDistribution(safeInput)
  const qualitySnapshotRiskFlags     = buildQualitySnapshotRiskFlags(safeInput, violations)
  const qualitySnapshotSummary       = buildQualitySnapshotSummary(safeInput, violations)

  return {
    first_real_quality_snapshot:    firstRealQualitySnapshot,
    quality_snapshot_distribution:  qualitySnapshotDistribution,
    quality_snapshot_risk_flags:    qualitySnapshotRiskFlags,
    quality_snapshot_summary:       qualitySnapshotSummary,
  }
}
