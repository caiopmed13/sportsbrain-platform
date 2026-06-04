/**
 * /internal/ingest-mybets   POST — recebe scrape de Minhas Apostas (saldo + bets)
 * /v1/banca/snapshot        GET  — frontend lê saldo + apostas atuais
 *
 * D1 tables:
 *   bet365_balance_history (id, captured_at, balance, deposited, withdrawn)
 *   bet365_user_bets (id, bet_id UNIQUE, payload JSON, status, placed_at, settled_at, captured_at)
 */
import { corsHeaders } from './health.js'

async function ensureTables(db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS bet365_balance_history (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at INTEGER NOT NULL, balance REAL, deposited REAL, withdrawn REAL)`
  )
  await db.exec(
    `CREATE TABLE IF NOT EXISTS bet365_user_bets (id INTEGER PRIMARY KEY AUTOINCREMENT, bet_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, status TEXT, placed_at INTEGER, settled_at INTEGER, captured_at INTEGER NOT NULL)`
  )
}

export async function handleMyBetsIngest(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
      status: 405, headers: corsHeaders(),
    })
  }
  const secret = request.headers.get('X-Ingest-Secret')
  const expected = env.SB_INGEST_SECRET || env.SB_MASTER_KEY
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401, headers: corsHeaders(),
    })
  }
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    })
  }
  let body
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ ok: false, error: 'BAD_JSON' }), { status: 400, headers: corsHeaders() })
  }

  try {
    await ensureTables(env.SB_DB)
    const ts = body.capturedAt || Date.now()

    // Save balance snapshot
    if (typeof body.balance === 'number') {
      await env.SB_DB.prepare(
        `INSERT INTO bet365_balance_history (captured_at, balance, deposited, withdrawn) VALUES (?,?,?,?)`
      ).bind(ts, body.balance, body.deposited || null, body.withdrawn || null).run()
    }

    // Save bets (UPSERT pra evitar duplicates)
    const allBets = [...(body.pending || []), ...(body.settled || [])]
    let saved = 0
    for (const b of allBets) {
      if (!b.id) continue
      try {
        await env.SB_DB.prepare(
          `INSERT INTO bet365_user_bets (bet_id, payload, status, placed_at, settled_at, captured_at) VALUES (?,?,?,?,?,?) ON CONFLICT(bet_id) DO UPDATE SET payload=excluded.payload, status=excluded.status, settled_at=excluded.settled_at, captured_at=excluded.captured_at`
        ).bind(b.id, JSON.stringify(b), b.status || null, b.placedAt || null, b.settledAt || null, ts).run()
        saved++
      } catch {}
    }

    return new Response(JSON.stringify({
      ok: true, balance: body.balance, betsSaved: saved, capturedAt: ts,
    }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}

// ─── POST /v1/banca/manual-balance — user override do saldo (quando scraper falha) ──
export async function handleBancaManualBalance(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    const body = await request.json()
    const balance = parseFloat(body.balance)
    if (!balance || balance < 0 || balance > 1_000_000) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_balance' }), { status: 400, headers: corsHeaders() })
    }
    await ensureTables(env.SB_DB)
    const now = Date.now()
    await env.SB_DB.prepare(
      `INSERT INTO bet365_balance_history (captured_at, balance, source) VALUES (?, ?, 'manual')`
    ).bind(now, balance).run().catch(async () => {
      // Fallback se source column não existir
      await env.SB_DB.prepare(`INSERT INTO bet365_balance_history (captured_at, balance) VALUES (?, ?)`).bind(now, balance).run()
    })
    return new Response(JSON.stringify({ ok: true, balance, captured_at: now }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// ─── POST /internal/cleanup-zombie-bets — remove bets com IDs incrementais antigos ──
export async function handleCleanupZombieBets(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    const result = await env.SB_DB.prepare(
      `DELETE FROM bet365_user_bets WHERE bet_id LIKE 'dom_%_%'`
    ).run()
    return new Response(JSON.stringify({ ok: true, deleted: result.meta?.changes ?? 0 }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

export async function handleBancaSnapshot(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE', balance: null, bets: [] }), {
      status: 503, headers: corsHeaders(),
    })
  }
  try {
    await ensureTables(env.SB_DB)
    // Saldo mais recente
    const balRow = await env.SB_DB.prepare(
      `SELECT balance, captured_at FROM bet365_balance_history ORDER BY captured_at DESC LIMIT 1`
    ).first()
    // Histórico saldo últimos 30 dias
    const histRows = await env.SB_DB.prepare(
      `SELECT captured_at, balance FROM bet365_balance_history WHERE captured_at > ? ORDER BY captured_at ASC`
    ).bind(Date.now() - 30 * 86400_000).all()
    // Apostas pending e settled recentes
    const betsRows = await env.SB_DB.prepare(
      `SELECT bet_id, payload, status, placed_at, settled_at FROM bet365_user_bets ORDER BY captured_at DESC LIMIT 200`
    ).all()
    const bets = []
    for (const r of betsRows?.results || []) {
      let p = {}
      try { p = JSON.parse(r.payload) } catch {}
      bets.push({ ...p, id: r.bet_id, status: r.status, placedAt: r.placed_at, settledAt: r.settled_at })
    }
    return new Response(JSON.stringify({
      ok: true,
      balance: balRow?.balance ?? null,
      balanceCapturedAt: balRow?.captured_at ?? null,
      balanceHistory: histRows?.results || [],
      bets,
    }), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'public, max-age=60' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
