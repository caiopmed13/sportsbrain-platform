// src/services/adminAccessReplay.js
// P3.8.23 — Admin Access Replay Simulation & Pattern Review

export const REPLAY_VERSION = 'p3.8.23';

const FIXED_EVENTS = [
  { event_id: 'authorized_json_preview', type: 'admin_preview', authorized: true,  format: 'json', mode: 'compact',   blocked: false, risk: 'low',    download_enabled: false, can_sell: false },
  { event_id: 'authorized_txt_preview',  type: 'admin_preview', authorized: true,  format: 'txt',  mode: 'compact',   blocked: false, risk: 'low',    download_enabled: false, can_sell: false },
  { event_id: 'authorized_md_preview',   type: 'admin_preview', authorized: true,  format: 'md',   mode: 'compact',   blocked: false, risk: 'low',    download_enabled: false, can_sell: false },
  { event_id: 'denied_missing_key',      type: 'admin_preview', authorized: false, format: null,   mode: 'compact',   blocked: false, risk: 'medium', download_enabled: false, can_sell: false },
  { event_id: 'denied_invalid_key',      type: 'admin_preview', authorized: false, format: null,   mode: 'compact',   blocked: false, risk: 'medium', download_enabled: false, can_sell: false },
  { event_id: 'blocked_pdf_format',      type: 'admin_preview', authorized: true,  format: 'pdf',  mode: 'compact',   blocked: true,  risk: 'medium', download_enabled: false, can_sell: false },
  { event_id: 'blocked_download_mode',   type: 'admin_preview', authorized: true,  format: null,   mode: 'download',  blocked: true,  risk: 'medium', download_enabled: false, can_sell: false },
];

export function buildAdminAccessReplayEvents(input = {}, options = {}) {
  return FIXED_EVENTS.map(e => ({ ...e }));
}

export function analyzeAdminAccessPatterns(events = [], options = {}) {
  const authorized_count       = events.filter(e => e.authorized).length;
  const denied_count           = events.filter(e => !e.authorized).length;
  const blocked_format_count   = events.filter(e => e.blocked && e.event_id?.includes('format')).length;
  const blocked_mode_count     = events.filter(e => e.blocked && e.mode === 'download').length;
  const download_attempt_count = events.filter(e => e.mode === 'download').length;
  const public_attempt_count   = events.filter(e => e.mode === 'public').length;

  const patterns = [];
  if (denied_count >= 2)                                                       patterns.push('repeated_denied_access');
  if (blocked_format_count >= 1)                                               patterns.push('blocked_format_attempts');
  if (download_attempt_count >= 1)                                             patterns.push('download_mode_attempts');
  if (authorized_count > 0 && denied_count === 0 && blocked_format_count === 0) patterns.push('all_authorized_internal_only');
  patterns.push('no_sell_preserved');

  return {
    authorized_count,
    denied_count,
    blocked_format_count,
    blocked_mode_count,
    download_attempt_count,
    public_attempt_count,
    patterns,
  };
}

export function buildAdminAccessReplaySimulation(input = {}, options = {}) {
  const events   = buildAdminAccessReplayEvents(input, options);
  const analysis = analyzeAdminAccessPatterns(events, options);

  return {
    status: 'simulated',
    simulation_only: true,
    events_count: events.length,
    events,
    authorized_count:       analysis.authorized_count,
    denied_count:           analysis.denied_count,
    blocked_format_count:   analysis.blocked_format_count,
    blocked_mode_count:     analysis.blocked_mode_count,
    download_attempt_count: analysis.download_attempt_count,
    public_attempt_count:   analysis.public_attempt_count,
  };
}

export function buildAdminAccessPatternReview(input = {}, options = {}) {
  const events   = buildAdminAccessReplayEvents(input, options);
  const analysis = input._analysis ?? analyzeAdminAccessPatterns(events, options);

  const risks = [];
  if (analysis.denied_count >= 2)           risks.push('repeated_denied_access');
  if (analysis.blocked_format_count >= 1)   risks.push('blocked_format_attempts');
  if (analysis.download_attempt_count >= 1) risks.push('download_mode_attempts');

  const risk_level = risks.length >= 2 ? 'medium' : 'low';
  const status     = risks.length > 0  ? 'risks_detected' : 'protected';

  return {
    status,
    risk_level,
    patterns:        analysis.patterns ?? [],
    risks,
    warnings:        [],
    blockers:        [],
    recommendations: [],
    can_sell:        false,
  };
}

export function evaluateAdminAccessReplay(input = {}, options = {}) {
  const simulation    = buildAdminAccessReplaySimulation(input, options);
  const events        = simulation.events;
  const analysis      = analyzeAdminAccessPatterns(events, options);
  const reviewInput   = { ...input, _analysis: analysis };
  const pattern_review = buildAdminAccessPatternReview(reviewInput, options);

  return {
    admin_access_replay_simulation: simulation,
    admin_access_pattern_review:    pattern_review,
  };
}
