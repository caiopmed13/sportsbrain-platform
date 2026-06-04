// tests/picksHistoryCollectorR6KF3.test.js — P3.9 R6K-F3

import { describe, it, expect } from 'vitest';
import {
  ORIGINS,
  METHOD_FAMILIES,
  collectAllSinglesForHistory,
  buildHistoryRowId,
} from '../src/services/picksHistoryCollector.js';

// Helper: payload Premium mínimo. Shape espelha _premiumBody real.
function buildPayload(overrides = {}) {
  return {
    sport: 'football',
    tier1: { picks: [] },
    tier2: { combos: [] },
    tier3: { combos: [] },
    tier4: { combos: [] },
    bet_builder: { light: { combos: [] }, mid: { combos: [] }, plus: { combos: [] } },
    results_acca: { dupla: { combos: [] }, treble: { combos: [] }, fold: { combos: [] }, mega_fold: { combos: [] } },
    top_picks_today: [],
    ...overrides,
  };
}

const PICK_DATE = '2026-05-26';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — constants', () => {
  it('ORIGINS expõe 8 valores', () => {
    expect(ORIGINS).toHaveLength(8);
    expect(ORIGINS).toContain('tier1_single');
    expect(ORIGINS).toContain('tier4_leg');
    expect(Object.isFrozen(ORIGINS)).toBe(true);
  });

  it('METHOD_FAMILIES expõe 5', () => {
    expect(METHOD_FAMILIES).toEqual(['ai_singles', 'ai_combo', 'tipster', 'faixa', 'mega']);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — collectAllSinglesForHistory: shape básico', () => {
  it('payload null/undefined → []', () => {
    expect(collectAllSinglesForHistory(null)).toEqual([]);
    expect(collectAllSinglesForHistory(undefined)).toEqual([]);
  });

  it('payload vazio (sem tiers) → []', () => {
    expect(collectAllSinglesForHistory({})).toEqual([]);
  });

  it('payload com tier1 vazio → []', () => {
    expect(collectAllSinglesForHistory(buildPayload())).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — tier1 singles', () => {
  it('1 tier1 pick → 1 row com origin=tier1_single', () => {
    const payload = buildPayload({
      tier1: { picks: [{
        fixture_id: 'fx1', market: 'BTTS', selection: 'Sim', odd: 1.9,
        ev_pct: 5, math_verdict: 'value', risk_tags: ['LAB', 'EV_POSITIVO'],
      }] },
    });
    const rows = collectAllSinglesForHistory(payload, { pick_date: PICK_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pick_date: PICK_DATE, sport: 'football',
      market: 'BTTS', selection: 'Sim',
      origin: 'tier1_single', method_family: 'ai_singles',
      math_verdict: 'value', parent_combo_id: null,
    });
    expect(rows[0].risk_tags_json).toBe(JSON.stringify(['LAB', 'EV_POSITIVO']));
  });

  it('tier1 sem market → pulado', () => {
    const payload = buildPayload({
      tier1: { picks: [{ fixture_id: 'x', selection: 'Sim' }] },
    });
    expect(collectAllSinglesForHistory(payload)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — combos: legs viram rows', () => {
  it('tier2 combo com 2 legs → 2 rows com origin=tier2_leg', () => {
    const payload = buildPayload({
      tier2: { combos: [{
        id: 'c1', combined_odd: 4.5,
        legs: [
          { fixture_id: 'fxA', market: 'BTTS', selection: 'Sim', odd: 1.9, ev_pct: 3 },
          { fixture_id: 'fxB', market: '1X2', selection: 'Casa', odd: 2.4, ev_pct: 4 },
        ],
      }] },
    });
    const rows = collectAllSinglesForHistory(payload, { pick_date: PICK_DATE });
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.origin === 'tier2_leg')).toBe(true);
    expect(rows.every(r => r.method_family === 'ai_combo')).toBe(true);
    expect(rows.every(r => r.parent_combo_id === 'c1')).toBe(true);
  });

  it('tier4 mega → legs viram method_family=mega', () => {
    const payload = buildPayload({
      tier4: { combos: [{
        id: 'mega1', combined_odd: 5000,
        legs: [
          { fixture_id: 'fxA', market: 'BTTS', selection: 'Sim', ev_pct: -10 },
          { fixture_id: 'fxB', market: '1X2',  selection: 'Casa', ev_pct: -20 },
        ],
      }] },
    });
    const rows = collectAllSinglesForHistory(payload, { pick_date: PICK_DATE });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.origin).toBe('tier4_leg');
      expect(r.method_family).toBe('mega');
    }
  });

  it('bet_builder legs → origin=bet_builder_leg', () => {
    const payload = buildPayload({
      bet_builder: {
        light: { combos: [{ id: 'bb1', legs: [{ fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' }] }] },
        mid:   { combos: [] },
        plus:  { combos: [] },
      },
    });
    const rows = collectAllSinglesForHistory(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('bet_builder_leg');
  });

  it('results_acca legs → origin=results_acca_leg', () => {
    const payload = buildPayload({
      results_acca: {
        dupla: { combos: [{ id: 'ra1', legs: [{ fixture_id: 'fxA', market: '1X2', selection: 'Casa' }] }] },
        treble: { combos: [] }, fold: { combos: [] }, mega_fold: { combos: [] },
      },
    });
    const rows = collectAllSinglesForHistory(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('results_acca_leg');
  });

  it('top_picks_today singles → origin=top_picks_today', () => {
    const payload = buildPayload({
      top_picks_today: [{ fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' }],
    });
    const rows = collectAllSinglesForHistory(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('top_picks_today');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — dedup por (event_id, market, selection, pick_date)', () => {
  it('mesma seleção em tier1 + tier2 leg → tier1_single vence (prioridade mais alta)', () => {
    const sharedLeg = { fixture_id: 'fxA', market: 'BTTS', selection: 'Sim', ev_pct: 5 };
    const payload = buildPayload({
      tier1: { picks: [{ ...sharedLeg, math_verdict: 'value' }] },
      tier2: { combos: [{ id: 'c1', legs: [{ ...sharedLeg, math_verdict: 'fair' }] }] },
    });
    const rows = collectAllSinglesForHistory(payload, { pick_date: PICK_DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('tier1_single');
    expect(rows[0].math_verdict).toBe('value');
  });

  it('mesma leg em tier4 e bet_builder → tier4_leg vence', () => {
    const sharedLeg = { fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' };
    const payload = buildPayload({
      tier4: { combos: [{ id: 'mega1', legs: [sharedLeg] }] },
      bet_builder: {
        light: { combos: [{ id: 'bb1', legs: [sharedLeg] }] },
        mid: { combos: [] }, plus: { combos: [] },
      },
    });
    const rows = collectAllSinglesForHistory(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('tier4_leg');
  });

  it('seleções diferentes no mesmo jogo NÃO dedupam', () => {
    const payload = buildPayload({
      tier1: { picks: [
        { fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' },
        { fixture_id: 'fxA', market: 'BTTS', selection: 'Não' },
      ] },
    });
    const rows = collectAllSinglesForHistory(payload);
    expect(rows).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — method_family inference', () => {
  it('tipster source no parent → method_family=tipster', () => {
    const payload = buildPayload({
      tier2: { combos: [{
        id: 'tg1', source: 'tipster',
        legs: [{ fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' }],
      }] },
    });
    const rows = collectAllSinglesForHistory(payload);
    expect(rows[0].method_family).toBe('tipster');
  });

  it('parent.is_faixa=true → method_family=faixa', () => {
    const payload = buildPayload({
      tier3: { combos: [{
        id: 'fx1', is_faixa: true,
        legs: [{ fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' }],
      }] },
    });
    const rows = collectAllSinglesForHistory(payload);
    expect(rows[0].method_family).toBe('faixa');
  });

  it('tier4 combo sem faixa/tipster → mega', () => {
    const payload = buildPayload({
      tier4: { combos: [{ id: 'm1', legs: [{ fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' }] }] },
    });
    expect(collectAllSinglesForHistory(payload)[0].method_family).toBe('mega');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — buildHistoryRowId', () => {
  it('ID determinístico baseado em date|event|market|selection|origin', () => {
    const row1 = {
      pick_date: '2026-05-26', fixture_id: 'fxA',
      market: 'BTTS', selection: 'Sim', origin: 'tier1_single',
    };
    const row2 = { ...row1 };
    expect(buildHistoryRowId(row1)).toBe(buildHistoryRowId(row2));
  });

  it('IDs diferentes para origin diferente (mesmo evento/market/sel)', () => {
    const base = { pick_date: '2026-05-26', fixture_id: 'fxA', market: 'BTTS', selection: 'Sim' };
    const id1 = buildHistoryRowId({ ...base, origin: 'tier1_single' });
    const id2 = buildHistoryRowId({ ...base, origin: 'tier4_leg' });
    expect(id1).not.toBe(id2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F3 — cenário real: full payload', () => {
  it('combina tier1 + tier2 + tier3 + tier4 + bet_builder + results_acca + top_picks_today', () => {
    const payload = buildPayload({
      tier1: { picks: [
        { fixture_id: 'fx1', market: 'BTTS', selection: 'Sim' },
        { fixture_id: 'fx2', market: '1X2', selection: 'Casa' },
      ] },
      tier2: { combos: [{ id: 'c2_1', legs: [
        { fixture_id: 'fx3', market: 'BTTS', selection: 'Sim' },
        { fixture_id: 'fx4', market: '1X2', selection: 'Fora' },
      ] }] },
      tier4: { combos: [{ id: 'mega1', legs: [
        { fixture_id: 'fx5', market: 'CORRECT_SCORE', selection: '2-1' },
      ] }] },
      bet_builder: {
        light: { combos: [{ id: 'bb1', legs: [{ fixture_id: 'fx6', market: 'Total', selection: 'Over 2.5' }] }] },
        mid: { combos: [] }, plus: { combos: [] },
      },
      top_picks_today: [{ fixture_id: 'fx7', market: '1X2', selection: 'Empate' }],
    });
    const rows = collectAllSinglesForHistory(payload, { pick_date: PICK_DATE });
    expect(rows).toHaveLength(7);
    const origins = rows.map(r => r.origin).sort();
    expect(origins).toEqual([
      'bet_builder_leg', 'tier1_single', 'tier1_single',
      'tier2_leg', 'tier2_leg', 'tier4_leg', 'top_picks_today',
    ]);
  });
});
