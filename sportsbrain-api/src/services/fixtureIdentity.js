/**
 * fixtureIdentity.js
 * =============================================================================
 * Pure helpers that create and normalize fixture/event identities for the
 * market availability pipeline (P3.5.1 / DM3.1).
 *
 * Most functions are sync and pure (zero I/O, no globals mutated).
 * Exception: attachFixtureIdentity mutates its `target` argument by design.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Common suffixes to strip when normalizing team names for identity keys.
// Applied after lowercasing and accent removal.
// ---------------------------------------------------------------------------
const TEAM_SUFFIXES = /\b(fc|sc|ac|cf|cd|af|sp|club|sporting)\b/g;

/**
 * Normalize a team name for identity building.
 * - lowercase
 * - NFD normalize, strip combining diacritics (accents)
 * - strip common suffixes: fc, sc, ac, cf, cd, af, sp, club, sporting
 * - remove non-alphanumeric (keep spaces)
 * - collapse whitespace, trim
 * - truncate to 25 chars
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function normalizeTeamForIdentity(name) {
  if (!name) return '';
  const base = String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining diacritics
    .replace(/[^a-z0-9 ]/g, ' ')       // keep only alphanumeric + spaces
    .replace(/\s+/g, ' ')              // collapse multiple spaces
    .trim();

  const stripped = base
    .replace(TEAM_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25);

  // If suffix stripping consumed the entire name, use the base form
  return (stripped || base.slice(0, 25));
}

// ---------------------------------------------------------------------------
// Kickoff date extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the YYYY-MM-DD date from a kickoff value.
 * Accepts ISO strings, numeric timestamps (ms), or null/undefined.
 *
 * @param {string|number|null|undefined} kickoff
 * @returns {string|null}  YYYY-MM-DD or null
 */
function extractKickoffDate(kickoff) {
  if (kickoff == null || kickoff === '') return null;
  try {
    const d = new Date(typeof kickoff === 'string' && /^\d+$/.test(kickoff) ? Number(kickoff) : kickoff);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback key builder
// ---------------------------------------------------------------------------

/**
 * Build a fallback key from home/away/kickoff.
 * Format: `${normHome}|${normAway}|${kickoffDate}` where the team pair is
 * sorted alphabetically (same convention as eventId.js in the gateway).
 * If kickoff is missing the date part is an empty string.
 *
 * @param {{ home_team?: string, away_team?: string, kickoff?: string|number|null }} params
 * @returns {string}
 */
export function makeFallbackFixtureKey({ home_team, away_team, kickoff } = {}) {
  const normHome = normalizeTeamForIdentity(home_team);
  const normAway = normalizeTeamForIdentity(away_team);
  const date = extractKickoffDate(kickoff) ?? '';

  // Alphabetical sort on team pair for stable identity regardless of which is
  // listed as "home" in different data sources.
  const [teamA, teamB] = normHome <= normAway
    ? [normHome, normAway]
    : [normAway, normHome];

  return `${teamA}|${teamB}|${date}`;
}

// ---------------------------------------------------------------------------
// Full fixture identity builder
// ---------------------------------------------------------------------------

/**
 * Build a full fixture identity object from a pick or raw market item.
 *
 * Priority (first match wins):
 *  1. fixture_id                → identity_source: "fixture_id",      confidence: "high"
 *  2. bet365_event_id           → identity_source: "bet365_event_id",  confidence: "high"
 *  3. fixtureId (camelCase)     → treated as bet365_event_id above
 *  4. source_event_id           → identity_source: "source_event_id",  confidence: "medium"
 *  5. home + away + kickoff     → identity_source: "fallback",         confidence: "medium"
 *  6. home + away (no kickoff)  → identity_source: "fallback",         confidence: "low"
 *  7. nothing useful            → identity_source: "none",             confidence: "none"
 *
 * @param {object} input  Pick or market item
 * @returns {{
 *   fixture_id: string|null,
 *   bet365_event_id: string|null,
 *   source_event_id: string|null,
 *   identity_source: "fixture_id"|"bet365_event_id"|"source_event_id"|"fallback"|"none",
 *   identity_confidence: "high"|"medium"|"low"|"none",
 *   sport: string|null,
 *   league: string|null,
 *   home_team: string|null,
 *   away_team: string|null,
 *   normalized_home: string|null,
 *   normalized_away: string|null,
 *   kickoff: string|null,
 *   kickoff_date: string|null,
 *   fallback_key: string|null,
 * }}
 */
export function buildFixtureIdentity(input) {
  if (!input || typeof input !== 'object') {
    return _emptyIdentity();
  }

  // ── Extract raw field values ──────────────────────────────────────────────
  const fixture_id      = _str(input.fixture_id);
  // fixtureId (camelCase from Bet365 market items) is an alias for bet365_event_id
  const bet365_event_id = _str(input.bet365_event_id) || _str(input.fixtureId);
  const source_event_id = _str(input.source_event_id);
  const home_team       = _str(input.home_team);
  const away_team       = _str(input.away_team);
  const kickoff         = input.kickoff != null ? input.kickoff : null;
  const sport           = _str(input.sport);
  const league          = _str(input.league);

  // ── Derived fields ────────────────────────────────────────────────────────
  const normalized_home = home_team ? normalizeTeamForIdentity(home_team) : null;
  const normalized_away = away_team ? normalizeTeamForIdentity(away_team) : null;
  const kickoff_date    = extractKickoffDate(kickoff);
  const has_teams       = !!(normalized_home && normalized_away);
  const fallback_key    = has_teams
    ? makeFallbackFixtureKey({ home_team, away_team, kickoff })
    : null;

  // ── Determine identity source & confidence ────────────────────────────────
  let identity_source;
  let identity_confidence;

  if (fixture_id) {
    identity_source     = 'fixture_id';
    identity_confidence = 'high';
  } else if (bet365_event_id) {
    identity_source     = 'bet365_event_id';
    identity_confidence = 'high';
  } else if (source_event_id) {
    identity_source     = 'source_event_id';
    identity_confidence = 'medium';
  } else if (has_teams) {
    identity_source     = 'fallback';
    identity_confidence = kickoff_date ? 'medium' : 'low';
  } else {
    identity_source     = 'none';
    identity_confidence = 'none';
  }

  return {
    fixture_id:          fixture_id      || null,
    bet365_event_id:     bet365_event_id || null,
    source_event_id:     source_event_id || null,
    identity_source,
    identity_confidence,
    sport:               sport  || null,
    league:              league || null,
    home_team:           home_team  || null,
    away_team:           away_team  || null,
    normalized_home,
    normalized_away,
    kickoff:             kickoff != null ? String(kickoff) : null,
    kickoff_date,
    fallback_key,
  };
}

// ---------------------------------------------------------------------------
// Identity attachment
// ---------------------------------------------------------------------------

/**
 * Attach fixture identity to a target object (pick/combo/leg).
 * Mutates target in-place:
 *   - Sets target.fixture_identity = buildFixtureIdentity(source)
 *   - Sets target.bet365_event_id  if not already present on target
 *   - Sets target.fixture_id       if not already present on target
 *
 * @param {object} target  The object to annotate (mutated)
 * @param {object} source  The data source for identity fields
 * @returns {object} target
 */
export function attachFixtureIdentity(target, source) {
  const identity = buildFixtureIdentity(source);
  target.fixture_identity = identity;

  if (!target.bet365_event_id && identity.bet365_event_id) {
    target.bet365_event_id = identity.bet365_event_id;
  }
  if (!target.fixture_id && identity.fixture_id) {
    target.fixture_id = identity.fixture_id;
  }

  return target;
}

// ---------------------------------------------------------------------------
// Confidence check
// ---------------------------------------------------------------------------

/**
 * Returns true if identity_confidence is "high".
 *
 * @param {{ identity_confidence?: string }|null|undefined} identity
 * @returns {boolean}
 */
export function isHighConfidenceFixtureIdentity(identity) {
  return identity?.identity_confidence === 'high';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Coerces to a non-empty trimmed string or undefined. */
function _str(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

/** Returns the "null/none" identity shape. */
function _emptyIdentity() {
  return {
    fixture_id:          null,
    bet365_event_id:     null,
    source_event_id:     null,
    identity_source:     'none',
    identity_confidence: 'none',
    sport:               null,
    league:              null,
    home_team:           null,
    away_team:           null,
    normalized_home:     null,
    normalized_away:     null,
    kickoff:             null,
    kickoff_date:        null,
    fallback_key:        null,
  };
}
