// src/services/adminPreviewUx.js
// P3.8.20 — Admin Preview UX Contract, Modes, Cards, Health

const UX_VERSION = 'p3.8.20'

const CARD_DEFINITIONS = [
  { code: 'decision_status',      title: 'Decision Status',       severity: 'info' },
  { code: 'no_sell_lock',         title: 'No-Sell Lock',          severity: 'blocker' },
  { code: 'micro_test_status',    title: 'Micro Test Status',     severity: 'info' },
  { code: 'sandbox_status',       title: 'Sandbox Status',        severity: 'info' },
  { code: 'manual_review_status', title: 'Manual Review Status',  severity: 'info' },
  { code: 'export_integrity',     title: 'Export Integrity',      severity: 'info' },
  { code: 'regression_lockdown',  title: 'Regression Lockdown',   severity: 'blocker' },
  { code: 'admin_access',         title: 'Admin Access',          severity: 'info' },
  { code: 'redaction_status',     title: 'Redaction Status',      severity: 'info' },
  { code: 'download_preflight',   title: 'Download Preflight',    severity: 'info' },
]

// ── Modes ─────────────────────────────────────────────────────────────────────

export function buildAdminPreviewModes(input = {}, options = {}) {
  return {
    compact: {
      available:      true,
      requires_admin: true,
      public:         false,
    },
    detailed: {
      available:      true,
      requires_admin: true,
      public:         false,
    },
    text_only: {
      available:      true,
      requires_admin: true,
      public:         false,
    },
    json_only: {
      available:      true,
      requires_admin: true,
      public:         false,
    },
    download: {
      available:             false,
      requires_future_phase: true,
      public:                false,
    },
  }
}

// ── Cards ─────────────────────────────────────────────────────────────────────

export function buildAdminPreviewCards(input = {}, options = {}) {
  return CARD_DEFINITIONS.map(card => {
    let status  = 'unknown'
    let summary = ''

    switch (card.code) {
      case 'decision_status':
        status  = input.launch_no_launch_decision?.decision ?? 'continue_shadow'
        summary = 'Decisão de lançamento atual do sistema.'
        break
      case 'no_sell_lock':
        status  = 'locked'
        summary = 'Venda bloqueada por política imutável.'
        break
      case 'micro_test_status':
        status  = input.micro_test_policy?.decision_state ?? 'not_started'
        summary = 'Status do micro-teste de shadow.'
        break
      case 'sandbox_status':
        status  = input.private_beta_sandbox?.status ?? 'simulated'
        summary = 'Sandbox privado em modo simulado.'
        break
      case 'manual_review_status':
        status  = input.manual_review_artifact?.status ?? 'blocked'
        summary = 'Revisão manual obrigatória antes de qualquer release.'
        break
      case 'export_integrity':
        status  = input.export_integrity_contract?.status ?? 'checked'
        summary = `Score: ${input.export_integrity_contract?.integrity_score ?? 'N/A'}.`
        break
      case 'regression_lockdown':
        status  = input.regression_lockdown?.status ?? 'locked'
        summary = 'Trava de regressão ativa.'
        break
      case 'admin_access':
        status  = input.admin_export_access_control?.status ?? 'protected'
        summary = 'Acesso restrito a admin. Sem acesso público.'
        break
      case 'redaction_status':
        status  = input.report_redaction_policy?.status ?? 'active'
        summary = 'Redaction de segredos/tokens/emails ativo.'
        break
      case 'download_preflight':
        status  = input.internal_download_preflight?.status ?? 'not_enabled'
        summary = 'Download interno desabilitado nesta fase.'
        break
      default:
        status  = 'unknown'
        summary = ''
    }

    return {
      code:     card.code,
      title:    card.title,
      status,
      severity: card.severity,
      summary,
      metrics:  {},
      actions:  [],
    }
  })
}

// ── UX Contract ───────────────────────────────────────────────────────────────

export function buildAdminPreviewUxContract(input = {}, options = {}) {
  const cards = buildAdminPreviewCards(input, options)

  const blockedActions = [
    { code: 'download_now',    reason: 'download not enabled in this phase' },
    { code: 'share_publicly',  reason: 'public share always blocked' },
    { code: 'enable_sell',     reason: 'sell immutably blocked' },
    { code: 'enable_beta',     reason: 'beta immutably blocked' },
    { code: 'create_pdf',      reason: 'pdf format blocked' },
    { code: 'send_email',      reason: 'email delivery blocked' },
    { code: 'webhook_export',  reason: 'webhook delivery blocked' },
  ]

  const badges = [
    { code: 'no_sell',    label: 'No-Sell Enforced', color: 'red' },
    { code: 'no_beta',    label: 'No-Beta Enforced', color: 'red' },
    { code: 'admin_only', label: 'Admin Only',        color: 'orange' },
    { code: 'redacted',   label: 'Redacted',          color: 'blue' },
    { code: 'simulation', label: 'Simulation Only',   color: 'gray' },
  ]

  return {
    status:               'ready',
    ux_version:           UX_VERSION,
    layout:               'operator_review_cards',
    public_share_allowed: false,   // ALWAYS false
    cards,
    badges,
    actions:              [],
    blocked_actions:      blockedActions,
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

export function buildAdminPreviewHealth(input = {}, options = {}) {
  const noSellStatus   = input.immutable_no_sell_enforcement?.status
  const noSellEnforced = noSellStatus !== 'critical_violation'
  const redactionReady = input.report_redaction_policy?.redaction_enabled !== false
  const adminProtected = input.admin_export_access_control?.public_access_allowed !== true

  const warnings = []
  const blockers  = []

  if (!noSellEnforced)                                               blockers.push('no_sell_enforcement_violated')
  if (input.commercial_claims_guard?.claims_detected === true)       warnings.push('commercial_claims_detected')
  if (input.export_abuse_protection?.status === 'blocked')           warnings.push('export_abuse_protection_blocked')

  let status = 'healthy'
  if (blockers.length > 0) {
    status = noSellStatus === 'critical_violation' ? 'critical_violation' : 'blocked'
  } else if (warnings.length > 0) {
    status = 'healthy_with_warnings'
  }

  return {
    status,
    preview_ready:          true,
    redaction_ready:        redactionReady,
    abuse_protection_ready: true,
    no_sell_enforced:       noSellEnforced,
    admin_access_protected: adminProtected,
    public_share_allowed:   false,   // ALWAYS false
    warnings,
    blockers,
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateAdminPreviewUx(input = {}, options = {}) {
  const safeInput = input ?? {}
  return {
    admin_preview_modes:       buildAdminPreviewModes(safeInput, options),
    admin_preview_ux_contract: buildAdminPreviewUxContract(safeInput, options),
    admin_preview_health:      buildAdminPreviewHealth(safeInput, options),
  }
}
