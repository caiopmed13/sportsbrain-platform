import assert from 'assert'
import {
  normalizeArchiveBoolean,
  buildAdminExportArchiveContract,
  buildReportVersionManifest,
  buildArchiveIntegritySummary,
  buildArchiveSimulationSummary,
  evaluateAdminExportArchive,
} from './adminExportArchive.js'

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

// T1: default contract → status=ready, archive_enabled=false, archive_persistence_enabled=false, archive_download_enabled=false
test('T1: default contract has status=ready and all archive flags false', () => {
  const contract = buildAdminExportArchiveContract()
  assert.strictEqual(contract.status, 'ready')
  assert.strictEqual(contract.archive_enabled, false)
  assert.strictEqual(contract.archive_persistence_enabled, false)
  assert.strictEqual(contract.archive_download_enabled, false)
})

// T2: allowed_future_formats includes json/txt/md; blocked_now includes pdf, public_url, email, webhook, database_persist
test('T2: allowed_future_formats and blocked_now are correct', () => {
  const contract = buildAdminExportArchiveContract()
  assert.ok(contract.allowed_future_formats.includes('json'))
  assert.ok(contract.allowed_future_formats.includes('txt'))
  assert.ok(contract.allowed_future_formats.includes('md'))
  assert.ok(contract.blocked_now.includes('pdf'))
  assert.ok(contract.blocked_now.includes('public_url'))
  assert.ok(contract.blocked_now.includes('email'))
  assert.ok(contract.blocked_now.includes('webhook'))
  assert.ok(contract.blocked_now.includes('database_persist'))
})

// T3: manifest → status=generated, versions_count=5, persistence_enabled=false; versions include previous_shadow type
test('T3: manifest has status=generated, 5 versions, persistence_enabled=false, includes previous_shadow', () => {
  const manifest = buildReportVersionManifest()
  assert.strictEqual(manifest.status, 'generated')
  assert.strictEqual(manifest.versions_count, 5)
  assert.strictEqual(manifest.persistence_enabled, false)
  const types = manifest.versions.map((v) => v.type)
  assert.ok(types.includes('previous_shadow'))
})

// T4: integrity with fingerprint present, rendered, redaction lock passed, download disabled → status=valid, integrity_score>=70
test('T4: full integrity input yields status=valid and score>=70', () => {
  const input = {
    decision_fingerprint: { value: 'test-fingerprint' },
    internal_export_renderer: { status: 'ready' },
    redaction_regression_lock: { passed: true },
    admin_download_dry_run: { download_enabled: false },
    archive_persistence_enabled: false,
    immutable_no_sell_enforcement: { status: 'ok' },
  }
  const summary = buildArchiveIntegritySummary(input)
  assert.strictEqual(summary.status, 'valid')
  assert.ok(summary.integrity_score >= 70)
})

// T5: integrity with no fingerprint → fingerprint_present=false, integrity_score lower than T4
test('T5: no fingerprint yields fingerprint_present=false and lower score than T4', () => {
  const inputFull = {
    decision_fingerprint: { value: 'test-fingerprint' },
    internal_export_renderer: { status: 'ready' },
    redaction_regression_lock: { passed: true },
    admin_download_dry_run: { download_enabled: false },
    archive_persistence_enabled: false,
    immutable_no_sell_enforcement: { status: 'ok' },
  }
  const inputNoFp = {
    internal_export_renderer: { status: 'ready' },
    redaction_regression_lock: { passed: true },
    admin_download_dry_run: { download_enabled: false },
    archive_persistence_enabled: false,
    immutable_no_sell_enforcement: { status: 'ok' },
  }
  const fullSummary = buildArchiveIntegritySummary(inputFull)
  const noFpSummary = buildArchiveIntegritySummary(inputNoFp)
  assert.strictEqual(noFpSummary.fingerprint_present, false)
  assert.ok(noFpSummary.integrity_score < fullSummary.integrity_score)
})

// T6: input archive_persistence_enabled=true → output archive_persistence_enabled=false, unsafe_flags_sanitized array present
test('T6: archive_persistence_enabled=true input is sanitized; output is false', () => {
  const contract = buildAdminExportArchiveContract({ archive_persistence_enabled: true })
  assert.strictEqual(contract.archive_persistence_enabled, false)
  assert.ok(Array.isArray(contract.unsafe_flags_sanitized))
  assert.ok(contract.unsafe_flags_sanitized.includes('archive_persistence_enabled'))
})

// T7: input archive_download_enabled=true → output archive_download_enabled=false
test('T7: archive_download_enabled=true input still yields false in output', () => {
  const contract = buildAdminExportArchiveContract({ archive_download_enabled: true })
  assert.strictEqual(contract.archive_download_enabled, false)
})

// T8: simulation summary → safe_for_public_share=false, safe_to_sell=false, persistence_enabled=false
test('T8: simulation summary safety flags are all false', () => {
  const summary = buildArchiveSimulationSummary()
  assert.strictEqual(summary.safe_for_public_share, false)
  assert.strictEqual(summary.safe_to_sell, false)
  assert.strictEqual(summary.persistence_enabled, false)
})

// T9: JSON.stringify(evaluateAdminExportArchive({})) does not throw
test('T9: evaluateAdminExportArchive({}) serializes without throwing', () => {
  let result
  assert.doesNotThrow(() => {
    result = JSON.stringify(evaluateAdminExportArchive({}))
  })
  assert.ok(typeof result === 'string' && result.length > 0)
})

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  console.error('\nFailed tests:')
  errors.forEach(({ name, error }) => console.error(`  - ${name}: ${error}`))
  process.exit(1)
}
