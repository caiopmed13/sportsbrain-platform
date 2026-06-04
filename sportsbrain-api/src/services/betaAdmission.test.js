/**
 * betaAdmission.test.js
 * Run with: node src/services/betaAdmission.test.js
 */
import assert from 'assert';
import {
  evaluateAdmissionRequirements,
  buildBetaAdmissionContract,
  evaluateManualApprovalGate,
  buildPrivateCohortSimulation,
  buildBetaAdmissionReview,
  buildBetaAdmissionSummary,
  evaluateBetaAdmission,
  ADMISSION_DEFAULTS,
  COHORT_EXPOSURE_DEFAULTS,
} from './betaAdmission.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoodInput(overrides = {}) {
  return {
    micro_test_active: true,
    micro_test_report: { status: 'active', sample_size: 150 },
    micro_test_policy: {
      quality_score:  75,
      quality_grade:  'strong',
      decision_state: 'decision_ready_hold',
      guardrails:     { blockers: [], warnings: [] },
      sample_policy:  { minimum_decision_sample: 100, enough_for_decision: true },
    },
    candidate_segments: [{ segment: 'football', dimension: 'sport', health_score: 80 }],
    risk_segments:      [],
    controlled_expansion_review: { status: 'candidate_segments_found' },
    beta_hold_review:   { status: 'hold', can_beta: false },
    can_sell:           false,
    ...overrides,
  };
}

function makeGoodOptions(overrides = {}) {
  return {
    beta_manual_approval:              false,
    private_cohort_simulation_enabled: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Teste 1 — live atual bloqueado
// ---------------------------------------------------------------------------
console.log('\nTeste 1 — live atual bloqueado');

test('contract.status=blocked when micro_test not active', () => {
  const out = evaluateBetaAdmission({
    micro_test_active: false,
    micro_test_report: { status: 'not_started', sample_size: 0 },
    candidate_segments: [],
    risk_segments: [],
    can_sell: false,
  });
  assert.strictEqual(out.beta_admission_contract.status, 'blocked');
  assert.strictEqual(out.beta_admission_contract.eligible_for_manual_review, false);
  assert.strictEqual(out.manual_approval_gate.approved, false);
  assert.strictEqual(out.private_cohort_simulation.status, 'not_started');
  assert.strictEqual(out.beta_admission_review.can_start_private_beta, false);
  assert.strictEqual(out.beta_admission_review.can_start_public_beta, false);
  assert.strictEqual(out.beta_admission_review.can_sell, false);
});

// ---------------------------------------------------------------------------
// Teste 2 — micro-test ativo mas sample < 100
// ---------------------------------------------------------------------------
console.log('\nTeste 2 — micro-test ativo mas sample abaixo de 100');

test('contract.status=collecting when sample < 100', () => {
  const out = evaluateBetaAdmission({
    micro_test_active: true,
    micro_test_report: { status: 'active', sample_size: 30 },
    micro_test_policy: {
      quality_score: 60,
      quality_grade: 'promising',
      decision_state: 'promising_but_early',
      guardrails: { blockers: [], warnings: [] },
    },
    candidate_segments: [{ segment: 'football', dimension: 'sport' }],
    risk_segments: [],
    controlled_expansion_review: { status: 'collecting' },
    beta_hold_review: { status: 'hold' },
    can_sell: false,
  });
  assert.strictEqual(out.beta_admission_contract.status, 'collecting');
  const minReq = out.beta_admission_contract.requirements.find(r => r.code === 'minimum_decision_sample');
  assert.ok(minReq && !minReq.passed, 'minimum_decision_sample should fail');
  assert.strictEqual(out.beta_admission_contract.eligible_for_manual_review, false);
});

// ---------------------------------------------------------------------------
// Teste 3 — sample=100 mas quality_score baixo
// ---------------------------------------------------------------------------
console.log('\nTeste 3 — sample=100 mas quality_score baixo');

test('quality_score_floor fails when score=45', () => {
  const out = evaluateBetaAdmission({
    micro_test_active: true,
    micro_test_report: { status: 'active', sample_size: 100 },
    micro_test_policy: {
      quality_score:  45,
      quality_grade:  'watch',
      decision_state: 'quality_watch',
      guardrails:     { blockers: [], warnings: [] },
    },
    candidate_segments: [{ segment: 'football', dimension: 'sport' }],
    risk_segments: [],
    controlled_expansion_review: { status: 'candidate_segments_found' },
    beta_hold_review: { status: 'hold' },
    can_sell: false,
  });
  const qReq = out.beta_admission_contract.requirements.find(r => r.code === 'quality_score_floor');
  assert.ok(qReq && !qReq.passed, 'quality_score_floor should fail');
  assert.strictEqual(out.beta_admission_contract.eligible_for_manual_review, false);
});

// ---------------------------------------------------------------------------
// Teste 4 — sample=100, quality bom, sem candidate_segments
// ---------------------------------------------------------------------------
console.log('\nTeste 4 — sem candidate_segments');

test('candidate_segments_present fails when empty', () => {
  const out = evaluateBetaAdmission({
    micro_test_active: true,
    micro_test_report: { status: 'active', sample_size: 100 },
    micro_test_policy: {
      quality_score:  70,
      quality_grade:  'promising',
      decision_state: 'decision_ready_hold',
      guardrails:     { blockers: [], warnings: [] },
    },
    candidate_segments: [],
    risk_segments: [],
    controlled_expansion_review: { status: 'review_ready' },
    beta_hold_review: { status: 'hold' },
    can_sell: false,
  });
  const req = out.beta_admission_contract.requirements.find(r => r.code === 'candidate_segments_present');
  assert.ok(req && !req.passed, 'candidate_segments_present should fail');
  assert.strictEqual(out.beta_admission_contract.eligible_for_manual_review, false);
});

// ---------------------------------------------------------------------------
// Teste 5 — risk_segments acima do limite
// ---------------------------------------------------------------------------
console.log('\nTeste 5 — risk_segments acima do limite');

test('risk_segments_below_limit fails when length=3, max=2', () => {
  const input = makeGoodInput({
    risk_segments: [
      { segment: 'a', dimension: 'sport' },
      { segment: 'b', dimension: 'sport' },
      { segment: 'c', dimension: 'sport' },
    ],
  });
  const out = evaluateBetaAdmission(input);
  const req = out.beta_admission_contract.requirements.find(r => r.code === 'risk_segments_below_limit');
  assert.ok(req && !req.passed, 'risk_segments_below_limit should fail');
  assert.strictEqual(out.beta_admission_contract.eligible_for_manual_review, false);
});

// ---------------------------------------------------------------------------
// Teste 6 — policy blockers presentes
// ---------------------------------------------------------------------------
console.log('\nTeste 6 — policy blockers presentes');

test('no_policy_blockers fails when guardrails has blockers', () => {
  const input = makeGoodInput({
    micro_test_policy: {
      quality_score:  75,
      quality_grade:  'strong',
      decision_state: 'decision_ready_hold',
      guardrails:     { blockers: ['minimum_decision_sample'], warnings: [] },
    },
  });
  const out = evaluateBetaAdmission(input);
  const req = out.beta_admission_contract.requirements.find(r => r.code === 'no_policy_blockers');
  assert.ok(req && !req.passed, 'no_policy_blockers should fail');
  assert.ok(out.beta_admission_contract.blockers.includes('no_policy_blockers'));
});

// ---------------------------------------------------------------------------
// Teste 7 — requisitos passam, sem aprovação manual
// ---------------------------------------------------------------------------
console.log('\nTeste 7 — requisitos passam, sem aprovação manual');

test('eligible_for_manual_review when all tech requirements pass, approval=false', () => {
  const out = evaluateBetaAdmission(makeGoodInput(), makeGoodOptions({ beta_manual_approval: false }));
  assert.strictEqual(out.beta_admission_contract.status, 'eligible_for_manual_review');
  assert.strictEqual(out.beta_admission_contract.eligible_for_manual_review, true);
  assert.strictEqual(out.manual_approval_gate.approved, false);
  assert.ok(['not_started', 'blocked'].includes(out.private_cohort_simulation.status));
  assert.strictEqual(out.beta_admission_review.can_start_private_beta, false);
});

// ---------------------------------------------------------------------------
// Teste 8 — requisitos passam, aprovação manual true
// ---------------------------------------------------------------------------
console.log('\nTeste 8 — requisitos passam, aprovação manual true');

test('simulation_ready when requirements pass and approval=true, sim disabled', () => {
  const out = evaluateBetaAdmission(
    makeGoodInput(),
    makeGoodOptions({ beta_manual_approval: true, private_cohort_simulation_enabled: false }),
  );
  assert.strictEqual(out.manual_approval_gate.approved, true);
  assert.strictEqual(out.beta_admission_contract.status, 'simulation_ready');
  assert.ok(['not_started', 'ready', 'blocked'].includes(out.private_cohort_simulation.status));
  assert.strictEqual(out.beta_admission_review.can_start_private_beta, false);
});

// ---------------------------------------------------------------------------
// Teste 9 — simulação habilitada
// ---------------------------------------------------------------------------
console.log('\nTeste 9 — simulação habilitada');

test('simulation active when approval=true and sim enabled', () => {
  const out = evaluateBetaAdmission(
    makeGoodInput(),
    makeGoodOptions({ beta_manual_approval: true, private_cohort_simulation_enabled: true }),
  );
  assert.strictEqual(out.beta_admission_contract.status, 'simulation_active');
  assert.ok(['active', 'ready'].includes(out.private_cohort_simulation.status));
  assert.strictEqual(out.private_cohort_simulation.simulation_only, true);
  assert.strictEqual(out.private_cohort_simulation.simulated_delivery.real_users, false);
  assert.strictEqual(out.beta_admission_review.can_start_private_beta, false);
});

// ---------------------------------------------------------------------------
// Teste 10 — can_sell=true é erro crítico
// ---------------------------------------------------------------------------
console.log('\nTeste 10 — can_sell=true é erro crítico');

test('sell_blocked fails when can_sell=true and is a blocker', () => {
  const out = evaluateBetaAdmission({ can_sell: true, micro_test_active: false });
  const req = out.beta_admission_contract.requirements.find(r => r.code === 'sell_blocked');
  assert.ok(req && !req.passed, 'sell_blocked should fail');
  assert.strictEqual(req.severity, 'blocker');
  assert.ok(out.beta_admission_contract.blockers.includes('sell_blocked'));
  assert.strictEqual(out.beta_admission_review.can_sell, false);  // review always false
});

// ---------------------------------------------------------------------------
// Teste 11 — manual approval gate default false
// ---------------------------------------------------------------------------
console.log('\nTeste 11 — manual approval gate default false');

test('manual_approval_gate defaults to not approved', () => {
  const gate = evaluateManualApprovalGate({}, {});
  assert.strictEqual(gate.required, true);
  assert.strictEqual(gate.approved, false);
  assert.strictEqual(gate.status, 'approval_missing');
});

// ---------------------------------------------------------------------------
// Teste 12 — manual approval true por options/env
// ---------------------------------------------------------------------------
console.log('\nTeste 12 — manual approval true via options');

test('manual_approval_gate approved=true when option set', () => {
  const gate = evaluateManualApprovalGate({}, { beta_manual_approval: true });
  assert.strictEqual(gate.approved, true);
  assert.strictEqual(gate.status, 'approved');
});

// ---------------------------------------------------------------------------
// Teste 13 — private cohort defaults when disabled
// ---------------------------------------------------------------------------
console.log('\nTeste 13 — private cohort defaults');

test('private cohort simulation defaults when disabled', () => {
  const sim = buildPrivateCohortSimulation({}, {});
  assert.strictEqual(sim.cohort_size, 0);
  assert.strictEqual(sim.max_daily_picks, 0);
  assert.strictEqual(sim.enabled, false);
  assert.strictEqual(sim.simulation_only, true);
  assert.strictEqual(sim.simulated_delivery.real_users, false);
});

// ---------------------------------------------------------------------------
// Teste 14 — private cohort limits applied
// ---------------------------------------------------------------------------
console.log('\nTeste 14 — private cohort limits');

test('cohort limits applied when simulation active', () => {
  const input = makeGoodInput();
  const options = makeGoodOptions({
    beta_manual_approval: true,
    private_cohort_simulation_enabled: true,
    private_cohort_size: 10,
    private_cohort_max_daily_picks: 3,
    _contract_status: 'simulation_active',
  });
  const sim = buildPrivateCohortSimulation(input, options);
  assert.strictEqual(sim.cohort_size, 10);
  assert.strictEqual(sim.max_daily_picks, 3);
  assert.ok(sim.exposure_limits.max_picks_per_day > 0);
});

// ---------------------------------------------------------------------------
// Teste 15 — candidate segments → allowed_segments
// ---------------------------------------------------------------------------
console.log('\nTeste 15 — candidate segments → allowed_segments');

test('candidate segments become allowed_segments in simulation', () => {
  const input = makeGoodInput({
    candidate_segments: [
      { segment: 'football', dimension: 'sport', health_score: 80 },
      { segment: '1x2', dimension: 'market', health_score: 75 },
    ],
  });
  const options = makeGoodOptions({
    beta_manual_approval: true,
    private_cohort_simulation_enabled: true,
    _contract_status: 'simulation_active',
  });
  const sim = buildPrivateCohortSimulation(input, options);
  assert.ok(sim.enabled, 'simulation should be enabled');
  assert.ok(sim.allowed_segments.some(s => s.segment === 'football'));
  assert.ok(sim.allowed_segments.some(s => s.segment === '1x2'));
});

// ---------------------------------------------------------------------------
// Teste 16 — risk_segments → blocked_segments
// ---------------------------------------------------------------------------
console.log('\nTeste 16 — risk_segments → blocked_segments');

test('risk segments become blocked_segments in simulation', () => {
  const input = makeGoodInput({
    candidate_segments: [{ segment: 'football', dimension: 'sport', health_score: 80 }],
    risk_segments: [{ segment: 'props', dimension: 'market', risk_level: 'high' }],
  });
  const options = makeGoodOptions({
    beta_manual_approval: true,
    private_cohort_simulation_enabled: true,
    _contract_status: 'simulation_active',
  });
  const sim = buildPrivateCohortSimulation(input, options);
  assert.ok(sim.blocked_segments.some(s => s.segment === 'props'));
});

// ---------------------------------------------------------------------------
// Teste 17 — summary antes do micro-test
// ---------------------------------------------------------------------------
console.log('\nTeste 17 — summary antes do micro-test');

test('summary headline contains bloqueado when blocked', () => {
  const out = evaluateBetaAdmission({
    micro_test_active: false,
    can_sell: false,
  });
  const summary = out.beta_admission_summary;
  assert.ok(summary.headline.toLowerCase().includes('bloqueado'), `unexpected headline: ${summary.headline}`);
  assert.strictEqual(summary.safe_to_invite_private_users, false);
  assert.strictEqual(summary.safe_to_open_public_beta, false);
  assert.strictEqual(summary.safe_to_sell, false);
});

// ---------------------------------------------------------------------------
// Teste 18 — summary elegível para revisão
// ---------------------------------------------------------------------------
console.log('\nTeste 18 — summary elegível para revisão manual');

test('summary headline contains revisão manual when eligible', () => {
  const out = evaluateBetaAdmission(makeGoodInput(), makeGoodOptions());
  const summary = out.beta_admission_summary;
  assert.ok(
    summary.headline.toLowerCase().includes('revis') || summary.headline.toLowerCase().includes('elegível'),
    `unexpected headline: ${summary.headline}`,
  );
  assert.ok(
    summary.operator_instruction.toLowerCase().includes('não') ||
    summary.operator_instruction.toLowerCase().includes('nao') ||
    summary.operator_instruction.toLowerCase().includes('not'),
    `operator_instruction should prohibit real users: ${summary.operator_instruction}`,
  );
  assert.strictEqual(summary.safe_to_invite_private_users, false);
  assert.strictEqual(summary.safe_to_open_public_beta, false);
  assert.strictEqual(summary.safe_to_sell, false);
});

// ---------------------------------------------------------------------------
// Teste 19 — output serializável
// ---------------------------------------------------------------------------
console.log('\nTeste 19 — output serializável');

test('evaluateBetaAdmission output is JSON serializable', () => {
  const out = evaluateBetaAdmission(makeGoodInput(), makeGoodOptions());
  assert.doesNotThrow(() => JSON.stringify(out));
});

test('serializable with simulation active', () => {
  const out = evaluateBetaAdmission(
    makeGoodInput(),
    makeGoodOptions({ beta_manual_approval: true, private_cohort_simulation_enabled: true }),
  );
  assert.doesNotThrow(() => JSON.stringify(out));
});

// ---------------------------------------------------------------------------
// Teste 20 — campos ausentes não quebram
// ---------------------------------------------------------------------------
console.log('\nTeste 20 — campos ausentes não quebram');

test('empty input → blocked without exception', () => {
  assert.doesNotThrow(() => {
    const out = evaluateBetaAdmission({});
    assert.strictEqual(out.beta_admission_contract.status, 'blocked');
    assert.strictEqual(out.beta_admission_review.can_start_private_beta, false);
    assert.strictEqual(out.beta_admission_summary.safe_to_sell, false);
  });
});

test('null/undefined fields handled gracefully', () => {
  assert.doesNotThrow(() => {
    const out = evaluateBetaAdmission({
      micro_test_report: null,
      micro_test_policy: undefined,
      candidate_segments: null,
    });
    assert.strictEqual(out.beta_admission_contract.status, 'blocked');
  });
});

// ---------------------------------------------------------------------------
// Additional: evaluateAdmissionRequirements
// ---------------------------------------------------------------------------
console.log('\nevaluateAdmissionRequirements');

test('returns 12 requirements', () => {
  const reqs = evaluateAdmissionRequirements({}, {});
  assert.strictEqual(reqs.length, 12);
});

test('manual_approval_required always passes', () => {
  const reqs = evaluateAdmissionRequirements({ micro_test_active: false, can_sell: true }, {});
  const req = reqs.find(r => r.code === 'manual_approval_required');
  assert.ok(req, 'manual_approval_required should exist');
  assert.strictEqual(req.passed, true);
});

test('sell_blocked fails when can_sell=true', () => {
  const reqs = evaluateAdmissionRequirements({ can_sell: true }, {});
  const req = reqs.find(r => r.code === 'sell_blocked');
  assert.ok(!req.passed);
  assert.strictEqual(req.severity, 'blocker');
});

test('decision_state quality_watch → warning severity', () => {
  const reqs = evaluateAdmissionRequirements({
    micro_test_policy: {
      decision_state: 'quality_watch',
      guardrails: { blockers: [] },
    },
  }, {});
  const req = reqs.find(r => r.code === 'decision_state_allowed');
  assert.ok(!req.passed);
  assert.strictEqual(req.severity, 'warning');
});

// ---------------------------------------------------------------------------
// buildBetaAdmissionReview
// ---------------------------------------------------------------------------
console.log('\nbuildBetaAdmissionReview');

test('blocked contract → review status blocked', () => {
  const review = buildBetaAdmissionReview({
    contract: { status: 'blocked', warnings: [] },
    approvalGate: { approved: false, status: 'approval_missing' },
    cohortSimulation: { status: 'not_started', enabled: false },
  });
  assert.strictEqual(review.status, 'blocked');
  assert.strictEqual(review.can_start_private_beta, false);
  assert.strictEqual(review.can_sell, false);
});

test('eligible_for_manual_review → review pending_manual_approval', () => {
  const review = buildBetaAdmissionReview({
    contract: { status: 'eligible_for_manual_review', warnings: [] },
    approvalGate: { approved: false, status: 'approval_missing' },
    cohortSimulation: { status: 'not_started', enabled: false },
  });
  assert.strictEqual(review.status, 'pending_manual_approval');
  assert.strictEqual(review.can_start_private_beta, false);
});

test('simulation_active → review simulation_active, eligible_for_private_sim=true', () => {
  const review = buildBetaAdmissionReview({
    contract: { status: 'simulation_active', warnings: [] },
    approvalGate: { approved: true, status: 'approved' },
    cohortSimulation: { status: 'active', enabled: true },
  });
  assert.strictEqual(review.status, 'simulation_active');
  assert.strictEqual(review.eligible_for_private_simulation, true);
  assert.strictEqual(review.can_start_private_beta, false);
});

// ---------------------------------------------------------------------------
// buildBetaAdmissionSummary
// ---------------------------------------------------------------------------
console.log('\nbuildBetaAdmissionSummary');

test('summary always has safety fields false', () => {
  const scenarios = ['blocked', 'collecting', 'eligible_for_manual_review', 'simulation_ready', 'simulation_active'];
  for (const s of scenarios) {
    const summary = buildBetaAdmissionSummary({ admission_contract_status: s });
    assert.strictEqual(summary.safe_to_invite_private_users, false, `safe_to_invite should be false for ${s}`);
    assert.strictEqual(summary.safe_to_open_public_beta, false, `safe_to_open should be false for ${s}`);
    assert.strictEqual(summary.safe_to_sell, false, `safe_to_sell should be false for ${s}`);
  }
});

// ---------------------------------------------------------------------------
// Safety regression — safety fields always false
// ---------------------------------------------------------------------------
console.log('\nSafety regression — never true');

const safetyScenarios = [
  ['not started', {}, {}],
  ['active eligible', makeGoodInput(), makeGoodOptions()],
  ['simulation_ready', makeGoodInput(), makeGoodOptions({ beta_manual_approval: true })],
  ['simulation_active', makeGoodInput(), makeGoodOptions({ beta_manual_approval: true, private_cohort_simulation_enabled: true })],
  ['can_sell=true injected', { can_sell: true }, {}],
];

for (const [label, input, opts] of safetyScenarios) {
  test(`safety invariants hold (${label})`, () => {
    const out = evaluateBetaAdmission(input, opts);
    assert.strictEqual(out.beta_admission_review.can_start_private_beta, false, `can_start_private_beta must be false (${label})`);
    assert.strictEqual(out.beta_admission_review.can_start_public_beta,  false, `can_start_public_beta must be false (${label})`);
    assert.strictEqual(out.beta_admission_review.can_sell,               false, `can_sell in review must be false (${label})`);
    assert.strictEqual(out.beta_admission_summary.safe_to_invite_private_users, false);
    assert.strictEqual(out.beta_admission_summary.safe_to_open_public_beta,     false);
    assert.strictEqual(out.beta_admission_summary.safe_to_sell,                 false);
    assert.strictEqual(out.private_cohort_simulation.simulated_delivery.real_users, false);
    assert.strictEqual(out.private_cohort_simulation.simulation_only, true);
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nBeta Admission: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
