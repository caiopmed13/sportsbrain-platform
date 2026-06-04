// ══════════════════════════════════════════════════════════════════════════
// Premium Split Cache — Cache API helper para /v1/picks/premium/{tier1,combos}
// ══════════════════════════════════════════════════════════════════════════
//
// Espelha as regras do premiumCache.js (R6J-B3) com:
//   - paths novos: /v1/picks/premium/tier1, /v1/picks/premium/combos
//   - mesmos gates de safety (lab_mode=true, ok=true, sem can_beta/can_sell/
//     micro_test_active no top-level, sem `error` truthy)
//   - mesmo TTL: 60s
//   - mesmas regras de bypass (debug=1, nocache=1, admin headers, etc.)
//   - mesma falha silenciosa em erro do Cache API
//
// Difere do legacy apenas em quais query params são RELEVANTES para a chave:
//   tier1:  sport, days, date, league, mode, bet365_only
//   combos: section, page, page_size, sport, days, date, league, mode, bet365_only
//
// Cada endpoint tem seu próprio cache namespace via path da chave.
// ══════════════════════════════════════════════════════════════════════════

import { PREMIUM_CACHE_TTL_SECONDS, PREMIUM_CACHE_KEY_PREFIX } from './premiumCache.js';

export const PREMIUM_SPLIT_CACHE_TTL_SECONDS = PREMIUM_CACHE_TTL_SECONDS;
export const PREMIUM_TIER1_CACHE_PATH = '/v1/picks/premium/tier1';
export const PREMIUM_COMBOS_CACHE_PATH = '/v1/picks/premium/combos';

export const TIER1_CACHE_RELEVANT_PARAMS = Object.freeze([
  'sport',
  'days',
  'date',
  'league',
  'mode',
  'bet365_only',
]);

export const COMBOS_CACHE_RELEVANT_PARAMS = Object.freeze([
  'section',
  'page',
  'page_size',
  'sport',
  'days',
  'date',
  'league',
  'mode',
  'bet365_only',
]);

const _CACHE_CONFIGS = {
  [PREMIUM_TIER1_CACHE_PATH]: TIER1_CACHE_RELEVANT_PARAMS,
  [PREMIUM_COMBOS_CACHE_PATH]: COMBOS_CACHE_RELEVANT_PARAMS,
};

/**
 * Decide se uma request para um endpoint split é elegível para cache.
 * Espelha isPremiumCacheEligible do R6J-B3 com path checks ampliados.
 *
 * @param {Request} request
 * @returns {boolean}
 */
export function isSplitCacheEligible(request) {
  if (!request) return false;
  if (request.method !== 'GET') return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (!(url.pathname in _CACHE_CONFIGS)) return false;

  for (const [k, v] of url.searchParams.entries()) {
    const lk = k.toLowerCase();
    if (lk === 'debug' && v === '1') return false;
    if (lk === 'nocache' && v === '1') return false;
    if (lk.startsWith('admin')) return false;
    if (lk.startsWith('debug_')) return false;
  }

  const adminKey = request.headers.get('X-Admin-Key') || '';
  if (adminKey.trim()) return false;
  const authHdr = request.headers.get('Authorization') || '';
  if (authHdr.trim()) return false;

  return true;
}

/**
 * Constrói chave de cache canônica para os endpoints split. Normaliza
 * params como em premiumCache.js — lowercase, ordenado, só relevant params.
 *
 * @param {Request} request
 * @returns {string|null} URL pseudo-publica ou null se path não suportado
 */
export function buildSplitCacheKey(request) {
  const url = new URL(request.url);
  const relevantList = _CACHE_CONFIGS[url.pathname];
  if (!relevantList) return null;
  const relevant = new Set(relevantList);
  const pairs = [];
  for (const [k, v] of url.searchParams.entries()) {
    const lk = k.toLowerCase().trim();
    if (!relevant.has(lk)) continue;
    const lv = String(v || '').trim().toLowerCase();
    if (lv === '') continue;
    pairs.push([lk, lv]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `${PREMIUM_CACHE_KEY_PREFIX}${url.pathname}${qs ? '?' + qs : ''}`;
}

/**
 * Idêntico em política a isPremiumResponseCacheable: só grava response
 * lab-safe. Não cacheia 5xx, erro, can_beta, can_sell, micro_test_active.
 *
 * @param {Response} response
 * @param {object|null} parsedBody
 * @returns {boolean}
 */
export function isSplitResponseCacheable(response, parsedBody) {
  if (!response) return false;
  if (response.status !== 200) return false;
  if (!parsedBody || typeof parsedBody !== 'object') return false;
  if (parsedBody.ok !== true) return false;
  if (parsedBody.lab_mode !== true) return false;
  if ('can_beta' in parsedBody) return false;
  if ('can_sell' in parsedBody) return false;
  if ('micro_test_active' in parsedBody) return false;
  if ('error' in parsedBody && parsedBody.error) return false;
  return true;
}

/**
 * Tenta servir HIT do cache para um endpoint split. Retorna Response clone
 * com X-SB-Premium-Cache=HIT ou null em miss/bypass/erro.
 *
 * @param {Request} request
 * @param {object} opts
 * @param {Cache} [opts.cacheImpl]
 * @returns {Promise<Response|null>}
 */
export async function getSplitCachedResponse(request, opts = {}) {
  if (!isSplitCacheEligible(request)) return null;
  const cacheImpl = opts.cacheImpl ?? (typeof caches !== 'undefined' ? caches.default : null);
  if (!cacheImpl || typeof cacheImpl.match !== 'function') return null;
  try {
    const key = buildSplitCacheKey(request);
    if (!key) return null;
    const hit = await cacheImpl.match(key);
    if (!hit) return null;
    const headers = new Headers(hit.headers);
    headers.set('X-SB-Premium-Cache', 'HIT');
    headers.set('X-SB-Premium-Cache-TTL', String(PREMIUM_SPLIT_CACHE_TTL_SECONDS));
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  } catch {
    return null;
  }
}

/**
 * Tenta gravar response no cache se passar nos gates. Silencioso em erro.
 *
 * @param {Request} request
 * @param {Response} response
 * @param {object|null} parsedBody
 * @param {object} opts
 * @param {{waitUntil?: (p:Promise<any>)=>void}|null} [opts.ctx]
 * @param {Cache} [opts.cacheImpl]
 * @returns {Promise<'STORE'|'STORE_SKIPPED'|'BYPASS'>}
 */
export async function putSplitCachedResponse(request, response, parsedBody, opts = {}) {
  if (!isSplitCacheEligible(request)) return 'BYPASS';
  if (!isSplitResponseCacheable(response, parsedBody)) return 'STORE_SKIPPED';
  const cacheImpl = opts.cacheImpl ?? (typeof caches !== 'undefined' ? caches.default : null);
  if (!cacheImpl || typeof cacheImpl.put !== 'function') return 'STORE_SKIPPED';
  try {
    const key = buildSplitCacheKey(request);
    if (!key) return 'STORE_SKIPPED';
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', `public, max-age=${PREMIUM_SPLIT_CACHE_TTL_SECONDS}`);
    headers.set('X-SB-Premium-Cache-Stored-At', new Date().toISOString());
    const cacheable = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    const promise = cacheImpl.put(key, cacheable).catch(() => {});
    if (opts.ctx && typeof opts.ctx.waitUntil === 'function') {
      opts.ctx.waitUntil(promise);
    }
    return 'STORE';
  } catch {
    return 'STORE_SKIPPED';
  }
}
