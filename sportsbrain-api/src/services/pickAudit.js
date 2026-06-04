/**
 * pickAudit.js
 * =============================================================================
 * Pure-JS, synchronous service that builds 7 audit/traceability fields for
 * every Premium pick. No async, no external dependencies, no D1 calls.
 *
 * Part of P3 — SportsBrain "Premium Source-of-Truth".
 *
 * Exported functions:
 *   buildSourceTrace(pick)
 *   buildExtendedEvidencePack(pick)
 *   buildMarketValidation(pick, availabilityCtx?)  ← P3.5: optional availability context
 *   buildMethodValidation(pick)
 *   buildResolvability(pick)
 *   buildScoreBreakdown(pick)
 *   buildAuditStatus(pick, marketValidation, methodValidation, resolvability, evidencePack)
 *   buildPickAudit(pick, availabilityCtx?)          ← P3.5: threads availability through
 *   calcReturn050(odd)
 *
 * P3.5 additions:
 *   - buildMarketValidation accepts an optional availabilityCtx (from
 *     loadMarketAvailabilityBulk) and adds:
 *       market_available: true | false | null (null = unknown / table empty)
 *       availability_confidence: 'high' | 'medium' | 'low' | 'none'
 *       matched_market_id: string | null
 *       market_last_seen_at: string | null
 *       normalized_market: string
 *       normalized_selection: string
 *   - buildAuditStatus downgrades trust_level/can_post when market_available = false
 * =============================================================================
 */

import {
  normalizeMarketName,
  normalizeSelectionName,
  normalizePeriod,
  normalizePlayerName,
  normalizeLine,
} from './marketNormalization.js';
import { lookupAvailability } from './marketAvailability.js';
import { computeOddsFreshness } from './oddsSnapshots.js';

// ---------------------------------------------------------------------------
// Section 1 — Source Trace
// ---------------------------------------------------------------------------

/**
 * Determines where a pick came from and how trustworthy that origin is.
 *
 * @param {object} pick
 * @returns {{
 *   generated_by: string,
 *   source_family: string,
 *   odds_source: string,
 *   data_sources: string[],
 *   source_confidence: string,
 *   generated_at: null,
 *   source_notes: string[],
 * }}
 */
export function buildSourceTrace(pick) {
  const {
    source,
    bet365,
    pinnacle,
    _is_direct_b365,
    _is_devig,
    _is_faixa_mirror,
    _has_steam,
    is_sharp,
    _is_result_btts,
    _is_ht_method,
    _is_player_shots,
    _is_bingo_classico,
    evidence_pack,
    signal_count,
  } = pick ?? {};

  // --- generated_by ---
  let generated_by;
  if (_is_faixa_mirror || source === 'faixa_mirror') {
    generated_by = 'tier_native';
  } else if (_is_devig || _is_direct_b365) {
    generated_by = 'desajuste';
  } else if (source === 'tipster') {
    generated_by = 'tipster';
  } else {
    generated_by = 'premium_engine';
  }

  // --- source_family ---
  let source_family;
  if (_is_result_btts) {
    source_family = 'result_btts';
  } else if (_is_ht_method || _is_player_shots || _is_bingo_classico) {
    source_family = 'experimental';
  } else {
    source_family = 'single';
  }

  // --- odds_source ---
  let odds_source;
  if (bet365 === true || _is_direct_b365) {
    odds_source = 'bet365_real';
  } else if (pinnacle === true || _has_steam || is_sharp) {
    odds_source = 'estimated';
  } else if (source === 'tipster' || _is_faixa_mirror) {
    odds_source = 'tipster';
  } else {
    odds_source = 'unknown';
  }

  // --- data_sources ---
  const rawSources = [];
  if (source != null) rawSources.push(source);
  if (bet365 === true || _is_direct_b365) rawSources.push('bet365');
  if (evidence_pack?.has_team_profile) rawSources.push('sofascore');
  if (evidence_pack?.has_team_profile || evidence_pack?.has_recent_form) rawSources.push('d1_history');
  if (source === 'tipster' || _is_faixa_mirror) rawSources.push('tipster');
  // deduplicate while preserving order
  const data_sources = [...new Set(rawSources)];

  // --- source_confidence ---
  let source_confidence;
  if (odds_source === 'bet365_real' && data_sources.includes('sofascore')) {
    source_confidence = 'high';
  } else if (odds_source !== 'unknown') {
    source_confidence = 'medium';
  } else {
    source_confidence = 'low';
  }

  // --- source_notes ---
  const source_notes = [];
  if (odds_source === 'bet365_real') {
    source_notes.push('Odd verificada do Bet365');
  } else if (odds_source === 'unknown') {
    source_notes.push('Sem fonte de odds real');
  }
  if (source === 'tipster' || _is_faixa_mirror) {
    source_notes.push('Pick via canal tipster validado');
  }
  if (_is_direct_b365) {
    source_notes.push('Odd direta Bet365 — devig aplicado');
  }
  if (_has_steam || is_sharp) {
    source_notes.push('Sinal de sharp money detectado');
  }

  return {
    generated_by,
    source_family,
    odds_source,
    data_sources,
    source_confidence,
    generated_at: null,
    source_notes,
  };
}

// ---------------------------------------------------------------------------
// Section 2 — Extended Evidence Pack
// ---------------------------------------------------------------------------

/** Markets for which historical form is relevant. */
const FORM_RELEVANT_MARKETS = /BTTS|OVER|UNDER|1X2|result_btts/i;

/**
 * Extends the P2.4 evidence_pack with derived boolean gates and a `missing`
 * list that explains what data couldn't be found.
 *
 * Rule: 0% is a valid value — never mark something missing because a rate is 0.
 *
 * @param {object} pick
 * @returns {object}
 */
export function buildExtendedEvidencePack(pick) {
  const {
    odd,
    stat,
    market,
    kickoff,
    home_team,
    player_name,
    evidence_pack: ep,
  } = pick ?? {};

  // Derive the odds_source inline (mirrors buildSourceTrace logic without
  // re-running the full function; kept local to avoid circular dep).
  const _ep_odds_source = (() => {
    if (pick?.bet365 === true || pick?._is_direct_b365) return 'bet365_real';
    if (pick?.pinnacle === true || pick?._has_steam || pick?.is_sharp) return 'estimated';
    if (pick?.source === 'tipster' || pick?._is_faixa_mirror) return 'tipster';
    return 'unknown';
  })();

  const has_real_odd =
    odd != null && odd >= 1.05 && _ep_odds_source !== 'unknown';
  const has_real_market = !!(stat || market);
  const has_kickoff = !!kickoff;
  const has_team_profile = !!(ep?.has_team_profile ?? !!home_team);
  const has_home_away_split = !!(ep?.has_home_away_split);
  const has_match_profile = !!(ep?.has_team_profile && has_home_away_split);
  const has_btts_profile = !!(ep?.has_btts_profile);
  const has_recent_form = !!(ep?.has_recent_form);
  const has_h2h_context = !!(ep?.has_h2h_context);
  // pick can be resolved if it's not an HT-method with a missing kickoff
  const has_result_path = !pick?._is_ht_method || !!kickoff;
  const has_data_quality_score = ep?.data_quality_score != null;
  const data_quality_score = ep?.data_quality_score ?? null;
  const golden_support_score = pick?.golden_support_score ?? null;

  // --- missing[] ---
  const missing = [];
  if (!has_real_odd) missing.push('real_odd');
  if (!has_real_market) missing.push('market_definition');
  if (!has_kickoff) missing.push('kickoff');
  if (!has_team_profile) missing.push('team_data');

  const marketStr = (stat ?? market ?? '').toString();
  if (!has_recent_form && FORM_RELEVANT_MARKETS.test(marketStr)) {
    missing.push('historical_form');
  }
  if (/PLAYER_/i.test(stat ?? '') && !(player_name?.trim()?.length > 0)) {
    missing.push('player_name');
  }

  return {
    has_real_odd,
    has_real_market,
    has_kickoff,
    has_team_profile,
    has_match_profile,
    has_home_away_split,
    has_btts_profile,
    has_recent_form,
    has_h2h_context,
    has_result_path,
    has_data_quality_score,
    data_quality_score,
    golden_support_score,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Section 3 — Market Validation
// ---------------------------------------------------------------------------

const PLAYER_MARKET_RE = /PLAYER_|SHOTS_ON_TARGET|FIRST_BASKET/i;
const CORRECT_SCORE_RE = /CORRECT_SCORE/i;
const FAKE_PLAYER_RE = /^(jogador|player|unknown)/i;

/**
 * Validates the bet market definition: bookmaker, player-name gate,
 * odds sanity, known high-variance market warnings, and (P3.5) market
 * availability lookup against the pre-loaded availability context.
 *
 * @param {object}      pick
 * @param {object|null} availabilityCtx  — result of loadMarketAvailabilityBulk (optional)
 * @returns {object}
 */
export function buildMarketValidation(pick, availabilityCtx = null) {
  const {
    stat,
    market,
    selection,
    line,
    direction,
    period,
    odd,
    bet365,
    pinnacle,
    player_name,
  } = pick ?? {};

  const marketStr = stat ?? market ?? null;

  const market_exists = !!(marketStr) && !!(odd > 1.0);

  const bookmaker =
    bet365 === true ? 'bet365' : pinnacle === true ? 'pinnacle' : 'unknown';

  const player_name_required = PLAYER_MARKET_RE.test(marketStr ?? '');
  const trimmedPlayer = player_name?.trim() ?? '';
  const player_name_present =
    trimmedPlayer.length > 2 && !FAKE_PLAYER_RE.test(trimmedPlayer);

  const warnings = [];
  if (player_name_required && !player_name_present) {
    warnings.push('player_name_missing_for_player_market');
  }
  if (!odd || odd <= 1.0) {
    warnings.push('odd_invalid_or_missing');
  }
  if (bookmaker === 'unknown') {
    warnings.push('odd_source_unknown');
  }
  if (CORRECT_SCORE_RE.test(marketStr ?? '')) {
    warnings.push('correct_score_high_variance_market');
  }

  // ── P3.5: Market Availability lookup ──────────────────────────────────────
  const nMarket    = normalizeMarketName(marketStr ?? '');
  const nSelection = normalizeSelectionName(selection ?? direction ?? '');
  const nLine      = normalizeLine(line);
  const nPeriod    = normalizePeriod(period);
  const nPlayer    = normalizePlayerName(player_name ?? '');

  // Availability result: true = confirmed, false = not found, null = unknown (table empty / no context)
  let market_available = null;       // null = graceful / unknown
  let availability_confidence = 'none';
  let matched_market_id = null;
  let market_last_seen_at = null;

  // Only perform lookup if we have context AND the context isn't just an empty map
  // (empty maps = table missing or no picks for these fixtures)
  const hasCtx = availabilityCtx != null &&
    (availabilityCtx.byFixtureId?.size > 0 ||
     availabilityCtx.byBet365EventId?.size > 0 ||
     availabilityCtx.byMarketKey?.size > 0);

  if (hasCtx && marketStr) {
    const fixtureId    = pick?.fixture_id || pick?.match_id || null;
    const b365EventId  = pick?.bet365_event_id || pick?.fixtureId || null;

    const { found, record } = lookupAvailability(
      availabilityCtx,
      fixtureId,
      b365EventId,
      nMarket,
      nSelection,
      nLine,
      nPeriod,
      nPlayer,
    );

    if (found && record) {
      market_available        = true;
      availability_confidence = record.source_confidence || 'medium';
      matched_market_id       = record.id;
      market_last_seen_at     = record.last_seen_at;
    } else {
      // Context had records for other fixtures — this specific market wasn't found
      market_available = false;
      warnings.push('market_not_found_in_availability');
    }
  }
  // If !hasCtx: leave market_available = null (graceful degradation)

  return {
    market_exists,
    bookmaker,
    market: marketStr,
    normalized_market:    nMarket,
    selection:            selection ?? direction ?? null,
    normalized_selection: nSelection,
    line:       line ?? null,
    direction:  direction ?? null,
    period:     period ?? null,
    player_name_required,
    player_name_present,
    is_market_compatible_with_sport: true, // simplified: standard markets are always compatible
    // P3.5 fields
    market_available,
    availability_confidence,
    matched_market_id,
    market_last_seen_at,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Section 4 — Method Validation
// ---------------------------------------------------------------------------

/**
 * Validates the analytical method used to generate the pick.
 *
 * @param {object} pick
 * @returns {object}
 */
export function buildMethodValidation(pick) {
  const {
    _is_result_btts,
    _is_draw_btts,
    _is_ht_method,
    _is_player_shots,
    _is_bingo_classico,
    player_name,
    kickoff,
  } = pick ?? {};

  // --- method_family ---
  let method_family;
  if (_is_result_btts) {
    method_family = 'result_btts';
  } else if (_is_draw_btts) {
    method_family = 'result_btts'; // still named result_btts but will be invalid
  } else if (_is_ht_method) {
    method_family = 'ht';
  } else if (_is_player_shots) {
    method_family = 'shots';
  } else if (_is_bingo_classico) {
    method_family = 'bingo';
  } else {
    method_family = 'single';
  }

  // --- is_method_valid / rejection_reason ---
  let is_method_valid = true;
  let rejection_reason = null;

  if (_is_draw_btts) {
    is_method_valid = false;
    rejection_reason = 'result_btts_draw_not_allowed';
  } else if (_is_player_shots) {
    const trimmedPlayer = (player_name ?? '').trim();
    if (!trimmedPlayer) {
      is_method_valid = false;
      rejection_reason = 'shots_player_missing';
    }
  } else if (_is_ht_method) {
    if (!kickoff) {
      is_method_valid = false;
      rejection_reason = 'ht_kickoff_missing';
    }
  }

  // --- method_purity_score ---
  let method_purity_score;
  if (_is_draw_btts) {
    method_purity_score = 0;
  } else if (!is_method_valid) {
    method_purity_score = Math.max(0, 100 - 30);
  } else {
    method_purity_score = 100;
  }

  // --- warnings ---
  const warnings = [];
  const isExperimental = ['ht', 'shots', 'bingo'].includes(method_family);
  if (isExperimental && !is_method_valid) {
    warnings.push('experimental_method_incomplete_data');
  }

  return {
    method_family,
    method_purity_score,
    is_method_valid,
    rejection_reason,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Section 5 — Resolvability
// ---------------------------------------------------------------------------

const CORRECT_SCORE_OR_SPECIAL_RE = /CORRECT_SCORE|HTFT|SCORE_RANGE/i;
const PLAYER_STAT_RE = /PLAYER_|SHOTS_ON_TARGET|FIRST_BASKET/i;
const COMBO_DERIVED_RE = /BTTS.*RESULT|RESULT.*BTTS|result_btts/i;

/**
 * Determines whether the pick's result can be verified after the match,
 * and how confident we are in the resolution path.
 *
 * @param {object} pick
 * @returns {object}
 */
export function buildResolvability(pick) {
  const { stat, market, player_name, _is_ht_method } = pick ?? {};
  const marketStr = stat ?? market ?? '';

  // Player markets without a player name are unresolvable
  if (PLAYER_STAT_RE.test(marketStr) && !(player_name?.trim()?.length > 2)) {
    return {
      can_resolve: false,
      result_source_available: [],
      expected_result_source: 'none',
      unsupported_reason: 'player_name_required',
      result_confidence_expected: 'low',
    };
  }

  // Special high-variance markets — resolvable but low confidence
  if (CORRECT_SCORE_OR_SPECIAL_RE.test(marketStr)) {
    return {
      can_resolve: true,
      result_source_available: ['sofascore', 'espn'],
      expected_result_source: 'sofascore',
      unsupported_reason: null,
      result_confidence_expected: 'low',
    };
  }

  // Combo / derived markets (result_btts, BTTS+Result combos)
  if (COMBO_DERIVED_RE.test(marketStr)) {
    return {
      can_resolve: true,
      result_source_available: ['sofascore', 'espn'],
      expected_result_source: 'sofascore',
      unsupported_reason: null,
      result_confidence_expected: 'medium',
    };
  }

  // Standard football markets
  return {
    can_resolve: true,
    result_source_available: ['sofascore', 'espn'],
    expected_result_source: 'sofascore',
    unsupported_reason: null,
    result_confidence_expected: 'high',
  };
}

// ---------------------------------------------------------------------------
// Section 6 — Score Breakdown
// ---------------------------------------------------------------------------

/**
 * Breaks the quality score into labelled sub-components and lists
 * human-readable penalties and boosts.
 *
 * NOTE: Call buildSourceTrace and buildMethodValidation before this if you
 * want the most accurate sourceAgreementScore; this function derives them
 * inline from the pick to remain self-contained.
 *
 * @param {object} pick
 * @returns {object}
 */
export function buildScoreBreakdown(pick) {
  const {
    premiumQualityScore,
    dataCoverageScore: rawDataCoverage,
    evidence_pack: ep,
    _is_direct_b365,
    signal_count,
    bet365,
    ev_pct,
    golden_support_score,
    _historical_note,
    is_sharp,
    kickoff,
    _is_draw_btts,
  } = pick ?? {};

  // Derive odds_source inline
  const odds_source = (() => {
    if (pick?.bet365 === true || _is_direct_b365) return 'bet365_real';
    if (pick?.pinnacle === true || pick?._has_steam || is_sharp) return 'estimated';
    if (pick?.source === 'tipster' || pick?._is_faixa_mirror) return 'tipster';
    return 'unknown';
  })();

  // Derive method validity inline
  const method_valid = !(
    pick?._is_draw_btts ||
    (pick?._is_player_shots && !(pick?.player_name?.trim())) ||
    (pick?._is_ht_method && !kickoff)
  );

  // --- premiumQualityScore ---
  const pqs = premiumQualityScore ?? 0;

  // --- dataCoverageScore ---
  const dcs = rawDataCoverage ?? (ep?.has_team_profile ? 5 : 0);

  // --- methodSupportScore ---
  let methodSupportScore;
  if (!method_valid) {
    methodSupportScore = 0;
  } else if (_is_direct_b365) {
    methodSupportScore = 100;
  } else if (ep?.has_team_profile && ep?.has_recent_form) {
    methodSupportScore = 75;
  } else {
    methodSupportScore = 50;
  }

  // --- sourceAgreementScore ---
  let sourceAgreementScore;
  if (_is_direct_b365) {
    sourceAgreementScore = 100;
  } else if ((signal_count ?? 0) >= 2) {
    sourceAgreementScore = 80;
  } else if ((signal_count ?? 0) === 1) {
    sourceAgreementScore = 60;
  } else if (bet365 === true) {
    sourceAgreementScore = 50;
  } else {
    sourceAgreementScore = 25;
  }

  // --- teamContextScore ---
  const teamContextScore = ep?.data_quality_score ?? 0;

  // --- P3.6: oddsMovementScore (0–10) ---
  const oddsMovementScore = (() => {
    const mov = pick?.odds_movement;
    if (!mov || (mov.snapshots_count ?? 0) < 2) return 0;
    const absPct = Math.abs(mov.movement_pct ?? 0);
    if (absPct >= 5) return 10;
    if (absPct >= 2) return 6;
    if (absPct >= 0.5) return 3;
    return 1; // at least tracked
  })();

  // --- P3.6: clvSignalScore (-3 to +5) ---
  const clvSignalScore = (() => {
    const status = pick?.clv_status;
    if (status === 'positive_clv') return 5;
    if (status === 'negative_clv') return -3;
    return 0; // 'unknown' = neutral in phase 1
  })();

  // --- P3.6: oddsFreshnessScore (0–5) ---
  const oddsFreshnessScore = (() => {
    const lastSeen = pick?.odds_movement?.last_seen_at || pick?.market_last_seen_at;
    const mins = computeOddsFreshness(lastSeen);
    if (mins == null) return 0;
    if (mins <= 15)  return 5;
    if (mins <= 30)  return 4;
    if (mins <= 60)  return 3;
    if (mins <= 120) return 2;
    return 0; // stale
  })();

  // --- penalties ---
  const penalties = [];
  if (odds_source === 'unknown') penalties.push('odds_not_from_real_source');
  if (_is_draw_btts) penalties.push('draw_btts_blocked');
  if (!kickoff) penalties.push('kickoff_missing');
  if ((ev_pct ?? 0) < 0) penalties.push('negative_ev');
  if (oddsFreshnessScore === 0 && pick?.odds_movement?.last_seen_at) {
    penalties.push('odds_stale_over_2h');
  }

  // --- boosts ---
  const boosts = [];
  if (_is_direct_b365) boosts.push('bet365_devig_verified');
  if ((golden_support_score ?? 0) >= 75) boosts.push('high_golden_support');
  if (_historical_note) boosts.push(`historical_alignment: ${_historical_note}`);
  if (is_sharp) boosts.push('sharp_money_signal');

  return {
    premiumQualityScore: pqs,
    dataCoverageScore: dcs,
    methodSupportScore,
    sourceAgreementScore,
    teamContextScore,
    oddsMovementScore,
    clvSignalScore,
    oddsFreshnessScore,
    penalties,
    boosts,
  };
}

// ---------------------------------------------------------------------------
// Section 7 — Audit Status
// ---------------------------------------------------------------------------

const HARD_BLOCKERS = new Set([
  'result_btts_draw_not_allowed',
  'shots_player_missing',
]);

/**
 * Computes the final trust level and posting/display gates for a pick.
 *
 * @param {object} pick
 * @param {object} marketValidation   — from buildMarketValidation
 * @param {object} methodValidation   — from buildMethodValidation
 * @param {object} resolvability      — from buildResolvability
 * @param {object} evidencePack       — from buildExtendedEvidencePack
 * @returns {object}
 */
export function buildAuditStatus(
  pick,
  marketValidation,
  methodValidation,
  resolvability,
  evidencePack,
) {
  const {
    premiumQualityScore,
    _is_direct_b365,
    _is_faixa_mirror,
    _is_draw_btts,
    signal_count,
    bet365,
  } = pick ?? {};

  const { market_exists, market_available } = marketValidation ?? {};
  const { is_method_valid, rejection_reason } = methodValidation ?? {};
  const { can_resolve } = resolvability ?? {};
  const { has_team_profile } = evidencePack ?? {};

  // Derive odds_source inline for trust computation
  const odds_source = (() => {
    if (pick?.bet365 === true || _is_direct_b365) return 'bet365_real';
    if (pick?.pinnacle === true || pick?._has_steam || pick?.is_sharp) return 'estimated';
    if (pick?.source === 'tipster' || _is_faixa_mirror) return 'tipster';
    return 'unknown';
  })();

  const pqs = premiumQualityScore ?? 0;
  const audit_reasons = [];

  // --- trust_level ---
  let trust_level;

  if (!is_method_valid && HARD_BLOCKERS.has(rejection_reason)) {
    trust_level = 'blocked';
    audit_reasons.push(`method_blocked: ${rejection_reason}`);
  } else if (
    odds_source === 'bet365_real' &&
    market_exists &&
    can_resolve &&
    is_method_valid &&
    has_team_profile &&
    market_available !== false   // P3.5: market must be confirmed (or unknown — graceful)
  ) {
    trust_level = 'verified';
    audit_reasons.push('full_verification_passed');
    if (market_available === true) audit_reasons.push('market_confirmed_in_availability');
  } else if (
    (signal_count ?? 0) >= 1 ||
    _is_faixa_mirror ||
    bet365 === true ||
    _is_direct_b365
  ) {
    trust_level = 'supported';
    audit_reasons.push('partial_evidence_present');
  } else if (pqs < 25) {
    trust_level = 'weak';
    audit_reasons.push('low_quality_score');
  } else if (!has_team_profile || !market_exists) {
    trust_level = 'partial';
    audit_reasons.push('missing_critical_data');
  } else {
    trust_level = 'partial';
    audit_reasons.push('basic_gates_passed');
  }

  if (!is_method_valid && rejection_reason) {
    audit_reasons.push(`method_rejection: ${rejection_reason}`);
  }
  if (!can_resolve) audit_reasons.push('pick_unresolvable');

  // P3.5: market_available = false → cap at 'partial', block posting
  if (market_available === false && trust_level !== 'blocked') {
    if (['verified', 'supported'].includes(trust_level)) {
      trust_level = 'partial';
    }
    audit_reasons.push('market_not_found_in_availability');
  }

  // --- pickAuditStatus ---
  let pickAuditStatus;
  if (trust_level === 'blocked') {
    pickAuditStatus = 'blocked';
  } else if (trust_level === 'weak') {
    pickAuditStatus = 'hidden';
  } else if (trust_level === 'partial') {
    pickAuditStatus = 'observation';
  } else {
    pickAuditStatus = 'valid'; // 'supported' | 'verified'
  }

  const can_show_user = trust_level !== 'blocked';
  const can_show_premium_strong =
    ['verified', 'supported'].includes(trust_level) && pqs >= 45;
  const can_post =
    ['verified', 'supported'].includes(trust_level) &&
    is_method_valid &&
    can_resolve &&
    !_is_draw_btts &&
    market_available !== false;   // P3.5: confirmed or unknown (graceful)

  return {
    trust_level,
    pickAuditStatus,
    can_show_user,
    can_show_premium_strong,
    can_post,
    audit_reasons,
  };
}

// ---------------------------------------------------------------------------
// Section 8 — Master Function
// ---------------------------------------------------------------------------

/**
 * Runs all 7 audit builders and returns a single audit object.
 *
 * This is the primary entry point for the module.
 *
 * @param {object}      pick            — raw pick object from the premium engine
 * @param {object|null} availabilityCtx — optional, from loadMarketAvailabilityBulk (P3.5)
 * @returns {{
 *   source_trace: object,
 *   evidence_pack: object,
 *   market_validation: object,
 *   method_validation: object,
 *   resolvability: object,
 *   score_breakdown: object,
 *   audit_status: object,
 * }}
 */
export function buildPickAudit(pick, availabilityCtx = null) {
  const source_trace      = buildSourceTrace(pick);
  const evidence_pack     = buildExtendedEvidencePack(pick);
  const market_validation = buildMarketValidation(pick, availabilityCtx);  // P3.5
  const method_validation = buildMethodValidation(pick);
  const resolvability     = buildResolvability(pick);
  const score_breakdown   = buildScoreBreakdown(pick);
  const audit_status      = buildAuditStatus(
    pick,
    market_validation,
    method_validation,
    resolvability,
    evidence_pack,
  );

  return {
    source_trace,
    evidence_pack,
    market_validation,
    method_validation,
    resolvability,
    score_breakdown,
    audit_status,
  };
}

// ---------------------------------------------------------------------------
// Section 8b — Combo Audit  (P3.1 — Tier2 / Tier3 / Tier4 / Golden)
// ---------------------------------------------------------------------------

/**
 * Builds the full audit chain for a multi-leg combo.
 * Aggregates evidence from `combo.legs` — no D1 queries.
 *
 * @param {object} combo  — combo object with legs[], combined_odd, ev_pct
 * @param {string} tier   — 'tier2'|'tier3'|'tier4'|'golden'|'bet_builder'
 * @returns {{
 *   source_trace: object,
 *   evidence_pack: object,
 *   method_validation: object,
 *   resolvability: object,
 *   score_breakdown: object,
 *   audit_status: object,
 *   estimated_return_050: number|null,
 * }}
 */
export function buildComboAudit(combo, tier = 'tier2') {
  const legs          = combo.legs || [];
  const combined_odd  = combo.combined_odd;
  const _is_draw_btts = !!combo._is_draw_btts;
  const _is_result_btts = !!combo._is_result_btts;
  const _is_ht_method = !!combo._is_ht_method;

  // ── odds sources per leg ────────────────────────────────────────────────
  const legOddsSrc = legs.map(l => {
    if (l.bet365 === true || l._is_direct_b365) return 'bet365_real';
    if (l.pinnacle === true || l._has_steam)    return 'estimated';
    if (l.source === 'tipster' || l._is_faixa_mirror) return 'tipster';
    return 'unknown';
  });
  const allBet365  = legOddsSrc.every(s => s === 'bet365_real');
  const anyUnknown = legOddsSrc.some(s => s === 'unknown');
  const odds_source = allBet365 ? 'bet365_real' : anyUnknown ? 'mixed' : 'estimated';

  // ── source trace ────────────────────────────────────────────────────────
  const generated_by = combo._is_faixa_decompose ? 'jackpot_decomposition'
                     : combo._is_golden           ? 'golden_engine'
                     : combo._is_bet_builder      ? 'combo_builder'
                     : 'tier_native';

  const source_family = tier === 'tier3'       ? 'jackpot'
                      : tier === 'tier4'        ? 'mega'
                      : tier === 'golden'       ? 'golden'
                      : tier === 'bet_builder'  ? 'bet_builder'
                      : 'tier2';

  const dataSrcSet = new Set();
  for (const l of legs) {
    if (l.bet365 === true || l._is_direct_b365)   dataSrcSet.add('bet365');
    if (l.source === 'tipster' || l._is_faixa_mirror) dataSrcSet.add('tipster');
    if (l.evidence_pack?.has_team_profile)         dataSrcSet.add('sofascore');
    if (l.evidence_pack?.has_recent_form)          dataSrcSet.add('d1_history');
  }

  const source_trace = {
    generated_by,
    source_family,
    odds_source,
    data_sources:        [...dataSrcSet],
    parent_combo_id:     combo.parent_combo_id     ?? null,
    method_group_id:     combo.method_group_id     ?? null,
    decomposition_level: combo.decomposition_level ?? null,
    generated_at:        null,
    source_confidence:   allBet365 ? 'high' : anyUnknown ? 'low' : 'medium',
  };

  // ── evidence pack (aggregated from legs) ───────────────────────────────
  const allHaveOdd     = legs.every(l => (l.odd ?? 0) > 1.0);
  const allHaveMkt     = legs.every(l => !!(l.stat || l.market));
  const allHaveKickoff = legs.every(l => !!l.kickoff);
  const allResolvable  = legs.every(l => {
    const m = (l.stat || l.market || '').toUpperCase();
    return !(/PLAYER_/.test(m) && !l.player_name?.trim());
  });
  const allHaveProfile = legs.every(l => !!(l.evidence_pack?.has_team_profile ?? l.home_team));

  const _avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const dqArr = legs.map(l => l.evidence_pack?.data_quality_score).filter(s => s != null);
  const gsArr = legs.map(l => l.golden_support_score).filter(s => s != null);

  const ep_missing = [];
  if (!allHaveOdd)     ep_missing.push('some_legs_missing_real_odd');
  if (!allHaveMkt)     ep_missing.push('some_legs_missing_market');
  if (!allHaveKickoff) ep_missing.push('some_legs_missing_kickoff');
  if (!allResolvable)  ep_missing.push('some_legs_unresolvable');
  if (!allHaveProfile) ep_missing.push('some_legs_missing_team_data');

  const evidence_pack = {
    all_legs_have_real_odd:     allHaveOdd,
    all_legs_have_market:       allHaveMkt,
    all_legs_have_kickoff:      allHaveKickoff,
    all_legs_resolvable:        allResolvable,
    all_legs_have_team_profile: allHaveProfile,
    min_data_quality_score:     dqArr.length ? Math.min(...dqArr) : null,
    avg_data_quality_score:     _avg(dqArr),
    min_golden_support_score:   gsArr.length ? Math.min(...gsArr) : null,
    avg_golden_support_score:   _avg(gsArr),
    missing:   ep_missing,
    weak_legs: legs.filter(l => (l.evidence_pack?.data_quality_score ?? 100) < 50)
                   .map(l => l.match ?? `${l.home_team ?? '?'} v ${l.away_team ?? '?'}`),
  };

  // ── method validation ───────────────────────────────────────────────────
  const hasDrawLeg = legs.some(l => /empate|draw|^x$/i.test(String(l.direction || l.selection || '')));
  const hasPlayerGap = legs.some(l => /PLAYER_/i.test(l.stat || '') && !l.player_name?.trim());

  let method_family;
  if (_is_result_btts || _is_draw_btts) method_family = 'result_btts';
  else if (_is_ht_method)               method_family = 'ht';
  else if (combo._is_bet_builder)       method_family = 'bet_builder';
  else if (tier === 'tier3')            method_family = 'jackpot';
  else if (tier === 'tier4')            method_family = 'mega';
  else                                  method_family = 'combo';

  const is_method_valid = !_is_draw_btts && !hasPlayerGap;
  const rejection_reason = _is_draw_btts         ? 'result_btts_draw_not_allowed'
                         : hasPlayerGap           ? 'player_market_missing_name'
                         : null;

  const method_validation = {
    method_family,
    method_purity_score: is_method_valid ? 100 : 0,
    is_method_valid,
    rejection_reason,
    warnings: [],
  };

  // ── resolvability ───────────────────────────────────────────────────────
  const resolvability = {
    can_resolve:               allResolvable,
    result_source_available:   allResolvable ? ['sofascore', 'espn'] : [],
    expected_result_source:    allResolvable ? 'sofascore' : 'none',
    unsupported_reason:        allResolvable ? null : 'unresolvable_leg_in_combo',
    result_confidence_expected: allResolvable && allHaveKickoff ? 'high'
                              : allResolvable ? 'medium' : 'low',
  };

  // ── score breakdown ─────────────────────────────────────────────────────
  const penalties = [];
  const boosts    = [];
  if (_is_draw_btts)   penalties.push('draw_btts_blocked');
  if (!allHaveKickoff) penalties.push('some_legs_missing_kickoff');
  if (anyUnknown)      penalties.push('some_odds_unknown_source');
  if (allBet365 && allHaveOdd)              boosts.push('all_legs_bet365_verified');
  if ((_avg(gsArr) ?? 0) >= 75)             boosts.push('high_avg_golden_support');

  const score_breakdown = {
    data_coverage_score:  _avg(dqArr) ?? 0,
    source_score:         allBet365 ? 100 : anyUnknown ? 25 : 60,
    method_score:         is_method_valid ? 100 : 0,
    resolvability_score:  allResolvable ? 100 : 0,
    golden_support_score: _avg(gsArr) ?? 0,
    penalties,
    boosts,
  };

  // ── audit status ────────────────────────────────────────────────────────
  const audit_reasons = [];
  const trust_level = !is_method_valid     ? (audit_reasons.push(`method_blocked: ${rejection_reason}`), 'blocked')
                    : allBet365 && allResolvable && allHaveMkt
                                             ? (audit_reasons.push('all_legs_bet365_verified'), 'verified')
                    : odds_source !== 'unknown' && allResolvable
                                             ? (audit_reasons.push('partial_evidence_present'), 'supported')
                    :                          (audit_reasons.push(allResolvable ? 'missing_some_evidence' : 'unresolvable_combo'), 'partial');

  const pickAuditStatus = trust_level === 'blocked' ? 'blocked'
                        : trust_level === 'partial'  ? 'observation'
                        : 'valid';

  const audit_status = {
    trust_level,
    pickAuditStatus,
    can_show_user: trust_level !== 'blocked',
    can_post:      is_method_valid && allResolvable && !_is_draw_btts,
    audit_reasons,
  };

  return {
    source_trace,
    evidence_pack,
    method_validation,
    resolvability,
    score_breakdown,
    audit_status,
    estimated_return_050: calcReturn050(combined_odd),
  };
}

// ---------------------------------------------------------------------------
// Section 8c — Golden Score Calibration  (P3.1.3)
// ---------------------------------------------------------------------------

/**
 * 8-component Golden Score formula.
 *
 * Thresholds (see premiumPicks golden engine):
 *   >= 70  → valid
 *   45–69  → observation-forte
 *   20–44  → observation
 *   < 20   → hidden/weak
 *   blocked  → any critical rejection
 *
 * @param {object} combo
 * @returns {{ goldenScore: number, components: object }}
 */
export function calcGoldenScore(combo) {
  const legs        = combo.legs || [];
  const combined_odd = combo.combined_odd || 0;
  const _avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const dqArr = legs.map(l => l.evidence_pack?.data_quality_score).filter(s => s != null);
  const gsArr = legs.map(l => l.golden_support_score).filter(s => s != null);
  const avgDQ = _avg(dqArr);   // 0-100
  const avgGS = _avg(gsArr);   // 0-100

  const legOddsSrc = legs.map(l => {
    if (l.bet365 === true || l._is_direct_b365) return 'bet365_real';
    if (l.pinnacle === true || l._has_steam)    return 'estimated';
    if (l.source === 'tipster' || l._is_faixa_mirror) return 'tipster';
    return 'unknown';
  });
  const allBet365  = legOddsSrc.every(s => s === 'bet365_real');
  const anyUnknown = legOddsSrc.some(s  => s === 'unknown');

  const allHaveMkt     = legs.every(l => !!(l.stat || l.market));
  const allResolvable  = legs.every(l => {
    const m = (l.stat || l.market || '').toUpperCase();
    return !(/PLAYER_/.test(m) && !l.player_name?.trim());
  });
  const allHaveKickoff = legs.every(l => !!l.kickoff);
  const hasDraw        = legs.some(l => /empate|draw|^x$/i.test(String(l.direction || l.selection || '')));
  const isBlocked      = hasDraw || !!combo._is_draw_btts;

  // P3.5: market availability per leg
  const allMarketAvailable = legs.every(l => l.market_validation?.market_available !== false);
  const anyMarketMissing   = legs.some(l => l.market_validation?.market_available === false);

  // Component scores
  const data_quality_component      = Math.round(avgDQ * 0.20);              // 0–20
  const source_trace_component      = allBet365 ? 15 : anyUnknown ? 0 : 8;   // 0–15
  // P3.5: market_validation component penalized if any leg market is explicitly missing
  const market_validation_component = !allHaveMkt ? 0
                                    : anyMarketMissing ? 8            // partial credit
                                    : 15;                             // 0–15
  const method_validation_component = !isBlocked ? 15 : 0;                   // 0–15
  const resolvability_component     = allResolvable
    ? (allHaveKickoff ? 15 : 8) : 0;                                          // 0–15
  const golden_support_component    = Math.round(avgGS * 0.15);              // 0–15
  const odds_range_component        = (combined_odd >= 9 && combined_odd <= 30) ? 5 : 0; // 0–5

  let   risk_penalty_component      = 0;                                       // up to -20
  if (isBlocked)           risk_penalty_component = -20;
  else if (!allResolvable) risk_penalty_component -= 10;
  else if (anyUnknown)     risk_penalty_component -= 5;
  if (anyMarketMissing && !isBlocked) risk_penalty_component -= 5;  // P3.5

  const raw = data_quality_component + source_trace_component
            + market_validation_component + method_validation_component
            + resolvability_component + golden_support_component
            + odds_range_component + risk_penalty_component;

  return {
    goldenScore: Math.max(0, Math.min(100, Math.round(raw))),
    components: {
      data_quality_component,
      source_trace_component,
      market_validation_component,
      method_validation_component,
      resolvability_component,
      golden_support_component,
      odds_range_component,
      risk_penalty_component,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 9 — Utility
// ---------------------------------------------------------------------------

/**
 * Returns the payout for a R$0.50 stake at the given decimal odd.
 *
 * @param {number|null} odd  — decimal odd (e.g. 2.10)
 * @returns {number|null}    — rounded to 2 decimal places, or null if invalid
 */
export function calcReturn050(odd) {
  if (!odd || odd <= 0) return null;
  return Math.round(odd * 0.50 * 100) / 100;
}
