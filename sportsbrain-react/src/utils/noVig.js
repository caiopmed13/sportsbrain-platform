// ═══════════════════════════════════════════════════════════════════════════
// No-Vig de Mercado — Fase 2
// ═══════════════════════════════════════════════════════════════════════════
// Remove a margem (overround) do book pra extrair a "prob real" implícita.
// Pinnacle/Betfair Exchange são considerados sharp (prob no-vig ≈ verdade do mercado).
//
// Usar como benchmark: se nossa prob bate prob no-vig dentro de ±2pp, NÃO TEM EDGE.
// Edge real só quando nossa prob > no-vig + 3pp (3 pontos percentuais).
//
// Métodos suportados:
//   • basic (proportional)         — divide cada prob implícita pela soma
//   • shin (assume informed traders)— mais preciso em mercados líquidos 1X2
//   • power (Wisdom of crowd)       — robusto a outliers
//
// API:
//   noVigFromOdds(oddArr, method='basic') → { probs: [...], overround }
//   compareToNoVig(pModel, fairProb)      → { gap, isFakeEdge, isRealEdge }
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Remove vig por método proporcional (mais simples e usado).
 * @param {number[]} odds  [oddH, oddD, oddA] ou [oddYes, oddNo] etc.
 * @returns {{probs:number[], overround:number, fair:number[]}}
 */
export function noVigBasic(odds) {
  const valid = odds.filter(o => o && o > 1)
  if (valid.length < 2) return { probs: [], overround: 0, fair: [] }
  const implied = odds.map(o => (o && o > 1) ? 1 / o : 0)
  const sum = implied.reduce((a, b) => a + b, 0)
  if (sum <= 0) return { probs: [], overround: 0, fair: [] }
  const fair = implied.map(p => p / sum)
  return {
    probs: fair,
    fair,
    overround: +(sum - 1).toFixed(4),  // margem do book (vig)
  }
}

/**
 * Método Shin — assume traders informados, mais preciso em 1X2 líquido.
 * Resolve z numericamente (Newton's). Pra 2-way reduz pro basic.
 * @param {number[]} odds
 */
export function noVigShin(odds) {
  const valid = odds.filter(o => o && o > 1)
  if (valid.length < 2) return noVigBasic(odds)
  const implied = odds.map(o => (o && o > 1) ? 1 / o : 0)
  const sumP = implied.reduce((a, b) => a + b, 0)
  if (sumP <= 1.001 || valid.length < 3) return noVigBasic(odds)
  // z = fração de informed traders (Shin 1992)
  // Aproximação para 3-way: z ≈ ((sumP-1) * (n-1)) / (n - sumP*z) — iterativo
  let z = (sumP - 1) / sumP
  for (let i = 0; i < 12; i++) {
    const denom = implied.reduce((acc, p) => {
      const inner = z * z + 4 * (1 - z) * p * p / sumP
      return acc + Math.sqrt(Math.max(0, inner))
    }, 0)
    const newZ = (denom - 2) / (valid.length - 2)
    if (Math.abs(newZ - z) < 1e-6) break
    z = Math.max(0, Math.min(0.5, newZ))
  }
  const fair = implied.map(p => {
    const inner = z * z + 4 * (1 - z) * p * p / sumP
    return (Math.sqrt(Math.max(0, inner)) - z) / (2 * (1 - z))
  })
  const sumFair = fair.reduce((a, b) => a + b, 0)
  const norm = sumFair > 0 ? fair.map(p => p / sumFair) : fair
  return {
    probs: norm,
    fair: norm,
    overround: +(sumP - 1).toFixed(4),
    method: 'shin',
    z: +z.toFixed(4),
  }
}

/**
 * Compara prob do modelo com no-vig do mercado.
 * @param {number} pModel    Probabilidade do nosso modelo (0..1)
 * @param {number} pFair     Probabilidade no-vig (0..1)
 * @returns {{gap:number, gapPct:number, isFakeEdge:boolean, isRealEdge:boolean, classification:string}}
 */
export function compareToNoVig(pModel, pFair) {
  if (pModel == null || pFair == null) {
    return { gap: 0, gapPct: 0, isFakeEdge: false, isRealEdge: false, classification: 'unknown' }
  }
  const gap = pModel - pFair                 // pp em decimal
  const gapPct = +(gap * 100).toFixed(2)     // pp absoluto
  const isFakeEdge = gap > 0 && gap < 0.03   // edge < 3pp = ruído/vig
  const isRealEdge = gap >= 0.03             // ≥3pp acima do mercado real
  let classification
  if (gap >= 0.05)        classification = 'sharp_edge'        // ≥5pp — possível alpha
  else if (gap >= 0.03)   classification = 'real_edge'         // 3–5pp — edge real
  else if (gap >= 0.005)  classification = 'fake_edge'         // 0.5–3pp — vig disfarçado
  else if (gap >= -0.02)  classification = 'aligned_with_book' // -2..+0.5pp — mercado eficiente
  else                    classification = 'against_book'      // book diz outra coisa
  return { gap, gapPct, isFakeEdge, isRealEdge, classification }
}

/**
 * Helper: dado gameOdds {h,d,a} do oddsEdge.matchOddsForGame,
 * devolve probs no-vig {pH, pD, pA, overround}.
 */
export function noVigFromGameOdds(gameOdds) {
  if (!gameOdds) return null
  const odds = [gameOdds.h, gameOdds.d, gameOdds.a].filter(Boolean)
  if (odds.length < 2) return null
  const arr = [gameOdds.h || 0, gameOdds.d || 0, gameOdds.a || 0]
  const r = noVigBasic(arr)
  if (!r.probs?.length) return null
  return {
    pH: arr[0] ? r.probs[0] : null,
    pD: arr[1] ? r.probs[1] : null,
    pA: arr[2] ? r.probs[2] : null,
    overround: r.overround,
  }
}

/**
 * Helper: BTTS / Over 2-way (sim/não)
 */
export function noVigTwoWay(oddYes, oddNo) {
  if (!oddYes || !oddNo) return null
  const r = noVigBasic([oddYes, oddNo])
  return {
    pYes: r.probs[0] ?? null,
    pNo:  r.probs[1] ?? null,
    overround: r.overround,
  }
}
