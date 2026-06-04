/**
 * oddsSnapshots.js
 * =============================================================================
 * Service layer for the market_odds_snapshots D1 table (P3.6 / DM2).
 *
 * Exported functions:
 *   makeOddsSnapshotId(params)           — deterministic snapshot dedup key
 *   buildOddsSnapshot(pick, capturedAt?) — build record from a premium pick
 *   computeOddsMovement(snapshots)       — opening/latest/min/max/direction
 *   computeLineMovement(snapshots)       — line drift analysis
 *   computeCLV(entryOdd, closingOdd)     — Closing Line Value %
 *   computeOddsFreshness(lastCapturedAt) — minutes since last capture
 *   ingestOddsSnapshots(records, env)    — D1 batch INSERT OR IGNORE
 *   loadOddsSnapshotsBulk(picks, env)    — D1 bulk SELECT → Map
 * =============================================================================
 */

import {
  normalizeMarketName,
  normalizeSelectionName,
  normalizePeriod,
  normalizePlayerName,
  normalizeLine,
} from './marketNormalization.js';

// D1 parameter limit is 100 per prepared statement; keep chunks well below.
const CHUNK_SIZE = 80;

// Number of days to look back when loading historical snapshots.
const SNAP_RETENTION_DAYS = 7;

// ---------------------------------------------------------------------------
// 1. makeOddsSnapshotId — deterministic snapshot ID
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic dedup key per
 * (fixture anchor, bookmaker, market, selection, line, period, player, odd at 4dp, minute of capture).
 *
 * Same odd + same minute → same ID (dedup via INSERT OR IGNORE).
 * Different odd OR different minute → different ID (new snapshot).
 *
 * Max length: 250 chars.
 *
 * @param {{
 *   fixture_id?: string|number,
 *   bet365_event_id?: string|number,
 *   bookmaker?: string,
 *   market?: string,
 *   selection?: string,
 *   line?: number|null,
 *   period?: string|null,
 *   player_name?: string|null,
 *   odd?: number|null,
 *   captured_at?: string,
 * }} params
 * @returns {string}
 */
export function makeOddsSnapshotId({
  fixture_id, bet365_event_id, bookmaker, market, selection,
  line, period, player_name, odd, captured_at,
}) {
  const fixtureKey = fixture_id || bet365_event_id || 'unknown';
  const bk         = String(bookmaker || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nMarket    = normalizeMarketName(market || '');
  const nSelection = normalizeSelectionName(selection || '');
  const nLine      = normalizeLine(line);
  const nPeriod    = normalizePeriod(period);
  const nPlayer    = normalizePlayerName(player_name || '');
  const oddKey     = odd != null ? String(Math.round(odd * 10000)) : 'x';
  const minuteKey  = captured_at ? String(captured_at).slice(0, 16) : 'unknown';

  const parts = [fixtureKey, bk, nMarket, nSelection];
  if (nLine != null) parts.push(String(nLine));
  if (nPeriod)       parts.push(nPeriod);
  if (nPlayer)       parts.push(nPlayer.slice(0, 20));
  parts.push(oddKey);
  parts.push(minuteKey);

  return parts.join('|').replace(/\|+$/, '').slice(0, 250);
}

// ---------------------------------------------------------------------------
// 2. buildOddsSnapshot — build record from a premium pick
// ---------------------------------------------------------------------------

/**
 * Builds a market_odds_snapshots record from a premium pick object.
 *
 * Returns null if:
 *  - pick is null/undefined
 *  - no market (pick.stat or pick.market)
 *  - odd <= 1.0 or missing
 *  - no fixture anchor (no fixture_id AND no bet365_event_id)
 *
 * @param {object} pick
 * @param {string|null} capturedAt — ISO timestamp; defaults to now
 * @returns {object|null}
 */
export function buildOddsSnapshot(pick, capturedAt = null) {
  if (!pick) return null;
  const market = pick.stat || pick.market;
  if (!market) return null;
  if (!pick.odd || pick.odd <= 1.0) return null;

  const isBet365   = pick.bet365 === true || pick._is_direct_b365 === true;
  const isPinnacle = pick.pinnacle === true;
  const bookmaker  = isBet365 ? 'bet365' : isPinnacle ? 'pinnacle' : 'unknown';
  const source_confidence = isBet365 ? 'high' : isPinnacle ? 'medium' : 'low';

  const _rawFixtureId = pick.fixture_id || pick.match_id || null;
  const _rawB365Id    = pick.bet365_event_id || pick.fixtureId || null;
  const fixture_id      = _rawFixtureId ? String(_rawFixtureId) : null;
  const bet365_event_id = _rawB365Id    ? String(_rawB365Id)    : null;

  if (!fixture_id && !bet365_event_id) return null;

  const now = capturedAt || new Date().toISOString();
  const implied_probability = pick.odd > 1 ? +(1 / pick.odd).toFixed(6) : null;

  const record = {
    fixture_id,
    bet365_event_id,
    source_event_id:        null,
    sport:                  pick.sport    || 'football',
    league:                 pick.league   || null,
    bookmaker,
    market,
    normalized_market:      normalizeMarketName(market),
    selection:              pick.selection || pick.direction || null,
    normalized_selection:   normalizeSelectionName(pick.selection || pick.direction || ''),
    line:                   pick.line     ?? null,
    period:                 pick.period   || null,
    player_name:            pick.player_name || null,
    normalized_player_name: normalizePlayerName(pick.player_name || ''),
    odd:                    +pick.odd.toFixed(4),
    implied_probability,
    captured_at:            now,
    source:                 pick.source   || 'premium_engine',
    source_confidence,
    raw_ref:                pick.match_id || null,
    raw_json:               null,
  };

  record.id = makeOddsSnapshotId({
    fixture_id:     fixture_id || bet365_event_id,
    bet365_event_id,
    bookmaker:      record.bookmaker,
    market:         record.market,
    selection:      record.selection,
    line:           record.line,
    period:         record.period,
    player_name:    record.player_name,
    odd:            record.odd,
    captured_at:    record.captured_at,
  });

  return record;
}

// ---------------------------------------------------------------------------
// 3. computeOddsMovement
// ---------------------------------------------------------------------------

/**
 * Analyzes a series of snapshots for the same market/selection to determine
 * how the odd has moved over time.
 *
 * Returns null if the input is empty/null or no snapshots have an odd.
 *
 * Direction: 'up' if latest > opening + 0.005, 'down' if latest < opening - 0.005, else 'flat'.
 *
 * @param {object[]} snapshots
 * @returns {object|null}
 */
export function computeOddsMovement(snapshots) {
  if (!snapshots?.length) return null;
  const sorted = [...snapshots]
    .filter(s => s.odd != null)
    .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  if (!sorted.length) return null;
  const opening = sorted[0].odd;
  const latest  = sorted[sorted.length - 1].odd;
  if (!opening || !latest) return null;
  const odds = sorted.map(s => s.odd);
  return {
    opening_odd:     +opening.toFixed(4),
    latest_odd:      +latest.toFixed(4),
    min_odd:         +Math.min(...odds).toFixed(4),
    max_odd:         +Math.max(...odds).toFixed(4),
    movement_abs:    +(latest - opening).toFixed(4),
    movement_pct:    +((latest - opening) / opening * 100).toFixed(2),
    direction:       latest > opening + 0.005 ? 'up' : latest < opening - 0.005 ? 'down' : 'flat',
    snapshots_count: sorted.length,
    first_seen_at:   sorted[0].captured_at,
    last_seen_at:    sorted[sorted.length - 1].captured_at,
  };
}

// ---------------------------------------------------------------------------
// 4. computeLineMovement
// ---------------------------------------------------------------------------

/**
 * Analyzes a series of snapshots for line drift.
 *
 * Returns null if there are fewer than 2 snapshots that have a line value.
 *
 * Direction: 'up' if latest > opening + 0.001, 'down' if latest < opening - 0.001, else 'flat'.
 *
 * @param {object[]} snapshots
 * @returns {object|null}
 */
export function computeLineMovement(snapshots) {
  if (!snapshots?.length) return null;
  const sorted = [...snapshots]
    .filter(s => s.line != null)
    .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  if (sorted.length < 2) return null;
  const opening = sorted[0].line;
  const latest  = sorted[sorted.length - 1].line;
  return {
    opening_line:    opening,
    latest_line:     latest,
    movement_abs:    +(latest - opening).toFixed(4),
    direction:       latest > opening + 0.001 ? 'up' : latest < opening - 0.001 ? 'down' : 'flat',
    snapshots_count: sorted.length,
    first_seen_at:   sorted[0].captured_at,
    last_seen_at:    sorted[sorted.length - 1].captured_at,
  };
}

// ---------------------------------------------------------------------------
// 5. computeCLV — Closing Line Value
// ---------------------------------------------------------------------------

/**
 * Computes Closing Line Value as a percentage.
 *
 * Positive = got value (entry odd > closing odd, i.e. you bet at a higher price than the market closed at).
 * Negative = paid too much.
 *
 * Returns null if either input is null/undefined or <= 1.
 *
 * @param {number|null} entryOdd
 * @param {number|null} closingOdd
 * @returns {number|null}
 */
export function computeCLV(entryOdd, closingOdd) {
  if (!entryOdd || !closingOdd) return null;
  if (entryOdd <= 1 || closingOdd <= 1) return null;
  return +((entryOdd - closingOdd) / closingOdd * 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// 6. computeOddsFreshness
// ---------------------------------------------------------------------------

/**
 * Returns the number of minutes elapsed since the last capture, or null if
 * the input is missing or invalid.
 *
 * @param {string|null} lastCapturedAt — ISO timestamp
 * @returns {number|null}
 */
export function computeOddsFreshness(lastCapturedAt) {
  if (!lastCapturedAt) return null;
  const ms = Date.now() - new Date(lastCapturedAt).getTime();
  if (isNaN(ms)) return null;
  return Math.round(ms / 60_000);
}

// ---------------------------------------------------------------------------
// 7. ingestOddsSnapshots — D1 batch INSERT OR IGNORE
// ---------------------------------------------------------------------------

/**
 * Inserts a batch of odds snapshot records into D1 using INSERT OR IGNORE.
 *
 * Key design decisions:
 *  - Uses D1 batch() API (NOT individual .run() calls) — 1 API call per chunk of 80.
 *  - INSERT OR IGNORE (NOT UPSERT) — preserves snapshot history, dedup by ID.
 *  - Table missing → graceful skip, never throws.
 *  - Dedup by ID before inserting (keep first occurrence).
 *
 * @param {object[]} records — from buildOddsSnapshot
 * @param {object}   env     — CF Worker env (needs env.SB_DB)
 * @returns {Promise<{ ingested: number, skipped_invalid: number, skipped_dedup: number, skipped_no_table: boolean, error: string|null }>}
 */
export async function ingestOddsSnapshots(records, env) {
  const result = { ingested: 0, skipped_invalid: 0, skipped_dedup: 0, skipped_no_table: false, error: null };
  if (!env?.SB_DB || !records?.length) return result;

  const now = new Date().toISOString();

  // Count invalid records (null/undefined or missing id)
  for (const r of records) {
    if (!r || !r.id) result.skipped_invalid++;
  }

  // Deduplicate by id (keep first occurrence — preserves oldest snapshot)
  const uniqueMap = new Map();
  for (const r of records) {
    if (r?.id && !uniqueMap.has(r.id)) uniqueMap.set(r.id, r);
  }
  const unique = [...uniqueMap.values()];

  // skipped_dedup = valid records that were dropped as duplicates
  const validCount = records.filter(r => r?.id).length;
  result.skipped_dedup = validCount - unique.length;

  if (!unique.length) return result;

  const SQL = `INSERT OR IGNORE INTO market_odds_snapshots (
    id, fixture_id, bet365_event_id, source_event_id, sport, league, bookmaker, market,
    normalized_market, selection, normalized_selection, line, period,
    player_name, normalized_player_name, odd, implied_probability,
    captured_at, source, source_confidence, raw_ref, raw_json, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  // Process in chunks of CHUNK_SIZE; each chunk = 1 D1 batch() call = 1 subrequest
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    try {
      const stmts = chunk.map(r =>
        env.SB_DB.prepare(SQL).bind(
          r.id, r.fixture_id, r.bet365_event_id, r.source_event_id ?? null,
          r.sport, r.league, r.bookmaker, r.market,
          r.normalized_market, r.selection, r.normalized_selection, r.line, r.period,
          r.player_name, r.normalized_player_name, r.odd, r.implied_probability,
          r.captured_at, r.source, r.source_confidence, r.raw_ref, r.raw_json,
          now,
        )
      );
      const batchResults = await env.SB_DB.batch(stmts);
      result.ingested += batchResults.filter(r => (r?.meta?.changes ?? 0) > 0).length;
    } catch (e) {
      // "no such table" means migration hasn't run yet — skip silently
      if (/no such table/i.test(e?.message || '')) {
        result.skipped_no_table = true;
        return result;
      }
      if (!result.error) result.error = e?.message || String(e);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 8. loadOddsSnapshotsBulk — D1 bulk SELECT → Map
// ---------------------------------------------------------------------------

/**
 * Loads up to SNAP_RETENTION_DAYS days of historical snapshots for the given
 * picks' bet365_event_ids / fixture_ids from D1.
 *
 * Returns:
 *  - byAnchorMarket: Map<"anchor|nMarket|nSel|line" → snapshot[]>
 *  - coverage: { total_loaded, fixtures_queried, queries_used, table_missing, last_snapshot_at }
 *
 * Non-fatal: table missing → sets coverage.table_missing = true, returns empty.
 *
 * Map key: `${r.bet365_event_id || r.fixture_id}|${r.normalized_market ?? ''}|${r.normalized_selection ?? ''}|${r.line ?? ''}`
 *
 * @param {object[]} picks
 * @param {object}   env
 * @param {{ retentionDays?: number }} [options]
 * @returns {Promise<{ byAnchorMarket: Map, coverage: object }>}
 */
export async function loadOddsSnapshotsBulk(picks, env, options = {}) {
  const retentionDays = options.retentionDays ?? SNAP_RETENTION_DAYS;
  const empty = {
    byAnchorMarket: new Map(),
    coverage: { total_loaded: 0, fixtures_queried: 0, queries_used: 0, table_missing: false, last_snapshot_at: null },
  };
  if (!env?.SB_DB || !picks?.length) return empty;

  const b365EventIds = [...new Set(picks.map(p => p.bet365_event_id || p.fixtureId).filter(Boolean).map(String))];
  const fixtureIds   = [...new Set(picks.map(p => p.fixture_id || p.match_id).filter(Boolean).map(String))];

  if (!b365EventIds.length && !fixtureIds.length) return empty;

  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  let allRecords = [], queries_used = 0, fixtures_queried = 0;

  try {
    // Query by bet365_event_id first (primary anchor for bet365 picks)
    for (let i = 0; i < b365EventIds.length; i += CHUNK_SIZE) {
      const chunk = b365EventIds.slice(i, i + CHUNK_SIZE);
      fixtures_queried += chunk.length;
      const ph = chunk.map(() => '?').join(',');
      const rows = await env.SB_DB.prepare(
        `SELECT * FROM market_odds_snapshots WHERE bet365_event_id IN (${ph}) AND captured_at >= ? ORDER BY captured_at ASC`
      ).bind(...chunk, cutoff).all().catch(e => {
        if (/no such table/i.test(e?.message || '')) throw Object.assign(e, { _tableAbsent: true });
        return { results: [] };
      });
      allRecords.push(...(rows.results || []));
      queries_used++;
    }

    // Query by fixture_id for picks not already loaded via bet365_event_id
    const alreadyLoaded = new Set(allRecords.map(r => r.fixture_id).filter(Boolean));
    const pendingFixIds = fixtureIds.filter(id => !alreadyLoaded.has(id));
    for (let i = 0; i < pendingFixIds.length; i += CHUNK_SIZE) {
      const chunk = pendingFixIds.slice(i, i + CHUNK_SIZE);
      fixtures_queried += chunk.length;
      const ph = chunk.map(() => '?').join(',');
      const rows = await env.SB_DB.prepare(
        `SELECT * FROM market_odds_snapshots WHERE fixture_id IN (${ph}) AND captured_at >= ? ORDER BY captured_at ASC`
      ).bind(...chunk, cutoff).all().catch(() => ({ results: [] }));
      allRecords.push(...(rows.results || []));
      queries_used++;
    }
  } catch (e) {
    if (e._tableAbsent) { empty.coverage.table_missing = true; return empty; }
    return empty;
  }

  const byAnchorMarket = new Map();
  for (const r of allRecords) {
    const anchor = r.bet365_event_id || r.fixture_id;
    if (!anchor) continue;
    const key = `${anchor}|${r.normalized_market ?? ''}|${r.normalized_selection ?? ''}|${r.line ?? ''}`;
    if (!byAnchorMarket.has(key)) byAnchorMarket.set(key, []);
    byAnchorMarket.get(key).push(r);
  }

  // Find the most recent captured_at across all loaded snapshots
  const last_snapshot_at = allRecords.reduce((max, r) => {
    if (!r.captured_at) return max;
    return max === null || String(r.captured_at) > max ? String(r.captured_at) : max;
  }, null);

  return {
    byAnchorMarket,
    coverage: { total_loaded: allRecords.length, fixtures_queried, queries_used, table_missing: false, last_snapshot_at },
  };
}
