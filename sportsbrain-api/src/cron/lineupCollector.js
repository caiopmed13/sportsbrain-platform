// src/cron/lineupCollector.js — S2 Lineup Signal
// Runs every 15min. For fixtures kicking off in 45–120min, fetch lineup from ESPN.
// Writes to match_lineups keyed home_norm|away_norm.

import { fetchLineupsFromESPN } from '../enrich/lineups.js'

const TAG = '[cron:lineupCollector]'
const MIN_BEFORE_MS = 45  * 60 * 1000    // start checking 45min before kickoff
const MAX_BEFORE_MS = 120 * 60 * 1000    // stop checking after lineup window closes

// Compute lineup signal factors given confirmed lineup data
function computeLineupFactors(lineupData) {
  const result = {
    home_has_lineup: 0, away_has_lineup: 0,
    home_missing_key: 0, away_missing_key: 0,
    home_missing_count: 0, away_missing_count: 0,
    home_signal_factor: 1.0, away_signal_factor: 1.0,
  }
  if (!lineupData || !lineupData.confirmed) return result

  const home = lineupData.home_lineup || []
  const away = lineupData.away_lineup || []

  result.home_has_lineup = home.length >= 5 ? 1 : 0
  result.away_has_lineup = away.length >= 5 ? 1 : 0

  // Check for GK presence (position abbreviation 'GK' or 'G')
  const hasGK = (lineup) => lineup.some(p => /^GK?$/i.test(p.position || ''))

  if (result.home_has_lineup) {
    if (!hasGK(home)) { result.home_missing_key = 1; result.home_signal_factor -= 0.10 }
    if (home.length < 9) { result.home_missing_count = 11 - home.length; result.home_signal_factor -= 0.05 * result.home_missing_count }
    if (result.home_signal_factor === 1.0) result.home_signal_factor = 1.04  // full strength confirmed
    result.home_signal_factor = Math.max(0.70, result.home_signal_factor)
  }

  if (result.away_has_lineup) {
    if (!hasGK(away)) { result.away_missing_key = 1; result.away_signal_factor -= 0.10 }
    if (away.length < 9) { result.away_missing_count = 11 - away.length; result.away_signal_factor -= 0.05 * result.away_missing_count }
    if (result.away_signal_factor === 1.0) result.away_signal_factor = 1.04  // full strength confirmed
    result.away_signal_factor = Math.max(0.70, result.away_signal_factor)
  }

  return result
}

export async function collectLineups(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' }
  const t0 = Date.now()
  let fetched = 0, skipped = 0

  try {
    const nowMs = Date.now()
    const windowStart = nowMs + MIN_BEFORE_MS
    const windowEnd   = nowMs + MAX_BEFORE_MS

    // Get upcoming events from team_features (stored hourly by enrichUpcomingEvents)
    const { results: featureRows } = await env.SB_DB.prepare(`
      SELECT event_id, features_json
      FROM team_features
      WHERE commence_time >= ? AND commence_time <= ?
      LIMIT 30
    `).bind(windowStart, windowEnd).all().catch(() => ({ results: [] }))

    for (const row of featureRows || []) {
      try {
        const features = typeof row.features_json === 'string'
          ? JSON.parse(row.features_json)
          : row.features_json
        if (!features) continue

        const home = features.home_team || features.home || ''
        const away = features.away_team || features.away || ''
        const espnId = features.espn_event_id || row.event_id
        if (!home || !away || !espnId) { skipped++; continue }

        const homeNorm = home.toLowerCase().trim()
        const awayNorm = away.toLowerCase().trim()
        const id = `${homeNorm}|${awayNorm}`

        // Skip if we have fresh data (< 20 min old)
        const existing = await env.SB_DB.prepare(
          `SELECT fetched_at FROM match_lineups WHERE id = ?`
        ).bind(id).first().catch(() => null)
        if (existing?.fetched_at) {
          const age = Date.now() - new Date(existing.fetched_at).getTime()
          if (age < 20 * 60 * 1000) { skipped++; continue }
        }

        const lineupData = await fetchLineupsFromESPN(env, {
          espnEventId: espnId,
          sport: 'soccer',
          league: features.league_slug || 'eng.1',
          homeTeam: home,
          awayTeam: away,
        })

        const factors = computeLineupFactors(lineupData)
        await env.SB_DB.prepare(`
          INSERT OR REPLACE INTO match_lineups
            (id, home_team, away_team,
             home_has_lineup, away_has_lineup,
             home_missing_key, away_missing_key,
             home_missing_count, away_missing_count,
             home_signal_factor, away_signal_factor,
             fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, home, away,
          factors.home_has_lineup, factors.away_has_lineup,
          factors.home_missing_key, factors.away_missing_key,
          factors.home_missing_count, factors.away_missing_count,
          factors.home_signal_factor, factors.away_signal_factor,
          new Date().toISOString()
        ).run()

        fetched++
      } catch (rowErr) {
        console.warn(`${TAG} row error: ${rowErr.message}`)
      }
    }

    console.log(`${TAG} done — fetched=${fetched} skipped=${skipped} in ${Date.now() - t0}ms`)
    return { ok: true, fetched, skipped, elapsed_ms: Date.now() - t0 }

  } catch (e) {
    console.error(`${TAG} ERROR:`, e.message)
    return { ok: false, error: e.message, elapsed_ms: Date.now() - t0 }
  }
}
