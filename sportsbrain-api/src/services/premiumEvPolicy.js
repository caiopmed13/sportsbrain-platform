// ══════════════════════════════════════════════════════════════════════════
// Premium EV Policy — P3.9 R6K-D (R6K-F1 status update)
// ══════════════════════════════════════════════════════════════════════════
//
// STATUS R6K-F1 (annotate-don't-filter):
//   - passesPremiumEvGate / passesPremiumProbGate continuam ativos no
//     tier1Raw (Daily Singles). R6K-D segue valendo para singles.
//   - passesPremiumComboEvPolicy / extractComboLegs / hasNegativeEvLeg foram
//     DESACOPLADOS do pipeline: combos (tier2/3/4/bet_builder) não passam
//     mais por filter combo-level. Mega ilusório voltou a aparecer.
//   - Estas funções permanecem exportadas para reuso em badges/verdict no
//     R6K-F2 (annotate como ALTA_VARIANCIA / MEGA_ILUSORIO / EV_AGREGADO_NEGATIVO).
//
// ══════════════════════════════════════════════════════════════════════════
//
// Função pura testável que decide se um pick passa pelos gates de EV e prob
// usados para construção do tier1Raw em src/routes/premiumPicks.js.
//
// CONTEXTO (R6K-A triagem):
//
// O EV gate original tinha bypass `_is_direct_b365`:
//
//   return p.ev_pct > 0 || p._is_direct_b365 || p._is_faixa_mirror || p.source === 'faixa_mirror'
//
// Isso permitiu picks Bet365 direct (devigged odds) entrarem em tier1Raw com
// EV negativo. Evidência R6K-D baseline em produção:
//
//   tier1                 : 4/10 picks com EV<0 (min -9.16%)
//   tier2 legs            : 44 com EV<0 (min -31.4%)
//   tier3 legs            : 114 com EV<0 (min -58.24%)
//   tier4 legs            : 137 com EV<0 (min -79.82%)
//   bet_builder_light legs: 17 com EV<0 (min -35.49%)
//   TOTAL                 : 316 legs com EV negativo
//
// EV<0 significa perda matemática esperada. Picks com EV<0 NÃO podem ser
// recomendados como "tip" mesmo se vierem do devig direto — o devig só
// remove a margem do livro, NÃO garante EV positivo (depende da seleção).
//
// POLÍTICA R6K-D:
//
// EV gate:
//   - PASSA se ev_pct é número finito > 0
//   - PASSA se exempt (faixa_mirror — tipster history validated)
//   - FALHA em qualquer outro caso (incluindo _is_direct_b365 com EV<=0)
//
// Prob gate:
//   - PASSA se prob >= minProb (default 0.45)
//   - PASSA se exempt (faixa_mirror)
//   - FALHA em qualquer outro caso
//
// NÃO altera:
//   - score, tier, ranking, scoring algorithm
//   - hasNoHighRisk filter (separado, gate de market high-risk)
//   - hasEvidence filter (Gate B, usa _is_direct_b365 como evidência válida —
//     preservado intencionalmente: bet365_direct É sinal de market real)
//   - stake sanitize / lab_mode
//   - thresholds comerciais
// ══════════════════════════════════════════════════════════════════════════

/**
 * Valor de prob mínima padrão para Gate de probabilidade.
 * Espelha o comportamento histórico do filter no premiumPicks.js.
 */
export const MIN_PROB_DEFAULT = 0.45;

/**
 * Verifica se um valor é EV positivo válido (número finito > 0).
 *
 * @param {*} value
 * @returns {boolean}
 */
export function hasPositiveEvValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return n > 0;
}

/**
 * Decide se um pick é exempt do EV/prob gate (exceções de policy validadas
 * pelo histórico FAIXA VIP tipster). _is_direct_b365 NÃO é exempt.
 *
 * @param {object|null} p
 * @returns {boolean}
 */
export function isExemptFromEvPolicy(p) {
  if (!p || typeof p !== 'object') return false;
  if (p._is_faixa_mirror === true) return true;
  if (p.source === 'faixa_mirror') return true;
  return false;
}

/**
 * Gate de EV para o pipeline tier1Raw em premiumPicks.js.
 *
 * @param {object|null} p — pick com pelo menos { ev_pct, _is_faixa_mirror, source }
 * @returns {boolean} true se passa pelo gate
 */
export function passesPremiumEvGate(p) {
  if (!p || typeof p !== 'object') return false;
  // Exceções de policy validadas (faixa_mirror). NUNCA libera _is_direct_b365
  // com EV negativo.
  if (isExemptFromEvPolicy(p)) return true;
  return hasPositiveEvValue(p.ev_pct);
}

/**
 * Gate de probabilidade. Mesma estrutura do EV gate — exceções
 * faixa_mirror passam; _is_direct_b365 NÃO bypass.
 *
 * @param {object|null} p — pick com pelo menos { prob }
 * @param {object} [opts]
 * @param {number} [opts.minProb=0.45]
 * @returns {boolean}
 */
export function passesPremiumProbGate(p, opts = {}) {
  if (!p || typeof p !== 'object') return false;
  if (isExemptFromEvPolicy(p)) return true;
  const minProb = Number.isFinite(opts.minProb) ? opts.minProb : MIN_PROB_DEFAULT;
  const prob = Number(p.prob);
  if (!Number.isFinite(prob)) return false;
  return prob >= minProb;
}

// ══════════════════════════════════════════════════════════════════════════
// R6K-D2 — combo-level EV policy
// ══════════════════════════════════════════════════════════════════════════
//
// CONTEXTO: o R6K-D saneou tier1Raw (Daily Singles) mas combos (tier2/3/4,
// bet_builder) são construídos por pools paralelos que não passam pelo
// mesmo filter. Evidência baseline pós R6K-D:
//
//   tier2 legs com EV<0  : 44
//   tier3 legs com EV<0  : 114
//   tier4 legs com EV<0  : 137
//   bb_light legs com EV<0: 17
//   TOTAL                : 312 legs com EV<0 dentro de combos
//
// Existe cenário documentado em produção: combo.ev_pct AGREGADO é positivo,
// mas leg individual tem ev_pct negativo. O usuário vê a leg com EV<0 no
// detalhe do combo → percebe como "tip ruim". Política R6K-D2 prioriza
// UX: se QUALQUER leg user-facing tiver EV<0 e não for exempt, o combo
// inteiro é bloqueado.
//
// ATENÇÃO: leg com ev_pct=0 (neutro/devigged) NÃO bloqueia. Apenas ev_pct
// estritamente < 0. Isso preserva combos legítimos onde algumas legs são
// "âncoras" devigged sem EV positivo declarado.

/**
 * Extrai array de legs de um combo de forma defensiva. Aceita combo com
 * shape heterogêneo (legs ausente, legs null, legs não-array).
 *
 * @param {object|null} combo
 * @returns {Array}
 */
export function extractComboLegs(combo) {
  if (!combo || typeof combo !== 'object') return [];
  const legs = combo.legs;
  if (!Array.isArray(legs)) return [];
  return legs.filter(l => l && typeof l === 'object');
}

/**
 * Detecta se um combo tem pelo menos UMA leg com ev_pct estritamente
 * negativo E que NÃO é faixa_mirror exempt.
 *
 * @param {object|null} combo
 * @returns {boolean}
 */
export function hasNegativeEvLeg(combo) {
  const legs = extractComboLegs(combo);
  for (const leg of legs) {
    if (isExemptFromEvPolicy(leg)) continue;
    const ev = Number(leg.ev_pct);
    if (Number.isFinite(ev) && ev < 0) return true;
  }
  return false;
}

/**
 * Política R6K-D2: combo passa se NÃO tem leg user-facing com EV<0.
 *
 * Regras detalhadas:
 *   - PASS se nenhuma leg tiver ev_pct estritamente negativo (não-exempt)
 *   - PASS se combo sem legs (defensive — não é "tip ruim", apenas vazio)
 *   - PASS se todas as legs com EV<0 são faixa_mirror exempt
 *   - FAIL se pelo menos UMA leg user-facing tem ev_pct<0 sem exception
 *
 * Importante:
 *   - leg.ev_pct = 0 NÃO bloqueia (devigged neutro é OK)
 *   - leg.ev_pct = null/undefined/NaN NÃO bloqueia (sem info ≠ ruim)
 *   - apenas Number.isFinite e < 0 dispara o block
 *   - _is_direct_b365 NÃO é exempt (key R6K-D heritage)
 *
 * @param {object|null} combo
 * @returns {boolean}
 */
export function passesPremiumComboEvPolicy(combo) {
  if (!combo || typeof combo !== 'object') return false;
  return !hasNegativeEvLeg(combo);
}
