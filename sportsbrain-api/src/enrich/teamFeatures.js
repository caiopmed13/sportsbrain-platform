// ══════════════════════════════════════════════════════════════════════════
// Team-features orchestrator — aggregates weather/xG/lineups/referee/rest
// into a single object stored in team_features (JSON blob).
// ══════════════════════════════════════════════════════════════════════════
import { fetchWeatherForEvent } from './weather.js';
import { fetchTeamXG }          from './fbref.js';
import { fetchLineupsFromESPN } from './lineups.js';
import { computeRefereeStats, fetchRefereeFromESPN } from './referee.js';
import { computeRestDaysForTeam, computeTravelKm }    from './rest.js';

const TAG = '[enrich:teamFeatures]';

// event: { id, home, away, league, commence_time, venue?, espn_event_id?, sport? }
export async function buildTeamFeatures(env, event) {
  if (!event?.id) return null;
  const sport = event.sport || 'soccer';
  const asOf  = typeof event.commence_time === 'number' ? event.commence_time : Date.now();

  const [weatherR, xgHomeR, xgAwayR, lineupsR, refR, restHR, restAR, travelHR, travelAR] =
    await Promise.allSettled([
      fetchWeatherForEvent(env, event),
      fetchTeamXG(env, event.home, event.league),
      fetchTeamXG(env, event.away, event.league),
      fetchLineupsFromESPN(env, {
        espnEventId: event.espn_event_id,
        sport,
        league: event.league_slug || 'eng.1',
        homeTeam: event.home, awayTeam: event.away,
      }),
      (async () => {
        const name = await fetchRefereeFromESPN(event.espn_event_id, {
          sport, league: event.league_slug || 'eng.1',
        });
        if (!name) return null;
        const stats = await computeRefereeStats(env, name);
        return stats || { referee: name };
      })(),
      computeRestDaysForTeam(env, event.home, asOf),
      computeRestDaysForTeam(env, event.away, asOf),
      computeTravelKm(env, event.home, event.venue || event.home, asOf),
      computeTravelKm(env, event.away, event.venue || event.home, asOf),
    ]);

  const pick = (r) => r.status === 'fulfilled' ? r.value : null;

  const features = {
    event_id: event.id,
    home: {
      xg:        pick(xgHomeR)?.xg_per_game  ?? null,
      xga:       pick(xgHomeR)?.xga_per_game ?? null,
      rest_days: pick(restHR),
      travel_km: pick(travelHR),
      lineup_confirmed: !!pick(lineupsR)?.confirmed,
      lineup: pick(lineupsR)?.home_lineup || null,
    },
    away: {
      xg:        pick(xgAwayR)?.xg_per_game  ?? null,
      xga:       pick(xgAwayR)?.xga_per_game ?? null,
      rest_days: pick(restAR),
      travel_km: pick(travelAR),
      lineup_confirmed: !!pick(lineupsR)?.confirmed,
      lineup: pick(lineupsR)?.away_lineup || null,
    },
    weather:  pick(weatherR),
    referee:  pick(refR),
    built_at: Date.now(),
  };

  // Persist
  if (env.SB_DB) {
    try {
      await env.SB_DB.prepare(`
        INSERT INTO team_features (event_id, features_json, built_at)
          VALUES (?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          features_json = excluded.features_json,
          built_at      = excluded.built_at
      `).bind(event.id, JSON.stringify(features), features.built_at).run();
    } catch (e) { console.warn(`${TAG} persist: ${e.message}`); }
  }
  return features;
}

// Read cached features for an event_id
export async function getTeamFeatures(env, event_id) {
  if (!env.SB_DB) return null;
  try {
    const row = await env.SB_DB.prepare(
      `SELECT features_json, built_at FROM team_features WHERE event_id = ? LIMIT 1`
    ).bind(event_id).first();
    if (!row) return null;
    return { ...JSON.parse(row.features_json || '{}'), built_at: row.built_at };
  } catch { return null; }
}

// Cron entrypoint: enrich all events starting within the next 48h
export async function enrichUpcomingEvents(env, { hoursAhead = 48, maxEvents = 30 } = {}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };
  const { listUpcomingEvents } = await import('../odds/storage.js');
  const events = await listUpcomingEvents(env, { hours: hoursAhead });
  const target = (events || []).slice(0, maxEvents);
  let built = 0, failed = 0;
  for (const ev of target) {
    try {
      const r = await buildTeamFeatures(env, ev);
      if (r) built++;
      else failed++;
    } catch (e) {
      failed++;
      console.warn(`${TAG} buildTeamFeatures err: ${e.message}`);
    }
  }
  return { ok: true, built, failed, total: target.length };
}
