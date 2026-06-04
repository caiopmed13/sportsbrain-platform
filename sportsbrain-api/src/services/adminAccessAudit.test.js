// src/services/adminAccessAudit.test.js
// P3.8.22 — Tests for Admin Access Audit & Risk Review

import assert from 'node:assert/strict';
import {
  buildAdminAccessAudit,
  buildAdminAccessRiskReview,
  buildAccessAuditSummary,
  evaluateAdminAccessAudit,
} from './adminAccessAudit.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// T1: admin_key_present=false → authorized=false, risks includes missing_admin_key
test('T1: admin_key_present=false → authorized=false, risks includes missing_admin_key', () => {
  const audit = buildAdminAccessAudit({ admin_key_present: false });
  assert.equal(audit.authorized, false);

  const risk = buildAdminAccessRiskReview({ admin_key_present: false });
  assert.ok(risk.risks.includes('missing_admin_key'), 'expected missing_admin_key in risks');
});

// T2: admin_key_present=true, admin_key_valid=false → authorized=false, risks includes invalid_admin_key
test('T2: admin_key_present=true, admin_key_valid=false → authorized=false, risks includes invalid_admin_key', () => {
  const audit = buildAdminAccessAudit({ admin_key_present: true, admin_key_valid: false });
  assert.equal(audit.authorized, false);

  const risk = buildAdminAccessRiskReview({ admin_key_present: true, admin_key_valid: false });
  assert.ok(risk.risks.includes('invalid_admin_key'), 'expected invalid_admin_key in risks');
});

// T3: sb_master_key_present=false → fail_closed=true, risks includes missing_server_master_key
test('T3: sb_master_key_present=false → fail_closed=true, risks includes missing_server_master_key', () => {
  const audit = buildAdminAccessAudit({ sb_master_key_present: false });
  assert.equal(audit.fail_closed, true);

  const risk = buildAdminAccessRiskReview({ sb_master_key_present: false });
  assert.ok(risk.risks.includes('missing_server_master_key'), 'expected missing_server_master_key in risks');
});

// T4: authorized=true, all keys present → authorized=true, status=recorded
test('T4: authorized=true, admin_key_present=true, admin_key_valid=true, sb_master_key_present=true → authorized=true, status=recorded', () => {
  const audit = buildAdminAccessAudit({
    authorized: true,
    admin_key_present: true,
    admin_key_valid: true,
    sb_master_key_present: true,
  });
  assert.equal(audit.authorized, true);
  assert.equal(audit.status, 'recorded');
});

// T5: blocked_format=true → risks includes blocked_format_requested
test('T5: blocked_format=true, selected_format=pdf → risks includes blocked_format_requested', () => {
  const risk = buildAdminAccessRiskReview({
    blocked_format: true,
    selected_format: 'pdf',
    sb_master_key_present: true,
    admin_key_present: true,
  });
  assert.ok(risk.risks.includes('blocked_format_requested'), 'expected blocked_format_requested in risks');
});

// T6: blocked_mode=true → risks includes blocked_mode_requested
test('T6: blocked_mode=true, selected_mode=download → risks includes blocked_mode_requested', () => {
  const risk = buildAdminAccessRiskReview({
    blocked_mode: true,
    selected_mode: 'download',
    sb_master_key_present: true,
    admin_key_present: true,
  });
  assert.ok(risk.risks.includes('blocked_mode_requested'), 'expected blocked_mode_requested in risks');
});

// T7: download_requested=true → risks includes download_requested
test('T7: download_requested=true → risks includes download_requested', () => {
  const risk = buildAdminAccessRiskReview({
    download_requested: true,
    sb_master_key_present: true,
    admin_key_present: true,
  });
  assert.ok(risk.risks.includes('download_requested'), 'expected download_requested in risks');
});

// T8: entries include required codes
test('T8: entries include codes: request_received, admin_key_checked, no_sell_enforced, download_disabled_confirmed', () => {
  const audit = buildAdminAccessAudit({});
  const codes = audit.entries.map(e => e.code);
  assert.ok(codes.includes('request_received'), 'missing request_received');
  assert.ok(codes.includes('admin_key_checked'), 'missing admin_key_checked');
  assert.ok(codes.includes('no_sell_enforced'), 'missing no_sell_enforced');
  assert.ok(codes.includes('download_disabled_confirmed'), 'missing download_disabled_confirmed');
});

// T9: access_audit_summary → safe_for_public_share=false, safe_to_sell=false
test('T9: access_audit_summary → safe_for_public_share=false, safe_to_sell=false', () => {
  const summary = buildAccessAuditSummary({});
  assert.equal(summary.safe_for_public_share, false);
  assert.equal(summary.safe_to_sell, false);

  const summaryAuthorized = buildAccessAuditSummary({ authorized: true });
  assert.equal(summaryAuthorized.safe_for_public_share, false);
  assert.equal(summaryAuthorized.safe_to_sell, false);
});

// T10: evaluateAdminAccessAudit({}) does not throw
test('T10: JSON.stringify(evaluateAdminAccessAudit({})) does not throw', () => {
  let result;
  assert.doesNotThrow(() => {
    result = evaluateAdminAccessAudit({});
    JSON.stringify(result);
  });
  assert.ok(result.admin_access_audit);
  assert.ok(result.admin_access_risk_review);
  assert.ok(result.access_audit_summary);
});

// Summary
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
