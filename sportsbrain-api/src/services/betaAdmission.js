/**
 * betaAdmission.js
 * Beta Admission Contract, Manual Approval Gate & Private Cohort Simulation.
 * P3.8.12
 *
 * SAFETY invariants (never violated):
 *  - can_start_private_beta, can_start_public_beta, can_sell always false
 *  - safe_to_invite_private_users, safe_to_open_public_beta, safe_to_sell always false
 *  - simulated_delivery.real_users always false
 */

const CONTRACT_VERSION = 'p3.8.12';

const ACCEPTED_QUALITY_GRADES = new Set(['promising', 'strong', 'exceptional', 'strong_watch', 'expansion_candidate']);
const ACCEPTED_DECISION_STATES = new Set(['promising_but_early', 'decision_ready_hold']);
const WARNING_DECISION_STATES  = new Set(['quality_watch']);

export const ADMISSION_DEFAULTS = {
  quality_score_floor:       60,
  max_allowed_risk_segments: 2,
  minimum_decision_sample:   100,
};

export const COHORT_EXPOSURE_DEFAULTS = {
  max_picks_per_day:        3,
  max_picks_per_sport:      2,
  max_picks_per_market:     2,
  max_high_odds_share:      0.25,
  max_single_segment_share: 0.50,
};

// ---------------------------------------------------------------------------
// Requirements builder
// ---------------------------------------------------------------------------

export function evaluateAdmissionRequirements(input = {}, options = {}) {
  const {
    micro_test_report         = {},
    micro_test_policy         = {},
    beta_hold_review          = null,
    micro_test_active         = false,
    can_sell                  = false,
  } = input ?? {};

  const candidate_segments        = input?.candidate_segments ?? [];
  const risk_segments             = input?.risk_segments ?? [];
  const controlled_expansion_review = input?.controlled_expansion_review ?? {};

  const {
    quality_score_floor       = ADMISSION_DEFAULTS.quality_score_floor,
    max_allowed_risk_segments = ADMISSION_DEFAULTS.max_allowed_risk_segments,
  } = options;

  const minSample     = options.minimum_decision_sample
    ?? micro_test_policy?.sample_policy?.minimum_decision_sample
    ?? ADMISSION_DEFAULTS.minimum_decision_sample;

  const reportStatus      = micro_test_report?.status ?? null;
  const sampleSize        = micro_test_report?.sample_size ?? 0;
  const qualityScore      = micro_test_policy?.quality_score ?? 0;
  const qualityGrade      = micro_test_policy?.quality_grade ?? 'not_available';
  const decisionState     = micro_test_policy?.decision_state ?? 'not_started';
  const guardrailBlockers = micro_test_policy?.guardrails?.blockers ?? [];
  const expansionStatus   = controlled_expansion_review?.status ?? null;

  const expansionPasses = ['review_ready', 'candidate_segments_found', 'collecting'].includes(expansionStatus);
  const isWarningDecision = WARNING_DECISION_STATES.has(decisionState);

  return [
    {
      code:     'micro_test_active',
      label:    'Micro-Test ativo',
      required: true,
      passed:   micro_test_active === true && reportStatus === 'active',
      severity: 'blocker',
      evidence: { micro_test_active, report_status: reportStatus },
    },
    {
      code:     'minimum_decision_sample',
      label:    'Amostra mínima para decisão',
      required: true,
      passed:   sampleSize >= minSample,
      severity: 'blocker',
      evidence: { sample_size: sampleSize, minimum_decision_sample: minSample },
    },
    {
      code:     'quality_score_floor',
      label:    `Quality score >= ${quality_score_floor}`,
      required: true,
      passed:   qualityScore >= quality_score_floor,
      severity: 'blocker',
      evidence: { quality_score: qualityScore, quality_score_floor },
    },
    {
      code:     'quality_grade_minimum',
      label:    'Quality grade mínimo (promising+)',
      required: true,
      passed:   ACCEPTED_QUALITY_GRADES.has(qualityGrade),
      severity: 'blocker',
      evidence: { quality_grade: qualityGrade, accepted: [...ACCEPTED_QUALITY_GRADES] },
    },
    {
      code:     'decision_state_allowed',
      label:    'Decision state permitido',
      required: true,
      passed:   ACCEPTED_DECISION_STATES.has(decisionState),
      severity: isWarningDecision ? 'warning' : 'blocker',
      evidence: { decision_state: decisionState, accepted: [...ACCEPTED_DECISION_STATES] },
    },
    {
      code:     'candidate_segments_present',
      label:    'Segmentos candidatos presentes',
      required: true,
      passed:   candidate_segments.length >= 1,
      severity: 'blocker',
      evidence: { candidate_segments_count: candidate_segments.length },
    },
    {
      code:     'risk_segments_below_limit',
      label:    `Risk segments <= ${max_allowed_risk_segments}`,
      required: true,
      passed:   risk_segments.length <= max_allowed_risk_segments,
      severity: 'blocker',
      evidence: { risk_segments_count: risk_segments.length, max_allowed_risk_segments },
    },
    {
      code:     'no_policy_blockers',
      label:    'Sem policy blockers ativos',
      required: true,
      passed:   guardrailBlockers.length === 0,
      severity: 'blocker',
      evidence: { blockers: guardrailBlockers },
    },
    {
      code:     'controlled_expansion_review_ready',
      label:    'Expansão controlada em estado válido',
      required: true,
      passed:   expansionPasses,
      severity: 'blocker',
      evidence: { expansion_status: expansionStatus },
    },
    {
      code:     'beta_hold_review_present',
      label:    'Beta hold review presente',
      required: true,
      passed:   beta_hold_review != null && typeof beta_hold_review === 'object',
      severity: 'warning',
      evidence: { present: beta_hold_review != null },
    },
    {
      code:     'manual_approval_required',
      label:    'Aprovação manual obrigatória',
      required: true,
      passed:   true,
      severity: 'blocker',
      evidence: { required: true },
      notes:    'Aprovação manual é sempre obrigatória.',
    },
    {
      code:     'sell_blocked',
      label:    'Venda bloqueada',
      required: true,
      passed:   can_sell === false,
      severity: 'blocker',
      evidence: { can_sell },
    },
  ];
}

// ---------------------------------------------------------------------------
// Beta Admission Contract
// ---------------------------------------------------------------------------

export function buildBetaAdmissionContract(input = {}, options = {}) {
  const safeInput = input ?? {};
  const requirements = evaluateAdmissionRequirements(safeInput, options);

  const {
    micro_test_active  = false,
    micro_test_report  = {},
  } = safeInput;
  const controlled_expansion_review = safeInput.controlled_expansion_review ?? {};
  const {
    beta_manual_approval              = false,
    private_cohort_simulation_enabled = false,
  } = options;

  const minSample = options.minimum_decision_sample
    ?? input.micro_test_policy?.sample_policy?.minimum_decision_sample
    ?? ADMISSION_DEFAULTS.minimum_decision_sample;

  const sampleSize       = micro_test_report?.sample_size ?? 0;
  const expansionStatus  = controlled_expansion_review?.status ?? null;

  const passed  = requirements.filter(r => r.passed);
  const failed  = requirements.filter(r => !r.passed);

  // Technical blockers are failed requirements with 'blocker' severity
  // (manual_approval_required always passes, so it doesn't affect blocking)
  const failedBlockers = failed.filter(r => r.severity === 'blocker');
  const eligibleForReview = failedBlockers.length === 0;

  const blockers = failedBlockers.map(r => r.code);
  const warnings = [
    ...failed.filter(r => r.severity === 'warning').map(r => r.code),
    ...(expansionStatus === 'collecting' ? ['controlled_expansion_collecting'] : []),
  ];

  // Contract status
  let status;
  if (!micro_test_active || micro_test_report?.status !== 'active') {
    status = 'blocked';
  } else if (sampleSize < minSample) {
    status = 'collecting';
  } else if (!eligibleForReview) {
    status = 'blocked';
  } else if (!beta_manual_approval) {
    status = 'eligible_for_manual_review';
  } else if (!private_cohort_simulation_enabled) {
    status = 'simulation_ready';
  } else {
    status = 'simulation_active';
  }

  return {
    version:                   CONTRACT_VERSION,
    status,
    eligible_for_manual_review: eligibleForReview,
    requirements,
    passed_requirements_count:  passed.length,
    failed_requirements_count:  failed.length,
    blockers,
    warnings,
    manual_review_required:     true,
  };
}

// ---------------------------------------------------------------------------
// Manual Approval Gate
// ---------------------------------------------------------------------------

export function evaluateManualApprovalGate(input = {}, options = {}) {
  const approved = options.beta_manual_approval === true;
  return {
    required:     true,
    approved,
    source:       'env',
    env_var:      'BETA_MANUAL_APPROVAL',
    status:       approved ? 'approved' : 'approval_missing',
    approved_at:  null,
    approved_by:  null,
    notes:        'Manual approval is required before any private cohort simulation can be considered.',
  };
}

// ---------------------------------------------------------------------------
// Private Cohort Simulation
// ---------------------------------------------------------------------------

export function buildPrivateCohortSimulation(input = {}, options = {}) {
  const {
    beta_manual_approval              = false,
    private_cohort_simulation_enabled = false,
    private_cohort_size               = 0,
    private_cohort_max_daily_picks    = 0,
    _contract_status                  = null,
  } = options;

  const candidate_segments = (input ?? {}).candidate_segments ?? [];
  const risk_segments      = (input ?? {}).risk_segments ?? [];

  const validContractStatuses = new Set(['eligible_for_manual_review', 'simulation_ready', 'simulation_active']);
  const contractReady = validContractStatuses.has(_contract_status);

  const canSimulate =
    beta_manual_approval === true &&
    contractReady &&
    candidate_segments.length >= 1 &&
    private_cohort_simulation_enabled === true;

  let status;
  if (canSimulate) {
    status = 'active';
  } else if (beta_manual_approval === true && contractReady && candidate_segments.length >= 1) {
    status = 'ready';
  } else if (beta_manual_approval === true && contractReady) {
    status = 'blocked';
  } else {
    status = 'not_started';
  }

  const enabled       = canSimulate;
  const cohortSize    = enabled ? (private_cohort_size || 0) : 0;
  const maxDailyPicks = enabled
    ? (private_cohort_max_daily_picks || COHORT_EXPOSURE_DEFAULTS.max_picks_per_day)
    : 0;

  const allowedSegments = enabled
    ? candidate_segments.map(s => ({ segment: s.segment, dimension: s.dimension, health_score: s.health_score ?? null }))
    : [];
  const blockedSegments = risk_segments.map(s => ({ segment: s.segment, dimension: s.dimension, risk_level: s.risk_level ?? null }));

  const exposureLimits = enabled
    ? {
        max_picks_per_day:        maxDailyPicks,
        max_picks_per_sport:      COHORT_EXPOSURE_DEFAULTS.max_picks_per_sport,
        max_picks_per_market:     COHORT_EXPOSURE_DEFAULTS.max_picks_per_market,
        max_high_odds_share:      COHORT_EXPOSURE_DEFAULTS.max_high_odds_share,
        max_single_segment_share: COHORT_EXPOSURE_DEFAULTS.max_single_segment_share,
      }
    : {
        max_picks_per_day:        0,
        max_picks_per_sport:      0,
        max_picks_per_market:     0,
        max_high_odds_share:      0,
        max_single_segment_share: 0,
      };

  const riskControls = enabled
    ? ['high_odds_segments_blocked', 'risk_segments_excluded', 'max_daily_picks_enforced']
    : [];

  return {
    status,
    enabled,
    simulation_only:  true,
    cohort_size:      cohortSize,
    max_daily_picks:  maxDailyPicks,
    allowed_segments: allowedSegments,
    blocked_segments: blockedSegments,
    exposure_limits:  exposureLimits,
    risk_controls:    riskControls,
    simulated_delivery: {
      enabled:    false,
      channels:   [],
      real_users: false,  // SAFETY — never true
    },
  };
}

// ---------------------------------------------------------------------------
// Beta Admission Review
// ---------------------------------------------------------------------------

export function buildBetaAdmissionReview({ contract = {}, approvalGate = {}, cohortSimulation = {} } = {}, options = {}) {
  const contractStatus = contract?.status ?? 'blocked';
  const approvalStatus = approvalGate?.status ?? 'approval_missing';
  const cohortStatus   = cohortSimulation?.status ?? 'not_started';

  const eligibleForPrivateSim =
    contractStatus === 'simulation_active' &&
    approvalGate?.approved === true &&
    cohortSimulation?.enabled === true;

  const blockers = [];
  if (contractStatus === 'blocked') blockers.push('admission_contract_blocked');
  if (contractStatus === 'collecting') blockers.push('sample_still_collecting');
  if (!approvalGate?.approved) blockers.push('manual_approval_missing');
  if (cohortStatus === 'blocked') blockers.push('cohort_simulation_blocked');

  const warnings = contract?.warnings ?? [];

  let reviewStatus;
  switch (contractStatus) {
    case 'blocked':                  reviewStatus = 'blocked';                  break;
    case 'collecting':               reviewStatus = 'collecting';               break;
    case 'eligible_for_manual_review': reviewStatus = 'pending_manual_approval'; break;
    case 'simulation_ready':         reviewStatus = 'simulation_ready';         break;
    case 'simulation_active':        reviewStatus = 'simulation_active';        break;
    default:                         reviewStatus = 'blocked';
  }

  let nextAction;
  switch (contractStatus) {
    case 'blocked':
      nextAction = 'Continuar acumulando dados até micro-test ativo e amostra mínima.'; break;
    case 'collecting':
      nextAction = 'Aguardar amostra mínima para revisão de admissão.'; break;
    case 'eligible_for_manual_review':
      nextAction = 'Revisar segmentos candidatos e riscos. Definir BETA_MANUAL_APPROVAL=true quando pronto.'; break;
    case 'simulation_ready':
      nextAction = 'Ativar PRIVATE_COHORT_SIMULATION_ENABLED=true para iniciar simulação.'; break;
    default:
      nextAction = 'Monitorar simulação e aguardar dados suficientes para próxima fase.';
  }

  return {
    status:                          reviewStatus,
    admission_contract_status:       contractStatus,
    manual_approval_status:          approvalStatus,
    private_cohort_status:           cohortStatus,
    eligible_for_private_simulation: eligibleForPrivateSim,
    can_start_private_beta:          false,  // SAFETY
    can_start_public_beta:           false,  // SAFETY
    can_sell:                        false,  // SAFETY
    blockers,
    warnings,
    next_action:                     nextAction,
    review_notes:                    [],
  };
}

// ---------------------------------------------------------------------------
// Beta Admission Summary
// ---------------------------------------------------------------------------

export function buildBetaAdmissionSummary(review = {}, options = {}) {
  const contractStatus = review?.admission_contract_status ?? 'blocked';

  let headline, statusText, nextAction, operatorInstruction;

  switch (contractStatus) {
    case 'collecting':
      headline            = 'Acumulando dados — aguardando amostra mínima.';
      statusText          = 'Micro-Test ativo, mas amostra ainda insuficiente para revisão de admissão.';
      nextAction          = 'Aguardar amostra >= 100 bets resolvidas para avaliação completa.';
      operatorInstruction = 'Não convidar usuários. Continuar shadow-only.';
      break;
    case 'eligible_for_manual_review':
      headline            = 'Elegível para revisão manual de beta privado.';
      statusText          = 'Os requisitos técnicos mínimos foram atendidos, mas a aprovação manual ainda é obrigatória.';
      nextAction          = 'Revisar segmentos candidatos e riscos antes de qualquer simulação.';
      operatorInstruction = 'Ainda não convidar usuários reais nesta fase.';
      break;
    case 'simulation_ready':
      headline            = 'Pronto para simulação de coorte privada.';
      statusText          = 'Aprovação manual concedida. Aguardando ativação da simulação.';
      nextAction          = 'Ativar PRIVATE_COHORT_SIMULATION_ENABLED=true para iniciar.';
      operatorInstruction = 'Simulação apenas — nenhum usuário real.';
      break;
    case 'simulation_active':
      headline            = 'Simulação de coorte privada ativa.';
      statusText          = 'Sistema em modo de simulação controlada. Nenhum usuário real afetado.';
      nextAction          = 'Monitorar resultados simulados e aguardar próxima fase de revisão.';
      operatorInstruction = 'Simulação somente — não enviar picks reais a usuários.';
      break;
    default:  // blocked
      headline            = 'Beta privado bloqueado.';
      statusText          = 'O Micro-Test ainda não está ativo ou não atingiu amostra mínima.';
      nextAction          = 'Continuar acumulando picks resolvidas e aguardar ativação manual do Micro-Test.';
      operatorInstruction = 'Não convidar usuários. Não vender. Não abrir beta.';
  }

  return {
    headline,
    status_text:                  statusText,
    next_action:                  nextAction,
    operator_instruction:         operatorInstruction,
    safe_to_invite_private_users: false,  // SAFETY
    safe_to_open_public_beta:     false,  // SAFETY
    safe_to_sell:                 false,  // SAFETY
  };
}

// ---------------------------------------------------------------------------
// Top-level evaluateBetaAdmission
// ---------------------------------------------------------------------------

/**
 * @param {object} input — {micro_test_report, micro_test_policy, candidate_segments, risk_segments,
 *                          controlled_expansion_review, beta_hold_review, micro_test_active, can_sell}
 * @param {object} [options] — {beta_manual_approval, private_cohort_simulation_enabled,
 *                              private_cohort_size, private_cohort_max_daily_picks,
 *                              quality_score_floor, max_allowed_risk_segments}
 */
export function evaluateBetaAdmission(input = {}, options = {}) {
  const safeIn       = input ?? {};
  const contract     = buildBetaAdmissionContract(safeIn, options);
  const approvalGate = evaluateManualApprovalGate(safeIn, options);
  const cohortSim    = buildPrivateCohortSimulation(safeIn, { ...options, _contract_status: contract.status });
  const review       = buildBetaAdmissionReview({ contract, approvalGate, cohortSimulation: cohortSim }, options);
  const summary      = buildBetaAdmissionSummary(review, options);

  return {
    beta_admission_contract:   contract,
    manual_approval_gate:      approvalGate,
    private_cohort_simulation: cohortSim,
    beta_admission_review:     review,
    beta_admission_summary:    summary,
  };
}
