/**
 * Admin Route — SportsBrain Data API v1
 * ─────────────────────────────────────
 * Gerenciamento de API keys para tiers comerciais.
 * Autenticado via header X-Admin-Key = env.SB_MASTER_KEY.
 *
 *   POST   /v1/admin/keys               → cria key {plan, owner_email, rate_limit_hour?}
 *   GET    /v1/admin/keys               → lista todas as keys
 *   DELETE /v1/admin/keys/:hash         → revoga (active = 0)
 *   GET    /v1/admin/usage/:hash        → estatísticas de uso da key (últimas 24h)
 *
 * Em produção: expor apenas pela área administrativa (não pelo frontend público).
 */

import { sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';

// Hash leve (mesmo algoritmo do index.js)
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Gera API key pseudo-aleatória no formato sb_<plan>_<24chars>
function generateKey(plan = 'free') {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  for (const b of bytes) rand += abc[b % abc.length];
  return `sb_${plan}_${rand}`;
}

const PLAN_LIMITS = {
  free:       100,       // req/hora (≈ 100/dia no uso real)
  starter:    1000,
  vip:        208,       // req/hora → ≈ 5.000/mês
  pro:        4167,      // req/hora → ≈ 100.000/mês
  business:   50000,
  enterprise: 999999,
  internal:   999999,   // sem limite — uso interno SportsBrain
  sharp:      2500,
};

export async function handleAdmin(pathname, request, env) {
  // Auth: exige X-Admin-Key igual ao SB_MASTER_KEY
  const provided = request.headers.get('X-Admin-Key');
  if (!env.SB_MASTER_KEY || !provided || provided !== env.SB_MASTER_KEY) {
    return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
      { status: 403, headers: corsHeaders() });
  }

  if (!env.SB_DB) {
    return new Response(JSON.stringify(sbError('DB_UNAVAILABLE', 'D1 not bound', 503)),
      { status: 503, headers: corsHeaders() });
  }

  const method = request.method;

  // ── POST /v1/admin/keys (criar key) ───────────────────────────────────
  if (pathname === '/v1/admin/keys' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const plan = (body.plan || 'free').toLowerCase();
    if (!PLAN_LIMITS[plan]) {
      return new Response(JSON.stringify(sbError('BAD_PLAN', `Invalid plan. Use: ${Object.keys(PLAN_LIMITS).join(', ')}`, 400)),
        { status: 400, headers: corsHeaders() });
    }

    const apiKey = generateKey(plan);
    const hash   = simpleHash(apiKey);
    const rateLimit = body.rate_limit_hour || PLAN_LIMITS[plan];
    const ownerEmail = body.owner_email || null;
    const modules = JSON.stringify(body.modules || ['football', 'basketball']);
    const expiresAt = body.expires_at || null;

    await env.SB_DB.prepare(`
      INSERT INTO api_keys (key_hash, plan, owner_email, rate_limit, modules, active, expires_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).bind(hash, plan, ownerEmail, rateLimit, modules, expiresAt).run();

    return new Response(JSON.stringify({
      ok: true,
      api_key: apiKey,
      key_hash: hash,
      plan,
      rate_limit_hour: rateLimit,
      owner_email: ownerEmail,
      expires_at: expiresAt,
      warning: 'Guarde esta chave agora — ela não será mostrada novamente.',
    }), { status: 201, headers: corsHeaders() });
  }

  // ── GET /v1/admin/keys (listar) ───────────────────────────────────────
  if (pathname === '/v1/admin/keys' && method === 'GET') {
    const { results } = await env.SB_DB.prepare(`
      SELECT id, key_hash, plan, owner_email, rate_limit, active, created_at, expires_at
      FROM api_keys ORDER BY created_at DESC LIMIT 500
    `).all();
    return new Response(JSON.stringify({ ok: true, keys: results || [], count: (results || []).length }),
      { status: 200, headers: corsHeaders() });
  }

  // ── DELETE /v1/admin/keys/:hash (revoga) ──────────────────────────────
  const delMatch = pathname.match(/^\/v1\/admin\/keys\/([^/]+)$/);
  if (delMatch && method === 'DELETE') {
    const hash = delMatch[1];
    await env.SB_DB.prepare(`UPDATE api_keys SET active = 0 WHERE key_hash = ?`).bind(hash).run();
    return new Response(JSON.stringify({ ok: true, revoked: hash }),
      { status: 200, headers: corsHeaders() });
  }

  // ── GET /v1/admin/usage/:hash (stats de uso) ──────────────────────────
  const usageMatch = pathname.match(/^\/v1\/admin\/usage\/([^/]+)$/);
  if (usageMatch && method === 'GET') {
    const hash = usageMatch[1];
    const { results } = await env.SB_DB.prepare(`
      SELECT endpoint, status_code, COUNT(*) as count, AVG(response_time_ms) as avg_ms
      FROM api_usage_log
      WHERE api_key_hash = ? AND recorded_at >= datetime('now', '-24 hours')
      GROUP BY endpoint, status_code
      ORDER BY count DESC LIMIT 100
    `).bind(hash).all();
    const totalRow = await env.SB_DB.prepare(`
      SELECT COUNT(*) as total FROM api_usage_log
      WHERE api_key_hash = ? AND recorded_at >= datetime('now', '-1 hour')
    `).bind(hash).first();
    return new Response(JSON.stringify({
      ok: true,
      key_hash: hash,
      last_hour_requests: totalRow?.total || 0,
      last_24h_breakdown: results || [],
    }), { status: 200, headers: corsHeaders() });
  }

  return new Response(JSON.stringify(sbError('NOT_FOUND', 'Unknown admin endpoint', 404)),
    { status: 404, headers: corsHeaders() });
}

// ═══════════════════════════════════════════════════════════════════════════
// Rate-limit check — usado pelo index.js antes de servir requests autenticados
// Conta requests do último 1h no api_usage_log e compara com rate_limit do plano.
// ═══════════════════════════════════════════════════════════════════════════
export async function checkRateLimit(env, keyHash, rateLimitHour) {
  if (!env.SB_DB || !keyHash || !rateLimitHour) return { allowed: true, used: 0 };
  try {
    const row = await env.SB_DB.prepare(`
      SELECT COUNT(*) as cnt FROM api_usage_log
      WHERE api_key_hash = ? AND recorded_at >= datetime('now', '-1 hour')
    `).bind(keyHash).first();
    const used = row?.cnt || 0;
    return {
      allowed: used < rateLimitHour,
      used,
      limit: rateLimitHour,
      remaining: Math.max(0, rateLimitHour - used),
    };
  } catch (e) {
    // Em caso de falha do D1 nunca bloqueia (fail-open)
    return { allowed: true, used: 0, error: e.message };
  }
}
