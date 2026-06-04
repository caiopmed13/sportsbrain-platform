// src/routes/signalStatus.js — debug endpoint for signal inspection
// GET /v1/signals/status?home=Arsenal&away=Chelsea

const JSON_HDRS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }

export async function handleSignalStatus(request, env) {
  try {
    const url  = new URL(request.url)
    const home = (url.searchParams.get('home') || '').toLowerCase().trim()
    const away = (url.searchParams.get('away') || '').toLowerCase().trim()

    if (!home || !away) {
      return new Response(JSON.stringify({ error: 'Provide ?home=X&away=Y' }), { status: 400, headers: JSON_HDRS })
    }

    const [steam, lineup, homeForm, awayForm, referee] = await Promise.all([
      env.SB_DB.prepare(
        `SELECT * FROM odds_signals WHERE home_team LIKE ? AND away_team LIKE ? LIMIT 10`
      ).bind(`%${home}%`, `%${away}%`).all().catch(() => ({ results: [] })),

      env.SB_DB.prepare(
        `SELECT * FROM match_lineups WHERE id = ?`
      ).bind(`${home}|${away}`).first().catch(() => null),

      env.SB_DB.prepare(
        `SELECT * FROM team_form_cache WHERE team_name_norm = ? AND sport = 'football'`
      ).bind(home).first().catch(() => null),

      env.SB_DB.prepare(
        `SELECT * FROM team_form_cache WHERE team_name_norm = ? AND sport = 'football'`
      ).bind(away).first().catch(() => null),

      env.SB_DB.prepare(
        `SELECT mr.referee_name, rs.* FROM match_referee mr
         LEFT JOIN referee_signals rs ON mr.referee_name = rs.referee_name
         WHERE mr.id = ?`
      ).bind(`${home}|${away}`).first().catch(() => null),
    ])

    return new Response(JSON.stringify({
      match: `${home} v ${away}`,
      steam:    { rows: steam.results || [] },
      lineup:   lineup,
      home_form: homeForm,
      away_form: awayForm,
      referee:  referee,
    }, null, 2), { headers: JSON_HDRS })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSON_HDRS })
  }
}
