// ══════════════════════════════════════════════════════════════════════════
// D1 storage: event upsert, snapshot writes, consensus reads
// ══════════════════════════════════════════════════════════════════════════
import { eventId, normTeam } from './normalize.js';
import { ltInsertSnapshots, ltUpsertEvent } from '../storage/longterm.js';

// Upsert de evento — retorna event_id
export async function upsertEvent(env, { sport, league, league_slug, home, away, commence_time, status }) {
  if (!env.SB_DB) return null;
  const id = eventId(home, away, commence_time);
  const home_canon = normTeam(home);
  const away_canon = normTeam(away);
  await env.SB_DB.prepare(`
    INSERT INTO odds_events (id, sport, league, league_slug, home, away, home_canon, away_canon, commence_time, status, first_seen, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      league        = COALESCE(excluded.league, league),
      league_slug   = COALESCE(excluded.league_slug, league_slug),
      status        = COALESCE(excluded.status, status),
      updated_at    = excluded.updated_at
  `).bind(
    id, sport, league || null, league_slug || null,
    home, away, home_canon, away_canon,
    commence_time, status || 'scheduled',
    Date.now(), Date.now()
  ).run().catch(e => console.warn('[odds:upsertEvent]', e.message));
  // Long-term mirror (Neon) — aguarda, caso contrário Worker cancela a promise
  await ltUpsertEvent(env, { id, sport, league, league_slug, home, away, commence_time }).catch(() => {});
  return id;
}

// Batch insert de snapshots
export async function insertSnapshots(env, rows) {
  if (!env.SB_DB || !rows?.length) return 0;
  // D1 suporta batch via prepare+bind em loop; mais rápido via stmt.batch()
  const stmt = env.SB_DB.prepare(`
    INSERT INTO odds_snapshots (event_id, book, market, outcome, line, price, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const batch = rows
    .filter(r => r.event_id && r.book && r.market && r.outcome && isFinite(r.price) && r.price > 1)
    .map(r => stmt.bind(r.event_id, r.book, r.market, r.outcome, r.line ?? null, r.price, r.ts || Date.now()));
  if (!batch.length) return 0;
  try {
    await env.SB_DB.batch(batch);
    // Long-term mirror pro Neon (await garante persistência em Workers)
    await ltInsertSnapshots(env, rows).catch(() => {});
    return batch.length;
  } catch (e) {
    console.warn('[odds:insertSnapshots]', e.message);
    return 0;
  }
}

// Última cotação de cada book pra um evento+mercado
export async function getLatestOdds(env, { event_id, market = null, maxAge = 30 * 60 * 1000 }) {
  if (!env.SB_DB) return [];
  const cutoff = Date.now() - maxAge;
  let sql = `
    SELECT s.event_id, s.book, s.market, s.outcome, s.line, s.price, s.ts
    FROM odds_snapshots s
    INNER JOIN (
      SELECT event_id, book, market, outcome, line, MAX(ts) AS max_ts
      FROM odds_snapshots
      WHERE event_id = ? AND ts >= ?
      ${market ? 'AND market = ?' : ''}
      GROUP BY event_id, book, market, outcome, line
    ) latest
    ON s.event_id = latest.event_id AND s.book = latest.book
       AND s.market = latest.market AND s.outcome = latest.outcome
       AND COALESCE(s.line, -999) = COALESCE(latest.line, -999)
       AND s.ts = latest.max_ts
  `;
  const args = [event_id, cutoff];
  if (market) args.push(market);
  const { results } = await env.SB_DB.prepare(sql).bind(...args).all();
  return results || [];
}

// Movimento de uma odd ao longo do tempo (pra gráfico CLV)
export async function getMovement(env, { event_id, market, outcome, line = null, hours = 24 }) {
  if (!env.SB_DB) return [];
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const sql = `
    SELECT book, price, ts
    FROM odds_snapshots
    WHERE event_id = ? AND market = ? AND outcome = ?
      ${line != null ? 'AND line = ?' : ''}
      AND ts >= ?
    ORDER BY ts ASC
    LIMIT 500
  `;
  const args = [event_id, market, outcome];
  if (line != null) args.push(line);
  args.push(cutoff);
  const { results } = await env.SB_DB.prepare(sql).bind(...args).all();
  return results || [];
}

// Lista de eventos agendados futuros
export async function listUpcomingEvents(env, { sport = null, hours = 72 } = {}) {
  if (!env.SB_DB) return [];
  const now = Date.now();
  const max = now + hours * 60 * 60 * 1000;
  let sql = `
    SELECT id, sport, league, league_slug, home, away, commence_time, status
    FROM odds_events
    WHERE commence_time >= ? AND commence_time <= ? AND status != 'ft'
  `;
  const args = [now - 3 * 60 * 60 * 1000, max];  // 3h grace pra ao vivo
  if (sport) { sql += ' AND sport = ?'; args.push(sport); }
  sql += ' ORDER BY commence_time ASC LIMIT 500';
  const { results } = await env.SB_DB.prepare(sql).bind(...args).all();
  return results || [];
}

// Atualiza success/failure de um book (health tracking)
export async function markBookStatus(env, bookKey, ok, errMsg = null) {
  if (!env.SB_DB) return;
  if (ok) {
    await env.SB_DB.prepare(`UPDATE odds_books SET last_ok = ? WHERE key = ?`)
      .bind(Date.now(), bookKey).run().catch(() => {});
  } else {
    await env.SB_DB.prepare(`UPDATE odds_books SET last_err = ? WHERE key = ?`)
      .bind((errMsg || 'error').slice(0, 200), bookKey).run().catch(() => {});
  }
}

// Lookup de evento por times + data (fuzzy home/away match)
export async function findEventByTeams(env, home, away, commenceMs) {
  if (!env.SB_DB) return null;
  const hc = normTeam(home);
  const ac = normTeam(away);
  const date = new Date(commenceMs || Date.now()).toISOString().slice(0, 10);
  const { results } = await env.SB_DB.prepare(`
    SELECT * FROM odds_events
    WHERE DATE(datetime(commence_time/1000, 'unixepoch')) = ?
      AND ((home_canon = ? AND away_canon = ?) OR (home_canon = ? AND away_canon = ?))
    LIMIT 1
  `).bind(date, hc, ac, ac, hc).all();
  return results?.[0] || null;
}
