// ══════════════════════════════════════════════════════════════════════════
// premiumApi.js — P3.9 R6J-B7 frontend lazy-load client
// ══════════════════════════════════════════════════════════════════════════
//
// Cliente para os endpoints split adicionados no R6J-B6:
//   - /v1/picks/premium/tier1  → primeira render rápida
//   - /v1/picks/premium/combos → sections paginadas
//   - /v1/picks/premium        → legacy (fallback de emergência)
//
// Cada chamada:
//   - aceita AbortSignal para cancelamento em unmount
//   - normaliza HTTP/JSON errors em { ok: false, error, status }
//   - NÃO tem timeout próprio (browser/edge controlam); UI mostra skeleton
//     enquanto fetch está pendente
//
// Sections válidas (espelho do backend):
//   tier2, tier3, tier4, results_acca, top_picks_today,
//   bet_builder_light, bet_builder_mid, bet_builder_plus
// ══════════════════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_BASE || 'https://sportsbrain-api.sportsbrain-api.workers.dev';

export const ALLOWED_PREMIUM_SECTIONS = Object.freeze([
  'tier2',
  'tier3',
  'tier4',
  'results_acca',
  'top_picks_today',
  'bet_builder_light',
  'bet_builder_mid',
  'bet_builder_plus',
]);

/**
 * Mapa de section → caminho interno no body LEGACY. Usado pelo fallback ao
 * legacy quando endpoints split falham — extrai a mesma seção do payload
 * gigante para popular o estado por seção.
 */
const LEGACY_SECTION_PATH = Object.freeze({
  tier2: (body) => body?.tier2?.combos,
  tier3: (body) => body?.tier3?.combos,
  tier4: (body) => body?.tier4?.combos,
  results_acca: (body) => body?.results_acca?.combos || body?.results_acca?.picks,
  top_picks_today: (body) => Array.isArray(body?.top_picks_today) ? body.top_picks_today : body?.top_picks_today?.picks,
  bet_builder_light: (body) => body?.bet_builder?.light?.combos,
  bet_builder_mid: (body) => body?.bet_builder?.mid?.combos,
  bet_builder_plus: (body) => body?.bet_builder?.plus?.combos,
});

function _buildPremiumQuery({ sport, date, days }) {
  const params = new URLSearchParams();
  if (sport) params.set('sport', sport);
  if (date) params.set('date', date);
  if (days != null) params.set('days', String(days));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function _safeJson(response) {
  try {
    return await response.json();
  } catch (e) {
    return null;
  }
}

/**
 * Fetcher tier1 (fast path R6J-B6).
 *
 * @param {object} params
 * @param {string} params.sport
 * @param {string} [params.date]
 * @param {number} [params.days]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ ok: boolean, body: object|null, error: string|null, status: number }>}
 */
export async function fetchPremiumTier1({ sport, date, days, signal } = {}) {
  const qs = _buildPremiumQuery({ sport, date, days });
  const url = `${API_BASE}/v1/picks/premium/tier1${qs}`;
  try {
    const res = await fetch(url, { signal });
    const body = await _safeJson(res);
    if (!res.ok) {
      return {
        ok: false,
        body,
        error: `HTTP ${res.status}`,
        status: res.status,
      };
    }
    if (!body || body.ok !== true) {
      return {
        ok: false,
        body,
        error: body?.error || 'invalid_body',
        status: res.status,
      };
    }
    return { ok: true, body, error: null, status: res.status };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { ok: false, body: null, error: 'aborted', status: 0 };
    }
    return { ok: false, body: null, error: String(e?.message || e), status: 0 };
  }
}

/**
 * Fetcher combos por section (lazy-load R6J-B6).
 *
 * @param {object} params
 * @param {string} params.sport
 * @param {string} [params.date]
 * @param {number} [params.days]
 * @param {string} params.section — uma de ALLOWED_PREMIUM_SECTIONS
 * @param {number} [params.page=1]
 * @param {number} [params.pageSize=25]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ ok: boolean, body: object|null, error: string|null, status: number }>}
 */
export async function fetchPremiumCombos({ sport, date, days, section, page = 1, pageSize = 25, signal } = {}) {
  if (!section) {
    return { ok: false, body: null, error: 'missing_section', status: 0 };
  }
  if (!ALLOWED_PREMIUM_SECTIONS.includes(section)) {
    return { ok: false, body: null, error: 'invalid_section', status: 0 };
  }
  const params = new URLSearchParams();
  if (sport) params.set('sport', sport);
  if (date) params.set('date', date);
  if (days != null) params.set('days', String(days));
  params.set('section', section);
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  const url = `${API_BASE}/v1/picks/premium/combos?${params.toString()}`;
  try {
    const res = await fetch(url, { signal });
    const body = await _safeJson(res);
    if (!res.ok) {
      return {
        ok: false,
        body,
        error: body?.error || `HTTP ${res.status}`,
        status: res.status,
      };
    }
    if (!body || body.ok !== true) {
      return {
        ok: false,
        body,
        error: body?.error || 'invalid_body',
        status: res.status,
      };
    }
    return { ok: true, body, error: null, status: res.status };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { ok: false, body: null, error: 'aborted', status: 0 };
    }
    return { ok: false, body: null, error: String(e?.message || e), status: 0 };
  }
}

/**
 * Fetcher legacy /v1/picks/premium — usado APENAS como fallback quando
 * /tier1 falhar. NÃO usar como caminho normal porque carrega ~3 MB.
 *
 * @param {object} params
 * @returns {Promise<{ ok: boolean, body: object|null, error: string|null, status: number }>}
 */
export async function fetchPremiumLegacy({ sport, date, days, signal } = {}) {
  const qs = _buildPremiumQuery({ sport, date, days });
  const url = `${API_BASE}/v1/picks/premium${qs}`;
  try {
    const res = await fetch(url, { signal });
    const body = await _safeJson(res);
    if (!res.ok) {
      return {
        ok: false,
        body,
        error: `HTTP ${res.status}`,
        status: res.status,
      };
    }
    return { ok: true, body, error: null, status: res.status };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { ok: false, body: null, error: 'aborted', status: 0 };
    }
    return { ok: false, body: null, error: String(e?.message || e), status: 0 };
  }
}

/**
 * Extrai items de uma section a partir do body legacy. Usado quando o
 * fallback legacy é acionado e precisamos popular o estado por seção como
 * se viesse do endpoint /combos.
 *
 * @param {object|null} legacyBody
 * @param {string} section
 * @returns {Array}
 */
export function extractLegacySectionItems(legacyBody, section) {
  const getter = LEGACY_SECTION_PATH[section];
  if (!getter) return [];
  const items = getter(legacyBody);
  return Array.isArray(items) ? items : [];
}

/**
 * Orquestrador de lazy-load com concorrência limitada. Recebe lista de
 * sections + fetcher e dispara máximo `concurrency` requests simultâneas.
 * Chama onSection({ section, ok, body, error }) à medida que cada uma
 * resolve.
 *
 * Não rejeita — erros são propagados via onSection. Promise resolve
 * quando TODAS as sections foram processadas.
 *
 * @param {object} opts
 * @param {string[]} opts.sections
 * @param {(section: string) => Promise<{ok, body, error}>} opts.fetcher
 * @param {(result: {section: string, ok: boolean, body: object|null, error: string|null}) => void} opts.onSection
 * @param {number} [opts.concurrency=2]
 * @returns {Promise<void>}
 */
export async function lazyLoadSections({ sections, fetcher, onSection, concurrency = 2 } = {}) {
  if (!Array.isArray(sections) || sections.length === 0) return;
  const queue = sections.slice();
  const workers = [];
  const _maxConcurrency = Math.max(1, Math.min(concurrency, queue.length));

  async function worker() {
    while (queue.length > 0) {
      const section = queue.shift();
      if (section == null) break;
      try {
        const result = await fetcher(section);
        if (typeof onSection === 'function') {
          onSection({ section, ...result });
        }
      } catch (e) {
        if (typeof onSection === 'function') {
          onSection({
            section,
            ok: false,
            body: null,
            error: String(e?.message || e),
          });
        }
      }
    }
  }

  for (let i = 0; i < _maxConcurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}
