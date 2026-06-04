// src/services/snapshotSimulation.js
// P3.8.18 — Historical Snapshot Simulation & Snapshot Diff Report
// No persistence — purely runtime simulation

// ── Current Snapshot ──────────────────────────────────────────────────────────

export function buildCurrentDecisionSnapshot(input = {}, options = {}) {
  const fingerprint    = input.decision_fingerprint?.value ?? null
  const decision       = input.launch_no_launch_decision?.decision ?? 'continue_shadow'
  const grade          = input.decision_evidence_matrix?.overall_grade ?? 'blocked'
  const manualStatus   = input.manual_review_artifact?.status ?? 'blocked'
  const noLaunchStatus = input.no_launch_governance?.status   ?? 'locked'
  const hardLock       = input.no_launch_governance?.hard_lock_enabled ?? true

  return {
    snapshot_id:          'current',
    type:                 'current',
    captured_at:          new Date().toISOString(),
    fingerprint,
    decision,
    overall_grade:        grade,
    manual_review_status: manualStatus,
    no_launch_status:     noLaunchStatus,
    can_beta:             false,   // ALWAYS false
    can_sell:             false,   // ALWAYS false
    release_allowed:      false,
    hard_lock_enabled:    hardLock,
  }
}

// ── Synthetic Historical Snapshots ────────────────────────────────────────────

export function buildSyntheticHistoricalSnapshots(input = {}, options = {}) {
  return [
    {
      snapshot_id:          'previous_shadow_state',
      type:                 'synthetic_historical',
      synthetic:            true,
      scenario:             'previous_shadow_state',
      captured_at:          null,
      fingerprint:          null,   // fingerprint not yet computed in earlier state
      decision:             'continue_shadow',
      overall_grade:        'blocked',
      manual_review_status: 'blocked',
      no_launch_status:     'locked',
      can_beta:             false,
      can_sell:             false,
      release_allowed:      false,
      hard_lock_enabled:    true,
      note:                 'Synthetic: earlier shadow accumulation state (no fingerprint yet)',
    },
    {
      snapshot_id:          'unsafe_input_scenario',
      type:                 'synthetic_unsafe',
      synthetic:            true,
      scenario:             'unsafe_input_scenario',
      captured_at:          null,
      fingerprint:          'sb-unsafe-scenario-00000000',
      decision:             'launch',   // intentionally unsafe — flags critical diff
      overall_grade:        'blocked',
      manual_review_status: 'blocked',
      no_launch_status:     'locked',
      can_beta:             false,   // sanitized even in synthetic
      can_sell:             false,   // sanitized even in synthetic
      release_allowed:      false,
      hard_lock_enabled:    true,
      note:                 'Synthetic: unsafe decision=launch scenario — diff report flags as critical',
      original_unsafe_fields: ['decision'],
    },
    {
      snapshot_id:          'manual_review_ready_scenario',
      type:                 'synthetic_future',
      synthetic:            true,
      scenario:             'manual_review_ready_scenario',
      captured_at:          null,
      fingerprint:          'sb-manual-review-scenario-ffffffff',
      decision:             'ready_for_manual_review',
      overall_grade:        'review_candidate',
      manual_review_status: 'ready_for_review',
      no_launch_status:     'locked',
      can_beta:             false,
      can_sell:             false,
      release_allowed:      false,
      hard_lock_enabled:    true,
      note:                 'Synthetic: future state when manual review is ready',
    },
  ]
}

// ── Snapshot Comparator ───────────────────────────────────────────────────────

const CRITICAL_DIFF_RULES = [
  { field: 'can_beta',         bad_value: true },
  { field: 'can_sell',         bad_value: true },
  { field: 'release_allowed',  bad_value: true },
  { field: 'real_delivery',    bad_value: true },
  { field: 'decision',         bad_value: 'launch' },
]

export function compareDecisionSnapshots(current = {}, other = {}, options = {}) {
  const diffs = []

  // Critical field comparisons
  for (const { field, bad_value } of CRITICAL_DIFF_RULES) {
    const curVal = current[field]
    const othVal = other[field]
    if (curVal !== othVal) {
      const isCritical = othVal === bad_value
      diffs.push({
        field,
        current_value: curVal,
        other_value:   othVal,
        critical:      isCritical,
        type:          isCritical ? 'critical_regression' : 'change',
      })
    }
  }

  // Fingerprint change (informational, not critical)
  const fingerprintChanged = current.fingerprint !== other.fingerprint
  if (fingerprintChanged && (current.fingerprint != null || other.fingerprint != null)) {
    diffs.push({
      field:         'fingerprint',
      current_value: current.fingerprint,
      other_value:   other.fingerprint,
      critical:      false,
      type:          'fingerprint_change',
    })
  }

  const criticalDiffs    = diffs.filter(d => d.critical)
  const decisionChanged  = current.decision      !== other.decision
  const gradeChanged     = current.overall_grade !== other.overall_grade
  const lockChanged      = current.hard_lock_enabled !== other.hard_lock_enabled

  return {
    diffs,
    critical_diffs_count: criticalDiffs.length,
    fingerprint_changed:  fingerprintChanged,
    decision_changed:     decisionChanged,
    grade_changed:        gradeChanged,
    lock_state_changed:   lockChanged,
  }
}

// ── Snapshot Diff Report ──────────────────────────────────────────────────────

export function buildSnapshotDiffReport(input = {}, options = {}) {
  const current    = input._current_snapshot
  const historicals = input._historical_snapshots ?? []

  if (!current || historicals.length === 0) {
    return {
      status:               'checked',
      diffs_count:          0,
      critical_diffs_count: 0,
      fingerprint_changed:  false,
      decision_changed:     false,
      grade_changed:        false,
      lock_state_changed:   false,
      diffs:                [],
      warnings:             [],
      blockers:             [],
    }
  }

  const allDiffs          = []
  let totalCritical       = 0
  let anyFingerprintChange = false
  let anyDecisionChange   = false
  let anyGradeChange      = false
  let anyLockChange       = false

  for (const hist of historicals) {
    const result = compareDecisionSnapshots(current, hist, options)
    for (const d of result.diffs) {
      allDiffs.push({ ...d, snapshot_id: hist.snapshot_id })
    }
    totalCritical        += result.critical_diffs_count
    if (result.fingerprint_changed) anyFingerprintChange = true
    if (result.decision_changed)    anyDecisionChange    = true
    if (result.grade_changed)       anyGradeChange       = true
    if (result.lock_state_changed)  anyLockChange        = true
  }

  const criticalBlockers = allDiffs
    .filter(d => d.critical)
    .map(d => `critical_regression:${d.field}:${d.snapshot_id ?? 'unknown'}`)

  const warnings = []
  if (anyFingerprintChange) warnings.push('fingerprint_changed_in_simulation')
  if (totalCritical > 0)    warnings.push('critical_diffs_detected_in_synthetic_scenarios')

  return {
    status:               'checked',
    diffs_count:          allDiffs.length,
    critical_diffs_count: totalCritical,
    fingerprint_changed:  anyFingerprintChange,
    decision_changed:     anyDecisionChange,
    grade_changed:        anyGradeChange,
    lock_state_changed:   anyLockChange,
    diffs:                allDiffs,
    warnings,
    blockers:             criticalBlockers,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateSnapshotSimulation(input = {}, options = {}) {
  const safeInput = input ?? {}

  // Sanitize
  const cleanInput = {
    ...safeInput,
    can_beta:        false,
    can_sell:        false,
    real_users:      false,
    real_delivery:   false,
    release_allowed: false,
  }

  const currentSnapshot    = buildCurrentDecisionSnapshot(cleanInput, options)
  const historicalSnapshots = buildSyntheticHistoricalSnapshots(cleanInput, options)

  const diffInput  = {
    ...cleanInput,
    _current_snapshot:    currentSnapshot,
    _historical_snapshots: historicalSnapshots,
  }
  const diffReport = buildSnapshotDiffReport(diffInput, options)

  return {
    historical_snapshot_simulation: {
      status:            'simulated',
      simulation_only:   true,
      persistence_enabled: false,   // ALWAYS false — no DB
      snapshots_count:   historicalSnapshots.length,
      snapshots:         historicalSnapshots,
      current_snapshot:  currentSnapshot,
    },
    snapshot_diff_report: diffReport,
  }
}
