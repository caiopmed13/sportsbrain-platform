// src/services/adminAccessAudit.js
// P3.8.22 — Admin Access Audit & Risk Review

const AUDIT_VERSION = 'p3.8.22';

export function normalizeAccessStatus(value) {
  if (value === 'authorized') return 'authorized';
  if (value === 'denied') return 'denied';
  if (value === 'misconfigured') return 'misconfigured';
  return 'unknown';
}

export function buildAdminAccessAudit(input = {}, options = {}) {
  const authorized = input.authorized === true;
  const admin_key_present = input.admin_key_present === true;
  const sb_master_key_present = input.sb_master_key_present === true;
  const selectedFormat = input.selected_format ?? 'json';
  const selectedMode = input.selected_mode ?? 'compact';

  const fail_closed = !sb_master_key_present || !admin_key_present;

  const entries = [
    { code: 'request_received', level: 'info', message: 'Admin endpoint request received.' },
    { code: 'admin_key_checked', level: 'info', message: 'Admin key header checked.' },
    authorized
      ? { code: 'access_authorized_recorded', level: 'info', message: 'Admin access authorized.' }
      : { code: 'access_denied_recorded', level: 'warning', message: 'Admin access denied.' },
    { code: 'access_decision_recorded', level: 'info', message: 'Access decision recorded.' },
    { code: 'format_checked', level: 'info', message: `Export format checked: ${selectedFormat}.` },
    { code: 'mode_checked', level: 'info', message: `Preview mode checked: ${selectedMode}.` },
    { code: 'no_sell_enforced', level: 'info', message: 'No-sell enforcement verified.' },
    { code: 'download_disabled_confirmed', level: 'info', message: 'Download disabled confirmed.' },
  ];

  return {
    status: 'recorded',
    simulation_only: true,
    entries_count: 8,
    entries,
    authorized,
    denied: !authorized,
    fail_closed,
    selected_format: selectedFormat,
    selected_mode: selectedMode,
  };
}

export function buildAdminAccessRiskReview(input = {}, options = {}) {
  const authorized = input.authorized === true;
  const admin_key_present = input.admin_key_present === true;
  const admin_key_valid = input.admin_key_valid === true;
  const sb_master_key_present = input.sb_master_key_present === true;
  const blocked_format = input.blocked_format === true;
  const blocked_mode = input.blocked_mode === true;
  const download_requested = input.download_requested === true;
  const public_mode_requested = input.public_mode_requested === true;

  const risks = [];
  const blockers = [];

  if (!sb_master_key_present) {
    risks.push('missing_server_master_key');
    blockers.push('server_misconfigured');
  }
  if (!admin_key_present) {
    risks.push('missing_admin_key');
  }
  if (admin_key_present && !admin_key_valid) {
    risks.push('invalid_admin_key');
  }
  if (blocked_format) {
    risks.push('blocked_format_requested');
  }
  if (blocked_mode) {
    risks.push('blocked_mode_requested');
  }
  if (download_requested) {
    risks.push('download_requested');
  }
  if (public_mode_requested) {
    risks.push('public_mode_requested');
  }

  let risk_level = 'low';
  if (blockers.length > 0) {
    risk_level = 'critical';
  } else if (
    risks.includes('missing_admin_key') ||
    risks.includes('invalid_admin_key') ||
    risks.includes('download_requested')
  ) {
    risk_level = 'medium';
  }

  return {
    status: risks.length > 0 ? 'risks_detected' : 'protected',
    risk_level,
    risks,
    blockers,
    warnings: [],
    public_access_allowed: false,
    download_requested,
    blocked_format_requested: blocked_format,
    blocked_mode_requested: blocked_mode,
  };
}

export function buildAccessAuditSummary(input = {}, options = {}) {
  const authorized = input.authorized === true;
  const risk_level = input._risk_review?.risk_level ?? 'low';

  return {
    status: 'protected',
    headline: authorized ? 'Acesso admin autorizado.' : 'Acesso admin protegido.',
    authorized,
    preview_available: authorized ? true : false,
    risk_level,
    next_action: authorized
      ? 'Revisão interna autorizada. Não compartilhar externamente.'
      : 'Usar X-Admin-Key válido apenas para revisão interna.',
    safe_for_public_share: false,
    safe_to_sell: false,
  };
}

export function evaluateAdminAccessAudit(input = {}, options = {}) {
  const admin_access_audit = buildAdminAccessAudit(input, options);
  const admin_access_risk_review = buildAdminAccessRiskReview(input, options);
  const access_audit_summary = buildAccessAuditSummary(
    { ...input, _risk_review: admin_access_risk_review },
    options,
  );

  return {
    admin_access_audit,
    admin_access_risk_review,
    access_audit_summary,
  };
}
