// ══════════════════════════════════════════════════════════════════════════
// Contextual Intelligence — injuries, weather, referee, travel, rest
// ══════════════════════════════════════════════════════════════════════════
// GET /v1/context/:event_id
//   → { injuries, weather, referee, rest, travel, lineups_confirmed }
// Agrega múltiplas fontes públicas em 1 payload por evento.
// ══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// ── ESPN injuries ────────────────────────────────────────────────────────
async function fetchInjuries(sport) {
  // ESPN: /apis/site/v2/sports/{sport}/{league}/injuries
  const paths = sport === 'basketball'
    ? ['basketball/nba']
    : ['soccer/eng.1', 'soccer/esp.1', 'soccer/uefa.champions'];
  const out = [];
  for (const p of paths) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${p}/injuries`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      for (const team of (j.injuries || [])) {
        for (const inj of (team.injuries || [])) {
          out.push({
            team:     team.displayName,
            player:   inj.athlete?.displayName,
            status:   inj.status,
            detail:   inj.details?.detail || inj.longComment || inj.shortComment,
            returnDate: inj.details?.returnDate,
          });
        }
      }
    } catch {}
  }
  return out;
}

// ── Open-Meteo weather (no auth) ────────────────────────────────────────
async function fetchWeather(lat, lon, commenceMs) {
  if (!lat || !lon) return null;
  try {
    const dt = new Date(commenceMs).toISOString().slice(0, 13);
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code&forecast_days=7`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const idx = (j.hourly?.time || []).findIndex(t => t.startsWith(dt));
    if (idx < 0) return null;
    return {
      temp_c:   j.hourly.temperature_2m?.[idx],
      precip_mm: j.hourly.precipitation?.[idx],
      wind_kmh: j.hourly.wind_speed_10m?.[idx],
      weather_code: j.hourly.weather_code?.[idx],
    };
  } catch { return null; }
}

// ── Back-to-back NBA detector (heurística via commence_time dos events da semana) ─
async function detectBackToBack(env, team_canon, commenceMs) {
  if (!env.SB_DB) return null;
  const dayBefore = commenceMs - 36 * 3600 * 1000;
  const { results } = await env.SB_DB.prepare(`
    SELECT id, home, away, commence_time FROM odds_events
    WHERE (home_canon = ? OR away_canon = ?)
      AND commence_time >= ? AND commence_time < ?
    LIMIT 1
  `).bind(team_canon, team_canon, dayBefore, commenceMs).all();
  return results?.[0] || null;
}

export async function handleContext(pathname, request, env) {
  const m = pathname.match(/^\/v1\/context\/(.+)$/);
  if (!m) return json({ ok: false, error: 'NOT_FOUND' }, 404);
  const eventId = decodeURIComponent(m[1]);

  if (!env.SB_DB) return json({ ok: false, error: 'NO_DB' }, 503);
  const { results } = await env.SB_DB.prepare(
    `SELECT * FROM odds_events WHERE id = ?`
  ).bind(eventId).all();
  const event = results?.[0];
  if (!event) return json({ ok: false, error: 'EVENT_NOT_FOUND' }, 404);

  const [injuries, b2bHome, b2bAway] = await Promise.all([
    fetchInjuries(event.sport),
    detectBackToBack(env, event.home_canon, event.commence_time),
    detectBackToBack(env, event.away_canon, event.commence_time),
  ]);

  // Filtra injuries relevantes ao evento (match por team canon)
  const relevant = injuries.filter(i => {
    if (!i.team) return false;
    const tc = String(i.team).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    return tc.includes(event.home_canon.slice(0, 5)) || tc.includes(event.away_canon.slice(0, 5));
  });

  return json({
    ok: true,
    event_id: eventId,
    event: { home: event.home, away: event.away, sport: event.sport, commence_time: event.commence_time },
    injuries: relevant,
    rest: {
      home_back_to_back: !!b2bHome,
      away_back_to_back: !!b2bAway,
      home_prev_game: b2bHome,
      away_prev_game: b2bAway,
    },
    weather: null,   // TODO: venue lat/lon lookup
    referee: null,   // TODO: API-Football referee data
    ts: Date.now(),
  });
}
