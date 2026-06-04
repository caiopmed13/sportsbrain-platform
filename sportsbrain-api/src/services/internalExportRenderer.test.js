// src/services/internalExportRenderer.test.js
// P3.8.21 — 10 tests for Internal Export Renderer

import assert from 'assert'
import {
  normalizeExportFormat,
  buildCanonicalExportPayload,
  renderExportJson,
  renderExportText,
  renderExportMarkdown,
  validateRenderedExportFormats,
  evaluateInternalExportRenderer,
} from './internalExportRenderer.js'

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

// ── Tests ──────────────────────────────────────────────────────────────────────

test('T1: renderer default ready → status=ready, download_enabled=false, physical_file_created=false', () => {
  const result = evaluateInternalExportRenderer({})
  const meta   = result.internal_export_renderer
  assert.strictEqual(meta.status,               'ready')
  assert.strictEqual(meta.download_enabled,      false)
  assert.strictEqual(meta.physical_file_created, false)
  assert.ok(meta.supported_formats.includes('json'), 'json missing from supported')
  assert.ok(meta.supported_formats.includes('txt'),  'txt missing from supported')
  assert.ok(meta.supported_formats.includes('md'),   'md missing from supported')
})

test('T2: normalizeExportFormat handles aliases and invalid', () => {
  assert.strictEqual(normalizeExportFormat('json'),     'json')
  assert.strictEqual(normalizeExportFormat('txt'),      'txt')
  assert.strictEqual(normalizeExportFormat('text'),     'txt')
  assert.strictEqual(normalizeExportFormat('md'),       'md')
  assert.strictEqual(normalizeExportFormat('markdown'), 'md')
  const invalid = normalizeExportFormat('pdf')
  assert.ok(invalid === 'invalid' || invalid === 'json', 'Invalid should fall back gracefully')
})

test('T3: renderExportJson → content is JSON-parseable', () => {
  const render = renderExportJson({})
  assert.strictEqual(render.status, 'rendered')
  assert.strictEqual(render.content_type, 'application/json')
  assert.doesNotThrow(() => JSON.parse(render.content), 'Rendered JSON must be parseable')
  const parsed = JSON.parse(render.content)
  // Safety invariants in canonical payload
  assert.strictEqual(parsed.safety?.can_sell,  false)
  assert.strictEqual(parsed.safety?.can_beta,  false)
})

test('T4: renderExportText → contains Beta: blocked and Sell: blocked', () => {
  const render = renderExportText({})
  assert.strictEqual(render.status,       'rendered')
  assert.strictEqual(render.content_type, 'text/plain')
  assert.ok(render.content.includes('Beta: blocked'), 'Missing "Beta: blocked"')
  assert.ok(render.content.includes('Sell: blocked'), 'Missing "Sell: blocked"')
})

test('T5: renderExportMarkdown → contains # SportsBrain heading and ## Safety', () => {
  const render = renderExportMarkdown({})
  assert.strictEqual(render.status,       'rendered')
  assert.strictEqual(render.content_type, 'text/markdown')
  assert.ok(render.content.includes('# SportsBrain'), 'Missing # SportsBrain heading')
  assert.ok(render.content.includes('## Safety'),     'Missing ## Safety heading')
})

test('T6: renders do not contain raw secrets', () => {
  const input = {
    operator_report_render: { text: 'Authorization: Bearer mysecrettoken\nContact: hack@evil.com' },
  }
  const result = evaluateInternalExportRenderer(input)
  const fmts   = result._rendered_content
  for (const [fmt, render] of Object.entries(fmts)) {
    const c = render.content ?? ''
    assert.ok(!c.includes('mysecrettoken'), `${fmt}: should not contain raw token`)
    assert.ok(!c.includes('hack@evil.com'), `${fmt}: should not contain raw email`)
  }
})

test('T7: validation detects can_sell=true in rendered content → valid=false or blockers', () => {
  // Inject unsafe JSON content
  const badJson = { content: '{"can_sell":true}', status: 'rendered', content_type: 'application/json', chars: 17, redacted: false }
  const result  = validateRenderedExportFormats({ json: badJson, txt: { content: '' }, md: { content: '' } })
  assert.ok(!result.valid || result.blockers.length > 0, 'Expected invalid or blockers for can_sell=true')
})

test('T8: validation detects claim term in txt → blocker', () => {
  const claimTxt = { content: 'This product has guaranteed profit for all users.', status: 'rendered', content_type: 'text/plain', chars: 50, redacted: false }
  const result   = validateRenderedExportFormats({ json: { content: '{}' }, txt: claimTxt, md: { content: '' } })
  assert.ok(result.blockers.some(b => b.includes('claim')), 'Expected claim-related blocker')
})

test('T9: empty input is within size limits → within_size_limits check passes', () => {
  const result = evaluateInternalExportRenderer({})
  const checks = result.export_format_validation.checks
  const sizeCheck = checks.find(c => c.code === 'within_size_limits')
  assert.ok(sizeCheck, 'Missing within_size_limits check')
  assert.strictEqual(sizeCheck.passed, true)
})

test('T10: JSON.stringify(evaluateInternalExportRenderer({})) does not throw', () => {
  const result = evaluateInternalExportRenderer({})
  let serialized
  assert.doesNotThrow(() => { serialized = JSON.stringify(result) })
  assert.ok(typeof serialized === 'string' && serialized.length > 0, 'Expected non-empty JSON')
})

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
