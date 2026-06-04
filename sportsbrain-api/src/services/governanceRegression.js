// src/services/governanceRegression.js
// P3.8.17 — Governance Regression Suite

// ── Forbidden-truth collector ─────────────────────────────────────────────────

export function collectForbiddenTruths(input = {}, options = {}) {
  const fields = [
    'can_beta', 'can_sell', 'real_users', 'real_delivery',
    'release_allowed', 'launch_allowed',
    'export_allows_beta', 'export_allows_sell',
    'sell_allowed',
  ]
  const violations = []
  for (const field of fields) {
    if (input[field] === true || input[field] === 'true') {
      violations.push({ field, value: true })
    }
  }
  return violations
}

// ── No-launch invariant checks ────────────────────────────────────────────────

export function assertNoLaunchInvariants(input = {}, options = {}) {
  const checks = []

  function checkFalse(code, raw, severity = 'blocker') {
    const actual = raw === true || raw === 'true'
    checks.push({ code, passed: !actual, severity, expected: false, actual })
  }

  checkFalse('can_beta_false',                     input.can_beta)
  checkFalse('can_sell_false',                     input.can_sell)
  checkFalse('release_allowed_false',              input.release_allowed)
  checkFalse('launch_allowed_false',               input.launch_allowed)
  checkFalse('private_beta_allowed_false',         input.launch_governance?.private_beta_allowed)
  checkFalse('public_beta_allowed_false',          input.launch_governance?.public_beta_allowed)
  checkFalse('sell_allowed_false',                 input.launch_governance?.sell_allowed)
  checkFalse('real_users_false',                   input.real_users)
  checkFalse('real_delivery_false',                input.real_delivery)
  checkFalse('safe_to_invite_private_users_false', input.manual_review_summary?.safe_to_invite_private_users)
  checkFalse('safe_to_sell_false',                 input.manual_review_summary?.safe_to_sell)

  // Approval must never enable beta or sell
  const approvalCanBeta = input.approval_simulation?.can_enable_beta === true
  const approvalCanSell = input.approval_simulation?.can_enable_sell === true
  const rawCanBeta      = input.can_beta === true || input.can_beta === 'true'
  const rawCanSell      = input.can_sell === true || input.can_sell === 'true'

  checks.push({
    code:     'approval_does_not_enable_beta',
    passed:   !approvalCanBeta && !rawCanBeta,
    severity: 'blocker',
    expected: false,
    actual:   approvalCanBeta || rawCanBeta,
  })
  checks.push({
    code:     'approval_does_not_enable_sell',
    passed:   !approvalCanSell && !rawCanSell,
    severity: 'blocker',
    expected: false,
    actual:   approvalCanSell || rawCanSell,
  })

  // Decision must never be 'launch'
  const decision = input.launch_no_launch_decision?.decision
  checks.push({
    code:     'operator_decision_never_launch',
    passed:   decision !== 'launch',
    severity: 'blocker',
    expected: 'not_launch',
    actual:   decision ?? 'continue_shadow',
  })

  return checks
}

// ── Required governance-block checks ─────────────────────────────────────────

export function assertRequiredGovernanceBlocks(input = {}, options = {}) {
  const blockDefs = [
    { code: 'hard_locks_present',            check: () => Array.isArray(input.release_hard_locks) && input.release_hard_locks.length >= 8 },
    { code: 'no_launch_governance_present',  check: () => input.no_launch_governance != null },
    { code: 'manual_review_artifact_present',check: () => input.manual_review_artifact != null },
    { code: 'evidence_export_packet_present',check: () => input.evidence_export_packet != null },
  ]

  return blockDefs.map(({ code, check }) => {
    const passed = check()
    return { code, passed, severity: 'warning', expected: true, actual: passed }
  })
}

// ── Suite builder ─────────────────────────────────────────────────────────────

export function buildGovernanceRegressionSuite(input = {}, options = {}) {
  const invariantChecks = assertNoLaunchInvariants(input, options)
  const blockChecks     = assertRequiredGovernanceBlocks(input, options)
  const allChecks       = [...invariantChecks, ...blockChecks]

  const blockerFailed  = allChecks.filter(c => !c.passed && c.severity === 'blocker')
  const warningFailed  = allChecks.filter(c => !c.passed && c.severity === 'warning')
  const passedChecks   = allChecks.filter(c => c.passed)

  const passed = blockerFailed.length === 0
  const status = passed ? 'passed' : 'failed'

  return {
    status,
    passed,
    checks_count:      allChecks.length,
    passed_count:      passedChecks.length,
    failed_count:      blockerFailed.length,  // only blocker failures
    checks:            allChecks,
    critical_failures: blockerFailed.map(c => ({
      code:     c.code,
      severity: c.severity,
      actual:   c.actual,
      expected: c.expected,
    })),
    warnings: warningFailed.map(c => ({
      code:   c.code,
      detail: `${c.code} missing or not meeting requirements`,
    })),
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateGovernanceRegression(input = {}, options = {}) {
  const suite = buildGovernanceRegressionSuite(input, options)
  return {
    governance_regression_suite: suite,
  }
}
