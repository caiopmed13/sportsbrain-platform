// ══════════════════════════════════════════════════════════════════════════
// /admin/lt/backfill — copia D1 → Neon desde um ts inicial
// ══════════════════════════════════════════════════════════════════════════
// Free-tier Workers = 50 subrequests/invocation. Usa chunks GRANDES (5000)
// pra caber em ~40 queries por call. Cliente chama de novo com ?offset= até
// `more:false`.
// ══════════════════════════════════════════════════════════════════════════
import { neon } from '@neondatabase/serverless';
import { corsHeaders } from './health.js';

function json(d, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}

function sqlEscape(v) {
  if (v == null) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function handleBackfillLT(request, env) {
  const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key');
  if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!env.NEON_URL) return json({ ok: false, error: 'NEON_URL not set' }, 503);
  if (!env.SB_DB)   return json({ ok: false, error: 'D1 not bound' }, 503);

  const url = new URL(request.url);
  const now = new Date();
  const defaultFrom = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const fromTs = parseInt(url.searchParams.get('from') || String(defaultFrom), 10);
  const toTs   = parseInt(url.searchParams.get('to')   || String(Date.now()), 10);
  const limit  = parseInt(url.searchParams.get('limit') || '40000', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const skipEvents = url.searchParams.get('skip_events') === '1';

  const sql = neon(env.NEON_URL);
  const report = { from: fromTs, to: toTs, events: 0, snapshots: 0, errors: [] };

  try {
    // 1. Eventos — BULK insert (1 subrequest só)
    if (!skipEvents && offset === 0) {
      const evRows = await env.SB_DB.prepare(`
        SELECT id, sport, league, league_slug, home, away, commence_time
        FROM odds_events
        WHERE commence_time >= ?
        ORDER BY commence_time ASC
        LIMIT 2000
      `).bind(fromTs - 7 * 24 * 3600e3).all();

      const events = evRows.results || [];
      if (events.length) {
        try {
          const values = events.map(e =>
            `(${sqlEscape(e.id)},${sqlEscape(e.sport)},${sqlEscape(e.league)},${sqlEscape(e.league_slug)},${sqlEscape(e.home)},${sqlEscape(e.away)},${e.commence_time})`
          ).join(',');
          await sql.query(`
            INSERT INTO odds_events_lt (id, sport, league, league_slug, home, away, commence_time)
            VALUES ${values}
            ON CONFLICT (id) DO UPDATE SET
              league=COALESCE(EXCLUDED.league, odds_events_lt.league),
              league_slug=COALESCE(EXCLUDED.league_slug, odds_events_lt.league_slug),
              commence_time=EXCLUDED.commence_time,
              updated_at=NOW()
          `);
          report.events = events.length;
        } catch (err) {
          report.errors.push(`events bulk: ${err.message.slice(0, 200)}`);
        }
      }
    }

    // 2. Snapshots — chunks de 5000 (cada chunk = 1 subrequest)
    const snapRows = await env.SB_DB.prepare(`
      SELECT event_id, book, market, outcome, line, price, ts
      FROM odds_snapshots
      WHERE ts BETWEEN ? AND ?
      ORDER BY ts ASC
      LIMIT ? OFFSET ?
    `).bind(fromTs, toTs, limit, offset).all();

    const snapshots = snapRows.results || [];
    const CHUNK = 5000;

    for (let i = 0; i < snapshots.length; i += CHUNK) {
      const chunk = snapshots.slice(i, i + CHUNK);
      try {
        const values = chunk.map(s =>
          `(${sqlEscape(s.event_id)},${sqlEscape(s.book)},${sqlEscape(s.market)},${sqlEscape(s.outcome)},${s.line ?? 'NULL'},${s.price},${s.ts})`
        ).join(',');
        await sql.query(`INSERT INTO odds_snapshots_lt (event_id,book,market,outcome,line,price,ts) VALUES ${values}`);
        report.snapshots += chunk.length;
      } catch (err) {
        report.errors.push(`chunk ${i}: ${err.message.slice(0, 200)}`);
      }
    }

    report.more = snapshots.length === limit;
    report.next_offset = offset + snapshots.length;
    return json({ ok: true, ...report });
  } catch (e) {
    return json({ ok: false, error: e.message, ...report }, 500);
  }
}
