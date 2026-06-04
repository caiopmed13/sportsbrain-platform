// src/services/reportHistorySimulation.js
// P3.8.22 — Versioned Report History Simulation & Report History Diff

const HISTORY_VERSION = 'p3.8.22';
const CRITICAL_FLAGS = ['can_beta', 'can_sell', 'download_enabled', 'archive_persistence_enabled', 'physical_file_created'];
const CRITICAL_DECISIONS = ['launch', 'sell_approved', 'beta_approved'];

export function buildCurrentReportVersion(input = {}, options = {}) {
  return {
    version_id: 'current',
    type: 'current',
    fingerprint: input.decision_fingerprint?.value ?? `sb-p3.8.22-current`,
    decision: input.launch_no_launch_decision?.decision ?? 'continue_shadow',
    overall_grade: input.decision_evidence_matrix?.overall_grade ?? 'blocked',
    simulation_only: true,
    can_beta: false,
    can_sell: false,
    download_enabled: false,
    physical_file_created: false,
    archive_persistence_enabled: false,
  };
}

export function buildSimulatedReportHistory(input = {}, options = {}) {
  const currentVersion = buildCurrentReportVersion(input, options);

  const versions = [
    currentVersion,
    {
      version_id: 'previous_shadow',
      type: 'previous_shadow',
      fingerprint: `sb-p3.8.22-previous`,
      decision: 'continue_shadow',
      overall_grade: 'blocked',
      simulation_only: true,
      can_beta: false,
      can_sell: false,
      download_enabled: false,
      physical_file_created: false,
      archive_persistence_enabled: false,
    },
    {
      version_id: 'manual_review_ready_simulated',
      type: 'manual_review_ready_simulated',
      fingerprint: `sb-p3.8.22-manual-review`,
      decision: 'continue_shadow',
      overall_grade: 'blocked',
      simulation_only: true,
      can_beta: false,
      can_sell: false,
      download_enabled: false,
      physical_file_created: false,
      archive_persistence_enabled: false,
    },
    {
      version_id: 'unsafe_attempt_sanitized',
      type: 'unsafe_attempt_sanitized',
      fingerprint: `sb-p3.8.22-unsafe`,
      decision: 'continue_shadow',
      overall_grade: 'unsafe_sanitized',
      simulation_only: true,
      sanitized: true,
      original_decision: 'launch',
      can_beta: false,
      can_sell: false,
      download_enabled: false,
      physical_file_created: false,
      archive_persistence_enabled: false,
    },
    {
      version_id: 'redacted_preview',
      type: 'redacted_preview',
      fingerprint: `sb-p3.8.22-redacted`,
      decision: 'continue_shadow',
      overall_grade: 'blocked',
      simulation_only: true,
      redacted: true,
      can_beta: false,
      can_sell: false,
      download_enabled: false,
      physical_file_created: false,
      archive_persistence_enabled: false,
    },
  ];

  return {
    status: 'simulated',
    simulation_only: true,
    persistence_enabled: false,
    versions_count: 5,
    versions,
    current_version_id: 'current',
    warnings: [],
    blockers: [],
  };
}

export function compareReportVersions(current = {}, versions = [], options = {}) {
  const fingerprint_changes = [];
  const decision_changes = [];
  const safety_diffs = [];

  for (const v of versions) {
    if (v.version_id === 'current') continue;

    if (v.fingerprint !== current.fingerprint) {
      fingerprint_changes.push({ version_id: v.version_id, from: v.fingerprint, to: current.fingerprint });
    }

    if (v.decision !== current.decision) {
      decision_changes.push({
        version_id: v.version_id,
        from: v.decision,
        to: current.decision,
        critical: CRITICAL_DECISIONS.includes(v.decision) || CRITICAL_DECISIONS.includes(current.decision),
      });
    }

    for (const flag of CRITICAL_FLAGS) {
      if (v[flag] !== current[flag]) {
        safety_diffs.push({
          version_id: v.version_id,
          flag,
          from: v[flag],
          to: current[flag],
          critical: v[flag] === false && current[flag] === true,
        });
      }
    }
  }

  const critical_diffs = [
    ...decision_changes.filter(d => d.critical),
    ...safety_diffs.filter(d => d.critical),
  ];

  return {
    fingerprint_changes,
    decision_changes,
    safety_diffs,
    critical_diffs,
    critical_diffs_count: critical_diffs.length,
    diffs_count: fingerprint_changes.length + decision_changes.length + safety_diffs.length,
  };
}

export function buildReportHistoryDiff(input = {}, options = {}) {
  const currentVersion = input._current_version ?? buildCurrentReportVersion(input, options);
  const simulatedHistory = input._simulated_history ?? buildSimulatedReportHistory(input, options);

  const comparison = compareReportVersions(currentVersion, simulatedHistory.versions, options);

  const blockers = [];
  if (comparison.critical_diffs_count > 0) {
    blockers.push(`critical_diffs_detected: ${comparison.critical_diffs_count}`);
  }

  return {
    status: 'checked',
    diffs_count: comparison.diffs_count,
    critical_diffs_count: comparison.critical_diffs_count,
    fingerprint_changes: comparison.fingerprint_changes,
    decision_changes: comparison.decision_changes,
    safety_diffs: comparison.safety_diffs,
    warnings: [],
    blockers,
  };
}

export function evaluateReportHistorySimulation(input = {}, options = {}) {
  const currentVersion = buildCurrentReportVersion(input, options);
  const simulatedHistory = buildSimulatedReportHistory(input, options);
  const historyDiff = buildReportHistoryDiff(
    { ...input, _current_version: currentVersion, _simulated_history: simulatedHistory },
    options,
  );

  return {
    versioned_report_history_simulation: simulatedHistory,
    report_history_diff: historyDiff,
  };
}
