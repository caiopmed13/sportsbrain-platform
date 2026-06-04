// proactiveChutesGen.js — F2.57
// Gera cards CHUTES (player_shots) PROATIVAMENTE a partir do histórico
// no D1 (Cartola + 365Scores), em vez de esperar tipsters publicarem.
//
// Estratégia:
//   1. Para cada match agendado (today/tomorrow) com fixture conhecido,
//      buscar os jogadores dos 2 times que tem N>=5 jogos no histórico
//   2. Computar avg_shots por jogador via Poisson
//   3. Linha hard-coded em 1.5 chutes (FAIXA real publica essa linha)
//   4. P(X > 1.5) = 1 - P(X<=1) com Poisson(avg_shots)
//   5. Odd presumida 1.7 (linha conservadora p/ 1.5 chutes — calibrada
//      observando FAIXA). User pode reapplicar EV depois com odds reais.

import { getPlayerShotAverages } from './htHistoricalAverages.js';

// F2.66: relaxado de n>=5 → n>=3, avg>=1.0 (era 1.2). Pool de hoje frequentemente
// tem matches amistosos/internacionais onde times principais não jogam — relaxar
// permite cobrir mais matches usando players com 3+ jogos de histórico.
const MIN_GAMES = 3;
const MIN_AVG_SHOTS = 1.0;
const LINE_DEFAULT = 1.5;
const ASSUMED_ODD = 1.7;   // FAIXA real publica HT player shots ~1.7
const MAX_PER_MATCH = 4;   // até 4 jogadores por match
const MAX_CARDS_TOTAL = 30;

/** Poisson P(X >= k) for k integer */
function poissonOver(avg, line) {
  if (!Number.isFinite(avg) || avg <= 0) return null;
  const k = Math.floor(line);
  let cdf = 0;
  let term = Math.exp(-avg);
  cdf += term;
  for (let i = 1; i <= k; i++) {
    term *= avg / i;
    cdf += term;
  }
  return Math.max(0.02, Math.min(0.98, 1 - cdf));
}

function normTeam(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b|\be\.?c\.?\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Lista top chutadores de um time, baseado no histórico D1.
 * Combina shot_events (per-shot) + player_match_aggs (Cartola).
 * @returns Array<{player_name, avg_shots, n_games, source}>
 */
async function getTopShooters(env, teamName, limit = 6) {
  if (!env?.SB_DB || !teamName) return [];
  const tn = normTeam(teamName);
  if (!tn) return [];
  const tnLike = `%${tn}%`;

  // 1) shot_events agregado por player
  const espnRows = await env.SB_DB.prepare(`
    SELECT player_name, COUNT(*) as total_shots, COUNT(DISTINCT match_id) as games
    FROM shot_events
    WHERE team_norm LIKE ? AND player_name IS NOT NULL AND player_name != ''
    GROUP BY player_name
    HAVING games >= ?
    ORDER BY (total_shots * 1.0 / games) DESC
    LIMIT ?
  `).bind(tnLike, MIN_GAMES, limit * 2).all().catch(() => ({ results: [] }));

  // 2) player_match_aggs (Cartola, Brasileirão)
  const cartolaRows = await env.SB_DB.prepare(`
    SELECT player_name, SUM(shots) as total_shots, COUNT(DISTINCT match_id) as games
    FROM player_match_aggs
    WHERE team_norm LIKE ? AND source = 'cartola' AND player_name IS NOT NULL
    GROUP BY player_norm
    HAVING games >= ?
    ORDER BY (total_shots * 1.0 / games) DESC
    LIMIT ?
  `).bind(tnLike, MIN_GAMES, limit * 2).all().catch(() => ({ results: [] }));

  const merged = new Map();
  for (const r of (espnRows?.results || [])) {
    const avg = (+r.total_shots) / (+r.games || 1);
    if (avg < MIN_AVG_SHOTS) continue;
    const key = (r.player_name || '').toLowerCase();
    merged.set(key, { player_name: r.player_name, avg_shots: avg, n_games: +r.games, source: 'shot_events' });
  }
  for (const r of (cartolaRows?.results || [])) {
    const avg = (+r.total_shots) / (+r.games || 1);
    if (avg < MIN_AVG_SHOTS) continue;
    const key = (r.player_name || '').toLowerCase();
    const existing = merged.get(key);
    if (!existing || existing.n_games < +r.games) {
      // prefer more games
      merged.set(key, { player_name: r.player_name, avg_shots: avg, n_games: +r.games, source: existing ? 'both' : 'cartola' });
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.avg_shots - a.avg_shots)
    .slice(0, limit);
}

/**
 * Para uma lista de matches agendados (home_team/away_team strings),
 * gera cards CHUTES proativos.
 *
 * @param {object} env
 * @param {Array<{match, home_team, away_team, kickoff_iso, league, league_label}>} matches
 * @returns {Array} cards no formato CHUTES (compatible com buildChutes output)
 */
export async function generateProactiveChutesCards(env, matches) {
  if (!env?.SB_DB || !Array.isArray(matches) || matches.length === 0) return [];

  const dedupeMatches = new Map();
  for (const m of matches) {
    if (!m.match || !m.home_team || !m.away_team) continue;
    const key = m.match.toLowerCase();
    if (!dedupeMatches.has(key)) dedupeMatches.set(key, m);
  }

  const cards = [];
  for (const match of dedupeMatches.values()) {
    if (cards.length >= MAX_CARDS_TOTAL) break;
    try {
      const [homeShooters, awayShooters] = await Promise.all([
        getTopShooters(env, match.home_team, MAX_PER_MATCH),
        getTopShooters(env, match.away_team, MAX_PER_MATCH),
      ]);
      const allShooters = [
        ...homeShooters.map(s => ({ ...s, team: match.home_team, is_home: 1 })),
        ...awayShooters.map(s => ({ ...s, team: match.away_team, is_home: 0 })),
      ];

      for (const s of allShooters) {
        if (cards.length >= MAX_CARDS_TOTAL) break;
        const prob = poissonOver(s.avg_shots, LINE_DEFAULT);
        if (!prob) continue;
        const ev_pct = +((prob * ASSUMED_ODD - 1) * 100).toFixed(2);
        // skip cards com EV < -5% (assumimos odd 1.7; user pode reaplicar odd real)
        if (ev_pct < -5) continue;

        const leg = {
          match: match.match,
          home_team: match.home_team,
          away_team: match.away_team,
          league: match.league || match.league_label || 'Modelo (Cartola+365Scores)',
          league_label: 'Modelo proativo',
          market: 'PLAYER_SHOTS',
          stat: 'over_shots',
          line: LINE_DEFAULT,
          direction: 'over_shots',
          team: s.team,
          player_name: s.player_name,
          selection: `${s.player_name} · Mais de ${LINE_DEFAULT} chutes`,
          odd: ASSUMED_ODD,
          prob,
          conf: Math.round(prob * 100),
          ev_pct,
          source: 'proactive',
          odd_source: 'modelo',
          is_focal: false,
          is_faixa: false,
          channel_name: null,
          analysis: `Média ${s.avg_shots.toFixed(2)} chutes/jogo (n=${s.n_games}, ${s.source}). Poisson P(X>${LINE_DEFAULT}) = ${(prob*100).toFixed(1)}%.`,
          _proactive_chutes: true,
          _player_avg: s.avg_shots,
          _player_n: s.n_games,
        };
        const card_id = `chutes|${match.match.toLowerCase()}|${s.player_name.toLowerCase()}|p${Date.now().toString(36).slice(-3)}`;
        const tier_class = (1 / (prob * ASSUMED_ODD)) < 100 ? 'cards' : 'conservador';
        cards.push({
          card_id,
          method: 'chutes',
          match: match.match,
          player_name: s.player_name,
          kickoff_iso: match.kickoff_iso || null,
          legs: [leg],
          n_legs: 1,
          combined_odd:  ASSUMED_ODD,
          combined_prob: +prob.toFixed(4),
          ev_pct,
          tier_class,
          _proactive: true,
        });
      }
    } catch (e) {
      console.warn('[proactiveChutesGen] match failed:', match.match, e?.message);
    }
  }

  // Dedupe por player_name (case-insensitive) — vários "match" strings podem mapear ao mesmo jogo
  const seenPlayers = new Set();
  const deduped = [];
  cards.sort((a, b) => b.ev_pct - a.ev_pct);
  for (const c of cards) {
    const key = (c.player_name || '').toLowerCase().trim();
    if (!key || seenPlayers.has(key)) continue;
    seenPlayers.add(key);
    deduped.push(c);
  }
  return deduped;
}
