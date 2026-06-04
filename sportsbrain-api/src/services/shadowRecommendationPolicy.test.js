import {
  evaluateShadowRecommendationPolicy,
  buildShadowPolicyEnforcement,
} from './shadowRecommendationPolicy.js'

let passed = 0, failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`✓ ${name}`)
    passed++
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`)
    failed++
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

// ─── Test 1 — policy active ──────────────────────────────────────────────────
test('policy active', () => {
  const result = evaluateShadowRecommendationPolicy({})
  assert(
    result.shadow_recommendation_policy.shadow_only === true,
    'shadow_only should be true'
  )
  assert(
    result.shadow_recommendation_policy.can_change_engine_now === false,
    'can_change_engine_now should be false'
  )
})

// ─── Test 2 — enforcement passes safe ────────────────────────────────────────
test('enforcement passes safe', () => {
  const result = evaluateShadowRecommendationPolicy({
    segment_exclusion_dry_run: {
      auto_apply_exclusions: false,
      exclusions_applied: false,
      real_filter_changed: false,
      status: 'simulated',
    },
    quality_reweight_proposal: {
      reweight_applied: false,
      engine_weights_changed: false,
      status: 'generated',
    },
    segment_recommendation_policy: {
      auto_apply_exclusions: false,
      manual_operator_review_required: true,
    },
  })
  assert(
    result.shadow_policy_enforcement.passed === true,
    'enforcement.passed should be true'
  )
  assert(
    result.shadow_policy_enforcement.failed_count === 0,
    'failed_count should be 0'
  )
})

// ─── Test 3 — detects auto_apply true ────────────────────────────────────────
test('detects auto_apply true', () => {
  const result = evaluateShadowRecommendationPolicy({
    segment_exclusion_dry_run: {
      auto_apply_exclusions: true,
      exclusions_applied: false,
      real_filter_changed: false,
    },
  })
  const check = result.shadow_policy_enforcement.checks.find(
    c => c.check === 'auto_apply_exclusions_false'
  )
  assert(check !== undefined, 'check auto_apply_exclusions_false not found')
  assert(check.passed === false, 'auto_apply_exclusions_false should be failed')
})

// ─── Test 4 — detects reweight applied ───────────────────────────────────────
test('detects reweight applied', () => {
  const result = evaluateShadowRecommendationPolicy({
    quality_reweight_proposal: {
      reweight_applied: true,
      engine_weights_changed: false,
    },
  })
  const check = result.shadow_policy_enforcement.checks.find(
    c => c.check === 'reweight_applied_false'
  )
  assert(check !== undefined, 'check reweight_applied_false not found')
  assert(check.passed === false, 'reweight_applied_false should be failed')
})

// ─── Test 5 — detects engine changed ─────────────────────────────────────────
test('detects engine changed', () => {
  const result = evaluateShadowRecommendationPolicy({
    quality_reweight_proposal: {
      reweight_applied: false,
      engine_weights_changed: true,
    },
  })
  const check = result.shadow_policy_enforcement.checks.find(
    c => c.check === 'engine_weights_changed_false'
  )
  assert(check !== undefined, 'check engine_weights_changed_false not found')
  assert(check.passed === false, 'engine_weights_changed_false should be failed')
})

// ─── Test 6 — audit entries ───────────────────────────────────────────────────
test('audit entries', () => {
  const result = evaluateShadowRecommendationPolicy({
    segment_exclusion_dry_run: { status: 'simulated' },
    quality_reweight_proposal: { status: 'generated' },
  })
  const entries = result.segment_policy_audit.entries
  assert(
    entries.some(e => e.event === 'dry_run_executed'),
    'missing dry_run_executed entry'
  )
  assert(
    entries.some(e => e.event === 'no_engine_change_confirmed'),
    'missing no_engine_change_confirmed entry'
  )
})

// ─── Test 7 — summary shadow only ────────────────────────────────────────────
test('summary shadow only', () => {
  const result = evaluateShadowRecommendationPolicy({
    segment_exclusion_dry_run: { status: 'simulated' },
    quality_reweight_proposal: { status: 'generated' },
  })
  const summary = result.p39_shadow_policy_summary
  assert(summary.status === 'shadow_only', `status should be shadow_only, got ${summary.status}`)
  assert(summary.safe_to_beta === false, 'safe_to_beta should be false')
  assert(summary.safe_to_sell === false, 'safe_to_sell should be false')
})

// ─── Test 8 — output serializable ────────────────────────────────────────────
test('output serializable', () => {
  let threw = false
  try {
    JSON.stringify(
      evaluateShadowRecommendationPolicy({
        segment_exclusion_dry_run: { status: 'simulated', auto_apply_exclusions: false },
        quality_reweight_proposal: { status: 'generated', reweight_applied: false },
        segment_recommendation_policy: { manual_operator_review_required: true },
      })
    )
  } catch (_e) {
    threw = true
  }
  assert(!threw, 'JSON.stringify should not throw')
})

// ─── Results ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
