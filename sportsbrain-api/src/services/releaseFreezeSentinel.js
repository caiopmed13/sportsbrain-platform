// src/services/releaseFreezeSentinel.js
// P3.8.23 — Release Freeze Sentinel, Policy & Enforcement

export const SENTINEL_VERSION = 'p3.8.23';

export const FREEZE_BASELINE = Object.freeze({
  can_beta:                     false,
  can_sell:                     false,
  download_enabled:             false,
  archive_persistence_enabled:  false,
  storage_write_enabled:        false,
  release_allowed:              false,
  real_users:                   false,
  real_delivery:                false,
  checkout_enabled:             false,
  pricing_enabled:              false,
  webhook_enabled:              false,
  email_delivery_enabled:       false,
});

export const FROZEN_CAPABILITIES = Object.freeze([
  'beta',
  'sell',
  'download',
  'archive_persistence',
  'storage_write',
  'real_delivery',
  'public_export',
  'checkout',
  'pricing',
]);

function normalizeFreeze(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function buildReleaseFreezePolicy(input = {}, options = {}) {
  return {
    status:                          'active',
    policy_version:                  'p3.8.23',
    freeze_enabled:                  true,
    can_be_disabled_now:             false,
    requires_future_phase_to_unfreeze: true,
    required_future_phase:           'P3.8.24+',
    frozen_capabilities:             [...FROZEN_CAPABILITIES],
  };
}

export function buildFreezeBaseline(input = {}, options = {}) {
  return { ...FREEZE_BASELINE };
}

export function buildFreezeDiffReport(input = {}, options = {}) {
  const diffs    = [];
  const warnings = [];
  const blockers = [];

  for (const [flag, baselineValue] of Object.entries(FREEZE_BASELINE)) {
    if (baselineValue === false && normalizeFreeze(input[flag])) {
      diffs.push({ flag, baseline_value: false, current_value: true, critical: true });
    }
  }

  const diffs_count          = diffs.length;
  const critical_diffs_count = diffs.filter(d => d.critical).length;
  const status               = diffs_count > 0 ? 'drift_detected' : 'clean';

  if (diffs_count > 0) {
    blockers.push(`freeze_drift_detected: ${diffs_count}`);
  }

  return {
    status,
    diffs_count,
    critical_diffs_count,
    diffs,
    warnings,
    blockers,
  };
}

export function buildReleaseFreezeSentinel(input = {}, options = {}) {
  const checks = [
    { code: 'beta_frozen',                      passed: input.can_beta                    !== true },
    { code: 'sell_frozen',                      passed: input.can_sell                    !== true },
    { code: 'download_frozen',                  passed: input.download_enabled            !== true },
    { code: 'archive_persistence_frozen',       passed: input.archive_persistence_enabled !== true },
    { code: 'storage_write_frozen',             passed: input.storage_write_enabled       !== true },
    { code: 'release_frozen',                   passed: input.release_allowed             !== true },
    { code: 'real_users_frozen',                passed: input.real_users                  !== true },
    { code: 'real_delivery_frozen',             passed: input.real_delivery               !== true },
    { code: 'checkout_frozen',                  passed: input.checkout_enabled            !== true },
    { code: 'pricing_frozen',                   passed: input.pricing_enabled             !== true },
    { code: 'webhook_frozen',                   passed: input.webhook_enabled             !== true },
    { code: 'email_delivery_frozen',            passed: input.email_delivery_enabled      !== true },
    { code: 'claims_frozen',                    passed: input.commercial_claims_allowed   !== true },
    { code: 'governance_regression_passed',     passed: input.governance_regression_suite?.passed  !== false },
    { code: 'regression_lockdown_passed',       passed: input.regression_lockdown?.passed          !== false },
    { code: 'redaction_regression_lock_passed', passed: input.redaction_regression_lock?.passed    !== false },
  ].map(c => ({ ...c, severity: 'critical' }));

  const failedChecks     = checks.filter(c => !c.passed);
  const critical_failures = failedChecks.map(c => c.code);
  const passed           = failedChecks.length === 0;
  const status           = passed ? 'frozen' : 'freeze_violated';

  return {
    status,
    sentinel_version:         'p3.8.23',
    freeze_enabled:           true,
    passed,
    hard_fail_on_unfreeze_attempt: true,
    critical_failures,
    checks_count:             checks.length,
    failed_count:             failedChecks.length,
    checks,
  };
}

export function buildFreezeEnforcementSummary(input = {}, options = {}) {
  return {
    status:                'enforced',
    headline:              'Release freeze ativo.',
    summary_text:          'Beta, venda, download, storage e entrega real permanecem congelados.',
    release_allowed:       false,
    can_beta:              false,
    can_sell:              false,
    download_enabled:      false,
    storage_write_enabled: false,
    safe_to_sell:          false,
    next_action:           'Manter freeze até fase futura explícita.',
  };
}

export function evaluateReleaseFreezeSentinel(input = {}, options = {}) {
  return {
    release_freeze_policy:     buildReleaseFreezePolicy(input, options),
    freeze_baseline:           buildFreezeBaseline(input, options),
    freeze_diff_report:        buildFreezeDiffReport(input, options),
    release_freeze_sentinel:   buildReleaseFreezeSentinel(input, options),
    freeze_enforcement_summary: buildFreezeEnforcementSummary(input, options),
  };
}
