import assert from 'assert'
import { evaluateResolvedSampleAudit } from './resolvedSampleAudit.js'

let passed = 0, failed = 0
const errors = []
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1 — basic green + red
test('T1: resolved_valid=2, green_count=1, red_count=1', () => {
  const { resolved_sample_audit: a } = evaluateResolvedSampleAudit({
    rows: [
      { training_eligible: 1, result_status: 'green' },
      { training_eligible: 1, result_status: 'red' },
    ],
  })
  assert.strictEqual(a.resolved_valid, 2, `resolved_valid should be 2, got ${a.resolved_valid}`)
  assert.strictEqual(a.green_count, 1, `green_count should be 1, got ${a.green_count}`)
  assert.strictEqual(a.red_count, 1, `red_count should be 1, got ${a.red_count}`)
})

// T2 — pending row
test('T2: pending row → pending_training_eligible > 0, resolved_valid = 0', () => {
  const { resolved_sample_audit: a } = evaluateResolvedSampleAudit({
    rows: [{ training_eligible: 1, result_status: 'pending' }],
  })
  assert.ok(a.pending_training_eligible > 0, 'pending_training_eligible should be > 0')
  assert.strictEqual(a.resolved_valid, 0, `resolved_valid should be 0, got ${a.resolved_valid}`)
})

// T3 — unknown row
test('T3: unknown row → unknown_result_count > 0, resolved_valid = 0', () => {
  const { resolved_sample_audit: a } = evaluateResolvedSampleAudit({
    rows: [{ training_eligible: 1, result_status: 'unknown' }],
  })
  assert.ok(a.unknown_result_count > 0, 'unknown_result_count should be > 0')
  assert.strictEqual(a.resolved_valid, 0, `resolved_valid should be 0, got ${a.resolved_valid}`)
})

// T4 — not training_eligible
test('T4: training_eligible=0 → excluded_count > 0, resolved_valid = 0', () => {
  const { resolved_sample_audit: a } = evaluateResolvedSampleAudit({
    rows: [{ training_eligible: 0, result_status: 'green' }],
  })
  assert.ok(a.excluded_count > 0, 'excluded_count should be > 0')
  assert.strictEqual(a.resolved_valid, 0, `resolved_valid should be 0, got ${a.resolved_valid}`)
})

// T5 — 12 valid rows → remaining = 18
test('T5: 12 valid rows → remaining_to_threshold = 18', () => {
  const rows = []
  for (let i = 0; i < 7; i++) rows.push({ training_eligible: 1, result_status: 'green' })
  for (let i = 0; i < 5; i++) rows.push({ training_eligible: 1, result_status: 'red' })
  const { resolved_sample_audit: a } = evaluateResolvedSampleAudit({ rows })
  assert.strictEqual(a.resolved_valid, 12, `resolved_valid should be 12, got ${a.resolved_valid}`)
  assert.strictEqual(a.remaining_to_threshold, 18, `remaining_to_threshold should be 18, got ${a.remaining_to_threshold}`)
})

// T6 — 30 valid rows → can_count_for_micro_test = true
test('T6: 30 valid rows → can_count_for_micro_test=true, status=ready_for_threshold', () => {
  const rows = []
  for (let i = 0; i < 15; i++) rows.push({ training_eligible: 1, result_status: 'green' })
  for (let i = 0; i < 15; i++) rows.push({ training_eligible: 1, result_status: 'red' })
  const { resolved_sample_audit: a } = evaluateResolvedSampleAudit({ rows })
  assert.strictEqual(a.resolved_valid, 30, `resolved_valid should be 30, got ${a.resolved_valid}`)
  assert.strictEqual(a.can_count_for_micro_test, true, 'can_count_for_micro_test should be true')
  assert.strictEqual(a.status, 'ready_for_threshold', `status should be ready_for_threshold, got ${a.status}`)
})

// T7 — by_sport distribution
test('T7: by_sport contains football and basketball, hit_rate in [0,1]', () => {
  const rows = [
    { training_eligible: 1, result_status: 'green', sport: 'football' },
    { training_eligible: 1, result_status: 'red', sport: 'football' },
    { training_eligible: 1, result_status: 'green', sport: 'basketball' },
  ]
  const { resolved_sample_distribution: d } = evaluateResolvedSampleAudit({ rows })
  const keys = d.by_sport.map(b => b.key)
  assert.ok(keys.includes('football'), 'by_sport should include football')
  assert.ok(keys.includes('basketball'), 'by_sport should include basketball')
  for (const b of d.by_sport) {
    assert.ok(b.hit_rate >= 0 && b.hit_rate <= 1, `hit_rate out of range for ${b.key}: ${b.hit_rate}`)
  }
})

// T8 — pending → pending_resolution_queue populated
test('T8: pending row → pending_resolution_queue.pending_training_eligible > 0, resolver_next_action present', () => {
  const { pending_resolution_queue: q } = evaluateResolvedSampleAudit({
    rows: [{ training_eligible: 1, result_status: 'pending' }],
  })
  assert.ok(q.pending_training_eligible > 0, 'pending_training_eligible should be > 0')
  assert.ok(typeof q.resolver_next_action === 'string' && q.resolver_next_action.length > 0, 'resolver_next_action should be a non-empty string')
})

// T9 — empty rows does not throw
test('T9: empty rows — JSON.stringify does not throw', () => {
  let result
  assert.doesNotThrow(() => {
    result = JSON.stringify(evaluateResolvedSampleAudit({ rows: [] }))
  }, 'JSON.stringify should not throw')
  assert.ok(typeof result === 'string' && result.length > 0, 'result should be a non-empty string')
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error('FAILURES:', errors); process.exit(1) }
