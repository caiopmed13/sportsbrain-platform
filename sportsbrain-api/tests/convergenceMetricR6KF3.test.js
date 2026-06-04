// tests/convergenceMetricR6KF3.test.js — P3.9 R6K-F3
// Cobre o ajuste #3: verdict calibration é INFORMATIVA abaixo de n=30.

import { describe, it, expect } from 'vitest';
import {
  CONVERGENCE_TARGET,
  expectedWrFromRows,
  computeVerdictCalibration,
  computeConvergence,
} from '../src/services/convergenceMetric.js';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — CONVERGENCE_TARGET', () => {
  it('alvos esperados', () => {
    expect(CONVERGENCE_TARGET.min_sample_total).toBe(300);
    expect(CONVERGENCE_TARGET.window_days).toBe(30);
    expect(CONVERGENCE_TARGET.min_roi_pct).toBe(0);
    expect(CONVERGENCE_TARGET.min_wr_margin_vs_breakeven).toBe(0.04);
    expect(CONVERGENCE_TARGET.verdict_calibration_min_sample).toBe(30);
  });

  it('é frozen', () => {
    expect(Object.isFrozen(CONVERGENCE_TARGET)).toBe(true);
  });
});

describe('R6K-F3 — expectedWrFromRows', () => {
  it('rows com ev/odd válidos retorna expected_wr', () => {
    const r = expectedWrFromRows([
      { ev_pct: 5, odd: 2.0 },
      { ev_pct: 5, odd: 2.0 },
    ]);
    expect(r.expected_wr).toBeCloseTo((1 + 0.05) / 2.0, 6);
    expect(r.avg_ev_pct).toBe(5);
    expect(r.avg_odd).toBe(2.0);
  });

  it('aceita ev_real / real_odd como fallback', () => {
    const r = expectedWrFromRows([{ ev_real: 10, real_odd: 3 }]);
    expect(r.avg_ev_pct).toBe(10);
    expect(r.avg_odd).toBe(3);
  });

  it('rows sem ev ou odd → null', () => {
    expect(expectedWrFromRows([{ ev_pct: 5 }])).toBeNull();
    expect(expectedWrFromRows([{ odd: 2 }])).toBeNull();
  });

  it('rows vazia → null', () => {
    expect(expectedWrFromRows([])).toBeNull();
  });

  it('null/non-array → null', () => {
    expect(expectedWrFromRows(null)).toBeNull();
  });
});

describe('R6K-F3 — computeVerdictCalibration (AJUSTE #3)', () => {
  it('verdict com n<30 → status=insufficient_sample (NÃO blocker)', () => {
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ math_verdict: 'gold', result: 'W', odd: 2.0, ev_pct: 10 });
    const cal = computeVerdictCalibration(rows);
    expect(cal.gold.status).toBe('insufficient_sample');
    expect(cal.gold.n).toBe(10);
  });

  it('verdict com n>=30 e bem-calibrado → status=calibrated', () => {
    const rows = [];
    // gold: ev_pct=5 e odd=2.0 → expected_wr = (1+0.05)/2 = 0.525
    // Geramos 32 rows com WR perto de 0.5 (16W + 16L)
    for (let i = 0; i < 16; i++) rows.push({ math_verdict: 'gold', result: 'W', odd: 2.0, ev_pct: 5 });
    for (let i = 0; i < 16; i++) rows.push({ math_verdict: 'gold', result: 'L', odd: 2.0, ev_pct: 5 });
    const cal = computeVerdictCalibration(rows);
    expect(cal.gold.n).toBe(32);
    expect(cal.gold.status).toBe('calibrated');
    expect(Math.abs(cal.gold.error)).toBeLessThan(0.10);
  });

  it('verdict com n>=30 e MAL calibrado → status=miscalibrated', () => {
    const rows = [];
    // gold: ev_pct=20 odd=2.0 → expected = 0.60
    // Mas WR observado = 1/30 = 0.033 → erro absoluto >> 0.10
    for (let i = 0; i < 1; i++) rows.push({ math_verdict: 'gold', result: 'W', odd: 2.0, ev_pct: 20 });
    for (let i = 0; i < 29; i++) rows.push({ math_verdict: 'gold', result: 'L', odd: 2.0, ev_pct: 20 });
    const cal = computeVerdictCalibration(rows);
    expect(cal.gold.n).toBe(30);
    expect(cal.gold.status).toBe('miscalibrated');
  });

  it('verdict sem dados → insufficient_sample', () => {
    const cal = computeVerdictCalibration([]);
    for (const v of ['gold', 'value', 'fair', 'trap']) {
      expect(cal[v].status).toBe('insufficient_sample');
      expect(cal[v].n).toBe(0);
    }
  });

  it('pushes excluídos do denominador da calibração', () => {
    const rows = [];
    for (let i = 0; i < 16; i++) rows.push({ math_verdict: 'value', result: 'W', odd: 2.0, ev_pct: 5 });
    for (let i = 0; i < 16; i++) rows.push({ math_verdict: 'value', result: 'L', odd: 2.0, ev_pct: 5 });
    for (let i = 0; i < 10; i++) rows.push({ math_verdict: 'value', result: 'P', odd: 2.0, ev_pct: 5 });
    const cal = computeVerdictCalibration(rows);
    expect(cal.value.n).toBe(32);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — computeConvergence: cenários principais', () => {
  function buildRows({ n, wr, oddMean = 2.0, evMean = 5 }) {
    const wins = Math.round(n * wr);
    const losses = n - wins;
    const rows = [];
    for (let i = 0; i < wins; i++)   rows.push({ result: 'W', odd: oddMean, ev_pct: evMean });
    for (let i = 0; i < losses; i++) rows.push({ result: 'L', odd: oddMean, ev_pct: evMean });
    return rows;
  }

  it('sample < 300 → ready=false, blocker low_sample', () => {
    const c = computeConvergence(buildRows({ n: 100, wr: 0.6 }));
    expect(c.ready).toBe(false);
    expect(c.blockers.some(b => b.type === 'low_sample')).toBe(true);
  });

  it('sample >= 300 + ROI > 0 + bucket margin ok → ready=true', () => {
    // 300 rows @odd 2.0, wr=0.6 → ROI = +0.20, breakeven bucket 1.5-2.0 = 0.57
    // margem = 0.60 - 0.57 = 0.03 — abaixo do 0.04 default, vira blocker.
    // Vamos forçar wr=0.62 para garantir margem ok.
    const c = computeConvergence(buildRows({ n: 300, wr: 0.62 }));
    expect(c.ready).toBe(true);
    expect(c.blockers).toEqual([]);
  });

  it('sample >= 300 + ROI <= 0 → ready=false, blocker negative_or_zero_roi', () => {
    // wr=0.4 @odd 2.0 → ROI = 0.4*1 + 0.6*-1 = -0.2
    const c = computeConvergence(buildRows({ n: 300, wr: 0.4 }));
    expect(c.ready).toBe(false);
    expect(c.blockers.some(b => b.type === 'negative_or_zero_roi')).toBe(true);
  });

  it('bucket com margin abaixo de 0.04 → blocker bucket_margin_low', () => {
    // odd 1.9 cai no bucket 1.5-2.0 (breakeven=0.57). wr=0.58 → margem=0.01<0.04.
    // ROI = 0.58*(1.9-1) - 0.42 = 0.522 - 0.42 = +0.102 (positivo, passa ROI gate)
    const c = computeConvergence(buildRows({ n: 300, wr: 0.58, oddMean: 1.9 }));
    const blocker = c.blockers.find(b => b.type === 'bucket_margin_low');
    expect(blocker).toBeTruthy();
  });

  it('buckets sub-povoados (<10 rows) ignorados', () => {
    // 5 rows odd 100, 295 rows odd 2.0 — bucket 50+ tem 5 só → ignora
    const rows = [
      ...buildRows({ n: 295, wr: 0.62, oddMean: 2.0 }),
      ...buildRows({ n: 5, wr: 0.0, oddMean: 100 }),
    ];
    const c = computeConvergence(rows);
    // 50+ bucket NÃO deve gerar blocker
    expect(c.blockers.filter(b => b.type === 'bucket_margin_low' && b.bucket === '50+')).toEqual([]);
  });

  it('AJUSTE #3: verdict gold com n<30 NÃO entra em blockers', () => {
    const rows = buildRows({ n: 300, wr: 0.62 });
    // adiciona 5 rows com math_verdict='gold' mas WR ruim
    for (let i = 0; i < 5; i++) rows.push({ math_verdict: 'gold', result: 'L', odd: 10, ev_pct: 50 });
    const c = computeConvergence(rows);
    // verdict_calibration.gold deve ter status insufficient_sample
    expect(c.verdict_calibration.gold.status).toBe('insufficient_sample');
    // blockers NÃO devem incluir verdict_miscalibrated para gold
    expect(c.blockers.find(b => b.type === 'verdict_miscalibrated' && b.verdict === 'gold')).toBeUndefined();
  });

  it('AJUSTE #3: verdict trap com n>=30 e miscalibrated → entra em blockers', () => {
    // base de 300 rows boas, mas trap com 30 amostras e wr ruim vs ev
    const rows = buildRows({ n: 300, wr: 0.62 });
    for (let i = 0; i < 30; i++) {
      rows.push({ math_verdict: 'trap', result: 'L', odd: 2.0, ev_pct: 20 });
    }
    const c = computeConvergence(rows);
    expect(c.verdict_calibration.trap.status).toBe('miscalibrated');
    expect(c.blockers.some(b => b.type === 'verdict_miscalibrated' && b.verdict === 'trap')).toBe(true);
    expect(c.ready).toBe(false);
  });

  it('rows vazia → ready=false com low_sample', () => {
    const c = computeConvergence([]);
    expect(c.ready).toBe(false);
    expect(c.blockers.some(b => b.type === 'low_sample')).toBe(true);
  });

  it('null/non-array → tratado como vazia', () => {
    const c = computeConvergence(null);
    expect(c.ready).toBe(false);
    expect(c.sample_total).toBe(0);
  });

  it('opts.target override permite testar com sample menor', () => {
    const c = computeConvergence(buildRows({ n: 50, wr: 0.62 }), {
      target: { min_sample_total: 50 },
    });
    expect(c.ready).toBe(true);
  });
});

describe('R6K-F3 — convergence retorna shape completo', () => {
  it('payload retornado tem todas as chaves documentadas', () => {
    const c = computeConvergence([{ result: 'W', odd: 2.0, ev_pct: 5 }]);
    expect(c).toHaveProperty('ready');
    expect(c).toHaveProperty('sample_total');
    expect(c).toHaveProperty('wr');
    expect(c).toHaveProperty('roi_pct');
    expect(c).toHaveProperty('wr_by_bucket');
    expect(c).toHaveProperty('verdict_calibration');
    expect(c).toHaveProperty('blockers');
    expect(c).toHaveProperty('target');
  });
});
