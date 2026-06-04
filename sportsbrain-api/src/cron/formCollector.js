// src/cron/formCollector.js — S1 Form Signal
// Runs every 3h. Computes last-5 form from our OWN `matches_raw` table (ESPN ingest).
// Stores 3 rows per team: 'all', 'home', 'away' (venue-specific form).
// Fallback: `team_stats` season aggregate when < 3 finished games exist.
// ZERO external API dependencies — all data is proprietary.

const TAG = '[cron:formCollector]'
const STALE_MS = 3 * 3600 * 1000  // 3h freshness window

// normTeam: key for team_form_cache (strips spaces — matches odds/normalize.js)
function normTeam(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|sc|ac|af|cf|sv|cd|ud|ca|uc|as|rc)\b/g, '')
    .replace(/\b(futebol|club|clube|sport|sporting)\b/g, '')
    .replace(/[^a-z0-9]+/g, '').slice(0, 20)
}

// rawNorm: matches what ingestMatches.js stores in matches_raw.home_team_norm
// (keeps spaces, strips diacritics and punctuation but NOT spaces)
function rawNorm(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function computeFormFromRows(rows) {
  if (!rows.length) return null
  let scored = 0, conceded = 0, form_pts = 0, btts = 0, clean_sheets = 0
  for (const r of rows) {
    const sf = r.score_for    ?? 0
    const cf = r.score_against ?? 0
    scored   += sf
    conceded += cf
    form_pts += sf > cf ? 3 : sf === cf ? 1 : 0
    if (sf > 0 && cf > 0) btts++
    if (cf === 0) clean_sheets++
  }
  const n = rows.length
  return {
    last5_scored:   +(scored   / n).toFixed(2),
    last5_conceded: +(conceded / n).toFixed(2),
    btts_rate:      +(btts     / n).toFixed(2),
    form_pts,
    clean_sheets,
  }
}

// Query matches_raw for last N finished games for a team — all venues
async function fetchFormAll(env, norm, limit = 7) {
  const { results: rows } = await env.SB_DB.prepare(`
    SELECT
      CASE WHEN home_team_norm = ? THEN score_home ELSE score_away END AS score_for,
      CASE WHEN home_team_norm = ? THEN score_away ELSE score_home END AS score_against
    FROM matches_raw
    WHERE (home_team_norm = ? OR away_team_norm = ?)
      AND status = 'post'
      AND score_home IS NOT NULL AND score_away IS NOT NULL
    ORDER BY match_date DESC
    LIMIT ?
  `).bind(norm, norm, norm, norm, limit).all().catch(() => ({ results: [] }))
  return rows || []
}

// Home games only
async function fetchFormHome(env, norm, limit = 5) {
  const { results: rows } = await env.SB_DB.prepare(`
    SELECT score_home AS score_for, score_away AS score_against
    FROM matches_raw
    WHERE home_team_norm = ?
      AND status = 'post'
      AND score_home IS NOT NULL AND score_away IS NOT NULL
    ORDER BY match_date DESC
    LIMIT ?
  `).bind(norm, limit).all().catch(() => ({ results: [] }))
  return rows || []
}

// Away games only
async function fetchFormAway(env, norm, limit = 5) {
  const { results: rows } = await env.SB_DB.prepare(`
    SELECT score_away AS score_for, score_home AS score_against
    FROM matches_raw
    WHERE away_team_norm = ?
      AND status = 'post'
      AND score_home IS NOT NULL AND score_away IS NOT NULL
    ORDER BY match_date DESC
    LIMIT ?
  `).bind(norm, limit).all().catch(() => ({ results: [] }))
  return rows || []
}

// Prefix fuzzy match fallback (first 8 chars)
async function fetchFormFuzzy(env, prefix, limit = 7) {
  if (prefix.length < 4) return []
  const { results: fuzzy } = await env.SB_DB.prepare(`
    SELECT
      CASE WHEN substr(home_team_norm,1,8) = ? THEN score_home ELSE score_away END AS score_for,
      CASE WHEN substr(home_team_norm,1,8) = ? THEN score_away ELSE score_home END AS score_against
    FROM matches_raw
    WHERE (substr(home_team_norm,1,8) = ? OR substr(away_team_norm,1,8) = ?)
      AND status = 'post'
      AND score_home IS NOT NULL AND score_away IS NOT NULL
    ORDER BY match_date DESC
    LIMIT ?
  `).bind(prefix, prefix, prefix, prefix, limit).all().catch(() => ({ results: [] }))
  return fuzzy || []
}

// Fetch form from matches_raw — tries exact then fuzzy
// Uses rawNorm (matches ingestMatches.js format) for matches_raw queries.
// Stores results under normTeam key (matches odds/normalize.js) for signalBlender.
async function fetchFormFromMatchesRaw(env, teamName) {
  const raw = rawNorm(teamName)  // matches matches_raw.home_team_norm
  if (!raw) return { all: null, home: null, away: null }

  const [allRows, homeRows, awayRows] = await Promise.all([
    fetchFormAll(env, raw),
    fetchFormHome(env, raw),
    fetchFormAway(env, raw),
  ])

  // Exact match: need >= 3 all-venue games
  if (allRows.length >= 3) {
    return {
      all:  computeFormFromRows(allRows),
      home: homeRows.length >= 2 ? computeFormFromRows(homeRows) : null,
      away: awayRows.length >= 2 ? computeFormFromRows(awayRows) : null,
    }
  }

  // Prefix fuzzy fallback (rawNorm keeps spaces, so prefix is first word)
  const prefix = raw.split(' ')[0]  // e.g. "club" from "club america"
  if (prefix.length >= 4) {
    const fuzzyRows = await fetchFormFuzzy(env, prefix)
    if (fuzzyRows.length >= 3) {
      return {
        all:  computeFormFromRows(fuzzyRows),
        home: null,   // fuzzy match — venue split unreliable
        away: null,
      }
    }
  }

  return { all: null, home: null, away: null }
}

// Fallback: derive from team_stats season aggregate
async function fetchFormFromStats(env, teamName) {
  const row = await env.SB_DB.prepare(`
    SELECT goals_for, goals_against, btts_pct, over25_pct,
           wins, draws, losses, games_played
    FROM team_stats
    WHERE team_name = ? AND sport = 'football' AND home_away = 'all'
    ORDER BY season DESC LIMIT 1
  `).bind(teamName).first().catch(() => null)

  if (!row?.games_played) return null
  const gp = row.games_played
  const winRate  = (row.wins  || 0) / gp
  const drawRate = (row.draws || 0) / gp
  return {
    last5_scored:   +(((row.goals_for   || 0) / gp)).toFixed(2),
    last5_conceded: +(((row.goals_against || 0) / gp)).toFixed(2),
    btts_rate:      +((row.btts_pct || 0) / 100).toFixed(2),
    form_pts:       Math.round((winRate * 3 + drawRate) * 5),
    clean_sheets:   0,
  }
}

// Upsert a form row for a given home_away venue
async function upsertFormRow(env, teamId, teamName, teamNorm, venue, form) {
  await env.SB_DB.prepare(`
    INSERT OR REPLACE INTO team_form_cache
      (team_id, team_name, team_name_norm, sport, home_away,
       last5_scored, last5_conceded, btts_rate, form_pts, clean_sheets, updated_at)
    VALUES (?, ?, ?, 'football', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    teamId, teamName, teamNorm, venue,
    form.last5_scored, form.last5_conceded,
    form.btts_rate, form.form_pts, form.clean_sheets,
    new Date().toISOString()
  ).run()
}

export async function collectForm(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' }
  const t0 = Date.now()
  let fetched = 0, skipped = 0, from_stats = 0

  try {
    // Auto-migration: add home_away column if it doesn't exist yet (idempotent)
    await env.SB_DB.prepare(
      `ALTER TABLE team_form_cache ADD COLUMN home_away TEXT NOT NULL DEFAULT 'all'`
    ).run().catch(() => {}) // silently ignore "column already exists"
    await env.SB_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_tfc_venue ON team_form_cache(team_name_norm, sport, home_away)`
    ).run().catch(() => {})
    await env.SB_DB.prepare(`
      CREATE TABLE IF NOT EXISTS team_h2h_cache (
        id TEXT PRIMARY KEY, home_norm TEXT NOT NULL, away_norm TEXT NOT NULL,
        sport TEXT NOT NULL DEFAULT 'football', h2h_games INTEGER DEFAULT 0,
        h2h_home_wins INTEGER DEFAULT 0, h2h_draws INTEGER DEFAULT 0,
        h2h_away_wins INTEGER DEFAULT 0, h2h_avg_goals REAL DEFAULT 0,
        h2h_btts_rate REAL DEFAULT 0, updated_at TEXT NOT NULL
      )
    `).run().catch(() => {})

    const mkRow = await env.SB_DB.prepare(
      `SELECT payload FROM bet365_matches_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first().catch(() => null)
    if (!mkRow?.payload) return { ok: true, fetched: 0, reason: 'no matches snapshot' }

    const matches = JSON.parse(mkRow.payload) || []
    const teamNames = new Set()
    for (const m of matches) {
      if (m.home) teamNames.add(m.home)
      if (m.away) teamNames.add(m.away)
    }

    const cutoff = new Date(Date.now() - STALE_MS).toISOString()

    for (const teamName of teamNames) {
      const teamNorm = normTeam(teamName)
      const existing = await env.SB_DB.prepare(
        `SELECT updated_at FROM team_form_cache WHERE team_name_norm = ? AND sport = 'football' AND home_away = 'all'`
      ).bind(teamNorm).first().catch(() => null)
      if (existing?.updated_at && existing.updated_at >= cutoff) { skipped++; continue }

      const { all, home, away } = await fetchFormFromMatchesRaw(env, teamName)
      let source = 'matches_raw'
      let allForm = all

      if (!allForm) {
        allForm = await fetchFormFromStats(env, teamName)
        source = 'season_stats'
        if (allForm) from_stats++
      }
      if (!allForm) continue

      // Always upsert 'all' row
      await upsertFormRow(env, `own_${teamNorm}`, teamName, teamNorm, 'all', allForm)

      // Upsert 'home' and 'away' rows when we have enough data
      if (home) await upsertFormRow(env, `own_${teamNorm}_home`, teamName, teamNorm, 'home', home)
      if (away) await upsertFormRow(env, `own_${teamNorm}_away`, teamName, teamNorm, 'away', away)

      fetched++
    }

    console.log(`${TAG} done — fetched=${fetched} (${from_stats} from stats) skipped=${skipped} in ${Date.now() - t0}ms`)
    return { ok: true, fetched, from_stats, skipped, elapsed_ms: Date.now() - t0 }

  } catch (e) {
    console.error(`${TAG} ERROR:`, e.message)
    return { ok: false, error: e.message, elapsed_ms: Date.now() - t0 }
  }
}
