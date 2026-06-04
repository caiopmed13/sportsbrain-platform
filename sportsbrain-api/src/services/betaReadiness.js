/**
 * betaReadiness.js
 * Pure functions for Beta Readiness scoring, gates, and bankroll safety.
 * Part of P3.8 Beta Readiness plan.
 *
 * Safety rules (hard):
 *  - CLV unknown MUST score 4 pts (neutral). NEVER 0. NEVER negative.
 *  - allow_martingale and allow_chase_loss MUST be false.
 *  - no_bet and lab_only tiers MUST be blocked in canEnterRealMoneyTest.
 *  - can_sell with resolved_valid < 150 MUST be false.
 *  - can_micro_test with resolved_valid < 30 MUST be false.
 */

// ---------------------------------------------------------------------------
// mapReadinessStatus
// ---------------------------------------------------------------------------

/**
 * Maps a numeric readiness score (0–100) to a status tier string.
 * @param {number} score
 * @returns {string}
 */
export function mapReadinessStatus(score) {
  if (score >= 85) return 'sell_ready_candidate';
  if (score >= 75) return 'beta_ready';
  if (score >= 60) return 'micro_test_ready';
  if (score >= 40) return 'lab_ready';
  return 'not_ready';
}

// ---------------------------------------------------------------------------
// computeBetaReadinessScore
// ---------------------------------------------------------------------------

/**
 * Computes the 8-component beta readiness score from a metrics object.
 * @param {object|null} metrics
 * @param {{ micro_test_enabled?: boolean }} [options]
 * @returns {{ score, status, can_micro_test, can_beta, can_sell, components, micro_test_status, micro_test_active }}
 */
export function computeBetaReadinessScore(metrics, options = {}) {
  // Null guard
  if (metrics == null) {
    return {
      score: 0,
      status: 'not_ready',
      can_micro_test: false,
      can_beta: false,
      can_sell: false,
      micro_test_status: 'waiting_for_threshold',
      micro_test_active: false,
      remaining_to_micro_test: 30,
      micro_test_threshold: 30,
      components: {
        sample_size: 0,
        roi: 0,
        clv: 4,           // CLV neutral = 4, NEVER 0, NEVER negative
        unknown_rate: 0,
        audit_coverage: 0,
        market_coverage: 0,
        bankroll_safety: 0,
        stability: 0,
      },
    };
  }

  // --- sample_size (0–20) ---
  const rv = metrics.resolved_valid ?? 0;
  let sample_size;
  if (rv >= 300)      sample_size = 20;
  else if (rv >= 150) sample_size = 16;
  else if (rv >= 75)  sample_size = 12;
  else if (rv >= 30)  sample_size = 8;
  else if (rv >= 10)  sample_size = 4;
  else                sample_size = 0;

  // --- roi (0–20) ---
  const roi_pct = metrics.roi_pct;
  let roi;
  if (roi_pct == null)      roi = 0;
  else if (roi_pct < -2)    roi = 0;
  else if (roi_pct < 0)     roi = 4;
  else if (roi_pct < 3)     roi = 10;
  else if (roi_pct < 5)     roi = 16;
  else                      roi = 20;

  // --- clv (0–15) — CRITICAL: unknown = 4 pts neutral, NEVER negative, NEVER below 4 when unknown ---
  const clv_known_pct = metrics.clv_known_pct;
  let clv;
  if (clv_known_pct == null || clv_known_pct === 0) {
    clv = 4; // neutral default — NEVER 0, NEVER negative
  } else {
    const positive_clv_rate = metrics.positive_clv_rate ?? 0;
    clv = Math.round(
      Math.min(clv_known_pct, 1) * 10 +
      Math.min(positive_clv_rate, 1) * 5
    );
    clv = Math.max(clv, 4);  // never below 4 even when data exists
    clv = Math.min(clv, 15); // cap at 15
  }

  // --- unknown_rate (0–10) ---
  const unknown_pct_valid = metrics.unknown_pct_valid;
  let unknown_rate;
  if (unknown_pct_valid == null) {
    unknown_rate = 10; // new system, treat as best case
  } else {
    unknown_rate = Math.round(10 * (1 - Math.min(unknown_pct_valid, 100) / 100));
  }

  // --- audit_coverage (0–10) ---
  const audit_coverage_pct = metrics.audit_coverage_pct;
  let audit_coverage;
  if (audit_coverage_pct == null) {
    audit_coverage = 0;
  } else {
    audit_coverage = Math.round(Math.min(audit_coverage_pct, 1) * 10);
  }

  // --- market_coverage (0–10) — always null in Phase 1 ---
  const market_coverage = 0; // metrics.market_coverage_pct is always null in Phase 1

  // --- bankroll_safety (0–10) ---
  let bankroll_safety = 0;
  if (metrics.has_bankroll_config === true) bankroll_safety += 5;
  if (metrics.no_losses_yet === true) bankroll_safety += 5;

  // --- stability (0–5) ---
  const days_with_data = metrics.days_with_data ?? 0;
  let stability;
  if (days_with_data >= 14)     stability = 5;
  else if (days_with_data >= 7) stability = 3;
  else if (days_with_data >= 3) stability = 1;
  else                          stability = 0;

  const components = {
    sample_size,
    roi,
    clv,
    unknown_rate,
    audit_coverage,
    market_coverage,
    bankroll_safety,
    stability,
  };

  // Total score clamped to 100
  const rawScore = sample_size + roi + clv + unknown_rate + audit_coverage +
                   market_coverage + bankroll_safety + stability;
  const score = Math.min(100, rawScore);

  const status = mapReadinessStatus(score);

  // --- Binary gates ---

  // can_micro_test
  const can_micro_test = (
    rv >= 30 &&
    (roi_pct == null || roi_pct >= -2)
  );

  // can_beta
  const can_beta = (
    rv >= 75 &&
    roi_pct != null && roi_pct >= 0 &&
    (unknown_pct_valid == null || unknown_pct_valid <= 15) &&
    (clv_known_pct == null || clv_known_pct >= 0.25)
  );

  // can_sell
  const positive_clv_rate = metrics.positive_clv_rate;
  const can_sell = (
    rv >= 150 &&
    roi_pct != null && roi_pct >= 3 &&
    (unknown_pct_valid == null || unknown_pct_valid <= 12) &&
    positive_clv_rate != null && positive_clv_rate >= 0.45
  );

  const MICRO_TEST_THRESHOLD = 30;
  const remaining_to_micro_test = Math.max(0, MICRO_TEST_THRESHOLD - rv);

  const microTestEnabled = options.micro_test_enabled === true;
  const micro_test_active = can_micro_test && microTestEnabled;

  let micro_test_status;
  if (rv < MICRO_TEST_THRESHOLD) {
    micro_test_status = 'waiting_for_threshold';
  } else if (can_micro_test && microTestEnabled) {
    micro_test_status = 'active';
  } else if (can_micro_test) {
    micro_test_status = 'ready';
  } else {
    micro_test_status = 'blocked';
  }

  return { score, status, can_micro_test, can_beta, can_sell, components, remaining_to_micro_test, micro_test_threshold: MICRO_TEST_THRESHOLD, micro_test_status, micro_test_active };
}

// ---------------------------------------------------------------------------
// getBankrollTestConfig
// ---------------------------------------------------------------------------

/**
 * Returns the bankroll safety configuration for real-money micro-testing.
 * @returns {object}
 */
export function getBankrollTestConfig() {
  return {
    default_stake: 0.50,
    max_daily_loss: 3.00,
    max_daily_bets: 6,
    max_weekly_loss: 10.00,
    jackpot_mega_stake_cap: 0.50,
    allow_martingale: false,         // HARD RULE: must never be true
    allow_chase_loss: false,         // HARD RULE: must never be true
    require_audit_valid: true,
    require_trust_verified: true,
    min_bet_confidence_tier: 'valid_bet',
    safety_disclaimer: 'Apostas envolvem risco. O SportsBrain não garante lucro. Shadow Betting é simulação, não resultado financeiro real.',
  };
}

// ---------------------------------------------------------------------------
// canEnterRealMoneyTest
// ---------------------------------------------------------------------------

/**
 * Checks if a pick can enter the real-money micro-test phase.
 * Returns allowed, blockers, recommended_stake, config, and safety_disclaimer.
 *
 * @param {object} pick
 * @param {object} readiness — output from computeBetaReadinessScore
 * @param {object|null} bankroll — current bankroll state
 * @returns {{ allowed, blockers, recommended_stake, config, safety_disclaimer }}
 */
export function canEnterRealMoneyTest(pick, readiness, bankroll) {
  const config = getBankrollTestConfig();
  const blockers = [];

  // Guard: null/undefined pick
  if (!pick) {
    blockers.push('pick: pick object is null or missing')
    return {
      allowed: false,
      blockers,
      recommended_stake: 0,
      config,
      safety_disclaimer: config.safety_disclaimer,
    }
  }

  // 1. Readiness gate
  if (!readiness?.can_micro_test && !readiness?.can_beta && !readiness?.can_sell) {
    blockers.push('readiness_gate: status=' + (readiness?.status ?? 'unknown') + ', not_ready');
  }

  // 2. Bet confidence tier
  const tier = pick?.bet_confidence_tier;
  if (tier === 'no_bet' || tier === 'lab_only' || tier == null) {
    blockers.push('bet_confidence_tier: ' + tier + ' — no_bet/lab_only blocked');
  }

  // 3. Audit gate
  if (!pick?.audit?.is_valid) {
    blockers.push('audit: is_valid=false or missing');
  }

  // 4. Trust gate
  const trust = pick?.trust_level;
  if (trust !== 'verified' && trust !== 'supported') {
    blockers.push('trust: trust_level=' + trust + ' — must be verified/supported');
  }

  // 5. Market gate
  if (pick?.market_available === false) {
    blockers.push('market: market_available=false');
  }

  // 6. Bankroll null guard
  if (bankroll == null) {
    blockers.push('bankroll: missing bankroll state (cannot check limits)');
    const allowed = blockers.length === 0;
    return {
      allowed,
      blockers,
      recommended_stake: allowed ? config.default_stake : 0,
      config,
      safety_disclaimer: config.safety_disclaimer,
    };
  }

  // 7. Daily bets
  const daily_bets = bankroll.daily_bets_today ?? 0;
  if (daily_bets >= config.max_daily_bets) {
    blockers.push('daily_bets: ' + daily_bets + ' >= max ' + config.max_daily_bets);
  }

  // 8. Daily loss
  const daily_loss = bankroll.daily_loss_today ?? 0;
  if (daily_loss >= config.max_daily_loss) {
    blockers.push('daily_loss: ' + daily_loss + ' >= max ' + config.max_daily_loss);
  }

  // 9. Weekly loss
  const weekly_loss = bankroll.weekly_loss ?? 0;
  if (weekly_loss >= config.max_weekly_loss) {
    blockers.push('weekly_loss: ' + weekly_loss + ' >= max ' + config.max_weekly_loss);
  }

  const allowed = blockers.length === 0;
  return {
    allowed,
    blockers,
    recommended_stake: allowed ? config.default_stake : 0,
    config,
    safety_disclaimer: config.safety_disclaimer,
  };
}

// ---------------------------------------------------------------------------
// queryBetaReadinessMetrics (async, reads D1)
// ---------------------------------------------------------------------------

/**
 * Queries D1 for beta readiness metrics over the last `days` days.
 * @param {object} env — Cloudflare Workers env with SB_DB binding
 * @param {number} days — lookback window in days (default 30)
 * @returns {Promise<object|null>}
 */
export async function queryBetaReadinessMetrics(env, days = 30) {
  if (!env?.SB_DB) return null;

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [totalsResult, clvResult, auditResult] = await env.SB_DB.batch([
      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN training_eligible = 1 AND result_status IN ('green','red') THEN 1 ELSE 0 END) as resolved_valid,
          SUM(CASE WHEN result_status IN ('green','red','void') THEN 1 ELSE 0 END) as resolved,
          SUM(CASE WHEN result_status = 'green' AND profit_brl > 0 THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN result_status = 'red' AND profit_brl < 0 THEN 1 ELSE 0 END) as losses,
          SUM(CASE WHEN result_status IN ('green','red') THEN profit_brl ELSE 0 END) as profit,
          SUM(stake_simulated) as total_staked,
          SUM(CASE WHEN bet_confidence_tier IN ('no_bet', 'lab_only') AND training_eligible = 1 THEN 1 ELSE 0 END) as unknown_count,
          COUNT(DISTINCT DATE(created_at)) as days_with_data,
          MAX(created_at) as last_bet_at
        FROM shadow_bets WHERE created_at >= ?
      `).bind(since),

      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total_with_clv,
          SUM(CASE WHEN clv_status = 'positive_clv' THEN 1 ELSE 0 END) as positive_clv,
          SUM(CASE WHEN clv_status != 'unknown' THEN 1 ELSE 0 END) as clv_known
        FROM shadow_bets WHERE created_at >= ? AND clv_status IS NOT NULL
      `).bind(since),

      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total_audited,
          SUM(CASE WHEN audit_status = 'valid' THEN 1 ELSE 0 END) as audit_valid
        FROM shadow_bets WHERE created_at >= ? AND audit_status IS NOT NULL
      `).bind(since),
    ]);

    const t = totalsResult.results[0] ?? {};
    const c = clvResult.results[0] ?? {};
    const a = auditResult.results[0] ?? {};

    const total_staked = t.total_staked ?? 0;
    const profit = t.profit ?? null;
    const resolved_valid = t.resolved_valid ?? 0;
    const resolved = t.resolved ?? 0;
    const losses = t.losses ?? 0;
    const unknown_count = t.unknown_count ?? 0;

    const roi_pct = (total_staked > 0 && profit !== null)
      ? (profit / total_staked * 100)
      : null;

    const clv_known_pct = c.total_with_clv > 0
      ? c.clv_known / c.total_with_clv
      : null;

    const positive_clv_rate = c.clv_known > 0
      ? c.positive_clv / c.clv_known
      : null;

    const unknown_pct_valid = resolved_valid > 0
      ? (unknown_count / resolved_valid * 100)
      : null;

    const audit_coverage_pct = (resolved > 0 && a.total_audited > 0)
      ? a.audit_valid / resolved
      : null;

    return {
      total: t.total ?? 0,
      resolved_valid,
      resolved,
      wins: t.wins ?? 0,
      losses,
      profit,
      total_staked,
      unknown_count,
      days_with_data: t.days_with_data ?? 0,
      last_bet_at: t.last_bet_at ?? null,
      roi_pct,
      clv_known_pct,
      positive_clv_rate,
      unknown_pct_valid,
      audit_coverage_pct,
      market_coverage_pct: null, // Phase 1 — always null
      has_bankroll_config: true, // getBankrollTestConfig always exists
      no_losses_yet: losses === 0,
    };
  } catch (err) {
    console.error('[betaReadiness] queryBetaReadinessMetrics error:', err);
    return null;
  }
}
