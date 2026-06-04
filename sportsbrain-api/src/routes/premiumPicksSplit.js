// ══════════════════════════════════════════════════════════════════════════
// Premium Split Endpoints — P3.9 R6J-B6
// ══════════════════════════════════════════════════════════════════════════
//
// Dois endpoints não-breaking:
//
//   GET /v1/picks/premium/tier1?days=7&sport=football
//     → handlePremiumTier1
//
//   GET /v1/picks/premium/combos?days=7&sport=football&section=tier2&page=1&page_size=25
//     → handlePremiumCombos
//
// Ambos chamam handlePremiumPicks (legacy) internamente, esperam o body
// completo, e fatiam/paginam antes de devolver. Isso preserva:
//   - decisões internas de pick/score/tier (inalteradas)
//   - stake sanitize R6J-A (já aplicado pelo legacy)
//   - slim R6J-B (já aplicado pelo legacy)
//   - bounded enrichment R6J-B4 (já aplicado pelo legacy)
//   - bulk loaders R6J-B5 (já aplicado pelo legacy)
//
// Cache: cada endpoint tem cache próprio (premiumSplitCache.js) com chave por
// URL completa. TTL 60s. Mesmo gating de safety que o legacy.
//
// Limitação conhecida (declarada na spec R6J-B6): cold miss da PRIMEIRA
// request paga custo total do build legacy (~22-32s). Subsequentes do
// MESMO endpoint servem <1s do edge (cache HIT). Refactor para builders
// extraídos exige nova autorização.
// ══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';
import {
  parsePaginationParams,
  parseSectionParam,
  buildTier1Payload,
  buildCombosPayload,
  isBodySafeForSplit,
  ALLOWED_SECTIONS,
  TIER1_FORBIDDEN_TOP_LEVEL_KEYS,
} from '../services/premiumEndpointSplit.js';
import {
  getSplitCachedResponse,
  putSplitCachedResponse,
} from '../services/premiumSplitCache.js';

// ── /v1/picks/premium/tier1 ───────────────────────────────────────────────

/**
 * Handler do endpoint /v1/picks/premium/tier1.
 *
 * Fluxo:
 *   1. Tenta cache HIT (próprio do path /tier1).
 *   2. Em miss, encaminha para handlePremiumPicks (legacy) com a mesma URL
 *      mapeada para /v1/picks/premium (mantém todos os outros query params).
 *   3. Parseia body, valida safety, extrai tier1 + metadados, monta payload
 *      slim.
 *   4. Tenta gravar no cache.
 *
 * @param {Request} request
 * @param {object} env
 * @param {object|null} ctx
 * @returns {Promise<Response>}
 */
export async function handlePremiumTier1(request, env, ctx = null) {
  try {
    // 1. Cache HIT lookup (antes de qualquer trabalho)
    try {
      const _cached = await getSplitCachedResponse(request);
      if (_cached) return _cached;
    } catch (_e) {
      console.warn('[premium-split:tier1] cache lookup error (continuando sem cache):', _e?.message || _e);
    }

    // 2. Forward para o legacy handler com URL reescrita
    const upstream = await _callLegacyPremiumHandler(request, env, ctx);
    if (!upstream) {
      return _errorResponse(500, 'legacy_handler_unavailable');
    }

    // 3. Se legacy retornou non-2xx, propaga (sem cache)
    if (upstream.status < 200 || upstream.status >= 300) {
      return _passthroughResponse(upstream, { cacheStatus: 'BYPASS' });
    }

    // 4. Parse body
    let body;
    try {
      body = await upstream.clone().json();
    } catch (e) {
      return _errorResponse(502, 'legacy_body_unparseable', { detail: String(e?.message || e) });
    }

    // 5. Safety check
    const safe = isBodySafeForSplit(body);
    if (!safe.ok) {
      return _errorResponse(500, 'safety_check_failed', { reason: safe.reason });
    }

    // 6. Build tier1 slim payload
    const slim = buildTier1Payload(body);

    // 7. Defesa em profundidade: garantir que nenhuma seção pesada vazou
    for (const k of TIER1_FORBIDDEN_TOP_LEVEL_KEYS) {
      if (k in slim) delete slim[k];
    }
    slim.lab_mode = true;       // garantia explícita
    delete slim.can_beta;
    delete slim.can_sell;
    delete slim.micro_test_active;

    // 8. Compose response
    const response = new Response(JSON.stringify(slim, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        ...corsHeaders(),
      },
    });

    // 9. Try cache.put (não bloqueia)
    let cacheStatus = 'BYPASS';
    try {
      cacheStatus = await putSplitCachedResponse(request, response, slim, { ctx });
    } catch (_e) {
      console.warn('[premium-split:tier1] cache put error:', _e?.message || _e);
    }

    // 10. Anota header MISS/STORE/BYPASS no response (clone)
    const finalHeaders = new Headers(response.headers);
    finalHeaders.set('X-SB-Premium-Cache', cacheStatus === 'STORE' ? 'MISS' : 'BYPASS');
    finalHeaders.set('X-SB-Premium-Cache-TTL', '60');
    return new Response(JSON.stringify(slim, null, 2), {
      status: 200,
      headers: Object.fromEntries(finalHeaders.entries()),
    });
  } catch (e) {
    return _errorResponse(500, 'tier1_handler_error', { detail: String(e?.message || e) });
  }
}

// ── /v1/picks/premium/combos ──────────────────────────────────────────────

/**
 * Handler do endpoint /v1/picks/premium/combos.
 *
 * Query params:
 *   section (required) ∈ ALLOWED_SECTIONS
 *   page (default 1)
 *   page_size (default 25, max 50)
 *   + os params propagados para legacy (sport, days, date, league, mode, bet365_only)
 *
 * @param {Request} request
 * @param {object} env
 * @param {object|null} ctx
 * @returns {Promise<Response>}
 */
export async function handlePremiumCombos(request, env, ctx = null) {
  try {
    // 1. Parse params primeiro (400 se invalid section — não tem custo do legacy)
    const url = new URL(request.url);
    const sectionResult = parseSectionParam(url.searchParams.get('section'));
    if (!sectionResult.ok) {
      return _errorResponse(400, sectionResult.error, {
        allowed_sections: sectionResult.allowed_sections,
        ok: false,
      });
    }
    const { section } = sectionResult;
    const pagination = parsePaginationParams(url.searchParams);

    // 2. Cache HIT lookup
    try {
      const _cached = await getSplitCachedResponse(request);
      if (_cached) return _cached;
    } catch (_e) {
      console.warn('[premium-split:combos] cache lookup error:', _e?.message || _e);
    }

    // 3. Forward para legacy com URL mapeada
    const upstream = await _callLegacyPremiumHandler(request, env, ctx);
    if (!upstream) {
      return _errorResponse(500, 'legacy_handler_unavailable');
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      return _passthroughResponse(upstream, { cacheStatus: 'BYPASS' });
    }

    let body;
    try {
      body = await upstream.clone().json();
    } catch (e) {
      return _errorResponse(502, 'legacy_body_unparseable', { detail: String(e?.message || e) });
    }

    const safe = isBodySafeForSplit(body);
    if (!safe.ok) {
      return _errorResponse(500, 'safety_check_failed', { reason: safe.reason });
    }

    // 4. Build paginated slim payload
    const slim = buildCombosPayload(body, section, pagination.page, pagination.page_size);
    slim.lab_mode = true;
    delete slim.can_beta;
    delete slim.can_sell;
    delete slim.micro_test_active;

    const response = new Response(JSON.stringify(slim, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        ...corsHeaders(),
      },
    });

    let cacheStatus = 'BYPASS';
    try {
      cacheStatus = await putSplitCachedResponse(request, response, slim, { ctx });
    } catch (_e) {
      console.warn('[premium-split:combos] cache put error:', _e?.message || _e);
    }

    const finalHeaders = new Headers(response.headers);
    finalHeaders.set('X-SB-Premium-Cache', cacheStatus === 'STORE' ? 'MISS' : 'BYPASS');
    finalHeaders.set('X-SB-Premium-Cache-TTL', '60');
    return new Response(JSON.stringify(slim, null, 2), {
      status: 200,
      headers: Object.fromEntries(finalHeaders.entries()),
    });
  } catch (e) {
    return _errorResponse(500, 'combos_handler_error', { detail: String(e?.message || e) });
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────

/**
 * Mapeia request com path /v1/picks/premium/{tier1,combos} para
 * /v1/picks/premium e chama handlePremiumPicks. Preserva todos os outros
 * params, method, headers (exceto recriação obrigatória da Request).
 */
async function _callLegacyPremiumHandler(request, env, ctx) {
  try {
    const url = new URL(request.url);
    url.pathname = '/v1/picks/premium';

    // Remove params específicos do split do upstream para evitar mistura
    // acidental (legacy não os usa, mas garantimos chave de cache estável
    // do lado legacy).
    url.searchParams.delete('section');
    url.searchParams.delete('page');
    url.searchParams.delete('page_size');

    const legacyRequest = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      // body: undefined para GET — request original GET não tem body
    });
    const { handlePremiumPicks } = await import('./premiumPicks.js');
    return await handlePremiumPicks(legacyRequest, env, ctx);
  } catch (e) {
    console.error('[premium-split] erro ao chamar handlePremiumPicks:', e?.message || e);
    return null;
  }
}

function _errorResponse(status, error, extra = {}) {
  const body = {
    ok: false,
    lab_mode: true,
    error,
    ...extra,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      'X-SB-Premium-Cache': 'BYPASS',
      ...corsHeaders(),
    },
  });
}

function _passthroughResponse(response, opts = {}) {
  const headers = new Headers(response.headers);
  if (opts.cacheStatus) headers.set('X-SB-Premium-Cache', opts.cacheStatus);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Re-export para uso em testes
export { ALLOWED_SECTIONS };
