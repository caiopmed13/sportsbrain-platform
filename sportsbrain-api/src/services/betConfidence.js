/**
 * betConfidence.js
 * =============================================================================
 * Bet Confidence Score — answers: "Is this pick safe enough for a controlled stake?"
 *
 * Exported functions:
 *   calcBetConfidenceScore(pick)          — returns { score, tier, components }
 *   mapBetConfidenceTier(score)           — 'no_bet'|'lab_only'|'micro_test'|'valid_bet'|'premium_bet'
 *   recommendStake(tier, pick, config?)   — returns { stake, stake_unit, reason, blocked }
 *
 * Score range: 0–100 (penalties can push toward 0, never below 0)
 * Tiers:  0–39 no_bet | 40–59 lab_only | 60–74 micro_test | 75–84 valid_bet | 85–100 premium_bet
 *
 * CLV 'unknown' is ALWAYS neutral (never negative) — per spec rule.
 * Jackpot/Mega stake ALWAYS capped at R$0.50 — per spec rule.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// 1. Tier mapper
// ---------------------------------------------------------------------------

/**
 * Maps a numeric score to a confidence tier label.
 * @param {number} score  0–100
 * @returns {string}
 */
export function mapBetConfidenceTier(score) {
  if (score >= 85) return 'premium_bet';
  if (score >= 75) return 'valid_bet';
  if (score >= 60) return 'micro_test';
  if (score >= 40) return 'lab_only';
  return 'no_bet';
}

// ---------------------------------------------------------------------------
// 2. Internal full computation (shared)
// ---------------------------------------------------------------------------

function _computeAll(pick) {
  // Unpack audit fields — support both nested object and flat string
  const auditObj        = pick.audit_status || {};
  const pickAuditStatus = typeof auditObj === 'string'
    ? auditObj
    : (auditObj.pickAuditStatus || auditObj.audit_status || 'unknown');
  const trustLevel      = auditObj.trust_level || pick.trust_level || 'unknown';
  const canPost         = auditObj.can_post ?? pick.can_post ?? false;

  // ── 1. audit_component (0–20) ──
  let audit_component = 0;
  if      (pickAuditStatus === 'valid' && trustLevel === 'verified')  audit_component = 20;
  else if (pickAuditStatus === 'valid' && trustLevel === 'supported') audit_component = 15;
  else if (pickAuditStatus === 'valid')                                audit_component = 10;
  else if (pickAuditStatus === 'observation')                          audit_component = 5;
  // blocked / hidden / weak / unknown = 0

  // ── 2. market_component (0–15) ──
  let market_component = 0;
  const mktAvail = pick.market_available;
  const mktConf  = pick.availability_confidence;
  if      (mktAvail === true  && mktConf === 'high') market_component = 15;
  else if (mktAvail === true)                         market_component = 10;
  else if (mktAvail == null)                          market_component = 5;  // unknown → fallback safe
  // mktAvail === false → 0

  // ── 3. odds_snapshot_component (0–10) ──
  let odds_snapshot_component = 0;
  const snapCount = pick.odds_snapshot_count ?? 0;
  if      (snapCount >= 3) odds_snapshot_component = 10;
  else if (snapCount >= 2) odds_snapshot_component = 7;
  else if (snapCount >= 1) odds_snapshot_component = 3;

  // ── 4. clv_component (0–15) — 'unknown' is ALWAYS ≥ 0 ──
  let clv_component = 0;
  const clvStatus = pick.clv_status;
  if      (clvStatus === 'positive_clv') clv_component = 15;
  else if (clvStatus === 'flat')         clv_component = 8;
  else if (clvStatus === 'unknown')      clv_component = 4;  // neutral, never negative
  // negative_clv = 0

  // ── 5. historical_component (0–15) ──
  let historical_component = 0;
  const goldenScore   = pick.golden_score   ?? 0;
  const goldenSupport = pick.golden_support_score ?? 0;
  if      (goldenScore >= 8) historical_component += 8;
  else if (goldenScore >= 6) historical_component += 5;
  else if (goldenScore >= 4) historical_component += 2;
  if      (goldenSupport >= 0.7) historical_component += 6.5;
  else if (goldenSupport >= 0.5) historical_component += 4;
  else if (goldenSupport >= 0.3) historical_component += 2;
  historical_component = Math.min(15, historical_component);

  // ── 6. validation_component (0–15) ──
  let validation_component = 0;
  const ev   = pick.ev_pct ?? 0;
  const prob = pick.prob   ?? pick.fair_prob ?? 0;
  if      (ev >= 5) validation_component += 7;
  else if (ev >= 2) validation_component += 4;
  else if (ev >= 0) validation_component += 2;
  if      (prob >= 0.55) validation_component += 8;
  else if (prob >= 0.50) validation_component += 5;
  else if (prob >= 0.45) validation_component += 2;
  validation_component = Math.min(15, validation_component);

  // ── 7. bankroll_component (0–10) ──
  let bankroll_component = 0;
  const canResolve = pick.resolvability?.can_resolve ?? true;  // default true if not set
  if (canPost)     bankroll_component += 5;
  if (canResolve)  bankroll_component += 5;

  // ── 8. risk_penalty (0 to –∞, clamped in total) ──
  let risk_penalty = 0;
  const odd = pick.odd ?? 1;
  if      (odd > 10) risk_penalty -= 10;
  else if (odd > 5)  risk_penalty -= 5;

  const legCount = pick.legs_count ?? 1;
  if      (legCount >= 4) risk_penalty -= 15;
  else if (legCount >= 3) risk_penalty -= 8;
  else if (legCount >= 2) risk_penalty -= 3;

  const srcFamily = (pick.source_family || pick.source || '').toLowerCase();
  if (srcFamily === 'jackpot' || srcFamily === 'mega') risk_penalty -= 5;
  if (pickAuditStatus === 'observation') risk_penalty -= 5;

  // ── Total ──
  const raw   = audit_component + market_component + odds_snapshot_component +
                clv_component   + historical_component + validation_component +
                bankroll_component + risk_penalty;
  const score = +Math.max(0, Math.min(100, raw)).toFixed(1);
  const tier  = mapBetConfidenceTier(score);

  return {
    score, tier,
    components: {
      audit_component, market_component, odds_snapshot_component,
      clv_component, historical_component, validation_component,
      bankroll_component, risk_penalty,
    },
    _internals: { pickAuditStatus, trustLevel, canPost, clvStatus, mktAvail },
  };
}

function _zeroComponents() {
  return {
    audit_component: 0, market_component: 0, odds_snapshot_component: 0,
    clv_component: 0, historical_component: 0, validation_component: 0,
    bankroll_component: 0, risk_penalty: 0,
  };
}

// ---------------------------------------------------------------------------
// 3. Main score function
// ---------------------------------------------------------------------------

/**
 * Computes the Bet Confidence Score for a pick.
 *
 * @param {object|null} pick
 * @returns {{ score: number, tier: string, components: object }}
 */
export function calcBetConfidenceScore(pick) {
  if (!pick) return { score: 0, tier: 'no_bet', components: _zeroComponents() };
  const r = _computeAll(pick);
  return { score: r.score, tier: r.tier, components: r.components };
}

// ---------------------------------------------------------------------------
// 4. Explain function (P3.8.5.2) — admin/debug only, pure, no side effects
// ---------------------------------------------------------------------------

/**
 * Returns a full breakdown of the Bet Confidence Score computation.
 * Includes component values, input field presence flags, blockers, and notes.
 * Admin/debug use only — never call from public endpoints.
 *
 * @param {object|null} item  Pick or shadow_bets row (DB fields accepted)
 * @param {object} [ctx]      Optional context (unused, reserved for future use)
 * @returns {{ score, tier, components, input_flags, blockers, notes }}
 */
export function explainBetConfidenceScore(item, ctx = {}) {
  if (!item) {
    return {
      score: 0, tier: 'no_bet', components: _zeroComponents(),
      input_flags: { has_audit_status: false, audit_status: null, trust_level: null,
        can_post: false, market_available: null, availability_confidence: null,
        has_odds_snapshot: false, odds_snapshot_count: 0, clv_status: null,
        has_source_trace: false, has_evidence_pack: false, has_resolvability: false,
        has_historical_profile: false, training_eligible: null,
        ev_pct: null, prob: null, odd: null, legs_count: 1, source_family: null },
      blockers: ['null_item'],
      notes: [],
    };
  }

  const r = _computeAll(item);
  const { pickAuditStatus, trustLevel, canPost, clvStatus, mktAvail } = r._internals;

  const hasOddsSnapshot = !!(item.odds_snapshot_id) || (item.odds_snapshot_count ?? 0) > 0;
  const hasHistoricalProfile = (item.golden_score ?? 0) > 0 || (item.golden_support_score ?? 0) > 0;

  const input_flags = {
    has_audit_status:       !!(item.audit_status || item.pickAuditStatus),
    audit_status:           pickAuditStatus,
    trust_level:            trustLevel,
    can_post:               canPost,
    market_available:       item.market_available ?? null,
    availability_confidence: item.availability_confidence ?? null,
    has_odds_snapshot:      hasOddsSnapshot,
    odds_snapshot_count:    item.odds_snapshot_count ?? 0,
    clv_status:             clvStatus ?? null,
    has_source_trace:       !!(item.source_trace),
    has_evidence_pack:      !!(item.evidence_pack),
    has_resolvability:      !!(item.resolvability),
    has_historical_profile: hasHistoricalProfile,
    training_eligible:      item.training_eligible ?? null,
    ev_pct:                 item.ev_pct ?? null,
    prob:                   item.prob ?? item.fair_prob ?? null,
    odd:                    item.odd ?? null,
    legs_count:             item.legs_count ?? 1,
    source_family:          item.source_family || item.source || null,
  };

  const blockers = [];
  if (pickAuditStatus === 'unknown' || !input_flags.has_audit_status)
    blockers.push('missing_audit');
  if (trustLevel === 'unknown' || trustLevel === 'partial')
    blockers.push('missing_trust');
  if (!canPost)
    blockers.push('can_post_false');
  if (mktAvail === false || mktAvail === 0)
    blockers.push('market_unavailable');
  if (!hasOddsSnapshot)
    blockers.push('missing_odds_snapshot');
  if (!clvStatus)
    blockers.push('missing_clv');
  if (!input_flags.has_evidence_pack)
    blockers.push('missing_evidence_pack');
  if (!hasHistoricalProfile)
    blockers.push('validation_sample_missing');
  if (r.components.risk_penalty <= -10)
    blockers.push('risk_penalty_maxed');

  const notes = [];
  if (clvStatus === 'unknown')
    notes.push('clv_unknown_neutral_4pts');
  if (item.market_available == null)
    notes.push('market_available_null_fallback_5pts');
  if ((item.legs_count ?? 1) >= 2)
    notes.push(`legs_${item.legs_count ?? 1}_penalty_applied`);
  if ((item.odd ?? 1) > 5)
    notes.push(`odd_${item.odd ?? 1}_risk_penalty`);
  if (!hasOddsSnapshot)
    notes.push('odds_snapshot_count_missing_from_input');
  if (!input_flags.has_audit_status)
    notes.push('audit_status_missing_from_input');
  if (!clvStatus)
    notes.push('clv_status_missing_from_input');

  return {
    score:       r.score,
    tier:        r.tier,
    components:  r.components,
    input_flags,
    blockers,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 5. Stake recommendation
// ---------------------------------------------------------------------------

/**
 * Recommends a stake based on confidence tier.
 *
 * Rules:
 *   - no_bet / lab_only: stake = 0, blocked = true
 *   - micro_test: R$0.50 always
 *   - valid_bet: max(min_stake, bankroll × 0.0025)
 *   - premium_bet: max(min_stake, bankroll × max_stake_pct)
 *   - Jackpot/Mega source: ALWAYS cap at R$0.50, regardless of tier
 *
 * @param {string} betConfidenceTier
 * @param {object} pick
 * @param {{ default_bankroll?: number, min_stake?: number, max_stake_pct?: number }} config
 * @returns {{ stake: number, stake_unit: number, reason: string, blocked: boolean }}
 */
export function recommendStake(betConfidenceTier, pick, config = {}) {
  const {
    default_bankroll = 100,
    min_stake        = 0.50,
    max_stake_pct    = 0.01,
  } = config;

  const srcFamily = (pick?.source_family || pick?.source || '').toLowerCase();
  const isJackpotMega = srcFamily === 'jackpot' || srcFamily === 'mega';

  // Jackpot/Mega: ALWAYS R$0.50 — no exceptions
  if (isJackpotMega) {
    return { stake: 0.50, stake_unit: 0.005, reason: 'jackpot_mega_cap', blocked: false };
  }

  switch (betConfidenceTier) {
    case 'no_bet':
      return { stake: 0, stake_unit: 0, reason: 'confidence_too_low', blocked: true };
    case 'lab_only':
      return { stake: 0, stake_unit: 0, reason: 'lab_only_simulation', blocked: true };
    case 'micro_test':
      return { stake: 0.50, stake_unit: 0.005, reason: 'micro_test', blocked: false };
    case 'valid_bet': {
      const s = +Math.max(min_stake, default_bankroll * 0.0025).toFixed(2);
      return { stake: s, stake_unit: 0.0025, reason: 'valid_bet', blocked: false };
    }
    case 'premium_bet': {
      const s = +Math.max(min_stake, default_bankroll * max_stake_pct).toFixed(2);
      return { stake: s, stake_unit: max_stake_pct, reason: 'premium_bet', blocked: false };
    }
    default:
      return { stake: 0, stake_unit: 0, reason: 'unknown_tier', blocked: true };
  }
}
