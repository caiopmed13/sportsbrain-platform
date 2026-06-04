// qualityProofDecisionGate.js
// Pure-function service — ESM, no imports from other project files, no DB, no network.

export const GATE_VERSION = 'p3.9.4';

// ---------------------------------------------------------------------------
// Safety invariants — these fields MUST always be false.
// If the raw input tries to set any of them to true we record a violation and
// force the value to false.
// ---------------------------------------------------------------------------
const SAFETY_INVARIANT_FIELDS = [
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
  'quality_gate_allows_beta',
  'quality_gate_allows_sell',
];

function sanitizeInput(rawInput) {
  const input = Object.assign({}, rawInput || {});
  const violations = [];

  for (const field of SAFETY_INVARIANT_FIELDS) {
    if (input[field] === true) {
      violations.push({
        field,
        attempted_value: true,
        forced_value: false,
        reason: `Safety invariant violated: ${field} must always be false`,
      });
      input[field] = false;
    } else {
      input[field] = false;
    }
  }

  return { input, violations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolvedValid(input) {
  return (
    input.resolved_sample_audit?.resolved_sample_audit?.resolved_valid ??
    input.resolved_sample_audit?.resolved_valid ??
    0
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Gate scoring
// ---------------------------------------------------------------------------
function computeGateScore(input) {
  let score = 0;

  // resolved_sample (max 20)
  const rv = resolvedValid(input);
  score += Math.min(20, Math.floor((rv / 30) * 20));

  // snapshot_quality (max 20)
  const snapStatus = input.first_real_quality_snapshot?.status;
  if (snapStatus === 'active_snapshot') {
    score += 20;
  } else if (snapStatus === 'quality_promising' || snapStatus === 'quality_watch') {
    score += 15;
  } else if (snapStatus === 'seed_snapshot') {
    score += 5;
  }

  // segment_quality (max 20)
  const segLevel = input.segment_quality_proof?.quality_proof_level;
  if (segLevel === 'segment_promising') {
    score += 20;
  } else if (segLevel === 'segment_watch') {
    score += 12;
  } else if (segLevel === 'early_signal') {
    score += 6;
  } else if (segLevel === 'insufficient') {
    score += 3;
  }

  // break_even (max 15)
  const beStatus = input.break_even_odds_review?.status;
  if (beStatus === 'evaluated') {
    score += 15;
  } else if (beStatus === 'available' || beStatus === 'generated') {
    score += 8;
  }

  // recommendation_stability (max 10)
  const stabLevel = input.recommendation_stability_check?.stability_level;
  if (stabLevel === 'stable') {
    score += 10;
  } else if (stabLevel === 'mixed') {
    score += 5;
  } else if (stabLevel === 'insufficient_runs') {
    score += 2;
  }

  // shadow_backtest (max 10)
  const backtestStatus = input.shadow_reweight_backtest?.status;
  if (backtestStatus === 'simulated') {
    score += 10;
  } else if (backtestStatus === 'empty') {
    score += 3;
  }

  // shadow_policy (max 5)
  if (input.shadow_policy_enforcement?.passed === true) {
    score += 5;
  }

  return clamp(score, 0, 100);
}

// ---------------------------------------------------------------------------
// Gate grade
// ---------------------------------------------------------------------------
function computeGateGrade(score) {
  if (score >= 90) return 'strong_shadow_only';
  if (score >= 75) return 'promising_shadow_only';
  if (score >= 60) return 'watch';
  if (score >= 40) return 'early_watch';
  return 'insufficient';
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------
function computeDecision(input, violations, gateScore) {
  const rv = resolvedValid(input);

  if (violations.length > 0) {
    return { decision: 'critical_violation', decision_reason: 'unsafe_input_detected' };
  }
  if (input.shadow_policy_enforcement?.passed === false) {
    return { decision: 'blocked', decision_reason: 'shadow_policy_enforcement_failed' };
  }
  if (rv < 10) {
    return { decision: 'collect_more_data', decision_reason: 'insufficient_sample_or_unstable_recommendations' };
  }
  if (gateScore < 40) {
    return { decision: 'collect_more_data', decision_reason: 'insufficient_sample_or_unstable_recommendations' };
  }
  if (gateScore < 60) {
    return { decision: 'quality_watch', decision_reason: 'early_signal_requires_monitoring' };
  }
  if (gateScore < 75) {
    return { decision: 'manual_review_required', decision_reason: 'promising_but_requires_operator_review' };
  }
  if (gateScore < 90) {
    return { decision: 'quality_promising_shadow_only', decision_reason: 'strong_signal_shadow_mode_only' };
  }
  return { decision: 'continue_shadow', decision_reason: 'strong_shadow_signal_continue_monitoring' };
}

// ---------------------------------------------------------------------------
// Evidence builder
// ---------------------------------------------------------------------------
export function buildQualityProofGateEvidence(input, violations) {
  const rv = resolvedValid(input);
  const snapStatus = input.first_real_quality_snapshot?.status ?? 'unknown';
  const snapStatus2 = input.first_real_quality_snapshot?.status ?? 'not_available';
  const segLevel = input.segment_quality_proof?.quality_proof_level ?? 'none';
  const beStatus = input.break_even_odds_review?.status ?? 'not_available';
  const stabLevel = input.recommendation_stability_check?.stability_level ?? 'not_available';
  const backtestStatus = input.shadow_reweight_backtest?.status ?? 'not_run';
  const policyPassed = input.shadow_policy_enforcement?.passed ?? true;

  const recommendations = input.segment_exclusion_recommendations?.recommendations ?? [];
  const recommendExcludeCount = recommendations.filter(
    (r) => r.recommendation === 'recommend_exclude'
  ).length;

  const items = [
    {
      code: 'resolved_sample_size',
      status: rv >= 30 ? 'pass' : rv >= 10 ? 'warning' : 'blocker',
      value: rv,
      required: true,
      description: 'Number of resolved valid samples accumulated.',
    },
    {
      code: 'micro_test_active_status',
      status: snapStatus === 'active_snapshot' ? 'pass' : 'warning',
      value: snapStatus,
      required: true,
      description: 'Status of the micro-test / quality snapshot.',
    },
    {
      code: 'first_quality_snapshot_status',
      status: ['active_snapshot', 'seed_snapshot'].includes(snapStatus2) ? 'pass' : 'warning',
      value: snapStatus2,
      required: true,
      description: 'First real quality snapshot availability.',
    },
    {
      code: 'segment_quality_level',
      status:
        segLevel === 'segment_promising'
          ? 'pass'
          : segLevel === 'segment_watch' || segLevel === 'early_signal'
          ? 'warning'
          : 'blocker',
      value: segLevel,
      required: true,
      description: 'Quality proof level of segments.',
    },
    {
      code: 'break_even_review_status',
      status: beStatus === 'evaluated' ? 'pass' : 'warning',
      value: beStatus,
      required: true,
      description: 'Break-even odds review completion status.',
    },
    {
      code: 'recommend_exclude_count',
      status: recommendExcludeCount > 0 ? 'warning' : 'pass',
      value: recommendExcludeCount,
      required: true,
      description: 'Number of segments with recommend_exclude recommendation.',
    },
    {
      code: 'shadow_backtest_status',
      status: backtestStatus === 'simulated' ? 'pass' : 'warning',
      value: backtestStatus,
      required: true,
      description: 'Shadow reweight backtest run status.',
    },
    {
      code: 'recommendation_stability_level',
      status:
        stabLevel === 'stable'
          ? 'pass'
          : stabLevel === 'unstable'
          ? 'blocker'
          : 'warning',
      value: stabLevel,
      required: true,
      description: 'Stability level of recommendations across runs.',
    },
    {
      code: 'shadow_policy_enforced',
      status: policyPassed === true ? 'pass' : 'blocker',
      value: policyPassed,
      required: true,
      description: 'Shadow policy enforcement check result.',
    },
    {
      code: 'no_beta_no_sell',
      status: 'pass',
      value: false,
      required: true,
      description:
        'can_beta=false, can_sell=false, quality_gate_allows_beta=false, quality_gate_allows_sell=false',
    },
  ];

  return {
    status: 'generated',
    evidence_count: items.length,
    evidence_items: items,
    violations_detected: violations.length,
  };
}

// ---------------------------------------------------------------------------
// Decision gate builder
// ---------------------------------------------------------------------------
export function buildQualityProofDecisionGate(input, evidence, violations) {
  const gateScore = computeGateScore(input);
  const gateGrade = computeGateGrade(gateScore);
  const { decision, decision_reason } = computeDecision(input, violations, gateScore);

  const blockers = (evidence.evidence_items || []).filter((e) => e.status === 'blocker');
  const warnings = (evidence.evidence_items || []).filter((e) => e.status === 'warning');

  return {
    status: decision,
    gate_version: GATE_VERSION,
    decision,
    decision_reason,
    gate_score: gateScore,
    gate_grade: gateGrade,
    can_advance_quality_proof: gateScore >= 60,
    can_prepare_beta_simulation: false,
    quality_gate_allows_beta: false,
    quality_gate_allows_sell: false,
    blockers,
    warnings,
    can_beta: false,
    can_sell: false,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Operator actions builder
// ---------------------------------------------------------------------------
export function buildQualityProofOperatorActions(input) {
  return {
    status: 'generated',
    actions_count: 7,
    actions: [
      { action: 'continue_accumulating_resolved_results', priority: 'high' },
      { action: 'review_negative_edge_segments', priority: 'medium' },
      { action: 'review_shadow_reweight_backtest', priority: 'medium' },
      { action: 'monitor_recommendation_stability', priority: 'medium' },
      { action: 'do_not_apply_engine_changes', priority: 'critical' },
      { action: 'do_not_enable_beta', priority: 'critical' },
      { action: 'do_not_sell', priority: 'critical' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------
export function buildP39QualityDecisionSummary(input, gate) {
  const decision = gate.decision;

  let status;
  if (decision === 'quality_promising_shadow_only' || decision === 'continue_shadow') {
    status = 'shadow_only';
  } else {
    status = decision;
  }

  return {
    status,
    headline: 'Quality proof ainda não libera avanço.',
    summary_text:
      'Backtest e recomendações permanecem em shadow mode; é necessário acumular mais dados e revisar estabilidade.',
    decision,
    gate_score: gate.gate_score,
    quality_gate_allows_beta: false,
    quality_gate_allows_sell: false,
    safe_to_beta: false,
    safe_to_sell: false,
    next_action: 'Continuar shadow accumulation e revisar segmentos.',
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function evaluateQualityProofDecisionGate(rawInput, options) {
  const { input, violations } = sanitizeInput(rawInput);

  const evidence = buildQualityProofGateEvidence(input, violations);
  const gate = buildQualityProofDecisionGate(input, evidence, violations);
  const operatorActions = buildQualityProofOperatorActions(input);
  const summary = buildP39QualityDecisionSummary(input, gate);

  return {
    quality_proof_gate_evidence: evidence,
    quality_proof_decision_gate: gate,
    quality_proof_operator_actions: operatorActions,
    p39_quality_decision_summary: summary,
  };
}
