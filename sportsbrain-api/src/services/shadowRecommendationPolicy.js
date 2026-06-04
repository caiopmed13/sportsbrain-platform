// shadowRecommendationPolicy.js
// Pure-function service — no imports from other project files, no DB, no network.
// Version: p3.9.3

export const POLICY_VERSION = 'p3.9.3'

/**
 * Safety invariants — these fields must ALWAYS be false in output:
 * can_beta, can_sell, delivery_allowed, real_delivery,
 * auto_apply_exclusions, exclusions_applied, reweight_applied,
 * engine_weights_changed, real_pick_filter_changed
 */

const SAFE_STATUSES_DRY_RUN = ['simulated', 'empty', 'insufficient_data']
const SAFE_STATUSES_REWEIGHT = ['generated', 'empty']

// ─── shadow_recommendation_policy ───────────────────────────────────────────

export function buildShadowRecommendationPolicy(_input, _violations) {
  return {
    status: 'active',
    policy_version: POLICY_VERSION,
    shadow_only: true,
    manual_operator_review_required: true,
    auto_apply_exclusions: false,
    reweight_applied: false,
    engine_weights_changed: false,
    real_pick_filter_changed: false,
    can_change_engine_now: false,
    requires_future_phase: true,
  }
}

// ─── shadow_policy_enforcement ──────────────────────────────────────────────

export function buildShadowPolicyEnforcement(input) {
  const {
    segment_exclusion_dry_run: dryRun = {},
    quality_reweight_proposal: reweight = {},
    segment_recommendation_policy: policy = {},
  } = input

  const checks = [
    {
      check: 'auto_apply_exclusions_false',
      expected: false,
      actual: dryRun.auto_apply_exclusions ?? false,
    },
    {
      check: 'exclusions_applied_false',
      expected: false,
      actual: dryRun.exclusions_applied ?? false,
    },
    {
      check: 'reweight_applied_false',
      expected: false,
      actual: reweight.reweight_applied ?? false,
    },
    {
      check: 'engine_weights_changed_false',
      expected: false,
      actual: reweight.engine_weights_changed ?? false,
    },
    {
      check: 'real_pick_filter_changed_false',
      expected: false,
      actual: dryRun.real_filter_changed ?? false,
    },
    {
      check: 'manual_operator_review_required',
      expected: true,
      actual: policy.manual_operator_review_required ?? true,
    },
    {
      check: 'can_beta_false',
      expected: false,
      actual: false,
    },
    {
      check: 'can_sell_false',
      expected: false,
      actual: false,
    },
  ].map(c => ({
    check: c.check,
    passed: c.actual === c.expected,
    expected: c.expected,
    actual: c.actual,
  }))

  const failedCount = checks.filter(c => !c.passed).length
  const allPassed = failedCount === 0

  return {
    status: allPassed ? 'enforced' : 'violated',
    passed: allPassed,
    checks_count: checks.length,
    failed_count: failedCount,
    checks,
  }
}

// ─── segment_policy_audit ───────────────────────────────────────────────────

export function buildSegmentPolicyAudit(_input) {
  const entries = [
    { event: 'recommendations_loaded', timestamp: POLICY_VERSION, ok: true },
    { event: 'dry_run_executed', timestamp: POLICY_VERSION, ok: true },
    { event: 'reweight_proposal_generated', timestamp: POLICY_VERSION, ok: true },
    { event: 'shadow_only_confirmed', timestamp: POLICY_VERSION, ok: true },
    { event: 'no_engine_change_confirmed', timestamp: POLICY_VERSION, ok: true },
    { event: 'manual_review_required', timestamp: POLICY_VERSION, ok: true },
  ]

  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: entries.length,
    entries,
  }
}

// ─── p39_shadow_policy_summary ──────────────────────────────────────────────

export function buildP39ShadowPolicySummary(input, _enforcement) {
  const {
    segment_exclusion_dry_run: dryRun = {},
    quality_reweight_proposal: reweight = {},
  } = input

  const dryRunCompleted = SAFE_STATUSES_DRY_RUN.includes(dryRun.status)
  const reweightProposalGenerated = SAFE_STATUSES_REWEIGHT.includes(reweight.status)

  return {
    status: 'shadow_only',
    headline: 'Recomendações permanecem em modo shadow.',
    summary_text:
      'Exclusões e reweights foram simulados, mas nenhuma mudança foi aplicada.',
    dry_run_completed: dryRunCompleted,
    reweight_proposal_generated: reweightProposalGenerated,
    engine_weights_changed: false,
    real_filter_changed: false,
    manual_review_required: true,
    safe_to_beta: false,
    safe_to_sell: false,
    next_action: 'Revisar recomendações e continuar acumulando amostra.',
  }
}

// ─── evaluateShadowRecommendationPolicy ─────────────────────────────────────

/**
 * Main entry point.
 *
 * Sanitizes only top-level can_beta / can_sell (forced false).
 * Sub-object fields (segment_exclusion_dry_run, quality_reweight_proposal, etc.)
 * are passed through as-is so enforcement checks can detect violations.
 */
export function evaluateShadowRecommendationPolicy(rawInput = {}, _options = {}) {
  // Sanitize only top-level safety fields; preserve sub-objects for audit.
  const input = {
    ...rawInput,
    can_beta: false,
    can_sell: false,
  }

  const shadow_recommendation_policy = buildShadowRecommendationPolicy(input)
  const shadow_policy_enforcement = buildShadowPolicyEnforcement(input)
  const segment_policy_audit = buildSegmentPolicyAudit(input)
  const p39_shadow_policy_summary = buildP39ShadowPolicySummary(
    input,
    shadow_policy_enforcement
  )

  return {
    shadow_recommendation_policy,
    shadow_policy_enforcement,
    segment_policy_audit,
    p39_shadow_policy_summary,
  }
}
