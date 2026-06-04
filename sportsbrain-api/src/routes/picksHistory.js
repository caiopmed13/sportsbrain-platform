/**
 * /v1/picks/save     POST — salva pick (single ou combo)
 * /v1/picks/list     GET  — lista picks do usuário
 * /v1/picks/update   POST — atualiza resultado (won/lost/void)
 * /v1/picks/delete   POST — remove pick
 *
 * D1 table: user_picks (id, user_id, payload JSON, status, created_at, updated_at)
 *
 * user_id: deriva de header X-User-Id ou cookie sb_uid (gerado no client).
 * Sem auth real ainda — confia no client. Pra MVP é OK.
 */
import { corsHeaders } from './health.js'

async function ensureTable(db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS user_picks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
  )
}
function getUserId(request) {
  return request.headers.get('X-User-Id') || 'anon'
}

export async function handlePicksSave(request, env) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders() })
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  let body
  try { body = await request.json() } catch { return new Response(JSON.stringify({ ok: false, error: 'BAD_JSON' }), { status: 400, headers: corsHeaders() }) }
  const uid = getUserId(request)
  const id = body.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  try {
    await ensureTable(env.SB_DB)
    await env.SB_DB.prepare(
      `INSERT OR REPLACE INTO user_picks (id, user_id, payload, status, created_at, updated_at) VALUES (?,?,?,?,?,?)`
    ).bind(id, uid, JSON.stringify(body), body.result || null, body.savedAt || now, now).run()
    return new Response(JSON.stringify({ ok: true, id }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), { status: 500, headers: corsHeaders() })
  }
}

export async function handlePicksList(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE', picks: [] }), { status: 503, headers: corsHeaders() })
  const uid = getUserId(request)
  try {
    await ensureTable(env.SB_DB)
    const rows = await env.SB_DB.prepare(
      `SELECT id, payload, status, created_at, updated_at FROM user_picks WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`
    ).bind(uid).all()
    const picks = []
    for (const r of rows?.results || []) {
      let payload = {}
      try { payload = JSON.parse(r.payload) } catch {}
      picks.push({ ...payload, id: r.id, result: r.status, createdAt: r.created_at, updatedAt: r.updated_at })
    }
    return new Response(JSON.stringify({ ok: true, picks }), { status: 200, headers: corsHeaders({ 'Cache-Control': 'no-store' }) })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message, picks: [] }), { status: 500, headers: corsHeaders() })
  }
}

export async function handlePicksUpdate(request, env) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders() })
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  let body
  try { body = await request.json() } catch { return new Response(JSON.stringify({ ok: false, error: 'BAD_JSON' }), { status: 400, headers: corsHeaders() }) }
  const uid = getUserId(request)
  if (!body.id) return new Response(JSON.stringify({ ok: false, error: 'id required' }), { status: 400, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    // Lê payload existente, mescla, regrava
    const row = await env.SB_DB.prepare(`SELECT payload FROM user_picks WHERE id = ? AND user_id = ?`).bind(body.id, uid).first()
    let merged = {}
    if (row) try { merged = JSON.parse(row.payload) } catch {}
    Object.assign(merged, body)
    await env.SB_DB.prepare(
      `UPDATE user_picks SET payload = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).bind(JSON.stringify(merged), body.result || merged.result || null, Date.now(), body.id, uid).run()
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), { status: 500, headers: corsHeaders() })
  }
}

export async function handlePicksDelete(request, env) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders() })
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  let body
  try { body = await request.json() } catch { return new Response(JSON.stringify({ ok: false, error: 'BAD_JSON' }), { status: 400, headers: corsHeaders() }) }
  const uid = getUserId(request)
  try {
    await ensureTable(env.SB_DB)
    if (body.all) {
      await env.SB_DB.prepare(`DELETE FROM user_picks WHERE user_id = ?`).bind(uid).run()
    } else if (body.id) {
      await env.SB_DB.prepare(`DELETE FROM user_picks WHERE id = ? AND user_id = ?`).bind(body.id, uid).run()
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), { status: 500, headers: corsHeaders() })
  }
}
