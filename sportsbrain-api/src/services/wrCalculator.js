// ══════════════════════════════════════════════════════════════════════════
// WR Calculator — P3.9 R6K-F3
// ══════════════════════════════════════════════════════════════════════════
//
// Funções puras para computar WR (win rate), ROI, streak e agregação por
// odd bucket / origem / método / tier sobre rows de pick_history.
//
// Conceitos:
//   row.result ∈ {'W', 'L', 'P' (push/void), null/'PENDING'}
//   profit_unit é unidade de stake (1u = 1% banca por convenção).
//   Para WR, pushes contam nem como win nem como loss (denom exclui).
//   Para ROI, profit_unit é somado e dividido pela stake total (1u por bet).
//
// ODD_BUCKETS armazena breakeven implícito por faixa de odd. Convergência
// (convergenceMetric.js) usa para calcular margem vs breakeven por bucket.
//
// NÃO altera ranking, scoring, threshold global, motor de picks.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Buckets de odd com breakeven WR implícito. Inclusivo no min, exclusivo no
 * max (exceto último que é catch-all). Frozen para evitar mutação.
 *
 * Breakeven = 1/odd_média_aproximada — define o piso de WR para ROI=0.
 */
export const ODD_BUCKETS = Object.freeze([
  { id: '1.0-1.5', min: 1.0, max: 1.5,   breakeven: 0.67 },
  { id: '1.5-2.0', min: 1.5, max: 2.0,   breakeven: 0.57 },
  { id: '2.0-3.0', min: 2.0, max: 3.0,   breakeven: 0.40 },
  { id: '3.0-5.0', min: 3.0, max: 5.0,   breakeven: 0.25 },
  { id: '5.0-10',  min: 5.0, max: 10.0,  breakeven: 0.15 },
  { id: '10-50',   min: 10.0, max: 50.0, breakeven: 0.05 },
  { id: '50+',     min: 50.0, max: 1e9,  breakeven: 0.02 },
]);

/**
 * Normaliza o result de uma row.
 *
 * @param {*} raw
 * @returns {'W'|'L'|'P'|'PENDING'}
 */
export function normalizeResult(raw) {
  if (raw == null) return 'PENDING';
  const s = String(raw).trim().toUpperCase();
  if (s === 'W' || s === 'WIN'  || s === 'GREEN') return 'W';
  if (s === 'L' || s === 'LOSS' || s === 'RED')   return 'L';
  if (s === 'P' || s === 'V' || s === 'PUSH' || s === 'VOID') return 'P';
  return 'PENDING';
}

/**
 * Computa win rate (W / (W+L)). Pushes excluídos do denominador.
 *
 * @param {Array<object>} rows
 * @returns {{ wr: number, wins: number, losses: number, pushes: number, settled: number, n: number, pending: number }}
 */
export function computeWR(rows) {
  if (!Array.isArray(rows)) return { wr: 0, wins: 0, losses: 0, pushes: 0, settled: 0, n: 0, pending: 0 };
  let wins = 0, losses = 0, pushes = 0, pending = 0;
  for (const r of rows) {
    const rr = normalizeResult(r?.result);
    if (rr === 'W') wins++;
    else if (rr === 'L') losses++;
    else if (rr === 'P') pushes++;
    else pending++;
  }
  const settled = wins + losses;
  const wr = settled > 0 ? wins / settled : 0;
  return { wr, wins, losses, pushes, settled, n: rows.length, pending };
}

/**
 * Computa ROI sobre rows settled (W ou L). 1u stake assumido por bet.
 * profit_unit esperado: +odd-1 quando W, -1 quando L, 0 quando P.
 *
 * Para rows sem profit_unit explícito, computa derivado do result/odd:
 *   W → (odd - 1)
 *   L → -1
 *   P → 0
 *
 * @param {Array<object>} rows
 * @returns {{ roi: number, profit_total: number, stake_total: number, settled: number }}
 */
export function computeROI(rows) {
  if (!Array.isArray(rows)) return { roi: 0, profit_total: 0, stake_total: 0, settled: 0 };
  let profit = 0;
  let stake = 0;
  for (const r of rows) {
    const rr = normalizeResult(r?.result);
    if (rr === 'PENDING') continue;
    stake += 1;
    if (r.profit_unit != null && Number.isFinite(Number(r.profit_unit))) {
      profit += Number(r.profit_unit);
    } else {
      const odd = Number(r?.real_odd ?? r?.odd ?? 0);
      if (rr === 'W' && Number.isFinite(odd) && odd > 1) profit += (odd - 1);
      else if (rr === 'L') profit -= 1;
      // push (P) → 0
    }
  }
  const roi = stake > 0 ? profit / stake : 0;
  return { roi, profit_total: profit, stake_total: stake, settled: stake };
}

/**
 * Agrupa rows por uma chave (key) extraída de cada row. Aceita callback ou
 * string nomeando o campo.
 *
 * @param {Array<object>} rows
 * @param {string|Function} keyOrFn
 * @returns {Map<string, object[]>}
 */
export function groupBy(rows, keyOrFn) {
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  const fn = typeof keyOrFn === 'function'
    ? keyOrFn
    : (row) => row?.[keyOrFn];
  for (const r of rows) {
    const k = fn(r);
    if (k == null) continue;
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/**
 * Aplica computeWR/computeROI em cada grupo retornando um dicionário.
 *
 * @param {Array<object>} rows
 * @param {string|Function} keyOrFn
 * @returns {Object<string, {wr,roi,n,wins,losses,settled,...}>}
 */
export function computeWRByGroup(rows, keyOrFn) {
  const groups = groupBy(rows, keyOrFn);
  const out = {};
  for (const [k, arr] of groups.entries()) {
    const wr = computeWR(arr);
    const roi = computeROI(arr);
    out[k] = { ...wr, roi: roi.roi, profit_unit: roi.profit_total };
  }
  return out;
}

/**
 * Determina o bucket de uma odd. Retorna { id, breakeven } ou null.
 *
 * @param {number} odd
 * @returns {{id: string, min: number, max: number, breakeven: number}|null}
 */
export function bucketForOdd(odd) {
  const o = Number(odd);
  if (!Number.isFinite(o) || o < 1) return null;
  for (const b of ODD_BUCKETS) {
    if (o >= b.min && o < b.max) return b;
  }
  return null;
}

/**
 * Agrega rows por odd bucket, computa WR/ROI por bucket e margin vs
 * breakeven.
 *
 * @param {Array<object>} rows
 * @returns {Object<string, {wr,n,breakeven,margin_vs_breakeven,...}>}
 */
export function computeWRByOddBucket(rows) {
  if (!Array.isArray(rows)) return {};
  const map = new Map();
  for (const r of rows) {
    const odd = r?.real_odd ?? r?.odd;
    const b = bucketForOdd(odd);
    if (!b) continue;
    const arr = map.get(b.id);
    if (arr) arr.push(r);
    else map.set(b.id, [r]);
  }
  const out = {};
  for (const b of ODD_BUCKETS) {
    const arr = map.get(b.id) || [];
    const wr = computeWR(arr);
    const roi = computeROI(arr);
    out[b.id] = {
      ...wr,
      roi: roi.roi,
      profit_unit: roi.profit_total,
      breakeven: b.breakeven,
      margin_vs_breakeven: wr.settled > 0 ? wr.wr - b.breakeven : null,
    };
  }
  return out;
}

/**
 * Calcula streak atual e máxima de wins consecutivos.
 *
 * Assume rows ordenadas cronologicamente (idx 0 = mais antigo).
 *
 * @param {Array<object>} rowsOrdered
 * @returns {{ current: number, max: number, current_loss: number, max_loss: number }}
 */
export function computeStreak(rowsOrdered) {
  if (!Array.isArray(rowsOrdered)) return { current: 0, max: 0, current_loss: 0, max_loss: 0 };
  let curW = 0, maxW = 0;
  let curL = 0, maxL = 0;
  for (const r of rowsOrdered) {
    const rr = normalizeResult(r?.result);
    if (rr === 'W') {
      curW++;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (rr === 'L') {
      curL++;
      curW = 0;
      if (curL > maxL) maxL = curL;
    } else if (rr === 'P') {
      // push interrompe ambas
      curW = 0;
      curL = 0;
    }
    // PENDING não afeta streak nem reset (apenas ignora)
  }
  return { current: curW, max: maxW, current_loss: curL, max_loss: maxL };
}
