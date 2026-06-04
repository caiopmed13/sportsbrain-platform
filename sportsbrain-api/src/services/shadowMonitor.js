/**
 * shadowMonitor.js
 * Pure functions + D1 async helpers for shadow data accumulation monitoring
 * and calibration reporting.
 *
 * Part of P3.8.1 Shadow Data Accumulation + Calibration Sprint.
 *
 * HARD SAFETY RULES (never break):
 *  - unknown result is NOT a loss — never count as red
 *  - void is NOT green or red
 *  - observation bets (training_eligible=0) are NOT valid
 *  - do NOT change any thresholds
 *  - do NOT enable real money betting
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_RESOLVED_VALID = 30
const ROI_FLOOR = -2            // roi < -2 fails requirement
const UNKNOWN_PCT_CEILING = 20  // > 20% fails
const MARKET_COVERAGE_FLOOR = 0.70
const SNAPSHOT_COVERAGE_FLOOR = 0.70

// ---------------------------------------------------------------------------
// computeMicroTestProgress
// ---------------------------------------------------------------------------

/**
 * Computes progress toward the micro-test readiness threshold.
 * REQUIRED_RESOLVED_VALID is 30 and MUST NOT be changed.
 *
 * @param {object|null} metrics
 * @returns {object}
 */
export function computeMicroTestProgress(metrics) {
  const rv = metrics?.resolved_valid ?? 0
  const roi = metrics?.roi_pct
  const unknownPct = metrics?.unknown_pct_valid ?? null
  const marketCoverage = metrics?.market_avail_coverage_pct ?? null
  const snapshotCoverage = metrics?.snapshot_coverage_pct ?? null

  const missing_resolved_valid = Math.max(0, REQUIRED_RESOLVED_VALID - rv)
  const raw_progress = (rv / REQUIRED_RESOLVED_VALID) * 100
  const sample_progress_pct = +Math.min(100, raw_progress).toFixed(1)

  // roi_requirement_met: null/undefined = pass; only fails if roi < -2
  const roi_requirement_met = (roi === null || roi === undefined || roi >= ROI_FLOOR)

  // unknown_requirement_met: null = pass
  const unknown_requirement_met = (unknownPct === null || unknownPct <= UNKNOWN_PCT_CEILING)

  // market_coverage_requirement_met: null = pass
  const market_coverage_requirement_met = (marketCoverage === null || marketCoverage >= MARKET_COVERAGE_FLOOR)

  // odds_snapshot_requirement_met: null = pass
  const odds_snapshot_requirement_met = (snapshotCoverage === null || snapshotCoverage >= SNAPSHOT_COVERAGE_FLOOR)

  // can_micro_test: sample threshold AND roi requirement
  const can_micro_test = (rv >= REQUIRED_RESOLVED_VALID && roi_requirement_met)

  return {
    required_resolved_valid: REQUIRED_RESOLVED_VALID,
    current_resolved_valid: rv,
    missing_resolved_valid,
    sample_progress_pct,
    roi_requirement_met,
    unknown_requirement_met,
    market_coverage_requirement_met,
    odds_snapshot_requirement_met,
    can_micro_test,
    critical_bugs_clear: true,
  }
}

// ---------------------------------------------------------------------------
// computeCalibrationDebug
// ---------------------------------------------------------------------------

/**
 * Summarizes bet confidence tier distribution and score range for calibration.
 *
 * @param {Array<{bet_confidence_tier: string, count: number, avg_score: number, min_score: number, max_score: number}>} tierData
 * @param {{ min_score: number|null, max_score: number|null, avg_score: number|null, total: number }} scoreMetrics
 * @returns {object}
 */
export function computeCalibrationDebug(tierData, scoreMetrics) {
  const { min_score, max_score, avg_score, total } = scoreMetrics ?? {}

  // Build tier distribution
  const tier_distribution = {
    no_bet: 0,
    lab_only: 0,
    micro_test: 0,
    valid_bet: 0,
    premium_bet: 0,
  }

  for (const row of (tierData ?? [])) {
    const tier = row.bet_confidence_tier
    if (tier in tier_distribution) {
      tier_distribution[tier] += row.count ?? 0
    }
  }

  // Score distribution
  const score_distribution = {
    min: min_score ?? null,
    max: max_score ?? null,
    avg: avg_score != null ? +Number(avg_score).toFixed(1) : null,
    count: total ?? 0,
  }

  // Recommendation logic
  let recommendation
  const effectiveTotal = total ?? 0
  if (effectiveTotal === 0) {
    recommendation = 'investigate_pipeline'
  } else if (tier_distribution.valid_bet > 0 || tier_distribution.premium_bet > 0) {
    recommendation = 'review_thresholds_later'
  } else {
    recommendation = 'continue_accumulation'
  }

  // Top blockers
  const top_blockers = []
  const hasNoValidOrPremium = tier_distribution.valid_bet === 0 && tier_distribution.premium_bet === 0
  if (tier_distribution.no_bet > 0 && hasNoValidOrPremium) {
    top_blockers.push(`no_bet dominant (${tier_distribution.no_bet}): clv_unknown likely high — resolve more bets`)
  }

  return {
    score_distribution,
    tier_distribution,
    top_blockers,
    recommendation,
  }
}

// ---------------------------------------------------------------------------
// computeResolutionHealth
// ---------------------------------------------------------------------------

/**
 * Computes resolution health metrics.
 *
 * CRITICAL SAFETY RULE:
 *   unknown = resolved - green - red  (NEVER added to red)
 *   void is SEPARATE from green/red/unknown
 *
 * @param {object|null} metrics
 * @returns {object}
 */
export function computeResolutionHealth(metrics) {
  if (metrics == null) {
    return {
      pending: 0,
      resolved: 0,
      green: 0,
      red: 0,
      void: 0,
      unknown: 0,
      unknown_pct: 0,
      avg_settlement_delay_hours: null,
      warnings: [],
    }
  }

  const resolved = metrics.resolved_valid ?? 0
  const green = metrics.valid_wins ?? 0
  const red = metrics.valid_losses ?? 0
  const void_count = metrics.void_count ?? 0
  const pending = metrics.pending_valid ?? 0

  // CRITICAL: unknown is NOT a loss, NOT counted as red
  const unknown = Math.max(0, resolved - green - red)

  const unknown_pct = resolved > 0 ? +(unknown / resolved * 100).toFixed(1) : 0

  // avg_settlement_delay_hours: round to 1dp, preserve null
  const rawHours = metrics.avg_settlement_hours
  const avg_settlement_delay_hours = rawHours != null ? +Number(rawHours).toFixed(1) : null

  // Warnings
  const warnings = []
  if (unknown_pct > 30 && resolved > 5) {
    warnings.push(`high unknown rate: ${unknown_pct}% of resolved bets have unknown result`)
  }
  if (resolved === 0 && pending > 20) {
    warnings.push(`no resolved bets yet, ${pending} still pending`)
  }

  return {
    pending,
    resolved,
    green,
    red,
    void: void_count,
    unknown,
    unknown_pct,
    avg_settlement_delay_hours,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// generatePipelineWarnings
// ---------------------------------------------------------------------------

/**
 * Generates pipeline health warnings based on recency and distribution metrics.
 *
 * @param {object} metrics
 * @param {string} nowIso — ISO timestamp string for "now" (injectable for testing)
 * @returns {string[]}
 */
export function generatePipelineWarnings(metrics, nowIso) {
  const warnings = []
  const now = new Date(nowIso)

  const lastCreatedStr = metrics?.shadow_last_created_at
  const lastCreated = lastCreatedStr ? new Date(lastCreatedStr) : null

  const lastSnapshotStr = metrics?.snapshots_last_seen_at
  const lastSnapshot = lastSnapshotStr ? new Date(lastSnapshotStr) : null

  const total = metrics?.total ?? 0
  const unknownPctValid = metrics?.unknown_pct_valid ?? null
  const tierValidBet = metrics?.tier_valid_bet ?? null
  const tierPremiumBet = metrics?.tier_premium_bet ?? null
  const tierNoBet = metrics?.tier_no_bet ?? null

  // shadow_bets_not_growing: no bets in 24h or no bets at all
  if (!lastCreated || (now - lastCreated) > 24 * 3600 * 1000) {
    warnings.push('shadow_bets_not_growing: no new shadow bets in the last 24h')
  }

  // odds_snapshots_not_growing: no snapshots in 2h
  if (!lastSnapshot || (now - lastSnapshot) > 2 * 3600 * 1000) {
    warnings.push('odds_snapshots_not_growing: no new odds snapshots in the last 2h')
  }

  // all_picks_no_bet: total > 10 and no valid or premium bets
  // treat null the same as 0 (null = absent = no valid bets)
  if (total > 10) {
    if ((tierValidBet ?? 0) === 0 && (tierPremiumBet ?? 0) === 0) {
      warnings.push('all_picks_no_bet: all picks are no_bet tier, model may not be generating valid bets')
    }
  }

  // high_unknown_rate: > 80% unknown
  if (unknownPctValid !== null && unknownPctValid > 80) {
    warnings.push(`high_unknown_rate: ${unknownPctValid}% of valid bets have unknown result`)
  }

  return warnings
}

// ---------------------------------------------------------------------------
// generateDailyReport
// ---------------------------------------------------------------------------

/**
 * Generates a plain-text daily readiness report (PT-BR).
 *
 * @param {object} report — full report object from buildShadowMonitorReport
 * @returns {string}
 */
export function generateDailyReport(report) {
  const {
    generated_at,
    period_days,
    readiness,
    accumulation,
    performance,
    clv,
    pipeline_warnings,
  } = report

  const date = generated_at ? generated_at.slice(0, 10) : 'N/A'
  const status = readiness?.status ?? 'unknown'
  const score = readiness?.score ?? 0
  const canMicro = readiness?.can_micro_test ? 'SIM' : 'NÃO'
  const resolvedValid = accumulation?.resolved_valid ?? 0
  const missingToMicro = accumulation?.missing_to_micro_test ?? (30 - resolvedValid)
  const roiPct = performance?.roi_valid_only != null ? performance.roi_valid_only.toFixed(1) + '%' : 'N/A'
  const unknownPct = performance?.unknown_pct_valid != null ? performance.unknown_pct_valid.toFixed(1) + '%' : 'N/A'
  const clvKnownPct = clv?.clv_known_pct != null ? (clv.clv_known_pct * 100).toFixed(1) + '%' : 'N/A'
  const posCLV = clv?.positive_clv_rate != null ? (clv.positive_clv_rate * 100).toFixed(1) + '%' : 'N/A'
  const warnings = pipeline_warnings ?? []

  const lines = [
    '=====================================',
    'SportsBrain Daily Readiness Report',
    `Data: ${date}`,
    `Período: últimos ${period_days ?? '?'} dias`,
    '-------------------------------------',
    `Status: ${status}`,
    `Score de Prontidão: ${score}/100`,
    `Pode fazer Micro-Test: ${canMicro}`,
    '-------------------------------------',
    'ACUMULAÇÃO',
    `  Picks válidos resolvidos: ${resolvedValid}`,
    `  Faltam ${missingToMicro} picks para atingir Micro-Test`,
    '-------------------------------------',
    'PERFORMANCE',
    `  ROI (válidos): ${roiPct}`,
    `  Taxa unknown: ${unknownPct}`,
    '-------------------------------------',
    'CLV (Closing Line Value)',
    `  Cobertura CLV conhecida: ${clvKnownPct}`,
    `  Taxa CLV positivo: ${posCLV}`,
    '-------------------------------------',
  ]

  if (warnings.length > 0) {
    lines.push('AVISOS DE PIPELINE')
    for (const w of warnings) {
      lines.push(`  ⚠ ${w}`)
    }
    lines.push('-------------------------------------')
  }

  lines.push('AVISO DE SEGURANÇA')
  lines.push('  Simulated only — not real money.')
  lines.push('  Apostas envolvem risco. O SportsBrain não garante lucro.')
  lines.push('  Shadow Betting é simulação, não resultado financeiro real.')
  lines.push('=====================================')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// queryBuildMonitorData (async, D1)
// ---------------------------------------------------------------------------

/**
 * Queries D1 for all shadow monitor metrics in a single batch.
 * Returns null if env.SB_DB is not available.
 *
 * @param {object} env — Cloudflare Workers env with SB_DB binding
 * @param {number} days — lookback window (default 7)
 * @returns {Promise<object|null>}
 */
export async function queryBuildMonitorData(env, days = 7) {
  if (!env?.SB_DB) return null

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // 5-query D1 batch
    const [
      accumResult,
      tierResult,
      clvResult,
      coverageResult,
      snapshotResult,
    ] = await env.SB_DB.batch([

      // 1. Accumulation stats (training_eligible=1 = valid/main bets)
      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) as total_valid,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'resolved' THEN 1 ELSE 0 END) as resolved_valid,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'pending' THEN 1 ELSE 0 END) as pending_valid,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'resolved' AND profit_brl > 0 THEN 1 ELSE 0 END) as valid_wins,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'resolved' AND profit_brl < 0 THEN 1 ELSE 0 END) as valid_losses,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'void' THEN 1 ELSE 0 END) as void_count,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'resolved' THEN profit_brl ELSE 0 END) as profit_valid,
          SUM(CASE WHEN training_eligible = 1 THEN stake_simulated ELSE 0 END) as staked_valid,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'resolved' AND result_source IS NULL THEN 1 ELSE 0 END) as unknown_result_count,
          AVG(CASE WHEN training_eligible = 1 AND settled_at IS NOT NULL AND created_at IS NOT NULL
              THEN (julianday(settled_at) - julianday(created_at)) * 24 ELSE NULL END) as avg_settlement_hours,
          MAX(created_at) as shadow_last_created_at,
          COUNT(DISTINCT DATE(created_at)) as days_with_data
        FROM shadow_bets
        WHERE created_at >= ?
      `).bind(since),

      // 2. Tier distribution
      env.SB_DB.prepare(`
        SELECT
          bet_confidence_tier,
          COUNT(*) as count,
          AVG(bet_confidence_score) as avg_score,
          MIN(bet_confidence_score) as min_score,
          MAX(bet_confidence_score) as max_score
        FROM shadow_bets
        WHERE created_at >= ? AND training_eligible = 1
        GROUP BY bet_confidence_tier
      `).bind(since),

      // 3. CLV stats
      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as clv_total,
          SUM(CASE WHEN clv_status != 'unknown' THEN 1 ELSE 0 END) as clv_known,
          SUM(CASE WHEN clv_status = 'positive_clv' THEN 1 ELSE 0 END) as positive_clv,
          SUM(CASE WHEN clv_status = 'unknown' THEN 1 ELSE 0 END) as clv_unknown_count,
          AVG(CASE WHEN clv_pct IS NOT NULL THEN clv_pct ELSE NULL END) as avg_clv_pct
        FROM shadow_bets
        WHERE created_at >= ? AND training_eligible = 1
      `).bind(since),

      // 4. Coverage stats (market_available, snapshot presence)
      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total_coverage,
          SUM(CASE WHEN market_available = 1 THEN 1 ELSE 0 END) as market_avail_yes,
          SUM(CASE WHEN odds_snapshot_id IS NOT NULL THEN 1 ELSE 0 END) as has_snapshot
        FROM shadow_bets
        WHERE created_at >= ? AND training_eligible = 1
      `).bind(since),

      // 5. Latest snapshot
      env.SB_DB.prepare(`
        SELECT
          MAX(captured_at) as last_snapshot_at,
          COUNT(*) as snapshot_count
        FROM market_odds_snapshots
        WHERE created_at >= ?
      `).bind(since),
    ])

    const a = accumResult.results[0] ?? {}
    const tierRows = tierResult.results ?? []
    const c = clvResult.results[0] ?? {}
    const cov = coverageResult.results[0] ?? {}
    const snap = snapshotResult.results[0] ?? {}

    // Derived metrics
    const staked_valid = a.staked_valid ?? 0
    const profit_valid = a.profit_valid ?? null
    const resolved_valid = a.resolved_valid ?? 0
    const total_valid = a.total_valid ?? 0

    const roi_pct = (staked_valid > 0 && profit_valid !== null)
      ? (profit_valid / staked_valid) * 100
      : null

    const clv_total = c.clv_total ?? 0
    const clv_known = c.clv_known ?? 0
    const positive_clv = c.positive_clv ?? 0

    const clv_known_pct = clv_total > 0 ? clv_known / clv_total : null
    const positive_clv_rate = clv_known > 0 ? positive_clv / clv_known : null

    // unknown = resolved - wins - losses (NEVER = losses+unknown)
    const valid_wins = a.valid_wins ?? 0
    const valid_losses = a.valid_losses ?? 0
    const unknown_result_count = Math.max(0, resolved_valid - valid_wins - valid_losses)
    const unknown_pct_valid = resolved_valid > 0 ? (unknown_result_count / resolved_valid) * 100 : null

    // Coverage percentages
    const total_coverage = cov.total_coverage ?? 0
    const market_avail_pct = total_coverage > 0 ? cov.market_avail_yes / total_coverage : null
    const snapshot_coverage_pct = total_coverage > 0 ? cov.has_snapshot / total_coverage : null

    // Score metrics for calibration
    const scoreMetrics = {
      min_score: null,
      max_score: null,
      avg_score: null,
      total: total_valid,
    }
    // Aggregate from tier rows
    if (tierRows.length > 0) {
      const allMin = tierRows.map(r => r.min_score).filter(v => v != null)
      const allMax = tierRows.map(r => r.max_score).filter(v => v != null)
      if (allMin.length) scoreMetrics.min_score = Math.min(...allMin)
      if (allMax.length) scoreMetrics.max_score = Math.max(...allMax)
      const totalWithScore = tierRows.reduce((s, r) => s + (r.count ?? 0), 0)
      if (totalWithScore > 0) {
        const weightedSum = tierRows.reduce((s, r) => s + (r.avg_score ?? 0) * (r.count ?? 0), 0)
        scoreMetrics.avg_score = weightedSum / totalWithScore
      }
    }

    // Tier counts for warnings
    const tierMap = {}
    for (const row of tierRows) {
      tierMap[row.bet_confidence_tier] = row.count ?? 0
    }

    return {
      total: a.total ?? 0,
      total_valid,
      resolved_valid,
      pending_valid: a.pending_valid ?? 0,
      valid_wins,
      valid_losses,
      void_count: a.void_count ?? 0,
      profit_valid,
      staked_valid,
      unknown_result_count,
      unknown_pct_valid,
      avg_settlement_hours: a.avg_settlement_hours ?? null,
      shadow_last_created_at: a.shadow_last_created_at ?? null,
      days_with_data: a.days_with_data ?? 0,
      roi_pct,
      clv_known_pct,
      positive_clv_rate,
      clv_unknown_count: c.clv_unknown_count ?? 0,
      avg_clv_pct: c.avg_clv_pct ?? null,
      market_avail_coverage_pct: market_avail_pct,
      snapshot_coverage_pct,
      snapshots_last_seen_at: snap.last_snapshot_at ?? null,
      snapshot_count: snap.snapshot_count ?? 0,
      tier_no_bet: tierMap['no_bet'] ?? 0,
      tier_lab_only: tierMap['lab_only'] ?? 0,
      tier_micro_test: tierMap['micro_test'] ?? 0,
      tier_valid_bet: tierMap['valid_bet'] ?? 0,
      tier_premium_bet: tierMap['premium_bet'] ?? 0,
      tierRows,
      scoreMetrics,
    }
  } catch (err) {
    console.error('[shadowMonitor] queryBuildMonitorData error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// buildShadowMonitorReport (async)
// ---------------------------------------------------------------------------

/**
 * Builds the full shadow monitor report by querying D1 and running all
 * pure-function analyses.
 *
 * @param {object} env — Cloudflare Workers env
 * @param {number} days — lookback window (default 7)
 * @returns {Promise<object>}
 */
export async function buildShadowMonitorReport(env, days = 7) {
  const metrics = await queryBuildMonitorData(env, days)

  // Dynamic import to avoid circular dependency issues
  const { computeBetaReadinessScore, getBankrollTestConfig } = await import('./betaReadiness.js')

  // Map to betaReadiness shape
  const readinessInput = metrics
    ? {
        resolved_valid: metrics.resolved_valid,
        roi_pct: metrics.roi_pct,
        clv_known_pct: metrics.clv_known_pct,
        positive_clv_rate: metrics.positive_clv_rate,
        unknown_pct_valid: metrics.unknown_pct_valid,
        audit_coverage_pct: null, // not in shadow monitor scope
        market_coverage_pct: metrics.market_avail_coverage_pct,
        has_bankroll_config: true,
        no_losses_yet: (metrics.valid_losses ?? 0) === 0,
        days_with_data: metrics.days_with_data,
      }
    : null

  const readiness = computeBetaReadinessScore(readinessInput)
  const bankroll_config = getBankrollTestConfig()

  // Pure function analyses
  const micro_test_progress = computeMicroTestProgress(metrics)
  const calibration_debug = computeCalibrationDebug(
    metrics?.tierRows ?? [],
    metrics?.scoreMetrics ?? { min_score: null, max_score: null, avg_score: null, total: 0 }
  )
  const resolution_health = computeResolutionHealth(metrics)
  const pipeline_warnings = generatePipelineWarnings(metrics ?? {}, new Date().toISOString())

  const generated_at = new Date().toISOString()

  return {
    generated_at,
    period_days: days,
    note: 'Simulated only — not real money',
    safety_disclaimer: 'Apostas envolvem risco. O SportsBrain não garante lucro.',
    readiness: {
      score: readiness.score,
      status: readiness.status,
      can_micro_test: readiness.can_micro_test,
      can_beta: readiness.can_beta,
      can_sell: readiness.can_sell,
      components: readiness.components,
    },
    accumulation: {
      total: metrics?.total ?? 0,
      total_valid: metrics?.total_valid ?? 0,
      resolved_valid: metrics?.resolved_valid ?? 0,
      pending_valid: metrics?.pending_valid ?? 0,
      missing_to_micro_test: micro_test_progress.missing_resolved_valid,
      days_with_data: metrics?.days_with_data ?? 0,
      shadow_last_created_at: metrics?.shadow_last_created_at ?? null,
    },
    performance: {
      roi_valid_only: metrics?.roi_pct ?? null,
      valid_wins: metrics?.valid_wins ?? 0,
      valid_losses: metrics?.valid_losses ?? 0,
      void_count: metrics?.void_count ?? 0,
      unknown_result_count: metrics?.unknown_result_count ?? 0,
      unknown_pct_valid: metrics?.unknown_pct_valid ?? null,
      profit_valid: metrics?.profit_valid ?? null,
      staked_valid: metrics?.staked_valid ?? 0,
    },
    clv: {
      clv_known_pct: metrics?.clv_known_pct ?? null,
      positive_clv_rate: metrics?.positive_clv_rate ?? null,
      clv_unknown_count: metrics?.clv_unknown_count ?? 0,
      avg_clv_pct: metrics?.avg_clv_pct ?? null,
    },
    coverage: {
      market_avail_coverage_pct: metrics?.market_avail_coverage_pct ?? null,
      snapshot_coverage_pct: metrics?.snapshot_coverage_pct ?? null,
      snapshots_last_seen_at: metrics?.snapshots_last_seen_at ?? null,
      snapshot_count: metrics?.snapshot_count ?? 0,
    },
    health: {
      avg_settlement_hours: metrics?.avg_settlement_hours ?? null,
    },
    micro_test_progress,
    calibration_debug,
    resolution_health,
    pipeline_warnings,
    bankroll_config,
  }
}
