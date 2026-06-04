// tests/premiumCacheR6JB3.test.js — P3.9 R6J-B3
// Cobre o cache short-TTL guard do endpoint Premium:
//   - eligibility: só GET no path /v1/picks/premium, sem admin/debug
//   - cache key normaliza/ordena search params relevantes
//   - isPremiumResponseCacheable rejeita 503/lab_mode=false/can_beta etc.
//   - getPremiumCachedResponse retorna HIT com header diagnóstico
//   - putPremiumCachedResponse só grava quando seguro
//   - falha do Cache API NUNCA quebra o endpoint
//   - waitUntil é usado se disponível

import { describe, it, expect, vi } from 'vitest';
import {
  PREMIUM_CACHE_TTL_SECONDS,
  PREMIUM_CACHE_PATH,
  PREMIUM_CACHE_RELEVANT_PARAMS,
  isPremiumCacheEligible,
  buildPremiumCacheKey,
  isPremiumResponseCacheable,
  getPremiumCachedResponse,
  putPremiumCachedResponse,
  maybeStorePremiumResponse,
} from '../src/services/premiumCache.js';

// ── helpers ──────────────────────────────────────────────────────────────
function makeReq(url, init = {}) {
  return new Request(url, init);
}

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeMockCache() {
  const store = new Map();
  return {
    match: vi.fn(async (key) => store.get(key) ?? undefined),
    put: vi.fn(async (key, response) => {
      // Clona o body para simular comportamento real (response só pode ser
      // lido uma vez)
      const cloned = response.clone();
      store.set(key, cloned);
    }),
    _store: store,
  };
}

const PREMIUM_URL = `https://sportsbrain-api.workers.dev${PREMIUM_CACHE_PATH}`;

// ─────────────────────────────────────────────────────────────────────────
describe('R6J-B3 — isPremiumCacheEligible', () => {
  it('GET no path certo é eligible', () => {
    expect(isPremiumCacheEligible(makeReq(`${PREMIUM_URL}?days=7&sport=football`))).toBe(true);
  });

  it('POST não é eligible', () => {
    expect(isPremiumCacheEligible(makeReq(PREMIUM_URL, { method: 'POST' }))).toBe(false);
  });

  it('path diferente não é eligible', () => {
    expect(isPremiumCacheEligible(makeReq(`https://sportsbrain-api.workers.dev/v1/picks/today`))).toBe(false);
  });

  it('?debug=1 bypassa cache', () => {
    expect(isPremiumCacheEligible(makeReq(`${PREMIUM_URL}?days=7&debug=1`))).toBe(false);
  });

  it('?nocache=1 bypassa cache', () => {
    expect(isPremiumCacheEligible(makeReq(`${PREMIUM_URL}?nocache=1`))).toBe(false);
  });

  it('qualquer param admin* bypassa', () => {
    expect(isPremiumCacheEligible(makeReq(`${PREMIUM_URL}?admin_key=foo`))).toBe(false);
    expect(isPremiumCacheEligible(makeReq(`${PREMIUM_URL}?admin=1`))).toBe(false);
  });

  it('qualquer param debug_* bypassa', () => {
    expect(isPremiumCacheEligible(makeReq(`${PREMIUM_URL}?debug_internal=1`))).toBe(false);
  });

  it('header X-Admin-Key não-vazio bypassa', () => {
    expect(isPremiumCacheEligible(makeReq(PREMIUM_URL, { headers: { 'X-Admin-Key': 'secret' } }))).toBe(false);
  });

  it('header Authorization não-vazio bypassa', () => {
    expect(isPremiumCacheEligible(makeReq(PREMIUM_URL, { headers: { Authorization: 'Bearer foo' } }))).toBe(false);
  });

  it('header X-Admin-Key vazio NÃO bypassa', () => {
    expect(isPremiumCacheEligible(makeReq(PREMIUM_URL, { headers: { 'X-Admin-Key': '' } }))).toBe(true);
  });

  it('URL inválida retorna false', () => {
    expect(isPremiumCacheEligible({ url: 'not a url', method: 'GET', headers: new Headers() })).toBe(false);
  });

  it('null/undefined retorna false', () => {
    expect(isPremiumCacheEligible(null)).toBe(false);
    expect(isPremiumCacheEligible(undefined)).toBe(false);
  });
});

describe('R6J-B3 — buildPremiumCacheKey', () => {
  it('inclui só params relevantes', () => {
    const k = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?days=7&sport=football&random=xyz`));
    expect(k).toContain('days=7');
    expect(k).toContain('sport=football');
    expect(k).not.toContain('random=xyz');
  });

  it('ordem dos params não afeta a key', () => {
    const k1 = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?sport=football&days=7`));
    const k2 = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?days=7&sport=football`));
    expect(k1).toBe(k2);
  });

  it('normaliza case do value', () => {
    const k1 = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?sport=Football`));
    const k2 = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?sport=football`));
    expect(k1).toBe(k2);
  });

  it('value vazio é ignorado', () => {
    const k = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?sport=&days=7`));
    expect(k).toContain('days=7');
    expect(k).not.toContain('sport=');
  });

  it('contém o pseudo-domain', () => {
    const k = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?days=7`));
    expect(k.startsWith('https://')).toBe(true);
    expect(k).toContain(PREMIUM_CACHE_PATH);
  });

  it('PREMIUM_CACHE_RELEVANT_PARAMS lista é fechada e razoável', () => {
    expect(PREMIUM_CACHE_RELEVANT_PARAMS).toContain('sport');
    expect(PREMIUM_CACHE_RELEVANT_PARAMS).toContain('days');
    expect(PREMIUM_CACHE_RELEVANT_PARAMS).toContain('date');
    expect(PREMIUM_CACHE_RELEVANT_PARAMS).toContain('mode');
    // Não pode incluir nada admin/debug
    for (const p of PREMIUM_CACHE_RELEVANT_PARAMS) {
      expect(p.toLowerCase().startsWith('admin')).toBe(false);
      expect(p.toLowerCase().startsWith('debug')).toBe(false);
    }
  });
});

describe('R6J-B3 — isPremiumResponseCacheable', () => {
  it('status 200 + ok=true + lab_mode=true => cacheável', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: true, tier1: { count: 5 } });
    expect(isPremiumResponseCacheable(r, { ok: true, lab_mode: true })).toBe(true);
  });

  it('status 503 => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: false }, 503);
    expect(isPremiumResponseCacheable(r, { ok: false })).toBe(false);
  });

  it('lab_mode ausente => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: true });
    expect(isPremiumResponseCacheable(r, { ok: true })).toBe(false);
  });

  it('lab_mode=false => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: false });
    expect(isPremiumResponseCacheable(r, { ok: true, lab_mode: false })).toBe(false);
  });

  it('ok=false => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: false, lab_mode: true });
    expect(isPremiumResponseCacheable(r, { ok: false, lab_mode: true })).toBe(false);
  });

  it('top-level can_beta presente => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: true, can_beta: false });
    expect(isPremiumResponseCacheable(r, { ok: true, lab_mode: true, can_beta: false })).toBe(false);
  });

  it('top-level can_sell presente => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: true, can_sell: false });
    expect(isPremiumResponseCacheable(r, { ok: true, lab_mode: true, can_sell: false })).toBe(false);
  });

  it('top-level micro_test_active presente => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: true, micro_test_active: false });
    expect(isPremiumResponseCacheable(r, { ok: true, lab_mode: true, micro_test_active: false })).toBe(false);
  });

  it('body com error truthy => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: true, error: 'something' });
    expect(isPremiumResponseCacheable(r, { ok: true, lab_mode: true, error: 'something' })).toBe(false);
  });

  it('body com error null/undefined/empty => cacheável (não bloqueia)', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: true, error: null });
    expect(isPremiumResponseCacheable(r, { ok: true, lab_mode: true, error: null })).toBe(true);
  });

  it('parsedBody null => NÃO cacheável', () => {
    const r = makeJsonResponse({ ok: true, lab_mode: true });
    expect(isPremiumResponseCacheable(r, null)).toBe(false);
  });
});

describe('R6J-B3 — getPremiumCachedResponse', () => {
  it('retorna null se request não eligible', async () => {
    const cache = makeMockCache();
    const out = await getPremiumCachedResponse(
      makeReq(PREMIUM_URL, { headers: { 'X-Admin-Key': 'foo' } }),
      { cacheImpl: cache }
    );
    expect(out).toBeNull();
    expect(cache.match).not.toHaveBeenCalled();
  });

  it('retorna null em miss', async () => {
    const cache = makeMockCache();
    const out = await getPremiumCachedResponse(makeReq(`${PREMIUM_URL}?days=7`), { cacheImpl: cache });
    expect(out).toBeNull();
    expect(cache.match).toHaveBeenCalledTimes(1);
  });

  it('retorna Response com X-SB-Premium-Cache=HIT em hit', async () => {
    const cache = makeMockCache();
    const cached = makeJsonResponse({ ok: true, lab_mode: true, tier1: { count: 3 } });
    const key = buildPremiumCacheKey(makeReq(`${PREMIUM_URL}?days=7&sport=football`));
    cache._store.set(key, cached.clone());

    const out = await getPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7&sport=football`),
      { cacheImpl: cache }
    );
    expect(out).not.toBeNull();
    expect(out.status).toBe(200);
    expect(out.headers.get('X-SB-Premium-Cache')).toBe('HIT');
    expect(out.headers.get('X-SB-Premium-Cache-TTL')).toBe(String(PREMIUM_CACHE_TTL_SECONDS));
    const body = await out.json();
    expect(body.tier1.count).toBe(3);
  });

  it('falha do cache não propaga (retorna null)', async () => {
    const cache = { match: vi.fn(async () => { throw new Error('cache offline'); }) };
    const out = await getPremiumCachedResponse(makeReq(`${PREMIUM_URL}?days=7`), { cacheImpl: cache });
    expect(out).toBeNull();
  });

  it('cacheImpl ausente retorna null sem throw', async () => {
    const out = await getPremiumCachedResponse(makeReq(`${PREMIUM_URL}?days=7`), { cacheImpl: null });
    expect(out).toBeNull();
  });
});

describe('R6J-B3 — putPremiumCachedResponse', () => {
  it('grava response cacheável', async () => {
    const cache = makeMockCache();
    const body = { ok: true, lab_mode: true, tier1: { count: 5 } };
    const resp = makeJsonResponse(body);
    const status = await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      resp,
      body,
      { cacheImpl: cache }
    );
    expect(status).toBe('STORE');
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('BYPASS se request não eligible', async () => {
    const cache = makeMockCache();
    const body = { ok: true, lab_mode: true };
    const status = await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?debug=1`),
      makeJsonResponse(body),
      body,
      { cacheImpl: cache }
    );
    expect(status).toBe('BYPASS');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('STORE_SKIPPED se response não cacheável (503)', async () => {
    const cache = makeMockCache();
    const status = await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      makeJsonResponse({ ok: false }, 503),
      { ok: false },
      { cacheImpl: cache }
    );
    expect(status).toBe('STORE_SKIPPED');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('STORE_SKIPPED se lab_mode=false', async () => {
    const cache = makeMockCache();
    const body = { ok: true, lab_mode: false };
    const status = await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      makeJsonResponse(body),
      body,
      { cacheImpl: cache }
    );
    expect(status).toBe('STORE_SKIPPED');
  });

  it('STORE_SKIPPED se body expõe can_beta top-level', async () => {
    const cache = makeMockCache();
    const body = { ok: true, lab_mode: true, can_beta: false };
    const status = await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      makeJsonResponse(body),
      body,
      { cacheImpl: cache }
    );
    expect(status).toBe('STORE_SKIPPED');
  });

  it('STORE_SKIPPED se cacheImpl ausente', async () => {
    const body = { ok: true, lab_mode: true };
    const status = await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      makeJsonResponse(body),
      body,
      { cacheImpl: null }
    );
    expect(status).toBe('STORE_SKIPPED');
  });

  it('falha do cache.put não propaga (retorna STORE com waitUntil silencioso)', async () => {
    // cache.put rejeita; STORE é reportado mesmo assim porque cache.put é
    // best-effort via waitUntil. Não bloqueia entrega.
    const cache = { put: vi.fn(async () => { throw new Error('cache write failed'); }) };
    const body = { ok: true, lab_mode: true };
    const status = await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      makeJsonResponse(body),
      body,
      { cacheImpl: cache }
    );
    // STORE indica que o waitUntil foi disparado; a rejeição é silenciada
    expect(status).toBe('STORE');
  });

  it('usa ctx.waitUntil quando disponível', async () => {
    const cache = makeMockCache();
    const waitUntil = vi.fn();
    const body = { ok: true, lab_mode: true };
    await putPremiumCachedResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      makeJsonResponse(body),
      body,
      { cacheImpl: cache, ctx: { waitUntil } }
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });
});

describe('R6J-B3 — round-trip HIT/MISS via mock cache', () => {
  it('primeira chamada MISS, segunda HIT', async () => {
    const cache = makeMockCache();
    const req = makeReq(`${PREMIUM_URL}?days=7&sport=football`);
    const body = { ok: true, lab_mode: true, tier1: { count: 5 } };

    // MISS
    const first = await getPremiumCachedResponse(req, { cacheImpl: cache });
    expect(first).toBeNull();

    // Store
    const putStatus = await putPremiumCachedResponse(
      req,
      makeJsonResponse(body),
      body,
      { cacheImpl: cache }
    );
    expect(putStatus).toBe('STORE');

    // HIT
    const second = await getPremiumCachedResponse(req, { cacheImpl: cache });
    expect(second).not.toBeNull();
    expect(second.headers.get('X-SB-Premium-Cache')).toBe('HIT');
    const cachedBody = await second.json();
    expect(cachedBody).toEqual(body);
  });

  it('keys distintas para sport=football vs sport=basketball', async () => {
    const cache = makeMockCache();
    const reqF = makeReq(`${PREMIUM_URL}?sport=football&days=7`);
    const reqB = makeReq(`${PREMIUM_URL}?sport=basketball&days=7`);
    const bodyF = { ok: true, lab_mode: true, sport: 'football' };
    const bodyB = { ok: true, lab_mode: true, sport: 'basketball' };

    await putPremiumCachedResponse(reqF, makeJsonResponse(bodyF), bodyF, { cacheImpl: cache });
    await putPremiumCachedResponse(reqB, makeJsonResponse(bodyB), bodyB, { cacheImpl: cache });

    const hitF = await getPremiumCachedResponse(reqF, { cacheImpl: cache });
    const hitB = await getPremiumCachedResponse(reqB, { cacheImpl: cache });
    expect((await hitF.json()).sport).toBe('football');
    expect((await hitB.json()).sport).toBe('basketball');
  });
});

describe('R6J-B3 — maybeStorePremiumResponse helper', () => {
  it('retorna response com header MISS e cacheStatus STORE em cache válido', async () => {
    const cache = makeMockCache();
    const body = { ok: true, lab_mode: true };
    const orig = makeJsonResponse(body);
    const { cacheStatus, response } = await maybeStorePremiumResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      orig,
      body,
      { cacheImpl: cache }
    );
    expect(cacheStatus).toBe('STORE');
    expect(response.headers.get('X-SB-Premium-Cache')).toBe('MISS');
    expect(response.headers.get('X-SB-Premium-Cache-TTL')).toBe(String(PREMIUM_CACHE_TTL_SECONDS));
  });

  it('BYPASS para admin retorna header BYPASS', async () => {
    const cache = makeMockCache();
    const body = { ok: true, lab_mode: true };
    const { cacheStatus, response } = await maybeStorePremiumResponse(
      makeReq(PREMIUM_URL, { headers: { 'X-Admin-Key': 'secret' } }),
      makeJsonResponse(body),
      body,
      { cacheImpl: cache }
    );
    expect(cacheStatus).toBe('BYPASS');
    expect(response.headers.get('X-SB-Premium-Cache')).toBe('BYPASS');
  });

  it('STORE_SKIPPED quando body não é cacheável (header MISS é mantido)', async () => {
    const cache = makeMockCache();
    const body = { ok: true, lab_mode: false }; // não cacheável
    const { cacheStatus, response } = await maybeStorePremiumResponse(
      makeReq(`${PREMIUM_URL}?days=7`),
      makeJsonResponse(body),
      body,
      { cacheImpl: cache }
    );
    expect(cacheStatus).toBe('STORE_SKIPPED');
    // MISS é o default — usuário não percebe que store foi skipped
    expect(response.headers.get('X-SB-Premium-Cache')).toBe('MISS');
  });
});

describe('R6J-B3 — defensive properties', () => {
  it('TTL é menor ou igual a 5 minutos (max-age público)', () => {
    expect(PREMIUM_CACHE_TTL_SECONDS).toBeGreaterThan(0);
    expect(PREMIUM_CACHE_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it('TTL default é 60s (conforme spec inicial)', () => {
    expect(PREMIUM_CACHE_TTL_SECONDS).toBe(60);
  });

  it('PREMIUM_CACHE_PATH é o endpoint público v1', () => {
    expect(PREMIUM_CACHE_PATH).toBe('/v1/picks/premium');
  });
});
