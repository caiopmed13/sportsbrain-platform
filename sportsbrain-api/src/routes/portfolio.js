// ══════════════════════════════════════════════════════════════════════════
// Portfolio Tracker — CLV-audited pick tracking
// ══════════════════════════════════════════════════════════════════════════
//   POST /v1/portfolio/pick       → registra aposta (+EV/Kelly auto)
//   GET  /v1/portfolio/picks      → lista picks do user (X-SB-Key)
//   PATCH /v1/portfolio/pick/:id  → atualiza status (won/lost/void)
//   GET  /v1/portfolio/stats      → ROI, CLV médio, win rate
// ══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';
import { computeCLV } from '../odds/consensus.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function userKey(request) {
  return request.headers.get('X-SB-Key') || 'anonymous';
}

async function addPick(request, env) {
  const user = userKey(request);
  const body = await request.json().catch(() => ({}));
  const { event_id, market, outcome, line, book, price, stake, ev_pct, kelly, fair_prob } = body;
  if (!event_id || !market || !outcome || !book || !price || !stake) {
    return json({ ok: false, error: 'Missing required fields' }, 400);
  }
  const ev = ev_pct ?? (fair_prob ? +(((fair_prob * price - 1) * 100).toFixed(2)) : null);
  const res = await env.SB_DB.prepare(`
    INSERT INTO odds_portfolio
      (user_key, event_id, market, outcome, line, book, price_entry, stake, ev_pct, kelly, status, placed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).bind(user, event_id, market, outcome, line ?? null, book, price, stake, ev, kelly ?? null, Date.now()).run();
  return json({ ok: true, id: res.meta?.last_row_id, user });
}

async function listPicks(request, env) {
  const user = userKey(request);
  const q = new URL(request.url).searchParams;
  const status = q.get('status');
  const limit = parseInt(q.get('limit') || '100', 10);
  let sql = `SELECT * FROM odds_portfolio WHERE user_key = ?`;
  const args = [user];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY placed_at DESC LIMIT ?';
  args.push(limit);
  const { results } = await env.SB_DB.prepare(sql).bind(...args).all();
  return json({ ok: true, user, picks: results || [] });
}

async function updatePick(request, env, id) {
  const user = userKey(request);
  const body = await request.json().catch(() => ({}));
  const { status, price_close, settled } = body;
  const updates = [];
  const args = [];
  if (status) { updates.push('status = ?'); args.push(status); }
  if (price_close != null) {
    updates.push('price_close = ?'); args.push(price_close);
    // Compute CLV
    const { results } = await env.SB_DB.prepare(
      `SELECT price_entry FROM odds_portfolio WHERE id = ? AND user_key = ?`
    ).bind(id, user).all();
    if (results?.[0]?.price_entry) {
      const clv = computeCLV(results[0].price_entry, price_close);
      if (clv) { updates.push('clv_pct = ?'); args.push(clv.clv_pct); }
    }
  }
  if (settled || ['won','lost','push','void'].includes(status)) {
    updates.push('settled_at = ?'); args.push(Date.now());
  }
  if (!updates.length) return json({ ok: false, error: 'No fields to update' }, 400);
  args.push(id, user);
  await env.SB_DB.prepare(
    `UPDATE odds_portfolio SET ${updates.join(', ')} WHERE id = ? AND user_key = ?`
  ).bind(...args).run();
  return json({ ok: true });
}

async function getStats(request, env) {
  const user = userKey(request);
  const { results } = await env.SB_DB.prepare(
    `SELECT * FROM odds_portfolio WHERE user_key = ?`
  ).bind(user).all();
  const all = results || [];
  const settled = all.filter(p => ['won','lost','push','void'].includes(p.status));
  const wins = settled.filter(p => p.status === 'won');
  const losses = settled.filter(p => p.status === 'lost');

  const totalStake = settled.reduce((s, p) => s + (p.stake || 0), 0);
  const totalReturn = wins.reduce((s, p) => s + p.stake * p.price_entry, 0) +
                      settled.filter(p => p.status === 'push').reduce((s, p) => s + p.stake, 0);
  const profit = totalReturn - totalStake;
  const roi = totalStake > 0 ? +((profit / totalStake) * 100).toFixed(2) : 0;

  const clvValues = settled.map(p => p.clv_pct).filter(v => v != null);
  const avgClv = clvValues.length ? +(clvValues.reduce((a, b) => a + b, 0) / clvValues.length).toFixed(2) : null;

  return json({
    ok: true, user,
    stats: {
      total_picks: all.length,
      open:        all.filter(p => p.status === 'open').length,
      settled:     settled.length,
      won:         wins.length,
      lost:        losses.length,
      win_rate:    settled.length > 0 ? +((wins.length / (wins.length + losses.length)) * 100).toFixed(1) : null,
      total_stake: +totalStake.toFixed(2),
      profit:      +profit.toFixed(2),
      roi_pct:     roi,
      avg_clv_pct: avgClv,
      clv_positive_pct: clvValues.length ? +((clvValues.filter(v => v > 0).length / clvValues.length) * 100).toFixed(1) : null,
    },
  });
}

export async function handlePortfolio(pathname, request, env) {
  if (!env.SB_DB) return json({ ok: false, error: 'NO_DB' }, 503);
  if (pathname === '/v1/portfolio/pick' && request.method === 'POST')  return addPick(request, env);
  if (pathname === '/v1/portfolio/picks')  return listPicks(request, env);
  if (pathname === '/v1/portfolio/stats')  return getStats(request, env);
  const m = pathname.match(/^\/v1\/portfolio\/pick\/(\d+)$/);
  if (m && request.method === 'PATCH') return updatePick(request, env, parseInt(m[1], 10));
  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}
