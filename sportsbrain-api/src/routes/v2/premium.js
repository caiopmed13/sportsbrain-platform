/**
 * SportsBrain API v2 — Premium Picks Route
 * ─────────────────────────────────────────
 *
 *   GET /v2/picks/premium
 *
 * Envelope v2: { ok, data, meta: { version, generated_at, request_id, cache, duration_ms, plan }, error }
 *
 * Schema do campo `data`:
 *   {
 *     tier1: [ PickV2... ],    // Daily Singles (premium, curado)
 *     combos: [ ComboV2... ],  // Combos recomendados
 *     jackpot: [ PickV2... ],  // Acumulador do dia
 *     meta: {
 *       total_picks: N,
 *       elite_count: N,
 *       strong_count: N,
 *       sport_filter: 'football'|'all'|...,
 *       generated_at: ISO
 *     }
 *   }
 *
 * Auth:
 *   - free  → acesso limitado (tier1 only, picks sem debug)
 *   - vip   → acesso completo (tier1 + combos + jackpot)
 *   - pro   → igual vip
 *   - internal → vip + debug=1 disponível
 *
 * Debug:
 *   - ?debug=1 → expõe _debug nos picks; SOMENTE plano internal
 */

import { v2ok, v2err, makeRequestId, resolveV2Plan, V2_PREMIUM_PLANS, V2_DEBUG_PLANS } from '../../middleware/response.js';

// ── Normaliza um pick v1 para o schema rico v2 ────────────────────────────
function normalizePickV2(pick, { includeDebug = false } = {}) {
  if (!pick) return null;

  const p = {
    // Identidade do mercado
    id:            pick.id || null,
    match:         pick.match || [pick.home_team, pick.away_team].filter(Boolean).join(' vs ') || null,
    home_team:     pick.home_team || null,
    away_team:     pick.away_team || null,
    league:        pick.league || pick.competition || null,
    fixture_id:    pick.fixture_id || pick.event_id || null,
    kickoff:       pick.kickoff || pick.date || null,
    sport:         pick.sport || 'football',

    // Mercado e odd
    market:        pick.stat || pick.market || null,
    market_label:  pick.label || pick.market_label || null,
    selection:     pick.selection || pick.outcome || null,
    line:          pick.line != null ? Number(pick.line) : null,
    odd:           pick.odd != null ? Number(pick.odd) : null,
    book:          pick.book || pick.bookmaker || null,

    // Qualidade v2 (Premium Engine v2)
    quality: {
      score:           pick.premiumQualityScore != null ? Number(pick.premiumQualityScore) : (pick.score || null),
      tier:            pick.premiumTierQuality || 'playable',
      value_bet_level: pick.valueBetLevel || 'none',
      desajuste_level: pick.desajuste_level || null,
    },

    // EV e probabilidade
    ev_pct:        pick.ev_pct != null ? Number(pick.ev_pct) : null,
    fair_prob:     pick.fair_prob != null ? Number(pick.fair_prob) : null,
    bayesian_lcb:  pick._bayesian_lcb != null ? Number(pick._bayesian_lcb) : null,

    // Sinais de mercado
    signals: {
      has_steam:      pick._has_steam || false,
      steam_strength: pick.steam_strength || null,
      is_devig:       pick._is_devig || false,
      source:         pick.source || null,
    },

    // Consenso
    consensus: pick.consensus ? {
      count:           pick.consensus.count || 0,
      channels:        pick.consensus.unique_channels || 0,
      avg_odd:         pick.consensus.avg_odd || null,
    } : null,
  };

  // Remove debug field a não ser que autorizado
  if (includeDebug && pick._debug) {
    p._debug = pick._debug;
  }

  return p;
}

// ── Normaliza um combo v1 para schema v2 ─────────────────────────────────
function normalizeComboV2(combo, { includeDebug = false } = {}) {
  if (!combo) return null;
  return {
    id:                  combo.id || null,
    legs:                (combo.legs || []).map(l => normalizePickV2(l, { includeDebug })),
    combined_odd:        combo.combined_odd != null ? Number(combo.combined_odd) : null,
    combined_ev_pct:     combo.combined_ev_pct != null ? Number(combo.combined_ev_pct) : null,
    quality_score:       combo.combo_quality_score != null ? Number(combo.combo_quality_score) : null,
    label:               combo.label || combo.tier || null,
    suggested_stake_pct: combo.suggested_stake_pct || null,
    rationale:           combo.rationale || null,
  };
}

// ── Handler principal ─────────────────────────────────────────────────────
export async function handleV2Premium(request, env, ctx) {
  const reqId = makeRequestId();
  const start = Date.now();

  // Resolve autenticação
  const auth = await resolveV2Plan(request, env);
  if (!auth.ok && auth.error === 'INVALID_KEY') {
    return v2err('INVALID_KEY', 'API key inválida ou expirada. Verifique o header X-SB-Key.', 401, { reqId, start });
  }

  const plan = auth.plan || 'free';

  // Verifica acesso ao endpoint premium
  // free tem acesso, mas limitado (sem combos/jackpot)
  const hasFullAccess = V2_PREMIUM_PLANS.has(plan);

  // Debug só para internal
  const url         = new URL(request.url);
  const wantsDebug  = url.searchParams.get('debug') === '1';
  const canDebug    = V2_DEBUG_PLANS.has(plan);

  if (wantsDebug && !canDebug) {
    return v2err(
      'DEBUG_FORBIDDEN',
      'O modo debug=1 requer plano internal. Use X-Admin-Key para acesso internal.',
      403,
      { reqId, start, plan }
    );
  }

  // Constrói URL para chamar o handler v1 internamente
  // Repassa todos os query params originais (sport, limit, etc.)
  const v1Url = new URL(request.url);
  v1Url.pathname = '/v1/picks/premium';
  // Se free e não tem debug, garante debug=0
  if (!canDebug) v1Url.searchParams.delete('debug');

  const v1Request = new Request(v1Url.toString(), {
    method:  request.method,
    headers: request.headers,
  });

  try {
    const { handlePremiumPicks } = await import('../premiumPicks.js');
    const v1Res  = await handlePremiumPicks(v1Request, env, ctx);
    const v1Body = await v1Res.json();

    // v1Body pode ser: { tier1, combos, jackpot, meta } ou { ok, data, ... }
    // handlePremiumPicks retorna diretamente os dados sem envelope
    const rawData = v1Body.data || v1Body;

    const tier1   = (rawData.tier1   || []).map(p => normalizePickV2(p, { includeDebug: canDebug && wantsDebug }));
    const combos  = (rawData.combos  || []).map(c => normalizeComboV2(c, { includeDebug: canDebug && wantsDebug }));
    const jackpot = (rawData.jackpot || []).map(p => normalizePickV2(p, { includeDebug: canDebug && wantsDebug }));

    // free tier: só tier1, sem combos/jackpot, máximo 5 picks
    const respTier1   = hasFullAccess ? tier1   : tier1.slice(0, 5);
    const respCombos  = hasFullAccess ? combos  : [];
    const respJackpot = hasFullAccess ? jackpot : [];

    const eliteCount  = tier1.filter(p => p.quality?.tier === 'elite').length;
    const strongCount = tier1.filter(p => p.quality?.tier === 'strong').length;

    const cacheHeader = v1Res.headers.get('X-Cache') || 'miss';

    return v2ok({
      tier1:   respTier1,
      combos:  respCombos,
      jackpot: respJackpot,
      summary: {
        total_picks:   respTier1.length,
        elite_count:   eliteCount,
        strong_count:  strongCount,
        combo_count:   respCombos.length,
        jackpot_count: respJackpot.length,
        sport_filter:  url.searchParams.get('sport') || 'all',
        generated_at:  new Date().toISOString(),
        plan_note:     hasFullAccess
          ? null
          : 'Plano free: até 5 picks, sem combos/jackpot. Upgrade para VIP+ em sportsbrain.app',
      },
    }, {
      reqId,
      start,
      plan,
      cache: cacheHeader,
      extra: {
        picks_engine: 'premium-engine-v2',
        debug_mode:   wantsDebug && canDebug,
      },
    });

  } catch (e) {
    console.error('[v2/premium] Erro ao chamar v1 handler:', e);
    return v2err(
      'INTERNAL_ERROR',
      'Erro ao processar picks premium. Tente novamente.',
      500,
      { reqId, start, plan }
    );
  }
}
