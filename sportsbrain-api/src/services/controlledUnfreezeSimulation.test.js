import assert from 'assert'
import { evaluateControlledUnfreezeSimulation } from './controlledUnfreezeSimulation.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); errors.push({ name, error: err.message }); failed++ }
}

// T1: default → status=simulated, unfreeze_applied=false, successful_unlocks_count=0
test('T1: default result has status=simulated, unfreeze_applied=false, successful_unlocks_count=0', () => {
  const result = evaluateControlledUnfreezeSimulation({})
  const sim = result.controlled_unfreeze_simulation
  assert.strictEqual(sim.status, 'simulated')
  assert.strictEqual(sim.unfreeze_applied, false)
  assert.strictEqual(sim.successful_unlocks_count, 0)
})

// T2: capability_unlock_attempts.length > 0, no attempt has applied=true
test('T2: capability_unlock_attempts non-empty and no attempt has applied=true', () => {
  const result = evaluateControlledUnfreezeSimulation({})
  const attempts = result.capability_unlock_attempts
  assert.ok(attempts.length > 0, 'attempts should be non-empty')
  const anyApplied = attempts.some(a => a.applied === true)
  assert.strictEqual(anyApplied, false, 'no attempt should have applied=true')
})

// T3: attempt for internal_download has result=future_review_only, applied=false
test('T3: internal_download attempt has result=future_review_only and applied=false', () => {
  const result = evaluateControlledUnfreezeSimulation({})
  const attempt = result.capability_unlock_attempts.find(a => a.capability === 'internal_download')
  assert.ok(attempt, 'internal_download attempt should exist')
  assert.strictEqual(attempt.result, 'future_review_only')
  assert.strictEqual(attempt.applied, false)
})

// T4: attempt for sell has result=blocked (or rejected), applied=false
test('T4: sell attempt has result=blocked or rejected and applied=false', () => {
  const result = evaluateControlledUnfreezeSimulation({})
  const attempt = result.capability_unlock_attempts.find(a => a.capability === 'sell')
  assert.ok(attempt, 'sell attempt should exist')
  assert.ok(
    attempt.result === 'blocked' || attempt.result === 'rejected',
    `sell result should be blocked or rejected, got: ${attempt.result}`
  )
  assert.strictEqual(attempt.applied, false)
})

// T5: rollback_steps includes disable_capability_flag, restore_freeze_baseline, verify_can_sell_false
test('T5: rollback_steps includes required step_ids', () => {
  const result = evaluateControlledUnfreezeSimulation({})
  const steps = result.unlock_rollback_plan.rollback_steps
  const stepIds = steps.map(s => s.step_id)
  assert.ok(stepIds.includes('disable_capability_flag'),  'missing disable_capability_flag')
  assert.ok(stepIds.includes('restore_freeze_baseline'),  'missing restore_freeze_baseline')
  assert.ok(stepIds.includes('verify_can_sell_false'),    'missing verify_can_sell_false')
})

// T6: audit entries include simulation_started, no_unlock_applied, final_safety_confirmed
test('T6: audit entries include required entry_ids', () => {
  const result = evaluateControlledUnfreezeSimulation({})
  const entryIds = result.unlock_simulation_audit.entries.map(e => e.entry_id)
  assert.ok(entryIds.includes('simulation_started'),      'missing simulation_started')
  assert.ok(entryIds.includes('no_unlock_applied'),       'missing no_unlock_applied')
  assert.ok(entryIds.includes('final_safety_confirmed'),  'missing final_safety_confirmed')
})

// T7: unsafe input unfreeze_enabled=true, controlled_unfreeze_active=true → unfreeze_applied=false, can_enable_beta=false
test('T7: unsafe input still forces unfreeze_applied=false and can_enable_beta=false', () => {
  const result = evaluateControlledUnfreezeSimulation({
    unfreeze_enabled: true,
    controlled_unfreeze_active: true,
  })
  const sim = result.controlled_unfreeze_simulation
  assert.strictEqual(sim.unfreeze_applied, false)
  assert.strictEqual(sim.can_enable_beta, false)
})

// T8: JSON.stringify does not throw
test('T8: JSON.stringify(evaluateControlledUnfreezeSimulation({})) does not throw', () => {
  const result = evaluateControlledUnfreezeSimulation({})
  JSON.stringify(result)
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (errors.length > 0) {
  for (const { name, error } of errors) console.error(`  - ${name}: ${error}`)
  process.exit(1)
}
