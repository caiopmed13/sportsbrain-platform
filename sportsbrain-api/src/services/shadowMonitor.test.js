// shadowMonitor.test.js
import assert from 'node:assert/strict'
import {
  computeMicroTestProgress,
  computeCalibrationDebug,
  computeResolutionHealth,
  generatePipelineWarnings,
  generateDailyReport,
} from './shadowMonitor.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`)
    failed++
  }
}

// ─── computeMicroTestProgress ──────────────────────────────────────────────

console.log('\n--- computeMicroTestProgress ---')

test('null metrics → missing=30, can_micro_test=false', () => {
  const r = computeMicroTestProgress(null)
  assert.equal(r.required_resolved_valid, 30)
  assert.equal(r.current_resolved_valid, 0)
  assert.equal(r.missing_resolved_valid, 30)
  assert.equal(r.sample_progress_pct, 0)
  assert.equal(r.can_micro_test, false)
})

test('resolved_valid=0 → missing=30, progress=0', () => {
  const r = computeMicroTestProgress({ resolved_valid: 0 })
  assert.equal(r.missing_resolved_valid, 30)
  assert.equal(r.sample_progress_pct, 0)
})

test('resolved_valid=15 → missing=15, progress=50', () => {
  const r = computeMicroTestProgress({ resolved_valid: 15 })
  assert.equal(r.missing_resolved_valid, 15)
  assert.equal(r.sample_progress_pct, 50)
})

test('resolved_valid=30, roi_pct=null → can_micro_test=true', () => {
  const r = computeMicroTestProgress({ resolved_valid: 30, roi_pct: null })
  assert.equal(r.missing_resolved_valid, 0)
  assert.equal(r.sample_progress_pct, 100)
  assert.equal(r.can_micro_test, true)
  assert.equal(r.roi_requirement_met, true)
})

test('resolved_valid=30, roi_pct=-2 → can_micro_test=true', () => {
  const r = computeMicroTestProgress({ resolved_valid: 30, roi_pct: -2 })
  assert.equal(r.can_micro_test, true)
  assert.equal(r.roi_requirement_met, true)
})

test('resolved_valid=30, roi_pct=-5 → can_micro_test=false, roi_req=false', () => {
  const r = computeMicroTestProgress({ resolved_valid: 30, roi_pct: -5 })
  assert.equal(r.can_micro_test, false)
  assert.equal(r.roi_requirement_met, false)
})

test('resolved_valid=29 → can_micro_test=false even with good roi', () => {
  const r = computeMicroTestProgress({ resolved_valid: 29, roi_pct: 10 })
  assert.equal(r.can_micro_test, false)
  assert.equal(r.missing_resolved_valid, 1)
})

test('resolved_valid=50 → progress capped at 100', () => {
  const r = computeMicroTestProgress({ resolved_valid: 50 })
  assert.equal(r.sample_progress_pct, 100)
})

test('unknown_pct_valid=25 → unknown_requirement_met=false (>20%)', () => {
  const r = computeMicroTestProgress({ resolved_valid: 30, unknown_pct_valid: 25 })
  assert.equal(r.unknown_requirement_met, false)
})

test('unknown_pct_valid=20 → unknown_requirement_met=true (=20%)', () => {
  const r = computeMicroTestProgress({ resolved_valid: 30, unknown_pct_valid: 20 })
  assert.equal(r.unknown_requirement_met, true)
})

test('market_avail_coverage_pct=0.65 → market_coverage_requirement_met=false (<70%)', () => {
  const r = computeMicroTestProgress({ market_avail_coverage_pct: 0.65 })
  assert.equal(r.market_coverage_requirement_met, false)
})

test('market_avail_coverage_pct=null → market_coverage_requirement_met=true (unknown=pass)', () => {
  const r = computeMicroTestProgress({ market_avail_coverage_pct: null })
  assert.equal(r.market_coverage_requirement_met, true)
})

// ─── computeCalibrationDebug ───────────────────────────────────────────────

console.log('\n--- computeCalibrationDebug ---')

test('empty tier data → all tiers 0, recommendation=investigate_pipeline', () => {
  const r = computeCalibrationDebug([], { min_score: null, max_score: null, avg_score: null, total: 0 })
  assert.equal(r.tier_distribution.no_bet, 0)
  assert.equal(r.tier_distribution.valid_bet, 0)
  assert.equal(r.recommendation, 'investigate_pipeline')
})

test('all no_bet → recommendation=continue_accumulation', () => {
  const tierData = [{ bet_confidence_tier: 'no_bet', count: 50, avg_score: 12, min_score: 10, max_score: 15 }]
  const r = computeCalibrationDebug(tierData, { min_score: 10, max_score: 15, avg_score: 12, total: 50 })
  assert.equal(r.tier_distribution.no_bet, 50)
  assert.equal(r.recommendation, 'continue_accumulation')
})

test('some valid_bet → recommendation=review_thresholds_later', () => {
  const tierData = [
    { bet_confidence_tier: 'no_bet', count: 40, avg_score: 12, min_score: 10, max_score: 15 },
    { bet_confidence_tier: 'valid_bet', count: 10, avg_score: 65, min_score: 60, max_score: 72 },
  ]
  const r = computeCalibrationDebug(tierData, { min_score: 10, max_score: 72, avg_score: 22, total: 50 })
  assert.equal(r.tier_distribution.valid_bet, 10)
  assert.equal(r.recommendation, 'review_thresholds_later')
})

test('score_distribution uses provided min/max/avg', () => {
  const r = computeCalibrationDebug([], { min_score: 5, max_score: 95, avg_score: 32.7, total: 100 })
  assert.equal(r.score_distribution.min, 5)
  assert.equal(r.score_distribution.max, 95)
  assert.equal(r.score_distribution.avg, 32.7)
  assert.equal(r.score_distribution.count, 100)
})

test('top_blockers: no_bet dominant → includes clv_unknown blocker', () => {
  const tierData = [{ bet_confidence_tier: 'no_bet', count: 100, avg_score: 12, min_score: 10, max_score: 15 }]
  const r = computeCalibrationDebug(tierData, { min_score: 10, max_score: 15, avg_score: 12, total: 100 })
  assert.ok(r.top_blockers.length > 0)
  assert.ok(r.top_blockers.some(b => b.includes('no_bet') || b.includes('clv')))
})

// ─── computeResolutionHealth ───────────────────────────────────────────────

console.log('\n--- computeResolutionHealth ---')

test('null metrics → all zeros, no warnings', () => {
  const r = computeResolutionHealth(null)
  assert.equal(r.pending, 0)
  assert.equal(r.resolved, 0)
  assert.equal(r.green, 0)
  assert.equal(r.red, 0)
  assert.equal(r.void, 0)
  assert.equal(r.unknown, 0)
  assert.ok(Array.isArray(r.warnings))
})

test('CRITICAL: unknown is NOT counted as red', () => {
  // resolved=10, wins=3, losses=5 → unknown=2, not added to red
  const r = computeResolutionHealth({
    resolved_valid: 10,
    valid_wins: 3,
    valid_losses: 5,
    void_count: 0,
    pending_valid: 0,
  })
  assert.equal(r.green, 3)
  assert.equal(r.red, 5)
  assert.equal(r.unknown, 2)  // 10 - 3 - 5 = 2 not classified
  assert.equal(r.red, 5)      // red stays 5, not 7
})

test('void count is separate from green/red', () => {
  const r = computeResolutionHealth({
    resolved_valid: 8,
    valid_wins: 4,
    valid_losses: 3,
    void_count: 2,
    pending_valid: 5,
  })
  assert.equal(r.void, 2)
  assert.equal(r.green, 4)
  assert.equal(r.red, 3)
  assert.equal(r.pending, 5)
})

test('avg_settlement_delay_hours from metrics', () => {
  const r = computeResolutionHealth({ avg_settlement_hours: 14.567 })
  assert.equal(r.avg_settlement_delay_hours, 14.6)  // rounded to 1dp
})

test('unknown_pct = unknown / resolved when resolved > 0', () => {
  const r = computeResolutionHealth({
    resolved_valid: 10,
    valid_wins: 6,
    valid_losses: 2,
    void_count: 0,
  })
  // unknown = 10 - 6 - 2 = 2
  assert.equal(r.unknown, 2)
  assert.equal(r.unknown_pct, 20)  // 2/10 * 100
})

test('warning fires if >30% unknown rate', () => {
  const r = computeResolutionHealth({
    resolved_valid: 10,
    valid_wins: 2,
    valid_losses: 2,
    void_count: 0,
  })
  // unknown = 6 out of 10 = 60%
  assert.ok(r.warnings.some(w => w.includes('unknown')))
})

// ─── generatePipelineWarnings ──────────────────────────────────────────────

console.log('\n--- generatePipelineWarnings ---')

const NOW = '2026-05-12T15:00:00.000Z'

test('no warnings on healthy recent data', () => {
  const metrics = {
    shadow_last_created_at: '2026-05-12T14:00:00.000Z',  // 1h ago
    snapshots_last_seen_at: '2026-05-12T14:30:00.000Z',  // 30min ago
    total: 50,
    resolved_valid: 5,
    unknown_pct_valid: 10,
    tier_no_bet: 30,
    tier_valid_bet: 5,
  }
  const warnings = generatePipelineWarnings(metrics, NOW)
  assert.equal(warnings.length, 0)
})

test('shadow_bets_not_growing: no bets in 24h', () => {
  const metrics = {
    shadow_last_created_at: '2026-05-11T10:00:00.000Z',  // >24h ago
    total: 5,
  }
  const warnings = generatePipelineWarnings(metrics, NOW)
  assert.ok(warnings.some(w => w.includes('shadow_bets_not_growing')))
})

test('shadow_bets_not_growing: null last_created fires warning', () => {
  const warnings = generatePipelineWarnings({ shadow_last_created_at: null, total: 0 }, NOW)
  assert.ok(warnings.some(w => w.includes('shadow_bets_not_growing')))
})

test('odds_snapshots_not_growing: no snapshots in 2h', () => {
  const metrics = {
    shadow_last_created_at: '2026-05-12T14:50:00.000Z',
    snapshots_last_seen_at: '2026-05-12T10:00:00.000Z',  // >2h ago
  }
  const warnings = generatePipelineWarnings(metrics, NOW)
  assert.ok(warnings.some(w => w.includes('odds_snapshots_not_growing')))
})

test('high_unknown_rate: >80% fires warning', () => {
  const metrics = {
    shadow_last_created_at: NOW,
    snapshots_last_seen_at: NOW,
    total: 50,
    unknown_pct_valid: 85,
  }
  const warnings = generatePipelineWarnings(metrics, NOW)
  assert.ok(warnings.some(w => w.includes('high_unknown_rate')))
})

test('all_picks_no_bet: total>10 and no valid/premium', () => {
  const metrics = {
    shadow_last_created_at: NOW,
    snapshots_last_seen_at: NOW,
    total: 20,
    tier_no_bet: 20,
    tier_valid_bet: 0,
    tier_premium_bet: 0,
  }
  const warnings = generatePipelineWarnings(metrics, NOW)
  assert.ok(warnings.some(w => w.includes('all_picks_no_bet')))
})

test('no all_picks_no_bet warning when total <= 10 (too early)', () => {
  const metrics = {
    shadow_last_created_at: NOW,
    total: 5,
    tier_no_bet: 5,
    tier_valid_bet: 0,
  }
  const warnings = generatePipelineWarnings(metrics, NOW)
  assert.ok(!warnings.some(w => w.includes('all_picks_no_bet')))
})

// ─── generateDailyReport ──────────────────────────────────────────────────

console.log('\n--- generateDailyReport ---')

test('returns a non-empty string', () => {
  const report = {
    generated_at: NOW,
    period_days: 7,
    readiness: { score: 24, status: 'not_ready', can_micro_test: false },
    accumulation: { resolved_valid: 3, missing_to_micro_test: 27 },
    performance: { roi_valid_only: null, unknown_pct_valid: null },
    clv: { clv_known_pct: 0, positive_clv_rate: null },
    pipeline_warnings: [],
  }
  const text = generateDailyReport(report)
  assert.ok(typeof text === 'string')
  assert.ok(text.length > 50)
})

test('report contains readiness status', () => {
  const report = {
    generated_at: NOW,
    period_days: 7,
    readiness: { score: 24, status: 'not_ready', can_micro_test: false },
    accumulation: { resolved_valid: 3, missing_to_micro_test: 27 },
    performance: { roi_valid_only: null, unknown_pct_valid: null },
    clv: { clv_known_pct: 0, positive_clv_rate: null },
    pipeline_warnings: [],
  }
  const text = generateDailyReport(report)
  assert.ok(text.includes('not_ready') || text.includes('Not Ready'))
})

test('report contains missing count', () => {
  const report = {
    generated_at: NOW,
    period_days: 7,
    readiness: { score: 24, status: 'not_ready', can_micro_test: false },
    accumulation: { resolved_valid: 3, missing_to_micro_test: 27 },
    performance: { roi_valid_only: null, unknown_pct_valid: null },
    clv: { clv_known_pct: 0, positive_clv_rate: null },
    pipeline_warnings: [],
  }
  const text = generateDailyReport(report)
  assert.ok(text.includes('27'))
})

test('report contains safety disclaimer', () => {
  const report = {
    generated_at: NOW,
    period_days: 7,
    readiness: { score: 24, status: 'not_ready', can_micro_test: false },
    accumulation: { resolved_valid: 3, missing_to_micro_test: 27 },
    performance: { roi_valid_only: null, unknown_pct_valid: null },
    clv: { clv_known_pct: 0, positive_clv_rate: null },
    pipeline_warnings: ['shadow_bets_not_growing: no bets in 24h'],
  }
  const text = generateDailyReport(report)
  assert.ok(text.includes('Simulated only') || text.includes('simulação') || text.includes('risco'))
})

// ─── Summary ─────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
