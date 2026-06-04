// src/cron/refereeCollector.js — S5 Referee Signal
// Runs daily at 09:00 UTC. For each today's fixture, fetches referee via ESPN
// and computes card tendency from game_results. Writes to referee_signals + match_referee.

import { fetchRefereeFromESPN } from '../enrich/referee.js'

const TAG = '[cron:refereeCollector]'

// Compute referee stats from our own officials table (ESPN ingest)
async function computeRefStatsFromOfficials(env, refName) {
  const norm = refName.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').trim()

  const row = await env.SB_DB.prepare(`
    SELECT COUNT(*) AS n_games,
           AVG(yellow_cards) AS avg_yellow,
           AVG(red_cards)    AS avg_red,
           AVG(fouls)        AS avg_fouls,
           AVG(penalties)    AS avg_pens
    FROM officials
    WHERE referee_norm = ? AND role = 'center'
  `).bind(norm).first().catch(() => null)

  if (!row?.n_games || row.n_games < 3) return null
  return {
    referee: refName,
    n_games:    row.n_games,
    avg_yellow: row.avg_yellow ?? null,
    avg_red:    row.avg_red    ?? null,
    avg_fouls:  row.avg_fouls  ?? null,
    avg_pens:   row.avg_pens   ?? null,
  }
}

// Compute card tendency and signal_factor_cards from referee stats
function classifyReferee(stats) {
  const avg = stats?.avg_yellow ?? 0
  const tendency = avg > 4.5 ? 'strict' : avg < 2.5 ? 'lenient' : 'normal'
  const factor   = tendency === 'strict' ? 1.08 : tendency === 'lenient' ? 0.92 : 1.00
  return { tendency, factor }
}

export async function collectReferees(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' }
  const t0 = Date.now()
  let processed = 0, noRef = 0

  try {
    // Get today's upcoming fixtures from team_features
    const nowMs = Date.now()
    const endMs = nowMs + 24 * 3600 * 1000
    const { results: featureRows } = await env.SB_DB.prepare(`
      SELECT event_id, features_json
      FROM team_features
      WHERE commence_time >= ? AND commence_time <= ?
      LIMIT 40
    `).bind(nowMs - 3600 * 1000, endMs).all().catch(() => ({ results: [] }))

    for (const row of featureRows || []) {
      try {
        const features = typeof row.features_json === 'string'
          ? JSON.parse(row.features_json)
          : row.features_json
        if (!features) continue

        const home = features.home_team || features.home || ''
        const away = features.away_team || features.away || ''
        const espnId = features.espn_event_id || row.event_id
        if (!home || !away) { noRef++; continue }

        const homeNorm = home.toLowerCase().trim()
        const awayNorm = away.toLowerCase().trim()
        const id = `${homeNorm}|${awayNorm}`

        // Fetch referee name from ESPN
        const refName = espnId
          ? await fetchRefereeFromESPN(espnId, {
              sport: 'soccer',
              league: features.league_slug || 'eng.1',
            })
          : null

        if (!refName) { noRef++; continue }

        // Write match_referee
        await env.SB_DB.prepare(`
          INSERT OR REPLACE INTO match_referee (id, home_team, away_team, referee_name, fetched_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(id, home, away, refName, new Date().toISOString()).run()

        // Compute and write referee_signals (skip if recent data exists)
        const existing = await env.SB_DB.prepare(
          `SELECT updated_at FROM referee_signals WHERE referee_name = ?`
        ).bind(refName).first().catch(() => null)

        const ageHours = existing?.updated_at
          ? (Date.now() - new Date(existing.updated_at).getTime()) / 3600000
          : 999
        if (ageHours < 12) { processed++; continue }

        const stats = await computeRefStatsFromOfficials(env, refName)
        if (!stats) continue

        const { tendency, factor } = classifyReferee(stats)
        await env.SB_DB.prepare(`
          INSERT OR REPLACE INTO referee_signals
            (referee_name, avg_yellow_per_game, avg_red_per_game, avg_fouls_per_game,
             games_analyzed, card_tendency, signal_factor_cards, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          refName,
          stats.avg_yellow ?? 0, stats.avg_red ?? 0, stats.avg_fouls ?? 0,
          stats.n_games ?? 0,
          tendency, factor,
          new Date().toISOString()
        ).run()

        processed++
      } catch (rowErr) {
        console.warn(`${TAG} row error: ${rowErr.message}`)
      }
    }

    console.log(`${TAG} done — processed=${processed} no_ref=${noRef} in ${Date.now() - t0}ms`)
    return { ok: true, processed, no_ref: noRef, elapsed_ms: Date.now() - t0 }

  } catch (e) {
    console.error(`${TAG} ERROR:`, e.message)
    return { ok: false, error: e.message, elapsed_ms: Date.now() - t0 }
  }
}
