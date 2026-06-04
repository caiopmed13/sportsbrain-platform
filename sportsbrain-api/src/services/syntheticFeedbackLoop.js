// syntheticFeedbackLoop.js — P3.9 synthetic feedback loop service
// Pure functions only, no external imports

const UNSAFE_FIELDS = [
  'can_beta', 'can_sell', 'real_user_feedback', 'external_feedback_collected',
  'delivery_allowed', 'real_delivery', 'real_users', 'checkout_enabled', 'pricing_enabled'
]

function sanitizeInput(rawInput) {
  const input = { ...rawInput }
  for (const field of UNSAFE_FIELDS) {
    if (field in input) {
      delete input[field]
    }
  }
  return input
}

export function buildSimulatedFeedbackEntries(input, options = {}) {
  const entries = [
    {
      feedback_id: 'sim-feedback-001',
      source: 'internal_operator_simulation',
      real_user: false,
      category: 'clarity',
      score: 4,
      comment: 'Synthetic feedback: reasoning is understandable but needs shorter wording.',
      requires_change: true,
      external: false,
    },
    {
      feedback_id: 'sim-feedback-002',
      source: 'internal_operator_simulation',
      real_user: false,
      category: 'risk_language',
      score: 3,
      comment: 'Risk note could be more prominent and clearly worded.',
      requires_change: true,
      external: false,
    },
    {
      feedback_id: 'sim-feedback-003',
      source: 'internal_operator_simulation',
      real_user: false,
      category: 'confidence_explanation',
      score: 4,
      comment: 'Confidence explanation is clear but slightly too technical for beta.',
      requires_change: false,
      external: false,
    },
    {
      feedback_id: 'sim-feedback-004',
      source: 'internal_operator_simulation',
      real_user: false,
      category: 'operator_actionability',
      score: 5,
      comment: 'Clear enough for operator review purposes.',
      requires_change: false,
      external: false,
    },
  ]
  return {
    status: 'generated',
    entries_count: entries.length,
    entries,
  }
}

export function buildSyntheticFeedbackLoop(input, violations, options = {}) {
  const hasViolations = violations.length > 0
  return {
    status: hasViolations ? 'critical_violation' : 'simulated',
    loop_version: 'p3.9.7',
    simulation_only: true,
    feedback_source: 'internal_operator_simulation',
    real_user_feedback: false,
    external_feedback_collected: false,
    feedback_entries_count: 4,
    requires_operator_review: true,
    violations: hasViolations ? violations : [],
    can_beta: false,
    can_sell: false,
  }
}

export function buildFeedbackLoopAnalysis(input, feedbackEntries, options = {}) {
  const entries = feedbackEntries.entries ?? []
  const scores = entries.map(e => e.score)
  const average_score = scores.length > 0
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
    : 0
  const requires_change_count = entries.filter(e => e.requires_change).length

  return {
    status: 'analyzed',
    average_score,
    requires_change_count,
    strengths: ['operator_actionability_clear', 'confidence_explanation_adequate'],
    issues: ['reasoning_too_long', 'risk_note_not_prominent'],
    recommended_updates: [
      'shorten_reasoning',
      'clarify_not_betting_advice',
      'surface_risk_note',
      'avoid_overconfidence_language',
    ],
    safe_for_internal_preview: true,
    safe_for_real_users: false,
    safe_to_sell: false,
  }
}

export function buildFeedbackLoopOperatorSummary(input, analysis, options = {}) {
  return {
    status: 'needs_internal_iteration',
    headline: 'Feedback sintético coletado para UX interna.',
    summary_text: 'O feedback sugere melhorias de clareza e linguagem de risco antes de qualquer simulação mais ampla.',
    average_score: analysis.average_score,
    requires_change_count: analysis.requires_change_count,
    safe_for_real_users: false,
    safe_to_sell: false,
    next_action: 'Ajustar copy dos cards sintéticos e repetir preview interno.',
  }
}

export function buildP39ExperiencePreviewSummary(input, analysis, options = {}) {
  return {
    status: 'needs_internal_iteration',
    headline: 'Preview interno de experiência beta sintética concluído.',
    summary_text: 'Cards sintéticos e feedback loop simulados internamente. Melhorias de UX necessárias antes de avançar.',
    internal_preview_only: true,
    public_preview_enabled: false,
    cards_generated_count: 3,
    average_feedback_score: analysis.average_score,
    safe_for_real_users: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function evaluateSyntheticFeedbackLoop(rawInput = {}, options = {}) {
  const violations = []
  for (const field of ['can_beta', 'can_sell', 'real_user_feedback', 'external_feedback_collected']) {
    if (rawInput[field] === true) violations.push({ field, value: true, rejected: false })
  }
  const input = sanitizeInput(rawInput)
  const simulated_feedback_entries     = buildSimulatedFeedbackEntries(input, options)
  const synthetic_feedback_loop        = buildSyntheticFeedbackLoop(input, violations, options)
  const feedback_loop_analysis         = buildFeedbackLoopAnalysis(input, simulated_feedback_entries, options)
  const feedback_loop_operator_summary = buildFeedbackLoopOperatorSummary(input, feedback_loop_analysis, options)
  const p39_experience_preview_summary = buildP39ExperiencePreviewSummary(input, feedback_loop_analysis, options)
  return {
    synthetic_feedback_loop,
    simulated_feedback_entries,
    feedback_loop_analysis,
    feedback_loop_operator_summary,
    p39_experience_preview_summary,
  }
}
