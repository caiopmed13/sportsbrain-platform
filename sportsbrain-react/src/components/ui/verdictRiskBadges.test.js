// verdictRiskBadges.test.js — P3.9 R6K-F2
// Testes minimalistas dos exports nomeados de VerdictBadge.jsx e
// RiskBadges.jsx. Vitest config atual usa environment 'node' sem jsdom,
// então NÃO testamos render React aqui — apenas constantes e função pura
// sortByPriority. Smoke render é validado por `npm run build`.

import { describe, it, expect } from 'vitest';
import { VERDICT_META } from './VerdictBadge.jsx';
import { TAG_ORDER, TAG_META, sortByPriority } from './RiskBadges.jsx';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 (frontend) — VerdictBadge VERDICT_META', () => {
  it('expõe as 5 variants', () => {
    expect(VERDICT_META).toHaveProperty('gold');
    expect(VERDICT_META).toHaveProperty('value');
    expect(VERDICT_META).toHaveProperty('fair');
    expect(VERDICT_META).toHaveProperty('trap');
    expect(VERDICT_META).toHaveProperty('long_shot');
  });

  it('cada variant tem label/icon/color', () => {
    for (const v of ['gold', 'value', 'fair', 'trap', 'long_shot']) {
      const meta = VERDICT_META[v];
      expect(meta.label).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.color).toBeTruthy();
    }
  });

  it('VERDICT_META é frozen', () => {
    expect(Object.isFrozen(VERDICT_META)).toBe(true);
  });

  it('labels são uppercase ASCII (para legibilidade em badge mono)', () => {
    expect(VERDICT_META.gold.label).toBe('GOLD');
    expect(VERDICT_META.value.label).toBe('VALUE');
    expect(VERDICT_META.fair.label).toBe('FAIR');
    expect(VERDICT_META.trap.label).toBe('TRAP');
    expect(VERDICT_META.long_shot.label).toBe('LONG-SHOT');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 (frontend) — RiskBadges TAG_ORDER', () => {
  it('TAG_ORDER tem 16 tags (espelha backend)', () => {
    expect(TAG_ORDER).toHaveLength(16);
  });

  it('MEGA_ILUSORIO é a primeira (mais crítica)', () => {
    expect(TAG_ORDER[0]).toBe('MEGA_ILUSORIO');
  });

  it('LAB é a última (informacional)', () => {
    expect(TAG_ORDER[TAG_ORDER.length - 1]).toBe('LAB');
  });

  it('TAG_ORDER é frozen', () => {
    expect(Object.isFrozen(TAG_ORDER)).toBe(true);
  });

  it('TAG_META cobre todas as 16 tags do TAG_ORDER', () => {
    for (const t of TAG_ORDER) {
      expect(TAG_META).toHaveProperty(t);
      expect(TAG_META[t].label).toBeTruthy();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 (frontend) — sortByPriority', () => {
  it('ordena MEGA_ILUSORIO antes de LAB', () => {
    expect(sortByPriority(['LAB', 'MEGA_ILUSORIO'])).toEqual(['MEGA_ILUSORIO', 'LAB']);
  });

  it('respeita TAG_ORDER completo', () => {
    const input = ['HISTORICO_FORTE', 'WATCH', 'EV_POSITIVO', 'LAB'];
    expect(sortByPriority(input)).toEqual(['WATCH', 'EV_POSITIVO', 'HISTORICO_FORTE', 'LAB']);
  });

  it('tags desconhecidas vão para o fim', () => {
    const sorted = sortByPriority(['UNKNOWN_X', 'LAB']);
    expect(sorted[sorted.length - 1]).toBe('UNKNOWN_X');
    expect(sorted[0]).toBe('LAB');
  });

  it('array vazio → []', () => {
    expect(sortByPriority([])).toEqual([]);
  });

  it('null/non-array → []', () => {
    expect(sortByPriority(null)).toEqual([]);
    expect(sortByPriority(undefined)).toEqual([]);
    expect(sortByPriority('not array')).toEqual([]);
  });

  it('não muta input', () => {
    const input = ['LAB', 'MEGA_ILUSORIO'];
    sortByPriority(input);
    expect(input).toEqual(['LAB', 'MEGA_ILUSORIO']);
  });
});
