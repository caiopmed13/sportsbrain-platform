// ══════════════════════════════════════════════════════════════════════════
// Premium Verdict — P3.9 R6K-F2
// ══════════════════════════════════════════════════════════════════════════
//
// "Annotate, don't filter": cada pick/combo recebe um veredito da IA sem
// ser bloqueado. Existem dois eixos:
//
//   math_verdict   — pura função do ev_pct:
//                    gold    ev>= 8.0
//                    value   ev>= 3.0
//                    fair    ev>= -2.0
//                    trap    ev <  -2.0
//                    unknown ev não-finito
//                    Thresholds alinhados ao módulo Aumentadas (boostBuilder.js).
//
//   design_verdict — design intent do item (não substitui math_verdict):
//                    long_shot — APENAS combos com combined_odd >= 500
//                                (single avulso com odd alta NÃO é long_shot)
//                    null      — não aplicável
//
// Ambos os eixos coexistem: um combo pode ter math_verdict='trap' E
// design_verdict='long_shot' — isso é "Mega ilusório" no produto.
//
// NÃO altera ranking, scoring, threshold global, motor de picks.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Thresholds de math_verdict. Frozen para evitar mutação acidental e para
 * espelhar o contrato de boostBuilder.js (módulo Aumentadas).
 */
export const VERDICT_THRESHOLDS = Object.freeze({
  gold:  8.0,
  value: 3.0,
  fair:  -2.0,
});

/**
 * Odd combinada mínima para um combo ser considerado long_shot.
 */
export const LONG_SHOT_ODD_THRESHOLD = 500;

/**
 * Verdicts válidos para math_verdict.
 */
export const MATH_VERDICTS = Object.freeze(['gold', 'value', 'fair', 'trap', 'unknown']);

/**
 * Verdicts válidos para design_verdict.
 */
export const DESIGN_VERDICTS = Object.freeze(['long_shot']);

/**
 * Computa o math_verdict a partir do ev_pct.
 *
 * @param {*} ev_pct — número (em %) representando o EV da seleção/combo
 * @returns {'gold'|'value'|'fair'|'trap'|'unknown'}
 */
export function computeMathVerdict(ev_pct) {
  if (ev_pct == null) return 'unknown';
  const ev = Number(ev_pct);
  if (!Number.isFinite(ev)) return 'unknown';
  if (ev >= VERDICT_THRESHOLDS.gold)  return 'gold';
  if (ev >= VERDICT_THRESHOLDS.value) return 'value';
  if (ev >= VERDICT_THRESHOLDS.fair)  return 'fair';
  return 'trap';
}

/**
 * Detecta se um item é um combo (possui legs ou tier de combo). Heurística
 * tolerante: aceita item.legs[], item.tier ∈ {tier2/3/4}, item._tier presente,
 * item._is_combo / item.is_combo true.
 *
 * Single avulso (tier1) NÃO é combo mesmo com odd alta.
 *
 * @param {object|null} item
 * @returns {boolean}
 */
export function isCombo(item) {
  if (!item || typeof item !== 'object') return false;
  if (Array.isArray(item.legs) && item.legs.length > 0) return true;
  const tier = item.tier ?? item._tier;
  if (typeof tier === 'string' && /^tier[234]$/.test(tier)) return true;
  if (item._is_combo === true || item.is_combo === true) return true;
  return false;
}

/**
 * Computa o design_verdict. Apenas combos com combined_odd >= 500 recebem
 * 'long_shot'. Singles com odd alta retornam null.
 *
 * AJUSTE R6K-F2 (#2 do operador): long_shot SÓ para combo/mega, não para
 * single com odd alta. A detecção de "combo" usa isCombo() — single avulso
 * com odd 999 não vira long_shot.
 *
 * @param {object|null} item
 * @returns {'long_shot'|null}
 */
export function computeDesignVerdict(item) {
  if (!item || typeof item !== 'object') return null;
  if (!isCombo(item)) return null;
  const combinedOdd = Number(item.combined_odd ?? item.combinedOdd);
  if (!Number.isFinite(combinedOdd)) return null;
  if (combinedOdd >= LONG_SHOT_ODD_THRESHOLD) return 'long_shot';
  return null;
}

/**
 * Anota o item com `math_verdict` e `design_verdict` (in-place mutation,
 * idempotente). Retorna o próprio item por conveniência.
 *
 * @param {object|null} item
 * @returns {object|null}
 */
export function annotateVerdict(item) {
  if (!item || typeof item !== 'object') return item;
  item.math_verdict   = computeMathVerdict(item.ev_pct);
  item.design_verdict = computeDesignVerdict(item);
  return item;
}

/**
 * Anota cada item de um array em-place. Tolerante a non-array (returns
 * silently). Retorna o número de itens anotados.
 *
 * @param {Array|null} arr
 * @returns {number}
 */
export function annotateVerdictArray(arr) {
  if (!Array.isArray(arr)) return 0;
  let count = 0;
  for (const it of arr) {
    if (it && typeof it === 'object') {
      annotateVerdict(it);
      count++;
    }
  }
  return count;
}
