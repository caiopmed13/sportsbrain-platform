// ══════════════════════════════════════════════════════════════════════════
// Long-term storage adapter — Neon HTTP driver (bypassa Hyperdrive/TCP)
// ══════════════════════════════════════════════════════════════════════════
// D1 = cache quente (30d). Neon = histórico 2 anos, particionado por mês.
// Usa @neondatabase/serverless (HTTP fetch pra /sql endpoint da Neon) —
// mais simples que TCP+Hyperdrive e funciona 100% em Workers.
//
// Fire-and-forget: falhas não bloqueiam D1. Auth via env.NEON_URL (secret).
// ══════════════════════════════════════════════════════════════════════════
import { neon } from '@neondatabase/serverless';

let _sql = null;
function getSql(env) {
  if (_sql) return _sql;
  if (!env.NEON_URL) return null;
  _sql = neon(env.NEON_URL);
  return _sql;
}

// Escrita best-effort de snapshots.
export async function ltInsertSnapshots(env, snapshots) {
  const sql = getSql(env);
  if (!sql) { console.warn('[lt:snapshots] no NEON_URL'); return 0; }
  if (!snapshots?.length) { console.log('[lt:snapshots] empty input'); return 0; }
  console.log(`[lt:snapshots] attempting ${snapshots.length} rows`);
  try {
    let inserted = 0;
    for (let i = 0; i < snapshots.length; i += 200) {
      const chunk = snapshots.slice(i, i + 200);
      const values = chunk.map(s =>
        `('${String(s.event_id).replace(/'/g,"''")}','${s.book}','${s.market}','${s.outcome}',${s.line ?? 'NULL'},${s.price},${s.ts})`
      ).join(',');
      await sql.query(`INSERT INTO odds_snapshots_lt (event_id,book,market,outcome,line,price,ts) VALUES ${values}`);
      inserted += chunk.length;
    }
    console.log(`[lt:snapshots] OK ${inserted}`);
    return inserted;
  } catch (e) {
    console.error('[lt:snapshots] FAIL:', e.message, e.stack?.slice(0, 200));
    return 0;
  }
}

// Upsert event
export async function ltUpsertEvent(env, event) {
  const sql = getSql(env);
  if (!sql || !event?.id) return false;
  try {
    await sql.query(
      `INSERT INTO odds_events_lt (id, sport, league, league_slug, home, away, commence_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         league=COALESCE(EXCLUDED.league, odds_events_lt.league),
         league_slug=COALESCE(EXCLUDED.league_slug, odds_events_lt.league_slug),
         commence_time=EXCLUDED.commence_time,
         updated_at=NOW()`,
      [event.id, event.sport, event.league ?? null, event.league_slug ?? null,
       event.home, event.away, event.commence_time]
    );
    return true;
  } catch (e) {
    console.warn('[lt:event]', e.message);
    return false;
  }
}

export async function ltUpsertEvents(env, events) {
  if (!events?.length) return 0;
  let ok = 0;
  for (const ev of events) if (await ltUpsertEvent(env, ev)) ok++;
  return ok;
}

// Persiste pick fechado
export async function ltSavePick(env, pick) {
  const sql = getSql(env);
  if (!sql || !pick?.event_id) return false;
  try {
    await sql.query(
      `INSERT INTO picks_closed_lt (
        event_id, sport, league_slug, book, market, outcome, line,
        price_open, price_close, fair_price, edge_pct, confidence,
        kelly_stake, clv_pct, result, pnl_units, settled_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [pick.event_id, pick.sport ?? null, pick.league_slug ?? null,
       pick.book ?? null, pick.market ?? null, pick.outcome ?? null, pick.line ?? null,
       pick.price_open ?? null, pick.price_close ?? null, pick.fair_price ?? null,
       pick.edge_pct ?? null, pick.confidence ?? null, pick.kelly_stake ?? null,
       pick.clv_pct ?? null, pick.result ?? 'pending', pick.pnl_units ?? null,
       pick.settled_at ? new Date(pick.settled_at).toISOString() : null]
    );
    return true;
  } catch (e) {
    console.warn('[lt:pick]', e.message);
    return false;
  }
}

// Query ad-hoc (cuidado: só pra rotas admin/history)
export async function ltQuery(env, queryStr, params = []) {
  const sql = getSql(env);
  if (!sql) return null;
  try { return await sql.query(queryStr, params); }
  catch (e) { console.warn('[lt:query]', e.message); return null; }
}

// Cria partição do próximo mês
export async function ltEnsureNextMonthPartition(env) {
  const sql = getSql(env);
  if (!sql) return false;
  try {
    const next = new Date();
    next.setMonth(next.getMonth() + 2);
    await sql.query(`SELECT ensure_month_partition($1, $2)`, [next.getFullYear(), next.getMonth() + 1]);
    return true;
  } catch (e) {
    console.warn('[lt:partition]', e.message);
    return false;
  }
}

// Health check
export async function ltPing(env) {
  const sql = getSql(env);
  if (!sql) return { ok: false, reason: 'no_NEON_URL_secret' };
  try {
    const r = await sql`SELECT NOW() as now, (SELECT COUNT(*) FROM odds_snapshots_lt) as n`;
    return { ok: true, now: r[0].now, snapshots_total: Number(r[0].n) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
