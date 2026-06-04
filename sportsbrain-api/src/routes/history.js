// ══════════════════════════════════════════════════════════════════════════
// /v1/history/* — long-term queries no Neon (HTTP driver)
// ══════════════════════════════════════════════════════════════════════════
import { neon } from '@neondatabase/serverless';
import { corsHeaders } from './health.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export async function handleHistory(pathname, request, env) {
  if (!env.NEON_URL) return json({ ok: false, error: 'NEON_URL not configured' }, 503);
  const sql = neon(env.NEON_URL);
  const url = new URL(request.url);

  try {
    // GET /v1/history/odds?event_id=&from=&to=&book=&market=
    if (pathname === '/v1/history/odds') {
      const eventId = url.searchParams.get('event_id');
      if (!eventId) return json({ ok: false, error: 'event_id required' }, 400);
      const from = parseInt(url.searchParams.get('from') || '0', 10);
      const to   = parseInt(url.searchParams.get('to')   || String(Date.now()), 10);
      const book = url.searchParams.get('book');
      const mkt  = url.searchParams.get('market');

      let rows;
      if (book && mkt) {
        rows = await sql`SELECT event_id,book,market,outcome,line,price,ts FROM odds_snapshots_lt
                         WHERE event_id=${eventId} AND ts BETWEEN ${from} AND ${to}
                           AND book=${book} AND market=${mkt} ORDER BY ts ASC LIMIT 2000`;
      } else if (mkt) {
        rows = await sql`SELECT event_id,book,market,outcome,line,price,ts FROM odds_snapshots_lt
                         WHERE event_id=${eventId} AND ts BETWEEN ${from} AND ${to}
                           AND market=${mkt} ORDER BY ts ASC LIMIT 2000`;
      } else {
        rows = await sql`SELECT event_id,book,market,outcome,line,price,ts FROM odds_snapshots_lt
                         WHERE event_id=${eventId} AND ts BETWEEN ${from} AND ${to}
                         ORDER BY ts ASC LIMIT 2000`;
      }
      return json({ ok: true, count: rows.length, rows });
    }

    // GET /v1/history/picks?book=&from=&to=&result=
    if (pathname === '/v1/history/picks') {
      const from   = parseInt(url.searchParams.get('from') || '0', 10);
      const to     = parseInt(url.searchParams.get('to')   || String(Date.now()), 10);
      const book   = url.searchParams.get('book');
      const result = url.searchParams.get('result');
      const fromD = new Date(from).toISOString();
      const toD   = new Date(to).toISOString();
      const rows = book && result
        ? await sql`SELECT * FROM picks_closed_lt WHERE created_at BETWEEN ${fromD} AND ${toD} AND book=${book} AND result=${result} ORDER BY created_at DESC LIMIT 500`
        : book
        ? await sql`SELECT * FROM picks_closed_lt WHERE created_at BETWEEN ${fromD} AND ${toD} AND book=${book} ORDER BY created_at DESC LIMIT 500`
        : result
        ? await sql`SELECT * FROM picks_closed_lt WHERE created_at BETWEEN ${fromD} AND ${toD} AND result=${result} ORDER BY created_at DESC LIMIT 500`
        : await sql`SELECT * FROM picks_closed_lt WHERE created_at BETWEEN ${fromD} AND ${toD} ORDER BY created_at DESC LIMIT 500`;
      return json({ ok: true, count: rows.length, rows });
    }

    // GET /v1/history/stats
    if (pathname === '/v1/history/stats') {
      const [snaps, events, picks] = await Promise.all([
        sql`SELECT COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM odds_snapshots_lt`,
        sql`SELECT COUNT(*) AS n FROM odds_events_lt`,
        sql`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE result='win') AS wins FROM picks_closed_lt`,
      ]);
      return json({
        ok: true,
        snapshots: { total: Number(snaps[0].n), first_ts: Number(snaps[0].first_ts || 0), last_ts: Number(snaps[0].last_ts || 0) },
        events:    { total: Number(events[0].n) },
        picks:     { total: Number(picks[0].n), wins: Number(picks[0].wins) },
      });
    }

    return json({ ok: false, error: 'Not found' }, 404);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
