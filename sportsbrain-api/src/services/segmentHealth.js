/**
 * segmentHealth.js
 * Segment health matrix, expansion review, and beta hold review.
 * Consumes micro_test_report buckets (from microTestAnalytics.js).
 *
 * SAFETY invariants (never violated):
 *  - can_expand, can_beta, can_sell are never set true
 *  - safe_to_expand, safe_to_sell are never set true
 *  - candidate_for_future_expansion=true is informational only
 */

// ---------------------------------------------------------------------------
// Sample status
// ---------------------------------------------------------------------------

export function getSampleStatus(n) {
  if (n <= 0)  return 'no_data';
  if (n <= 4)  return 'tiny_sample';
  if (n <= 9)  return 'weak_sample';
  if (n <= 24) return 'watch_sample';
  if (n <= 49) return 'useful_sample';
  return 'strong_sample';
}

// ---------------------------------------------------------------------------
// Health score (0–100)
// ---------------------------------------------------------------------------

export function scoreSegmentHealth(segment) {
  const { sample_size = 0, hit_rate = null, dimension, segment: key } = segment;

  // --- sample_score (0–25) ---
  let sample_score;
  if (sample_size <= 0)       sample_score = 0;
  else if (sample_size <= 4)  sample_score = 5;
  else if (sample_size <= 9)  sample_score = 10;
  else if (sample_size <= 24) sample_score = 15;
  else if (sample_size <= 49) sample_score = 20;
  else                        sample_score = 25;

  // --- hit_rate_score (0–35) ---
  let hit_rate_score;
  if (hit_rate == null)      hit_rate_score = 0;
  else if (hit_rate < 0.45)  hit_rate_score = 5;
  else if (hit_rate < 0.52)  hit_rate_score = 12;
  else if (hit_rate < 0.57)  hit_rate_score = 20;
  else if (hit_rate < 0.62)  hit_rate_score = 28;
  else                       hit_rate_score = 35;

  // --- consistency_score (0–15) ---
  let consistency_score = 0;
  if (sample_size >= 50 && hit_rate != null && hit_rate >= 0.55) consistency_score = 15;
  else if (sample_size >= 25 && hit_rate != null && hit_rate >= 0.55) consistency_score = 10;
  else if (sample_size >= 10 && hit_rate != null && hit_rate >= 0.52) consistency_score = 5;

  // --- trust_bonus (0–10) for trust_level dimension ---
  let trust_bonus = 0;
  if (dimension === 'trust_level' && (key === 'verified' || key === 'supported')) {
    if (hit_rate != null && hit_rate >= 0.55 && sample_size >= 10) trust_bonus = 10;
    else if (hit_rate != null && hit_rate >= 0.52) trust_bonus = 5;
  }

  // --- risk_penalty (0 to -25) ---
  let risk_penalty = 0;

  // Tiny sample with impossibly high hit rate
  if (sample_size > 0 && sample_size <= 4 && hit_rate != null && hit_rate >= 0.90) {
    risk_penalty -= 15;
  }
  // Low hit rate with meaningful sample
  if (sample_size >= 10 && hit_rate != null && hit_rate < 0.45) {
    risk_penalty -= 15;
  }
  // Zero reds with tiny sample (suspicious)
  if (segment.red_count === 0 && sample_size > 0 && sample_size <= 9) {
    risk_penalty -= 10;
  }
  // Unknown trust level
  if (dimension === 'trust_level' && key === 'unknown' && sample_size >= 10) {
    risk_penalty -= 5;
  }
  // Unknown odds
  if (dimension === 'odds_bucket' && key === 'unknown' && sample_size >= 10) {
    risk_penalty -= 5;
  }
  // High odds volatility: 2.50+ with bad hit rate
  if (dimension === 'odds_bucket' && key === '2.50+' && hit_rate != null && hit_rate < 0.42 && sample_size >= 10) {
    risk_penalty -= 15;
  }

  const raw   = sample_score + hit_rate_score + consistency_score + trust_bonus + risk_penalty;
  const score = Math.min(100, Math.max(0, raw));
  return { score, components: { sample_score, hit_rate_score, consistency_score, trust_bonus, risk_penalty } };
}

// ---------------------------------------------------------------------------
// Health grade
// ---------------------------------------------------------------------------

export function gradeSegmentHealth(score) {
  if (score >= 85) return 'expansion_candidate';
  if (score >= 70) return 'strong_watch';
  if (score >= 55) return 'promising';
  if (score >= 40) return 'watch';
  if (score >= 20) return 'weak';
  return 'blocked';
}

// ---------------------------------------------------------------------------
// Risk level
// ---------------------------------------------------------------------------

function computeRiskLevel(risks) {
  if (risks.some(r => r.severity === 'blocker')) return 'high';
  const warnings = risks.filter(r => r.severity === 'warning').length;
  if (warnings >= 2) return 'high';
  if (warnings === 1) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Decision hint
// ---------------------------------------------------------------------------

export function getDecisionHint(sampleStatus, healthGrade, riskLevel) {
  if (sampleStatus === 'no_data') return 'no_data';
  if (sampleStatus === 'tiny_sample' || sampleStatus === 'weak_sample') return 'ignore_for_now';
  if (riskLevel === 'high' && (sampleStatus === 'useful_sample' || sampleStatus === 'strong_sample')) return 'risk_review';
  if (sampleStatus === 'watch_sample') {
    return (healthGrade === 'promising' || healthGrade === 'strong_watch' || healthGrade === 'expansion_candidate')
      ? 'watchlist' : 'shadow_only';
  }
  if (sampleStatus === 'useful_sample' || sampleStatus === 'strong_sample') {
    if (healthGrade === 'blocked' || healthGrade === 'weak') return 'risk_review';
    if (healthGrade === 'watch' || healthGrade === 'promising') return 'candidate_hold';
    return 'candidate_for_future_expansion';
  }
  return 'shadow_only';
}

// ---------------------------------------------------------------------------
// Detect risks per segment
// ---------------------------------------------------------------------------

export function detectSegmentRisks(segmentKey, dimension, stats) {
  const risks = [];
  const { sample_size = 0, hit_rate = null, green_count = 0, red_count = 0 } = stats;

  // tiny_sample_overperformance
  if (sample_size > 0 && sample_size <= 4 && hit_rate != null && hit_rate >= 0.90) {
    risks.push({
      code: 'tiny_sample_overperformance',
      severity: 'warning',
      description: 'Segmento com hit rate alto, mas amostra pequena demais.',
      evidence: { sample_size, hit_rate },
      recommendation: 'Não usar como base para expansão.',
    });
  }

  // low_hit_rate
  if (sample_size >= 10 && hit_rate != null && hit_rate < 0.45) {
    risks.push({
      code: 'low_hit_rate',
      severity: 'warning',
      description: 'Hit rate abaixo do mínimo recomendado neste segmento.',
      evidence: { sample_size, hit_rate, threshold: 0.45 },
      recommendation: 'Evitar expansão neste segmento até melhora da performance.',
    });
  }

  // zero_red_small_sample
  if (red_count === 0 && sample_size > 0 && sample_size <= 9) {
    risks.push({
      code: 'zero_red_small_sample',
      severity: 'warning',
      description: 'Nenhuma perda registrada, mas amostra muito pequena para ser confiável.',
      evidence: { sample_size, green_count, red_count },
      recommendation: 'Aguardar mais dados antes de interpretar como sinal positivo.',
    });
  }

  // unknown_trust_level
  if (dimension === 'trust_level' && segmentKey === 'unknown' && sample_size >= 10) {
    risks.push({
      code: 'unknown_trust_level',
      severity: 'warning',
      description: 'Concentração de picks com trust level desconhecido.',
      evidence: { sample_size },
      recommendation: 'Executar sincronização de auditoria.',
    });
  }

  // unknown_odds
  if (dimension === 'odds_bucket' && segmentKey === 'unknown' && sample_size >= 10) {
    risks.push({
      code: 'unknown_odds',
      severity: 'warning',
      description: 'Concentração de picks sem odds registradas.',
      evidence: { sample_size },
      recommendation: 'Verificar pipeline de captura de odds.',
    });
  }

  // high_odds_volatility
  if (dimension === 'odds_bucket' && segmentKey === '2.50+' && hit_rate != null && hit_rate < 0.42 && sample_size >= 10) {
    risks.push({
      code: 'high_odds_volatility',
      severity: 'warning',
      description: 'Odds altas (2.50+) com hit rate baixo — alto risco de volatilidade.',
      evidence: { sample_size, hit_rate },
      recommendation: 'Evitar expansão em odds 2.50+ até validar edge.',
    });
  }

  // low_odds_dependency
  if (dimension === 'odds_bucket' && segmentKey === '<1.50' && sample_size >= 10) {
    risks.push({
      code: 'low_odds_dependency',
      severity: 'info',
      description: 'Segmento concentrado em odds baixas (<1.50).',
      evidence: { sample_size, hit_rate },
      recommendation: 'Validar se o edge se mantém em faixas de odds maiores.',
    });
  }

  // segment_underperformance
  if (sample_size >= 25 && hit_rate != null && hit_rate < 0.40) {
    risks.push({
      code: 'segment_underperformance',
      severity: 'blocker',
      description: 'Segmento com performance consistentemente baixa.',
      evidence: { sample_size, hit_rate },
      recommendation: 'Não expandir para este segmento.',
    });
  }

  return risks;
}

// ---------------------------------------------------------------------------
// Build a single segment entry
// ---------------------------------------------------------------------------

function buildSegmentEntry(key, dimension, stats) {
  const { green: green_count = 0, red: red_count = 0, total: sample_size = 0, hit_rate = null } = stats;
  const hit_rate_pct = hit_rate != null ? Math.round(hit_rate * 1000) / 10 : null;

  const risks       = detectSegmentRisks(key, dimension, { sample_size, hit_rate, green_count, red_count });
  const risk_level  = computeRiskLevel(risks);
  const { score: health_score } = scoreSegmentHealth({ sample_size, hit_rate, red_count, dimension, segment: key });
  const health_grade   = gradeSegmentHealth(health_score);
  const sample_status  = getSampleStatus(sample_size);
  const decision_hint  = getDecisionHint(sample_status, health_grade, risk_level);

  const recommendedAction = {
    no_data:                        'Sem dados disponíveis.',
    ignore_for_now:                 'Amostra insuficiente — ignorar por enquanto.',
    shadow_only:                    'Manter em shadow-only até crescer a amostra.',
    watchlist:                      'Continuar monitorando antes de qualquer decisão.',
    candidate_hold:                 'Candidato em hold — aguardar validação completa.',
    candidate_for_future_expansion: 'Candidato para expansão futura — requer aprovação manual.',
    risk_review:                    'Segmento problemático — não expandir.',
  }[decision_hint] ?? 'Aguardar mais dados.';

  return {
    segment:            key,
    dimension,
    sample_size,
    green_count,
    red_count,
    hit_rate,
    hit_rate_pct,
    sample_status,
    health_score,
    health_grade,
    risk_level,
    risks,
    decision_hint,
    recommended_action: recommendedAction,
  };
}

// ---------------------------------------------------------------------------
// Build full segment matrix from micro_test_report buckets
// ---------------------------------------------------------------------------

export function buildSegmentMatrix(report) {
  if (!report || report.status !== 'active') return {};

  const matrix = {};

  const DIMENSIONS = [
    ['by_sport',             'sport'],
    ['by_market',            'market'],
    ['by_confidence_bucket', 'confidence_bucket'],
    ['by_odds_bucket',       'odds_bucket'],
    ['by_trust_level',       'trust_level'],
  ];

  for (const [field, dimension] of DIMENSIONS) {
    const bucket = report[field] ?? {};
    const entries = Object.entries(bucket).map(([key, stats]) =>
      buildSegmentEntry(key, dimension, stats)
    );
    if (entries.length > 0) {
      matrix[dimension] = entries;
    }
  }

  return matrix;
}

// ---------------------------------------------------------------------------
// Flatten matrix to array of all segment entries
// ---------------------------------------------------------------------------

function flattenMatrix(matrix) {
  return Object.values(matrix).flat();
}

// ---------------------------------------------------------------------------
// Build expansion candidates
// ---------------------------------------------------------------------------

export const EXPANSION_POLICY_DEFAULTS = {
  minimum_candidate_sample:  25,
  candidate_score_threshold: 70,
  candidate_hit_rate_floor:  0.56,
};

export function buildExpansionCandidates(matrix, policy = EXPANSION_POLICY_DEFAULTS) {
  const all = flattenMatrix(matrix);
  return all.filter(seg =>
    seg.sample_size >= policy.minimum_candidate_sample &&
    seg.health_score >= policy.candidate_score_threshold &&
    (seg.hit_rate ?? 0) >= policy.candidate_hit_rate_floor &&
    seg.risk_level !== 'high'
  ).sort((a, b) => b.health_score - a.health_score);
}

// ---------------------------------------------------------------------------
// Build risk segments
// ---------------------------------------------------------------------------

export function buildRiskSegments(matrix) {
  const all = flattenMatrix(matrix);
  return all.filter(seg =>
    (seg.sample_size >= 10 && (seg.hit_rate ?? 1) < 0.45) ||
    (['blocked', 'weak'].includes(seg.health_grade) && seg.sample_size >= 25) ||
    seg.risk_level === 'high'
  ).sort((a, b) => a.health_score - b.health_score);
}

// ---------------------------------------------------------------------------
// Build controlled expansion review
// ---------------------------------------------------------------------------

export function buildControlledExpansionReview(matrix, microTestPolicy, candidates, riskSegments) {
  const reportStatus = microTestPolicy?.decision_state;

  if (!reportStatus || reportStatus === 'not_started') {
    return {
      status: 'not_started',
      can_expand: false,  // SAFETY
      can_beta: false,
      can_sell: false,
      candidate_segments_count: 0,
      risk_segments_count: 0,
      insufficient_segments_count: 0,
      top_candidate_segments: [],
      top_risk_segments: [],
      recommended_next_step: 'Continuar acumulando dados antes de qualquer expansão.',
      review_reason: 'micro_test_not_active_or_sample_insufficient',
    };
  }

  if (reportStatus === 'waiting_for_activation') {
    return {
      status: 'hold',
      can_expand: false,
      can_beta: false,
      can_sell: false,
      candidate_segments_count: 0,
      risk_segments_count: 0,
      insufficient_segments_count: 0,
      top_candidate_segments: [],
      top_risk_segments: [],
      recommended_next_step: 'Ativar MICRO_TEST_ENABLED para começar coleta.',
      review_reason: 'micro_test_not_enabled',
    };
  }

  const allSegments  = flattenMatrix(matrix);
  const insufficient = allSegments.filter(s => s.sample_status === 'no_data' || s.sample_status === 'tiny_sample' || s.sample_status === 'weak_sample');

  let status;
  if (reportStatus === 'active_collecting' || microTestPolicy?.sample_policy?.enough_for_decision === false) {
    status = 'collecting';
  } else if (candidates.length > 0 && riskSegments.length === 0) {
    status = 'candidate_segments_found';
  } else if (riskSegments.length > 0) {
    status = 'risk_detected';
  } else {
    status = 'review_ready';
  }

  return {
    status,
    can_expand: false,  // SAFETY
    can_beta:   false,
    can_sell:   false,
    candidate_segments_count:   candidates.length,
    risk_segments_count:        riskSegments.length,
    insufficient_segments_count: insufficient.length,
    top_candidate_segments:     candidates.slice(0, 3).map(s => ({ segment: s.segment, dimension: s.dimension, health_score: s.health_score, health_grade: s.health_grade, hit_rate: s.hit_rate })),
    top_risk_segments:          riskSegments.slice(0, 3).map(s => ({ segment: s.segment, dimension: s.dimension, health_score: s.health_score, risk_level: s.risk_level })),
    recommended_next_step: candidates.length > 0
      ? `${candidates.length} segmento(s) candidato(s) identificado(s) — aguardar aprovação manual antes de expansão.`
      : 'Continuar acumulando dados por segmento antes de qualquer beta.',
    review_reason: candidates.length > 0 ? 'candidate_segments_found' : 'no_candidate_segments_yet',
  };
}

// ---------------------------------------------------------------------------
// Build beta hold review
// ---------------------------------------------------------------------------

export function buildBetaHoldReview(microTestPolicy, candidates, riskSegments) {
  const decisionState  = microTestPolicy?.decision_state;
  const samplePolicy   = microTestPolicy?.sample_policy;
  const guardrails     = microTestPolicy?.guardrails;

  const blockers = [];

  if (!decisionState || decisionState === 'not_started' || decisionState === 'waiting_for_activation') {
    blockers.push('micro_test_not_active');
  }

  if (samplePolicy && !samplePolicy.enough_for_decision) {
    blockers.push('sample_below_decision_minimum');
  }

  if (candidates.length === 0 && decisionState !== 'not_started' && decisionState !== 'waiting_for_activation') {
    blockers.push('no_candidate_segments');
  }

  if (riskSegments.length > 0) {
    blockers.push('high_risk_segments_present');
  }

  if (guardrails && !guardrails.passed) {
    blockers.push('guardrails_not_passed');
  }

  // Always require manual approval — this phase never auto-approves
  blockers.push('manual_approval_missing');

  const warnings = guardrails?.warnings ?? [];

  return {
    status:                  'hold',
    can_beta:                false,  // SAFETY
    reason:                  'policy_hold',
    required_before_beta: [
      'micro_test_active',
      'minimum_decision_sample',
      'stable_segment_candidates',
      'no_blocker_risks',
      'manual_approval',
    ],
    current_blockers:        blockers,
    current_warnings:        warnings,
    manual_approval_required: true,
    next_review_phase:       'P3.8.12',
  };
}

// ---------------------------------------------------------------------------
// evaluateSegmentHealth  (top-level)
// ---------------------------------------------------------------------------

/**
 * Produces the full segment health evaluation.
 * @param {object} microTestReport — from queryMicroTestReport / buildMicroTestReport
 * @param {object} microTestPolicy — from evaluateMicroTestPolicy
 * @param {object} [expansionPolicy]
 * @returns {{ segment_health_matrix, candidate_segments, risk_segments, controlled_expansion_review, beta_hold_review }}
 */
export function evaluateSegmentHealth(microTestReport, microTestPolicy, expansionPolicy = EXPANSION_POLICY_DEFAULTS) {
  const matrix      = buildSegmentMatrix(microTestReport);
  const candidates  = buildExpansionCandidates(matrix, expansionPolicy);
  const riskSegs    = buildRiskSegments(matrix);
  const expReview   = buildControlledExpansionReview(matrix, microTestPolicy, candidates, riskSegs);
  const betaHold    = buildBetaHoldReview(microTestPolicy, candidates, riskSegs);

  return {
    segment_health_matrix:       matrix,
    candidate_segments:          candidates,
    risk_segments:               riskSegs,
    controlled_expansion_review: expReview,
    beta_hold_review:            betaHold,
  };
}
