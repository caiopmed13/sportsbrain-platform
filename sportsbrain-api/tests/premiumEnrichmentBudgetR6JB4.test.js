// tests/premiumEnrichmentBudgetR6JB4.test.js — P3.9 R6J-B4
// Cobre o bounded enrichment gate (opt-in via env PREMIUM_ENRICHMENT_TOP_N).
// Garantias:
//   - env ausente / inválido → enrichSet=null (todos enriquecidos = pré-B4)
//   - env válido + topN < length → top-N selecionado por pre-score
//   - pre-score é síncrono (sem D1)
//   - todos os picks continuam na resposta (não remove)
//   - shouldEnrichFully(null, p) sempre true
//   - summary com counts corretos
//   - não muta inputs

import { describe, it, expect, vi } from 'vitest';
import {
  PREMIUM_ENRICHMENT_DEFAULT_TOP_N,
  PREMIUM_ENRICHMENT_ENV_KEY,
  getEnrichmentTopN,
  computeEnrichmentPreScore,
  buildEnrichmentTopNSet,
  buildEnrichmentSummary,
  shouldEnrichFully,
} from '../src/services/premiumEnrichmentBudget.js';

// ── Helpers ──────────────────────────────────────────────────────────────
function mkPick(over = {}) {
  return {
    home_team: 'Team A',
    away_team: 'Team B',
    market: 'BTTS',
    direction: 'yes',
    confidence: 60,
    ...over,
  };
}

// Mock calcConsensus que retorna structure realista sem D1
function fakeConsensus(count = 0, channels = 0) {
  return () => ({ count, unique_channels: channels });
}

// ─────────────────────────────────────────────────────────────────────────
describe('R6J-B4 — getEnrichmentTopN (env reader)', () => {
  it('env undefined retorna null', () => {
    expect(getEnrichmentTopN(undefined)).toBeNull();
    expect(getEnrichmentTopN(null)).toBeNull();
  });

  it('env sem a key retorna null', () => {
    expect(getEnrichmentTopN({})).toBeNull();
  });

  it('env com value vazio retorna null', () => {
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: '' })).toBeNull();
  });

  it('env com value 0 retorna null (desabilita)', () => {
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: '0' })).toBeNull();
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: 0 })).toBeNull();
  });

  it('env com value negativo retorna null', () => {
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: '-5' })).toBeNull();
  });

  it('env com value "abc" inválido retorna null', () => {
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: 'abc' })).toBeNull();
  });

  it('env com value "80" string retorna 80', () => {
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: '80' })).toBe(80);
  });

  it('env com value 50 number retorna 50', () => {
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: 50 })).toBe(50);
  });

  it('env com value decimal trunca para int', () => {
    expect(getEnrichmentTopN({ [PREMIUM_ENRICHMENT_ENV_KEY]: '50.7' })).toBe(50);
  });

  it('DEFAULT_TOP_N exportado é razoável (entre 30 e 200)', () => {
    expect(PREMIUM_ENRICHMENT_DEFAULT_TOP_N).toBeGreaterThan(30);
    expect(PREMIUM_ENRICHMENT_DEFAULT_TOP_N).toBeLessThanOrEqual(200);
  });
});

describe('R6J-B4 — computeEnrichmentPreScore', () => {
  it('null/undefined retorna 0 sem throw', () => {
    expect(computeEnrichmentPreScore(null, fakeConsensus(), [])).toBe(0);
    expect(computeEnrichmentPreScore(undefined, fakeConsensus(), [])).toBe(0);
  });

  it('confidence base default 50 quando ausente', () => {
    const s = computeEnrichmentPreScore({ home_team: 'A' }, fakeConsensus(0, 0), []);
    expect(s).toBe(50);
  });

  it('confidence mais alta gera score mais alto', () => {
    const lo = computeEnrichmentPreScore(mkPick({ confidence: 30 }), fakeConsensus(), []);
    const hi = computeEnrichmentPreScore(mkPick({ confidence: 90 }), fakeConsensus(), []);
    expect(hi).toBeGreaterThan(lo);
  });

  it('consensus count adiciona pontos', () => {
    const base = computeEnrichmentPreScore(mkPick(), fakeConsensus(0, 0), []);
    const consBoost = computeEnrichmentPreScore(mkPick(), fakeConsensus(3, 2), []);
    expect(consBoost).toBeGreaterThan(base);
  });

  it('_bayesian_lcb presente adiciona pontos', () => {
    const base = computeEnrichmentPreScore(mkPick(), fakeConsensus(), []);
    const lcb = computeEnrichmentPreScore(mkPick({ _bayesian_lcb: 80 }), fakeConsensus(), []);
    expect(lcb).toBeGreaterThan(base);
  });

  it('_is_direct_b365 adiciona 8 pontos', () => {
    const base = computeEnrichmentPreScore(mkPick(), fakeConsensus(), []);
    const b365 = computeEnrichmentPreScore(mkPick({ _is_direct_b365: true }), fakeConsensus(), []);
    expect(b365 - base).toBe(8);
  });

  it('_has_steam strong adiciona mais que medium/leve', () => {
    const leve = computeEnrichmentPreScore(mkPick({ _has_steam: true, steam_strength: 'leve' }), fakeConsensus(), []);
    const med  = computeEnrichmentPreScore(mkPick({ _has_steam: true, steam_strength: 'medium' }), fakeConsensus(), []);
    const str  = computeEnrichmentPreScore(mkPick({ _has_steam: true, steam_strength: 'strong' }), fakeConsensus(), []);
    expect(str).toBeGreaterThan(med);
    expect(med).toBeGreaterThan(leve);
  });

  it('calcConsensus que lança não quebra', () => {
    const throwing = () => { throw new Error('boom'); };
    expect(() => computeEnrichmentPreScore(mkPick(), throwing, [])).not.toThrow();
    // ainda retorna ao menos a confidence base
    const s = computeEnrichmentPreScore(mkPick({ confidence: 60 }), throwing, []);
    expect(s).toBe(60);
  });

  it('é síncrono (não retorna Promise)', () => {
    const s = computeEnrichmentPreScore(mkPick(), fakeConsensus(), []);
    expect(typeof s).toBe('number');
  });

  it('não muta o pick', () => {
    const p = mkPick({ confidence: 70 });
    const snap = JSON.stringify(p);
    computeEnrichmentPreScore(p, fakeConsensus(2, 1), []);
    expect(JSON.stringify(p)).toBe(snap);
  });
});

describe('R6J-B4 — buildEnrichmentTopNSet', () => {
  it('topN null retorna null (enrich all)', () => {
    const picks = [mkPick(), mkPick(), mkPick()];
    expect(buildEnrichmentTopNSet(picks, fakeConsensus(), [], null)).toBeNull();
  });

  it('topN 0 retorna null', () => {
    expect(buildEnrichmentTopNSet([mkPick()], fakeConsensus(), [], 0)).toBeNull();
  });

  it('topN negativo retorna null', () => {
    expect(buildEnrichmentTopNSet([mkPick()], fakeConsensus(), [], -1)).toBeNull();
  });

  it('topN >= length retorna null (cobertura total)', () => {
    const picks = [mkPick(), mkPick(), mkPick()];
    expect(buildEnrichmentTopNSet(picks, fakeConsensus(), [], 3)).toBeNull();
    expect(buildEnrichmentTopNSet(picks, fakeConsensus(), [], 10)).toBeNull();
  });

  it('topN < length retorna Set com top-N por pre-score', () => {
    const picks = [
      mkPick({ confidence: 10, home_team: 'low' }),
      mkPick({ confidence: 90, home_team: 'high', _has_steam: true, steam_strength: 'strong' }),
      mkPick({ confidence: 50, home_team: 'mid' }),
    ];
    const set = buildEnrichmentTopNSet(picks, fakeConsensus(), [], 1);
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(1);
    expect(set.has(picks[1])).toBe(true);  // 'high' tem maior pre-score
    expect(set.has(picks[0])).toBe(false);
  });

  it('topN=2 inclui top 2 por pre-score', () => {
    const picks = [
      mkPick({ confidence: 10 }),
      mkPick({ confidence: 90 }),
      mkPick({ confidence: 50 }),
    ];
    const set = buildEnrichmentTopNSet(picks, fakeConsensus(), [], 2);
    expect(set.size).toBe(2);
    expect(set.has(picks[1])).toBe(true);  // 90
    expect(set.has(picks[2])).toBe(true);  // 50
    expect(set.has(picks[0])).toBe(false); // 10
  });

  it('annotatedBase não-array retorna null', () => {
    expect(buildEnrichmentTopNSet(null, fakeConsensus(), [], 5)).toBeNull();
    expect(buildEnrichmentTopNSet(undefined, fakeConsensus(), [], 5)).toBeNull();
  });

  it('não muta o array de entrada', () => {
    const picks = [mkPick({ confidence: 80 }), mkPick({ confidence: 30 })];
    const original = [...picks];
    buildEnrichmentTopNSet(picks, fakeConsensus(), [], 1);
    expect(picks).toEqual(original);
  });

  it('picks com pre-score idêntico — qualquer um cabe no top-N', () => {
    const picks = [mkPick({ confidence: 50 }), mkPick({ confidence: 50 }), mkPick({ confidence: 50 })];
    const set = buildEnrichmentTopNSet(picks, fakeConsensus(), [], 2);
    expect(set.size).toBe(2);
    // qualquer 2 dos 3 cabe
    const included = picks.filter(p => set.has(p));
    expect(included.length).toBe(2);
  });
});

describe('R6J-B4 — buildEnrichmentSummary', () => {
  it('enrichSet null => mode=full, skipped=0', () => {
    const summ = buildEnrichmentSummary({ totalPicks: 100, enrichSet: null, topN: null });
    expect(summ).toEqual({
      mode: 'full',
      enriched_count: 100,
      skipped_count: 0,
      top_n: null,
      reason: null,
    });
  });

  it('enrichSet com 50 de 200 => mode=bounded, skipped=150', () => {
    const set = new Set();
    for (let i = 0; i < 50; i++) set.add({ i });
    const summ = buildEnrichmentSummary({ totalPicks: 200, enrichSet: set, topN: 50 });
    expect(summ).toEqual({
      mode: 'bounded',
      enriched_count: 50,
      skipped_count: 150,
      top_n: 50,
      reason: 'subrequest_budget_guard',
    });
  });

  it('totalPicks inválido cai pra 0', () => {
    const summ = buildEnrichmentSummary({ totalPicks: NaN, enrichSet: null, topN: null });
    expect(summ.enriched_count).toBe(0);
  });

  it('summary não vaza campos sensíveis (can_beta/can_sell/etc)', () => {
    const summ = buildEnrichmentSummary({ totalPicks: 100, enrichSet: new Set(), topN: 5 });
    for (const k of Object.keys(summ)) {
      expect(['can_beta', 'can_sell', 'micro_test_active']).not.toContain(k);
    }
  });
});

describe('R6J-B4 — shouldEnrichFully', () => {
  it('null set sempre true (modo full)', () => {
    const p = mkPick();
    expect(shouldEnrichFully(null, p)).toBe(true);
  });

  it('pick no set true; pick fora false', () => {
    const a = mkPick({ home_team: 'A' });
    const b = mkPick({ home_team: 'B' });
    const set = new Set([a]);
    expect(shouldEnrichFully(set, a)).toBe(true);
    expect(shouldEnrichFully(set, b)).toBe(false);
  });

  it('Set vazio: ninguém enriquecido', () => {
    expect(shouldEnrichFully(new Set(), mkPick())).toBe(false);
  });
});

describe('R6J-B4 — comportamento integrado: env ausente preserva pré-B4', () => {
  it('cenário típico: env não setado → enrichSet null → shouldEnrichFully sempre true', () => {
    const env = {};
    const picks = [mkPick(), mkPick(), mkPick()];
    const topN = getEnrichmentTopN(env);
    expect(topN).toBeNull();
    const set = buildEnrichmentTopNSet(picks, fakeConsensus(), [], topN);
    expect(set).toBeNull();
    for (const p of picks) {
      expect(shouldEnrichFully(set, p)).toBe(true);
    }
    const summ = buildEnrichmentSummary({ totalPicks: picks.length, enrichSet: set, topN });
    expect(summ.mode).toBe('full');
    expect(summ.skipped_count).toBe(0);
  });

  it('cenário bounded: env=2, pool=5 → 2 enriquecidos, 3 skipped, todos no array final', () => {
    const env = { [PREMIUM_ENRICHMENT_ENV_KEY]: '2' };
    const picks = [
      mkPick({ confidence: 10 }),
      mkPick({ confidence: 80 }),
      mkPick({ confidence: 50 }),
      mkPick({ confidence: 95, _has_steam: true, steam_strength: 'strong' }),
      mkPick({ confidence: 20 }),
    ];
    const topN = getEnrichmentTopN(env);
    expect(topN).toBe(2);
    const set = buildEnrichmentTopNSet(picks, fakeConsensus(), [], topN);
    expect(set).not.toBeNull();
    expect(set.size).toBe(2);

    // Top 2 esperados: pick 3 (steam strong + conf 95) e pick 1 (conf 80)
    expect(set.has(picks[3])).toBe(true);
    expect(set.has(picks[1])).toBe(true);
    expect(set.has(picks[0])).toBe(false);
    expect(set.has(picks[2])).toBe(false);
    expect(set.has(picks[4])).toBe(false);

    // Mas todos os picks ainda estão no array — gate não remove
    expect(picks.length).toBe(5);

    const summ = buildEnrichmentSummary({ totalPicks: picks.length, enrichSet: set, topN });
    expect(summ).toEqual({
      mode: 'bounded',
      enriched_count: 2,
      skipped_count: 3,
      top_n: 2,
      reason: 'subrequest_budget_guard',
    });
  });
});

describe('R6J-B4 — estimativa de impacto em subrequest budget', () => {
  it('300 picks com top_n=80: pular 220 picks economiza ~2200 subrequests (10/pick)', () => {
    const picks = Array.from({ length: 300 }, (_, i) =>
      mkPick({ home_team: `T${i}`, confidence: 30 + (i % 60) })
    );
    const set = buildEnrichmentTopNSet(picks, fakeConsensus(), [], 80);
    expect(set.size).toBe(80);
    const skipped = picks.length - set.size;
    expect(skipped).toBe(220);
    // 10 D1 calls por getSignalsForPick (steam + form×4 + lineup + referee +
    // h2h + rest×2 + momentum). 220 × 10 = 2200 economizados.
    const estimatedSaved = skipped * 10;
    expect(estimatedSaved).toBe(2200);
  });
});
