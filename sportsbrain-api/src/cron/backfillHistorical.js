/**
 * Backfill Histórico — Football-Data.co.uk CSV → matches_raw
 * ───────────────────────────────────────────────────────────
 * Football-Data.co.uk publica CSVs grátis, CC-BY, com 20+ ligas desde 2000.
 * Colunas úteis: Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG,HS,AS,HST,AST,HC,AC,HF,AF,HY,AY,HR,AR,Referee
 *
 * Endpoint disparado via /v1/xg/backfill?admin_key=&league=E0&season=2425
 *
 * Estratégia:
 *   - Ingesta resultados (match-level) em matches_raw com source='fdco'
 *   - Agrega shots/chutes por jogo em shot_events com xG APROXIMADO
 *     (usamos shots × conversão liga-média 0.105, sem coordenadas — flag approximate=1)
 *   - Árbitros vão p/ officials
 *
 * Volume: 1 liga/temporada ≈ 380 jogos ≈ 10k chutes estimados. 5 ligas × 5 seasons = 2k jogos, 50k shots.
 */

import { XG_MODEL_VERSION } from '../models/xgModel.js';

const FDCO_LEAGUE_MAP = {
  'E0': { slug: 'eng.1',  name: 'Premier League' },
  'E1': { slug: 'eng.2',  name: 'Championship' },
  'SP1':{ slug: 'esp.1',  name: 'La Liga' },
  'D1': { slug: 'ger.1',  name: 'Bundesliga' },
  'I1': { slug: 'ita.1',  name: 'Serie A' },
  'F1': { slug: 'fra.1',  name: 'Ligue 1' },
  'P1': { slug: 'por.1',  name: 'Primeira Liga' },
  'N1': { slug: 'ned.1',  name: 'Eredivisie' },
  'B1': { slug: 'bel.1',  name: 'Jupiler League' },
  'SC0':{ slug: 'sco.1',  name: 'Scottish Premiership' },
  'T1': { slug: 'tur.1',  name: 'Super Lig' },
  'G1': { slug: 'gre.1',  name: 'Super League Greece' },
};

function normTeam(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìî]/g, 'i')
    .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 4) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = (cols[j] || '').trim();
    rows.push(row);
  }
  return rows;
}

// Date formato Football-Data: DD/MM/YY ou DD/MM/YYYY
function parseFdcoDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = (parseInt(y) >= 70 ? '19' : '20') + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Estima xG por chute a partir de shots×SOT a nível de jogo.
// Sem coordenadas, usamos taxa média: xG/chute ≈ 0.105 geral, 0.18 se on_target.
function estimateXGFromCounts(shots, shotsOnTarget, goals, isHome) {
  if (!shots || shots < 0) return 0;
  const sot = Math.min(shotsOnTarget || 0, shots);
  const offTarget = shots - sot;
  // Empirical: SOT ≈ 0.18 xG, off-target ≈ 0.04 xG (miss/blocked)
  let xg = sot * 0.18 + offTarget * 0.04;
  // Sanity: nunca menos que 70% dos gols (se acertou mais que a média aponta)
  if (goals && xg < goals * 0.65) xg = goals * 0.65;
  return +xg.toFixed(3);
}

export async function backfillFdco(env, { leagueCode, seasonCode }) {
  const lg = FDCO_LEAGUE_MAP[leagueCode];
  if (!lg) throw new Error(`Unknown league code ${leagueCode}. Supported: ${Object.keys(FDCO_LEAGUE_MAP).join(',')}`);
  // seasonCode formato '2425' = 2024-25
  const csvUrl = `https://www.football-data.co.uk/mmz4281/${seasonCode}/${leagueCode}.csv`;
  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Football-Data HTTP ${res.status} for ${csvUrl}`);
  const text = await res.text();
  const rows = parseCsv(text);

  const stats = { fetched: rows.length, matches: 0, shots: 0, officials: 0, errors: 0 };
  const season = '20' + seasonCode.slice(0, 2);
  const runId = `backfill_${leagueCode}_${seasonCode}_${Date.now()}`;

  // Acumula todas as prepared statements e dispara em batches grandes (reduz subrequest count)
  const matchStmts = [];
  const shotStmts = [];
  const officialStmts = [];
  const matchIds = [];

  for (const r of rows) {
    try {
      const date = parseFdcoDate(r.Date);
      if (!date || !r.HomeTeam || !r.AwayTeam) continue;

      const matchId = `fdco|${leagueCode}|${seasonCode}|${date}|${normTeam(r.HomeTeam)}|${normTeam(r.AwayTeam)}`;
      matchIds.push(matchId);
      const scoreH = r.FTHG === '' ? null : parseInt(r.FTHG);
      const scoreA = r.FTAG === '' ? null : parseInt(r.FTAG);
      const htH    = r.HTHG === '' ? null : parseInt(r.HTHG);
      const htA    = r.HTAG === '' ? null : parseInt(r.HTAG);
      const status = scoreH != null ? 'post' : 'scheduled';

      matchStmts.push(env.SB_DB.prepare(`
        INSERT INTO matches_raw (match_id, source, external_id, league_slug, league_name, season,
          match_date, status, home_team, away_team, home_team_norm, away_team_norm,
          score_home, score_away, score_ht_home, score_ht_away, updated_at)
        VALUES (?, 'fdco', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(match_id) DO UPDATE SET
          score_home=excluded.score_home, score_away=excluded.score_away,
          score_ht_home=excluded.score_ht_home, score_ht_away=excluded.score_ht_away,
          status=excluded.status, updated_at=datetime('now')
      `).bind(
        matchId, matchId, lg.slug, lg.name, season,
        date, status, r.HomeTeam, r.AwayTeam, normTeam(r.HomeTeam), normTeam(r.AwayTeam),
        scoreH, scoreA, htH, htA
      ));
      stats.matches++;

      const hs = r.HS ? parseInt(r.HS) : null;
      const as_ = r.AS ? parseInt(r.AS) : null;
      const hst = r.HST ? parseInt(r.HST) : null;
      const ast = r.AST ? parseInt(r.AST) : null;
      if (hs != null && scoreH != null) {
        const xgH = estimateXGFromCounts(hs, hst, scoreH, true);
        const xgA = estimateXGFromCounts(as_, ast, scoreA, false);
        shotStmts.push(env.SB_DB.prepare(`
          INSERT INTO shot_events (match_id, team, team_norm, minute, period, shot_type,
            body_part, on_target, is_goal, xg_computed, xg_model_ver, is_home)
          VALUES (?, ?, ?, NULL, NULL, 'aggregate', 'foot', ?, ?, ?, 'fdco-agg', 1)
        `).bind(matchId, r.HomeTeam, normTeam(r.HomeTeam), hst || 0, scoreH, xgH));
        shotStmts.push(env.SB_DB.prepare(`
          INSERT INTO shot_events (match_id, team, team_norm, minute, period, shot_type,
            body_part, on_target, is_goal, xg_computed, xg_model_ver, is_home)
          VALUES (?, ?, ?, NULL, NULL, 'aggregate', 'foot', ?, ?, ?, 'fdco-agg', 0)
        `).bind(matchId, r.AwayTeam, normTeam(r.AwayTeam), ast || 0, scoreA, xgA));
        stats.shots += 2;
      }

      if (r.Referee) {
        const yH = parseInt(r.HY || '0') || 0;
        const yA = parseInt(r.AY || '0') || 0;
        const rH = parseInt(r.HR || '0') || 0;
        const rA = parseInt(r.AR || '0') || 0;
        officialStmts.push(env.SB_DB.prepare(`
          INSERT INTO officials (match_id, role, referee_name, referee_norm, yellow_cards, red_cards)
          VALUES (?, 'center', ?, ?, ?, ?)
        `).bind(matchId, r.Referee, normTeam(r.Referee), yH + yA, rH + rA));
        stats.officials++;
      }
    } catch (err) {
      stats.errors++;
    }
  }

  // Purge shots/officials antigos (1 DELETE cobrindo todos os match_ids desta season+liga)
  if (matchIds.length) {
    await env.SB_DB.prepare(
      `DELETE FROM shot_events WHERE match_id LIKE ?`
    ).bind(`fdco|${leagueCode}|${seasonCode}|%`).run();
    await env.SB_DB.prepare(
      `DELETE FROM officials WHERE match_id LIKE ?`
    ).bind(`fdco|${leagueCode}|${seasonCode}|%`).run();
  }

  // Dispara em chunks de 50 (batch = 1 subrequest, limite 1000 por invocation)
  async function flushChunks(stmts, size = 50) {
    for (let i = 0; i < stmts.length; i += size) {
      await env.SB_DB.batch(stmts.slice(i, i + size));
    }
  }
  await flushChunks(matchStmts);
  await flushChunks(shotStmts);
  await flushChunks(officialStmts);

  await env.SB_DB.prepare(
    `INSERT INTO ingestion_log (run_id, source, league_slug, matches_fetched, matches_inserted,
      shots_inserted, errors) VALUES (?, 'fdco', ?, ?, ?, ?, ?)`
  ).bind(runId, lg.slug, stats.fetched, stats.matches, stats.shots, stats.errors).run();

  return { runId, leagueCode, leagueSlug: lg.slug, seasonCode, season, ...stats };
}

export async function backfillMultiple(env, { leagueCodes, seasonCodes }) {
  const results = [];
  for (const lg of leagueCodes) {
    for (const sc of seasonCodes) {
      try {
        const r = await backfillFdco(env, { leagueCode: lg, seasonCode: sc });
        results.push(r);
      } catch (err) {
        results.push({ leagueCode: lg, seasonCode: sc, error: err.message });
      }
    }
  }
  return results;
}
