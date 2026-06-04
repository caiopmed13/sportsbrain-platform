// ══════════════════════════════════════════════════════════════════════════
// FBRef team xG/xGA scraper (HTML scrape, 24h cache in team_xg table)
// ══════════════════════════════════════════════════════════════════════════

const TAG = '[enrich:fbref]';

// League → FBRef comp id map
export const COMP_ID = {
  'epl':           9,
  'premier league': 9,
  'laliga':        12,
  'la liga':       12,
  'serie a':       11,
  'seriea':        11,
  'bundesliga':    20,
  'ligue 1':       13,
  'ligue1':        13,
  'ucl':           8,
  'champions league': 8,
  'brasileirao':   24,
  'brasileirão':   24,
  'brasileiro serie a': 24,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normLeagueKey(league) {
  return (league || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '').trim();
}

function normTeamKey(team) {
  return (team || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function readCache(env, team, league) {
  if (!env.SB_DB) return null;
  try {
    const row = await env.SB_DB.prepare(
      `SELECT team, league, xg_per_game, xga_per_game, last_updated
         FROM team_xg WHERE team = ? AND league = ? LIMIT 1`
    ).bind(normTeamKey(team), normLeagueKey(league)).first();
    if (!row) return null;
    if (Date.now() - (row.last_updated || 0) > CACHE_TTL_MS) return null;
    return row;
  } catch { return null; }
}

async function writeCache(env, team, league, xg, xga) {
  if (!env.SB_DB) return;
  try {
    await env.SB_DB.prepare(
      `INSERT INTO team_xg (team, league, xg_per_game, xga_per_game, last_updated)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(team, league) DO UPDATE SET
         xg_per_game   = excluded.xg_per_game,
         xga_per_game  = excluded.xga_per_game,
         last_updated  = excluded.last_updated`
    ).bind(normTeamKey(team), normLeagueKey(league), xg, xga, Date.now()).run();
  } catch (e) { console.warn(`${TAG} writeCache: ${e.message}`); }
}

// Parse FBRef "stats_squads_standard_for" table. We look for rows <tr> with
// data-stat="team" and data-stat="xg", "xg_per90" (or per match) etc.
function parseFBRefTable(html) {
  const teams = [];
  // Grab the relevant table section
  const tableIdx = html.indexOf('id="stats_squads_standard_for"');
  if (tableIdx < 0) return teams;
  const slice = html.slice(tableIdx, tableIdx + 200000);
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRegex.exec(slice))) {
    const row = m[1];
    const teamMatch = row.match(/data-stat="team"[^>]*>(?:<[^>]+>)*([^<]+)</);
    const xgMatch   = row.match(/data-stat="xg_per90"[^>]*>([^<]+)</)
                   || row.match(/data-stat="xg"[^>]*>([^<]+)</);
    const xgaMatch  = row.match(/data-stat="xga_per90"[^>]*>([^<]+)</)
                   || row.match(/data-stat="xga"[^>]*>([^<]+)</);
    const gamesMatch = row.match(/data-stat="games"[^>]*>([^<]+)</);
    if (!teamMatch) continue;
    const team = teamMatch[1].trim();
    const games = gamesMatch ? parseFloat(gamesMatch[1]) : null;
    let xg  = xgMatch  ? parseFloat(xgMatch[1])  : null;
    let xga = xgaMatch ? parseFloat(xgaMatch[1]) : null;
    // If not per-90, convert
    if (xg != null && xg > 5 && games && games > 0)  xg  = xg  / games;
    if (xga != null && xga > 5 && games && games > 0) xga = xga / games;
    teams.push({ team, xg_per_game: xg, xga_per_game: xga });
  }
  return teams;
}

// Primary source: proprietary team_xg_rolling (shot events → xG per 90).
async function readProprietaryXG(env, teamName) {
  if (!env.SB_DB) return null;
  try {
    const key = normTeamKey(teamName);
    // Try exact, then LIKE (handles "Manchester United" vs "manchesterunited")
    let row = await env.SB_DB.prepare(
      `SELECT team_display, xg_per90, xga_per90, games FROM team_xg_rolling
         WHERE window='season' AND games>0 AND team_norm = ? LIMIT 1`
    ).bind(key).first();
    if (!row) {
      const compact = key.replace(/\s+/g, '');
      row = await env.SB_DB.prepare(
        `SELECT team_display, xg_per90, xga_per90, games FROM team_xg_rolling
           WHERE window='season' AND games>0
             AND (REPLACE(team_norm,' ','') = ? OR team_norm LIKE ? OR ? LIKE '%'||team_norm||'%')
           ORDER BY games DESC LIMIT 1`
      ).bind(compact, `%${key}%`, key).first();
    }
    if (!row || row.xg_per90 == null) return null;
    return { xg_per_game: row.xg_per90, xga_per_game: row.xga_per90, source: 'proprietary' };
  } catch (e) { console.warn(`${TAG} proprietary read: ${e.message}`); return null; }
}

// Public: fetch one team's xG/xGA — proprietary first, FBRef fallback.
export async function fetchTeamXG(env, teamName, league) {
  // 1. Proprietary (shot events → team_xg_rolling)
  const prop = await readProprietaryXG(env, teamName);
  if (prop) return prop;

  // 2. FBRef cache
  const cached = await readCache(env, teamName, league);
  if (cached) return { xg_per_game: cached.xg_per_game, xga_per_game: cached.xga_per_game, cached: true, source: 'fbref_cached' };

  const compId = COMP_ID[normLeagueKey(league)];
  if (!compId) {
    console.log(`${TAG} no compId for league: ${league}`);
    return null;
  }

  try {
    const url = `https://fbref.com/en/comps/${compId}/`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SportsBrainBot/1.0)' },
    });
    if (!res.ok) {
      console.warn(`${TAG} non-200 ${res.status}`);
      return null;
    }
    const html = await res.text();
    const teams = parseFBRefTable(html);
    if (!teams.length) {
      console.warn(`${TAG} no teams parsed for compId=${compId}`);
      return null;
    }
    // Cache all teams we found
    for (const t of teams) {
      if (t.xg_per_game != null || t.xga_per_game != null) {
        await writeCache(env, t.team, league, t.xg_per_game, t.xga_per_game);
      }
    }
    const want = normTeamKey(teamName);
    const found = teams.find(t => {
      const tn = normTeamKey(t.team);
      return tn === want || tn.includes(want) || want.includes(tn);
    });
    if (!found) return null;
    return { xg_per_game: found.xg_per_game, xga_per_game: found.xga_per_game, cached: false };
  } catch (e) {
    console.warn(`${TAG} fetch error: ${e.message}`);
    return null;
  }
}
