// src/services/segmentExclusionDryRun.test.js
// Run with: node src/services/segmentExclusionDryRun.test.js

import {
  matchRowToSegmentRecommendation,
  buildSegmentExclusionDryRun,
  buildSegmentExclusionImpactReport,
  buildDryRunExcludedSegments,
  buildSegmentExclusionDryRunSummary,
  evaluateSegmentExclusionDryRun,
} from './segmentExclusionDryRun.js'

let passed = 0, failed = 0

function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++ }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); failed++ }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRec(segment_key, segment_type = 'market') {
  return {
    recommendation: 'recommend_exclude',
    segment_type,
    segment_key,
    sample_size: 15,
    hit_rate: 0.3,
    edge_vs_break_even: -0.1,
  }
}

function makeRow(market, result_status, sport = null) {
  return { sport, market, result_status, bet_confidence_score: 0.6, odd: 1.8 }
}

// ── Test 1 — empty dry-run ────────────────────────────────────────────────────

test('Test 1 — empty dry-run: rows_evaluated is 0 on empty input', () => {
  const result = evaluateSegmentExclusionDryRun({})
  assert(result.segment_exclusion_dry_run.rows_evaluated === 0,
    `Expected rows_evaluated=0, got ${result.segment_exclusion_dry_run.rows_evaluated}`)
})

// ── Test 2 — match recommendation by market ───────────────────────────────────

test('Test 2 — matchRowToSegmentRecommendation matches by market', () => {
  const row = { market: 'player_props', result_status: 'green' }
  const rec = { recommendation: 'recommend_exclude', segment_type: 'market', segment_key: 'player_props' }
  const result = matchRowToSegmentRecommendation(row, rec)
  assert(result === true, `Expected true, got ${result}`)
})

// ── Test 3 — simulate excluded rows ──────────────────────────────────────────

test('Test 3 — excluded rows simulated, safety fields remain false', () => {
  const rows = [
    makeRow('bad_market', 'red'),
    makeRow('bad_market', 'red'),
    makeRow('bad_market', 'red'),
    makeRow('bad_market', 'green'),
    makeRow('bad_market', 'green'),
  ]
  const input = {
    resolved_rows: rows,
    segment_exclusion_recommendations: {
      recommendations: [makeRec('bad_market')],
    },
  }
  const result = evaluateSegmentExclusionDryRun(input)
  const dry = result.segment_exclusion_dry_run
  assert(dry.rows_would_be_excluded > 0,
    `Expected rows_would_be_excluded > 0, got ${dry.rows_would_be_excluded}`)
  assert(dry.exclusions_applied === false,
    `Expected exclusions_applied=false, got ${dry.exclusions_applied}`)
  assert(dry.real_filter_changed === false,
    `Expected real_filter_changed=false, got ${dry.real_filter_changed}`)
})

// ── Test 4 — impact improves hit rate ────────────────────────────────────────

test('Test 4 — impact_quality is improves_hit_rate when reds removed', () => {
  // 10 rows: 2 green, 8 red. Exclude segment with 6 reds, 0 greens.
  // After: 4 remain (2 green, 2 red). hit_rate 0.2 → 0.5
  const rows = [
    makeRow('bad_seg', 'red'),
    makeRow('bad_seg', 'red'),
    makeRow('bad_seg', 'red'),
    makeRow('bad_seg', 'red'),
    makeRow('bad_seg', 'red'),
    makeRow('bad_seg', 'red'),
    makeRow('other', 'red'),
    makeRow('other', 'red'),
    makeRow('other', 'green'),
    makeRow('other', 'green'),
  ]
  const input = {
    resolved_rows: rows,
    segment_exclusion_recommendations: {
      recommendations: [makeRec('bad_seg')],
    },
  }
  const result = evaluateSegmentExclusionDryRun(input)
  const report = result.segment_exclusion_impact_report
  assert(report.impact_quality === 'improves_hit_rate',
    `Expected improves_hit_rate, got ${report.impact_quality}`)
  assert(report.delta_hit_rate_simulated > 0,
    `Expected delta > 0, got ${report.delta_hit_rate_simulated}`)
})

// ── Test 5 — impact hurts hit rate ───────────────────────────────────────────

test('Test 5 — impact_quality is hurts_hit_rate when greens removed', () => {
  // 10 rows: 8 green, 2 red. Exclude segment with 6 greens, 0 reds.
  // After: 4 remain (2 green, 2 red). hit_rate goes down.
  const rows = [
    makeRow('good_seg', 'green'),
    makeRow('good_seg', 'green'),
    makeRow('good_seg', 'green'),
    makeRow('good_seg', 'green'),
    makeRow('good_seg', 'green'),
    makeRow('good_seg', 'green'),
    makeRow('other', 'green'),
    makeRow('other', 'green'),
    makeRow('other', 'red'),
    makeRow('other', 'red'),
  ]
  const input = {
    resolved_rows: rows,
    segment_exclusion_recommendations: {
      recommendations: [makeRec('good_seg')],
    },
  }
  const result = evaluateSegmentExclusionDryRun(input)
  const report = result.segment_exclusion_impact_report
  assert(report.impact_quality === 'hurts_hit_rate',
    `Expected hurts_hit_rate, got ${report.impact_quality}`)
})

// ── Test 6 — dry_run_excluded_segments populated ─────────────────────────────

test('Test 6 — dry_run_excluded_segments shows matched segment', () => {
  const rows = [
    makeRow('bad_market', 'red'),
    makeRow('bad_market', 'red'),
    makeRow('bad_market', 'red'),
    makeRow('bad_market', 'green'),
    makeRow('bad_market', 'green'),
  ]
  const input = {
    resolved_rows: rows,
    segment_exclusion_recommendations: {
      recommendations: [makeRec('bad_market')],
    },
  }
  const result = evaluateSegmentExclusionDryRun(input)
  const excl = result.dry_run_excluded_segments
  assert(excl.segments.length > 0,
    `Expected segments.length > 0, got ${excl.segments.length}`)
  assert(excl.segments[0].auto_applied === false,
    `Expected auto_applied=false, got ${excl.segments[0].auto_applied}`)
  assert(excl.segments[0].matched_rows_count > 0,
    `Expected matched_rows_count > 0, got ${excl.segments[0].matched_rows_count}`)
})

// ── Test 7 — unsafe auto_apply_exclusions sanitized ──────────────────────────

test('Test 7 — auto_apply_exclusions=true sanitized and triggers violation', () => {
  const input = { auto_apply_exclusions: true }
  const result = evaluateSegmentExclusionDryRun(input)
  const dry = result.segment_exclusion_dry_run
  assert(dry.auto_apply_exclusions === false,
    `Expected auto_apply_exclusions=false, got ${dry.auto_apply_exclusions}`)
  const hasViolationSignal =
    dry.status === 'critical_violation' ||
    (Array.isArray(dry.violations) && dry.violations.length > 0)
  assert(hasViolationSignal,
    `Expected critical_violation status or violations array, got status=${dry.status} violations=${JSON.stringify(dry.violations)}`)
})

// ── Test 8 — summary safe_to_beta and safe_to_sell always false ───────────────

test('Test 8 — summary safe_to_beta and safe_to_sell are always false', () => {
  const input = {
    resolved_rows: [makeRow('market_a', 'green')],
    segment_exclusion_recommendations: {
      recommendations: [],
    },
  }
  const result = evaluateSegmentExclusionDryRun(input)
  const summary = result.segment_exclusion_dry_run_summary
  assert(summary.safe_to_beta === false,
    `Expected safe_to_beta=false, got ${summary.safe_to_beta}`)
  assert(summary.safe_to_sell === false,
    `Expected safe_to_sell=false, got ${summary.safe_to_sell}`)
})

// ── Test 9 — output serializable ─────────────────────────────────────────────

test('Test 9 — full output is JSON-serializable', () => {
  const input = {
    resolved_rows: [
      makeRow('mkt1', 'green'),
      makeRow('mkt1', 'red'),
      makeRow('mkt2', 'green'),
    ],
    segment_exclusion_recommendations: {
      recommendations: [makeRec('mkt1'), makeRec('mkt2')],
    },
    segment_watchlist: { watchlist: [] },
    segment_break_even_matrix: { segments: [] },
    resolved_sample_audit: { status: 'ok' },
    first_real_quality_snapshot: { status: 'ok' },
    can_beta: true,
    can_sell: true,
    auto_apply_exclusions: false,
    exclusions_applied: false,
    real_filter_changed: false,
  }
  let threw = false
  try {
    JSON.stringify(evaluateSegmentExclusionDryRun(input))
  } catch (e) {
    threw = true
  }
  assert(!threw, 'JSON.stringify threw an error')
})

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
