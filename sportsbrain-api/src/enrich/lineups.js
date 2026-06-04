// ══════════════════════════════════════════════════════════════════════════
// Lineups enrichment — ESPN gamecast/summary endpoint (best-effort)
// ══════════════════════════════════════════════════════════════════════════

const TAG = '[enrich:lineups]';

// espnEventId: the ESPN event/game id (numeric string)
// sport/league: e.g. soccer/eng.1, basketball/nba
export async function fetchLineupsFromESPN(env, { espnEventId, sport = 'soccer', league = 'eng.1', homeTeam, awayTeam } = {}) {
  if (!espnEventId) return null;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${espnEventId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`${TAG} non-200 ${res.status}`);
      return null;
    }
    const data = await res.json();
    const rosters = data?.rosters || data?.boxscore?.players || [];
    if (!Array.isArray(rosters) || rosters.length < 2) return null;

    const toLineup = (r) => {
      const list = r?.roster || r?.athletes || [];
      return (Array.isArray(list) ? list : [])
        .filter(p => p?.starter === true || p?.position?.starter === true || p?.subbed === false)
        .map(p => ({
          id:       p?.athlete?.id || p?.id || null,
          name:     p?.athlete?.displayName || p?.displayName || p?.name || '',
          position: p?.position?.abbreviation || p?.position?.name || null,
          jersey:   p?.jersey || p?.athlete?.jersey || null,
        }))
        .filter(p => p.name);
    };

    // Determine home/away by homeAway field
    let homeRoster = null, awayRoster = null;
    for (const r of rosters) {
      const ha = r?.homeAway || r?.team?.homeAway;
      if (ha === 'home') homeRoster = r;
      else if (ha === 'away') awayRoster = r;
    }
    if (!homeRoster && rosters.length >= 1) homeRoster = rosters[0];
    if (!awayRoster && rosters.length >= 2) awayRoster = rosters[1];

    const home_lineup = toLineup(homeRoster);
    const away_lineup = toLineup(awayRoster);
    const confirmed = home_lineup.length >= 5 && away_lineup.length >= 5;

    return { home_lineup, away_lineup, confirmed, source: 'espn' };
  } catch (e) {
    console.warn(`${TAG} error: ${e.message}`);
    return null;
  }
}
