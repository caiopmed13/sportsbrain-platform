/**
 * SportsBrain Cache Service — Cloudflare Cache API
 * ──────────────────────────────────────────────────
 * Migrado de KV (1.000 puts/dia free tier) para a Cache API
 * do Cloudflare (gratuita, ilimitada, por datacenter).
 *
 * Por que Cache API:
 *  • Zero writes cobráveis — usa edge cache nativo
 *  • TTL controlado via Cache-Control header
 *  • API idêntica à antiga KV do ponto de vista dos callers
 *
 * SB_HISTORY foi removido: dados históricos vivem no D1
 * (HistoryService escreve lá, leitura via getTeamStatsFromDB).
 */

// URL base fictícia para namespace das chaves no Cache API
const CACHE_ORIGIN = 'https://sportsbrain-cache.internal';

// Default TTLs in seconds
export const TTL = {
  GAMES_TODAY:    1800,  // 30 min
  TEAM_STATS:     3600,  // 1 hr
  PLAYER_STATS:   1800,  // 30 min
  PROPS:          900,   // 15 min
  ODDS:           300,   // 5 min
  AVAILABILITY:   600,   // 10 min
  HEALTH:         60,    // 1 min
  HISTORY:     604800,   // 7 days (mantido por compatibilidade)
};

export class CacheService {
  constructor(env) {
    // env não é mais usado aqui (KV removido)
    // Cache API é global via caches.default
    this._cache = null; // lazy — inicializado no primeiro uso
  }

  _getCache() {
    if (!this._cache) {
      try {
        this._cache = caches.default;
      } catch {
        this._cache = null; // fallback: sem cache (dev local)
      }
    }
    return this._cache;
  }

  _cacheKey(key) {
    return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`);
  }

  async get(key) {
    const cache = this._getCache();
    if (!cache) return null;
    try {
      const res = await cache.match(this._cacheKey(key));
      if (!res) return null;
      return await res.json();
    } catch { return null; }
  }

  async set(key, value, ttl = TTL.GAMES_TODAY) {
    const cache = this._getCache();
    if (!cache) return;
    try {
      const res = new Response(JSON.stringify(value), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${ttl}`,
        },
      });
      await cache.put(this._cacheKey(key), res);
    } catch (e) { console.warn('[Cache] set failed:', key, e.message); }
  }

  // Mantido por compatibilidade — agora usa o mesmo Cache API
  async getHistory(key) {
    return this.get(key);
  }

  async setHistory(key, value, ttl = TTL.HISTORY) {
    return this.set(key, value, ttl);
  }

  async del(key) {
    const cache = this._getCache();
    if (!cache) return;
    try { await cache.delete(this._cacheKey(key)); } catch {}
  }

  // Cache-or-compute pattern (API idêntica)
  async getOrFetch(key, fetchFn, ttl = TTL.GAMES_TODAY) {
    const cached = await this.get(key);
    if (cached) return { data: cached, fromCache: true };
    const fresh = await fetchFn();
    if (fresh) await this.set(key, fresh, ttl);
    return { data: fresh, fromCache: false };
  }
}
