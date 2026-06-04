// microTestManualActivationGuard.test.js
import { evaluateMicroTestManualActivationGuard } from './microTestManualActivationGuard.js'

let passed = 0, failed = 0
function assert(cond, msg) { if (!cond) throw new Error(msg) }
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++ }
  catch(e) { console.error(`  FAIL  ${name}: ${e.message}`); failed++ }
}

// T1 — waiting below threshold
test('T1: waiting below threshold', () => {
  const result = evaluateMicroTestManualActivationGuard({ resolved_valid: 12, micro_test_enabled: false })
  assert(result.micro_test_manual_activation_guard.status === 'waiting_for_threshold',
    `expected waiting_for_threshold, got ${result.micro_test_manual_activation_guard.status}`)
  assert(result.micro_test_manual_activation_guard.operator_can_set_env_var === false,
    `expected operator_can_set_env_var=false, got ${result.micro_test_manual_activation_guard.operator_can_set_env_var}`)
})

// T2 — ready at threshold
test('T2: ready at threshold', () => {
  const result = evaluateMicroTestManualActivationGuard({ resolved_valid: 30, micro_test_enabled: false })
  assert(result.micro_test_manual_activation_guard.status === 'ready_for_manual_activation',
    `expected ready_for_manual_activation, got ${result.micro_test_manual_activation_guard.status}`)
  assert(result.micro_test_manual_activation_guard.operator_can_set_env_var === true,
    `expected operator_can_set_env_var=true, got ${result.micro_test_manual_activation_guard.operator_can_set_env_var}`)
  assert(result.micro_test_manual_activation_guard.activation_allowed_now === true,
    `expected activation_allowed_now=true, got ${result.micro_test_manual_activation_guard.activation_allowed_now}`)
})

// T3 — active monitoring
test('T3: active monitoring', () => {
  const result = evaluateMicroTestManualActivationGuard({ resolved_valid: 30, micro_test_enabled: true, micro_test_active: true })
  assert(result.micro_test_manual_activation_guard.status === 'active_monitoring',
    `expected active_monitoring, got ${result.micro_test_manual_activation_guard.status}`)
})

// T4 — env inconsistent: enabled below threshold
test('T4: env inconsistent - enabled below threshold', () => {
  const result = evaluateMicroTestManualActivationGuard({ resolved_valid: 12, micro_test_enabled: true })
  assert(result.micro_test_env_state.status === 'enabled_waiting_for_threshold',
    `expected enabled_waiting_for_threshold, got ${result.micro_test_env_state.status}`)
  assert(
    result.micro_test_manual_activation_guard.warnings.length > 0 || result.micro_test_manual_activation_guard.blockers.length > 0,
    'expected at least one warning or blocker for inconsistent enabled-below-threshold state'
  )
})

// T5 — checks include manual_activation_only and auto_activation_disabled
test('T5: checks include manual_activation_only and auto_activation_disabled', () => {
  const result = evaluateMicroTestManualActivationGuard({})
  assert(
    result.manual_activation_guard_checks.checks.some(c => c.name === 'manual_activation_only' && c.passed === true),
    'expected manual_activation_only check with passed=true'
  )
  assert(
    result.manual_activation_guard_checks.checks.some(c => c.name === 'auto_activation_disabled' && c.passed === true),
    'expected auto_activation_disabled check with passed=true'
  )
})

// T6 — unsafe auto activation sanitized
test('T6: unsafe auto activation sanitized', () => {
  const result = evaluateMicroTestManualActivationGuard({ auto_activation_allowed: true, auto_activate_micro_test: true })
  assert(result.micro_test_manual_activation_guard.auto_activation_allowed === false,
    `expected auto_activation_allowed=false, got ${result.micro_test_manual_activation_guard.auto_activation_allowed}`)
  assert(result.micro_test_env_state.auto_activation_allowed === false,
    `expected env_state auto_activation_allowed=false, got ${result.micro_test_env_state.auto_activation_allowed}`)
  assert(
    result.micro_test_env_state.status === 'critical_violation' ||
    result.micro_test_manual_activation_guard.status === 'critical_violation' ||
    result.micro_test_manual_activation_guard.warnings.length > 0,
    'expected critical_violation status or warnings when unsafe fields arrive as true'
  )
})

// T7 — audit entries include env_state_read and guard_status_computed
test('T7: audit entries include env_state_read and guard_status_computed', () => {
  const result = evaluateMicroTestManualActivationGuard({})
  assert(
    result.activation_guard_audit.entries.some(e => e.step === 'env_state_read'),
    'expected env_state_read entry in audit'
  )
  assert(
    result.activation_guard_audit.entries.some(e => e.step === 'guard_status_computed'),
    'expected guard_status_computed entry in audit'
  )
})

// T8 — output is serializable
test('T8: output is serializable', () => {
  let threw = false
  try {
    JSON.stringify(evaluateMicroTestManualActivationGuard({}))
  } catch (e) {
    threw = true
  }
  assert(!threw, 'JSON.stringify threw — output is not serializable')
})

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests`)
if (failed > 0) process.exit(1)
