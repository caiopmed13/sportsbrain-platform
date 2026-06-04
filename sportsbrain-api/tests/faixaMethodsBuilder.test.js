import { describe, it, expect } from 'vitest';
import {
  buildFaixaMethods,
  _normMatchKey,
  _filterHtChutesLegs,
  _groupByMatch,
  _buildHtChutesCard,
  _classifyTier,
  buildHtChutes,
  _pickTopCombos,
  buildFaixaResultBtts,
} from '../src/routes/faixaMethodsBuilder.js';

describe('faixaMethodsBuilder — entry point', () => {
  it('exports buildFaixaMethods returning { ht_chutes, faixa_result_btts }', () => {
    const result = buildFaixaMethods([]);
    expect(result).toHaveProperty('ht_chutes');
    expect(result).toHaveProperty('faixa_result_btts');
    expect(result.ht_chutes).toHaveProperty('cards');
    expect(result.ht_chutes).toHaveProperty('duplas');
    expect(result.ht_chutes).toHaveProperty('quadras');
    expect(result.faixa_result_btts).toHaveProperty('cards');
    expect(result.faixa_result_btts).toHaveProperty('duplas');
    expect(result.faixa_result_btts).toHaveProperty('quadras');
  });
});

describe('_normMatchKey', () => {
  it('strips accents (Bolívar = Bolivar)', () => {
    expect(_normMatchKey('Bolívar v Indep. Rivadavia'))
      .toBe(_normMatchKey('Bolivar v Indep. Rivadavia'));
  });

  it('lowercases (São Paulo = são paulo)', () => {
    expect(_normMatchKey('São Paulo v Sport'))
      .toBe(_normMatchKey('são paulo v sport'));
  });

  it('returns empty string for null/undefined', () => {
    expect(_normMatchKey(null)).toBe('');
    expect(_normMatchKey(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(_normMatchKey('  Match  ')).toBe('match');
  });
});

describe('_filterHtChutesLegs', () => {
  const sample = (overrides) => ({
    match: 'A v B',
    stat: 'Chutes 1º Tempo · Casa',
    odd: 2.0,
    prob: 0.5,
    ev_pct: 5,
    ...overrides,
  });

  it('accepts Chutes 1º Tempo Casa and Fora', () => {
    expect(_filterHtChutesLegs([
      sample({ stat: 'Chutes 1º Tempo · Casa' }),
      sample({ stat: 'Chutes 1º Tempo · Fora' }),
    ])).toHaveLength(2);
  });

  it('accepts Escanteios 1º Tempo Casa and Fora', () => {
    expect(_filterHtChutesLegs([
      sample({ stat: 'Escanteios 1º Tempo · Casa' }),
      sample({ stat: 'Escanteios 1º Tempo · Fora' }),
    ])).toHaveLength(2);
  });

  it('rejects non-HT-Chutes markets', () => {
    expect(_filterHtChutesLegs([
      sample({ stat: '1X2' }),
      sample({ stat: 'BTTS' }),
      sample({ stat: 'Total Goals' }),
    ])).toHaveLength(0);
  });

  it('rejects legs with odd < 1.25 (F2.55: limiar baixado pra capturar mais FAIXA HT)', () => {
    expect(_filterHtChutesLegs([sample({ odd: 1.2 })])).toHaveLength(0);
  });

  it('rejects legs with odd > 4.0', () => {
    expect(_filterHtChutesLegs([sample({ odd: 4.1 })])).toHaveLength(0);
  });

  it('rejects legs with missing match', () => {
    expect(_filterHtChutesLegs([sample({ match: '' })])).toHaveLength(0);
    expect(_filterHtChutesLegs([sample({ match: null })])).toHaveLength(0);
  });

  it('rejects legs without odd or prob', () => {
    expect(_filterHtChutesLegs([sample({ odd: null })])).toHaveLength(0);
    expect(_filterHtChutesLegs([sample({ prob: null })])).toHaveLength(0);
  });
});

describe('_groupByMatch', () => {
  it('groups legs by normalized match key', () => {
    const legs = [
      { match: 'A v B', stat: 'X' },
      { match: 'A v B', stat: 'Y' },
      { match: 'C v D', stat: 'X' },
    ];
    const grouped = _groupByMatch(legs);
    expect(grouped.size).toBe(2);
    expect(grouped.get(_normMatchKey('A v B'))).toHaveLength(2);
    expect(grouped.get(_normMatchKey('C v D'))).toHaveLength(1);
  });

  it('treats accented and unaccented match as same key', () => {
    const legs = [
      { match: 'Bolívar v X', stat: 'A' },
      { match: 'Bolivar v X', stat: 'B' },
    ];
    const grouped = _groupByMatch(legs);
    expect(grouped.size).toBe(1);
    expect([...grouped.values()][0]).toHaveLength(2);
  });

  it('skips legs without match', () => {
    const legs = [
      { match: '', stat: 'X' },
      { match: null, stat: 'Y' },
      { match: 'A v B', stat: 'Z' },
    ];
    const grouped = _groupByMatch(legs);
    expect(grouped.size).toBe(1);
  });
});

describe('_buildHtChutesCard', () => {
  const mkLeg = (stat, odd, prob, ev) => ({
    match: 'São Paulo v Sport',
    stat, odd, prob, ev_pct: ev,
    selection: 'X', line: 5.5, direction: 'over',
  });

  it('builds card with 4 legs (one per market+side)', () => {
    const legs = [
      mkLeg('Chutes 1º Tempo · Casa', 2.0, 0.5, 5),
      mkLeg('Chutes 1º Tempo · Fora', 2.1, 0.48, 4),
      mkLeg('Escanteios 1º Tempo · Casa', 1.9, 0.55, 3),
      mkLeg('Escanteios 1º Tempo · Fora', 2.0, 0.5, 5),
    ];
    const card = _buildHtChutesCard(legs);
    expect(card).not.toBeNull();
    expect(card.n_legs).toBe(4);
    expect(card.method).toBe('ht_chutes');
    expect(card.match).toBe('São Paulo v Sport');
    expect(card.combined_odd).toBeCloseTo(2.0 * 2.1 * 1.9 * 2.0, 2);
    expect(card.combined_prob).toBeCloseTo(0.5 * 0.48 * 0.55 * 0.5, 4);
    expect(card.card_id).toBeTruthy();
  });

  it('accepts card with 3 legs (one market missing)', () => {
    const legs = [
      mkLeg('Chutes 1º Tempo · Casa', 2.0, 0.5, 5),
      mkLeg('Chutes 1º Tempo · Fora', 2.0, 0.5, 5),
      mkLeg('Escanteios 1º Tempo · Casa', 1.9, 0.5, 5),
    ];
    const card = _buildHtChutesCard(legs);
    expect(card).not.toBeNull();
    expect(card.n_legs).toBe(3);
  });

  it('rejects card with <3 legs', () => {
    const legs = [
      mkLeg('Chutes 1º Tempo · Casa', 2.0, 0.5, 5),
      mkLeg('Chutes 1º Tempo · Fora', 2.0, 0.5, 5),
    ];
    expect(_buildHtChutesCard(legs)).toBeNull();
  });

  it('picks the best leg per (market, side) when duplicates exist', () => {
    const legs = [
      mkLeg('Chutes 1º Tempo · Casa', 2.0, 0.5, 5),
      mkLeg('Chutes 1º Tempo · Casa', 2.5, 0.6, 10),
      mkLeg('Chutes 1º Tempo · Fora', 2.0, 0.5, 5),
      mkLeg('Escanteios 1º Tempo · Casa', 2.0, 0.5, 5),
    ];
    const card = _buildHtChutesCard(legs);
    expect(card.n_legs).toBe(3);
    const casaChutes = card.legs.find(l => l.stat === 'Chutes 1º Tempo · Casa');
    expect(casaChutes.odd).toBe(2.5);
  });

  it('attaches tier_class based on combined_odd', () => {
    // 2*2.5*2*2 = 20 → cards
    const legs = [
      mkLeg('Chutes 1º Tempo · Casa', 2.0, 0.5, 5),
      mkLeg('Chutes 1º Tempo · Fora', 2.5, 0.5, 5),
      mkLeg('Escanteios 1º Tempo · Casa', 2.0, 0.5, 5),
      mkLeg('Escanteios 1º Tempo · Fora', 2.0, 0.5, 5),
    ];
    const card = _buildHtChutesCard(legs);
    expect(card.tier_class).toBe('cards');
  });
});

describe('buildHtChutes', () => {
  const fourLegMatch = (matchName) => [
    { match: matchName, stat: 'Chutes 1º Tempo · Casa', odd: 2.0, prob: 0.5, ev_pct: 5 },
    { match: matchName, stat: 'Chutes 1º Tempo · Fora', odd: 2.0, prob: 0.5, ev_pct: 5 },
    { match: matchName, stat: 'Escanteios 1º Tempo · Casa', odd: 2.0, prob: 0.5, ev_pct: 5 },
    { match: matchName, stat: 'Escanteios 1º Tempo · Fora', odd: 2.0, prob: 0.5, ev_pct: 5 },
  ];

  it('builds one card per match with 4 legs', () => {
    const pool = [
      ...fourLegMatch('A v B'),
      ...fourLegMatch('C v D'),
    ];
    const result = buildHtChutes(pool);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].n_legs).toBe(4);
  });

  it('skips matches with <3 valid legs', () => {
    const pool = [
      ...fourLegMatch('A v B'),
      { match: 'C v D', stat: 'Chutes 1º Tempo · Casa', odd: 2.0, prob: 0.5, ev_pct: 5 },
    ];
    const result = buildHtChutes(pool);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].match).toBe('A v B');
  });

  it('orders cards by combined_prob DESC', () => {
    const lowProb = fourLegMatch('Low v Low').map(l => ({ ...l, prob: 0.3 }));
    const highProb = fourLegMatch('High v High').map(l => ({ ...l, prob: 0.7 }));
    const result = buildHtChutes([...lowProb, ...highProb]);
    expect(result.cards[0].match).toBe('High v High');
  });

  it('ignores legs outside odd range 1.25-4.0 (F2.55: limiar baixado)', () => {
    const tooLow  = fourLegMatch('Low v Low').map(l => ({ ...l, odd: 1.2 }));
    const tooHigh = fourLegMatch('High v High').map(l => ({ ...l, odd: 5.0 }));
    const result = buildHtChutes([...tooLow, ...tooHigh]);
    expect(result.cards).toHaveLength(0);
  });

  it('returns empty arrays for empty pool', () => {
    const result = buildHtChutes([]);
    // F2.66c: shape estendido com quintas/sextas/setimas/oitavas
    expect(result.cards).toEqual([]);
    expect(result.duplas).toEqual([]);
    expect(result.triplas).toEqual([]);
    expect(result.quadras).toEqual([]);
  });
});

describe('_classifyTier', () => {
  it('returns "cards" for combined_odd < 100', () => {
    expect(_classifyTier(99.99)).toBe('cards');
    expect(_classifyTier(50)).toBe('cards');
    expect(_classifyTier(1)).toBe('cards');
  });

  it('returns "conservador" for 100 <= odd < 10000', () => {
    expect(_classifyTier(100)).toBe('conservador');
    expect(_classifyTier(500)).toBe('conservador');
    expect(_classifyTier(9999.99)).toBe('conservador');
  });

  it('returns "agressivo" for odd >= 10000', () => {
    expect(_classifyTier(10000)).toBe('agressivo');
    expect(_classifyTier(50000)).toBe('agressivo');
  });

  it('returns "cards" for invalid/missing odd', () => {
    expect(_classifyTier(null)).toBe('cards');
    expect(_classifyTier(undefined)).toBe('cards');
    expect(_classifyTier(0)).toBe('cards');
    expect(_classifyTier(NaN)).toBe('cards');
  });
});

describe('_pickTopCombos', () => {
  const mkCard = (matchName, odd, prob) => ({
    method: 'ht_chutes',
    match: matchName,
    combined_odd: odd,
    combined_prob: prob,
    ev_pct: (prob * odd - 1) * 100,
    legs: [],
    n_legs: 4,
  });

  it('generates C(N,2) combos when k=2', () => {
    const cards = [
      mkCard('A v B', 10, 0.5),
      mkCard('C v D', 10, 0.5),
      mkCard('E v F', 10, 0.5),
    ];
    const combos = _pickTopCombos(cards, 2, 100);
    expect(combos).toHaveLength(3);
  });

  it('generates C(N,4) combos when k=4', () => {
    const cards = Array.from({ length: 5 }, (_, i) => mkCard(`M${i}`, 10, 0.5));
    const combos = _pickTopCombos(cards, 4, 100);
    expect(combos).toHaveLength(5);
  });

  it('never combines two cards of same match', () => {
    const cards = [
      mkCard('A v B', 10, 0.5),
      mkCard('A v B', 12, 0.4),
      mkCard('C v D', 10, 0.5),
    ];
    const combos = _pickTopCombos(cards, 2, 100);
    expect(combos).toHaveLength(2);
    for (const c of combos) {
      const matches = c.cards.map(card => card.match);
      expect(new Set(matches).size).toBe(matches.length);
    }
  });

  it('caps output at maxOut', () => {
    const cards = Array.from({ length: 10 }, (_, i) => mkCard(`M${i}`, 10, 0.5));
    const combos = _pickTopCombos(cards, 2, 5);
    expect(combos.length).toBeLessThanOrEqual(5);
  });

  it('returns empty for insufficient cards', () => {
    const cards = [mkCard('A v B', 10, 0.5)];
    expect(_pickTopCombos(cards, 2, 10)).toHaveLength(0);
    expect(_pickTopCombos(cards, 4, 10)).toHaveLength(0);
  });

  it('orders combos by combined EV DESC', () => {
    const cards = [
      mkCard('A v B', 10, 0.5),
      mkCard('C v D', 20, 0.5),
      mkCard('E v F', 5,  0.5),
    ];
    const combos = _pickTopCombos(cards, 2, 10);
    expect(combos[0].cards.map(c => c.match).sort()).toEqual(['A v B', 'C v D']);
  });
});

describe('buildHtChutes — Duplas/Quadras', () => {
  const fourLegMatch = (matchName) => [
    { match: matchName, stat: 'Chutes 1º Tempo · Casa', odd: 2.0, prob: 0.5, ev_pct: 5 },
    { match: matchName, stat: 'Chutes 1º Tempo · Fora', odd: 2.0, prob: 0.5, ev_pct: 5 },
    { match: matchName, stat: 'Escanteios 1º Tempo · Casa', odd: 2.0, prob: 0.5, ev_pct: 5 },
    { match: matchName, stat: 'Escanteios 1º Tempo · Fora', odd: 2.0, prob: 0.5, ev_pct: 5 },
  ];

  it('produces Duplas when >=2 cards exist', () => {
    const pool = [
      ...fourLegMatch('A v B'),
      ...fourLegMatch('C v D'),
    ];
    const result = buildHtChutes(pool);
    expect(result.duplas.length).toBeGreaterThan(0);
    expect(result.duplas[0].n_cards).toBe(2);
  });

  it('produces Quadras when >=4 cards exist', () => {
    const pool = [
      ...fourLegMatch('A v B'),
      ...fourLegMatch('C v D'),
      ...fourLegMatch('E v F'),
      ...fourLegMatch('G v H'),
    ];
    const result = buildHtChutes(pool);
    expect(result.quadras.length).toBeGreaterThan(0);
    expect(result.quadras[0].n_cards).toBe(4);
  });

  it('produces zero Quadras when <4 cards', () => {
    const pool = [
      ...fourLegMatch('A v B'),
      ...fourLegMatch('C v D'),
      ...fourLegMatch('E v F'),
    ];
    const result = buildHtChutes(pool);
    expect(result.quadras).toHaveLength(0);
  });

  it('caps Duplas at 10 and Quadras at 5', () => {
    const matches = Array.from({ length: 12 }, (_, i) =>
      fourLegMatch(`M${i} v M${i}b`)
    ).flat();
    const result = buildHtChutes(matches);
    expect(result.duplas.length).toBeLessThanOrEqual(10);
    expect(result.quadras.length).toBeLessThanOrEqual(5);
  });
});

describe('buildFaixaResultBtts', () => {
  const resultLeg  = (m, odd=2.0, prob=0.5) => ({
    match: m, stat: 'Resultado Final', odd, prob, ev_pct: 0,
  });
  const bttsLeg    = (m, odd=2.0, prob=0.5) => ({
    match: m, stat: 'Ambos os Times Marcarem', odd, prob, ev_pct: 0,
  });

  it('builds card with exactly 2 legs (Resultado + BTTS)', () => {
    const pool = [resultLeg('A v B'), bttsLeg('A v B')];
    const result = buildFaixaResultBtts(pool);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].n_legs).toBe(2);
    expect(result.cards[0].method).toBe('faixa_result_btts');
  });

  it('skips match without Resultado Final', () => {
    const pool = [bttsLeg('A v B')];
    const result = buildFaixaResultBtts(pool);
    expect(result.cards).toHaveLength(0);
  });

  it('skips match without BTTS', () => {
    const pool = [resultLeg('A v B')];
    const result = buildFaixaResultBtts(pool);
    expect(result.cards).toHaveLength(0);
  });

  it('combined_odd = odd_result * odd_btts', () => {
    const pool = [resultLeg('A v B', 2.5), bttsLeg('A v B', 1.8)];
    const result = buildFaixaResultBtts(pool);
    expect(result.cards[0].combined_odd).toBeCloseTo(2.5 * 1.8, 2);
  });

  it('produces Duplas and Quadras like HT-Chutes', () => {
    const pool = [
      resultLeg('A v B'), bttsLeg('A v B'),
      resultLeg('C v D'), bttsLeg('C v D'),
      resultLeg('E v F'), bttsLeg('E v F'),
      resultLeg('G v H'), bttsLeg('G v H'),
    ];
    const result = buildFaixaResultBtts(pool);
    expect(result.cards).toHaveLength(4);
    expect(result.duplas.length).toBeGreaterThan(0);
    expect(result.quadras.length).toBeGreaterThan(0);
  });

  it('returns empty for empty pool', () => {
    const r = buildFaixaResultBtts([]);
    expect(r.cards).toEqual([]);
    expect(r.duplas).toEqual([]);
    expect(r.quadras).toEqual([]);
  });
});

describe('buildFaixaMethods — top-level', () => {
  it('calls both methods and returns combined output', () => {
    const pool = [
      { match: 'A v B', stat: 'Chutes 1º Tempo · Casa', odd: 2.0, prob: 0.5, ev_pct: 5 },
      { match: 'A v B', stat: 'Chutes 1º Tempo · Fora', odd: 2.0, prob: 0.5, ev_pct: 5 },
      { match: 'A v B', stat: 'Escanteios 1º Tempo · Casa', odd: 2.0, prob: 0.5, ev_pct: 5 },
      { match: 'A v B', stat: 'Escanteios 1º Tempo · Fora', odd: 2.0, prob: 0.5, ev_pct: 5 },
      { match: 'C v D', stat: 'Resultado Final', odd: 2.5, prob: 0.5, ev_pct: 5 },
      { match: 'C v D', stat: 'Ambos os Times Marcarem', odd: 1.9, prob: 0.6, ev_pct: 5 },
    ];
    const result = buildFaixaMethods(pool);
    expect(result.ht_chutes.cards).toHaveLength(1);
    expect(result.faixa_result_btts.cards).toHaveLength(1);
  });

  it('returns empty structure when given null/undefined', () => {
    // F2.66c+/F2.87: shape estendido com sextas/setimas/oitavas + mega_quadras + superodd
    const r1 = buildFaixaMethods(null);
    const r2 = buildFaixaMethods(undefined);
    for (const r of [r1, r2]) {
      expect(r.ht_chutes.cards).toEqual([]);
      expect(r.faixa_result_btts.cards).toEqual([]);
      expect(r.libertadores.cards).toEqual([]);
      expect(r.resultado.cards).toEqual([]);
      expect(r.chutes.cards).toEqual([]);
    }
  });

  it('does not throw on malformed legs', () => {
    expect(() => buildFaixaMethods([
      null,
      { match: 'X v Y' },
      { stat: 'Chutes 1º Tempo · Casa', odd: 'lol' },
    ])).not.toThrow();
  });
});
