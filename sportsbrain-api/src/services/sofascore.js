// src/services/sofascore.js
// ─────────────────────────────────────────────────────────────────────────────
// SofaScore data layer — D1-backed cache for Cloudflare Workers.
//
// PROBLEMA: api.sofascore.com retorna 403 de IPs de datacenter (Cloudflare).
// SOLUÇÃO: GitHub Actions self-hosted (PC do usuário, IP residencial) busca
// SofaScore e armazena no D1 via POST /internal/sofascore-ingest.
// O Worker lê do D1 (0 subrequests) em vez de chamar a API diretamente.
//
// Fluxo:
//   Ingest script (PC) → POST /internal/sofascore-ingest → D1 tabelas
//   runPickAutoVerify → fetchSofaScoreScoresForDateCached → D1 (ou fallback live)
//                     → fetchSofaScoreBoxStatsCached → D1 (ou fallback live)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza os stats brutos do SofaScore para o formato usado pelo Worker.
 * Input: statsMap de grupos/itens do período ALL.
 * Output: { total, home, away } — mesmo formato de fetchESPNBoxStats.
 */
export function normalizeSofaScoreStats(statsMap) {
  function buildSide(side) {
    const g = (k) => statsMap[k]?.[side] || 0;
    const yc = g('yellowCards');
    const rc = g('redCards');
    return {
      corners:         g('cornerKicks'),
      shots:           g('totalShotsOnGoal'),
      shots_on_target: g('shotsOnGoal'),
      yellow_cards:    yc,
      red_cards:       rc,
      cards:           yc + rc,
      fouls:           g('fouls'),
      offsides:        g('offsides'),
    };
  }
  const home = buildSide('home');
  const away = buildSide('away');
  const addStats = (a, b) => ({
    corners:         a.corners         + b.corners,
    shots:           a.shots           + b.shots,
    shots_on_target: a.shots_on_target + b.shots_on_target,
    yellow_cards:    a.yellow_cards    + b.yellow_cards,
    red_cards:       a.red_cards       + b.red_cards,
    cards:           a.cards           + b.cards,
    fouls:           a.fouls           + b.fouls,
    offsides:        a.offsides        + b.offsides,
  });
  return { total: addStats(home, away), home, away };
}

/**
 * Lê mapa de jogos finalizados do D1 para uma data.
 * Retorna { [normKey]: { home, away, ssEventId, home_ht, away_ht, source } }
 *
 * Se D1 estiver vazio, faz fallback para fetch live (pode retornar {} se 403).
 */
export async function fetchSofaScoreScoresForDateCached(date, env, fetchLiveFn) {
  if (env?.SB_DB) {
    try {
      const rows = await env.SB_DB.prepare(
        `SELECT norm_key, ss_event_id, home_score, away_score, home_ht, away_ht
         FROM sofascore_events
         WHERE event_date = ? AND sport = 'football' AND status = 'finished'`
      ).bind(date).all().catch(() => ({ results: [] }));

      if (rows.results.length > 0) {
        const map = {};
        for (const r of rows.results) {
          const entry = {
            home: r.home_score ?? 0,
            away: r.away_score ?? 0,
            ssEventId: r.ss_event_id,
            home_ht: r.home_ht ?? null,
            away_ht: r.away_ht ?? null,
            source: 'sofascore_d1',
          };
          map[r.norm_key] = entry;
          // Inverted key para match bidirecional
          const [h, a] = r.norm_key.split('|');
          if (h && a) {
            map[`${a}|${h}`] = { ...entry, home: entry.away, away: entry.home };
          }
        }
        return map;
      }
    } catch { /* D1 indisponível */ }
  }

  // Fallback: fetch live (funciona do PC do usuário, pode 403 do Cloudflare)
  if (fetchLiveFn) return fetchLiveFn(date).catch(() => ({}));
  return {};
}

/**
 * Lê box stats do D1 para um ssEventId.
 * Retorna { total, home, away, source: 'sofascore_d1' } ou null.
 *
 * Se D1 não tem o evento, faz fallback para fetch live.
 */
export async function fetchSofaScoreBoxStatsCached(ssEventId, env, fetchLiveFn) {
  if (!ssEventId) return null;

  if (env?.SB_DB) {
    try {
      const row = await env.SB_DB.prepare(
        `SELECT * FROM sofascore_stats WHERE ss_event_id = ?`
      ).bind(ssEventId).first().catch(() => null);

      if (row) {
        return {
          total: {
            corners:         row.corner_home + row.corner_away,
            shots:           row.shots_home + row.shots_away,
            shots_on_target: row.shots_on_target_home + row.shots_on_target_away,
            yellow_cards:    row.yellow_home + row.yellow_away,
            red_cards:       row.red_home + row.red_away,
            cards:           (row.yellow_home + row.yellow_away) + (row.red_home + row.red_away),
            fouls:           row.fouls_home + row.fouls_away,
            offsides:        row.offsides_home + row.offsides_away,
          },
          home: {
            corners:         row.corner_home,
            shots:           row.shots_home,
            shots_on_target: row.shots_on_target_home,
            yellow_cards:    row.yellow_home,
            red_cards:       row.red_home,
            cards:           row.yellow_home + row.red_home,
            fouls:           row.fouls_home,
            offsides:        row.offsides_home,
          },
          away: {
            corners:         row.corner_away,
            shots:           row.shots_away,
            shots_on_target: row.shots_on_target_away,
            yellow_cards:    row.yellow_away,
            red_cards:       row.red_away,
            cards:           row.yellow_away + row.red_away,
            fouls:           row.fouls_away,
            offsides:        row.offsides_away,
          },
          source: 'sofascore_d1',
        };
      }
    } catch { /* D1 indisponível */ }
  }

  // Fallback: fetch live
  if (fetchLiveFn) return fetchLiveFn(ssEventId).catch(() => null);
  return null;
}

/**
 * Registra saúde do SofaScore no D1.
 * Chamada pelo ingest endpoint após cada ingest bem-sucedido.
 */
export async function updateSofaScoreHealth(env, { eventsToday, statsToday, date, error = '' }) {
  if (!env?.SB_DB) return;
  await env.SB_DB.prepare(
    `UPDATE sofascore_health
     SET last_ingest_at = ?, last_ingest_date = ?, events_today = ?, stats_today = ?, last_error = ?, updated_at = ?
     WHERE id = 1`
  ).bind(Date.now(), date, eventsToday, statsToday, error, Date.now()).run().catch(() => {});
}

/**
 * Lê status de saúde do SofaScore do D1.
 */
export async function getSofaScoreHealth(env) {
  if (!env?.SB_DB) return null;
  const row = await env.SB_DB.prepare(
    `SELECT * FROM sofascore_health WHERE id = 1`
  ).first().catch(() => null);
  if (!row) return { status: 'unknown', last_ingest_at: null };

  const ageMin = row.last_ingest_at ? Math.round((Date.now() - row.last_ingest_at) / 60000) : null;
  const status = !row.last_ingest_at
    ? 'never_ingested'
    : ageMin < 180 ? 'ok'           // < 3h — ok
    : ageMin < 360 ? 'degraded'     // 3-6h — degraded
    : 'down';                        // > 6h — down

  return {
    status,
    last_ingest_at:      row.last_ingest_at,
    last_ingest_date:    row.last_ingest_date,
    last_ingest_age_min: ageMin,
    events_today:        row.events_today || 0,
    stats_today:         row.stats_today || 0,
    last_error:          row.last_error || null,
  };
}
