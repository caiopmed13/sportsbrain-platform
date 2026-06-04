// ══════════════════════════════════════════════════════════════════════════
// Weather enrichment — Open-Meteo (free, no API key)
// ══════════════════════════════════════════════════════════════════════════
import { lookupVenue } from './venues.js';

const TAG = '[enrich:weather]';

// Fetch kickoff-hour weather for a given event.
// event: { venue?, home?, commence_time (unix ms or ISO) }
// Returns { temp_c, precip_mm, wind_kmh } or null.
export async function fetchWeatherForEvent(env, event) {
  try {
    const venueName = event?.venue || event?.home || event?.home_team;
    const coords = lookupVenue(venueName);
    if (!coords) {
      console.log(`${TAG} unknown venue: ${venueName}`);
      return null;
    }

    const commence = event?.commence_time;
    const kickoff = typeof commence === 'number' ? new Date(commence) : new Date(commence || Date.now());
    if (isNaN(kickoff.getTime())) return null;

    const date = kickoff.toISOString().slice(0, 10);
    const targetHourISO = kickoff.toISOString().slice(0, 13) + ':00';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lng}` +
                `&hourly=temperature_2m,precipitation,wind_speed_10m` +
                `&start_date=${date}&end_date=${date}&wind_speed_unit=kmh`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`${TAG} non-200 ${res.status}`);
      return null;
    }
    const data = await res.json();
    const hours = data?.hourly?.time || [];
    const temps = data?.hourly?.temperature_2m || [];
    const precs = data?.hourly?.precipitation || [];
    const winds = data?.hourly?.wind_speed_10m || [];

    // Find closest hour to kickoff
    let idx = hours.indexOf(targetHourISO);
    if (idx === -1) {
      // Nearest hour fallback
      const kickoffMs = kickoff.getTime();
      let best = Infinity;
      for (let i = 0; i < hours.length; i++) {
        const hMs = new Date(hours[i]).getTime();
        const d = Math.abs(hMs - kickoffMs);
        if (d < best) { best = d; idx = i; }
      }
    }
    if (idx < 0 || idx >= temps.length) return null;

    return {
      temp_c:    temps[idx] ?? null,
      precip_mm: precs[idx] ?? null,
      wind_kmh:  winds[idx] ?? null,
      venue:     venueName,
      lat:       coords.lat,
      lng:       coords.lng,
    };
  } catch (e) {
    console.warn(`${TAG} error: ${e.message}`);
    return null;
  }
}

// Detect if weather is "abnormal" (useful for explain flags)
export function isAbnormalWeather(w) {
  if (!w) return false;
  if (w.precip_mm != null && w.precip_mm >= 3) return true;     // heavy rain
  if (w.wind_kmh  != null && w.wind_kmh  >= 35) return true;    // strong wind
  if (w.temp_c    != null && (w.temp_c <= 2 || w.temp_c >= 33)) return true;
  return false;
}
