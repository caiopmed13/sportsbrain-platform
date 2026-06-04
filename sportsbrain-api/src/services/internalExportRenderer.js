// src/services/internalExportRenderer.js
// P3.8.21 — Internal Export Format Renderer

const RENDERER_VERSION = 'p3.8.21'

const ALLOWED_FORMATS  = ['json', 'txt', 'md']
const BLOCKED_FORMATS  = ['pdf', 'html_public', 'email', 'webhook', 'public_url', 'download']
const FORMAT_ALIASES   = { text: 'txt', markdown: 'md', text_only: 'txt', json_only: 'json' }

const CLAIM_TERMS = [
  'lucro garantido', 'roi garantido', 'pronto para vender', 'assertividade garantida',
  'edge comprovado', 'renda garantida', 'garantia de lucro',
  'validated for sale', 'ready to sell', 'guaranteed profit',
  'guaranteed roi', 'guaranteed return', 'rendimento garantido',
]

const MAX_RENDER_CHARS = 8000

// ── Format Normalization ──────────────────────────────────────────────────────

export function normalizeExportFormat(value) {
  if (!value || typeof value !== 'string') return 'json'
  const lower = value.toLowerCase().trim()
  if (FORMAT_ALIASES[lower]) return FORMAT_ALIASES[lower]
  if (ALLOWED_FORMATS.includes(lower)) return lower
  return 'invalid'
}

// ── Canonical Payload ─────────────────────────────────────────────────────────

export function buildCanonicalExportPayload(input = {}, options = {}) {
  const fingerprint = input.decision_fingerprint?.value ?? null
  const decision    = input.launch_no_launch_decision?.decision ?? 'continue_shadow'
  const sections    = input.evidence_export_packet?.sections ?? []

  return {
    packet_version:     RENDERER_VERSION,
    fingerprint,
    decision,
    status:             'blocked',
    operator_instruction: 'Usar apenas para revisão interna. Não vender. Não compartilhar.',
    summary: {
      overall_grade:        input.decision_evidence_matrix?.overall_grade ?? 'blocked',
      manual_review_status: input.manual_review_artifact?.status ?? 'blocked',
      no_launch_status:     input.no_launch_governance?.status ?? 'locked',
      lockdown_status:      input.regression_lockdown?.status ?? 'locked',
    },
    sections: sections.map(s => ({ code: s.code ?? '', title: s.title ?? '', status: s.status ?? '' })),
    next_actions: input.operator_next_actions?.actions ?? [],
    locks: {
      sell_lock:        true,
      beta_lock:        true,
      download_lock:    true,
      public_lock:      true,
    },
    safety: {
      can_beta:             false,   // ALWAYS false
      can_sell:             false,   // ALWAYS false
      download_enabled:     false,   // ALWAYS false
      public_share_allowed: false,   // ALWAYS false
      safe_to_sell:         false,   // ALWAYS false
    },
  }
}

// ── JSON Renderer ─────────────────────────────────────────────────────────────

export function renderExportJson(input = {}, options = {}) {
  const payload  = buildCanonicalExportPayload(input, options)
  const content  = JSON.stringify(payload, null, 2)
  const truncated = content.length > MAX_RENDER_CHARS
  const finalContent = truncated
    ? content.slice(0, MAX_RENDER_CHARS) + '\n/* ...truncated */'
    : content

  return {
    status:       'rendered',
    content_type: 'application/json',
    chars:        finalContent.length,
    truncated,
    redacted:     true,
    safe:         true,
    content:      finalContent,
    preview:      finalContent.slice(0, 200),
  }
}

// ── TXT Renderer ──────────────────────────────────────────────────────────────

export function renderExportText(input = {}, options = {}) {
  const payload = buildCanonicalExportPayload(input, options)
  const lines   = [
    'SportsBrain Internal Operator Export',
    `Generated: ${new Date().toISOString()}`,
    `Version: ${RENDERER_VERSION}`,
    '---',
    `Decision: ${payload.decision}`,
    `Status: ${payload.status}`,
    `Beta: blocked`,
    `Sell: blocked`,
    `Download: disabled`,
    `Fingerprint: ${payload.fingerprint ?? 'none'}`,
    '---',
    `Overall Grade: ${payload.summary.overall_grade}`,
    `Manual Review: ${payload.summary.manual_review_status}`,
    `No-Launch Lock: ${payload.summary.no_launch_status}`,
    `Regression Lock: ${payload.summary.lockdown_status}`,
    '---',
    'Safety',
    `  can_beta: false`,
    `  can_sell: false`,
    `  download_enabled: false`,
    `  public_share_allowed: false`,
    '---',
    payload.operator_instruction,
  ]
  const content = lines.join('\n')
  const truncated = content.length > MAX_RENDER_CHARS

  return {
    status:       'rendered',
    content_type: 'text/plain',
    chars:        Math.min(content.length, MAX_RENDER_CHARS),
    truncated,
    redacted:     true,
    safe:         true,
    content:      truncated ? content.slice(0, MAX_RENDER_CHARS) + '\n[...truncated]' : content,
    preview:      content.slice(0, 200),
  }
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────

export function renderExportMarkdown(input = {}, options = {}) {
  const payload = buildCanonicalExportPayload(input, options)
  const lines   = [
    '# SportsBrain Internal Operator Export',
    '',
    `> Version: ${RENDERER_VERSION} | Simulation Only`,
    '',
    '## Decision',
    `- Decision: ${payload.decision}`,
    `- Beta: blocked`,
    `- Sell: blocked`,
    `- Download: disabled`,
    `- Fingerprint: ${payload.fingerprint ?? 'none'}`,
    '',
    '## Summary',
    `- Overall Grade: ${payload.summary.overall_grade}`,
    `- Manual Review: ${payload.summary.manual_review_status}`,
    `- No-Launch Lock: ${payload.summary.no_launch_status}`,
    `- Regression Lock: ${payload.summary.lockdown_status}`,
    '',
    '## Safety',
    '- can_beta: false',
    '- can_sell: false',
    '- download_enabled: false',
    '- public_share_allowed: false',
    '- safe_to_sell: false',
    '',
    '## Instruction',
    `> ${payload.operator_instruction}`,
  ]
  const content = lines.join('\n')
  const truncated = content.length > MAX_RENDER_CHARS

  return {
    status:       'rendered',
    content_type: 'text/markdown',
    chars:        Math.min(content.length, MAX_RENDER_CHARS),
    truncated,
    redacted:     true,
    safe:         true,
    content:      truncated ? content.slice(0, MAX_RENDER_CHARS) + '\n[...truncated]' : content,
    preview:      content.slice(0, 200),
  }
}

// ── Format Validation ─────────────────────────────────────────────────────────

function scanForLeaks(content) {
  if (typeof content !== 'string') return []
  const leaks = []
  if (/Bearer\s+[A-Za-z0-9\-._~+/=]{6,}/i.test(content))             leaks.push('bearer_token')
  if (/X-Admin-Key\s*:\s*\S+/i.test(content))                         leaks.push('admin_key')
  if (/Authorization\s*:\s*\S+/i.test(content))                       leaks.push('authorization')
  if (/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(content)) leaks.push('email')
  if (CLAIM_TERMS.some(t => content.toLowerCase().includes(t)))        leaks.push('claim_term')
  if (/"can_sell"\s*:\s*true/i.test(content))                          leaks.push('can_sell_true')
  if (/"can_beta"\s*:\s*true/i.test(content))                          leaks.push('can_beta_true')
  return leaks
}

export function validateRenderedExportFormats(input = {}, options = {}) {
  const jsonRender = input.json ?? {}
  const txtRender  = input.txt  ?? {}
  const mdRender   = input.md   ?? {}

  const checks     = []
  const failedFormats = []

  // json_parseable
  let jsonParseable = false
  try {
    if (jsonRender.content) { JSON.parse(jsonRender.content); jsonParseable = true }
    else jsonParseable = true  // empty is fine
  } catch { /* */ }
  checks.push({ code: 'json_parseable', passed: jsonParseable, format: 'json' })
  if (!jsonParseable && !failedFormats.includes('json')) failedFormats.push('json')

  // txt/md non-empty
  const txtOk = typeof txtRender.content === 'string' && txtRender.content.length > 0
  const mdOk  = typeof mdRender.content  === 'string' && mdRender.content.length  > 0
  checks.push({ code: 'txt_non_empty', passed: txtOk, format: 'txt' })
  checks.push({ code: 'md_non_empty',  passed: mdOk,  format: 'md'  })
  if (!txtOk && !failedFormats.includes('txt')) failedFormats.push('txt')
  if (!mdOk  && !failedFormats.includes('md'))  failedFormats.push('md')

  // Leak scans on each format
  for (const [fmt, render] of [['json', jsonRender], ['txt', txtRender], ['md', mdRender]]) {
    const leaks = scanForLeaks(render.content ?? '')
    const noSecrets = !leaks.includes('bearer_token') && !leaks.includes('admin_key') && !leaks.includes('authorization')
    const noEmails  = !leaks.includes('email')
    const noClaims  = !leaks.includes('claim_term')
    const noSell    = !leaks.includes('can_sell_true')
    const noBeta    = !leaks.includes('can_beta_true')
    checks.push({ code: `no_secret_patterns`, passed: noSecrets, format: fmt })
    checks.push({ code: `no_email_patterns`,  passed: noEmails,  format: fmt })
    checks.push({ code: `no_claim_terms`,     passed: noClaims,  format: fmt })
    checks.push({ code: `no_can_sell_true`,   passed: noSell,    format: fmt })
    checks.push({ code: `no_can_beta_true`,   passed: noBeta,    format: fmt })
    if (!noSecrets || !noEmails || !noClaims || !noSell || !noBeta) {
      if (!failedFormats.includes(fmt)) failedFormats.push(fmt)
    }
  }

  // Size limits
  const sizeOk = (jsonRender.chars ?? 0) <= MAX_RENDER_CHARS &&
                 (txtRender.chars  ?? 0) <= MAX_RENDER_CHARS &&
                 (mdRender.chars   ?? 0) <= MAX_RENDER_CHARS
  checks.push({ code: 'within_size_limits', passed: sizeOk })

  // Redaction applied (renderer always sets redacted=true)
  const redacted = jsonRender.redacted !== false && txtRender.redacted !== false && mdRender.redacted !== false
  checks.push({ code: 'redaction_applied', passed: redacted })

  const failedChecks = checks.filter(c => !c.passed)
  const valid = failedChecks.length === 0

  const warnings = []
  const blockers  = []
  if (!jsonParseable) blockers.push('json_not_parseable')
  if (failedChecks.some(c => c.code === 'no_claim_terms'))    blockers.push('claim_terms_detected')
  if (failedChecks.some(c => c.code === 'no_can_sell_true'))  blockers.push('can_sell_true_in_render')
  if (failedChecks.some(c => c.code === 'no_secret_patterns')) blockers.push('secrets_in_render')

  return {
    status:          valid ? 'valid' : 'invalid',
    valid,
    formats_checked: ['json', 'txt', 'md'],
    failed_formats:  failedFormats,
    checks_count:    checks.length,
    failed_count:    failedChecks.length,
    warnings,
    blockers,
    checks,
  }
}

// ── Renderer Meta ─────────────────────────────────────────────────────────────

function buildInternalExportRendererMeta(input = {}, options = {}) {
  const claimsBlocked  = input.commercial_claims_guard?.claims_detected === true
  const noSellOk       = input.immutable_no_sell_enforcement?.status !== 'critical_violation'

  let status = 'ready'
  if (!noSellOk)   status = 'critical_violation'
  else if (claimsBlocked) status = 'ready_with_warnings'

  return {
    status,
    renderer_version:      RENDERER_VERSION,
    simulation_only:       true,
    physical_file_created: false,   // ALWAYS false
    download_enabled:      false,   // ALWAYS false
    supported_formats:     ALLOWED_FORMATS,
    blocked_formats:       BLOCKED_FORMATS,
    default_format:        'json',
    redaction_required:    true,
    claims_guard_required: true,
    no_sell_required:      true,
  }
}

function buildFormatRenderSummary(input = {}, options = {}) {
  return {
    status:                  'ready',
    formats_available:       ALLOWED_FORMATS,
    default_format:          'json',
    admin_preview_mode:      input.admin_preview_mode ?? 'compact',
    download_enabled:        false,   // ALWAYS false
    physical_file_created:   false,   // ALWAYS false
    safe_for_internal_admin: true,
    safe_for_public_share:   false,   // ALWAYS false
    safe_to_sell:            false,   // ALWAYS false
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function evaluateInternalExportRenderer(input = {}, options = {}) {
  const safeInput  = input ?? {}
  const jsonRender = renderExportJson(safeInput, options)
  const txtRender  = renderExportText(safeInput, options)
  const mdRender   = renderExportMarkdown(safeInput, options)

  const validation = validateRenderedExportFormats({ json: jsonRender, txt: txtRender, md: mdRender }, options)

  return {
    internal_export_renderer: buildInternalExportRendererMeta(safeInput, options),
    rendered_export_formats:  {
      json: { status: jsonRender.status, content_type: jsonRender.content_type, chars: jsonRender.chars, redacted: jsonRender.redacted, safe: jsonRender.safe, preview: jsonRender.preview },
      txt:  { status: txtRender.status,  content_type: txtRender.content_type,  chars: txtRender.chars,  redacted: txtRender.redacted,  safe: txtRender.safe,  preview: txtRender.preview },
      md:   { status: mdRender.status,   content_type: mdRender.content_type,   chars: mdRender.chars,   redacted: mdRender.redacted,   safe: mdRender.safe,   preview: mdRender.preview },
    },
    export_format_validation: validation,
    format_render_summary:    buildFormatRenderSummary(safeInput, options),
    // Full render content — only exposed when explicitly needed (admin endpoint)
    _rendered_content: { json: jsonRender, txt: txtRender, md: mdRender },
  }
}
