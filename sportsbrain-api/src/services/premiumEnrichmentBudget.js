// ══════════════════════════════════════════════════════════════════════════
// Premium Enrichment Budget — bounded top-N gate (P3.9 R6J-B4)
// ══════════════════════════════════════════════════════════════════════════
//
// Mitigação para o cold miss do /v1/picks/premium: o `getSignalsForPick`
// faz ~10 subrequests D1 por pick (steam + form×4 + lineup + referee + h2h
// + rest×2 + momentum). Com 200-300 picks no pool, total estoura o budget
// CF de 1000 subrequests/invocation no unbound plan, causando error 1102.
//
// Estratégia (Opção B do R6J-B4 spec):
//   1) Compute pre-score barato (síncrono, sem D1) para cada pick.
//   2) Ordena por pre-score.
//   3) Top-N picks recebem getSignalsForPick completo.
//   4) Picks fora do top-N recebem signalsData=null (sem queries D1).
//      Mantêm campos essenciais (odd, ev_pct, score base, tier) mas sem
//      badges de signals (form, lineup, referee, h2h, rest, momentum).
//
// Opt-in via env: PREMIUM_ENRICHMENT_TOP_N=<N>
//   - ausente / null / 0 / vazio → DESABILITADO. Todos enriquecidos
//     (comportamento idêntico ao pré-R6J-B4).
//   - >= length do pool → todos enriquecidos.
//   - >0 e <length → bounded ativo.
//
// Pré-score = (confidence base) + (consensus boost) + (devig signal) +
//             (Bayesian LCB se presente) + (steam pre-flag).
// Tudo síncrono — zero subrequests no pre-score.
// ══════════════════════════════════════════════════════════════════════════

// Default sugerido. Não é aplicado automaticamente — só via env explícita.
export const PREMIUM_ENRICHMENT_DEFAULT_TOP_N = 80;
export const PREMIUM_ENRICHMENT_ENV_KEY = 'PREMIUM_ENRICHMENT_TOP_N';

/**
 * Lê o top-N do env. Retorna null se não setado, 0 inválido ou negativo.
 * Aceita string (do wrangler) ou number.
 *
 * @param {Record<string, any> | undefined | null} env
 * @returns {number | null}
 */
export function getEnrichmentTopN(env) {
  if (!env) return null;
  const raw = env[PREMIUM_ENRICHMENT_ENV_KEY];
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Pre-score barato síncrono — usado pra escolher top-N candidatos a
 * enrichment completo. Não chama D1. Não muta o pick.
 *
 * Componentes (pesos arbitrários, calibrados pra rankear "confiança a
 * priori" antes de signals):
 *   confidence (0-100)                                  — base
 *   consensus.count × 5                                  — múltiplas fontes
 *   consensus.unique_channels × 8                        — diversidade
 *   _bayesian_lcb (presente)                             — histórico forte
 *   _is_direct_b365 ? 8                                  — odd verificada
 *   _has_steam ? (strong:15 / medium:8 / leve:4)         — sharp money
 *   _is_devig ? 5                                        — devig calc
 *   _pattern_lcb (presente)                              — padrão IA
 *
 * Não é o score final — é apenas ordenação para budget gate.
 *
 * @param {object} pick
 * @param {Function} calcConsensus — recebida por injeção (de pickUtils.js)
 * @param {object[]} tipsterTips
 * @returns {number}
 */
export function computeEnrichmentPreScore(pick, calcConsensus, tipsterTips) {
  if (!pick || typeof pick !== 'object') return 0;
  let s = 0;
  // 1. Confidence base (0-100)
  const conf = Number.isFinite(pick.confidence)
    ? pick.confidence
    : (Number.isFinite(pick.conf) ? pick.conf : 50);
  s += Math.max(0, Math.min(100, conf));
  // 2. Consensus boost — usa a mesma função que o handler usa
  try {
    if (typeof calcConsensus === 'function') {
      const cons = calcConsensus(pick, tipsterTips) || { count: 0, unique_channels: 0 };
      s += (cons.count || 0) * 5;
      s += (cons.unique_channels || 0) * 8;
    }
  } catch {
    // calcConsensus pode lançar em pick mal-formado; preserva pre-score sem boost
  }
  // 3. Bayesian LCB (histórico calibrado)
  if (Number.isFinite(pick._bayesian_lcb)) s += Math.min(30, pick._bayesian_lcb / 3);
  // 4. Direct Bet365 (odd verificada com devig)
  if (pick._is_direct_b365 === true) s += 8;
  // 5. Steam (sharp money)
  if (pick._has_steam === true) {
    if (pick.steam_strength === 'strong') s += 15;
    else if (pick.steam_strength === 'medium') s += 8;
    else s += 4;
  }
  // 6. Devig
  if (pick._is_devig === true) s += 5;
  // 7. Pattern LCB (IA)
  if (Number.isFinite(pick._pattern_lcb)) s += Math.min(20, pick._pattern_lcb / 4);
  return s;
}

/**
 * Constrói o Set de picks elegíveis para enrichment completo. Quando
 * topN é null OR topN >= length, retorna null (sinaliza "enriquecer
 * todos" sem alocar Set).
 *
 * @param {object[]} annotatedBase
 * @param {Function} calcConsensus
 * @param {object[]} tipsterTips
 * @param {number | null} topN
 * @returns {Set<object> | null}
 */
export function buildEnrichmentTopNSet(annotatedBase, calcConsensus, tipsterTips, topN) {
  if (!Array.isArray(annotatedBase)) return null;
  if (topN == null) return null;                           // disabled → enrich all
  if (!Number.isFinite(topN) || topN <= 0) return null;
  if (topN >= annotatedBase.length) return null;           // top-N cobre tudo → enrich all (skip set work)

  const scored = annotatedBase.map(p => ({ p, s: computeEnrichmentPreScore(p, calcConsensus, tipsterTips) }));
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, topN).map(x => x.p);
  return new Set(top);
}

/**
 * Sumário público (não-sensível) para inclusão no response top-level.
 * Útil pra UI/operador ver que gate está ativo e quantos picks foram
 * enriquecidos.
 *
 * @param {object} args
 * @param {number} args.totalPicks
 * @param {Set<object> | null} args.enrichSet
 * @param {number | null} args.topN
 * @returns {{ mode: 'full' | 'bounded', enriched_count: number, skipped_count: number, top_n: number | null, reason: string | null }}
 */
export function buildEnrichmentSummary({ totalPicks, enrichSet, topN }) {
  const total = Number.isFinite(totalPicks) ? totalPicks : 0;
  if (enrichSet == null) {
    return {
      mode: 'full',
      enriched_count: total,
      skipped_count: 0,
      top_n: null,
      reason: null,
    };
  }
  const enriched = enrichSet.size;
  return {
    mode: 'bounded',
    enriched_count: enriched,
    skipped_count: Math.max(0, total - enriched),
    top_n: Number.isFinite(topN) ? topN : null,
    reason: 'subrequest_budget_guard',
  };
}

/**
 * Helper de conveniência usado pelo handler: avalia se o pick específico
 * deve receber enrichment completo. Quando enrichSet é null (modo full),
 * sempre retorna true.
 *
 * @param {Set<object> | null} enrichSet
 * @param {object} pick
 * @returns {boolean}
 */
export function shouldEnrichFully(enrichSet, pick) {
  if (enrichSet == null) return true;
  return enrichSet.has(pick);
}
