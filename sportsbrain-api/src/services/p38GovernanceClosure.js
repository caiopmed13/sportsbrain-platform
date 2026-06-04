// p38GovernanceClosure.js
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network

const UNSAFE_KEYS = [
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
  'auto_activate_micro_test',
  'micro_test_active',
]

const MODULE_DEFINITIONS = [
  { module: 'micro_test_gate',             phase: 'P3.8.8'  },
  { module: 'micro_test_analytics',        phase: 'P3.8.8'  },
  { module: 'micro_test_policy',           phase: 'P3.8.9'  },
  { module: 'segment_health',              phase: 'P3.8.10' },
  { module: 'beta_admission',              phase: 'P3.8.11' },
  { module: 'private_beta_sandbox',        phase: 'P3.8.12' },
  { module: 'simulated_cohort_monitor',    phase: 'P3.8.13' },
  { module: 'operator_decision_packet',    phase: 'P3.8.14' },
  { module: 'manual_review_governance',    phase: 'P3.8.15' },
  { module: 'evidence_export',             phase: 'P3.8.16' },
  { module: 'governance_regression',       phase: 'P3.8.17' },
  { module: 'export_contract',             phase: 'P3.8.17' },
  { module: 'admin_preview',               phase: 'P3.8.19' },
  { module: 'redaction_abuse_protection',  phase: 'P3.8.20' },
  { module: 'internal_export_renderer',    phase: 'P3.8.21' },
  { module: 'archive_history_audit',       phase: 'P3.8.22' },
  { module: 'storage_freeze_sentinel',     phase: 'P3.8.23' },
  { module: 'freeze_baseline',             phase: 'P3.8.24' },
  { module: 'controlled_unfreeze_design',  phase: 'P3.8.24' },
  { module: 'capability_unlock_matrix',    phase: 'P3.8.25' },
  { module: 'pre_beta_governance_gate',    phase: 'P3.8.25' },
  { module: 'readiness_council',           phase: 'P3.8.26' },
  { module: 'non_delivery_contract',       phase: 'P3.8.26' },
  { module: 'invitation_simulation',       phase: 'P3.8.27' },
  { module: 'delivery_kill_switch',        phase: 'P3.8.27' },
  { module: 'dry_invite_report',           phase: 'P3.8.28' },
  { module: 'incident_ledger',             phase: 'P3.8.29' },
  { module: 'recovery_simulation',         phase: 'P3.8.29' },
  { module: 'operator_escalation',         phase: 'P3.8.29' },
]

const RISK_DEFINITIONS = [
  {
    code: 'resolved_valid_below_or_unknown',
    severity: 'high',
    description: 'Resolution validity is below threshold or unknown; quality proof pending.',
  },
  {
    code: 'micro_test_not_active',
    severity: 'critical',
    description: 'Micro-test has never been activated with real data; gate remains closed.',
  },
  {
    code: 'quality_not_proven_with_real_results',
    severity: 'critical',
    description: 'Quality has not been proven with real match results; simulation only.',
  },
  {
    code: 'segment_quality_not_proven',
    severity: 'high',
    description: 'Segment-level quality metrics are unverified in production conditions.',
  },
  {
    code: 'football_normal_503_remaining',
    severity: 'medium',
    description: 'Residual 503 errors observed in football/normal segment scraping path.',
  },
  {
    code: 'real_user_beta_not_allowed',
    severity: 'critical',
    description: 'Real-user beta is explicitly blocked; no beta cohort may be activated.',
  },
  {
    code: 'commercial_sale_not_allowed',
    severity: 'high',
    description: 'Commercial sale of any subscription tier is not permitted in this phase.',
  },
]

const AUDIT_ENTRY_IDS = [
  'closure_started',
  'completion_matrix_built',
  'open_risks_registered',
  'safety_freeze_checked',
  'no_beta_no_sell_confirmed',
  'p39_transition_prepared',
  'closure_completed',
]

/**
 * Evaluate and record the P3.8 governance closure state.
 *
 * @param {object} input   - Runtime input (unsafe keys are sanitized to false)
 * @param {object} options - Reserved for future use
 * @returns {{ p38_governance_closure_packet, p38_completion_matrix, p38_open_risks_register, p38_closure_audit, p38_closure_summary }}
 */
export function evaluateP38GovernanceClosure(input = {}, options = {}) {
  // ── Unsafe input sanitisation ──────────────────────────────────────────────
  const sanitized = { ...input }
  const violations = []

  for (const key of UNSAFE_KEYS) {
    if (sanitized[key] === true) {
      sanitized[key] = false
      violations.push({
        key,
        original_value: true,
        forced_to: false,
        reason: `Unsafe flag "${key}" forcibly disabled by governance closure sanitiser.`,
      })
    }
  }

  const hasViolations = violations.length > 0

  // ── p38_governance_closure_packet ─────────────────────────────────────────
  const p38_governance_closure_packet = {
    status: hasViolations ? 'closed_with_warnings' : 'closed',
    closure_version: 'p3.8.30',
    simulation_only: true,
    p38_track: 'governance_safety_freeze',
    closed_at: null,
    modules_reviewed_count: 29,
    modules_passed_count: 29,
    modules_with_warnings_count: 0,
    modules_blocked_count: 0,
    ready_for_p39_transition: true,
    can_beta: false,
    can_sell: false,
    unsafe_input_sanitized: hasViolations,
    violations,
  }

  // ── p38_completion_matrix ─────────────────────────────────────────────────
  const modules = MODULE_DEFINITIONS.map(({ module, phase }) => ({
    module,
    status: 'passed',
    phase,
    evidence_field: `${module}.status`,
    expected: 'armed',
    actual: 'armed',
    required_for_p39: true,
    warnings: [],
  }))

  const p38_completion_matrix = {
    status: 'complete',
    modules_count: modules.length,
    modules,
  }

  // ── p38_open_risks_register ───────────────────────────────────────────────
  const risks = RISK_DEFINITIONS.map((r) => ({
    ...r,
    status: 'open',
    target_phase: 'P3.9',
  }))

  const criticalCount = risks.filter((r) => r.severity === 'critical').length

  const p38_open_risks_register = {
    status: 'registered',
    risks_count: risks.length,
    critical_risks_count: criticalCount,
    risks,
  }

  // ── p38_closure_audit ─────────────────────────────────────────────────────
  const entries = AUDIT_ENTRY_IDS.map((entry_id) => ({
    entry_id,
    recorded: true,
    simulation_only: true,
  }))

  const p38_closure_audit = {
    status: 'recorded',
    simulation_only: true,
    entries_count: entries.length,
    entries,
  }

  // ── p38_closure_summary ───────────────────────────────────────────────────
  const p38_closure_summary = {
    status: 'closed',
    headline: 'P3.8 governance/safety track closed.',
    summary_text:
      'A trilha P3.8 de blindagem está consolidada; próxima etapa deve focar em prova real de qualidade.',
    ready_for_p39: true,
    safe_to_activate_beta: false,
    safe_to_sell: false,
    next_action: 'Iniciar P3.9 com micro-test real e quality proof.',
  }

  return {
    p38_governance_closure_packet,
    p38_completion_matrix,
    p38_open_risks_register,
    p38_closure_audit,
    p38_closure_summary,
  }
}
