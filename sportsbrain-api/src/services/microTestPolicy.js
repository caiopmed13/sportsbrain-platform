/**
 * microTestPolicy.js
 * Quality scoring, guardrails, risk detection, and decision policy for the Micro-Test.
 * Consumes a micro_test_report (from microTestAnalytics.js) and produces a policy evaluation.
 *
 * SAFETY invariants (never violated):
 *  - can_beta is never set true
 *  - can_sell is never set true
 *  - safe_to_expand is never set true
 *  - safe_to_sell is never set true
 */

export const SAMPLE_POLICY_DEFAULTS = {
  minimum_activation_sample: 30,
  minimum_decision_sample:   100,
  minimum_segment_sample:    10,
  minimum_sport_sample:      15,
  minimum_market_sample:     15,
};

// ---------------------------------------------------------------------------
// mapQualityGrade
// ---------------------------------------------------------------------------

export function mapQualityGrade(score) {
  if (score >= 90) return 'exceptional';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'promising';
  if (score >= 40) return 'watch';
  if (score >= 20) return 'weak';
  return 'blocked';
}

// ---------------------------------------------------------------------------
// computeSamplePolicy
// ---------------------------------------------------------------------------

export function computeSamplePolicy(report, defaults = SAMPLE_POLICY_DEFAULTS) {
  const sample_size = report?.sample_size ?? 0;
  return {
    sample_size,
    minimum_activation_sample: defaults.minimum_activation_sample,
    minimum_decision_sample:   defaults.minimum_decision_sample,
    minimum_segment_sample:    defaults.minimum_segment_sample,
    minimum_sport_sample:      defaults.minimum_sport_sample,
    minimum_market_sample:     defaults.minimum_market_sample,
    enough_for_micro_test: sample_size >= defaults.minimum_activation_sample,
    enough_for_decision:   sample_size >= defaults.minimum_decision_sample,
  };
}

// ---------------------------------------------------------------------------
// computeQualityScore
// ---------------------------------------------------------------------------

export function computeQualityScore(report) {
  if (!report || report.status !== 'active' || (report.sample_size ?? 0) === 0) {
    return { score: 0, components: {} };
  }

  const { sample_size, hit_rate, by_confidence_bucket, by_odds_bucket, by_market, by_sport, by_trust_level } = report;

  // --- sample_size_score (0–20) ---
  let sample_size_score;
  if (sample_size < 30)       sample_size_score = 0;
  else if (sample_size < 100) sample_size_score = 10;
  else if (sample_size < 250) sample_size_score = 15;
  else                        sample_size_score = 20;

  // --- hit_rate_score (0–25) ---
  let hit_rate_score;
  if (hit_rate == null)      hit_rate_score = 0;
  else if (hit_rate < 0.45)  hit_rate_score = 5;
  else if (hit_rate < 0.52)  hit_rate_score = 10;
  else if (hit_rate < 0.57)  hit_rate_score = 15;
  else if (hit_rate < 0.62)  hit_rate_score = 20;
  else                       hit_rate_score = 25;

  // --- confidence_alignment_score (0–20) ---
  const cb      = by_confidence_bucket ?? {};
  const eliteHR = cb['elite']?.hit_rate  ?? null;
  const strongHR = cb['strong']?.hit_rate ?? null;
  const mediumHR = cb['medium']?.hit_rate ?? null;
  const lowHR   = cb['low']?.hit_rate    ?? null;
  const known   = [eliteHR, strongHR, mediumHR, lowHR].filter(v => v !== null);

  let confidence_alignment_score = 10; // neutral when data is sparse
  if (known.length >= 2 && eliteHR !== null && lowHR !== null) {
    const gap = lowHR - eliteHR;
    if (gap > 0.20)      confidence_alignment_score = 0;
    else if (gap > 0.10) confidence_alignment_score = 5;
    else if (eliteHR >= lowHR) confidence_alignment_score = 20;
    else                 confidence_alignment_score = 12;
  } else if (known.length >= 2) {
    confidence_alignment_score = 15;
  }

  // --- odds_balance_score (0–10) ---
  const ob        = by_odds_bucket ?? {};
  const totalOdds = Object.values(ob).reduce((s, v) => s + (v.total ?? 0), 0);
  let odds_balance_score = 10;
  if (totalOdds > 0) {
    const lowOddsPct  = (ob['<1.50']?.total ?? 0) / totalOdds;
    const highOddsPct = (ob['2.50+']?.total ?? 0) / totalOdds;
    if (lowOddsPct > 0.80)       odds_balance_score = 2;
    else if (lowOddsPct > 0.60)  odds_balance_score = 6;
    else if (highOddsPct > 0.80) odds_balance_score = 3;
    else if (highOddsPct > 0.60) odds_balance_score = 6;
  }

  // --- market_diversity_score (0–10) ---
  const mkts = Object.entries(by_market ?? {});
  const mktsOk = mkts.filter(([, v]) => v.total >= 10);
  let market_diversity_score;
  if (mkts.length === 0) {
    market_diversity_score = 0;
  } else if (mktsOk.length >= 3) {
    market_diversity_score = 10;
  } else if (mktsOk.length === 2) {
    market_diversity_score = 7;
  } else {
    const totalMkt = mkts.reduce((s, [, v]) => s + (v.total ?? 0), 0);
    const topMkt   = Math.max(...mkts.map(([, v]) => v.total ?? 0));
    market_diversity_score = (totalMkt > 0 && topMkt / totalMkt > 0.80) ? 3 : 5;
  }

  // --- sport_diversity_score (0–5) ---
  const spts   = Object.entries(by_sport ?? {});
  const sptsOk = spts.filter(([, v]) => v.total >= 10);
  let sport_diversity_score;
  if (spts.length === 0)      sport_diversity_score = 0;
  else if (sptsOk.length >= 2) sport_diversity_score = 5;
  else                         sport_diversity_score = 3;

  // --- trust_level_score (0–10) ---
  const tl       = by_trust_level ?? {};
  const totalTl  = Object.values(tl).reduce((s, v) => s + (v.total ?? 0), 0);
  let trust_level_score;
  if (totalTl === 0) {
    trust_level_score = 0;
  } else {
    const unkPct     = (tl['unknown']?.total ?? 0) / totalTl;
    if (unkPct > 0.80)      trust_level_score = 0;
    else if (unkPct > 0.50) trust_level_score = 4;
    else {
      const hrs = [tl['verified']?.hit_rate, tl['supported']?.hit_rate].filter(v => v != null);
      if (hrs.length === 0)               trust_level_score = 5;
      else if (Math.max(...hrs) >= 0.55)  trust_level_score = 10;
      else                                trust_level_score = 6;
    }
  }

  const components = {
    sample_size_score,
    hit_rate_score,
    confidence_alignment_score,
    odds_balance_score,
    market_diversity_score,
    sport_diversity_score,
    trust_level_score,
  };

  const score = Math.min(100, Math.max(0, Object.values(components).reduce((s, v) => s + v, 0)));
  return { score, components };
}

// ---------------------------------------------------------------------------
// detectRisks
// ---------------------------------------------------------------------------

export function detectRisks(report, samplePolicy) {
  const risks = [];
  if (!report || report.status !== 'active') return risks;

  const { sample_size = 0, hit_rate, by_market, by_sport, by_confidence_bucket, by_odds_bucket, by_trust_level } = report;

  // small_sample
  if (sample_size < samplePolicy.minimum_decision_sample) {
    risks.push({
      code: 'small_sample',
      label: 'Amostra pequena',
      severity: 'blocker',
      description: 'A amostra ativa ainda é insuficiente para decisão.',
      evidence: { sample_size, minimum_decision_sample: samplePolicy.minimum_decision_sample },
      recommendation: 'Continuar acumulando shadow bets resolvidas antes de qualquer decisão.',
    });
  }

  // market_concentration
  const mkts     = Object.entries(by_market ?? {});
  const totalMkt = mkts.reduce((s, [, v]) => s + (v.total ?? 0), 0);
  if (totalMkt > 0) {
    const topMktPct = Math.max(...mkts.map(([, v]) => (v.total ?? 0) / totalMkt));
    if (topMktPct > 0.80) {
      const top = mkts.sort((a, b) => b[1].total - a[1].total)[0];
      risks.push({
        code: 'market_concentration',
        label: 'Concentração de mercado',
        severity: 'warning',
        description: 'Mais de 80% dos picks concentrados em um único mercado.',
        evidence: { top_market: top?.[0], concentration_pct: Math.round(topMktPct * 100) },
        recommendation: 'Diversificar mercados para reduzir viés de sample.',
      });
    }
  }

  // sport_concentration
  const spts     = Object.entries(by_sport ?? {});
  const totalSpt = spts.reduce((s, [, v]) => s + (v.total ?? 0), 0);
  if (totalSpt > 0) {
    const topSptPct = Math.max(...spts.map(([, v]) => (v.total ?? 0) / totalSpt));
    if (topSptPct > 0.80) {
      const top = spts.sort((a, b) => b[1].total - a[1].total)[0];
      risks.push({
        code: 'sport_concentration',
        label: 'Concentração de esporte',
        severity: 'warning',
        description: 'Mais de 80% dos picks concentrados em um único esporte.',
        evidence: { top_sport: top?.[0], concentration_pct: Math.round(topSptPct * 100) },
        recommendation: 'Expandir para múltiplos esportes para validar robustez.',
      });
    }
  }

  // confidence_inversion / elite_underperformance
  const buckets = by_confidence_bucket ?? {};
  const eHR     = buckets['elite']?.hit_rate ?? null;
  const lHR     = buckets['low']?.hit_rate   ?? null;
  if (eHR !== null && lHR !== null && lHR - eHR > 0.10) {
    risks.push({
      code: eHR < 0.45 ? 'elite_underperformance' : 'confidence_inversion',
      label: eHR < 0.45 ? 'Elite com baixa performance' : 'Inversão de confiança',
      severity: 'warning',
      description: 'Picks de alta confiança (elite) performando pior que picks de baixa confiança (low).',
      evidence: { elite_hit_rate: eHR, low_hit_rate: lHR, gap: Math.round((lHR - eHR) * 100) / 100 },
      recommendation: 'Revisar calibração do confidence score.',
    });
  }

  // odds risks
  const ob        = by_odds_bucket ?? {};
  const totalOdds = Object.values(ob).reduce((s, v) => s + (v.total ?? 0), 0);
  if (totalOdds > 0) {
    const lowOddsPct  = (ob['<1.50']?.total ?? 0) / totalOdds;
    const highOddsPct = (ob['2.50+']?.total ?? 0) / totalOdds;

    if (lowOddsPct > 0.80) {
      risks.push({
        code: 'low_odds_dependency',
        label: 'Dependência de odds baixas',
        severity: 'warning',
        description: 'Mais de 80% dos picks em odds abaixo de 1.50.',
        evidence: { low_odds_pct: Math.round(lowOddsPct * 100), total: totalOdds },
        recommendation: 'Validar se o edge se mantém em faixas de odds maiores.',
      });
    }

    const highOddsHR = ob['2.50+']?.hit_rate ?? null;
    if (highOddsPct > 0.60 && highOddsHR !== null && highOddsHR < 0.40) {
      risks.push({
        code: 'high_odds_volatility',
        label: 'Volatilidade em odds altas',
        severity: 'warning',
        description: 'Alta concentração em odds 2.50+ com hit rate baixo.',
        evidence: { high_odds_pct: Math.round(highOddsPct * 100), hit_rate: highOddsHR },
        recommendation: 'Reduzir exposição a odds muito altas até validar edge nesta faixa.',
      });
    }
  }

  // trust_level_gap
  const tl      = by_trust_level ?? {};
  const totalTl = Object.values(tl).reduce((s, v) => s + (v.total ?? 0), 0);
  if (totalTl === 0) {
    risks.push({
      code: 'trust_level_gap',
      label: 'Trust level ausente',
      severity: 'warning',
      description: 'Nenhum dado de trust level disponível.',
      evidence: { total_with_trust: 0 },
      recommendation: 'Verificar pipeline de auditoria para popular trust_level.',
    });
  } else {
    const unkPct = (tl['unknown']?.total ?? 0) / totalTl;
    if (unkPct > 0.70) {
      risks.push({
        code: 'trust_level_gap',
        label: 'Trust level majoritariamente desconhecido',
        severity: 'warning',
        description: 'Mais de 70% dos picks sem trust level verificado.',
        evidence: { unknown_pct: Math.round(unkPct * 100), total: totalTl },
        recommendation: 'Executar sincronização de auditoria para classificar picks.',
      });
    }
  }

  return risks;
}

// ---------------------------------------------------------------------------
// evaluateGuardrails
// ---------------------------------------------------------------------------

export function evaluateGuardrails(report, samplePolicy) {
  const sample_size = report?.sample_size ?? 0;
  const hit_rate    = report?.hit_rate    ?? null;
  const checks      = [];

  checks.push({
    name: 'minimum_activation_sample',
    passed: sample_size >= samplePolicy.minimum_activation_sample,
    severity: 'blocker',
    value: sample_size,
    required: samplePolicy.minimum_activation_sample,
  });

  checks.push({
    name: 'minimum_decision_sample',
    passed: sample_size >= samplePolicy.minimum_decision_sample,
    severity: 'blocker',
    value: sample_size,
    required: samplePolicy.minimum_decision_sample,
  });

  checks.push({
    name: 'hit_rate_floor',
    passed: hit_rate !== null && hit_rate >= 0.45,
    severity: 'warning',
    value: hit_rate,
    required: 0.45,
  });

  checks.push({
    name: 'red_rate_ceiling',
    passed: hit_rate !== null && (1 - hit_rate) <= 0.60,
    severity: 'warning',
    value: hit_rate !== null ? Math.round((1 - hit_rate) * 100) / 100 : null,
    required_max: 0.60,
  });

  const mkts     = Object.entries(report?.by_market ?? {});
  const spts     = Object.entries(report?.by_sport  ?? {});
  const totalMkt = mkts.reduce((s, [, v]) => s + (v.total ?? 0), 0);
  const totalSpt = spts.reduce((s, [, v]) => s + (v.total ?? 0), 0);
  const topMktPct = totalMkt > 0 ? Math.max(...mkts.map(([, v]) => (v.total ?? 0) / totalMkt)) : 0;
  const topSptPct = totalSpt > 0 ? Math.max(...spts.map(([, v]) => (v.total ?? 0) / totalSpt)) : 0;

  checks.push({
    name: 'single_market_concentration',
    passed: topMktPct <= 0.80,
    severity: 'warning',
    value: Math.round(topMktPct * 100),
    required_max: 80,
  });

  checks.push({
    name: 'single_sport_concentration',
    passed: topSptPct <= 0.80,
    severity: 'warning',
    value: Math.round(topSptPct * 100),
    required_max: 80,
  });

  const cb     = report?.by_confidence_bucket ?? {};
  const eHR    = cb['elite']?.hit_rate ?? null;
  const lHR    = cb['low']?.hit_rate   ?? null;
  const invert = eHR !== null && lHR !== null && lHR - eHR > 0.10;

  checks.push({
    name: 'low_confidence_outperforming_elite',
    passed: !invert,
    severity: 'warning',
    value: (eHR !== null && lHR !== null) ? Math.round((lHR - eHR) * 100) / 100 : 0,
    required_max: 0.10,
  });

  checks.push({
    name: 'elite_underperformance',
    passed: eHR === null || eHR >= 0.45,
    severity: 'warning',
    value: eHR,
    required: 0.45,
  });

  const ob        = report?.by_odds_bucket ?? {};
  const totalOdds = Object.values(ob).reduce((s, v) => s + (v.total ?? 0), 0);
  const lowPct    = totalOdds > 0 ? (ob['<1.50']?.total ?? 0) / totalOdds : 0;
  const highPct   = totalOdds > 0 ? (ob['2.50+']?.total ?? 0) / totalOdds : 0;

  checks.push({
    name: 'odds_too_concentrated_low',
    passed: lowPct <= 0.80,
    severity: 'warning',
    value: Math.round(lowPct * 100),
    required_max: 80,
  });

  checks.push({
    name: 'odds_too_concentrated_high',
    passed: highPct <= 0.80,
    severity: 'warning',
    value: Math.round(highPct * 100),
    required_max: 80,
  });

  const tl      = report?.by_trust_level ?? {};
  const totalTl = Object.values(tl).reduce((s, v) => s + (v.total ?? 0), 0);
  const unkPct  = totalTl > 0 ? (tl['unknown']?.total ?? 0) / totalTl : 1;

  checks.push({
    name: 'trust_level_missing_or_weak',
    passed: totalTl > 0 && unkPct <= 0.70,
    severity: 'warning',
    value: totalTl > 0 ? Math.round(unkPct * 100) : null,
    required_max: 70,
  });

  const blockers = checks.filter(c => !c.passed && c.severity === 'blocker').map(c => c.name);
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning').map(c => c.name);

  return { passed: blockers.length === 0 && warnings.length === 0, checks, blockers, warnings };
}

// ---------------------------------------------------------------------------
// computeDecisionState
// ---------------------------------------------------------------------------

export function computeDecisionState(report, qualityScore, samplePolicy) {
  const status      = report?.status;
  const sample_size = report?.sample_size ?? 0;

  if (status === 'not_started')            return 'not_started';
  if (status === 'waiting_for_activation') return 'waiting_for_activation';
  if (status !== 'active')                 return 'not_started';

  if (sample_size < samplePolicy.minimum_decision_sample) return 'active_collecting';

  if (qualityScore < 40) return 'risk_detected';
  if (qualityScore < 60) return 'quality_watch';
  if (qualityScore < 75) return 'promising_but_early';
  return 'decision_ready_hold';
}

// ---------------------------------------------------------------------------
// buildDecisionSummary
// ---------------------------------------------------------------------------

export function buildDecisionSummary(decisionState, qualityScore, samplePolicy, risks = []) {
  const base = { safe_to_expand: false, safe_to_sell: false };
  const minAct = samplePolicy.minimum_activation_sample;
  const minDec = samplePolicy.minimum_decision_sample;
  const ss     = samplePolicy.sample_size;

  switch (decisionState) {
    case 'not_started':
      return {
        ...base,
        headline: 'Micro-Test ainda não iniciado.',
        status_text: `O sistema ainda não atingiu o threshold mínimo de ${minAct} picks resolvidas.`,
        recommendation: 'Continuar acumulando resultados reais.',
        next_action: `Aguardar resolved_valid >= ${minAct} e ativação manual.`,
      };
    case 'waiting_for_activation':
      return {
        ...base,
        headline: 'Micro-Test pronto, aguardando ativação.',
        status_text: 'O threshold foi atingido, mas MICRO_TEST_ENABLED está desligado.',
        recommendation: 'Setar MICRO_TEST_ENABLED=true para iniciar o Micro-Test.',
        next_action: 'Setar MICRO_TEST_ENABLED=true nas variáveis do Worker.',
      };
    case 'active_collecting':
      return {
        ...base,
        headline: 'Micro-Test ativo, mas ainda inconclusivo.',
        status_text: `A amostra atual (${ss}) permite monitoramento inicial, mas ainda não suporta decisão (mínimo: ${minDec}).`,
        recommendation: `Continuar acumulando até pelo menos ${minDec} picks resolvidas.`,
        next_action: 'Monitorar performance por mercado, esporte, confiança e odds.',
      };
    case 'risk_detected': {
      const riskLabels = risks.filter(r => r.severity !== 'info').slice(0, 3).map(r => r.label).join(', ');
      return {
        ...base,
        headline: 'Micro-Test com riscos detectados.',
        status_text: `Quality score baixo (${qualityScore}/100). Riscos identificados precisam de atenção.`,
        recommendation: `Revisar: ${riskLabels || 'ver detalhes nos risks'}.`,
        next_action: 'Investigar riscos antes de qualquer decisão de expansão.',
      };
    }
    case 'quality_watch':
      return {
        ...base,
        headline: 'Micro-Test em observação.',
        status_text: `Quality score moderado (${qualityScore}/100). Dados insuficientes para confirmar ou negar edge.`,
        recommendation: 'Continuar acumulando e monitorar tendências por segmento.',
        next_action: 'Aguardar mais dados e verificar se indicadores melhoram com o tempo.',
      };
    case 'promising_but_early':
      return {
        ...base,
        headline: 'Micro-Test com sinais promissores, ainda em hold.',
        status_text: `Os indicadores iniciais são positivos (score: ${qualityScore}/100), mas beta e venda permanecem bloqueados por política.`,
        recommendation: 'Preparar próxima fase de validação controlada com critérios adicionais.',
        next_action: 'Executar fase P3.8.11 para expansão controlada sem venda.',
      };
    case 'decision_ready_hold':
      return {
        ...base,
        headline: 'Micro-Test com sinais fortes — em hold por política.',
        status_text: `Quality score elevado (${qualityScore}/100). Beta e venda permanecem bloqueados por decisão de produto.`,
        recommendation: 'Revisar critérios de beta readiness na próxima fase.',
        next_action: 'Executar fase P3.8.11 para revisão formal de expansão.',
      };
    default:
      return {
        ...base,
        headline: 'Estado desconhecido.',
        status_text: 'Verificar configuração do Micro-Test.',
        recommendation: 'Verificar logs.',
        next_action: 'Investigar estado.',
      };
  }
}

// ---------------------------------------------------------------------------
// evaluateMicroTestPolicy  (top-level)
// ---------------------------------------------------------------------------

/**
 * Evaluates a micro_test_report from microTestAnalytics.js and returns the full policy block.
 * @param {object|null} report — output of buildMicroTestReport / queryMicroTestReport
 * @param {object}      [policyDefaults]
 * @returns {object}
 */
export function evaluateMicroTestPolicy(report, policyDefaults = SAMPLE_POLICY_DEFAULTS) {
  const samplePolicy = computeSamplePolicy(report, policyDefaults);
  const isActive     = report?.status === 'active';

  const { score: quality_score, components: quality_components } = isActive
    ? computeQualityScore(report)
    : { score: 0, components: {} };

  const quality_grade  = isActive ? mapQualityGrade(quality_score) : 'not_available';
  const risks          = detectRisks(report, samplePolicy);
  const guardrails     = evaluateGuardrails(report, samplePolicy);
  const decision_state = computeDecisionState(report, quality_score, samplePolicy);
  const summary        = buildDecisionSummary(decision_state, quality_score, samplePolicy, risks);

  return {
    decision_state,
    quality_score,
    quality_grade,
    sample_policy: samplePolicy,
    guardrails,
    risks,
    ...(Object.keys(quality_components).length > 0 ? { quality_components } : {}),
    summary,
    can_beta: false,  // SAFETY: never true
    can_sell: false,  // SAFETY: never true
  };
}
