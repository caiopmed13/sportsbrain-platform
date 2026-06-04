/**
 * SportsBrain API v2 — Standard Response Middleware
 * ─────────────────────────────────────────────────
 * Gera o envelope padrão de respostas v2:
 *
 *   { ok, data, meta: { version, generated_at, request_id, cache, duration_ms, plan }, error }
 *
 * Usage:
 *   import { v2ok, v2err, makeRequestId } from '../middleware/response.js'
 *
 *   const reqId = makeRequestId()
 *   const start = Date.now()
 *   // ... lógica ...
 *   return v2ok(data, { reqId, start, plan: 'vip', cache: 'hit' })
 */

import { corsHeaders } from '../routes/health.js';

const API_VERSION = 'v2';

// ── Gerador de request_id ─────────────────────────────────────────────────
export function makeRequestId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let id = 'sb_';
  for (const b of bytes) id += chars[b % chars.length];
  return id;
}

// ── Resposta de sucesso ───────────────────────────────────────────────────
/**
 * @param {any}    data        Payload principal
 * @param {object} opts
 * @param {string} opts.reqId  Request ID gerado por makeRequestId()
 * @param {number} opts.start  Date.now() do início do request
 * @param {string} opts.plan   Plano da API key ('free'|'vip'|'pro'|'internal')
 * @param {string} opts.cache  Status do cache ('hit'|'miss'|'bypass')
 * @param {object} opts.extra  Campos extras opcionais no meta
 * @param {number} opts.status HTTP status (default: 200)
 */
export function v2ok(data, { reqId, start = Date.now(), plan = 'free', cache = 'miss', extra = {}, status = 200 } = {}) {
  const now = new Date().toISOString();
  const body = {
    ok: true,
    data,
    meta: {
      version:      API_VERSION,
      generated_at: now,
      request_id:   reqId || makeRequestId(),
      cache,
      duration_ms:  Date.now() - (start || Date.now()),
      plan,
      ...extra,
    },
    error: null,
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      'X-Request-ID':  body.meta.request_id,
      'X-API-Version': API_VERSION,
      'X-Cache':       cache,
    },
  });
}

// ── Resposta de erro ──────────────────────────────────────────────────────
/**
 * @param {string} code     Código do erro em UPPER_SNAKE ('RATE_LIMIT_EXCEEDED')
 * @param {string} message  Mensagem legível
 * @param {number} status   HTTP status (default: 400)
 * @param {object} opts     { reqId, start, plan }
 */
export function v2err(code, message, status = 400, { reqId, start, plan = 'free' } = {}) {
  const now = new Date().toISOString();
  const body = {
    ok: false,
    data: null,
    meta: {
      version:      API_VERSION,
      generated_at: now,
      request_id:   reqId || makeRequestId(),
      cache:        'bypass',
      duration_ms:  start ? Date.now() - start : 0,
      plan,
    },
    error: {
      code,
      message,
      docs_url: `https://docs.sportsbrain.app/errors#${code.toLowerCase()}`,
    },
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      'X-Request-ID':  body.meta.request_id,
      'X-API-Version': API_VERSION,
    },
  });
}

// ── Auth helper: extrai API key do header ou query param ─────────────────
export function extractApiKey(request) {
  return request.headers.get('X-SB-Key')
    || request.headers.get('Authorization')?.replace(/^Bearer\s+/, '')
    || new URL(request.url).searchParams.get('key')
    || null;
}

// ── Resolve plano da key v2 (consulta D1) ────────────────────────────────
export async function resolveV2Plan(request, env) {
  // SB_MASTER_KEY = interno, sem limite
  const masterKey = request.headers.get('X-Admin-Key') || request.headers.get('X-Master-Key');
  if (env.SB_MASTER_KEY && masterKey === env.SB_MASTER_KEY) {
    return { ok: true, plan: 'internal', keyHash: 'internal', unlimited: true };
  }

  const apiKey = extractApiKey(request);
  if (!apiKey) {
    // Sem key → free (sem autenticação obrigatória para v2 public-tier)
    return { ok: true, plan: 'free', keyHash: null, unlimited: false };
  }

  if (!env.SB_DB) {
    return { ok: false, plan: null, error: 'DB_UNAVAILABLE' };
  }

  // Hash leve (igual ao simpleHash do index.js)
  let hash = 0;
  for (let i = 0; i < apiKey.length; i++) {
    hash = ((hash << 5) - hash) + apiKey.charCodeAt(i);
    hash |= 0;
  }
  const keyHash = Math.abs(hash).toString(36);

  try {
    const row = await env.SB_DB.prepare(
      `SELECT plan, rate_limit, active FROM api_keys
       WHERE key_hash = ? AND active = 1
       AND (expires_at IS NULL OR expires_at > datetime('now'))`
    ).bind(keyHash).first();

    if (!row) return { ok: false, plan: null, error: 'INVALID_KEY', keyHash };

    const plan = row.plan || 'free';
    return {
      ok: true,
      plan,
      keyHash,
      rateLimit: row.rate_limit,
      unlimited: plan === 'internal',
    };
  } catch (e) {
    // D1 falhou → não bloqueia (fail-open)
    return { ok: true, plan: 'free', keyHash: null, unlimited: false, dbError: e.message };
  }
}

// ── Planos que têm acesso ao endpoint premium v2 ─────────────────────────
export const V2_PREMIUM_PLANS = new Set(['vip', 'pro', 'internal', 'sharp', 'enterprise']);

// ── Planos com acesso a debug detalhado ──────────────────────────────────
export const V2_DEBUG_PLANS = new Set(['internal']);
