// p39TransitionPlan.js — Cloudflare Workers Node.js ESM
// Pure functions, no DB, no network.

const MICRO_TEST_THRESHOLD = 30;

const UNSAFE_INPUT_KEYS = [
  'auto_activate_micro_test',
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
  'micro_test_active',
];

export function evaluateP39TransitionPlan(input = {}, _options = {}) {
  // --- Unsafe input detection ---
  const violations = [];
  const sanitizedInput = { ...input };

  for (const key of UNSAFE_INPUT_KEYS) {
    if (sanitizedInput[key] === true) {
      sanitizedInput[key] = false;
      violations.push(key);
    }
  }

  const unsafeInputSanitized = violations.length > 0;

  // --- Core variables ---
  const resolved_valid = sanitizedInput.resolved_valid ?? 0;
  const remaining_to_threshold = Math.max(0, MICRO_TEST_THRESHOLD - resolved_valid);
  const autoActivateWasUnsafe = violations.includes('auto_activate_micro_test');
  const activation_allowed_now =
    resolved_valid >= MICRO_TEST_THRESHOLD && !autoActivateWasUnsafe;

  // --- p39_transition_plan ---
  const steps = [
    { step_id: 'verify_resolved_valid_count', order: 1, simulation_only: true, auto_action: false },
    { step_id: 'verify_micro_test_threshold', order: 2, simulation_only: true, auto_action: false },
    { step_id: 'set_micro_test_enabled_manually_only', order: 3, simulation_only: true, auto_action: false },
    { step_id: 'run_beta_readiness_after_activation', order: 4, simulation_only: true, auto_action: false },
    { step_id: 'monitor_micro_test_report', order: 5, simulation_only: true, auto_action: false },
    { step_id: 'evaluate_quality_policy', order: 6, simulation_only: true, auto_action: false },
    { step_id: 'review_segment_health', order: 7, simulation_only: true, auto_action: false },
    { step_id: 'produce_quality_proof_report', order: 8, simulation_only: true, auto_action: false },
    { step_id: 'decide_continue_shadow_or_private_beta_simulation', order: 9, simulation_only: true, auto_action: false },
  ];

  const p39_transition_plan = {
    status: 'ready',
    transition_version: 'p3.8.30',
    target_phase: 'P3.9',
    target_focus: 'real_micro_test_activation_and_quality_proof',
    transition_allowed: true,
    auto_activate_micro_test: false,
    manual_operator_action_required: true,
    can_beta: false,
    can_sell: false,
    unsafe_input_sanitized: unsafeInputSanitized,
    violations,
    steps_count: 9,
    steps,
  };

  // --- p39_micro_test_activation_plan ---
  const activation_blockers = activation_allowed_now ? [] : ['resolved_valid_below_threshold'];

  const p39_micro_test_activation_plan = {
    status: 'defined',
    manual_activation_only: true,
    auto_activation_allowed: false,
    required_threshold: MICRO_TEST_THRESHOLD,
    current_resolved_valid: resolved_valid,
    remaining_to_threshold,
    activation_flag: 'MICRO_TEST_ENABLED',
    activation_value_required: 'true',
    activation_allowed_now,
    activation_blockers,
    post_activation_checks: [
      'run_beta_readiness',
      'check_micro_test_report',
      'evaluate_quality_policy',
      'review_segment_health',
    ],
  };

  // --- p39_quality_proof_requirements ---
  const requirementIds = [
    'minimum_micro_test_sample_met',
    'micro_test_active',
    'hit_rate_available',
    'quality_score_available',
    'quality_grade_available',
    'segment_health_available',
    'risk_segments_identified',
    'candidate_segments_identified',
    'manual_review_completed',
    'no_sell_policy_still_active',
  ];

  const requirements = requirementIds.map((requirement_id) => ({
    requirement_id,
    required: true,
    status: 'pending',
  }));

  const p39_quality_proof_requirements = {
    status: 'defined',
    requirements_count: 10,
    requirements,
    minimum_sample_size: 30,
    recommended_sample_size: 100,
    must_segment_by: ['sport', 'market', 'confidence_bucket', 'odds_bucket', 'trust_level'],
    can_sell_after_quality_proof: false,
  };

  // --- p39_operator_checklist ---
  const itemIds = [
    'check_resolved_valid',
    'check_remaining_to_micro_test',
    'manually_enable_micro_test_only_if_threshold_met',
    'confirm_no_beta_no_sell_before_activation',
    'run_workflow_after_activation',
    'review_micro_test_report',
    'review_policy_decision_state',
    'review_segment_health',
    'decide_next_shadow_window',
  ];

  const items = itemIds.map((item_id) => ({
    item_id,
    completed: false,
    manual_only: true,
  }));

  const p39_operator_checklist = {
    status: 'defined',
    items_count: 9,
    items,
  };

  // --- p38_to_p39_operator_summary ---
  const p38_to_p39_operator_summary = {
    status: 'ready',
    headline: 'P3.8 encerrada; P3.9 deve provar qualidade real.',
    summary_text:
      'A próxima fase deve focar em ativar micro-test manualmente quando houver amostra suficiente e medir qualidade real.',
    next_phase: 'P3.9',
    next_action:
      'Verificar resolved_valid e ativar MICRO_TEST_ENABLED=true apenas se threshold >= 30.',
    can_beta: false,
    can_sell: false,
    auto_activate_micro_test: false,
  };

  return {
    p39_transition_plan,
    p39_micro_test_activation_plan,
    p39_quality_proof_requirements,
    p39_operator_checklist,
    p38_to_p39_operator_summary,
  };
}
