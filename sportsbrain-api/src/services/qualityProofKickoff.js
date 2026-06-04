// qualityProofKickoff.js — P3.9 Quality Proof Kickoff
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network

const KICKOFF_VERSION = 'p3.9.0'
const MINIMUM_SAMPLE = 30
const RECOMMENDED_SAMPLE = 100

const UNSAFE_FLAGS = [
  'can_beta',
  'can_sell',
  'auto_activate_micro_test',
  'delivery_allowed',
  'real_users',
  'real_delivery',
]

function sanitizeUnsafeFlags(input) {
  const violations = []
  const sanitized = {}
  for (const flag of UNSAFE_FLAGS) {
    if (input[flag] === true) {
      violations.push(flag)
      sanitized[flag] = false
    } else {
      sanitized[flag] = input[flag] ?? false
    }
  }
  return { sanitized, violations, unsafe_input_sanitized: violations.length > 0 }
}

function buildSeedReport({ resolved_valid, green_count, red_count }) {
  const sample_size = resolved_valid
  const total_for_rate = green_count + red_count
  const hit_rate = total_for_rate > 0 ? +(green_count / total_for_rate).toFixed(4) : 0
  const minimum_sample_met = sample_size >= MINIMUM_SAMPLE
  const recommended_sample_met = sample_size >= RECOMMENDED_SAMPLE

  let sample_quality
  if (sample_size === 0) {
    sample_quality = 'none'
  } else if (sample_size < MINIMUM_SAMPLE) {
    sample_quality = 'insufficient'
  } else if (sample_size < RECOMMENDED_SAMPLE) {
    sample_quality = hit_rate > 0.55 ? 'early_signal' : 'threshold_ready'
  } else {
    sample_quality = hit_rate > 0.5 ? 'early_signal' : 'needs_more_data'
  }

  const notes = []
  if (!minimum_sample_met) notes.push(`Need ${MINIMUM_SAMPLE - sample_size} more resolved to reach minimum threshold.`)
  if (minimum_sample_met && !recommended_sample_met) notes.push(`Need ${RECOMMENDED_SAMPLE - sample_size} more resolved to reach recommended sample.`)
  if (recommended_sample_met) notes.push('Recommended sample size reached.')

  return {
    status: 'seed_available',
    sample_size,
    green_count,
    red_count,
    hit_rate,
    sample_quality,
    minimum_sample_met,
    recommended_sample_met,
    notes,
  }
}

function buildKickoffStatus({ resolved_valid, micro_test_active, micro_test_report, sanitized, violations, unsafe_input_sanitized }) {
  const minimum_sample_met = resolved_valid >= MINIMUM_SAMPLE
  const can_evaluate_quality_now = micro_test_active && resolved_valid >= MINIMUM_SAMPLE

  let status
  let quality_proof_started

  if (resolved_valid < MINIMUM_SAMPLE) {
    status = 'waiting_for_sample'
    quality_proof_started = false
  } else if (!micro_test_active) {
    status = 'waiting_for_manual_activation'
    quality_proof_started = false
  } else if (micro_test_active && micro_test_report?.status === 'active') {
    status = 'quality_proof_started'
    quality_proof_started = true
  } else {
    status = 'ready_to_start_quality_proof'
    quality_proof_started = false
  }

  return {
    status,
    kickoff_version: KICKOFF_VERSION,
    quality_proof_started,
    minimum_sample_met,
    micro_test_required: true,
    micro_test_active,
    can_evaluate_quality_now,
    can_beta: false,
    can_sell: false,
    unsafe_input_sanitized,
    violations,
  }
}

function buildInitialQuestions() {
  const definitions = [
    { question_id: 'which_sports_produce_most_resolved', question: 'Quais esportes produzem mais resultados resolvidos no período atual?' },
    { question_id: 'which_markets_have_enough_sample', question: 'Quais mercados já possuem amostra suficiente para análise de qualidade?' },
    { question_id: 'hit_rate_above_break_even_by_odds_bucket', question: 'A taxa de acerto supera o break-even em cada bucket de odds?' },
    { question_id: 'high_confidence_outperforming_lower', question: 'Apostas de alta confiança têm desempenho superior às de confiança menor?' },
    { question_id: 'any_segments_clearly_negative', question: 'Existem segmentos claramente negativos que devem ser bloqueados?' },
    { question_id: 'trust_level_correlated_with_quality', question: 'O nível de confiança está correlacionado com a qualidade dos resultados?' },
    { question_id: 'should_any_segment_be_excluded', question: 'Algum segmento deve ser excluído do micro-test por desempenho insuficiente?' },
    { question_id: 'how_many_more_resolved_needed', question: 'Quantos resultados adicionais são necessários para concluir a prova de qualidade?' },
  ]

  const questions = definitions.map((d) => ({
    question_id: d.question_id,
    question: d.question,
    status: 'open',
    target_phase: 'P3.9',
  }))

  return {
    status: 'defined',
    questions_count: questions.length,
    questions,
  }
}

function buildKickoffSummary({ resolved_valid, kickoff_status }) {
  const remaining_to_threshold = Math.max(0, MINIMUM_SAMPLE - resolved_valid)
  const manual_activation_allowed = resolved_valid >= MINIMUM_SAMPLE
  const { status, quality_proof_started } = kickoff_status

  let headline
  switch (status) {
    case 'waiting_for_sample':
      headline = 'P3.9 iniciada: aguardando amostra resolvida suficiente.'
      break
    case 'waiting_for_manual_activation':
      headline = 'P3.9: amostra atingida. Aguardando ativação manual do micro-test.'
      break
    case 'quality_proof_started':
      headline = 'P3.9: prova de qualidade em andamento.'
      break
    case 'ready_to_start_quality_proof':
      headline = 'P3.9: pronto para iniciar prova de qualidade.'
      break
    default:
      headline = 'P3.9 iniciada: aguardando amostra resolvida suficiente.'
  }

  let next_action
  switch (status) {
    case 'waiting_for_sample':
      next_action = 'Continuar acumulando resultados green/red.'
      break
    case 'waiting_for_manual_activation':
      next_action = 'Ativar micro-test manualmente quando pronto.'
      break
    case 'quality_proof_started':
      next_action = 'Monitorar resultados do micro-test em andamento.'
      break
    case 'ready_to_start_quality_proof':
      next_action = 'Iniciar prova de qualidade com micro-test ativo.'
      break
    default:
      next_action = 'Continuar acumulando resultados green/red.'
  }

  return {
    status,
    headline,
    summary_text:
      'A fase mudou para prova real de qualidade. O micro-test deve ser ativado manualmente somente quando o threshold for atingido.',
    resolved_valid,
    remaining_to_threshold,
    manual_activation_allowed,
    quality_proof_started,
    safe_to_beta: false,
    safe_to_sell: false,
    next_action,
  }
}

export function evaluateQualityProofKickoff(input = {}, _options = {}) {
  // Sanitize unsafe flags
  const { sanitized, violations, unsafe_input_sanitized } = sanitizeUnsafeFlags(input)

  // Resolve key inputs — prefer resolved_sample_audit values
  const resolved_valid = input.resolved_sample_audit?.resolved_valid ?? input.resolved_valid ?? 0
  const green_count = input.resolved_sample_audit?.green_count ?? input.green_count ?? 0
  const red_count = input.resolved_sample_audit?.red_count ?? input.red_count ?? 0
  const micro_test_active =
    input.micro_test_activation_readiness?.micro_test_active ?? input.micro_test_active ?? false
  const micro_test_report = input.micro_test_report ?? null
  // micro_test_policy available if needed downstream
  // const micro_test_policy = input.micro_test_policy ?? null

  // Build sub-reports
  const resolved_quality_seed_report = buildSeedReport({ resolved_valid, green_count, red_count })

  const quality_proof_kickoff = buildKickoffStatus({
    resolved_valid,
    micro_test_active,
    micro_test_report,
    sanitized,
    violations,
    unsafe_input_sanitized,
  })

  const quality_proof_initial_questions = buildInitialQuestions()

  const p39_quality_kickoff_summary = buildKickoffSummary({
    resolved_valid,
    kickoff_status: quality_proof_kickoff,
  })

  return {
    resolved_quality_seed_report,
    quality_proof_kickoff,
    quality_proof_initial_questions,
    p39_quality_kickoff_summary,
  }
}
