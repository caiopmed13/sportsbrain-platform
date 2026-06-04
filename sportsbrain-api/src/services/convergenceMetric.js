// ══════════════════════════════════════════════════════════════════════════
// Convergence Metric — P3.9 R6K-F3
// ══════════════════════════════════════════════════════════════════════════
//
// Computa se a IA do Premium "convergiu" — i.e., se tem amostra/WR/ROI
// suficiente para justificar uma futura ativação comercial. NUNCA ativa
// nada automaticamente; só sinaliza ready=true/false.
//
// CRITÉRIOS:
//   - sample_total ≥ 300
//   - window_days = 30 (janela de avaliação)
//   - roi_pct > 0
//   - WR por odd bucket > breakeven + 4pp (margin_vs_breakeven >= 0.04)
//   - verdict_calibration por math_verdict:
//       AJUSTE OBRIGATÓRIO (#3 do operador):
//         se n < 30 por verdict → status = "insufficient_sample"
//                                  NÃO entra em blockers (informativo)
//         se n >= 30            → avaliar observed_wr vs expected_wr
//                                  derivado do ev_pct médio do bucket
//                                  - se calibrado: status = "calibrated"
//                                  - se mal-calibrado: blocker
//
// Ready = true requer SEM blockers AND sample_total >= 300 AND roi > 0.
// Verdict calibration informativa não bloqueia auto-sustentável abaixo de
// n=30 por verdict.
//
// NÃO ativa beta/sell/micro_test. Só GET.
// ══════════════════════════════════════════════════════════════════════════

import {
  computeWR,
  computeROI,
  computeWRByOddBucket,
  groupBy,
} from './wrCalculator.js';

/**
 * Alvos de convergência. Frozen.
 */
export const CONVERGENCE_TARGET = Object.freeze({
  min_sample_total:                 300,
  window_days:                      30,
  min_roi_pct:                      0,
  min_wr_margin_vs_breakeven:       0.04,
  verdict_calibration_min_sample:   30,
  verdict_calibration_max_error:    0.10, // erro absoluto max permitido (10pp)
});

/**
 * Expected WR aproximada para um conjunto de rows derivada do ev_pct médio
 * e da odd média. expected_wr = (1 + ev_pct_avg/100) / odd_avg.
 *
 * Defensive — retorna null se faltar info.
 *
 * @param {object[]} rows
 * @returns {{ expected_wr: number, avg_ev_pct: number, avg_odd: number }|null}
 */
export function expectedWrFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let sumEv = 0, sumOdd = 0, n = 0;
  for (const r of rows) {
    const ev = Number(r?.ev_real ?? r?.ev_pct);
    const odd = Number(r?.real_odd ?? r?.odd);
    if (!Number.isFinite(ev) || !Number.isFinite(odd) || odd <= 1) continue;
    sumEv += ev;
    sumOdd += odd;
    n++;
  }
  if (n === 0) return null;
  const avg_ev_pct = sumEv / n;
  const avg_odd = sumOdd / n;
  const expected_wr = (1 + avg_ev_pct / 100) / avg_odd;
  return { expected_wr, avg_ev_pct, avg_odd };
}

/**
 * Calibração por math_verdict bucket (gold/value/fair/trap).
 * Retorna o status e os números — NÃO computa blockers (chamador decide).
 *
 * @param {object[]} rows — rows com math_verdict
 * @param {object} [opts]
 * @returns {Object<string, {n, observed_wr, expected_wr, error, status}>}
 */
export function computeVerdictCalibration(rows, opts = {}) {
  const minSample = opts.minSample ?? CONVERGENCE_TARGET.verdict_calibration_min_sample;
  const maxError  = opts.maxError  ?? CONVERGENCE_TARGET.verdict_calibration_max_error;
  const VERDICTS  = ['gold', 'value', 'fair', 'trap'];
  const out = {};
  const groups = groupBy(rows, 'math_verdict');
  for (const v of VERDICTS) {
    const arr = groups.get(v) || [];
    const wr = computeWR(arr);
    const exp = expectedWrFromRows(arr);
    if (wr.settled < minSample) {
      // AJUSTE #3: amostra insuficiente → status informativo, sem block
      out[v] = {
        n: wr.settled,
        observed_wr: wr.settled > 0 ? wr.wr : null,
        expected_wr: exp?.expected_wr ?? null,
        error: null,
        status: 'insufficient_sample',
      };
      continue;
    }
    if (!exp) {
      out[v] = {
        n: wr.settled,
        observed_wr: wr.wr,
        expected_wr: null,
        error: null,
        status: 'no_expected_baseline',
      };
      continue;
    }
    const err = wr.wr - exp.expected_wr;
    const calibrated = Math.abs(err) <= maxError;
    out[v] = {
      n: wr.settled,
      observed_wr: wr.wr,
      expected_wr: exp.expected_wr,
      error: err,
      status: calibrated ? 'calibrated' : 'miscalibrated',
    };
  }
  return out;
}

/**
 * Avalia se rows convergiram para auto-sustentável (NÃO ativa nada).
 *
 * @param {object[]} rows30d — rows da janela de avaliação (já filtradas)
 * @param {object} [opts] — override de targets para testes
 * @returns {object}
 */
export function computeConvergence(rows30d, opts = {}) {
  const target = { ...CONVERGENCE_TARGET, ...(opts.target || {}) };
  const blockers = [];
  const safeRows = Array.isArray(rows30d) ? rows30d : [];

  const overallWr = computeWR(safeRows);
  const overallRoi = computeROI(safeRows);
  const sample_total = overallWr.settled;

  // Blocker 1: sample baixo
  if (sample_total < target.min_sample_total) {
    blockers.push({
      type: 'low_sample',
      message: `sample_total ${sample_total} < target ${target.min_sample_total}`,
    });
  }

  // Blocker 2: ROI negativo (só relevante se temos sample)
  if (sample_total > 0 && overallRoi.roi <= target.min_roi_pct) {
    blockers.push({
      type: 'negative_or_zero_roi',
      message: `roi ${(overallRoi.roi * 100).toFixed(2)}% <= ${target.min_roi_pct}`,
    });
  }

  // WR por odd bucket
  const wr_by_bucket = computeWRByOddBucket(safeRows);

  // Blocker 3: buckets com margem insuficiente (apenas onde temos sample suficiente)
  for (const [bucketId, b] of Object.entries(wr_by_bucket)) {
    if (b.settled < 10) continue; // bucket sub-povoado: ignora
    if (b.margin_vs_breakeven == null) continue;
    if (b.margin_vs_breakeven < target.min_wr_margin_vs_breakeven) {
      blockers.push({
        type: 'bucket_margin_low',
        bucket: bucketId,
        message: `bucket ${bucketId}: wr ${(b.wr * 100).toFixed(1)}% (margem ${(b.margin_vs_breakeven * 100).toFixed(1)}pp)`,
      });
    }
  }

  // Calibration por math_verdict (ajuste #3: insufficient_sample = informativo)
  const verdict_calibration = computeVerdictCalibration(safeRows, {
    minSample: target.verdict_calibration_min_sample,
    maxError:  target.verdict_calibration_max_error,
  });

  // Blocker 4: verdict mal-calibrado COM amostra suficiente (n>=30)
  for (const [v, cal] of Object.entries(verdict_calibration)) {
    if (cal.status === 'miscalibrated') {
      blockers.push({
        type: 'verdict_miscalibrated',
        verdict: v,
        message: `verdict ${v}: observed ${(cal.observed_wr * 100).toFixed(1)}% vs expected ${(cal.expected_wr * 100).toFixed(1)}% (err ${(cal.error * 100).toFixed(1)}pp, n=${cal.n})`,
      });
    }
    // status='insufficient_sample' → NÃO entra em blockers
  }

  const ready = blockers.length === 0
    && sample_total >= target.min_sample_total
    && overallRoi.roi > target.min_roi_pct;

  return {
    ready,
    sample_total,
    settled:           overallWr.settled,
    pending:           overallWr.pending,
    wins:              overallWr.wins,
    losses:            overallWr.losses,
    pushes:            overallWr.pushes,
    wr:                overallWr.wr,
    roi_pct:           overallRoi.roi,
    wr_by_bucket,
    verdict_calibration,
    blockers,
    target,
  };
}
