// matchAnalysis.js — P2: Análise Contextual Estilo FAIXA
// GET  /v1/analysis/match/:fixtureId  — retorna análise contextual PT-BR
// POST /internal/upsert-analytics    — ingest externo (auth: SB_INGEST_SECRET)

import { corsHeaders } from './health.js'
import { isValidIngestSecret } from '../utils/ingestAuth.js'

// ── Ensure table exists (idempotente) ──────────────────────────────────────
async function ensureAnalyticsTable(db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS match_analytics (fixture_id TEXT PRIMARY KEY, home_team TEXT, away_team TEXT, league TEXT, match_date TEXT, home_form TEXT, away_form TEXT, h2h_avg_goals REAL, h2h_avg_corners REAL, h2h_avg_cards REAL, home_goals_avg REAL, away_goals_avg REAL, home_btts_pct REAL, away_btts_pct REAL, context_pt TEXT, scraped_at TEXT DEFAULT (datetime('now')))`
  )
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_match_analytics_date ON match_analytics(match_date)`
  )
}

// ── Derives a stable fixture_id from pick fields ───────────────────────────
function deriveFixtureId(home, away, date) {
  const clean = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_')
  const d = date ? String(date).slice(0, 10).replace(/-/g, '') : 'nodate'
  return `${clean(home)}_${clean(away)}_${d}`
}

// ── Build form string (W/L/D) from last 5 resolved tips for a team ─────────
async function buildFormString(db, teamName, limit = 5) {
  if (!teamName) return null
  try {
    const { results } = await db.prepare(
      `SELECT result, teams FROM telegram_tips
       WHERE result IS NOT NULL
         AND (teams LIKE ? OR teams LIKE ?)
       ORDER BY posted_at DESC
       LIMIT ?`
    ).bind(`%${teamName}%`, `%${teamName.slice(0, 6)}%`, limit * 3).all()

    if (!results || results.length === 0) return null

    const letters = []
    for (const r of results) {
      if (letters.length >= limit) break
      const res = String(r.result || '').toUpperCase()
      if (res === 'W' || res === 'GREEN' || res === 'WIN') letters.push('V')
      else if (res === 'L' || res === 'RED' || res === 'LOSS') letters.push('D')
      else if (res === 'D' || res === 'DRAW' || res === 'PUSH') letters.push('E')
    }
    return letters.length > 0 ? `[${letters.join('')}]` : null
  } catch {
    return null
  }
}

// ── Estimate avg goals from last N tips for a team ─────────────────────────
async function buildGoalsAvg(db, teamName, limit = 5) {
  if (!teamName) return null
  try {
    const { results } = await db.prepare(
      `SELECT line, market FROM telegram_tips
       WHERE result IS NOT NULL
         AND (market = 'TOTAL_GOALS' OR market_tag LIKE 'over%' OR market_tag LIKE 'under%')
         AND (teams LIKE ? OR teams LIKE ?)
       ORDER BY posted_at DESC
       LIMIT ?`
    ).bind(`%${teamName}%`, `%${teamName.slice(0, 6)}%`, limit).all()

    if (!results || results.length === 0) return null
    const lines = results.map(r => parseFloat(r.line)).filter(v => !isNaN(v))
    if (lines.length === 0) return null
    return +(lines.reduce((a, b) => a + b, 0) / lines.length).toFixed(2)
  } catch {
    return null
  }
}

// ── Build context_pt string ────────────────────────────────────────────────
function buildContextPt({ home_team, away_team, home_form, away_form, h2h_avg_goals, fav_odd, fav_team }) {
  const parts = []
  if (home_form) parts.push(`${home_team} vem de ${home_form}`)
  if (away_form) parts.push(`${away_team} vem de ${away_form}`)
  if (h2h_avg_goals != null) parts.push(`H2H: ${h2h_avg_goals} gols/jogo em média`)
  if (fav_team && fav_odd) parts.push(`Favorito: ${fav_team} (odd ${fav_odd})`)
  return parts.length > 0 ? parts.join(' • ') : null
}

// ── GET /v1/analysis/match/:fixtureId ──────────────────────────────────────
export async function handleMatchAnalysis(request, env, fixtureId) {
  const db = env.SB_DB || env.DB
  if (!db) {
    return new Response(JSON.stringify({ ok: false, error: 'no db' }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  try {
    await ensureAnalyticsTable(db)

    // 1. Try cache first
    const cached = await db.prepare(
      `SELECT * FROM match_analytics WHERE fixture_id = ?`
    ).bind(fixtureId).first()

    if (cached) {
      return new Response(JSON.stringify({
        ok: true,
        fixture_id: cached.fixture_id,
        home_team: cached.home_team,
        away_team: cached.away_team,
        home_form: cached.home_form,
        away_form: cached.away_form,
        context_pt: cached.context_pt,
        h2h_avg_goals: cached.h2h_avg_goals,
        home_goals_avg: cached.home_goals_avg,
        away_goals_avg: cached.away_goals_avg,
        scraped_at: cached.scraped_at,
      }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
    }

    // 2. Not cached — try to derive from existing telegram_tips + bet365_odds
    // Find a recent tip matching the fixture_id pattern (home_away_date)
    const parts = fixtureId.split('_')
    // fixtureId format: home_away_YYYYMMDD — split loosely
    let home_team = null, away_team = null

    // Try to find from telegram_tips by matching teams
    // We'll search the most recent picks in bet365_odds or telegram_tips
    try {
      const { results: tipsRows } = await db.prepare(
        `SELECT teams, posted_at FROM telegram_tips
         WHERE result IS NULL
         ORDER BY posted_at DESC
         LIMIT 200`
      ).all()

      // Try to find a match whose derived ID matches
      for (const row of (tipsRows || [])) {
        try {
          const teams = JSON.parse(row.teams || '[]')
          if (teams.length < 2) continue
          const h = teams[0], a = teams[1]
          const date = row.posted_at
            ? new Date(row.posted_at).toISOString().slice(0, 10).replace(/-/g, '')
            : ''
          const derived = deriveFixtureId(h, a, date)
          if (derived === fixtureId) {
            home_team = h; away_team = a; break
          }
        } catch { continue }
      }
    } catch { /* ignore */ }

    if (!home_team || !away_team) {
      return new Response(JSON.stringify({
        ok: false,
        fixture_id: fixtureId,
        context_pt: null,
        error: 'sem dados históricos',
      }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
    }

    // 3. Build form strings and averages
    const [home_form, away_form, home_goals_avg, away_goals_avg] = await Promise.all([
      buildFormString(db, home_team),
      buildFormString(db, away_team),
      buildGoalsAvg(db, home_team),
      buildGoalsAvg(db, away_team),
    ])

    // 4. Estimate h2h_avg_goals
    let h2h_avg_goals = null
    if (home_goals_avg != null && away_goals_avg != null) {
      h2h_avg_goals = +((home_goals_avg + away_goals_avg) / 2).toFixed(2)
    } else if (home_goals_avg != null) {
      h2h_avg_goals = home_goals_avg
    } else if (away_goals_avg != null) {
      h2h_avg_goals = away_goals_avg
    }

    // 5. Find favorite from bet365_odds if available
    let fav_team = null, fav_odd = null
    try {
      const { results: oddsRows } = await db.prepare(
        `SELECT home_team, away_team, market, direction, odd
         FROM bet365_odds
         WHERE (home_team LIKE ? OR away_team LIKE ?)
           AND market IN ('1X2', 'RESULT')
         ORDER BY scraped_at DESC
         LIMIT 10`
      ).bind(`%${home_team.slice(0, 6)}%`, `%${away_team.slice(0, 6)}%`).all()

      for (const row of (oddsRows || [])) {
        if (row.direction === 'home' && row.odd) {
          fav_team = row.home_team || home_team
          fav_odd = row.odd
          break
        }
        if (row.direction === 'away' && row.odd) {
          fav_team = row.away_team || away_team
          fav_odd = row.odd
          break
        }
      }
    } catch { /* no odds table yet */ }

    const context_pt = buildContextPt({ home_team, away_team, home_form, away_form, h2h_avg_goals, fav_odd, fav_team })

    // 6. Cache the result
    if (context_pt || home_form || away_form) {
      try {
        await db.prepare(
          `INSERT OR REPLACE INTO match_analytics
           (fixture_id, home_team, away_team, home_form, away_form, h2h_avg_goals, home_goals_avg, away_goals_avg, context_pt, scraped_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(fixtureId, home_team, away_team, home_form, away_form, h2h_avg_goals, home_goals_avg, away_goals_avg, context_pt).run()
      } catch { /* non-fatal */ }
    }

    return new Response(JSON.stringify({
      ok: true,
      fixture_id: fixtureId,
      home_team,
      away_team,
      home_form,
      away_form,
      context_pt,
      h2h_avg_goals,
      home_goals_avg,
      away_goals_avg,
      scraped_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('[matchAnalysis]', e.message)
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }
}

// ── POST /internal/upsert-analytics ───────────────────────────────────────
export async function handleUpsertAnalytics(request, env) {
  const db = env.SB_DB || env.DB
  if (!db) {
    return new Response(JSON.stringify({ ok: false, error: 'no db' }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  // Auth — contrato único de ingest (Fase 1)
  if (!isValidIngestSecret(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  try {
    await ensureAnalyticsTable(db)
    const body = await request.json()

    const {
      fixture_id, home_team, away_team, league, match_date,
      home_form, away_form,
      h2h_avg_goals, h2h_avg_corners, h2h_avg_cards,
      home_goals_avg, away_goals_avg,
      home_btts_pct, away_btts_pct,
      context_pt,
    } = body

    if (!fixture_id) {
      return new Response(JSON.stringify({ ok: false, error: 'fixture_id required' }), {
        status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      })
    }

    await db.prepare(
      `INSERT OR REPLACE INTO match_analytics
       (fixture_id, home_team, away_team, league, match_date, home_form, away_form,
        h2h_avg_goals, h2h_avg_corners, h2h_avg_cards,
        home_goals_avg, away_goals_avg, home_btts_pct, away_btts_pct,
        context_pt, scraped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      fixture_id, home_team || null, away_team || null, league || null, match_date || null,
      home_form || null, away_form || null,
      h2h_avg_goals ?? null, h2h_avg_corners ?? null, h2h_avg_cards ?? null,
      home_goals_avg ?? null, away_goals_avg ?? null,
      home_btts_pct ?? null, away_btts_pct ?? null,
      context_pt || null,
    ).run()

    return new Response(JSON.stringify({ ok: true, fixture_id }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('[upsertAnalytics]', e.message)
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }
}
