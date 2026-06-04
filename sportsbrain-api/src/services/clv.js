// ════════════════════════════════════════════════════════════════════
// CLV Tracker — feedback loop pick → closing line → result → ROI
// ════════════════════════════════════════════════════════════════════
// 3 fases:
//   1. recordPick(env, pick)        — grava value bet publicado em picks_closed
//   2. captureClosingLines(env)     — cron: near-kickoff, grava closing_price
//   3. ingestResults(env)           — cron: hourly, busca resultados ESPN/API-Football
//
// Métrica-chave: CLV = (1 / closing_fair) / (1 / price_at_pick) - 1
//   CLV > 0  → bateu o fechamento (sinal de alpha)
//   CLV < 0  → pegou preço pior que o mercado convergiu
// ════════════════════════════════════════════════════════════════════

const CLOSING_WINDOW_MIN = 8;   // minutos antes do kickoff pra capturar closing
const RESULTS_LOOKBACK_H = 72;  // janela pra buscar resultados pendentes

// ── 1. Grava um pick novo ────────────────────────────────────────────
export async function recordPick(env, {
  event_id, sport, league, market, outcome, line, book,
  price, fair_price, edge_pct, n_sharp, sharp_books,
  model_prob, ensemble_prob, confidence, kelly_frac, signals, explain,
  commence_time, source = 'auto',
}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };
  try {
    await env.SB_DB.prepare(`
      INSERT INTO picks_closed (
        event_id, sport, league, market, outcome, line, book,
        price_at_pick, fair_price_at_pick, edge_pct, n_sharp, sharp_books_json,
        model_prob, ensemble_prob, confidence, kelly_frac, signals_json, explain,
        commence_time, source
      ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?)
      ON CONFLICT DO NOTHING
    `).bind(
      event_id, sport || null, league || null, market, outcome, line ?? null, book,
      price, fair_price ?? null, edge_pct ?? null, n_sharp ?? null, JSON.stringify(sharp_books || []),
      model_prob ?? null, ensemble_prob ?? null, confidence || null, kelly_frac ?? null,
      JSON.stringify(signals || {}), explain || null,
      commence_time, source,
    ).run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── 2. Captura closing line (cron near-kickoff) ──────────────────────
// Seleciona picks com closed_at IS NULL e commence_time chegando em
// CLOSING_WINDOW_MIN, pega último snapshot do mesmo book+market+outcome
// antes do kickoff, grava como closing_price + recalcula closing_fair.
export async function captureClosingLines(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };

  const now = Date.now();
  const window = CLOSING_WINDOW_MIN * 60 * 1000;

  const { results: pending } = await env.SB_DB.prepare(`
    SELECT id, event_id, market, outcome, line, book, price_at_pick, commence_time
    FROM picks_closed
    WHERE closed_at IS NULL
      AND commence_time BETWEEN ? AND ?
    LIMIT 200
  `).bind(now - window, now + window).all().catch(() => ({ results: [] }));

  if (!pending?.length) return { ok: true, processed: 0 };

  let captured = 0;
  for (const p of pending) {
    // Último snapshot do próprio book
    const snap = await env.SB_DB.prepare(`
      SELECT price, ts FROM odds_snapshots
      WHERE event_id = ? AND book = ? AND market = ? AND outcome = ?
        AND (line IS NULL OR line = ?)
        AND ts < ?
      ORDER BY ts DESC LIMIT 1
    `).bind(p.event_id, p.book, p.market, p.outcome, p.line ?? null, p.commence_time)
      .first().catch(() => null);

    // Fair price no fechamento: weighted median de sharp books no último minuto
    const { findValueBets } = await import('../odds/analytics.js');
    const { results: closingSnaps } = await env.SB_DB.prepare(`
      SELECT * FROM odds_snapshots
      WHERE event_id = ? AND market = ? AND outcome = ?
        AND ts >= ? AND ts < ?
    `).bind(p.event_id, p.market, p.outcome, p.commence_time - window, p.commence_time)
      .all().catch(() => ({ results: [] }));

    // Usa noVigBatch que já produz fair_price sharp
    let closingFair = null;
    try {
      const { noVigBatch } = await import('../odds/analytics.js');
      const nv = noVigBatch(closingSnaps || []);
      const hit = (nv || []).find(x =>
        x.event_id === p.event_id && x.market === p.market && x.outcome === p.outcome
      );
      closingFair = hit?.fair_price || null;
    } catch (_) { /* graceful */ }

    const closingPrice = snap?.price ?? null;
    const clvPct = (closingFair && p.price_at_pick)
      ? +(((1 / closingFair) / (1 / p.price_at_pick) - 1) * 100).toFixed(3)
      : null;

    await env.SB_DB.prepare(`
      UPDATE picks_closed
      SET closing_price = ?, closing_fair = ?, clv_pct = ?, closed_at = ?
      WHERE id = ?
    `).bind(closingPrice, closingFair, clvPct, Date.now(), p.id).run().catch(() => {});

    captured++;
  }

  return { ok: true, processed: pending.length, captured };
}

// ── 3. Ingestão de resultados (cron hourly) ──────────────────────────
// Tenta buscar em: (a) game_results local (b) API-Football/ESPN
// Marca win/loss/push nos picks com resolved_at NULL cujo jogo já terminou.
export async function ingestResults(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };

  const now = Date.now();
  const lookback = RESULTS_LOOKBACK_H * 3600 * 1000;

  const { results: unresolved } = await env.SB_DB.prepare(`
    SELECT id, event_id, sport, market, outcome, line, price_at_pick, commence_time
    FROM picks_closed
    WHERE resolved_at IS NULL
      AND commence_time BETWEEN ? AND ?
    LIMIT 200
  `).bind(now - lookback, now - 90 * 60 * 1000)  // termina ao menos 90min após kickoff
    .all().catch(() => ({ results: [] }));

  if (!unresolved?.length) return { ok: true, processed: 0 };

  let resolved = 0;
  for (const p of unresolved) {
    const r = await fetchGameResult(env, p.event_id, p.sport, p.commence_time);
    if (!r) continue;

    const outcome = judgeOutcome(p.market, p.outcome, p.line, r.home_score, r.away_score);
    if (!outcome) continue;

    const pnl = outcome === 'win'  ? (+p.price_at_pick - 1)
              : outcome === 'push' ? 0
              : -1;

    await env.SB_DB.prepare(`
      UPDATE picks_closed
      SET result = ?, pnl_units = ?, actual_score = ?, resolved_at = ?
      WHERE id = ?
    `).bind(outcome, pnl, `${r.home_score}-${r.away_score}`, Date.now(), p.id)
      .run().catch(() => {});
    resolved++;
  }

  return { ok: true, processed: unresolved.length, resolved };
}

// Fetch game result: prioriza game_results local, fallback ESPN (se sport_id conhecido)
async function fetchGameResult(env, event_id, sport, commence_time) {
  // 1. D1 local
  const local = await env.SB_DB.prepare(
    'SELECT home_score, away_score FROM game_results WHERE event_id = ? AND home_score IS NOT NULL'
  ).bind(event_id).first().catch(() => null);
  if (local) return local;

  // 2. ESPN scoreboard API (free, best-effort)
  try {
    const espnSport = sport === 'basketball' ? 'basketball/nba' :
                      sport === 'soccer'     ? 'soccer/eng.1'   : null;
    if (!espnSport) return null;
    const date = new Date(commence_time);
    const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/scoreboard?dates=${ymd}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const js = await res.json();
    for (const ev of (js.events || [])) {
      const comp = ev.competitions?.[0];
      if (!comp || comp.status?.type?.state !== 'post') continue;
      const comps = comp.competitors || [];
      const home = comps.find(c => c.homeAway === 'home');
      const away = comps.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      // Match por nome (normalizado) — simplificado
      const hKey = (home.team?.displayName || '').toLowerCase();
      if (!hKey) continue;
      // Grava em game_results pra próxima consulta
      const homeScore = parseInt(home.score, 10);
      const awayScore = parseInt(away.score, 10);
      if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
        await env.SB_DB.prepare(`
          INSERT INTO game_results (event_id, sport, home, away, home_score, away_score, commence_time, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'espn')
          ON CONFLICT(event_id) DO UPDATE SET
            home_score = excluded.home_score, away_score = excluded.away_score
        `).bind(ev.id, sport, home.team?.displayName, away.team?.displayName,
                homeScore, awayScore, commence_time).run().catch(() => {});
        // Sem matching robusto do event_id externo, só retornamos se o id casar
        if (ev.id === event_id) return { home_score: homeScore, away_score: awayScore };
      }
    }
  } catch (_) { /* graceful */ }

  return null;
}

// Decide win/loss dado market + outcome + placar
export function judgeOutcome(market, outcome, line, homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  const total = homeScore + awayScore;

  if (market === 'h2h') {
    if (outcome === 'home' || outcome === 'Home') return homeScore > awayScore ? 'win' : homeScore === awayScore ? 'loss' : 'loss';
    if (outcome === 'away' || outcome === 'Away') return awayScore > homeScore ? 'win' : 'loss';
    if (outcome === 'draw' || outcome === 'Draw') return homeScore === awayScore ? 'win' : 'loss';
    return null;
  }

  if (market === 'totals') {
    if (line == null) return null;
    const diff = total - line;
    if (diff === 0) return 'push';
    if (outcome === 'over'  || outcome === 'Over')  return diff > 0 ? 'win' : 'loss';
    if (outcome === 'under' || outcome === 'Under') return diff < 0 ? 'win' : 'loss';
    return null;
  }

  if (market === 'spreads') {
    if (line == null) return null;
    // outcome = 'home' → home + line > away?
    const adj = outcome === 'home' || outcome === 'Home'
      ? (homeScore + line) - awayScore
      : (awayScore + line) - homeScore;
    if (adj === 0) return 'push';
    return adj > 0 ? 'win' : 'loss';
  }

  if (market === 'btts' || market === 'BTTS') {
    const both = homeScore > 0 && awayScore > 0;
    if (outcome === 'yes' || outcome === 'Yes') return both ? 'win' : 'loss';
    if (outcome === 'no'  || outcome === 'No')  return both ? 'loss' : 'win';
  }

  return null;
}

// ── 4. Agregados de performance (alimenta dashboard) ─────────────────
export async function computePerformance(env, { sport, since } = {}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };
  const args = [];
  let where = 'WHERE resolved_at IS NOT NULL';
  if (sport)  { where += ' AND sport = ?'; args.push(sport); }
  if (since)  { where += ' AND picked_at >= ?'; args.push(since); }

  const agg = await env.SB_DB.prepare(`
    SELECT COUNT(*) AS n,
           SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
           SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) AS pushes,
           SUM(pnl_units) AS pnl,
           AVG(clv_pct) AS avg_clv,
           AVG(edge_pct) AS avg_edge
    FROM picks_closed ${where}
  `).bind(...args).first().catch(() => null);

  const buckets = { '1_3': null, '3_5': null, '5_7': null, '7_plus': null };
  for (const [name, lo, hi] of [['1_3', 1, 3], ['3_5', 3, 5], ['5_7', 5, 7], ['7_plus', 7, 9999]]) {
    const r = await env.SB_DB.prepare(`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
             SUM(pnl_units) AS pnl,
             AVG(clv_pct) AS avg_clv
      FROM picks_closed ${where} AND edge_pct >= ? AND edge_pct < ?
    `).bind(...args, lo, hi).first().catch(() => null);
    const n = r?.n || 0;
    buckets[name] = {
      n,
      win_rate: n ? +((r.wins / n) * 100).toFixed(1) : 0,
      roi_pct:  n ? +((r.pnl  / n) * 100).toFixed(1) : 0,
      avg_clv:  r?.avg_clv != null ? +r.avg_clv.toFixed(3) : null,
    };
  }

  const { results: perBook } = await env.SB_DB.prepare(`
    SELECT book, COUNT(*) AS n,
           SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
           SUM(pnl_units) AS pnl, AVG(clv_pct) AS avg_clv
    FROM picks_closed ${where}
    GROUP BY book ORDER BY n DESC
  `).bind(...args).all().catch(() => ({ results: [] }));

  const n = agg?.n || 0;
  return {
    ok: true,
    totals: {
      n_picks:   n,
      wins:      agg?.wins || 0,
      losses:    agg?.losses || 0,
      pushes:    agg?.pushes || 0,
      win_rate:  n ? +((agg.wins / n) * 100).toFixed(1) : 0,
      pnl_units: +(agg?.pnl || 0).toFixed(2),
      roi_pct:   n ? +(((agg?.pnl || 0) / n) * 100).toFixed(1) : 0,
      avg_clv:   agg?.avg_clv != null ? +agg.avg_clv.toFixed(3) : null,
      avg_edge:  agg?.avg_edge != null ? +agg.avg_edge.toFixed(3) : null,
    },
    by_edge_bucket: buckets,
    by_book: (perBook || []).map(b => ({
      book: b.book,
      n: b.n,
      win_rate: b.n ? +((b.wins / b.n) * 100).toFixed(1) : 0,
      roi_pct:  b.n ? +((b.pnl  / b.n) * 100).toFixed(1) : 0,
      avg_clv:  b.avg_clv != null ? +b.avg_clv.toFixed(3) : null,
    })),
  };
}
