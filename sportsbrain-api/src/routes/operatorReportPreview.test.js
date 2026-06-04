// src/routes/operatorReportPreview.test.js
// P3.8.19–P3.8.30 — 49 tests for Operator Report Preview route

import assert from 'assert'
import {
  verifyAdminKeyAccess,
  parsePreviewMode,
  parseExportFormat,
  handleOperatorReportPreview,
} from './operatorReportPreview.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

function makeRequest(headers = {}, url = 'https://example.com/v1/admin/operator-report-preview') {
  return {
    headers: { get: (key) => headers[key] ?? null },
    url,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

await testAsync('T1: no key → 401, body does not leak internal_report_preview or redacted_operator_report', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.internal_report_preview,     'Must not leak internal_report_preview')
  assert.ok(!body.redacted_operator_report,    'Must not leak redacted_operator_report')
})

await testAsync('T2: valid key → 200, new P3.8.20 blocks present, can_beta=false, can_sell=false', async () => {
  const KEY = 'test-key-p3820'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_beta, false)
  assert.strictEqual(body.can_sell, false)
  // P3.8.20 blocks
  assert.ok(body.admin_preview_ux_contract,  'Missing admin_preview_ux_contract')
  assert.ok(body.redacted_operator_report,   'Missing redacted_operator_report')
  assert.ok(body.export_abuse_protection,    'Missing export_abuse_protection')
  assert.ok(body.admin_preview_health,       'Missing admin_preview_health')
  assert.ok(body.report_redaction_policy,    'Missing report_redaction_policy')
  assert.ok(body.internal_download_preflight,'Missing internal_download_preflight')
  // Safety invariants
  assert.strictEqual(body.redacted_operator_report.public_share_allowed,     false)
  assert.strictEqual(body.admin_preview_ux_contract.public_share_allowed,    false)
  assert.strictEqual(body.export_abuse_protection.public_export_blocked,     true)
  assert.strictEqual(body.internal_download_preflight.download_enabled_now,  false)
})

await testAsync('T3: mode=compact → 200, preview_mode=compact in response', async () => {
  const KEY = 'test-key-compact'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=compact')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.preview_mode, 'compact')
})

await testAsync('T4: mode=detailed → 200, preview_mode=detailed in response', async () => {
  const KEY = 'test-key-detailed'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=detailed')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.preview_mode, 'detailed')
})

await testAsync('T5: mode=download → 400, download.available=false, download_enabled_now=false', async () => {
  const KEY = 'test-key-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.strictEqual(body.admin_preview_modes?.download?.available, false)
  assert.strictEqual(body.can_beta, false)
  assert.strictEqual(body.can_sell, false)
})

await testAsync('T6: wrong key → 401, no preview leaked', async () => {
  const req = makeRequest({ 'X-Admin-Key': 'wrong-key' })
  const env = { SB_MASTER_KEY: 'correct-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.internal_report_preview,  'Must not leak internal_report_preview')
  assert.ok(!body.redacted_operator_report, 'Must not leak redacted_operator_report')
  assert.ok(!body.admin_preview_ux_contract,'Must not leak admin_preview_ux_contract')
})

// ── P3.8.21 tests ─────────────────────────────────────────────────────────────

await testAsync('T7: format=json → 200, rendered_export present, selected_format=json', async () => {
  const KEY = 'key-format-json'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,              true)
  assert.strictEqual(body.selected_format, 'json')
  assert.ok(body.rendered_export,          'Missing rendered_export')
  assert.strictEqual(body.rendered_export.content_type, 'application/json')
  assert.ok(body.redaction_regression_lock, 'Missing redaction_regression_lock')
  assert.ok(body.format_render_summary,     'Missing format_render_summary')
  assert.strictEqual(body.format_render_summary.download_enabled, false)
})

await testAsync('T8: format=txt → 200, selected_format=txt, rendered_export content_type=text/plain', async () => {
  const KEY = 'key-format-txt'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=txt')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.selected_format, 'txt')
  assert.ok(body.rendered_export,          'Missing rendered_export')
  assert.strictEqual(body.rendered_export.content_type, 'text/plain')
})

await testAsync('T9: format=md → 200, selected_format=md, rendered_export content_type=text/markdown', async () => {
  const KEY = 'key-format-md'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=md')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.selected_format, 'md')
  assert.ok(body.rendered_export,          'Missing rendered_export')
  assert.strictEqual(body.rendered_export.content_type, 'text/markdown')
})

await testAsync('T10: format=pdf → 400, FORMAT_NOT_ALLOWED, can_beta/can_sell=false', async () => {
  const KEY = 'key-format-pdf'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=pdf')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok,    false)
  assert.strictEqual(body.error, 'FORMAT_NOT_ALLOWED')
  assert.strictEqual(body.can_beta, false)
  assert.strictEqual(body.can_sell, false)
})

await testAsync('T11: valid key, no format → default json, admin_download_dry_run present with can_download_now=false', async () => {
  const KEY = 'key-no-format'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.admin_download_dry_run, 'Missing admin_download_dry_run')
  assert.strictEqual(body.admin_download_dry_run.can_download_now, false)
  assert.strictEqual(body.admin_download_dry_run.physical_file_created, false)
  assert.ok(body.download_response_contract, 'Missing download_response_contract')
  assert.strictEqual(body.download_response_contract.download_enabled_now, false)
})

await testAsync('T12: valid key → redaction_regression_lock status=locked (no leaks in clean render)', async () => {
  const KEY = 'key-regression-lock'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.redaction_regression_lock, 'Missing redaction_regression_lock')
  assert.strictEqual(body.redaction_regression_lock.passed, true)
  assert.strictEqual(body.redaction_regression_lock.status, 'locked')
})

// ── P3.8.22 tests ─────────────────────────────────────────────────────────────

await testAsync('T13: valid key → admin_export_archive_contract, versioned_report_history_simulation, admin_access_audit present, can_sell=false', async () => {
  const KEY = 'key-p3822-archive'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.admin_export_archive_contract,       'Missing admin_export_archive_contract')
  assert.ok(body.versioned_report_history_simulation, 'Missing versioned_report_history_simulation')
  assert.ok(body.admin_access_audit,                  'Missing admin_access_audit')
  assert.strictEqual(body.admin_export_archive_contract.archive_enabled,              false)
  assert.strictEqual(body.admin_export_archive_contract.archive_persistence_enabled,  false)
  assert.strictEqual(body.admin_export_archive_contract.archive_download_enabled,     false)
  assert.strictEqual(body.versioned_report_history_simulation.persistence_enabled,    false)
})

await testAsync('T14: no key → 401, no versioned_report_history_simulation, no rendered_export', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.versioned_report_history_simulation, 'Must not expose versioned_report_history_simulation')
  assert.ok(!body.rendered_export,                     'Must not expose rendered_export')
  assert.ok(!body.report_version_manifest,             'Must not expose report_version_manifest')
})

await testAsync('T15: format=pdf → 400, no archive created, no physical file', async () => {
  const KEY = 'key-p3822-pdf'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=pdf')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.versioned_report_history_simulation, 'Must not expose history on 400')
})

await testAsync('T16: format=json with valid key → admin_access_audit.authorized=true', async () => {
  const KEY = 'key-p3822-access'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.admin_access_audit,               'Missing admin_access_audit')
  assert.strictEqual(body.admin_access_audit.authorized, true)
  assert.strictEqual(body.admin_access_audit.status,     'recorded')
})

await testAsync('T17: valid key → archive_integrity_summary present, report_history_diff status=checked', async () => {
  const KEY = 'key-p3822-integrity'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.archive_integrity_summary, 'Missing archive_integrity_summary')
  assert.ok(body.report_history_diff,       'Missing report_history_diff')
  assert.strictEqual(body.report_history_diff.status, 'checked')
})

// ── P3.8.23 tests ─────────────────────────────────────────────────────────────

await testAsync('T18: valid key → storage contract, replay, freeze sentinel present; can_sell=false', async () => {
  const KEY = 'key-p3823-storage'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.internal_export_storage_contract, 'Missing internal_export_storage_contract')
  assert.ok(body.storage_write_simulation,         'Missing storage_write_simulation')
  assert.ok(body.storage_retention_policy,         'Missing storage_retention_policy')
  assert.ok(body.storage_safety_manifest,          'Missing storage_safety_manifest')
  assert.ok(body.admin_access_replay_simulation,   'Missing admin_access_replay_simulation')
  assert.ok(body.admin_access_pattern_review,      'Missing admin_access_pattern_review')
  assert.ok(body.release_freeze_policy,            'Missing release_freeze_policy')
  assert.ok(body.freeze_baseline,                  'Missing freeze_baseline')
  assert.ok(body.freeze_diff_report,               'Missing freeze_diff_report')
  assert.ok(body.release_freeze_sentinel,          'Missing release_freeze_sentinel')
  assert.ok(body.freeze_enforcement_summary,       'Missing freeze_enforcement_summary')
  assert.strictEqual(body.internal_export_storage_contract.storage_enabled,        false)
  assert.strictEqual(body.internal_export_storage_contract.storage_write_enabled,  false)
  assert.strictEqual(body.storage_write_simulation.write_allowed_now,              false)
  assert.strictEqual(body.storage_retention_policy.retention_enabled_now,          false)
  assert.strictEqual(body.storage_safety_manifest.can_sell,                        false)
})

await testAsync('T19: no key → 401, no admin_access_replay_simulation, no internal_export_storage_contract', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.admin_access_replay_simulation,  'Must not expose admin_access_replay_simulation')
  assert.ok(!body.internal_export_storage_contract,'Must not expose internal_export_storage_contract')
  assert.ok(!body.release_freeze_sentinel,         'Must not expose release_freeze_sentinel')
})

await testAsync('T20: format=json → release_freeze_sentinel status=frozen, freeze_enforcement_summary.can_sell=false', async () => {
  const KEY = 'key-p3823-freeze'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.release_freeze_sentinel,               'Missing release_freeze_sentinel')
  assert.strictEqual(body.release_freeze_sentinel.status,  'frozen')
  assert.strictEqual(body.release_freeze_sentinel.passed,  true)
  assert.ok(body.freeze_enforcement_summary,            'Missing freeze_enforcement_summary')
  assert.strictEqual(body.freeze_enforcement_summary.can_sell,          false)
  assert.strictEqual(body.freeze_enforcement_summary.release_allowed,   false)
  assert.strictEqual(body.freeze_enforcement_summary.download_enabled,  false)
})

await testAsync('T21: valid key → release_freeze_policy freeze_enabled=true, no_sell_preserved in replay patterns', async () => {
  const KEY = 'key-p3823-policy'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.release_freeze_policy,                         'Missing release_freeze_policy')
  assert.strictEqual(body.release_freeze_policy.freeze_enabled,          true)
  assert.strictEqual(body.release_freeze_policy.can_be_disabled_now,     false)
  assert.ok(body.admin_access_pattern_review,                   'Missing admin_access_pattern_review')
  assert.ok(body.admin_access_pattern_review.patterns.includes('no_sell_preserved'), 'no_sell_preserved pattern missing')
  assert.strictEqual(body.admin_access_pattern_review.can_sell, false)
})

// ── P3.8.24 tests ─────────────────────────────────────────────────────────────

await testAsync('T22: valid key → release_freeze_baseline_registry, controlled_unfreeze_design present; can_sell=false', async () => {
  const KEY = 'key-p3824-baseline'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.release_freeze_baseline_registry, 'Missing release_freeze_baseline_registry')
  assert.ok(body.baseline_comparison_report,       'Missing baseline_comparison_report')
  assert.ok(body.freeze_baseline_audit,            'Missing freeze_baseline_audit')
  assert.ok(body.freeze_registry_summary,          'Missing freeze_registry_summary')
  assert.ok(body.safety_invariant_snapshot,        'Missing safety_invariant_snapshot')
  assert.ok(body.safety_invariant_validation,      'Missing safety_invariant_validation')
  assert.ok(body.safety_invariant_summary,         'Missing safety_invariant_summary')
  assert.ok(body.controlled_unfreeze_design,       'Missing controlled_unfreeze_design')
  assert.ok(body.unfreeze_preconditions_matrix,    'Missing unfreeze_preconditions_matrix')
  assert.ok(body.unfreeze_risk_assessment,         'Missing unfreeze_risk_assessment')
  assert.ok(body.unfreeze_simulation_guard,        'Missing unfreeze_simulation_guard')
  assert.ok(body.controlled_unfreeze_summary,      'Missing controlled_unfreeze_summary')
  assert.strictEqual(body.release_freeze_baseline_registry.status,        'registered')
  assert.strictEqual(body.release_freeze_baseline_registry.baseline_locked, true)
  assert.strictEqual(body.release_freeze_baseline_registry.persistence_enabled, false)
  assert.strictEqual(body.controlled_unfreeze_design.unfreeze_enabled,     false)
  assert.strictEqual(body.controlled_unfreeze_design.controlled_unfreeze_active, false)
  assert.strictEqual(body.unfreeze_preconditions_matrix.all_met,           false)
  assert.strictEqual(body.unfreeze_risk_assessment.safe_to_unfreeze,       false)
})

await testAsync('T23: no key → 401, no safety_invariant_snapshot, no controlled_unfreeze_design', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.safety_invariant_snapshot,  'Must not expose safety_invariant_snapshot')
  assert.ok(!body.controlled_unfreeze_design, 'Must not expose controlled_unfreeze_design')
  assert.ok(!body.release_freeze_baseline_registry, 'Must not expose release_freeze_baseline_registry')
})

await testAsync('T24: format=json → baseline_comparison_report.status=matched, safety invariants all passed', async () => {
  const KEY = 'key-p3824-matched'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.baseline_comparison_report,           'Missing baseline_comparison_report')
  assert.strictEqual(body.baseline_comparison_report.status,   'matched')
  assert.strictEqual(body.baseline_comparison_report.matched,  true)
  assert.ok(body.safety_invariant_snapshot,            'Missing safety_invariant_snapshot')
  assert.strictEqual(body.safety_invariant_snapshot.all_passed, true)
  assert.strictEqual(body.safety_invariant_validation.passed,   true)
})

await testAsync('T25: mode=download → 400, no unfreeze_enabled, no controlled_unfreeze_active', async () => {
  const KEY = 'key-p3824-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.controlled_unfreeze_design, 'No controlled_unfreeze_design on 400')
})

// ── P3.8.25 tests ─────────────────────────────────────────────────────────────

await testAsync('T26: valid key → capability_unlock_matrix, pre_beta_governance_gate present; can_sell=false', async () => {
  const KEY = 'key-p3825-matrix'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.capability_unlock_matrix,         'Missing capability_unlock_matrix')
  assert.ok(body.capability_risk_profile,          'Missing capability_risk_profile')
  assert.ok(body.capability_unlock_summary,        'Missing capability_unlock_summary')
  assert.ok(body.controlled_unfreeze_simulation,   'Missing controlled_unfreeze_simulation')
  assert.ok(body.capability_unlock_attempts,       'Missing capability_unlock_attempts')
  assert.ok(body.unlock_rollback_plan,             'Missing unlock_rollback_plan')
  assert.ok(body.unlock_simulation_audit,          'Missing unlock_simulation_audit')
  assert.ok(body.pre_beta_governance_gate,         'Missing pre_beta_governance_gate')
  assert.ok(body.pre_beta_blocker_matrix,          'Missing pre_beta_blocker_matrix')
  assert.ok(body.pre_beta_operator_review,         'Missing pre_beta_operator_review')
  assert.ok(body.final_pre_beta_summary,           'Missing final_pre_beta_summary')
  assert.strictEqual(body.capability_unlock_matrix.status,               'evaluated')
  assert.strictEqual(body.capability_unlock_matrix.unlockable_now_count, 0)
  assert.strictEqual(body.capability_unlock_summary.can_unlock_any_now,  false)
  assert.strictEqual(body.capability_unlock_summary.safe_to_sell,        false)
  assert.strictEqual(body.pre_beta_governance_gate.can_enter_private_beta, false)
  assert.strictEqual(body.pre_beta_governance_gate.can_sell,             false)
  assert.strictEqual(body.final_pre_beta_summary.status,                 'blocked')
  assert.ok(body.pre_beta_governance_gate.gate_score >= 0 && body.pre_beta_governance_gate.gate_score <= 100, 'gate_score must be 0-100')
})

await testAsync('T27: no key → 401, no capability_unlock_attempts, no pre_beta_operator_review', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.capability_unlock_attempts,  'Must not expose capability_unlock_attempts')
  assert.ok(!body.pre_beta_operator_review,    'Must not expose pre_beta_operator_review')
  assert.ok(!body.capability_unlock_matrix,    'Must not expose capability_unlock_matrix')
  assert.ok(!body.pre_beta_governance_gate,    'Must not expose pre_beta_governance_gate')
})

await testAsync('T28: format=json → controlled_unfreeze_simulation.successful_unlocks_count=0, unfreeze_applied=false', async () => {
  const KEY = 'key-p3825-simulation'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.controlled_unfreeze_simulation,          'Missing controlled_unfreeze_simulation')
  assert.strictEqual(body.controlled_unfreeze_simulation.successful_unlocks_count, 0)
  assert.strictEqual(body.controlled_unfreeze_simulation.unfreeze_applied,         false)
  assert.strictEqual(body.controlled_unfreeze_simulation.status,                   'simulated')
  assert.ok(Array.isArray(body.capability_unlock_attempts), 'capability_unlock_attempts must be array')
  assert.ok(body.capability_unlock_attempts.every(a => a.applied === false), 'No attempt should have applied=true')
})

await testAsync('T29: mode=download → 400, no capability_unlock_matrix, no pre_beta_governance_gate', async () => {
  const KEY = 'key-p3825-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.capability_unlock_matrix,  'No capability_unlock_matrix on 400')
  assert.ok(!body.pre_beta_governance_gate,  'No pre_beta_governance_gate on 400')
})

// ── P3.8.26 tests ─────────────────────────────────────────────────────────────

await testAsync('T30: valid key → pre_beta_readiness_council, private_beta_non_delivery_contract present; can_sell=false', async () => {
  const KEY = 'key-p3826-council'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.pre_beta_readiness_council,         'Missing pre_beta_readiness_council')
  assert.ok(body.readiness_council_votes,            'Missing readiness_council_votes')
  assert.ok(body.pre_beta_decision_record,           'Missing pre_beta_decision_record')
  assert.ok(body.pre_beta_council_summary,           'Missing pre_beta_council_summary')
  assert.ok(body.operator_signoff_simulation,        'Missing operator_signoff_simulation')
  assert.ok(body.signoff_effectiveness_policy,       'Missing signoff_effectiveness_policy')
  assert.ok(body.signoff_audit_trail,                'Missing signoff_audit_trail')
  assert.ok(body.signoff_summary,                    'Missing signoff_summary')
  assert.ok(body.private_beta_non_delivery_contract, 'Missing private_beta_non_delivery_contract')
  assert.ok(body.non_delivery_enforcement,           'Missing non_delivery_enforcement')
  assert.ok(body.non_delivery_checklist,             'Missing non_delivery_checklist')
  assert.ok(body.non_delivery_audit,                 'Missing non_delivery_audit')
  assert.ok(body.non_delivery_summary,               'Missing non_delivery_summary')
  assert.strictEqual(body.pre_beta_readiness_council.status,                     'convened')
  assert.strictEqual(body.pre_beta_readiness_council.can_approve_beta,            false)
  assert.strictEqual(body.pre_beta_readiness_council.can_approve_sell,            false)
  assert.strictEqual(body.operator_signoff_simulation.status,                     'disabled')
  assert.strictEqual(body.operator_signoff_simulation.operator_signoff_effective,  false)
  assert.strictEqual(body.signoff_effectiveness_policy.signoff_can_override,       false)
  assert.strictEqual(body.private_beta_non_delivery_contract.status,              'enforced')
  assert.strictEqual(body.private_beta_non_delivery_contract.private_beta_delivery_allowed, false)
  assert.strictEqual(body.private_beta_non_delivery_contract.real_users_allowed,  false)
  assert.strictEqual(body.pre_beta_decision_record.delivery_allowed,              false)
  assert.strictEqual(body.pre_beta_decision_record.persistence_enabled,           false)
  assert.strictEqual(body.non_delivery_summary.delivery_allowed,                  false)
  assert.strictEqual(body.pre_beta_council_summary.safe_to_invite_private_users,  false)
  assert.strictEqual(body.pre_beta_council_summary.safe_to_sell,                  false)
})

await testAsync('T31: no key → 401, no readiness_council_votes, no signoff_audit_trail, no non_delivery_checklist', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.readiness_council_votes,            'Must not expose readiness_council_votes')
  assert.ok(!body.signoff_audit_trail,                'Must not expose signoff_audit_trail')
  assert.ok(!body.non_delivery_checklist,             'Must not expose non_delivery_checklist')
  assert.ok(!body.pre_beta_readiness_council,         'Must not expose pre_beta_readiness_council')
  assert.ok(!body.private_beta_non_delivery_contract, 'Must not expose private_beta_non_delivery_contract')
})

await testAsync('T32: format=json → private_beta_non_delivery_contract.private_beta_delivery_allowed=false, non_delivery_enforcement.passed=true', async () => {
  const KEY = 'key-p3826-nondelivery'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.private_beta_non_delivery_contract,         'Missing private_beta_non_delivery_contract')
  assert.strictEqual(body.private_beta_non_delivery_contract.private_beta_delivery_allowed, false)
  assert.strictEqual(body.private_beta_non_delivery_contract.real_pick_delivery_allowed,    false)
  assert.strictEqual(body.non_delivery_enforcement.passed,   true)
  assert.strictEqual(body.non_delivery_enforcement.failed_count, 0)
  assert.ok(Array.isArray(body.readiness_council_votes),     'readiness_council_votes must be array')
  assert.ok(body.readiness_council_votes.length >= 13,       'Must have at least 13 council votes')
})

await testAsync('T33: mode=download → 400, no pre_beta_readiness_council, no private_beta_non_delivery_contract', async () => {
  const KEY = 'key-p3826-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.pre_beta_readiness_council,         'No pre_beta_readiness_council on 400')
  assert.ok(!body.private_beta_non_delivery_contract, 'No private_beta_non_delivery_contract on 400')
})

// ── P3.8.27 tests ─────────────────────────────────────────────────────────────

await testAsync('T34: valid key → non_user_cohort_contract, private_beta_invitation_simulation, delivery_kill_switch present; can_sell=false', async () => {
  const KEY = 'key-p3827-cohort'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.non_user_cohort_contract,           'Missing non_user_cohort_contract')
  assert.ok(body.non_user_cohort_members,            'Missing non_user_cohort_members')
  assert.ok(body.non_user_cohort_audit,              'Missing non_user_cohort_audit')
  assert.ok(body.non_user_cohort_summary,            'Missing non_user_cohort_summary')
  assert.ok(body.invitation_channel_policy,          'Missing invitation_channel_policy')
  assert.ok(body.private_beta_invitation_simulation, 'Missing private_beta_invitation_simulation')
  assert.ok(body.simulated_invitation_ledger,        'Missing simulated_invitation_ledger')
  assert.ok(body.invitation_simulation_audit,        'Missing invitation_simulation_audit')
  assert.ok(body.invitation_simulation_summary,      'Missing invitation_simulation_summary')
  assert.ok(body.delivery_kill_switch,               'Missing delivery_kill_switch')
  assert.ok(body.channel_kill_switch_matrix,         'Missing channel_kill_switch_matrix')
  assert.ok(body.delivery_kill_switch_audit,         'Missing delivery_kill_switch_audit')
  assert.ok(body.delivery_kill_switch_summary,       'Missing delivery_kill_switch_summary')
  assert.strictEqual(body.non_user_cohort_contract.status,                          'enforced')
  assert.strictEqual(body.non_user_cohort_contract.real_users_allowed,              false)
  assert.strictEqual(body.non_user_cohort_contract.can_be_converted_to_real_users_now, false)
  assert.strictEqual(body.invitation_channel_policy.status,                         'locked')
  assert.strictEqual(body.private_beta_invitation_simulation.real_invites_created,  false)
  assert.strictEqual(body.private_beta_invitation_simulation.users_created,         false)
  assert.strictEqual(body.private_beta_invitation_simulation.emails_sent,           false)
  assert.strictEqual(body.private_beta_invitation_simulation.webhooks_sent,         false)
  assert.strictEqual(body.delivery_kill_switch.global_delivery_disabled,            true)
  assert.strictEqual(body.delivery_kill_switch.can_be_disabled_now,                 false)
  assert.strictEqual(body.delivery_kill_switch_summary.delivery_allowed,            false)
  assert.strictEqual(body.delivery_kill_switch_summary.safe_to_invite_private_users, false)
  assert.strictEqual(body.delivery_kill_switch_summary.safe_to_sell,                false)
  assert.strictEqual(body.invitation_simulation_summary.delivery_allowed,           false)
  assert.strictEqual(body.non_user_cohort_summary.safe_for_real_invites,            false)
  assert.strictEqual(body.non_user_cohort_summary.safe_to_sell,                     false)
  assert.ok(body.non_user_cohort_members,                                        'non_user_cohort_members must be present')
  assert.ok(Array.isArray(body.non_user_cohort_members.members),                 'non_user_cohort_members.members must be array')
  assert.ok(body.non_user_cohort_members.members.every(m => m.email === null),   'All cohort members must have email=null')
  assert.ok(body.non_user_cohort_members.members.every(m => m.real_user === false), 'All cohort members must have real_user=false')
})

await testAsync('T35: no key → 401, no simulated_invitation_ledger, no non_user_cohort_members, no channel_kill_switch_matrix', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.simulated_invitation_ledger,        'Must not expose simulated_invitation_ledger')
  assert.ok(!body.non_user_cohort_members,            'Must not expose non_user_cohort_members')
  assert.ok(!body.channel_kill_switch_matrix,         'Must not expose channel_kill_switch_matrix')
  assert.ok(!body.non_user_cohort_contract,           'Must not expose non_user_cohort_contract')
  assert.ok(!body.private_beta_invitation_simulation, 'Must not expose private_beta_invitation_simulation')
  assert.ok(!body.delivery_kill_switch,               'Must not expose delivery_kill_switch')
})

await testAsync('T36: format=json → private_beta_invitation_simulation fields all false, delivery kill-switch armed', async () => {
  const KEY = 'key-p3827-invitation'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(body.private_beta_invitation_simulation,         'Missing private_beta_invitation_simulation')
  assert.strictEqual(body.private_beta_invitation_simulation.real_invites_created, false)
  assert.strictEqual(body.private_beta_invitation_simulation.users_created,        false)
  assert.strictEqual(body.private_beta_invitation_simulation.emails_sent,          false)
  assert.strictEqual(body.private_beta_invitation_simulation.webhooks_sent,        false)
  assert.ok(body.channel_kill_switch_matrix,                       'Missing channel_kill_switch_matrix')
  assert.ok(Array.isArray(body.channel_kill_switch_matrix.channels), 'channel_kill_switch_matrix.channels must be array')
  const emailCh = body.channel_kill_switch_matrix.channels.find(c => c.channel === 'email')
  const webhookCh = body.channel_kill_switch_matrix.channels.find(c => c.channel === 'webhook')
  assert.ok(emailCh,                                               'Missing email channel in matrix')
  assert.strictEqual(emailCh.allowed,   false,                     'email channel must be blocked')
  assert.ok(webhookCh,                                             'Missing webhook channel in matrix')
  assert.strictEqual(webhookCh.allowed, false,                     'webhook channel must be blocked')
  assert.strictEqual(body.delivery_kill_switch.global_delivery_disabled, true)
  assert.ok(Array.isArray(body.simulated_invitation_ledger.entries),     'simulated_invitation_ledger.entries must be array')
  assert.ok(body.simulated_invitation_ledger.entries.every(e => e.real_invite_created === false), 'All ledger entries must have real_invite_created=false')
  assert.ok(body.simulated_invitation_ledger.entries.every(e => e.delivery_allowed === false),    'All ledger entries must have delivery_allowed=false')
})

await testAsync('T37: mode=download → 400, no private_beta_invitation_simulation, no delivery_kill_switch', async () => {
  const KEY = 'key-p3827-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.private_beta_invitation_simulation, 'No private_beta_invitation_simulation on 400')
  assert.ok(!body.delivery_kill_switch,               'No delivery_kill_switch on 400')
  assert.ok(!body.non_user_cohort_contract,           'No non_user_cohort_contract on 400')
})

// ── P3.8.28 tests ─────────────────────────────────────────────────────────────

await testAsync('T38: valid key → synthetic_cohort_review, private_beta_dry_invite_report, delivery_incident_drill present; can_sell=false', async () => {
  const KEY = 'key-p3828-dry-invite'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.synthetic_cohort_review,          'Missing synthetic_cohort_review')
  assert.ok(body.synthetic_member_safety_matrix,   'Missing synthetic_member_safety_matrix')
  assert.ok(body.synthetic_cohort_findings,        'Missing synthetic_cohort_findings')
  assert.ok(body.synthetic_cohort_review_summary,  'Missing synthetic_cohort_review_summary')
  assert.ok(body.private_beta_dry_invite_report,   'Missing private_beta_dry_invite_report')
  assert.ok(body.dry_invite_evidence_packet,       'Missing dry_invite_evidence_packet')
  assert.ok(body.dry_invite_readiness_checklist,   'Missing dry_invite_readiness_checklist')
  assert.ok(body.dry_invite_operator_summary,      'Missing dry_invite_operator_summary')
  assert.ok(body.delivery_incident_scenarios,      'Missing delivery_incident_scenarios')
  assert.ok(body.delivery_incident_drill,          'Missing delivery_incident_drill')
  assert.ok(body.incident_response_plan,           'Missing incident_response_plan')
  assert.ok(body.kill_switch_drill_report,         'Missing kill_switch_drill_report')
  assert.ok(body.incident_drill_summary,           'Missing incident_drill_summary')
  assert.strictEqual(body.synthetic_cohort_review.status,                      'passed')
  assert.strictEqual(body.synthetic_cohort_review.passed,                      true)
  assert.strictEqual(body.synthetic_cohort_review_summary.safe_for_real_invite, false)
  assert.strictEqual(body.synthetic_cohort_review_summary.safe_to_sell,         false)
  assert.strictEqual(body.private_beta_dry_invite_report.status,               'generated')
  assert.strictEqual(body.private_beta_dry_invite_report.dry_invite_only,      true)
  assert.strictEqual(body.private_beta_dry_invite_report.real_invites_created, false)
  assert.strictEqual(body.private_beta_dry_invite_report.users_created,        false)
  assert.strictEqual(body.private_beta_dry_invite_report.emails_sent,          false)
  assert.strictEqual(body.private_beta_dry_invite_report.webhooks_sent,        false)
  assert.strictEqual(body.private_beta_dry_invite_report.delivery_allowed,     false)
  assert.strictEqual(body.dry_invite_evidence_packet.proofs.no_real_invites,   true)
  assert.strictEqual(body.dry_invite_evidence_packet.proofs.kill_switch_armed, true)
  assert.strictEqual(body.dry_invite_operator_summary.safe_for_real_invites,   false)
  assert.strictEqual(body.dry_invite_operator_summary.safe_to_sell,            false)
  assert.ok(['simulated', 'passed'].includes(body.delivery_incident_drill.status))
  assert.strictEqual(body.delivery_incident_drill.real_actions_taken,          false)
  assert.strictEqual(body.delivery_incident_drill.incident_real_action_taken,  false)
  assert.strictEqual(body.kill_switch_drill_report.all_channels_blocked,       true)
  assert.strictEqual(body.kill_switch_drill_report.delivery_allowed,           false)
  assert.strictEqual(body.incident_drill_summary.real_actions_taken,           false)
  assert.strictEqual(body.incident_drill_summary.safe_to_sell,                 false)
})

await testAsync('T39: no key → 401, no dry_invite_evidence_packet, no delivery_incident_scenarios, no synthetic_member_safety_matrix', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.dry_invite_evidence_packet,      'Must not expose dry_invite_evidence_packet')
  assert.ok(!body.delivery_incident_scenarios,     'Must not expose delivery_incident_scenarios')
  assert.ok(!body.synthetic_member_safety_matrix,  'Must not expose synthetic_member_safety_matrix')
  assert.ok(!body.private_beta_dry_invite_report,  'Must not expose private_beta_dry_invite_report')
  assert.ok(!body.delivery_incident_drill,         'Must not expose delivery_incident_drill')
  assert.ok(!body.synthetic_cohort_review,         'Must not expose synthetic_cohort_review')
})

await testAsync('T40: format=json → dry-invite no side effects, incident drill clean', async () => {
  const KEY = 'key-p3828-json'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.private_beta_dry_invite_report.real_invites_created, false)
  assert.strictEqual(body.private_beta_dry_invite_report.users_created,        false)
  assert.strictEqual(body.private_beta_dry_invite_report.emails_sent,          false)
  assert.strictEqual(body.private_beta_dry_invite_report.webhooks_sent,        false)
  assert.strictEqual(body.delivery_incident_drill.real_actions_taken,          false)
  assert.strictEqual(body.delivery_incident_drill.incident_real_action_taken,  false)
  assert.strictEqual(body.kill_switch_drill_report.failed_channels_count,      0)
  assert.strictEqual(body.incident_response_plan.automatic_actions_allowed_now,false)
  assert.strictEqual(body.incident_response_plan.external_notifications_allowed_now, false)
  const scenarioIds = body.delivery_incident_scenarios.scenarios.map(s => s.scenario_id)
  assert.ok(scenarioIds.includes('email_send_attempt'))
  assert.ok(scenarioIds.includes('real_invite_attempt'))
  assert.ok(body.delivery_incident_scenarios.scenarios.every(s => s.real_action_taken === false))
})

await testAsync('T41: mode=download → 400, no private_beta_dry_invite_report, no delivery_incident_drill', async () => {
  const KEY = 'key-p3828-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.private_beta_dry_invite_report, 'No private_beta_dry_invite_report on 400')
  assert.ok(!body.delivery_incident_drill,        'No delivery_incident_drill on 400')
  assert.ok(!body.synthetic_cohort_review,        'No synthetic_cohort_review on 400')
})

// ── P3.8.29 tests ─────────────────────────────────────────────────────────────

await testAsync('T42: valid key → beta_safety_incident_ledger, incident_recovery_simulation, operator_escalation_protocol present; all safety flags false', async () => {
  const KEY = 'key-p3829-ledger'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.beta_safety_incident_ledger,        'Missing beta_safety_incident_ledger')
  assert.ok(body.simulated_incident_records,         'Missing simulated_incident_records')
  assert.ok(body.incident_severity_matrix,           'Missing incident_severity_matrix')
  assert.ok(body.incident_ledger_summary,            'Missing incident_ledger_summary')
  assert.ok(body.incident_recovery_simulation,       'Missing incident_recovery_simulation')
  assert.ok(body.recovery_action_plan,               'Missing recovery_action_plan')
  assert.ok(body.recovery_verification_checklist,    'Missing recovery_verification_checklist')
  assert.ok(body.incident_response_summary,          'Missing incident_response_summary')
  assert.ok(body.operator_escalation_protocol,       'Missing operator_escalation_protocol')
  assert.ok(body.escalation_decision_matrix,         'Missing escalation_decision_matrix')
  assert.ok(body.internal_escalation_audit,          'Missing internal_escalation_audit')
  assert.ok(body.escalation_protocol_summary,        'Missing escalation_protocol_summary')
  assert.strictEqual(body.beta_safety_incident_ledger.real_actions_taken,               false)
  assert.strictEqual(body.beta_safety_incident_ledger.persistence_enabled,              false)
  assert.strictEqual(body.beta_safety_incident_ledger.external_notifications_sent,      false)
  assert.strictEqual(body.beta_safety_incident_ledger.delivery_allowed,                 false)
  assert.strictEqual(body.incident_recovery_simulation.recovery_real_action_taken,      false)
  assert.strictEqual(body.incident_recovery_simulation.automatic_recovery_executed,     false)
  assert.strictEqual(body.incident_response_summary.recovery_real_action_taken,         false)
  assert.strictEqual(body.incident_response_summary.safe_to_sell,                       false)
  assert.strictEqual(body.operator_escalation_protocol.external_escalation_allowed,     false)
  assert.strictEqual(body.operator_escalation_protocol.operator_notified_externally,    false)
  assert.strictEqual(body.operator_escalation_protocol.can_enable_beta,                 false)
  assert.strictEqual(body.operator_escalation_protocol.can_enable_sell,                 false)
  assert.strictEqual(body.escalation_protocol_summary.external_escalation_sent,         false)
  assert.strictEqual(body.escalation_protocol_summary.safe_to_sell,                     false)
})

await testAsync('T43: no key → 401, no simulated_incident_records, no recovery_action_plan, no internal_escalation_audit', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.simulated_incident_records,     'Must not expose simulated_incident_records')
  assert.ok(!body.recovery_action_plan,           'Must not expose recovery_action_plan')
  assert.ok(!body.internal_escalation_audit,      'Must not expose internal_escalation_audit')
  assert.ok(!body.beta_safety_incident_ledger,    'Must not expose beta_safety_incident_ledger')
  assert.ok(!body.incident_recovery_simulation,   'Must not expose incident_recovery_simulation')
  assert.ok(!body.operator_escalation_protocol,   'Must not expose operator_escalation_protocol')
})

await testAsync('T44: format=json → incident ledger records all contained, recovery checklist all passed, escalation all external=false', async () => {
  const KEY = 'key-p3829-json'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.ok(Array.isArray(body.simulated_incident_records), 'simulated_incident_records must be array')
  assert.ok(body.simulated_incident_records.every(r => r.real_action_taken === false), 'All incident records must have real_action_taken=false')
  assert.ok(body.simulated_incident_records.every(r => r.status === 'contained'),       'All incident records must have status=contained')
  assert.ok(Array.isArray(body.recovery_verification_checklist.items), 'recovery_verification_checklist.items must be array')
  assert.ok(body.recovery_verification_checklist.items.every(i => i.passed === true),           'All checklist items must be passed=true')
  assert.ok(Array.isArray(body.escalation_decision_matrix.decisions), 'escalation_decision_matrix.decisions must be array')
  assert.ok(body.escalation_decision_matrix.decisions.every(d => d.external_action === false),  'All escalation decisions must have external_action=false')
  assert.strictEqual(body.incident_ledger_summary.safe_to_invite_private_users, false)
  assert.strictEqual(body.incident_ledger_summary.safe_to_sell,                 false)
})

await testAsync('T45: mode=download → 400, no beta_safety_incident_ledger, no operator_escalation_protocol', async () => {
  const KEY = 'key-p3829-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.beta_safety_incident_ledger,  'No beta_safety_incident_ledger on 400')
  assert.ok(!body.operator_escalation_protocol, 'No operator_escalation_protocol on 400')
  assert.ok(!body.incident_recovery_simulation, 'No incident_recovery_simulation on 400')
})

// ── P3.8.30 tests ─────────────────────────────────────────────────────────────

await testAsync('T46: valid key → p38_governance_closure_packet, p39_transition_plan present; can_sell=false', async () => {
  const KEY = 'key-p3830-closure'
  const req = makeRequest({ 'X-Admin-Key': KEY })
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.ok,       true)
  assert.strictEqual(body.can_sell, false)
  assert.ok(body.p38_governance_closure_packet,   'Missing p38_governance_closure_packet')
  assert.ok(body.p38_completion_matrix,           'Missing p38_completion_matrix')
  assert.ok(body.p38_open_risks_register,         'Missing p38_open_risks_register')
  assert.ok(body.p38_closure_audit,               'Missing p38_closure_audit')
  assert.ok(body.p38_closure_summary,             'Missing p38_closure_summary')
  assert.ok(body.p38_safety_freeze_finalization,  'Missing p38_safety_freeze_finalization')
  assert.ok(body.final_safety_invariant_check,    'Missing final_safety_invariant_check')
  assert.ok(body.final_no_sell_no_delivery_check, 'Missing final_no_sell_no_delivery_check')
  assert.ok(body.p38_safety_finalization_summary, 'Missing p38_safety_finalization_summary')
  assert.ok(body.p39_transition_plan,             'Missing p39_transition_plan')
  assert.ok(body.p39_micro_test_activation_plan,  'Missing p39_micro_test_activation_plan')
  assert.ok(body.p39_quality_proof_requirements,  'Missing p39_quality_proof_requirements')
  assert.ok(body.p39_operator_checklist,          'Missing p39_operator_checklist')
  assert.ok(body.p38_to_p39_operator_summary,     'Missing p38_to_p39_operator_summary')
  assert.ok(['closed', 'closed_with_warnings'].includes(body.p38_governance_closure_packet.status), 'Unexpected closure status')
  assert.strictEqual(body.p38_governance_closure_packet.ready_for_p39_transition, true)
  assert.strictEqual(body.p38_governance_closure_packet.can_beta,                 false)
  assert.strictEqual(body.p38_governance_closure_packet.can_sell,                 false)
  assert.strictEqual(body.p38_safety_freeze_finalization.freeze_active,           true)
  assert.strictEqual(body.p38_safety_freeze_finalization.no_sell_active,          true)
  assert.strictEqual(body.p38_safety_freeze_finalization.can_beta,                false)
  assert.strictEqual(body.p38_safety_freeze_finalization.can_sell,                false)
  assert.strictEqual(body.p39_transition_plan.status,                             'ready')
  assert.strictEqual(body.p39_transition_plan.target_phase,                       'P3.9')
  assert.strictEqual(body.p39_transition_plan.auto_activate_micro_test,           false)
  assert.strictEqual(body.p39_micro_test_activation_plan.manual_activation_only,  true)
  assert.strictEqual(body.p39_micro_test_activation_plan.auto_activation_allowed, false)
  assert.strictEqual(body.p38_to_p39_operator_summary.can_beta,                   false)
  assert.strictEqual(body.p38_to_p39_operator_summary.can_sell,                   false)
})

await testAsync('T47: no key → 401, no p38_completion_matrix, no p38_closure_audit, no p39_operator_checklist', async () => {
  const req = makeRequest({})
  const env = { SB_MASTER_KEY: 'some-key' }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 401)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.p38_completion_matrix,          'Must not expose p38_completion_matrix on 401')
  assert.ok(!body.p38_closure_audit,              'Must not expose p38_closure_audit on 401')
  assert.ok(!body.p39_operator_checklist,         'Must not expose p39_operator_checklist on 401')
  assert.ok(!body.p38_governance_closure_packet,  'Must not expose p38_governance_closure_packet on 401')
  assert.ok(!body.p39_transition_plan,            'Must not expose p39_transition_plan on 401')
})

await testAsync('T48: format=json → safety freeze finalization can_beta=false, can_sell=false', async () => {
  const KEY = 'key-p3830-json'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?format=json')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 200)
  const body = await res.json()
  assert.strictEqual(body.p38_safety_freeze_finalization.can_beta,  false)
  assert.strictEqual(body.p38_safety_freeze_finalization.can_sell,  false)
  assert.strictEqual(body.final_safety_invariant_check.passed,      true)
  assert.strictEqual(body.final_safety_invariant_check.failed_count, 0)
  assert.strictEqual(body.final_no_sell_no_delivery_check.no_sell_confirmed,    true)
  assert.strictEqual(body.final_no_sell_no_delivery_check.no_delivery_confirmed, true)
  assert.strictEqual(body.p38_closure_summary.ready_for_p39,        true)
  assert.strictEqual(body.p38_closure_summary.safe_to_sell,         false)
})

await testAsync('T49: mode=download → 400, no p38_governance_closure_packet, no p39_transition_plan', async () => {
  const KEY = 'key-p3830-download'
  const req = makeRequest({ 'X-Admin-Key': KEY }, 'https://example.com/v1/admin/operator-report-preview?mode=download')
  const env = { SB_MASTER_KEY: KEY }
  const res = await handleOperatorReportPreview(req, env)
  assert.strictEqual(res.status, 400)
  const body = await res.json()
  assert.strictEqual(body.ok, false)
  assert.ok(!body.p38_governance_closure_packet, 'No p38_governance_closure_packet on 400')
  assert.ok(!body.p39_transition_plan,           'No p39_transition_plan on 400')
  assert.ok(!body.p38_safety_freeze_finalization,'No p38_safety_freeze_finalization on 400')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
