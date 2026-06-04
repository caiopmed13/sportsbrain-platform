// ══════════════════════════════════════════════════════════════════════════
// Premium Safety — sanitize stake fields no response público da aba Premium
// ══════════════════════════════════════════════════════════════════════════
// P3.9 R6J-A — Garante que `recommended_stake_pct` (e equivalentes) nunca
// saiam como valor positivo enquanto o produto está em lab mode
// (can_beta=false, can_sell=false, micro_test_active=false), nem para
// picks/combos com bet_confidence_tier ∈ {no_bet, lab_only}, nem quando
// ev_pct é ausente ou <= 0.
//
// NÃO altera cálculo interno (audit_status, bet_confidence_score/tier,
// can_post, result_status, training_eligible, market_validation, etc.).
// Apenas zera campos de stake no objeto que sai pela borda do response.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Campos de stake/exposição que devem ser zerados quando o gate de lab mode
 * dispara. Lista conservadora: nomes vistos no payload Premium hoje + nomes
 * comuns equivalentes citados pelo spec R6J-A.
 */
export const STAKE_FIELDS_TO_ZERO = Object.freeze([
  'recommended_stake_pct',
  'stake_pct',
  'kelly_stake_pct',
  'recommended_units',
  'recommended_stake_unit',
  'bankroll_pct',
  'exposure_pct',
  'suggested_stake_pct',
]);

/**
 * Decide se as flags de safety global derrubam stake para todo item.
 * Em lab mode (qualquer um dos três flags falso), stake DEVE ser 0
 * independentemente de tier/EV.
 *
 * @param {{can_beta?: boolean, can_sell?: boolean, micro_test_active?: boolean}} ctx
 * @returns {boolean} true → forçar stake=0 globalmente
 */
export function isLabModeGlobal(ctx = {}) {
  return ctx.can_beta !== true
      || ctx.can_sell !== true
      || ctx.micro_test_active !== true;
}

/**
 * Decide se um item específico (pick ou combo) deve ter stake zerado mesmo
 * quando o gate global permite. Regras: tier no_bet/lab_only OU ev_pct
 * inválido/<=0. Combos sem `bet_confidence_tier` (vários tier2/3/4 são
 * objetos `combo_type=speculative` sem tier individual) caem só na regra
 * de EV.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isItemUnsafeForStake(item) {
  if (!item || typeof item !== 'object') return false;
  const tier = item.bet_confidence_tier;
  if (tier === 'no_bet' || tier === 'lab_only') return true;
  const ev = item.ev_pct;
  if (!Number.isFinite(ev)) return true;
  if (ev <= 0) return true;
  return false;
}

/**
 * Retorna uma cópia rasa do item com todos os campos de stake zerados.
 * Preserva o resto intacto. Não mexe em arrays aninhados (legs etc.) por
 * convenção — legs de combos não carregam recommended_stake_pct próprio.
 *
 * @template T
 * @param {T} item
 * @returns {T}
 */
export function zeroStakeFields(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  for (const k of STAKE_FIELDS_TO_ZERO) {
    if (k in out) out[k] = 0;
  }
  return out;
}

/**
 * Sanitize stake de um único item se necessário. Retorna o próprio item
 * (sem cópia) quando seguro, ou uma cópia rasa com stakes zerados quando
 * o gate global OU o item dispara a regra individual.
 *
 * @template T
 * @param {T} item
 * @param {{can_beta?: boolean, can_sell?: boolean, micro_test_active?: boolean}} ctx
 * @returns {T}
 */
export function sanitizePremiumStakeFields(item, ctx = {}) {
  if (!item || typeof item !== 'object') return item;
  if (isLabModeGlobal(ctx) || isItemUnsafeForStake(item)) {
    return zeroStakeFields(item);
  }
  return item;
}

/**
 * Sanitize um array de picks/combos. Quando nenhum item dispara a regra,
 * retorna o array original (zero alocação). Caso contrário, retorna um
 * novo array com cópias rasas dos itens afetados.
 *
 * Não mutar o input — preserva os arrays internos (tier1/tier2/...) que
 * podem ser reutilizados em métricas downstream (premium_audit_health,
 * market_inventory_debug, etc.).
 *
 * @template T
 * @param {T[]} arr
 * @param {{can_beta?: boolean, can_sell?: boolean, micro_test_active?: boolean}} ctx
 * @returns {T[]}
 */
export function sanitizePremiumItems(arr, ctx = {}) {
  if (!Array.isArray(arr)) return arr;
  // Lab mode global → todo item potencialmente precisa de cópia se tiver
  // algum dos campos. Mapeamos sempre nesse caso.
  if (isLabModeGlobal(ctx)) {
    return arr.map(it => zeroStakeFields(it));
  }
  // Modo "produto liberado": só copia o que dispara a regra individual.
  let dirty = false;
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (isItemUnsafeForStake(it)) {
      out[i] = zeroStakeFields(it);
      dirty = true;
    } else {
      out[i] = it;
    }
  }
  return dirty ? out : arr;
}

/**
 * Atalho que monta um sanitizer ligado a um contexto fixo — útil quando
 * o handler do response chama o mesmo gate várias vezes para arrays
 * diferentes (tier1, tier2.combos, golden.picks, etc.).
 *
 * @param {{can_beta?: boolean, can_sell?: boolean, micro_test_active?: boolean}} ctx
 */
export function makePremiumStakeSanitizer(ctx = {}) {
  return (arr) => sanitizePremiumItems(arr, ctx);
}

// Contexto fixo do produto enquanto can_beta/can_sell/micro_test_active=false.
// Importável para handlers que ainda não recebem o gate via env.
export const PREMIUM_LAB_CONTEXT = Object.freeze({
  can_beta: false,
  can_sell: false,
  micro_test_active: false,
});

// ══════════════════════════════════════════════════════════════════════════
// P3.9 R6J-B — Slim payload: remove campos pesados do response público
// que não são consumidos pela UI atual. Auditoria/debug retornam apenas com
// flags de admin (já gated em premiumPicks.js); este helper trata APENAS o
// shape default que vai pra aba Premium.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Campos pesados que saem do response público por completo. Nenhum deles
 * é referenciado pela UI atual (verificado por grep em sportsbrain-react/src
 * — ver R6J-B Parte 2). Continuam existindo internamente no objeto bruto
 * pré-borda, só não vazam pelo JSON serializado.
 */
export const HEAVY_FIELDS_TO_DROP = Object.freeze([
  'score_breakdown',
  'evidence_pack',
  'source_trace',
  'resolvability',
  'method_validation',
  'combo_identity',
  'fixture_identity',
  'audit_status',
  'odds_movement',
]);

/**
 * Campos prefixados com `_` NÃO consumidos pela UI atual. UI consome:
 *   _is_direct_b365, _has_steam, _steam_move, _bayesian_lcb, _pattern_lcb,
 *   _pattern_n, _pattern_wr, _is_devig
 * (verificado via grep em Premium.jsx).
 * Esta lista são os internals que podem sair sem quebrar render.
 */
export const INTERNAL_UNDERSCORE_FIELDS_TO_DROP = Object.freeze([
  '_has_real_wr',
  '_historical_note',
  '_is_result_btts',
  '_is_draw_btts',
  '_rb_conservative',
  '_rb_aggressive',
  '_intel_debug',
  '_pattern_pat',
  '_origin',
]);

/**
 * Reduz market_validation (objeto pesado) para o único campo que a UI
 * consome: `market_available` (bool). Mantém retrocompat criando um objeto
 * mínimo em vez de plano, pra não obrigar mudança no Premium.jsx que lê
 * `l.market_validation?.market_available`.
 *
 * @param {object|null|undefined} mv
 * @returns {{market_available: boolean | null} | undefined}
 */
export function slimMarketValidation(mv) {
  if (mv == null) return undefined;
  const ma = mv.market_available;
  return { market_available: ma === true ? true : ma === false ? false : null };
}

/**
 * Aplica slim em um item (pick ou combo). Recursivo em `legs` para combos
 * que carregam sub-picks com os mesmos campos pesados. Não muta o input.
 *
 * @template T
 * @param {T} item
 * @returns {T}
 */
export function slimPremiumItem(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };

  // Drop heavy nested objects
  for (const k of HEAVY_FIELDS_TO_DROP) {
    if (k in out) delete out[k];
  }
  // Drop internal underscore fields not used by UI
  for (const k of INTERNAL_UNDERSCORE_FIELDS_TO_DROP) {
    if (k in out) delete out[k];
  }
  // Reduce market_validation to minimal shape (UI consumes only market_available)
  if ('market_validation' in out) {
    const slim = slimMarketValidation(out.market_validation);
    if (slim) out.market_validation = slim;
    else delete out.market_validation;
  }
  // Recurse into legs (combos carry array of leg-picks with same heavy fields)
  if (Array.isArray(out.legs)) {
    out.legs = out.legs.map(slimPremiumItem);
  }
  return out;
}

/**
 * Slim em array. Como o slim sempre transforma (drop sempre acontece se
 * algum campo presente), retornamos um novo array. Para arrays não-array
 * passa direto.
 *
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function slimPremiumItems(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(slimPremiumItem);
}

/**
 * Wrapper composto que aplica sanitize de stake (R6J-A) seguido de slim
 * (R6J-B). É o que premiumPicks.js usa na borda do response: stake zerado
 * em lab mode/tier inválido/EV<=0, e shape enxuto sem campos pesados.
 *
 * @param {{can_beta?: boolean, can_sell?: boolean, micro_test_active?: boolean}} ctx
 */
export function makePremiumSafeSlimmer(ctx = {}) {
  return (arr) => {
    if (!Array.isArray(arr)) return arr;
    const sanitized = sanitizePremiumItems(arr, ctx);
    return sanitized.map(slimPremiumItem);
  };
}

