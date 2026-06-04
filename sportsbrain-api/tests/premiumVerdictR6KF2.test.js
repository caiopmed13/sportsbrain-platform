// tests/premiumVerdictR6KF2.test.js — P3.9 R6K-F2
// Cobre computeMathVerdict, computeDesignVerdict, annotateVerdict e helpers.
// Thresholds alinhados com Aumentadas (boostBuilder.js).

import { describe, it, expect } from 'vitest';
import {
  VERDICT_THRESHOLDS,
  LONG_SHOT_ODD_THRESHOLD,
  MATH_VERDICTS,
  DESIGN_VERDICTS,
  computeMathVerdict,
  computeDesignVerdict,
  isCombo,
  annotateVerdict,
  annotateVerdictArray,
} from '../src/services/premiumVerdict.js';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — VERDICT_THRESHOLDS / LONG_SHOT_ODD_THRESHOLD', () => {
  it('thresholds são gold=8 / value=3 / fair=-2', () => {
    expect(VERDICT_THRESHOLDS.gold).toBe(8.0);
    expect(VERDICT_THRESHOLDS.value).toBe(3.0);
    expect(VERDICT_THRESHOLDS.fair).toBe(-2.0);
  });

  it('VERDICT_THRESHOLDS é frozen', () => {
    expect(Object.isFrozen(VERDICT_THRESHOLDS)).toBe(true);
  });

  it('LONG_SHOT_ODD_THRESHOLD = 500', () => {
    expect(LONG_SHOT_ODD_THRESHOLD).toBe(500);
  });

  it('MATH_VERDICTS expõe os 5 variants', () => {
    expect(MATH_VERDICTS).toEqual(['gold', 'value', 'fair', 'trap', 'unknown']);
    expect(Object.isFrozen(MATH_VERDICTS)).toBe(true);
  });

  it('DESIGN_VERDICTS expõe long_shot', () => {
    expect(DESIGN_VERDICTS).toContain('long_shot');
    expect(Object.isFrozen(DESIGN_VERDICTS)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — computeMathVerdict', () => {
  it('ev=8 → gold (boundary inclusivo)', () => {
    expect(computeMathVerdict(8)).toBe('gold');
  });

  it('ev=15 → gold', () => {
    expect(computeMathVerdict(15)).toBe('gold');
  });

  it('ev=7.99 → value (abaixo do limiar gold)', () => {
    expect(computeMathVerdict(7.99)).toBe('value');
  });

  it('ev=3 → value (boundary)', () => {
    expect(computeMathVerdict(3)).toBe('value');
  });

  it('ev=2.99 → fair', () => {
    expect(computeMathVerdict(2.99)).toBe('fair');
  });

  it('ev=0 → fair', () => {
    expect(computeMathVerdict(0)).toBe('fair');
  });

  it('ev=-2 → fair (boundary inclusivo)', () => {
    expect(computeMathVerdict(-2)).toBe('fair');
  });

  it('ev=-2.01 → trap', () => {
    expect(computeMathVerdict(-2.01)).toBe('trap');
  });

  it('ev=-50 → trap', () => {
    expect(computeMathVerdict(-50)).toBe('trap');
  });

  it('null/undefined → unknown', () => {
    expect(computeMathVerdict(null)).toBe('unknown');
    expect(computeMathVerdict(undefined)).toBe('unknown');
  });

  it('NaN → unknown', () => {
    expect(computeMathVerdict(NaN)).toBe('unknown');
  });

  it('Infinity → unknown (não-finito)', () => {
    expect(computeMathVerdict(Infinity)).toBe('unknown');
    expect(computeMathVerdict(-Infinity)).toBe('unknown');
  });

  it('string numérica "5" → value (coerce)', () => {
    expect(computeMathVerdict('5')).toBe('value');
  });

  it('string não-numérica → unknown', () => {
    expect(computeMathVerdict('abc')).toBe('unknown');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — isCombo', () => {
  it('item com legs array não-vazio → combo', () => {
    expect(isCombo({ legs: [{ ev_pct: 5 }] })).toBe(true);
  });

  it('item com legs array vazio → não-combo', () => {
    expect(isCombo({ legs: [] })).toBe(false);
  });

  it('item com tier=tier2 → combo', () => {
    expect(isCombo({ tier: 'tier2' })).toBe(true);
  });

  it('item com tier=tier3 → combo', () => {
    expect(isCombo({ tier: 'tier3' })).toBe(true);
  });

  it('item com tier=tier4 → combo', () => {
    expect(isCombo({ tier: 'tier4' })).toBe(true);
  });

  it('item com tier=tier1 → não-combo', () => {
    expect(isCombo({ tier: 'tier1' })).toBe(false);
  });

  it('item com _tier=tier3 → combo', () => {
    expect(isCombo({ _tier: 'tier3' })).toBe(true);
  });

  it('item com _is_combo=true → combo', () => {
    expect(isCombo({ _is_combo: true })).toBe(true);
  });

  it('item com is_combo=true → combo', () => {
    expect(isCombo({ is_combo: true })).toBe(true);
  });

  it('item single sem nenhum sinal → não-combo', () => {
    expect(isCombo({ market: '1X2', selection: 'Home', odd: 2 })).toBe(false);
  });

  it('null/undefined → não-combo', () => {
    expect(isCombo(null)).toBe(false);
    expect(isCombo(undefined)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — computeDesignVerdict (ajuste #2: só combos)', () => {
  it('combo com combined_odd=500 → long_shot', () => {
    expect(computeDesignVerdict({ legs: [{}, {}], combined_odd: 500 })).toBe('long_shot');
  });

  it('combo com combined_odd=1000 → long_shot', () => {
    expect(computeDesignVerdict({ legs: [{}, {}, {}], combined_odd: 1000 })).toBe('long_shot');
  });

  it('combo com combined_odd=499 → null (abaixo do limiar)', () => {
    expect(computeDesignVerdict({ legs: [{}, {}], combined_odd: 499 })).toBeNull();
  });

  it('combo com combined_odd=100 → null', () => {
    expect(computeDesignVerdict({ legs: [{}, {}], combined_odd: 100 })).toBeNull();
  });

  // ───── AJUSTE #2: long_shot SÓ para combo ─────
  it('single avulso com odd=999 → null (não é long_shot)', () => {
    expect(computeDesignVerdict({ market: '1X2', selection: 'Home', odd: 999 })).toBeNull();
  });

  it('single avulso com combined_odd=1000 (sem legs) → null', () => {
    expect(computeDesignVerdict({ market: '1X2', combined_odd: 1000 })).toBeNull();
  });

  it('item com tier=tier1 e combined_odd alto → null (tier1 não é combo)', () => {
    expect(computeDesignVerdict({ tier: 'tier1', combined_odd: 1000 })).toBeNull();
  });

  it('combo tier4 com combined_odd=10000 → long_shot', () => {
    expect(computeDesignVerdict({ tier: 'tier4', combined_odd: 10000 })).toBe('long_shot');
  });

  it('combo com combinedOdd camelCase aceito', () => {
    expect(computeDesignVerdict({ legs: [{}, {}], combinedOdd: 600 })).toBe('long_shot');
  });

  it('combo sem combined_odd → null', () => {
    expect(computeDesignVerdict({ legs: [{}, {}] })).toBeNull();
  });

  it('combo com combined_odd=NaN → null', () => {
    expect(computeDesignVerdict({ legs: [{}, {}], combined_odd: NaN })).toBeNull();
  });

  it('null/undefined → null', () => {
    expect(computeDesignVerdict(null)).toBeNull();
    expect(computeDesignVerdict(undefined)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — annotateVerdict', () => {
  it('muta item com math_verdict e design_verdict', () => {
    const item = { ev_pct: 12, legs: [{}, {}], combined_odd: 700 };
    annotateVerdict(item);
    expect(item.math_verdict).toBe('gold');
    expect(item.design_verdict).toBe('long_shot');
  });

  it('single avulso recebe math_verdict mas NÃO design_verdict', () => {
    const item = { ev_pct: 4, market: '1X2', odd: 50 };
    annotateVerdict(item);
    expect(item.math_verdict).toBe('value');
    expect(item.design_verdict).toBeNull();
  });

  it('combo Mega ilusório recebe math_verdict=trap E design_verdict=long_shot', () => {
    const item = { ev_pct: -30, legs: [{}, {}, {}], combined_odd: 5000 };
    annotateVerdict(item);
    expect(item.math_verdict).toBe('trap');
    expect(item.design_verdict).toBe('long_shot');
  });

  it('item null/undefined → noop (não throw)', () => {
    expect(annotateVerdict(null)).toBeNull();
    expect(annotateVerdict(undefined)).toBeUndefined();
  });

  it('idempotente: chamar 2x não muda resultado', () => {
    const item = { ev_pct: 5, legs: [{}], combined_odd: 100 };
    annotateVerdict(item);
    const first = { math: item.math_verdict, design: item.design_verdict };
    annotateVerdict(item);
    expect(item.math_verdict).toBe(first.math);
    expect(item.design_verdict).toBe(first.design);
  });

  it('retorna o próprio item (conveniência)', () => {
    const item = { ev_pct: 5 };
    expect(annotateVerdict(item)).toBe(item);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — annotateVerdictArray', () => {
  it('anota cada item em-place, retorna count', () => {
    const arr = [
      { ev_pct: 10, legs: [{}, {}], combined_odd: 600 },
      { ev_pct: -5, market: '1X2' },
    ];
    const n = annotateVerdictArray(arr);
    expect(n).toBe(2);
    expect(arr[0].math_verdict).toBe('gold');
    expect(arr[0].design_verdict).toBe('long_shot');
    expect(arr[1].math_verdict).toBe('trap');
    expect(arr[1].design_verdict).toBeNull();
  });

  it('null/undefined/non-array → 0 sem throw', () => {
    expect(annotateVerdictArray(null)).toBe(0);
    expect(annotateVerdictArray(undefined)).toBe(0);
    expect(annotateVerdictArray('not array')).toBe(0);
    expect(annotateVerdictArray({})).toBe(0);
  });

  it('array vazio → 0', () => {
    expect(annotateVerdictArray([])).toBe(0);
  });

  it('items null/primitives dentro do array são pulados', () => {
    const arr = [null, { ev_pct: 5 }, undefined, 'string', { ev_pct: 0 }];
    const n = annotateVerdictArray(arr);
    expect(n).toBe(2);
    expect(arr[1].math_verdict).toBe('value');
    expect(arr[4].math_verdict).toBe('fair');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — alinhamento com Aumentadas (boostBuilder.js)', () => {
  // boostBuilder.js usa: gold ≥8, value ≥3, fair ≥-2, trap <-2
  // Espelho exato deve produzir os mesmos veredictos.
  it('ev=10 (Aumentadas gold) → gold', () => {
    expect(computeMathVerdict(10)).toBe('gold');
  });
  it('ev=5 (Aumentadas value) → value', () => {
    expect(computeMathVerdict(5)).toBe('value');
  });
  it('ev=-1 (Aumentadas fair) → fair', () => {
    expect(computeMathVerdict(-1)).toBe('fair');
  });
  it('ev=-10 (Aumentadas trap) → trap', () => {
    expect(computeMathVerdict(-10)).toBe('trap');
  });
});
