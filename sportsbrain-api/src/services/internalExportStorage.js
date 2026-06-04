// src/services/internalExportStorage.js
// P3.8.23 — Internal Export Storage Contract, Write Simulation & Retention Policy

export const STORAGE_VERSION = 'p3.8.23';

export const ALLOWED_FUTURE_STORAGE_TARGETS = ['internal_kv', 'internal_r2', 'internal_db'];

export const BLOCKED_NOW = [
  'public_bucket',
  'external_webhook',
  'email',
  'database_write',
  'physical_file',
];

export function normalizeStorageBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function buildInternalExportStorageContract(input = {}, options = {}) {
  const contract = {
    status: 'contract_ready',
    contract_version: 'p3.8.23',
    simulation_only: true,
    storage_enabled: false,
    storage_write_enabled: false,
    database_write_enabled: false,
    physical_file_created: false,
    future_storage_possible: true,
    allowed_future_storage_targets: [...ALLOWED_FUTURE_STORAGE_TARGETS],
    blocked_now: [...BLOCKED_NOW],
    requires_admin_key: true,
    requires_redaction_lock: true,
    requires_no_sell_enforcement: true,
    requires_release_freeze: true,
  };

  if (input.immutable_no_sell_enforcement?.status === 'critical_violation') {
    contract.status = 'critical_violation';
    return contract;
  }

  if (input.redaction_regression_lock?.passed === false) {
    contract.status = 'blocked';
    return contract;
  }

  const unsafeFlags = [];
  if (input.storage_write_enabled === true) unsafeFlags.push('storage_write_enabled');
  if (input.database_write_enabled === true) unsafeFlags.push('database_write_enabled');

  if (unsafeFlags.length > 0) {
    contract.status = 'ready_with_warnings';
    contract.unsafe_flags_sanitized = unsafeFlags;
  }

  return contract;
}

export function buildStorageWriteSimulation(input = {}, options = {}) {
  const simulation = {
    status: 'simulated',
    simulation_only: true,
    write_attempted: false,
    write_allowed_now: false,
    would_write_future: true,
    target: 'none',
    record_key_preview: 'simulated-report-p3.8.23',
    payload_bytes_estimate: 0,
    validation: {
      redaction_passed: true,
      no_sell_enforced: true,
      format_valid: true,
      freeze_enforced: true,
    },
    physical_file_created: false,
    database_write_enabled: false,
    warnings: [],
    blockers: [],
  };

  if (normalizeStorageBoolean(input.storage_write_enabled)) {
    simulation.write_attempted = true;
    simulation.write_allowed_now = false;
    simulation.blockers.push('storage_write_requested');
  }

  if (normalizeStorageBoolean(input.database_write_enabled)) {
    simulation.blockers.push('database_write_requested');
  }

  simulation.validation.redaction_passed =
    input.redaction_regression_lock?.passed !== false;

  simulation.validation.no_sell_enforced =
    input.immutable_no_sell_enforcement?.status !== 'critical_violation';

  simulation.validation.format_valid =
    input.export_format_validation?.valid !== false;

  const chars = input.internal_export_renderer?.chars ?? 0;
  simulation.payload_bytes_estimate = typeof chars === 'number' ? chars : 0;

  // Always hardcoded false
  simulation.physical_file_created = false;
  simulation.database_write_enabled = false;

  return simulation;
}

export function buildStorageRetentionPolicy(input = {}, options = {}) {
  return {
    status: 'defined',
    policy_version: 'p3.8.23',
    retention_enabled_now: false,
    future_retention_possible: true,
    default_retention_days: 30,
    max_retention_days: 90,
    delete_enabled_now: false,
    manual_purge_enabled_now: false,
    contains_personal_data: false,
    safe_to_store_future: true,
  };
}

export function buildStorageSafetyManifest(input = {}, options = {}) {
  const manifest = {
    status: 'safe',
    contains_secrets: false,
    contains_emails: false,
    contains_payment_data: false,
    contains_real_users: false,
    contains_real_delivery: false,
    contains_commercial_claims: false,
    can_beta: false,
    can_sell: false,
    storage_write_enabled: false,
  };

  if (input.commercial_claims_guard?.claims_detected === true) {
    manifest.contains_commercial_claims = true;
  }

  if (input.redaction_regression_lock?.passed === false) {
    manifest.contains_secrets = true;
  }

  if (manifest.contains_commercial_claims || manifest.contains_secrets) {
    manifest.status = 'warning';
  }

  // Always hardcoded false
  manifest.can_beta = false;
  manifest.can_sell = false;
  manifest.storage_write_enabled = false;

  return manifest;
}

export function evaluateInternalExportStorage(input = {}, options = {}) {
  return {
    internal_export_storage_contract: buildInternalExportStorageContract(input, options),
    storage_write_simulation: buildStorageWriteSimulation(input, options),
    storage_retention_policy: buildStorageRetentionPolicy(input, options),
    storage_safety_manifest: buildStorageSafetyManifest(input, options),
  };
}
