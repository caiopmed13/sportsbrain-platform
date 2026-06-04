// ══════════════════════════════════════════════════════════════════════════
// GET /v1/odds/trajectory/:event_id — full snapshot history + open/close/drift
// ══════════════════════════════════════════════════════════════════════════

const TAG = '[route:trajectory]';
const JSON_HDR = { 'Content-Type': 'application/json' };

export async function handleTrajectory(pathname, request, env) {
  try {
    const event_id = pathname.split('/').filter(Boolean).pop();
    if (!event_id) {
      return new Response(JSON.stringify({ ok: false, error: 'event_id required' }),
        { status: 400, headers: JSON_HDR });
    }
    if (!env.SB_DB) {
      return new Response(JSON.stringify({ ok: false, error: 'no_db' }),
        { status: 503, headers: JSON_HDR });
    }

    const ev = await env.SB_DB.prepare(
      `SELECT id, home, away, commence_time, league, sport FROM odds_events WHERE id = ?`
    ).bind(event_id).first();
    if (!ev) {
      return new Response(JSON.stringify({ ok: false, error: 'event_not_found' }),
        { status: 404, headers: JSON_HDR });
    }

    const { results: snaps } = await env.SB_DB.prepare(`
      SELECT book, market, outcome, line, price, ts FROM odds_snapshots
       WHERE event_id = ?
       ORDER BY ts ASC LIMIT 5000
    `).bind(event_id).all().catch(() => ({ results: [] }));

    // Group by (book, market, outcome, line)
    const groups = new Map();
    for (const s of (snaps || [])) {
      const key = `${s.book}|${s.market}|${s.outcome}|${s.line ?? ''}`;
      if (!groups.has(key)) {
        groups.set(key, {
          book: s.book, market: s.market, outcome: s.outcome, line: s.line,
          points: [], opening_price: null, closing_price: null, line_drift_pct: null,
        });
      }
      groups.get(key).points.push({ ts: s.ts, price: s.price });
    }

    const commence = ev.commence_time;
    const OPEN_WIN  = 12 * 3600 * 1000;  // first snap >=12h before commence
    const CLOSE_WIN = 15 * 60 * 1000;    // last snap within 15min of commence

    for (const g of groups.values()) {
      const opening = g.points.find(p => commence - p.ts >= OPEN_WIN);
      const closing = [...g.points].reverse().find(p => Math.abs(p.ts - commence) <= CLOSE_WIN && p.ts <= commence + CLOSE_WIN);
      g.opening_price = opening?.price ?? g.points[0]?.price ?? null;
      g.closing_price = closing?.price ?? g.points[g.points.length - 1]?.price ?? null;
      if (g.opening_price && g.closing_price) {
        g.line_drift_pct = +(((g.closing_price - g.opening_price) / g.opening_price) * 100).toFixed(3);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      event: ev,
      trajectory: [...groups.values()],
      n_snapshots: snaps?.length || 0,
    }, null, 2), { status: 200, headers: JSON_HDR });
  } catch (e) {
    console.warn(`${TAG} err: ${e.message}`);
    return new Response(JSON.stringify({ ok: false, error: e.message }),
      { status: 500, headers: JSON_HDR });
  }
}
