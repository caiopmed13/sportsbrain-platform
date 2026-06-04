// syntheticBetaExperiencePreview.js
// Internal-only synthetic beta experience preview service.
// No imports from other project files. Pure functions only.

const UNSAFE_FIELDS = [
  'can_beta', 'can_sell', 'public_preview_enabled', 'external_preview_enabled',
  'user_visible_preview_enabled', 'delivery_allowed', 'real_delivery', 'real_users',
  'checkout_enabled', 'pricing_enabled'
]

function sanitizeInput(rawInput) {
  const sanitized = Object.assign({}, rawInput)
  for (const field of UNSAFE_FIELDS) {
    if (field in sanitized) {
      sanitized[field] = false
    }
  }
  return sanitized
}

export function buildSyntheticPickCardExamples(input, options = {}) {
  const cards = [
    {
      card_id: 'sim-card-001',
      synthetic: true,
      internal_only: true,
      sport: 'football',
      market: 'moneyline',
      selection: 'Synthetic Team A',
      synthetic_odds: 1.85,
      confidence_tier: 'medium',
      confidence_score: 62,
      trust_level: 'watch',
      reasoning_summary: 'Synthetic example for internal review only.',
      risk_note: 'Simulation only. Not betting advice.',
      segment_quality_label: 'insufficient_sample',
      break_even_note: 'Break-even review pending.',
      internal_only_disclaimer: 'Internal simulation only. No real delivery.',
      contains_real_user_data: false,
      contains_commercial_cta: false,
      contains_profit_claim: false,
    },
    {
      card_id: 'sim-card-002',
      synthetic: true,
      internal_only: true,
      sport: 'basketball',
      market: 'total',
      selection: 'Over 225.5',
      synthetic_odds: 1.92,
      confidence_tier: 'low',
      confidence_score: 48,
      trust_level: 'continue_collecting',
      reasoning_summary: 'Synthetic basketball total example for internal QA.',
      risk_note: 'Simulation only. Not betting advice.',
      segment_quality_label: 'needs_more_sample',
      break_even_note: 'Break-even requires more resolved data.',
      internal_only_disclaimer: 'Internal simulation only. No real delivery.',
      contains_real_user_data: false,
      contains_commercial_cta: false,
      contains_profit_claim: false,
    },
    {
      card_id: 'sim-card-003',
      synthetic: true,
      internal_only: true,
      sport: 'football',
      market: 'spread',
      selection: 'Synthetic Team B -3.5',
      synthetic_odds: 1.90,
      confidence_tier: 'medium',
      confidence_score: 55,
      trust_level: 'watch',
      reasoning_summary: 'Segment flagged for watch. Internal review only.',
      risk_note: 'Simulation only. Not betting advice.',
      segment_quality_label: 'watch',
      break_even_note: 'Edge negative — under review.',
      internal_only_disclaimer: 'Internal simulation only. No real delivery.',
      contains_real_user_data: false,
      contains_commercial_cta: false,
      contains_profit_claim: false,
    },
  ]
  return {
    status: 'generated',
    cards_count: cards.length,
    cards,
  }
}

export function buildSyntheticBetaExperiencePreview(input, violations, options = {}) {
  const hasViolations = violations.length > 0
  return {
    status: hasViolations ? 'critical_violation' : 'generated',
    preview_version: 'p3.9.7',
    simulation_only: true,
    internal_preview_only: true,
    public_preview_enabled: false,
    external_preview_enabled: false,
    user_visible_preview_enabled: false,
    cards_generated_count: 3,
    real_user_data_included: false,
    delivery_allowed: false,
    violations: hasViolations ? violations : [],
    can_beta: false,
    can_sell: false,
  }
}

export function buildExperiencePreviewSafetyNotes(input, options = {}) {
  const notes = [
    { note: 'internal_only',         description: 'This preview is for internal operator review only.' },
    { note: 'not_betting_advice',    description: 'Cards do not constitute betting advice.' },
    { note: 'no_guaranteed_results', description: 'No results are guaranteed or implied.' },
    { note: 'no_public_sharing',     description: 'Content must not be shared publicly.' },
    { note: 'no_real_users',         description: 'No real users involved in this simulation.' },
    { note: 'no_delivery',           description: 'No real delivery of picks to any recipient.' },
    { note: 'no_sell',               description: 'No commercial transaction allowed.' },
  ]
  return {
    status: 'generated',
    notes_count: notes.length,
    notes,
  }
}

export function buildSyntheticExperiencePreviewSummary(input, options = {}) {
  return {
    status: 'generated',
    headline: 'Preview interno da experiência beta sintética gerado.',
    summary_text: 'Foram criados cards sintéticos para revisão interna, sem entrega real, venda ou usuário real.',
    cards_generated_count: 3,
    internal_preview_only: true,
    public_preview_enabled: false,
    safe_to_invite_private_users: false,
    safe_to_sell: false,
  }
}

export function evaluateSyntheticBetaExperiencePreview(rawInput = {}, options = {}) {
  const violations = []
  const UNSAFE_BOOLEANS = ['can_beta', 'can_sell', 'public_preview_enabled', 'external_preview_enabled', 'user_visible_preview_enabled', 'delivery_allowed']
  for (const field of UNSAFE_BOOLEANS) {
    if (rawInput[field] === true) violations.push({ field, value: true, rejected: false })
  }
  const input = sanitizeInput(rawInput)
  const synthetic_pick_card_examples         = buildSyntheticPickCardExamples(input, options)
  const synthetic_beta_experience_preview    = buildSyntheticBetaExperiencePreview(input, violations, options)
  const experience_preview_safety_notes      = buildExperiencePreviewSafetyNotes(input, options)
  const synthetic_experience_preview_summary = buildSyntheticExperiencePreviewSummary(input, options)
  return {
    synthetic_beta_experience_preview,
    synthetic_pick_card_examples,
    experience_preview_safety_notes,
    synthetic_experience_preview_summary,
  }
}
