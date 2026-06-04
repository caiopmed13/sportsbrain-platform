/**
 * SportsBrain API v2 — System Routes
 * ────────────────────────────────────
 *   GET /v2/system/health   → status operacional (público)
 *   GET /v2/system/status   → versão + plano da key atual
 *   GET /v2/system/plans    → tabela de planos e limites
 */

import { v2ok, makeRequestId, resolveV2Plan } from '../../middleware/response.js';

const API_VERSION = '2.0.0';
const BUILD_DATE  = '2026-05-04';

// Limites dos planos v2 (para exibição)
export const V2_PLAN_LIMITS = {
  free:     { requests_per_day: 100,    requests_per_month: 3_000,   endpoints: ['premium_basic'] },
  vip:      { requests_per_day: 167,    requests_per_month: 5_000,   endpoints: ['premium_full', 'greens', 'history'] },
  pro:      { requests_per_day: 3_333,  requests_per_month: 100_000, endpoints: ['*'] },
  internal: { requests_per_day: null,   requests_per_month: null,    endpoints: ['*'], unlimited: true },
  // Backward compat com planos legacy
  starter:  { requests_per_day: 34,     requests_per_month: 1_000,   endpoints: ['premium_basic'] },
  enterprise: { requests_per_day: null, requests_per_month: null,    endpoints: ['*'], unlimited: true },
  sharp:    { requests_per_day: 2_000,  requests_per_month: 60_000,  endpoints: ['*', 'realtime_ws'] },
};

// ── GET /v2/system/health ─────────────────────────────────────────────────
export async function handleV2Health(request, env) {
  const reqId = makeRequestId();
  const start = Date.now();

  let dbOk = false;
  let dbLatency = null;
  if (env.SB_DB) {
    const t0 = Date.now();
    try {
      await env.SB_DB.prepare('SELECT 1').first();
      dbOk = true;
      dbLatency = Date.now() - t0;
    } catch {}
  }

  return v2ok({
    status:     dbOk ? 'operational' : 'degraded',
    version:    API_VERSION,
    build_date: BUILD_DATE,
    services: {
      api:       'ok',
      database:  dbOk ? 'ok' : 'error',
      cache:     'ok',
    },
    latency: {
      db_ms: dbLatency,
    },
    timestamp: new Date().toISOString(),
  }, { reqId, start, plan: 'public', cache: 'bypass' });
}

// ── GET /v2/system/status ─────────────────────────────────────────────────
export async function handleV2Status(request, env) {
  const reqId = makeRequestId();
  const start = Date.now();

  const auth = await resolveV2Plan(request, env);
  const plan = auth.plan || 'free';
  const limits = V2_PLAN_LIMITS[plan] || V2_PLAN_LIMITS['free'];

  return v2ok({
    api:         'SportsBrain Data API',
    api_version: API_VERSION,
    build_date:  BUILD_DATE,
    status:      'operational',
    your_plan: {
      name:               plan,
      requests_per_day:   limits.requests_per_day,
      requests_per_month: limits.requests_per_month,
      endpoints:          limits.endpoints,
      unlimited:          limits.unlimited || false,
      debug_mode:         plan === 'internal',
    },
    endpoints: {
      premium: '/v2/picks/premium',
      health:  '/v2/system/health',
      status:  '/v2/system/status',
      plans:   '/v2/system/plans',
      legacy:  '/v1/picks/premium',
    },
    docs_url: 'https://docs.sportsbrain.app/v2',
  }, { reqId, start, plan, cache: 'bypass' });
}

// ── GET /v2/system/plans ─────────────────────────────────────────────────
export async function handleV2Plans(request, env) {
  const reqId = makeRequestId();
  const start = Date.now();

  return v2ok({
    plans: [
      {
        name:               'free',
        label:              'Free',
        requests_per_day:   100,
        requests_per_month: 3_000,
        endpoints:          ['GET /v2/picks/premium (limited)'],
        debug_mode:         false,
        price:              'gratuito',
      },
      {
        name:               'vip',
        label:              'VIP',
        requests_per_day:   167,
        requests_per_month: 5_000,
        endpoints:          ['GET /v2/picks/premium', 'GET /v1/picks/greens', 'GET /v1/picks/history'],
        debug_mode:         false,
        price:              'consulte comercial',
      },
      {
        name:               'pro',
        label:              'Pro',
        requests_per_day:   3_333,
        requests_per_month: 100_000,
        endpoints:          ['*'],
        debug_mode:         false,
        price:              'consulte comercial',
      },
      {
        name:               'internal',
        label:              'Internal',
        requests_per_day:   null,
        requests_per_month: null,
        endpoints:          ['*'],
        debug_mode:         true,
        unlimited:          true,
        price:              'uso interno',
      },
    ],
    how_to_authenticate: {
      header:      'X-SB-Key: <sua_api_key>',
      query_param: '?key=<sua_api_key>',
      master_key:  'X-Admin-Key: <master_key> → acesso internal',
    },
  }, { reqId, start, plan: 'public', cache: 'bypass' });
}
