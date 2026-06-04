/**
 * GET /health
 * GET /v1/meta/status
 */
import { sbResponse } from '../schemas/base.js';

export async function handleHealth(request, env, services) {
  const { cache } = services;

  // Check KV connectivity
  let kvOk = false;
  try {
    await cache.set('health:ping', 1, 60);
    kvOk = true;
  } catch {}

  // Check external source availability
  const sources = {
    balldontlie:   env.BALLDONTLIE_API_KEY   ? 'configured' : await pingSource('https://api.balldontlie.io/v1/teams?per_page=1'),
    football_data: env.FOOTBALL_DATA_API_KEY ? 'configured' : 'no_key',
    api_football:  env.API_FOOTBALL_KEY      ? 'configured' : 'no_key',
    odds_engine:   'proprietary (pinnacle+bovada)',
  };

  const payload = sbResponse({
    data: {
      status:  'operational',
      version: env.SB_VERSION || '1.0.0',
      env:     env.SB_ENV || 'production',
      kv:      kvOk ? 'connected' : 'error',
      sources,
      modules: {
        football:     'active',
        basketball:   'active',
        intelligence: 'active',
        odds:         sources.odds_engine ? 'active' : 'degraded',
      },
      timestamp: new Date().toISOString(),
    },
    meta: { endpoint: '/health' },
  });

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: corsHeaders({ 'Cache-Control': 'no-store' }),
  });
}

async function pingSource(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok ? 'ok' : `error_${res.status}`;
  } catch (e) {
    return 'unreachable';
  }
}

export function corsHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-SB-Key, X-Admin-Key, X-Ingest-Secret',
    'X-API-Version': 'v1',
    'X-Powered-By': 'SportsBrain Data API',
    ...extra,
  };
}
