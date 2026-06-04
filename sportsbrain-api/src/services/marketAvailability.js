/**
 * marketAvailability.js
 * =============================================================================
 * Service layer for the market_availability D1 table (P3.5 / DM3).
 *
 * Exported functions:
 *   makeMarketKey(nMarket, nSelection, line, period, nPlayer)
 *   makeMarketAvailabilityId(params)
 *   extractMarketRecordsFromPick(pick)
 *   ingestMarketAvailabilityBatch(records, env)   — async, D1 UPSERT
 *   loadMarketAvailabilityBulk(picks, env)         — async, D1 bulk lookup
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

// ---------------------------------------------------------------------------
// 1. Key builders
// ---------------------------------------------------------------------------

/**
 * Creates an opaque lookup key for a normalized market + selection + extras.
 * Used as the inner-map key in availability lookups.
 *
 * @returns {string}  e.g. "match_winner:home::::"
 */
export function makeMarketKey(nMarket, nSelection, line, period, nPlayer) {
  return [
    nMarket ?? '',
    nSelection ?? '',
    line != null ? String(line) : '',
    period ?? '',
    nPlayer ? nPlayer.slice(0, 20) : '',
  ].join(':');
}

/**
 * Creates a deterministic primary key for a market_availability row.
 *
 * Rules:
 *  - Prefer fixture_id over bet365_event_id as the fixture anchor.
 *  - Append bookmaker + normalized market + selection + line + period + player.
 *
 * @param {{
 *   fixture_id?: string,
 *   bet365_event_id?: string,
 *   bookmaker?: string,
 *   market?: string,
 *   selection?: string,
 *   line?: number|null,
 *   period?: string|null,
 *   player_name?: string|null,
 * }} params
 * @returns {string}
 */
export function makeMarketAvailabilityId({
  fixture_id,
  bet365_event_id,
  bookmaker,
  market,
  selection,
  line,
  period,
  player_name,
}) {
  const fixtureKey = fixture_id || bet365_event_id || 'unknown';
  const bk = String(bookmaker || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nMarket    = normalizeMarketName(market || '');
  const nSelection = normalizeSelectionName(selection || '');
  const nLine      = normalizeLine(line);
  const nPeriod    = normalizePeriod(period);
  const nPlayer    = normalizePlayerName(player_name || '');

  const parts = [fixtureKey, bk, nMarket, nSelection];
  if (nLine != null)  parts.push(String(nLine));
  if (nPeriod)        parts.push(nPeriod);
  if (nPlayer)        parts.push(nPlayer.slice(0, 20));

  return parts.join('|').replace(/\|+$/, '').slice(0, 200);
}

// ---------------------------------------------------------------------------
// 2. Extract records from a pick
// ---------------------------------------------------------------------------

/**
 * Extracts one or more market_availability records from a premium pick.
 * Returns [] if the pick lacks a market definition.
 *
 * @param {object} pick
 * @returns {object[]}
 */
export function extractMarketRecordsFromPick(pick) {
  if (!pick) return [];
  const market = pick.stat || pick.market;
  if (!market) return [];

  // Determine bookmaker and source confidence
  const isBet365 = pick.bet365 === true || pick._is_direct_b365 === true;
  const isPinnacle = pick.pinnacle === true;
  const bookmaker  = isBet365 ? 'bet365' : isPinnacle ? 'pinnacle' : 'unknown';
  const source_confidence =
    isBet365  ? 'high'   :
    isPinnacle ? 'medium' : 'low';

  // Derive fixture identifiers — always store as strings for consistent D1 TEXT column comparison
  const _rawFixtureId = pick.fixture_id || pick.match_id || null;
  const _rawB365Id    = pick.bet365_event_id || pick.fixtureId || null;
  const fixture_id      = _rawFixtureId  ? String(_rawFixtureId)  : null;
  const bet365_event_id = _rawB365Id     ? String(_rawB365Id)     : null;

  // If no fixture anchor at all, we can't usefully store the record
  if (!fixture_id && !bet365_event_id) return [];

  const record = {
    fixture_id,
    bet365_event_id,
    sport:            pick.sport    || 'football',
    league:           pick.league   || null,
    bookmaker,
    market,
    selection:        pick.selection || pick.direction || null,
    line:             pick.line      ?? null,
    period:           pick.period    || null,
    player_name:      pick.player_name || null,
    team_name:        pick.home_team  || null,
    available:        1,
    source:           pick.source     || 'premium_engine',
    source_confidence,
    raw_ref:          pick.match_id   || null,
    raw_json:         null,
  };

  record.id = makeMarketAvailabilityId({
    fixture_id:     record.fixture_id || record.bet365_event_id,
    bet365_event_id: record.bet365_event_id,
    bookmaker:      record.bookmaker,
    market:         record.market,
    selection:      record.selection,
    line:           record.line,
    period:         record.period,
    player_name:    record.player_name,
  });

  return [record];
}

// ---------------------------------------------------------------------------
// 3. Ingest / UPSERT batch
// ---------------------------------------------------------------------------

/**
 * Upserts a batch of market availability records into D1.
 *
 * Uses D1 batch() API — executes all INSERTs as a SINGLE D1 API call per chunk (80 rows).
 * This avoids hitting the per-invocation D1 request limit when called from a Worker that
 * has already made many D1 queries (e.g. after signal enrichment in premiumPicks.js).
 *
 * On conflict (same id):
 *   - Updates last_seen_at, available = 1, updated_at.
 *   - Preserves first_seen_at.
 *
 * @param {object[]} records   — from extractMarketRecordsFromPick
 * @param {object}   env       — CF Worker env (needs env.SB_DB)
 * @returns {Promise<{ inserted: number, updated: number, failed: number, skipped_no_table: boolean, first_error: string|null }>}
 */
export async function ingestMarketAvailabilityBatch(records, env) {
  const result = { inserted: 0, updated: 0, failed: 0, skipped_no_table: false, first_error: null };
  if (!env?.SB_DB || !records?.length) return result;

  const now = new Date().toISOString();

  // Deduplicate by id (keep last occurrence)
  const uniqueMap = new Map();
  for (const r of records) {
    if (r?.id) uniqueMap.set(r.id, r);
  }
  const unique = [...uniqueMap.values()];
  if (!unique.length) return result;

  const SQL = `
    INSERT INTO market_availability (
      id, fixture_id, bet365_event_id, sport, league, bookmaker, market,
      normalized_market, selection, normalized_selection, line, period,
      player_name, normalized_player_name, team_name, normalized_team_name,
      available, first_seen_at, last_seen_at, source, source_confidence,
      raw_ref, raw_json, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      last_seen_at  = excluded.last_seen_at,
      available     = 1,
      updated_at    = excluded.updated_at
  `;

  // Process in chunks of CHUNK_SIZE; each chunk = 1 D1 batch() call = 1 subrequest
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    try {
      const stmts = chunk.map(r =>
        env.SB_DB.prepare(SQL).bind(
          r.id,
          r.fixture_id,
          r.bet365_event_id,
          r.sport,
          r.league,
          r.bookmaker,
          r.market,
          normalizeMarketName(r.market),
          r.selection,
          normalizeSelectionName(r.selection || ''),
          r.line,
          r.period,
          r.player_name,
          normalizePlayerName(r.player_name || ''),
          r.team_name,
          normalizePlayerName(r.team_name || '') || null,
          r.available ?? 1,
          now,         // first_seen_at — preserved by ON CONFLICT skipping
          now,         // last_seen_at
          r.source,
          r.source_confidence,
          r.raw_ref,
          r.raw_json,
          now,         // created_at
          now,         // updated_at
        )
      );
      // One D1 API call for the whole chunk (avoids per-invocation subrequest limit)
      const batchResults = await env.SB_DB.batch(stmts);
      result.inserted += batchResults.filter(r => r?.success !== false).length;
    } catch (e) {
      // "no such table" means migration hasn't run yet — skip silently
      if (/no such table/i.test(e?.message || '')) {
        result.skipped_no_table = true;
        return result;
      }
      result.failed += chunk.length;
      if (!result.first_error) result.first_error = e?.message || String(e);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. Bulk lookup (pre-load before audit)
// ---------------------------------------------------------------------------

/**
 * Loads market availability records for a set of picks from D1 in bulk.
 *
 * Returns three maps for O(1) lookup:
 *  - byFixtureId:      Map<fixture_id → Map<marketKey → record>>
 *  - byBet365EventId:  Map<bet365_event_id → Map<marketKey → record>>
 *  - byMarketKey:      Map<"fixtureOrEvent:marketKey" → record>   (flat)
 *
 * Non-fatal: if D1 fails or table is missing, returns empty maps and
 * sets coverage.table_missing = true.
 *
 * @param {object[]} picks  — pick objects with fixture_id / bet365_event_id
 * @param {object}   env
 * @returns {Promise<{
 *   byFixtureId: Map,
 *   byBet365EventId: Map,
 *   byMarketKey: Map,
 *   coverage: object,
 * }>}
 */
export async function loadMarketAvailabilityBulk(picks, env) {
  const empty = {
    byFixtureId:    new Map(),
    byBet365EventId: new Map(),
    byMarketKey:    new Map(),
    coverage: {
      requested_fixtures: 0,
      loaded_markets:     0,
      queries_used:       0,
      duration_ms:        0,
      table_missing:      false,
    },
  };

  if (!env?.SB_DB || !picks?.length) return empty;

  const t0 = Date.now();

  // Collect unique fixture and event IDs from the picks — always stringify to ensure D1 TEXT comparison
  const fixtureIds   = [...new Set(picks.map(p => p.fixture_id || p.match_id).filter(Boolean).map(String))];
  const b365EventIds = [...new Set(picks.map(p => p.bet365_event_id || p.fixtureId).filter(Boolean).map(String))];

  if (!fixtureIds.length && !b365EventIds.length) return empty;

  let allRecords = [];
  let queries_used = 0;

  try {
    // Query by fixture_id
    for (let i = 0; i < fixtureIds.length; i += CHUNK_SIZE) {
      const chunk = fixtureIds.slice(i, i + CHUNK_SIZE);
      const ph = chunk.map(() => '?').join(',');
      const rows = await env.SB_DB.prepare(
        `SELECT * FROM market_availability WHERE fixture_id IN (${ph}) AND available = 1`
      ).bind(...chunk).all().catch(e => {
        if (/no such table/i.test(e?.message || '')) throw Object.assign(e, { _tableAbsent: true });
        return { results: [] };
      });
      allRecords.push(...(rows.results || []));
      queries_used++;
    }

    // Query by bet365_event_id (skip IDs already fetched via fixture_id)
    const alreadyLoadedEventIds = new Set(allRecords.map(r => r.bet365_event_id).filter(Boolean));
    const pendingEventIds = b365EventIds.filter(id => !alreadyLoadedEventIds.has(id));
    for (let i = 0; i < pendingEventIds.length; i += CHUNK_SIZE) {
      const chunk = pendingEventIds.slice(i, i + CHUNK_SIZE);
      const ph = chunk.map(() => '?').join(',');
      const rows = await env.SB_DB.prepare(
        `SELECT * FROM market_availability WHERE bet365_event_id IN (${ph}) AND available = 1`
      ).bind(...chunk).all().catch(() => ({ results: [] }));
      allRecords.push(...(rows.results || []));
      queries_used++;
    }
  } catch (e) {
    if (e._tableAbsent) {
      empty.coverage.table_missing = true;
      return empty;
    }
    // Other D1 error — return empty gracefully
    return empty;
  }

  // Build lookup maps
  const byFixtureId    = new Map();
  const byBet365EventId = new Map();
  const byMarketKey    = new Map();

  for (const r of allRecords) {
    const mKey = makeMarketKey(
      r.normalized_market,
      r.normalized_selection,
      r.line,
      r.period,
      r.normalized_player_name,
    );

    if (r.fixture_id) {
      if (!byFixtureId.has(r.fixture_id)) byFixtureId.set(r.fixture_id, new Map());
      byFixtureId.get(r.fixture_id).set(mKey, r);
    }
    if (r.bet365_event_id) {
      if (!byBet365EventId.has(r.bet365_event_id)) byBet365EventId.set(r.bet365_event_id, new Map());
      byBet365EventId.get(r.bet365_event_id).set(mKey, r);
    }

    // Flat key: "fixtureOrEvent|marketKey"
    const anchor = r.fixture_id || r.bet365_event_id;
    if (anchor) byMarketKey.set(`${anchor}|${mKey}`, r);
  }

  return {
    byFixtureId,
    byBet365EventId,
    byMarketKey,
    coverage: {
      requested_fixtures: fixtureIds.length + b365EventIds.length,
      loaded_markets:     allRecords.length,
      queries_used,
      duration_ms:        Date.now() - t0,
      table_missing:      false,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Lookup helper used by pickAudit.js
// ---------------------------------------------------------------------------

/**
 * Given an availability context (from loadMarketAvailabilityBulk) and a
 * normalized market key, attempts to find the matching availability record.
 *
 * Returns { found: bool, record: object|null }.
 *
 * @param {object} availCtx — result of loadMarketAvailabilityBulk
 * @param {string} fixtureId
 * @param {string} b365EventId
 * @param {string} nMarket
 * @param {string} nSelection
 * @param {number|null} line
 * @param {string|null} period
 * @param {string} nPlayer
 * @returns {{ found: boolean, record: object|null }}
 */
export function lookupAvailability(availCtx, fixtureId, b365EventId, nMarket, nSelection, line, period, nPlayer) {
  if (!availCtx) return { found: false, record: null };

  const mKey = makeMarketKey(nMarket, nSelection, line, period, nPlayer);

  // Try fixture_id first
  if (fixtureId && availCtx.byFixtureId.has(fixtureId)) {
    const rec = availCtx.byFixtureId.get(fixtureId).get(mKey);
    if (rec) return { found: true, record: rec };
  }

  // Try bet365_event_id
  if (b365EventId && availCtx.byBet365EventId.has(b365EventId)) {
    const rec = availCtx.byBet365EventId.get(b365EventId).get(mKey);
    if (rec) return { found: true, record: rec };
  }

  // Flat key
  const anchor = fixtureId || b365EventId;
  if (anchor) {
    const rec = availCtx.byMarketKey.get(`${anchor}|${mKey}`);
    if (rec) return { found: true, record: rec };
  }

  return { found: false, record: null };
}
