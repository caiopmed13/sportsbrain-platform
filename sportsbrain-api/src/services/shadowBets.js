/**
 * shadowBets.js
 * =============================================================================
 * Shadow Betting service — records every valid pick as a simulated bet in D1.
 *
 * Exported functions:
 *   makeShadowBetId(input)                     — deterministic ID (max 200 chars)
 *   shouldCreateMainShadowBet(item)            — eligibility for main shadow bet
 *   shouldCreateLabShadowBet(item)             — eligibility for lab shadow bet
 *   buildShadowBetFromPick(pick, options?)     — builds D1 record from pick
 *   buildShadowBetFromCombo(combo, options?)   — builds D1 record from combo
 *   ingestShadowBets(records, env)             — D1 batch INSERT OR IGNORE
 *   queryShadowBetStats(env)                   — summary stats for source coverage
 *
 * Eligibility rules:
 *   Main shadow: valid + verified/supported + can_post + odd > 1 + fixture anchor + kickoff
 *   Lab shadow:  observation (or valid without verified/supported trust level)
 *   Never: blocked / hidden / weak / no-odd / no-fixture / no-kickoff
 *
 * Observation picks go to lab shadow ONLY — never mixed with main shadow.
 * D1 failure must NOT break Premium pick generation.
 * =============================================================================
 */

// P3.9 R6H: confidence canônico recomputado no momento que o audit sync
// roda — quando audit_status/trust_level/can_post finalmente existem
// no pick. Antes, o score persistido no INSERT vinha de uma chamada
// anterior em premiumPicks.js que NÃO tinha esses campos, gerando
// score sistematicamente baixo (~20pts a menos vs. canônico).
import { calcBetConfidenceScore } from './betConfidence.js';

const CHUNK_SIZE = 80;

// ---------------------------------------------------------------------------
// 1. ID builder
// ---------------------------------------------------------------------------

export function makeShadowBetId(input) {
  const fixture  = String(input.bet365_event_id || input.fixture_id || 'unk').replace(/[^a-z0-9]/gi, '');
  const market   = String(input.market || input.stat || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const sel      = String(input.selection || input.direction || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const date     = String(input.pick_date || '').slice(0, 10);
  const combo    = input.is_combo ? 'c' : 's';
  const tier     = String(input.source_family || input.tier || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 6);
  return `sb|${date}|${fixture}|${market}|${sel}|${tier}|${combo}`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// 2. Eligibility checks
// ---------------------------------------------------------------------------

function _getAuditFields(item) {
  const auditObj        = item?.audit_status || {};
  const pickAuditStatus = typeof auditObj === 'string'
    ? auditObj
    : (auditObj.pickAuditStatus || auditObj.audit_status || 'unknown');
  const trustLevel = auditObj.trust_level || item?.trust_level || 'unknown';
  const canPost    = auditObj.can_post ?? item?.can_post ?? false;
  return { pickAuditStatus, trustLevel, canPost };
}

export function shouldCreateMainShadowBet(item) {
  if (!item) return false;
  if (!item.odd || item.odd <= 1.0) return false;
  if (!(item.bet365_event_id || item.fixture_id)) return false;
  if (!(item.kickoff || item.kickoff_utc)) return false;
  if (item.market_available === false) return false;

  const { pickAuditStatus, trustLevel, canPost } = _getAuditFields(item);
  if (pickAuditStatus !== 'valid') return false;
  if (!['verified', 'supported'].includes(trustLevel)) return false;
  if (!canPost) return false;
  return true;
}

export function shouldCreateLabShadowBet(item) {
  if (!item) return false;
  if (!item.odd || item.odd <= 1.0) return false;
  if (!(item.bet365_event_id || item.fixture_id)) return false;

  // Already main-eligible → goes to main, not lab
  if (shouldCreateMainShadowBet(item)) return false;

  const { pickAuditStatus, trustLevel, canPost } = _getAuditFields(item);
  if (pickAuditStatus === 'observation') return true;
  // P3.8.3 fix: picks with missing/undefined audit_status (unknown) go to lab for observation
  if (pickAuditStatus === 'unknown') return true;
  // valid but without verified/supported trust → lab only
  if (pickAuditStatus === 'valid' && !['verified', 'supported'].includes(trustLevel)) return true;
  // valid + trusted but can_post=false → lab only (P3.8.2 fix: needs more history to unlock main)
  if (pickAuditStatus === 'valid' && ['verified', 'supported'].includes(trustLevel) && !canPost) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 3. Record builders
// ---------------------------------------------------------------------------

export function buildShadowBetFromPick(pick, options = {}) {
  if (!pick) return null;

  const isMain = shouldCreateMainShadowBet(pick);
  const isLab  = !isMain && shouldCreateLabShadowBet(pick);
  if (!isMain && !isLab) return null;

  const {
    stakeSimulated    = 0.50,
    pickDate          = new Date().toISOString().slice(0, 10),
    betConfidenceResult = null,
  } = options;

  const odd        = pick.odd;
  const potReturn  = +(odd * stakeSimulated).toFixed(4);
  const potProfit  = +(potReturn - stakeSimulated).toFixed(4);
  const conf       = betConfidenceResult || { score: 0, tier: 'no_bet', components: {} };

  const { pickAuditStatus, trustLevel, canPost } = _getAuditFields(pick);

  const id = makeShadowBetId({
    bet365_event_id: pick.bet365_event_id,
    fixture_id:      pick.fixture_id,
    market:          pick.stat || pick.market,
    selection:       pick.selection || pick.direction,
    pick_date:       pickDate,
    source_family:   pick.source_family || pick.source,
    is_combo:        false,
  });

  return {
    id,
    pick_date:            pickDate,
    source_pick_id:       pick.match_id || pick.id || null,
    source_combo_id:      null,
    fixture_id:           pick.fixture_id || null,
    bet365_event_id:      pick.bet365_event_id ? String(pick.bet365_event_id) : null,
    sport:                pick.sport    || 'football',
    league:               pick.league   || null,
    home_team:            pick.home_team || null,
    away_team:            pick.away_team || null,
    kickoff:              pick.kickoff  || pick.kickoff_utc || null,
    tier:                 pick.tier     || pick.source_family || null,
    source_family:        pick.source_family || pick.source || null,
    method_family:        pick.method_family || null,
    is_combo:             0,
    legs_count:           1,
    market:               pick.stat || pick.market || null,
    selection:            pick.selection || pick.direction || null,
    line:                 pick.line  ?? null,
    period:               pick.period || null,
    player_name:          pick.player_name || null,
    odd,
    combined_odd:         odd,
    stake_simulated:      stakeSimulated,
    potential_return:     potReturn,
    potential_profit:     potProfit,
    audit_status:         pickAuditStatus,
    trust_level:          trustLevel,
    can_post:             canPost ? 1 : 0,
    bet_confidence_score: conf.score,
    bet_confidence_tier:  conf.tier,
    golden_score:         pick.golden_score         ?? null,
    golden_support_score: pick.golden_support_score ?? null,
    premium_quality_score: pick.premiumQualityScore ?? pick.premium_quality_score ?? null,
    combo_quality_score:  null,
    data_quality_score:   pick.data_quality_score   ?? null,
    market_available:     pick.market_available != null ? (pick.market_available ? 1 : 0) : null,
    availability_confidence: pick.availability_confidence || null,
    odds_snapshot_id:     pick.odds_snapshot_id     || null,
    entry_odd:            pick.entry_odd || odd,
    entry_line:           pick.entry_line || pick.line || null,
    entry_captured_at:    pick.entry_captured_at || new Date().toISOString(),
    latest_odd:           pick.odds_movement?.latest_odd ?? odd,
    closing_odd:          null,
    clv_pct:              null,
    clv_status:           pick.clv_status || 'unknown',
    result_status:        'pending',
    result_source:        null,
    result_confidence:    null,
    profit_unit:          null,
    profit_brl:           null,
    settled_at:           null,
    training_eligible:    isMain ? 1 : 0,
    monetization_eligible: 0,
    notes_json:           null,
    _shadow_type:         isMain ? 'main' : 'lab',
  };
}

export function buildShadowBetFromCombo(combo, options = {}) {
  if (!combo?.selections?.length) return null;
  if (!combo.combined_odd || combo.combined_odd <= 1.0) return null;
  if (!combo.can_post) return null;
  if (!(combo.bet365_event_id || combo.fixture_id || combo.selections[0]?.bet365_event_id)) return null;

  const {
    stakeSimulated    = 0.50,
    pickDate          = new Date().toISOString().slice(0, 10),
    betConfidenceResult = null,
  } = options;

  const odd       = combo.combined_odd;
  const potReturn = +(odd * stakeSimulated).toFixed(4);
  const potProfit = +(potReturn - stakeSimulated).toFixed(4);
  const conf      = betConfidenceResult || { score: 0, tier: 'no_bet', components: {} };
  const legs      = combo.selections.length;

  const { pickAuditStatus, trustLevel, canPost } = _getAuditFields(combo);

  const id = makeShadowBetId({
    bet365_event_id: combo.bet365_event_id || combo.selections[0]?.bet365_event_id,
    fixture_id:      combo.fixture_id,
    market:          combo.market || `combo_${legs}`,
    selection:       null,
    pick_date:       pickDate,
    source_family:   combo.source_family || combo.tier,
    is_combo:        true,
  });

  return {
    id,
    pick_date:            pickDate,
    source_pick_id:       null,
    source_combo_id:      combo.combo_id || combo.id || null,
    fixture_id:           combo.fixture_id || null,
    bet365_event_id:      combo.bet365_event_id ? String(combo.bet365_event_id)
                          : combo.selections[0]?.bet365_event_id
                          ? String(combo.selections[0].bet365_event_id) : null,
    sport:                combo.sport   || 'football',
    league:               combo.league  || null,
    home_team:            combo.home_team || null,
    away_team:            combo.away_team || null,
    kickoff:              combo.kickoff  || null,
    tier:                 combo.tier    || combo.source_family || null,
    source_family:        combo.source_family || null,
    method_family:        null,
    is_combo:             1,
    legs_count:           legs,
    market:               combo.market  || null,
    selection:            null,
    line:                 null,
    period:               null,
    player_name:          null,
    odd,
    combined_odd:         odd,
    stake_simulated:      stakeSimulated,
    potential_return:     potReturn,
    potential_profit:     potProfit,
    audit_status:         pickAuditStatus,
    trust_level:          trustLevel,
    can_post:             canPost ? 1 : 0,
    bet_confidence_score: conf.score,
    bet_confidence_tier:  conf.tier,
    golden_score:         combo.golden_score     ?? null,
    golden_support_score: null,
    premium_quality_score: null,
    combo_quality_score:  combo.combo_quality_score ?? null,
    data_quality_score:   null,
    market_available:     null,
    availability_confidence: null,
    odds_snapshot_id:     null,
    entry_odd:            odd,
    entry_line:           null,
    entry_captured_at:    new Date().toISOString(),
    latest_odd:           odd,
    closing_odd:          null,
    clv_pct:              null,
    clv_status:           'unknown',
    result_status:        'pending',
    result_source:        null,
    result_confidence:    null,
    profit_unit:          null,
    profit_brl:           null,
    settled_at:           null,
    training_eligible:    0,
    monetization_eligible: 0,
    notes_json:           null,
    _shadow_type:         'main',
  };
}

// ---------------------------------------------------------------------------
// 4. D1 ingest
// ---------------------------------------------------------------------------

const INSERT_SQL = `INSERT OR IGNORE INTO shadow_bets (
  id, pick_date, source_pick_id, source_combo_id, fixture_id, bet365_event_id,
  sport, league, home_team, away_team, kickoff,
  tier, source_family, method_family, is_combo, legs_count,
  market, selection, line, period, player_name,
  odd, combined_odd, stake_simulated, potential_return, potential_profit,
  audit_status, trust_level, can_post, bet_confidence_score, bet_confidence_tier,
  golden_score, golden_support_score, premium_quality_score, combo_quality_score, data_quality_score,
  market_available, availability_confidence, odds_snapshot_id,
  entry_odd, entry_line, entry_captured_at, latest_odd, closing_odd, clv_pct, clv_status,
  result_status, training_eligible, monetization_eligible, notes_json
) VALUES (
  ?,?,?,?,?,?,
  ?,?,?,?,?,
  ?,?,?,?,?,
  ?,?,?,?,?,
  ?,?,?,?,?,
  ?,?,?,?,?,
  ?,?,?,?,?,
  ?,?,?,
  ?,?,?,?,?,?,?,
  ?,?,?,?
)`;

export async function ingestShadowBets(records, env) {
  const result = { ingested: 0, skipped_invalid: 0, skipped_dedup: 0, skipped_no_table: false, error: null };
  if (!env?.SB_DB || !records?.length) return result;

  const uniqueMap = new Map();
  for (const r of records) {
    if (!r?.id) { result.skipped_invalid++; continue; }
    if (uniqueMap.has(r.id)) { result.skipped_dedup++; continue; }
    uniqueMap.set(r.id, r);
  }

  const unique = [...uniqueMap.values()];
  if (!unique.length) return result;

  const chunks = [];
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) chunks.push(unique.slice(i, i + CHUNK_SIZE));

  const runBatch = async () => {
    for (const chunk of chunks) {
      const stmts = chunk.map(r => env.SB_DB.prepare(INSERT_SQL).bind(
        r.id, r.pick_date, r.source_pick_id, r.source_combo_id, r.fixture_id, r.bet365_event_id,
        r.sport, r.league, r.home_team, r.away_team, r.kickoff,
        r.tier, r.source_family, r.method_family, r.is_combo, r.legs_count,
        r.market, r.selection, r.line, r.period, r.player_name,
        r.odd, r.combined_odd, r.stake_simulated, r.potential_return, r.potential_profit,
        r.audit_status, r.trust_level, r.can_post, r.bet_confidence_score, r.bet_confidence_tier,
        r.golden_score, r.golden_support_score, r.premium_quality_score, r.combo_quality_score, r.data_quality_score,
        r.market_available, r.availability_confidence, r.odds_snapshot_id,
        r.entry_odd, r.entry_line, r.entry_captured_at, r.latest_odd, r.closing_odd, r.clv_pct, r.clv_status,
        r.result_status, r.training_eligible, r.monetization_eligible, r.notes_json
      ));
      const batchResults = await env.SB_DB.batch(stmts);
      result.ingested += batchResults.filter(r => (r?.meta?.changes ?? 0) > 0).length;
    }
  };

  try {
    await runBatch();
  } catch (e) {
    if (/no such table/i.test(e?.message || '')) {
      // P3.8.3 auto-migration: create table on first use and retry once
      try {
        await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS shadow_bets (
          id TEXT PRIMARY KEY,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          pick_date TEXT,
          source_pick_id TEXT,
          source_combo_id TEXT,
          fixture_id TEXT,
          bet365_event_id TEXT,
          sport TEXT,
          league TEXT,
          home_team TEXT,
          away_team TEXT,
          kickoff TEXT,
          tier TEXT,
          source_family TEXT,
          method_family TEXT,
          is_combo INTEGER DEFAULT 0,
          legs_count INTEGER,
          market TEXT,
          selection TEXT,
          line REAL,
          period TEXT,
          player_name TEXT,
          odd REAL,
          combined_odd REAL,
          stake_simulated REAL DEFAULT 0.50,
          potential_return REAL,
          potential_profit REAL,
          audit_status TEXT,
          trust_level TEXT,
          can_post INTEGER,
          bet_confidence_score REAL,
          bet_confidence_tier TEXT,
          golden_score REAL,
          golden_support_score REAL,
          premium_quality_score REAL,
          combo_quality_score REAL,
          data_quality_score REAL,
          market_available INTEGER,
          availability_confidence TEXT,
          odds_snapshot_id TEXT,
          entry_odd REAL,
          entry_line REAL,
          entry_captured_at TEXT,
          latest_odd REAL,
          closing_odd REAL,
          clv_pct REAL,
          clv_status TEXT,
          result_status TEXT DEFAULT 'pending',
          result_source TEXT,
          result_confidence TEXT,
          profit_unit REAL,
          profit_brl REAL,
          settled_at TEXT,
          training_eligible INTEGER DEFAULT 0,
          monetization_eligible INTEGER DEFAULT 0,
          notes_json TEXT
        )`);
        result.auto_migrated = true;
        result.ingested = 0; // reset before retry
        await runBatch();
      } catch (migErr) {
        result.skipped_no_table = true;
        result.error = migErr.message;
      }
      return result;
    }
    result.error = e.message;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 5. Stats query
// ---------------------------------------------------------------------------

export async function queryShadowBetStats(env) {
  if (!env?.SB_DB) return null;
  try {
    const [totRow, tierRow] = await Promise.all([
      env.SB_DB.prepare(
        `SELECT COUNT(*) as n,
                SUM(CASE WHEN result_status='pending'  THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN result_status='resolved' THEN 1 ELSE 0 END) as resolved,
                SUM(CASE WHEN training_eligible=1      THEN 1 ELSE 0 END) as main_bets
         FROM shadow_bets`
      ).first().catch(() => null),
      env.SB_DB.prepare(
        `SELECT bet_confidence_tier, COUNT(*) as n
         FROM shadow_bets WHERE pick_date >= date('now', '-7 days')
         GROUP BY bet_confidence_tier ORDER BY n DESC`
      ).all().catch(() => ({ results: [] })),
    ]);

    const total    = totRow?.n        ?? 0;
    const pending  = totRow?.pending  ?? 0;
    const resolved = totRow?.resolved ?? 0;
    const mainBets = totRow?.main_bets ?? 0;
    const byTier   = Object.fromEntries(
      (tierRow?.results || []).map(r => [r.bet_confidence_tier, r.n])
    );

    const coverage_score = total === 0 ? 0 : resolved > 0 ? 5 : total > 0 ? 3 : 0;

    return {
      status:        total === 0 ? 'EMPTY' : 'OK',
      total_bets:    total,
      main_bets:     mainBets,
      pending,
      resolved,
      by_tier_7d:    byTier,
      coverage_score,
    };
  } catch (e) {
    if (/no such table/i.test(e?.message || ''))
      return { status: 'TABLE_MISSING', coverage_score: 0, total_bets: 0, table_missing: true };
    return null;
  }
}

// ---------------------------------------------------------------------------
// 6. Shadow Creation Debug (P3.8.2) — admin/debug only, never affects ingest
// ---------------------------------------------------------------------------

function _getShadowSkipReason(item) {
  if (!item.odd || item.odd <= 1.0) return 'missing_odd';
  if (!(item.bet365_event_id || item.fixture_id)) return 'no_fixture';
  if (item.market_available === false) return 'market_unavailable';
  if (!(item.kickoff || item.kickoff_utc)) return 'no_kickoff';
  const { pickAuditStatus, trustLevel, canPost } = _getAuditFields(item);
  if (pickAuditStatus !== 'valid' && pickAuditStatus !== 'observation') return 'audit_not_valid';
  // After P3.8.2 fix these should never appear — tracked to verify fix holds:
  if (pickAuditStatus === 'valid' && ['verified', 'supported'].includes(trustLevel) && !canPost) return 'can_post_false';
  if (pickAuditStatus === 'valid' && !['verified', 'supported'].includes(trustLevel)) return 'trust_not_supported';
  return 'unknown';
}

export function buildShadowCreationDebug(candidates, ingestResult) {
  const reasons = {
    audit_not_valid: 0, trust_not_supported: 0, can_post_false: 0,
    market_unavailable: 0, missing_odd: 0,
    // Reserved for future eligibility checks — keep these keys even if currently 0:
    missing_source_trace: 0,
    missing_evidence_pack: 0,
    unresolvable: 0,
    no_fixture: 0, no_kickoff: 0,
    duplicate_id: ingestResult?.skipped_dedup ?? 0,
    d1_error: ingestResult?.error ? 1 : 0,
    unknown: 0,
  };

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      total_candidates: 0, main_candidates: 0, lab_candidates: 0,
      created: ingestResult?.ingested ?? 0, skipped: 0,
      skipped_by_reason: reasons,
      sample_created: [], sample_skipped: [],
    };
  }

  let mainCandidates = 0, labCandidates = 0;
  const sampleCreated = [], sampleSkipped = [];

  for (const item of candidates) {
    if (!item) continue;
    const isMain = shouldCreateMainShadowBet(item);
    const isLab  = !isMain && shouldCreateLabShadowBet(item);

    if (isMain || isLab) {
      if (isMain) mainCandidates++;
      else labCandidates++;
      if (sampleCreated.length < 3) {
        const { pickAuditStatus, trustLevel } = _getAuditFields(item);
        sampleCreated.push({
          pick_id:     item.match_id || item.id || null,
          shadow_type: isMain ? 'main' : 'lab',
          audit_status: pickAuditStatus,
          trust_level:  trustLevel,
          odd:          item.odd ?? null,
        });
      }
    } else {
      const reason = _getShadowSkipReason(item);
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      if (sampleSkipped.length < 3) {
        const { pickAuditStatus, trustLevel, canPost } = _getAuditFields(item);
        sampleSkipped.push({
          pick_id:          item.match_id || item.id || null,
          reason,
          audit_status:     pickAuditStatus,
          trust_level:      trustLevel,
          can_post:         canPost,
          odd:              item.odd ?? null,
          market_available: item.market_available ?? null,
        });
      }
    }
  }

  const valid  = candidates.filter(Boolean);
  const skipped = valid.length - mainCandidates - labCandidates;

  return {
    total_candidates: valid.length,
    main_candidates:  mainCandidates,
    lab_candidates:   labCandidates,
    created:          ingestResult?.ingested ?? 0,
    skipped,
    skipped_by_reason: reasons,
    sample_created:   sampleCreated,
    sample_skipped:   sampleSkipped,
  };
}

// ---------------------------------------------------------------------------
// 7. Confidence Annotation Sync (P3.8.4.6)
//    UPDATE existing shadow_bets rows with annotation data computed AFTER
//    early ingest. Never INSERTs, never touches result fields or training_eligible.
// ---------------------------------------------------------------------------

const SYNC_CHUNK_SIZE = 25;

// P3.9 R6H-B: bet_confidence_score e bet_confidence_tier REMOVIDOS do SET
// desta função porque ela rodava em corrida com syncShadowBetAuditAnnotations
// (ambas via ctx.waitUntil em premiumPicks.js). O annotation sync recebia
// pick.bet_confidence_score STALE (calculado em premiumPicks.js L1394 antes
// da audit annotation), e quando rodava DEPOIS do audit sync, sobrescrevia
// o score canônico que o R6H havia gravado. Agora, score/tier são tocados
// EXCLUSIVAMENTE por syncShadowBetAuditAnnotations (canônico R6H).
const SYNC_UPDATE_SQL = `UPDATE shadow_bets SET
  golden_score=?, golden_support_score=?,
  premium_quality_score=?, combo_quality_score=?, data_quality_score=?,
  market_available=?, availability_confidence=?,
  odds_snapshot_id=?,
  entry_odd=?, entry_line=?, entry_captured_at=?,
  latest_odd=?, clv_pct=?, clv_status=?,
  notes_json=?
WHERE id=?`;
// Intentionally excluded:
//   - training_eligible, result_status, profit_brl, settled_at,
//     result_source, result_confidence — set by ingest/resolver.
//   - bet_confidence_score, bet_confidence_tier — P3.9 R6H-B: canonical
//     audit sync é a fonte única dessas colunas (elimina race condition).

export async function syncShadowBetAnnotations(items, env, options = {}) {
  const t0 = Date.now();
  const result = {
    attempted:    0,
    updated:      0,
    skipped:      0,
    batch_calls:  0,
    errors:       0,
    duration_ms:  0,
    sample_ids:   [],
  };

  if (!env?.SB_DB || !Array.isArray(items) || items.length === 0) return result;

  const pickDate = options.pickDate || new Date().toISOString().slice(0, 10);

  // Build UPDATE payloads — reconstruct the same ID used during early ingest
  const updates = [];
  for (const pick of items) {
    if (!pick) continue;
    result.attempted++;

    // Determine combo vs single-pick to match the ID generated at ingest time
    const isCombo = !!(pick.is_combo || (Array.isArray(pick.selections) && pick.selections.length > 1));

    const id = isCombo
      ? makeShadowBetId({
          bet365_event_id: pick.bet365_event_id || pick.selections?.[0]?.bet365_event_id,
          fixture_id:      pick.fixture_id,
          market:          pick.market || `combo_${pick.selections?.length || 2}`,
          selection:       null,
          pick_date:       pickDate,
          source_family:   pick.source_family || pick.tier,
          is_combo:        true,
        })
      : makeShadowBetId({
          bet365_event_id: pick.bet365_event_id,
          fixture_id:      pick.fixture_id,
          market:          pick.stat || pick.market,
          selection:       pick.selection || pick.direction,
          pick_date:       pickDate,
          source_family:   pick.source_family || pick.source,
          is_combo:        false,
        });

    // P3.9 R6H-B: NÃO computa mais confScore/confTier aqui — esses dois
    // campos saíram do contrato de syncShadowBetAnnotations para eliminar
    // a race com syncShadowBetAuditAnnotations (canonical, R6H).

    updates.push({
      id,
      golden_score:            pick.golden_score            ?? null,
      golden_support_score:    pick.golden_support_score   ?? null,
      premium_quality_score:   pick.premiumQualityScore     ?? pick.premium_quality_score ?? null,
      combo_quality_score:     isCombo ? (pick.combo_quality_score ?? null) : null,
      data_quality_score:      pick.data_quality_score      ?? null,
      market_available:        pick.market_available != null ? (pick.market_available ? 1 : 0) : null,
      availability_confidence: pick.availability_confidence || null,
      odds_snapshot_id:        pick.odds_snapshot_id        || null,
      entry_odd:               pick.entry_odd  || pick.odd  || null,
      entry_line:              pick.entry_line || pick.line || null,
      entry_captured_at:       pick.entry_captured_at || new Date().toISOString(),
      latest_odd:              pick.odds_movement?.latest_odd ?? pick.odd ?? null,
      clv_pct:                 pick.clv_pct    ?? null,
      clv_status:              pick.clv_status  || null,
      notes_json:              pick.notes_json  || null,
    });
  }

  if (updates.length === 0) return result;

  // Batch UPDATE in safe chunks to stay within D1 budget
  const chunks = [];
  for (let i = 0; i < updates.length; i += SYNC_CHUNK_SIZE) {
    chunks.push(updates.slice(i, i + SYNC_CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const stmts = chunk.map(u => env.SB_DB.prepare(SYNC_UPDATE_SQL).bind(
        // P3.9 R6H-B: bet_confidence_score/tier NÃO entram mais aqui.
        u.golden_score, u.golden_support_score,
        u.premium_quality_score, u.combo_quality_score, u.data_quality_score,
        u.market_available, u.availability_confidence,
        u.odds_snapshot_id,
        u.entry_odd, u.entry_line, u.entry_captured_at,
        u.latest_odd, u.clv_pct, u.clv_status,
        u.notes_json,
        u.id
      ));
      const batchRes = await env.SB_DB.batch(stmts);
      result.batch_calls++;
      for (let i = 0; i < batchRes.length; i++) {
        const changes = batchRes[i]?.meta?.changes ?? 0;
        if (changes > 0) {
          result.updated++;
          if (result.sample_ids.length < 5) result.sample_ids.push(chunk[i].id);
        } else {
          result.skipped++;  // row missing or no changes needed
        }
      }
    } catch (e) {
      result.errors++;
      console.warn('[syncShadowBetAnnotations] batch error:', e?.message);
    }
  }

  result.duration_ms = Date.now() - t0;
  return result;
}

// ---------------------------------------------------------------------------
// 8. Audit Annotation Sync (P3.8.6.5)
//    UPDATE shadow_bets rows with formal audit fields from buildPickAudit output.
//    Only updates rows with audit_status='unknown' — never overwrites known status.
//    Also updates training_eligible when all eligibility criteria are met.
// ---------------------------------------------------------------------------

const AUDIT_SYNC_CHUNK_SIZE = 40;

// P3.9 R6H: o UPDATE de audit agora também sincroniza bet_confidence_score
// e bet_confidence_tier — recomputados pelo calcBetConfidenceScore com o
// audit_status agora setado. Isso elimina o gap STALE que o R6F dry-run
// provou (score_delta_avg +19.83 entre db_score e computed_score nos 201
// rows do run 26175408513). WHERE audit_status='unknown' mantém o sync
// idempotente — só atualiza rows que ainda não viram annotation.
const AUDIT_SYNC_SQL = `UPDATE shadow_bets SET
  audit_status=?, trust_level=?, can_post=?,
  source_family=COALESCE(?, source_family),
  training_eligible=?,
  bet_confidence_score=?, bet_confidence_tier=?
WHERE id=? AND audit_status='unknown'`;

// P3.9 R6H-F: caminho complementar para rows já anotadas (audit_status !=
// 'unknown'). Existe porque o admin endpoint /internal/admin/resync-
// confidence-scores promove audit_status de 'unknown' → 'valid' usando
// pseudo-pick reconstruído do DB (sem signals/enrichment/source_trace).
// O `explainBetConfidenceScore(pseudo)` daquele caminho produz score baixo
// (~37) com tier='no_bet', e o admin Step 2 atualiza audit_status='valid'.
// Quando o premium endpoint roda DEPOIS com canônico (tier1Raw enriched),
// o AUDIT_SYNC_SQL acima pula porque audit_status != 'unknown' — e o score
// stale fica para sempre.
//
// Este SQL upgrade-only:
//   - só toca bet_confidence_score/tier (não mexe em audit/training/result)
//   - só roda em rows can_post=1 + training_eligible=1 (lab-safe)
//   - guard: só sobe score, nunca rebaixa (canônico > atual no DB)
//   - WHERE audit_status != 'unknown' garante mutex com AUDIT_SYNC_SQL
//     (mesmo id não é atualizado duas vezes na mesma execução)
//
// Evidência D1 anterior à este fix: 1054 rows stale em 7 dias com
// audit=valid/verified+supported + can_post=1 + training=1 + tier=no_bet
// e score 6-39 (canônico esperado >= 41 para 'lab_only').
const CONFIDENCE_UPGRADE_SQL = `UPDATE shadow_bets SET
  bet_confidence_score=?, bet_confidence_tier=?
WHERE id=?
  AND audit_status != 'unknown'
  AND can_post = 1
  AND training_eligible = 1
  AND bet_confidence_score < ?`;

export async function syncShadowBetAuditAnnotations(items, env, options = {}) {
  const t0 = Date.now();
  const result = {
    attempted:    0,
    updated:      0,
    skipped:      0,
    errors:       0,
    // P3.9 R6H-F: rows que pularam o AUDIT_SYNC_SQL (audit_status != 'unknown')
    // mas foram corrigidas pelo CONFIDENCE_UPGRADE_SQL. Idempotente — re-runs
    // só atualizam novamente se canônico > atual.
    confidence_upgraded: 0,
    confidence_upgrade_skipped: 0,
    confidence_upgrade_errors: 0,
    duration_ms:  0,
    sample_ids:   [],
    confidence_upgrade_sample_ids: [],
  };

  if (!env?.SB_DB || !Array.isArray(items) || items.length === 0) return result;

  const pickDate = options.pickDate || new Date().toISOString().slice(0, 10);

  const updates = [];
  for (const pick of items) {
    if (!pick) continue;
    result.attempted++;

    const id = makeShadowBetId({
      bet365_event_id: pick.bet365_event_id,
      fixture_id:      pick.fixture_id,
      market:          pick.stat || pick.market,
      selection:       pick.selection || pick.direction,
      pick_date:       pickDate,
      source_family:   pick.source_family || pick.source,
      is_combo:        false,
    });

    const { pickAuditStatus, trustLevel, canPost } = _getAuditFields(pick);
    if (!pickAuditStatus || pickAuditStatus === 'unknown') { result.skipped++; continue; }

    const isTrainingEligible = (
      pickAuditStatus === 'valid' &&
      ['verified', 'supported'].includes(trustLevel) &&
      canPost &&
      pick.market_available !== false &&
      pick.resolvability?.can_resolve === true
    ) ? 1 : 0;

    // P3.9 R6H: recomputa confidence canônico com o pick agora enriquecido
    // (audit_status, trust_level, can_post, golden_score, golden_support_score,
    // odds_snapshot_count, ev_pct, prob — tudo já presente em tier1Raw items).
    // Sem isso, o score persistido no INSERT (calculado em premiumPicks.js
    // antes da audit annotation) fica defasado em ~20pts vs canônico.
    const confidence = calcBetConfidenceScore(pick);
    const confScore = (confidence?.score != null && Number.isFinite(confidence.score))
      ? +Number(confidence.score).toFixed(2)
      : null;
    const confTier = confidence?.tier || null;

    updates.push({
      id, pickAuditStatus, trustLevel, canPost,
      sourceFamily: pick.source_family || pick.source || null,
      isTrainingEligible,
      confScore, confTier,
    });
  }

  if (updates.length === 0) return result;

  const chunks = [];
  for (let i = 0; i < updates.length; i += AUDIT_SYNC_CHUNK_SIZE) {
    chunks.push(updates.slice(i, i + AUDIT_SYNC_CHUNK_SIZE));
  }

  // P3.9 R6H-F: rastreia rows que precisam de confidence upgrade (skipped no
  // AUDIT_SYNC_SQL porque audit_status já não era 'unknown'). Para essas,
  // tentamos CONFIDENCE_UPGRADE_SQL no segundo batch — só atualiza score/tier
  // se canônico > atual no DB.
  const upgradeCandidates = [];

  for (const chunk of chunks) {
    try {
      const stmts = chunk.map(u => env.SB_DB.prepare(AUDIT_SYNC_SQL).bind(
        u.pickAuditStatus, u.trustLevel, u.canPost ? 1 : 0,
        u.sourceFamily,
        u.isTrainingEligible,
        u.confScore, u.confTier,    // P3.9 R6H: canonical confidence
        u.id
      ));
      const batchRes = await env.SB_DB.batch(stmts);
      for (let i = 0; i < batchRes.length; i++) {
        const changes = batchRes[i]?.meta?.changes ?? 0;
        const u = chunk[i];
        if (changes > 0) {
          result.updated++;
          if (result.sample_ids.length < 5) result.sample_ids.push(u.id);
        } else {
          result.skipped++;
          // P3.9 R6H-F: skip provavelmente porque audit_status já != 'unknown'.
          // Candidato a upgrade só faz sentido se o pick canônico era 'main'
          // (training_eligible=1 + canPost) — outros casos seriam downgrade
          // de tier, que é gated no SQL.
          if (u.isTrainingEligible && u.canPost && Number.isFinite(u.confScore)) {
            upgradeCandidates.push(u);
          }
        }
      }
    } catch (e) {
      result.errors++;
      console.warn('[syncShadowBetAuditAnnotations] batch error:', e?.message);
    }
  }

  // P3.9 R6H-F: segundo passo — confidence upgrade para rows com audit já
  // anotado mas score stale. SQL #2 garante upgrade-only via guard
  // `bet_confidence_score < ?`. Mesma chunking, batch via D1.
  if (upgradeCandidates.length > 0) {
    const upgradeChunks = [];
    for (let i = 0; i < upgradeCandidates.length; i += AUDIT_SYNC_CHUNK_SIZE) {
      upgradeChunks.push(upgradeCandidates.slice(i, i + AUDIT_SYNC_CHUNK_SIZE));
    }
    for (const chunk of upgradeChunks) {
      try {
        const stmts = chunk.map(u => env.SB_DB.prepare(CONFIDENCE_UPGRADE_SQL).bind(
          u.confScore, u.confTier,   // SET
          u.id,                      // WHERE id
          u.confScore,               // WHERE bet_confidence_score < ?
        ));
        const batchRes = await env.SB_DB.batch(stmts);
        for (let i = 0; i < batchRes.length; i++) {
          const changes = batchRes[i]?.meta?.changes ?? 0;
          if (changes > 0) {
            result.confidence_upgraded++;
            if (result.confidence_upgrade_sample_ids.length < 5) {
              result.confidence_upgrade_sample_ids.push(chunk[i].id);
            }
          } else {
            result.confidence_upgrade_skipped++;
          }
        }
      } catch (e) {
        result.confidence_upgrade_errors++;
        console.warn('[syncShadowBetAuditAnnotations] R6H-F upgrade batch error:', e?.message);
      }
    }
  }

  result.duration_ms = Date.now() - t0;
  return result;
}
