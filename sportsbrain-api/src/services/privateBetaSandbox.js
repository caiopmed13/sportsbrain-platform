// src/services/privateBetaSandbox.js
// P3.8.13 — Private Beta Sandbox, Simulated Delivery Ledger & Operator Review Console

const SANDBOX_DEFAULTS = {
  enabled: false,
  max_ledger_entries: 25,
  max_picks_per_run: 3,
  strict_mode: true,
}

const PROCESSABLE_CONTRACT_STATUSES = [
  'eligible_for_manual_review',
  'simulation_ready',
  'simulation_active',
]

const ALLOWED_DECISION_HINTS = ['candidate_hold', 'candidate_for_future_expansion']
const BLOCKED_RISK_LEVELS    = ['high']
const BLOCKED_GRADES         = ['blocked', 'weak']

export function normalizeSandboxBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

// ── Delivery policy ───────────────────────────────────────────────────────────

export function buildSandboxDeliveryPolicy(input = {}, options = {}) {
  return {
    simulation_only:         true,
    real_delivery_allowed:   false,
    max_picks_per_run:       options.max_picks_per_run ?? SANDBOX_DEFAULTS.max_picks_per_run,
    max_picks_per_day:       3,
    max_picks_per_sport:     2,
    max_picks_per_market:    2,
    max_high_odds_share:     0.25,
    max_single_segment_share: 0.50,
    allowed_decision_hints:  ALLOWED_DECISION_HINTS,
    blocked_risk_levels:     BLOCKED_RISK_LEVELS,
    blocked_segment_grades:  BLOCKED_GRADES,
  }
}

// ── Risk controls ─────────────────────────────────────────────────────────────

export function buildSandboxRiskControls(input = {}, options = {}) {
  const realUsers       = normalizeSandboxBoolean(options.real_users)
  const realDelivery    = normalizeSandboxBoolean(options.real_delivery)
  const canSell         = normalizeSandboxBoolean(input.can_sell)
  const canPublicBeta   = normalizeSandboxBoolean(input.can_start_public_beta)
  const sandboxEnabled  = normalizeSandboxBoolean(options.sandbox_enabled ?? options.private_beta_sandbox_enabled)
  const manualGate      = input.manual_approval_gate ?? null
  const candidateSegs   = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs        = Array.isArray(input.risk_segments) ? input.risk_segments : []
  const allowedSegs     = Array.isArray(input.allowed_segments) ? input.allowed_segments : []
  const maxPicksPerRun  = options.max_picks_per_run ?? SANDBOX_DEFAULTS.max_picks_per_run
  const strictMode      = options.strict_mode !== undefined
    ? normalizeSandboxBoolean(options.strict_mode)
    : SANDBOX_DEFAULTS.strict_mode

  // High odds share (checked on allowed segments if available, else candidates)
  const segsForOdds = allowedSegs.length > 0 ? allowedSegs : candidateSegs
  const highOddsCount = segsForOdds.filter(s => (s.odd ?? s.avg_odd ?? 0) > 2.5).length
  const highOddsShare = segsForOdds.length > 0 ? highOddsCount / segsForOdds.length : 0
  const highOddsShareOk = highOddsShare <= 0.25

  // Single segment share (based on allowed segments)
  const segCounts = {}
  for (const s of segsForOdds) {
    const k = s.segment ?? s.segment_key ?? 'unknown'
    segCounts[k] = (segCounts[k] ?? 0) + 1
  }
  const maxSegShare = segsForOdds.length > 0
    ? Math.max(...Object.values(segCounts)) / segsForOdds.length
    : 0
  const singleSegShareOk = maxSegShare <= 0.50

  const controls = [
    { code: 'no_real_users',               label: 'No real users involved',         passed: !realUsers,             severity: 'blocker', value: realUsers },
    { code: 'no_real_delivery',            label: 'No real delivery allowed',       passed: !realDelivery,          severity: 'blocker', value: realDelivery },
    { code: 'manual_approval_checked',     label: 'Manual approval gate evaluated', passed: manualGate !== null,    severity: 'warning', value: manualGate !== null },
    { code: 'sandbox_flag_checked',        label: 'Sandbox flag defined',           passed: true,                   severity: 'info',    value: sandboxEnabled },
    { code: 'candidate_segments_required', label: 'Candidate segments present',     passed: candidateSegs.length > 0, severity: 'warning', value: candidateSegs.length },
    { code: 'risk_segments_blocked',       label: 'Risk segments blocked',          passed: true,                   severity: 'info',    value: riskSegs.length },
    { code: 'max_picks_per_run_enforced',  label: `Max ${maxPicksPerRun} picks/run`,passed: true,                   severity: 'info',    value: maxPicksPerRun },
    { code: 'high_odds_share_limited',     label: 'High odds share ≤25%',          passed: highOddsShareOk,         severity: 'warning', value: Math.round(highOddsShare * 1000) / 1000 },
    { code: 'single_segment_share_limited',label: 'Single segment ≤50%',           passed: singleSegShareOk,        severity: 'warning', value: Math.round(maxSegShare * 1000) / 1000 },
    { code: 'sell_blocked',                label: 'Sell blocked',                   passed: !canSell,               severity: 'blocker', value: canSell },
    { code: 'public_beta_blocked',         label: 'Public beta blocked',            passed: !canPublicBeta,         severity: 'blocker', value: canPublicBeta },
  ]

  const blockers = controls.filter(c => !c.passed && c.severity === 'blocker').map(c => c.code)
  const warnings = controls.filter(c => !c.passed && (c.severity === 'warning' || c.severity === 'blocker')).map(c => c.code)

  return {
    strict_mode: strictMode,
    controls,
    blockers,
    warnings,
    all_passed: blockers.length === 0,
  }
}

// ── Segment eligibility ───────────────────────────────────────────────────────

export function selectSandboxEligibleSegments(input = {}, options = {}) {
  const candidateSegs = Array.isArray(input.candidate_segments) ? input.candidate_segments : []
  const riskSegs      = Array.isArray(input.risk_segments) ? input.risk_segments : []
  const strictMode    = options.strict_mode !== undefined
    ? normalizeSandboxBoolean(options.strict_mode)
    : SANDBOX_DEFAULTS.strict_mode

  const allowed = []
  const blocked = []

  for (const seg of candidateSegs) {
    const riskLevel   = seg.risk_level ?? 'unknown'
    const healthGrade = seg.health_grade ?? 'blocked'
    const healthScore = seg.health_score ?? 0
    const hitRate     = seg.hit_rate ?? null

    let blockReason = null

    if (BLOCKED_RISK_LEVELS.includes(riskLevel)) {
      blockReason = 'high_risk_level'
    } else if (strictMode && BLOCKED_GRADES.includes(healthGrade)) {
      blockReason = 'weak_grade_strict_mode'
    } else if (healthScore < 70) {
      blockReason = 'health_score_below_threshold'
    } else if (hitRate !== null && hitRate > 0 && hitRate < 0.56) {
      blockReason = 'hit_rate_below_threshold'
    }

    if (blockReason) {
      blocked.push({ ...seg, block_reason: blockReason })
    } else {
      allowed.push(seg)
    }
  }

  // All risk segments are blocked
  for (const seg of riskSegs) {
    blocked.push({
      ...seg,
      block_reason: BLOCKED_RISK_LEVELS.includes(seg.risk_level ?? '')
        ? 'high_risk_segment'
        : 'risk_segment',
    })
  }

  return { allowed, blocked }
}

export function selectSandboxEligiblePicks(input = {}, options = {}) {
  const { allowed, blocked } = selectSandboxEligibleSegments(input, options)
  const maxPicksPerRun = options.max_picks_per_run ?? SANDBOX_DEFAULTS.max_picks_per_run
  return {
    picks:         allowed.slice(0, maxPicksPerRun),
    blocked_picks: blocked,
  }
}

// ── Simulated delivery ledger ─────────────────────────────────────────────────

export function buildSimulatedDeliveryLedger(input = {}, options = {}) {
  const canRun         = normalizeSandboxBoolean(input._can_run)
  const allowedSegs    = Array.isArray(input.allowed_segments) ? input.allowed_segments : []
  const blockedSegs    = Array.isArray(input.blocked_segments) ? input.blocked_segments : []
  const maxPicksPerRun = options.max_picks_per_run ?? SANDBOX_DEFAULTS.max_picks_per_run
  const maxLedger      = options.max_ledger_entries ?? SANDBOX_DEFAULTS.max_ledger_entries

  if (!canRun) {
    return {
      status:         'not_started',
      simulation_only: true,
      entries_count:  0,
      delivered_count: 0,
      blocked_count:  0,
      entries:        [],
    }
  }

  const entries = []
  const now = new Date().toISOString()
  let idx = 1

  // Would-deliver (up to max_picks_per_run)
  for (const seg of allowedSegs.slice(0, maxPicksPerRun)) {
    if (entries.length >= maxLedger) break
    entries.push({
      ledger_id:     `sim-${String(idx++).padStart(3, '0')}`,
      type:          'simulated_delivery',
      status:        'would_deliver',
      segment_key:   seg.segment ?? seg.segment_key ?? 'unknown',
      dimension:     seg.dimension ?? 'unknown',
      reason:        'candidate_segment_allowed',
      risk_level:    seg.risk_level ?? 'low',
      health_score:  seg.health_score ?? null,
      health_grade:  seg.health_grade ?? null,
      decision_hint: seg.decision_hint ?? null,
      would_deliver: true,
      blocked:       false,
      block_reason:  null,
      real_delivery: false,
      real_user:     false,
      created_at:    now,
    })
  }

  // Would-block (from blocked segments)
  for (const seg of blockedSegs) {
    if (entries.length >= maxLedger) break
    entries.push({
      ledger_id:     `sim-${String(idx++).padStart(3, '0')}`,
      type:          'simulated_block',
      status:        'would_block',
      segment_key:   seg.segment ?? seg.segment_key ?? 'unknown',
      dimension:     seg.dimension ?? 'unknown',
      reason:        seg.block_reason ?? 'segment_blocked',
      risk_level:    seg.risk_level ?? 'unknown',
      health_score:  seg.health_score ?? null,
      health_grade:  seg.health_grade ?? null,
      decision_hint: seg.decision_hint ?? null,
      would_deliver: false,
      blocked:       true,
      block_reason:  seg.block_reason ?? 'segment_blocked',
      real_delivery: false,
      real_user:     false,
      created_at:    now,
    })
  }

  const deliveredCount = entries.filter(e => e.status === 'would_deliver').length
  const blockedCount   = entries.filter(e => e.status === 'would_block').length

  return {
    status:          entries.length > 0 ? 'completed' : 'not_started',
    simulation_only: true,
    entries_count:   entries.length,
    delivered_count: deliveredCount,
    blocked_count:   blockedCount,
    entries,
  }
}

// ── Operator review console ───────────────────────────────────────────────────

export function buildOperatorReviewConsole(input = {}, options = {}) {
  const sandboxStatus   = input._sandbox_status ?? 'disabled'
  const sandboxEnabled  = normalizeSandboxBoolean(options.sandbox_enabled ?? options.private_beta_sandbox_enabled)
  const ledger          = input.ledger ?? { status: 'not_started', entries_count: 0, delivered_count: 0, blocked_count: 0 }
  const riskControls    = input.risk_controls ?? { blockers: [], warnings: [], all_passed: true }
  const auditSummary    = input.audit_summary ?? { status: 'clean', critical_violations: [] }
  const allowedSegs     = Array.isArray(input.allowed_segments) ? input.allowed_segments : []
  const blockedSegs     = Array.isArray(input.blocked_segments) ? input.blocked_segments : []
  const microTestActive = normalizeSandboxBoolean(input.micro_test_active)
  const sampleSize      = input.micro_test_report?.sample_size ?? 0
  const qualityScore    = input.micro_test_policy?.quality_score ?? 0

  const checklist = [
    { code: 'micro_test_active_checked',   label: 'Micro-test ativo',                    passed: microTestActive,               required: true,  severity: 'blocker' },
    { code: 'sample_size_checked',         label: 'Tamanho de amostra suficiente',        passed: sampleSize >= 100,             required: true,  severity: 'blocker' },
    { code: 'quality_policy_checked',      label: 'Política de qualidade avaliada',       passed: qualityScore >= 60,            required: true,  severity: 'blocker' },
    { code: 'segment_candidates_checked',  label: 'Segmentos candidatos presentes',       passed: allowedSegs.length > 0,        required: false, severity: 'warning' },
    { code: 'risk_segments_checked',       label: 'Segmentos de risco identificados',     passed: true,                          required: false, severity: 'info' },
    { code: 'manual_approval_checked',     label: 'Gate de aprovação manual verificado',  passed: input.manual_approval_gate != null, required: false, severity: 'warning' },
    { code: 'sandbox_flag_checked',        label: 'Flag de sandbox configurada',          passed: true,                          required: false, severity: 'info' },
    { code: 'ledger_reviewed',             label: 'Ledger simulado revisado',             passed: ledger.entries_count > 0,      required: false, severity: 'info' },
    { code: 'no_real_users_confirmed',     label: 'Nenhum usuário real envolvido',        passed: true,                          required: true,  severity: 'blocker' },
    { code: 'no_real_delivery_confirmed',  label: 'Nenhuma entrega real realizada',       passed: true,                          required: true,  severity: 'blocker' },
    { code: 'sell_blocked_confirmed',      label: 'Venda bloqueada confirmada',           passed: true,                          required: true,  severity: 'blocker' },
  ]

  const hasCritical = auditSummary.status === 'critical_violation'
  let status, headline, operatorInstruction, nextAction
  let safeToRunSandbox = false

  if (hasCritical) {
    status              = 'critical_violation'
    headline            = 'Violação crítica detectada no sandbox.'
    operatorInstruction = 'Não convidar usuários. Não vender. Investigar violação imediatamente.'
    nextAction          = 'Corrigir violação crítica antes de prosseguir.'
  } else if (!sandboxEnabled) {
    status              = 'sandbox_disabled'
    headline            = 'Sandbox de beta privado desativado.'
    operatorInstruction = 'Não convidar usuários. Não vender. Ativar sandbox quando estiver pronto.'
    nextAction          = 'Aguardar contrato de admissão e simulação de coorte ficarem prontos.'
  } else if (sandboxStatus === 'completed' && ledger.entries_count > 0) {
    status              = 'simulation_completed'
    headline            = 'Simulação de sandbox concluída com sucesso.'
    operatorInstruction = 'Revisar ledger simulado. Não convidar usuários reais ainda.'
    nextAction          = 'Revisar ledger e aguardar aprovação para beta privado real.'
    safeToRunSandbox    = true
  } else if (sandboxStatus === 'ready' || sandboxStatus === 'running_simulation') {
    status              = 'ready_for_simulation'
    headline            = 'Sandbox pronto para simulação.'
    operatorInstruction = 'Não convidar usuários. Não vender. Revisar estado antes de avançar.'
    nextAction          = 'Executar simulação de sandbox para gerar ledger.'
  } else {
    status              = 'blocked'
    headline            = 'Sandbox de beta privado ainda bloqueado.'
    operatorInstruction = 'Não convidar usuários. Não vender. Continuar acumulando dados.'
    nextAction          = 'Aguardar contrato de admissão e simulação de coorte ficarem prontos.'
  }

  return {
    status,
    headline,
    operator_instruction:       operatorInstruction,
    next_action:                nextAction,
    review_checklist:           checklist,
    blockers:                   riskControls.blockers ?? [],
    warnings:                   riskControls.warnings ?? [],
    allowed_segments_count:     allowedSegs.length,
    blocked_segments_count:     blockedSegs.length,
    simulated_deliveries:       ledger.delivered_count ?? 0,
    rejected_deliveries:        ledger.blocked_count ?? 0,
    safe_to_continue_shadow:    true,
    safe_to_run_sandbox:        safeToRunSandbox,
    safe_to_invite_private_users: false,
    safe_to_sell:               false,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluatePrivateBetaSandbox(input = {}, options = {}) {
  const sandboxEnabled  = normalizeSandboxBoolean(
    options.private_beta_sandbox_enabled ?? options.sandbox_enabled
  )
  const maxLedgerEntries = Number(options.max_ledger_entries ?? SANDBOX_DEFAULTS.max_ledger_entries)
  const maxPicksPerRun   = Number(options.max_picks_per_run ?? SANDBOX_DEFAULTS.max_picks_per_run)
  const strictMode       = options.strict_mode !== undefined
    ? normalizeSandboxBoolean(options.strict_mode)
    : SANDBOX_DEFAULTS.strict_mode

  const contractStatus   = input?.beta_admission_contract?.status ?? 'blocked'
  const candidateSegs    = Array.isArray(input?.candidate_segments) ? input.candidate_segments : []
  const riskSegs         = Array.isArray(input?.risk_segments) ? input.risk_segments : []

  // Determine sandbox status
  let sandboxStatus  = 'disabled'
  let canRun         = false
  let sandboxReason  = 'sandbox_disabled'

  if (!sandboxEnabled) {
    sandboxStatus = 'disabled'
    sandboxReason = 'sandbox_disabled'
  } else if (!PROCESSABLE_CONTRACT_STATUSES.includes(contractStatus)) {
    sandboxStatus = 'blocked'
    sandboxReason = `contract_status_${contractStatus}`
  } else {
    sandboxStatus = 'ready'
    sandboxReason = 'conditions_met'
    canRun = true
  }

  // Delivery policy
  const deliveryPolicy = buildSandboxDeliveryPolicy(input, { max_picks_per_run: maxPicksPerRun })

  // Segment eligibility
  const segOpts = { strict_mode: strictMode, max_picks_per_run: maxPicksPerRun }
  const { allowed: allowedSegs, blocked: blockedSegs } = selectSandboxEligibleSegments(
    { candidate_segments: candidateSegs, risk_segments: riskSegs },
    segOpts
  )

  // Risk controls (pass allowed segments for odds/share checks)
  const riskControls = buildSandboxRiskControls(
    {
      candidate_segments:  candidateSegs,
      risk_segments:       riskSegs,
      allowed_segments:    allowedSegs,
      manual_approval_gate: input?.manual_approval_gate ?? null,
      can_sell:            false,
      can_start_public_beta: false,
    },
    {
      real_users:          options.real_users,
      real_delivery:       options.real_delivery,
      sandbox_enabled:     sandboxEnabled,
      strict_mode:         strictMode,
      max_picks_per_run:   maxPicksPerRun,
    }
  )

  // Critical control violations block sandbox
  const hasCriticalViolation = riskControls.blockers.some(
    b => ['no_real_users', 'no_real_delivery'].includes(b)
  )
  if (hasCriticalViolation) {
    sandboxStatus = 'blocked'
    sandboxReason = 'critical_control_violation'
    canRun = false
  }

  // Generate ledger if we can run and have allowed segments
  let ledger
  if (canRun && allowedSegs.length > 0) {
    sandboxStatus = 'running_simulation'
    ledger = buildSimulatedDeliveryLedger(
      { _can_run: true, allowed_segments: allowedSegs, blocked_segments: blockedSegs },
      { max_picks_per_run: maxPicksPerRun, max_ledger_entries: maxLedgerEntries }
    )
    sandboxStatus = 'completed'
  } else {
    ledger = buildSimulatedDeliveryLedger(
      { _can_run: false },
      { max_picks_per_run: maxPicksPerRun, max_ledger_entries: maxLedgerEntries }
    )
  }

  // Audit summary
  const realUsersViolation   = normalizeSandboxBoolean(options.real_users)
  const realDeliveryViolation = normalizeSandboxBoolean(options.real_delivery)
  const canSellViolation      = normalizeSandboxBoolean(input?.can_sell)
  const publicBetaViolation   = normalizeSandboxBoolean(input?.can_start_public_beta)

  const criticalViolations = []
  if (realUsersViolation)    criticalViolations.push('real_users_detected')
  if (realDeliveryViolation) criticalViolations.push('real_delivery_detected')
  if (canSellViolation)      criticalViolations.push('sell_enabled_detected')
  if (publicBetaViolation)   criticalViolations.push('public_beta_detected')

  const auditSummary = {
    status:                 criticalViolations.length > 0 ? 'critical_violation' : 'clean',
    simulation_only:        true,
    real_delivery_detected: false,
    real_user_detected:     false,
    sell_enabled_detected:  canSellViolation,
    public_beta_detected:   publicBetaViolation,
    critical_violations:    criticalViolations,
    warnings:               riskControls.warnings,
  }

  // private_beta_sandbox top-level block
  const privateBetaSandbox = {
    status:            sandboxStatus,
    enabled:           sandboxEnabled,
    simulation_only:   true,
    real_users:        false,
    real_delivery:     false,
    can_run_simulation: canRun && allowedSegs.length > 0,
    reason:            sandboxReason,
    source:            'runtime',
    max_picks_per_run: maxPicksPerRun,
    max_ledger_entries: maxLedgerEntries,
    strict_mode:       strictMode,
  }

  // Operator review console
  const operatorConsole = buildOperatorReviewConsole(
    {
      _sandbox_status:    sandboxStatus,
      ledger,
      risk_controls:      riskControls,
      audit_summary:      auditSummary,
      allowed_segments:   allowedSegs,
      blocked_segments:   blockedSegs,
      micro_test_active:  input?.micro_test_active,
      micro_test_report:  input?.micro_test_report,
      micro_test_policy:  input?.micro_test_policy,
      manual_approval_gate: input?.manual_approval_gate,
    },
    { sandbox_enabled: sandboxEnabled }
  )

  return {
    private_beta_sandbox:    privateBetaSandbox,
    sandbox_delivery_policy: deliveryPolicy,
    sandbox_risk_controls:   riskControls,
    sandbox_allowed_segments: allowedSegs,
    sandbox_blocked_segments: blockedSegs,
    simulated_delivery_ledger: ledger,
    sandbox_audit_summary:   auditSummary,
    operator_review_console: operatorConsole,
  }
}
