// ══════════════════════════════════════════════════════════════════════════
// Referee enrichment — derived stats from our own game_results table.
// (ESPN sometimes exposes referee via gamecast; we read whatever we stored.)
// ══════════════════════════════════════════════════════════════════════════

const TAG = '[enrich:referee]';

// Compute stats for a referee name from game_results.referee_name column
// Returns null if < 5 games of data.
export async function computeRefereeStats(env, refName) {
  if (!env.SB_DB || !refName) return null;
  try {
    const row = await env.SB_DB.prepare(`
      SELECT COUNT(*) AS n_games,
             AVG(home_yellow + away_yellow) AS avg_yellow,
             AVG(home_red    + away_red)    AS avg_red,
             AVG(home_foul   + away_foul)   AS avg_fouls,
             AVG(home_pen    + away_pen)    AS avg_pens
        FROM game_results
       WHERE referee_name = ?
    `).bind(refName).first().catch(() => null);
    if (!row || !row.n_games || row.n_games < 5) return null;
    return {
      referee: refName,
      n_games: row.n_games,
      avg_yellow: row.avg_yellow ?? null,
      avg_red:    row.avg_red    ?? null,
      avg_fouls:  row.avg_fouls  ?? null,
      avg_pens:   row.avg_pens   ?? null,
    };
  } catch (e) {
    console.warn(`${TAG} error: ${e.message}`);
    return null;
  }
}

// Heuristic: referee is "extreme" if avg cards or pens are 1.5× league mean
export function isRefereeExtreme(stats, leagueAvgYellow = 4.0, leagueAvgPens = 0.25) {
  if (!stats) return false;
  if (stats.avg_yellow && stats.avg_yellow >= leagueAvgYellow * 1.5) return true;
  if (stats.avg_pens   && stats.avg_pens   >= leagueAvgPens * 2.0)  return true;
  return false;
}

// Try to pull referee from ESPN gamecast/summary (best-effort).
export async function fetchRefereeFromESPN(espnEventId, { sport = 'soccer', league = 'eng.1' } = {}) {
  if (!espnEventId) return null;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${espnEventId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const officials = data?.gameInfo?.officials
                   || data?.header?.competitions?.[0]?.officials
                   || [];
    const head = officials.find(o => /head|referee|center/i.test(o?.position?.displayName || ''));
    const pick = head || officials[0];
    return pick?.displayName || pick?.fullName || null;
  } catch (e) {
    console.warn(`${TAG} espn error: ${e.message}`);
    return null;
  }
}
