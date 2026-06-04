// src/services/preBetaReadinessCouncil.js
// P3.8.26 — Pre-Beta Readiness Council, Decision Record & Council Summary

const COUNCIL_VERSION = 'p3.8.26'

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeCouncilBoolean(value) {
  return value === true || value === 'true'
}

// ── Readiness Council Votes ───────────────────────────────────────────────────

const DOMAINS = [
  'data_quality',
  'micro_test_readiness',
  'micro_test_policy',
  'segment_health',
  'beta_admission',
  'sandbox_readiness',
  'cohort_monitoring',
  'governance',
  'export_security',
  'admin_security',
  'freeze_integrity',
  'commercial_safety',
  'operator_review',
]

export function buildReadinessCouncilVotes(input = {}, options = {}) {
  const freezePassed    = input.release_freeze_sentinel?.passed === true
  const operatorStatus  = input.pre_beta_operator_review?.status ?? ''
  const operatorReady   = operatorStatus === 'ready_for_internal_review'

  return DOMAINS.map(domain => {
    let vote, severity, reason, evidence

    switch (domain) {
      case 'commercial_safety':
        vote     = 'block'
        severity = 'blocker'
        reason   = 'Commercial release locks are permanently active in this phase. No sell or beta delivery permitted.'
        evidence = { can_sell: false, can_beta: false, commercial_lock: true }
        break

      case 'freeze_integrity':
        if (freezePassed) {
          vote     = 'approve_for_review'
          severity = 'approved'
          reason   = 'Release freeze sentinel passed. Freeze integrity confirmed for internal review.'
          evidence = { release_freeze_sentinel_passed: true }
        } else {
          vote     = 'block'
          severity = 'blocker'
          reason   = 'Release freeze sentinel not passed. Freeze integrity cannot be confirmed.'
          evidence = { release_freeze_sentinel_passed: false }
        }
        break

      case 'micro_test_readiness':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Micro-test readiness waiting for threshold accumulation before gate can be cleared.'
        evidence = { threshold_met: false }
        break

      case 'operator_review':
        if (operatorReady) {
          vote     = 'approve_for_review'
          severity = 'approved'
          reason   = 'Operator review is ready for internal review. Domain cleared for this phase.'
          evidence = { operator_review_status: operatorStatus }
        } else {
          vote     = 'hold'
          severity = 'hold'
          reason   = 'Operator review has not reached ready_for_internal_review status.'
          evidence = { operator_review_status: operatorStatus || 'not_set' }
        }
        break

      case 'data_quality':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Data quality evaluation pending. Awaiting sufficient resolved sample before council can clear.'
        evidence = {}
        break

      case 'micro_test_policy':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Micro-test policy guardrails not yet verified for this phase.'
        evidence = {}
        break

      case 'segment_health':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Segment health matrix not yet confirmed. Candidate segments awaiting validation.'
        evidence = {}
        break

      case 'beta_admission':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Beta admission contract is pending. No private beta users may be admitted at this stage.'
        evidence = { private_beta_allowed: false }
        break

      case 'sandbox_readiness':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Sandbox readiness has not been fully confirmed. Simulated sandbox must complete before advancing.'
        evidence = {}
        break

      case 'cohort_monitoring':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Cohort monitoring not yet active for this review cycle.'
        evidence = {}
        break

      case 'governance':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Governance review items remain pending. Formal sign-off has not been obtained.'
        evidence = {}
        break

      case 'export_security':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Export security review pending. Admin export restrictions must be confirmed.'
        evidence = {}
        break

      case 'admin_security':
        vote     = 'hold'
        severity = 'hold'
        reason   = 'Admin security audit pending. Access controls must be reviewed before any phase advance.'
        evidence = {}
        break

      default:
        vote     = 'hold'
        severity = 'hold'
        reason   = `Domain ${domain} is pending council evaluation.`
        evidence = {}
    }

    return {
      domain,
      vote,
      severity,
      reason,
      evidence,
      can_override: false,
    }
  })
}

// ── Pre-Beta Readiness Council ────────────────────────────────────────────────

export function buildPreBetaReadinessCouncil(input = {}, options = {}) {
  // Safety: detect and sanitize unsafe inputs
  const unsafeInputSanitized =
    normalizeCouncilBoolean(input.can_beta) ||
    normalizeCouncilBoolean(input.can_sell) ||
    normalizeCouncilBoolean(input.real_delivery)

  const votes = buildReadinessCouncilVotes(input, options)

  const approveForReviewCount = votes.filter(v => v.vote === 'approve_for_review').length
  const holdCount             = votes.filter(v => v.vote === 'hold').length
  const blockCount            = votes.filter(v => v.vote === 'block').length
  const votesCount            = votes.length

  // Compute decision from votes
  let decision
  if (unsafeInputSanitized || blockCount > 0) {
    decision = 'block'
  } else if (holdCount > 0) {
    decision = 'hold'
  } else {
    decision = 'review_hold'
  }

  return {
    status:                    'convened',
    council_version:           COUNCIL_VERSION,
    simulation_only:           true,
    real_authority:            false,
    can_approve_beta:          false,
    can_approve_sell:          false,
    decision,
    votes_count:               votesCount,
    approve_for_review_count:  approveForReviewCount,
    hold_count:                holdCount,
    block_count:               blockCount,
    overall_recommendation:    'continue_shadow',
    requires_future_phase:     true,
    unsafe_input_sanitized:    unsafeInputSanitized,
  }
}

// ── Pre-Beta Decision Record ──────────────────────────────────────────────────

export function buildPreBetaDecisionRecord(input = {}, options = {}) {
  const council = buildPreBetaReadinessCouncil(input, options)

  // Determine safe decision string — never allow live beta or sell decisions
  let decision
  if (council.decision === 'block') {
    decision = 'blocked'
  } else if (council.approve_for_review_count > 0 && council.hold_count === 0 && council.block_count === 0) {
    decision = 'internal_review_ready'
  } else if (council.hold_count > 0 && council.block_count === 0) {
    decision = 'review_hold'
  } else {
    decision = 'continue_shadow'
  }

  // Enforce: never private_beta_live, public_beta_live, or sell_enabled
  const forbiddenDecisions = ['private_beta_live', 'public_beta_live', 'sell_enabled']
  if (forbiddenDecisions.includes(decision)) {
    decision = 'continue_shadow'
  }

  return {
    status:                  'recorded',
    decision_version:        COUNCIL_VERSION,
    decision,
    decision_reason:         'commercial_and_delivery_locks_active',
    simulation_only:         true,
    persistence_enabled:     false,
    private_beta_allowed:    false,
    public_beta_allowed:     false,
    sell_allowed:            false,
    delivery_allowed:        false,
    record_entries: [
      { id: 'council_convened',       status: 'confirmed' },
      { id: 'commercial_lock_active', status: 'confirmed' },
      { id: 'delivery_lock_active',   status: 'confirmed' },
      { id: 'no_persistence_required', status: 'confirmed' },
      { id: 'decision_recorded',      status: 'confirmed' },
    ],
  }
}

// ── Pre-Beta Council Summary ──────────────────────────────────────────────────

export function buildPreBetaCouncilSummary(input = {}, options = {}) {
  return {
    status:                        'hold',
    headline:                      'Council pré-beta mantém bloqueio.',
    summary_text:                  'O sistema pode continuar em avaliação interna, mas não pode convidar usuários, entregar picks ou vender.',
    overall_recommendation:        'continue_shadow',
    safe_for_internal_review:      true,
    safe_to_invite_private_users:  false,
    safe_to_sell:                  false,
    next_action:                   'Preparar próxima fase de sign-off simulado sem entrega real.',
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluatePreBetaReadinessCouncil(input = {}, options = {}) {
  const safeInput = input ?? {}

  const pre_beta_readiness_council = buildPreBetaReadinessCouncil(safeInput, options)
  const readiness_council_votes    = buildReadinessCouncilVotes(safeInput, options)
  const pre_beta_decision_record   = buildPreBetaDecisionRecord(safeInput, options)
  const pre_beta_council_summary   = buildPreBetaCouncilSummary(safeInput, options)

  return {
    pre_beta_readiness_council,
    readiness_council_votes,
    pre_beta_decision_record,
    pre_beta_council_summary,
  }
}
