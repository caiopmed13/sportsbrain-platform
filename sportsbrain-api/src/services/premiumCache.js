// ══════════════════════════════════════════════════════════════════════════
// Premium Cache Guard — short TTL via Cloudflare Cache API (P3.9 R6J-B3)
// ══════════════════════════════════════════════════════════════════════════
//
// Mitigação de menor risco para o endpoint /v1/picks/premium que está
// estourando CPU/subrequest budget (CF error 1102) em football.
//
// Cache short-TTL na Cache API nativa (caches.default) — sem KV/D1 novo,
// stateless edge, reversível por simples deploy.
//
// NÃO altera decisões de picks, ranking, score, tier. Apenas embrulha o
// response final em uma camada idempotente: se o mesmo (path + sorted
// search params) já foi servido com lab_mode=true há menos de TTL, serve
// o clone do cache. Caso contrário, executa fluxo normal e tenta gravar
// no cache (só se a resposta passar nos gates de segurança).
//
// Gates obrigatórios para gravar:
//   - response.status === 200
//   - body JSON parseável
//   - body.ok === true
//   - body.lab_mode === true
//   - body NÃO contém can_beta / can_sell / micro_test_active no top-level
//   - body NÃO contém propriedade `error`
//
// Bypass do cache:
//   - method !== 'GET'
//   - pathname !== '/v1/picks/premium'
//   - query param `debug=1`
//   - query param `nocache=1`
//   - qualquer query param iniciando com `admin` ou `debug_`
//   - header X-Admin-Key não-vazio
//   - header Authorization não-vazio
//
// TTL inicial: 60s. Pode subir para 120s em rodadas futuras se estável.
//
// Falha do cache (caches.default indisponível ou throw) NUNCA quebra
// o endpoint — fallback silencioso para fluxo normal.
// ══════════════════════════════════════════════════════════════════════════

export const PREMIUM_CACHE_TTL_SECONDS = 60;
export const PREMIUM_CACHE_KEY_PREFIX = 'https://sportsbrain-cache.local';
export const PREMIUM_CACHE_PATH = '/v1/picks/premium';

/**
 * Query params que entram na chave de cache. Outros são ignorados para
 * normalização. Conjunto pequeno e fechado — qualquer param novo precisa
 * ser explicitamente adicionado aqui.
 */
export const PREMIUM_CACHE_RELEVANT_PARAMS = Object.freeze([
  'sport',
  'days',
  'date',
  'league',
  'mode',
  'bet365_only',
]);

/**
 * Decide se uma request é elegível para cache. Bypass total se admin/debug,
 * non-GET, path errado, ou qualquer sinal de auth.
 *
 * @param {Request} request
 * @returns {boolean}
 */
export function isPremiumCacheEligible(request) {
  if (!request) return false;
  if (request.method !== 'GET') return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.pathname !== PREMIUM_CACHE_PATH) return false;

  // Bypass por query params sensíveis
  for (const [k, v] of url.searchParams.entries()) {
    const lk = k.toLowerCase();
    if (lk === 'debug' && v === '1') return false;
    if (lk === 'nocache' && v === '1') return false;
    if (lk.startsWith('admin')) return false;
    if (lk.startsWith('debug_')) return false;
  }

  // Bypass por headers sensíveis
  const adminKey = request.headers.get('X-Admin-Key') || '';
  if (adminKey.trim()) return false;
  const authHdr = request.headers.get('Authorization') || '';
  if (authHdr.trim()) return false;

  return true;
}

/**
 * Constrói a chave de cache canônica. Normaliza query params:
 *   - lowercase em keys
 *   - apenas keys em PREMIUM_CACHE_RELEVANT_PARAMS
 *   - ordenação alfabética
 *   - values trimmed
 *
 * Resultado: URL pseudo-publica `https://sportsbrain-cache.local/premium?...`
 * que serve só como chave de lookup (não sai da rede CF).
 *
 * @param {Request} request
 * @returns {string} URL para usar como key em caches.default.match/put
 */
export function buildPremiumCacheKey(request) {
  const url = new URL(request.url);
  const relevant = new Set(PREMIUM_CACHE_RELEVANT_PARAMS);
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
  return `${PREMIUM_CACHE_KEY_PREFIX}${PREMIUM_CACHE_PATH}${qs ? '?' + qs : ''}`;
}

/**
 * Decide se um response (e seu body já parseado) pode ser gravado no cache.
 * Conservador: qualquer dúvida → não cacheia.
 *
 * @param {Response} response
 * @param {object|null} parsedBody
 * @returns {boolean}
 */
export function isPremiumResponseCacheable(response, parsedBody) {
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
 * Tenta buscar response cacheado. Retorna Response clone com header
 * X-SB-Premium-Cache=HIT, ou null em miss / erro / bypass.
 *
 * Falha silenciosa: qualquer throw da Cache API retorna null (fluxo
 * normal continua).
 *
 * @param {Request} request
 * @param {object} opts
 * @param {Cache} [opts.cacheImpl] — para teste; default caches.default
 * @returns {Promise<Response | null>}
 */
export async function getPremiumCachedResponse(request, opts = {}) {
  if (!isPremiumCacheEligible(request)) return null;
  const cacheImpl = opts.cacheImpl ?? (typeof caches !== 'undefined' ? caches.default : null);
  if (!cacheImpl || typeof cacheImpl.match !== 'function') return null;
  try {
    const key = buildPremiumCacheKey(request);
    const hit = await cacheImpl.match(key);
    if (!hit) return null;
    // Clona e adiciona header de diagnóstico
    const headers = new Headers(hit.headers);
    headers.set('X-SB-Premium-Cache', 'HIT');
    headers.set('X-SB-Premium-Cache-TTL', String(PREMIUM_CACHE_TTL_SECONDS));
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  } catch {
    // Falha do cache nunca quebra o endpoint
    return null;
  }
}

/**
 * Tenta gravar response no cache. Idempotente, silencioso em erro.
 * Usa ctx.waitUntil quando disponível para não bloquear o response.
 *
 * @param {Request} request
 * @param {Response} response — original do handler
 * @param {object|null} parsedBody — já parseado (evita custo de re-clone+json)
 * @param {object} opts
 * @param {{waitUntil?: (p:Promise<any>)=>void}|null} [opts.ctx]
 * @param {Cache} [opts.cacheImpl] — para teste; default caches.default
 * @returns {Promise<'STORE'|'STORE_SKIPPED'|'BYPASS'>}
 */
export async function putPremiumCachedResponse(request, response, parsedBody, opts = {}) {
  if (!isPremiumCacheEligible(request)) return 'BYPASS';
  if (!isPremiumResponseCacheable(response, parsedBody)) return 'STORE_SKIPPED';
  const cacheImpl = opts.cacheImpl ?? (typeof caches !== 'undefined' ? caches.default : null);
  if (!cacheImpl || typeof cacheImpl.put !== 'function') return 'STORE_SKIPPED';
  try {
    const key = buildPremiumCacheKey(request);
    // Clone com Cache-Control short-TTL — Cache API respeita o max-age
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', `public, max-age=${PREMIUM_CACHE_TTL_SECONDS}`);
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
    // Não awaita — não bloqueia entrega ao usuário
    return 'STORE';
  } catch {
    return 'STORE_SKIPPED';
  }
}

/**
 * Helper combinado: chama o handler do endpoint, intercepta o response,
 * e tenta gravar no cache se elegível. Pensado para wrapping mínimo no
 * routes/premiumPicks.js — handler retorna seu Response normal e este
 * wrap só observa.
 *
 * Não usa o handler por dentro — quem chama é quem decide se faz a
 * lógica do MISS. Este helper só facilita o passo "depois do response,
 * tente gravar".
 *
 * @param {Request} request
 * @param {Response} response
 * @param {object|null} parsedBody
 * @param {object} opts
 * @returns {Promise<{cacheStatus: 'STORE'|'STORE_SKIPPED'|'BYPASS', response: Response}>}
 */
export async function maybeStorePremiumResponse(request, response, parsedBody, opts = {}) {
  const status = await putPremiumCachedResponse(request, response, parsedBody, opts);
  // Anota header MISS/STORE no response que vai pra rede (clone para evitar
  // mutar headers do response já consumido).
  const headers = new Headers(response.headers);
  headers.set('X-SB-Premium-Cache', status === 'STORE' ? 'MISS' : status === 'BYPASS' ? 'BYPASS' : 'MISS');
  headers.set('X-SB-Premium-Cache-TTL', String(PREMIUM_CACHE_TTL_SECONDS));
  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return { cacheStatus: status, response: out };
}
