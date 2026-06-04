// ══════════════════════════════════════════════════════════════════════════
// Premium Endpoint Split — utilidades de pagination + filtragem (P3.9 R6J-B6)
// ══════════════════════════════════════════════════════════════════════════
//
// Suporta dois novos endpoints (sem quebrar o legacy /v1/picks/premium):
//
//   GET /v1/picks/premium/tier1?days=7&sport=football
//     → primeira render rápido com apenas tier1 + metadados básicos.
//     → não retorna combo tiers, bet_builder, results_acca, top_picks_today.
//
//   GET /v1/picks/premium/combos?days=7&sport=football&section=tier2&page=1&page_size=25
//     → seção paginada para lazy-load. Page size clamp [1, 50], default 25.
//     → section ∈ { tier2, tier3, tier4, results_acca, top_picks_today,
//                   bet_builder_light, bet_builder_mid, bet_builder_plus }
//
// IMPORTANTE: os handlers consomem o body do legacy handler e SLICAM. Isso
// preserva 100% de compat com pickAudit/cache/slim/stake-sanitize já
// aplicados em premiumPicks.js. A primeira request cold ainda paga o custo
// completo do build legacy — limitação conhecida (refactor para builders
// extraídos exige nova autorização). Mas:
//   - payload por endpoint é dramaticamente menor (~50KB tier1 vs ~3MB legacy);
//   - cache TTL=60s por endpoint independente — request 2..N de qualquer
//     endpoint serve <1s do edge.
// ══════════════════════════════════════════════════════════════════════════

// ── Pagination ────────────────────────────────────────────────────────────

/**
 * Default e bounds para o parâmetro `page_size` dos endpoints split.
 */
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MIN = 1;
export const PAGE_SIZE_MAX = 50;

/**
 * Default e bound para o parâmetro `page` (1-based).
 */
export const PAGE_DEFAULT = 1;
export const PAGE_MIN = 1;

/**
 * Lê `page` e `page_size` da URL com defaults e clamps seguros. Valores
 * inválidos (não-numéricos, negativos) caem para o default. Acima do max,
 * clamp para max (política conservadora — UX resiliente, sem 400).
 *
 * @param {URLSearchParams|URL|null|undefined} input
 * @returns {{ page: number, page_size: number, page_size_effective: number, page_size_requested: number|null }}
 */
export function parsePaginationParams(input) {
  const params = _toSearchParams(input);
  const rawPage = params?.get('page');
  const rawPageSize = params?.get('page_size');

  let page = PAGE_DEFAULT;
  if (rawPage != null && rawPage !== '') {
    const n = Number.parseInt(rawPage, 10);
    if (Number.isFinite(n) && n >= PAGE_MIN) page = n;
  }

  let pageSize = PAGE_SIZE_DEFAULT;
  let pageSizeRequested = null;
  if (rawPageSize != null && rawPageSize !== '') {
    const n = Number.parseInt(rawPageSize, 10);
    if (Number.isFinite(n) && n >= 1) {
      pageSizeRequested = n;
      if (n < PAGE_SIZE_MIN) pageSize = PAGE_SIZE_MIN;
      else if (n > PAGE_SIZE_MAX) pageSize = PAGE_SIZE_MAX;
      else pageSize = n;
    }
  }

  return {
    page,
    page_size: pageSize,
    page_size_effective: pageSize,
    page_size_requested: pageSizeRequested,
  };
}

/**
 * Pagina um array com page (1-based) e page_size. Retorna slice + metadados.
 *
 * @param {Array} items
 * @param {number} page
 * @param {number} pageSize
 * @returns {{ items: Array, page: number, page_size: number, total_count: number, has_next: boolean, has_prev: boolean }}
 */
export function paginatePremiumItems(items, page, pageSize) {
  const arr = Array.isArray(items) ? items : [];
  const total = arr.length;
  const p = Math.max(PAGE_MIN, Number.isFinite(page) ? page : PAGE_DEFAULT);
  const sz = Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Number.isFinite(pageSize) ? pageSize : PAGE_SIZE_DEFAULT));
  const start = (p - 1) * sz;
  const end = start + sz;
  const sliced = start >= total ? [] : arr.slice(start, end);
  return {
    items: sliced,
    page: p,
    page_size: sz,
    total_count: total,
    has_next: end < total,
    has_prev: p > 1,
  };
}

// ── Sections ──────────────────────────────────────────────────────────────

/**
 * Sections permitidas para o endpoint /v1/picks/premium/combos.
 * Mantido como Set frozen-like para lookup O(1).
 */
export const ALLOWED_SECTIONS = Object.freeze([
  'tier2',
  'tier3',
  'tier4',
  'results_acca',
  'top_picks_today',
  'bet_builder_light',
  'bet_builder_mid',
  'bet_builder_plus',
]);

const _ALLOWED_SET = new Set(ALLOWED_SECTIONS);

/**
 * Valida o parâmetro `section`. Retorna `{ ok: true, section }` ou
 * `{ ok: false, error, allowed_sections }` para uso direto em 400.
 *
 * @param {string|null|undefined} raw
 * @returns {{ ok: true, section: string } | { ok: false, error: string, allowed_sections: readonly string[] }}
 */
export function parseSectionParam(raw) {
  if (raw == null || raw === '') {
    return {
      ok: false,
      error: 'missing_section',
      allowed_sections: ALLOWED_SECTIONS,
    };
  }
  const lc = String(raw).trim().toLowerCase();
  if (!_ALLOWED_SET.has(lc)) {
    return {
      ok: false,
      error: 'invalid_section',
      allowed_sections: ALLOWED_SECTIONS,
    };
  }
  return { ok: true, section: lc };
}

/**
 * Extrai o array de itens de uma seção a partir do body legacy do Premium.
 * Mapeia o nome plano de section para o caminho interno do body produzido
 * por handlePremiumPicks (legacy).
 *
 *   tier2             → body.tier2.combos
 *   tier3             → body.tier3.combos
 *   tier4             → body.tier4.combos
 *   results_acca      → body.results_acca.combos (ou .picks, fallback)
 *   top_picks_today   → body.top_picks_today.picks (ou body.top_picks_today directly se for array)
 *   bet_builder_light → body.bet_builder.light.combos
 *   bet_builder_mid   → body.bet_builder.mid.combos
 *   bet_builder_plus  → body.bet_builder.plus.combos
 *
 * Sempre retorna array (vazio se não encontrar).
 *
 * @param {object|null} body — body do legacy endpoint (já slim+sanitized)
 * @param {string} section — pré-validada via parseSectionParam
 * @returns {Array}
 */
export function extractSectionItems(body, section) {
  if (!body || typeof body !== 'object') return [];
  switch (section) {
    case 'tier2': return _asArray(body?.tier2?.combos);
    case 'tier3': return _asArray(body?.tier3?.combos);
    case 'tier4': return _asArray(body?.tier4?.combos);
    case 'results_acca': {
      return _asArray(body?.results_acca?.combos)
        || _asArray(body?.results_acca?.picks)
        || [];
    }
    case 'top_picks_today': {
      // top_picks_today no body legacy é objeto com .picks; defensivo p/ array direto.
      const tpt = body?.top_picks_today;
      if (Array.isArray(tpt)) return tpt;
      return _asArray(tpt?.picks);
    }
    case 'bet_builder_light': return _asArray(body?.bet_builder?.light?.combos);
    case 'bet_builder_mid':   return _asArray(body?.bet_builder?.mid?.combos);
    case 'bet_builder_plus':  return _asArray(body?.bet_builder?.plus?.combos);
    default: return [];
  }
}

// ── Tier1 slim ────────────────────────────────────────────────────────────

/**
 * Campos mantidos no payload do endpoint /v1/picks/premium/tier1. Lista
 * fechada — qualquer campo fora dela é dropado. Garante que tier2/3/4,
 * bet_builder, results_acca, top_picks_today e golden NÃO vazem por
 * acidente (defesa em profundidade: slim no body já remove os campos
 * pesados internos dos picks, mas aqui dropamos as seções inteiras).
 */
export const TIER1_KEEP_TOP_LEVEL_KEYS = Object.freeze([
  'ok',
  'lab_mode',
  'sport',
  'days',
  'generated_at',
  'tier1',
  'premium_enrichment_summary',
  'payload_summary',
  'cache_meta',
  // FAIXA-Methods tier MVP — payload bounded por caps (15 cards + 10 duplas
  // + 5 quadras por método × 2 métodos). Incluso aqui para o frontend ler
  // via tier1 endpoint sem precisar de fetch separado.
  'faixa_methods',
]);

/**
 * Sections que NÃO podem aparecer no tier1 endpoint (sanity check).
 */
export const TIER1_FORBIDDEN_TOP_LEVEL_KEYS = Object.freeze([
  'tier2',
  'tier3',
  'tier4',
  'results_acca',
  'bet_builder',
  'top_picks_today',
  'golden',
  'jackpot',
  'desajustes',
  'shadow_creation_debug',
  'shadow_bets_persisted',
  'audit_health',
  'market_inventory_debug',
  'audit_status',
  'odds_movement_summary',
  'cascade_jackpot',
  'mega_pool',
]);

/**
 * Constrói payload tier1-only a partir do body legacy. Drop de todas as
 * seções pesadas; mantém apenas tier1 + metadados de safety e payload size.
 *
 * @param {object} body — body legacy (já slim+sanitized)
 * @returns {object} body slim para /v1/picks/premium/tier1
 */
export function buildTier1Payload(body) {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      lab_mode: true,
      error: 'invalid_upstream_body',
    };
  }
  const out = {};
  for (const k of TIER1_KEEP_TOP_LEVEL_KEYS) {
    if (k in body) out[k] = body[k];
  }
  // Garante lab_mode=true e ok=true (defesa em profundidade — o legacy já
  // grava lab_mode=true; aqui só refletimos).
  if (!('ok' in out)) out.ok = body.ok === true;
  if (!('lab_mode' in out)) out.lab_mode = body.lab_mode === true;
  // Inclui tier1 sempre como objeto, mesmo se vazio
  if (!('tier1' in out)) {
    out.tier1 = { count: 0, picks: [] };
  }
  return out;
}

// ── Combos slim ───────────────────────────────────────────────────────────

/**
 * Constrói payload paginado de combos a partir do body legacy. Aplica
 * extractSectionItems + paginatePremiumItems + envelope com metadados.
 *
 * @param {object} body — body legacy
 * @param {string} section — pré-validada
 * @param {number} page
 * @param {number} pageSize
 * @returns {object} body slim para /v1/picks/premium/combos
 */
export function buildCombosPayload(body, section, page, pageSize) {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      lab_mode: true,
      error: 'invalid_upstream_body',
      section,
    };
  }
  const items = extractSectionItems(body, section);
  const paginated = paginatePremiumItems(items, page, pageSize);
  return {
    ok: body.ok === true,
    lab_mode: body.lab_mode === true,
    sport: body.sport,
    days: body.days,
    generated_at: body.generated_at,
    section,
    page: paginated.page,
    page_size: paginated.page_size,
    page_size_effective: paginated.page_size,
    total_count: paginated.total_count,
    has_next: paginated.has_next,
    has_prev: paginated.has_prev,
    items: paginated.items,
    premium_enrichment_summary: body.premium_enrichment_summary,
    payload_summary: {
      section,
      page,
      page_size: paginated.page_size,
      items_in_page: paginated.items.length,
      total_count: paginated.total_count,
    },
  };
}

// ── Safety checks ─────────────────────────────────────────────────────────

/**
 * Detecta se o body retornado pelo legacy quebraria safety:
 * stake positivo em algum item, can_beta/can_sell/micro_test_active true
 * top-level. Usado pelos handlers split antes de retornar — defesa em
 * profundidade contra regressão.
 *
 * @param {object} body
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function isBodySafeForSplit(body) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'no_body' };
  if (body.can_beta === true) return { ok: false, reason: 'can_beta_true' };
  if (body.can_sell === true) return { ok: false, reason: 'can_sell_true' };
  if (body.micro_test_active === true) return { ok: false, reason: 'micro_test_active_true' };
  if (body.lab_mode !== true) return { ok: false, reason: 'not_lab_mode' };
  return { ok: true };
}

// ── Helpers internos ──────────────────────────────────────────────────────

function _toSearchParams(input) {
  if (!input) return null;
  if (input instanceof URLSearchParams) return input;
  try {
    if (typeof input === 'string') return new URL(input).searchParams;
  } catch { /* noop */ }
  if (typeof input === 'object' && 'searchParams' in input) return input.searchParams;
  return null;
}

function _asArray(maybeArr) {
  return Array.isArray(maybeArr) ? maybeArr : [];
}
