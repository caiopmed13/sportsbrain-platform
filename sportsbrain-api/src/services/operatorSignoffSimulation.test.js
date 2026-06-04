import assert from 'assert'
import { evaluateOperatorSignoffSimulation } from './operatorSignoffSimulation.js'

let passed = 0
let failed = 0
const errors = []

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`)
    errors.push({ name, error: err.message })
    failed++
  }
}

// T1: default call → simulation disabled, operator_signoff_effective always false
test('T1: default options → status=disabled, operator_signoff_effective=false', () => {
  const result = evaluateOperatorSignoffSimulation()
  assert.strictEqual(result.operator_signoff_simulation.status, 'disabled')
  assert.strictEqual(result.operator_signoff_simulation.operator_signoff_effective, false)
})

// T2: enabled + approved → approved_but_ineffective, can_enable_beta/sell always false
test('T2: enabled+approved → status=approved_but_ineffective, can_enable_beta=false, can_enable_sell=false', () => {
  const result = evaluateOperatorSignoffSimulation(
    {},
    { OPERATOR_SIGNOFF_SIMULATION_ENABLED: true, OPERATOR_SIMULATED_SIGNOFF_APPROVED: true }
  )
  const sim = result.operator_signoff_simulation
  assert.strictEqual(sim.status, 'approved_but_ineffective')
  assert.strictEqual(sim.can_enable_beta, false)
  assert.strictEqual(sim.can_enable_sell, false)
})

// T3: enabled + rejected → status=rejected
test('T3: enabled+rejected → status=rejected', () => {
  const result = evaluateOperatorSignoffSimulation(
    {},
    { OPERATOR_SIGNOFF_SIMULATION_ENABLED: true, OPERATOR_SIMULATED_SIGNOFF_REJECTED: true }
  )
  assert.strictEqual(result.operator_signoff_simulation.status, 'rejected')
})

// T4: enabled + approved + rejected → status=conflict, effective=false
test('T4: enabled+approved+rejected → status=conflict, effective=false', () => {
  const result = evaluateOperatorSignoffSimulation(
    {},
    {
      OPERATOR_SIGNOFF_SIMULATION_ENABLED: true,
      OPERATOR_SIMULATED_SIGNOFF_APPROVED: true,
      OPERATOR_SIMULATED_SIGNOFF_REJECTED: true,
    }
  )
  const sim = result.operator_signoff_simulation
  assert.strictEqual(sim.status, 'conflict')
  assert.strictEqual(sim.effective, false)
})

// T5: effectiveness policy hard invariants + blocked_effects contents
test('T5: signoff_effectiveness_policy → signoff_can_override=false, signoff_effective_now=false, blocked_effects has key entries', () => {
  const result = evaluateOperatorSignoffSimulation()
  const policy = result.signoff_effectiveness_policy
  assert.strictEqual(policy.signoff_can_override, false)
  assert.strictEqual(policy.signoff_effective_now, false)
  assert.ok(policy.blocked_effects.includes('enable_beta'), 'missing enable_beta')
  assert.ok(policy.blocked_effects.includes('enable_sell'), 'missing enable_sell')
  assert.ok(policy.blocked_effects.includes('enable_delivery'), 'missing enable_delivery')
})

// T6: audit trail entries include required ids
test('T6: signoff_audit_trail.entries includes no_override_policy_checked and final_no_effect_confirmed', () => {
  const result = evaluateOperatorSignoffSimulation()
  const ids = result.signoff_audit_trail.entries.map((e) => e.id)
  assert.ok(ids.includes('no_override_policy_checked'), 'missing no_override_policy_checked')
  assert.ok(ids.includes('final_no_effect_confirmed'), 'missing final_no_effect_confirmed')
})

// T7: unsafe input sanitisation — operator_signoff_effective=true in input → false in output
test('T7: input operator_signoff_effective=true is sanitised to false in output', () => {
  const result = evaluateOperatorSignoffSimulation({ operator_signoff_effective: true })
  assert.strictEqual(result.operator_signoff_simulation.operator_signoff_effective, false)
})

// T8: full result serialises without throwing
test('T8: JSON.stringify(evaluateOperatorSignoffSimulation({})) does not throw', () => {
  let serialised
  assert.doesNotThrow(() => {
    serialised = JSON.stringify(evaluateOperatorSignoffSimulation({}))
  })
  assert.ok(typeof serialised === 'string' && serialised.length > 0)
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const e of errors) {
    console.error(`  - ${e.name}: ${e.error}`)
  }
  process.exit(1)
}
