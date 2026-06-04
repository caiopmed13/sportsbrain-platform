// tests/wrCalculatorR6KF3.test.js — P3.9 R6K-F3

import { describe, it, expect } from 'vitest';
import {
  ODD_BUCKETS,
  normalizeResult,
  computeWR,
  computeROI,
  groupBy,
  computeWRByGroup,
  bucketForOdd,
  computeWRByOddBucket,
  computeStreak,
} from '../src/services/wrCalculator.js';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — ODD_BUCKETS', () => {
  it('tem 7 buckets cobrindo 1.0 a infinito', () => {
    expect(ODD_BUCKETS).toHaveLength(7);
    expect(ODD_BUCKETS[0].min).toBe(1.0);
    expect(ODD_BUCKETS[ODD_BUCKETS.length - 1].id).toBe('50+');
  });

  it('breakevens decrescentes', () => {
    for (let i = 1; i < ODD_BUCKETS.length; i++) {
      expect(ODD_BUCKETS[i].breakeven).toBeLessThan(ODD_BUCKETS[i-1].breakeven);
    }
  });

  it('é frozen', () => {
    expect(Object.isFrozen(ODD_BUCKETS)).toBe(true);
  });
});

describe('R6K-F3 — normalizeResult', () => {
  it.each([
    ['W', 'W'], ['w', 'W'], ['win', 'W'], ['GREEN', 'W'],
    ['L', 'L'], ['l', 'L'], ['loss', 'L'], ['RED', 'L'],
    ['P', 'P'], ['V', 'P'], ['push', 'P'], ['VOID', 'P'],
    [null, 'PENDING'], [undefined, 'PENDING'], ['', 'PENDING'], ['unknown', 'PENDING'],
  ])('normaliza %s → %s', (input, expected) => {
    expect(normalizeResult(input)).toBe(expected);
  });
});

describe('R6K-F3 — computeWR', () => {
  it('rows vazia → wr=0 sem throw', () => {
    expect(computeWR([])).toMatchObject({ wr: 0, settled: 0 });
  });

  it('3W + 1L → wr=0.75', () => {
    const r = computeWR([
      { result: 'W' }, { result: 'W' }, { result: 'W' }, { result: 'L' },
    ]);
    expect(r.wr).toBe(0.75);
    expect(r.wins).toBe(3);
    expect(r.losses).toBe(1);
    expect(r.settled).toBe(4);
  });

  it('pushes não contam no denominador', () => {
    const r = computeWR([
      { result: 'W' }, { result: 'L' }, { result: 'P' }, { result: 'P' },
    ]);
    expect(r.wr).toBe(0.5);
    expect(r.pushes).toBe(2);
    expect(r.settled).toBe(2);
  });

  it('pendings não contam', () => {
    const r = computeWR([
      { result: 'W' }, { result: 'PENDING' }, { result: null },
    ]);
    expect(r.wr).toBe(1);
    expect(r.settled).toBe(1);
    expect(r.pending).toBe(2);
    expect(r.n).toBe(3);
  });

  it('input não-array → wr=0', () => {
    expect(computeWR(null).wr).toBe(0);
    expect(computeWR(undefined).wr).toBe(0);
    expect(computeWR('not array').wr).toBe(0);
  });
});

describe('R6K-F3 — computeROI', () => {
  it('1W @2.0 + 1L → roi=0', () => {
    const r = computeROI([
      { result: 'W', odd: 2.0 },
      { result: 'L', odd: 2.0 },
    ]);
    expect(r.roi).toBe(0);
    expect(r.profit_total).toBe(0);
    expect(r.stake_total).toBe(2);
  });

  it('1W @3.0 + 1L → roi=0.5', () => {
    const r = computeROI([
      { result: 'W', odd: 3.0 },
      { result: 'L', odd: 2.0 },
    ]);
    expect(r.roi).toBe(0.5);
    expect(r.profit_total).toBe(1);  // +2 -1 = 1
  });

  it('usa profit_unit quando presente', () => {
    const r = computeROI([
      { result: 'W', profit_unit: 5 },
      { result: 'L', profit_unit: -1 },
    ]);
    expect(r.profit_total).toBe(4);
    expect(r.roi).toBe(2);
  });

  it('push contribui 0', () => {
    const r = computeROI([
      { result: 'P', odd: 2.0 },
      { result: 'W', odd: 2.0 },
    ]);
    expect(r.profit_total).toBe(1);
    expect(r.roi).toBe(0.5);
  });

  it('pending NÃO entra no stake_total', () => {
    const r = computeROI([
      { result: 'W', odd: 2.0 },
      { result: 'PENDING' },
    ]);
    expect(r.stake_total).toBe(1);
  });

  it('rows vazia → roi=0', () => {
    expect(computeROI([]).roi).toBe(0);
  });

  it('real_odd preferida sobre odd', () => {
    const r = computeROI([{ result: 'W', odd: 1.5, real_odd: 3.0 }]);
    expect(r.profit_total).toBe(2);
  });
});

describe('R6K-F3 — groupBy', () => {
  it('agrupa por string key', () => {
    const rows = [{ market: 'BTTS' }, { market: '1X2' }, { market: 'BTTS' }];
    const m = groupBy(rows, 'market');
    expect(m.size).toBe(2);
    expect(m.get('BTTS')).toHaveLength(2);
    expect(m.get('1X2')).toHaveLength(1);
  });

  it('agrupa por callback', () => {
    const rows = [{ x: 1 }, { x: 2 }, { x: 1 }];
    const m = groupBy(rows, (r) => r.x);
    expect(m.get(1)).toHaveLength(2);
  });

  it('null/undefined key pulado', () => {
    const m = groupBy([{ market: null }, { market: 'A' }], 'market');
    expect(m.size).toBe(1);
  });

  it('null/non-array → Map vazio', () => {
    expect(groupBy(null, 'x').size).toBe(0);
  });
});

describe('R6K-F3 — bucketForOdd', () => {
  it('1.2 → 1.0-1.5', () => {
    expect(bucketForOdd(1.2).id).toBe('1.0-1.5');
  });
  it('1.5 → 1.5-2.0 (inclusive low)', () => {
    expect(bucketForOdd(1.5).id).toBe('1.5-2.0');
  });
  it('2.0 → 2.0-3.0', () => {
    expect(bucketForOdd(2.0).id).toBe('2.0-3.0');
  });
  it('99 → 50+', () => {
    expect(bucketForOdd(99).id).toBe('50+');
  });
  it('odd<1 → null', () => {
    expect(bucketForOdd(0.9)).toBeNull();
  });
  it('NaN → null', () => {
    expect(bucketForOdd(NaN)).toBeNull();
  });
});

describe('R6K-F3 — computeWRByOddBucket', () => {
  it('agrupa rows e calcula WR+margem', () => {
    const rows = [
      { odd: 1.8, result: 'W' },  // 1.5-2.0
      { odd: 1.9, result: 'L' },  // 1.5-2.0
      { odd: 4.0, result: 'W' },  // 3.0-5.0
    ];
    const out = computeWRByOddBucket(rows);
    expect(out['1.5-2.0'].wr).toBe(0.5);
    expect(out['1.5-2.0'].margin_vs_breakeven).toBeCloseTo(0.5 - 0.57, 6);
    expect(out['3.0-5.0'].wr).toBe(1);
    expect(out['3.0-5.0'].n).toBe(1);
  });

  it('bucket sem rows tem n=0 e margem=null', () => {
    const out = computeWRByOddBucket([{ odd: 2.0, result: 'W' }]);
    expect(out['10-50'].n).toBe(0);
    expect(out['10-50'].margin_vs_breakeven).toBeNull();
  });
});

describe('R6K-F3 — computeStreak', () => {
  it('3 wins seguidos → current=3, max=3', () => {
    const r = computeStreak([
      { result: 'W' }, { result: 'W' }, { result: 'W' },
    ]);
    expect(r.current).toBe(3);
    expect(r.max).toBe(3);
  });

  it('W-W-L-W → current=1, max=2', () => {
    const r = computeStreak([
      { result: 'W' }, { result: 'W' }, { result: 'L' }, { result: 'W' },
    ]);
    expect(r.current).toBe(1);
    expect(r.max).toBe(2);
  });

  it('Loss streak: L-L-L → current_loss=3, max_loss=3', () => {
    const r = computeStreak([
      { result: 'L' }, { result: 'L' }, { result: 'L' },
    ]);
    expect(r.current_loss).toBe(3);
    expect(r.max_loss).toBe(3);
  });

  it('push reseta ambos streaks', () => {
    const r = computeStreak([
      { result: 'W' }, { result: 'W' }, { result: 'P' }, { result: 'W' },
    ]);
    expect(r.current).toBe(1);
    expect(r.max).toBe(2);
  });

  it('pending não afeta streak', () => {
    const r = computeStreak([
      { result: 'W' }, { result: 'PENDING' }, { result: 'W' },
    ]);
    expect(r.current).toBe(2);
    expect(r.max).toBe(2);
  });

  it('rows vazia → tudo zerado', () => {
    expect(computeStreak([])).toEqual({ current: 0, max: 0, current_loss: 0, max_loss: 0 });
  });
});

describe('R6K-F3 — computeWRByGroup', () => {
  it('agrupa por origin e calcula WR/ROI por grupo', () => {
    const rows = [
      { origin: 'tier1_single', result: 'W', odd: 2.0 },
      { origin: 'tier1_single', result: 'L', odd: 2.0 },
      { origin: 'tier4_leg', result: 'W', odd: 3.0 },
    ];
    const out = computeWRByGroup(rows, 'origin');
    expect(out.tier1_single.wr).toBe(0.5);
    expect(out.tier4_leg.wr).toBe(1);
    expect(out.tier4_leg.roi).toBe(2);  // (3-1)/1 = 2
  });
});
