// ══════════════════════════════════════════════════════════════════════════
// Rest / travel enrichment — derived from game_results + venues.js
// ══════════════════════════════════════════════════════════════════════════
import { lookupVenue, distanceKm } from './venues.js';

const TAG = '[enrich:rest]';

// Days since team last played (from game_results). asOf = unix ms.
export async function computeRestDaysForTeam(env, team, asOf = Date.now()) {
  if (!env.SB_DB || !team) return null;
  try {
    const row = await env.SB_DB.prepare(`
      SELECT MAX(commence_time) AS last_ct FROM game_results
       WHERE (home = ? OR away = ?) AND commence_time < ?
    `).bind(team, team, asOf).first().catch(() => null);
    if (!row || !row.last_ct) return null;
    const days = (asOf - row.last_ct) / 86400000;
    return Math.round(days * 10) / 10;
  } catch (e) {
    console.warn(`${TAG} restDays: ${e.message}`);
    return null;
  }
}

// Travel: distance from team's previous venue to current venue (km).
// Current venue looked up from event (venue name or home team name).
export async function computeTravelKm(env, team, currentVenueName, asOf = Date.now()) {
  if (!env.SB_DB || !team) return null;
  const curCoords = lookupVenue(currentVenueName);
  if (!curCoords) return null;

  try {
    const row = await env.SB_DB.prepare(`
      SELECT home, away, venue FROM game_results
       WHERE (home = ? OR away = ?) AND commence_time < ?
       ORDER BY commence_time DESC LIMIT 1
    `).bind(team, team, asOf).first().catch(() => null);
    if (!row) return null;
    // Previous location = previous game's venue (or the home team's venue).
    const prevName = row.venue || row.home || null;
    const prev = lookupVenue(prevName);
    if (!prev) return null;
    const km = distanceKm(prev, curCoords);
    return km == null ? null : Math.round(km);
  } catch (e) {
    console.warn(`${TAG} travelKm: ${e.message}`);
    return null;
  }
}
