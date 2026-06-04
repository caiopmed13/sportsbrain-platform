// ══════════════════════════════════════════════════════════════════════════
// Backtester — simula estratégia sobre histórico de snapshots
// ══════════════════════════════════════════════════════════════════════════
//   GET /v1/backtest?strategy=value&min_edge=2&sport=soccer&days=30
//   Retorna: { n_bets, win_rate, roi_pct, avg_clv, equity_curve[] }
//
// Estratégias:
//   value   — apostar todo pick +EV acima do min_edge%
//   arb     — só arbs (profit garantido)
//   sharp   — seguir sharp money moves (Pinnacle drop ≥5%)
// ══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';
import { findValueBets } from '../odds/analytics.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export async function handleBacktest(request, env) {
  if (!env.SB_DB) return json({ ok: false, error: 'NO_DB' }, 503);
  const q = new URL(request.url).searchParams;
  const mode     = q.get('mode') || 'sim';
  const strategy = q.get('strategy') || 'value';
  const minEdge  = parseFloat(q.get('min_edge') || '2');
  const sport    = q.get('sport');
  const days     = parseInt(q.get('days') || '30', 10);
  const unitStake = 1.0;

  // ── MODE REAL: usa picks_closed resolvidos (ground truth) ──
  if (mode === 'real') {
    const since = Date.now() - days * 86400 * 1000;
    const args  = [since, minEdge];
    let sql = `
      SELECT id, event_id, sport, market, outcome, book,
             price_at_pick, edge_pct, clv_pct, result, pnl_units,
             confidence, kelly_frac, picked_at
      FROM picks_closed
      WHERE resolved_at IS NOT NULL AND picked_at >= ? AND edge_pct >= ?
    `;
    if (sport) { sql += ' AND sport = ?'; args.push(sport); }
    sql += ' ORDER BY picked_at ASC LIMIT 2000';

    const { results: picks } = await env.SB_DB.prepare(sql).bind(...args).all();
    if (!picks?.length) return json({
      ok: true, mode: 'real', min_edge: minEdge, n_bets: 0,
      note: 'Sem picks resolvidos no período. Aguardar CLV tracker acumular dados.',
    });

    let bankroll = 100;
    const curve = [{ ts: since, bankroll }];
    let wins = 0, losses = 0, pushes = 0, totalClv = 0, nClv = 0;

    for (const p of picks) {
      bankroll += p.pnl_units || 0;
      curve.push({ ts: p.picked_at, bankroll: +bankroll.toFixed(2) });
      if (p.result === 'win')  wins++;
      if (p.result === 'loss') losses++;
      if (p.result === 'push') pushes++;
      if (p.clv_pct != null)   { totalClv += p.clv_pct; nClv++; }
    }

    const totalPnL = bankroll - 100;
    const n = picks.length;
    return json({
      ok: true,
      mode: 'real', min_edge: minEdge, sport: sport || 'all', days,
      n_bets:    n,
      wins, losses, pushes,
      win_rate:  +((wins / n) * 100).toFixed(1),
      roi_pct:   +((totalPnL / n) * 100).toFixed(2),
      avg_clv:   nClv ? +(totalClv / nClv).toFixed(3) : null,
      starting_bank: 100,
      ending_bank:   +bankroll.toFixed(2),
      total_pnl:     +totalPnL.toFixed(2),
      equity_curve:  curve,
      sample_bets:   picks.slice(0, 20),
    });
  }

  const cutoff = Date.now() - days * 86400 * 1000;

  // Pega todos snapshots no período para eventos settled (status='ft')
  let sqlEvents = `
    SELECT id, sport, home, away, commence_time, status FROM odds_events
    WHERE commence_time >= ? AND commence_time <= ?
  `;
  const args = [cutoff, Date.now()];
  if (sport) { sqlEvents += ' AND sport = ?'; args.push(sport); }
  sqlEvents += ' LIMIT 200';

  const { results: events } = await env.SB_DB.prepare(sqlEvents).bind(...args).all();
  if (!events?.length) return json({ ok: true, strategy, n_bets: 0, note: 'No historical events in window' });

  const bets = [];
  let bankroll = 100;
  const equityCurve = [{ ts: cutoff, bankroll }];

  for (const ev of events) {
    // Snapshot "closing" = último snapshot antes do commence
    const { results: snaps } = await env.SB_DB.prepare(`
      SELECT * FROM odds_snapshots
      WHERE event_id = ? AND ts < ?
      ORDER BY ts DESC LIMIT 500
    `).bind(ev.id, ev.commence_time).all();

    if (!snaps?.length) continue;

    if (strategy === 'value') {
      const values = findValueBets(snaps, minEdge);
      for (const v of values.slice(0, 2)) {
        // Result unknown → simulate pela fair_prob (expected outcome)
        // Isso aproxima o E[ROI]. Pra validação real, precisaria de ground truth (status='ft' + outcome settled).
        const expectedReturn = v.fair_prob * v.price - 1;
        const pnl = +(unitStake * expectedReturn).toFixed(2);
        bankroll += pnl;
        bets.push({ event_id: ev.id, edge_pct: v.edge_pct, ev_pct: v.ev_pct, price: v.price, pnl });
        equityCurve.push({ ts: ev.commence_time, bankroll: +bankroll.toFixed(2) });
      }
    }
  }

  const totalStake = bets.length * unitStake;
  const totalPnL = bankroll - 100;
  const roi = totalStake > 0 ? +((totalPnL / totalStake) * 100).toFixed(2) : 0;

  return json({
    ok: true,
    strategy, min_edge: minEdge, sport: sport || 'all', days,
    n_bets:       bets.length,
    n_events:     events.length,
    starting_bank: 100,
    ending_bank:   +bankroll.toFixed(2),
    total_pnl:     +totalPnL.toFixed(2),
    roi_pct:       roi,
    equity_curve:  equityCurve,
    sample_bets:   bets.slice(0, 20),
    note: 'Baseline backtest uses fair_prob as expected outcome (approx E[ROI]). Ground-truth backtest requires settled ev.status=ft + result logging.',
  });
}
