// tests/virtualGameFilterR6KF2_2.test.js — P3.9 R6K-F2.2
// Cobre isVirtualOrCrossport + comboHasVirtual. Casos derivados de leak real
// observado em produção pós R6K-DEPLOY1 (print do operador mostrando jogos
// como "Galatasaray (Viper) v Bodo/Glimt (Arthur)").

import { describe, it, expect } from 'vitest';
import {
  NBA_WORDS,
  VIRTUAL_PARENS_PATTERN,
  REAL_TEAM_PARENS_WHITELIST,
  isVirtualOrCrossport,
  comboHasVirtual,
} from '../src/services/virtualGameFilter.js';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2.2 — VIRTUAL_PARENS_PATTERN matches gamertag', () => {
  it.each([
    ['Galatasaray (Viper)',         true],
    ['PSG (THREAT)',                true],
    ['Spain (KraftVK)',             true],
    ['Fenerbahce (MeLToSiK)',       true],
    ['England (mko1919)',           true],
    ['FC Salzburg (DaVa)',          true],
    ['Aston Villa (Boulevard)',     true],
    ['Bodo/Glimt (Arthur)',         true],
    ['Real Madrid (Banega)',        true],
    ['Villarreal (David)',          true],
    ['A.Madrid (Crysis)',           true],
    ['Bayern (JAEGER)',             true],
    ['Argentina (Uncle)',           true],
    // Casos negativos: nomes reais
    ['Flamengo',                    false],
    ['Cusco FC',                    false],
    ['Sao Paulo',                   false],
    ['Boston River',                false],
    ['FC Porto',                    false],
    ['Orebro SK',                   false],
    ['Greuther Furth',              false],
    ["O'Higgins",                   false],
    ['Rot-Weiss Essen',             false],
    ['Helsingborg',                 false],
    ['St Etienne',                  false],
    ['Nice',                        false],
    ['Millonarios',                 false],
    ['Deportivo Cuenca',            false],
  ])('"%s" → match=%s', (name, expected) => {
    expect(VIRTUAL_PARENS_PATTERN.test(name)).toBe(expected);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2.2 — isVirtualOrCrossport: virtual/FIFA detection', () => {
  it('home_team com gamertag → virtual', () => {
    expect(isVirtualOrCrossport({ home_team: 'Galatasaray (Viper)', away_team: 'Bodo/Glimt' })).toBe(true);
  });

  it('away_team com gamertag → virtual', () => {
    expect(isVirtualOrCrossport({ home_team: 'PSG', away_team: 'Bayern (JAEGER)' })).toBe(true);
  });

  it('match string com gamertag → virtual', () => {
    expect(isVirtualOrCrossport({ match: 'Galatasaray (Viper) v Bodo/Glimt (Arthur)' })).toBe(true);
  });

  it('ambos os times reais → não virtual', () => {
    expect(isVirtualOrCrossport({ home_team: 'Flamengo', away_team: 'Cusco FC' })).toBe(false);
  });

  it('jogos reais do print (caso negativo)', () => {
    const real = [
      { home_team: 'Sao Paulo', away_team: 'Boston River' },
      { home_team: 'Orebro SK', away_team: 'Helsingborg' },
      { home_team: 'St Etienne', away_team: 'Nice' },
      { home_team: 'Millonarios', away_team: "O'Higgins" },
      { home_team: 'Greuther Furth', away_team: 'Rot-Weiss Essen' },
      { home_team: 'San Lorenzo', away_team: 'Deportivo Recoleta' },
    ];
    for (const p of real) expect(isVirtualOrCrossport(p)).toBe(false);
  });

  it('jogos virtuais do print (caso positivo)', () => {
    const virtual = [
      { home_team: 'Galatasaray (Viper)', away_team: 'Bodo/Glimt (Arthur)' },
      { home_team: 'PSG (THREAT)', away_team: 'Bayern (JAEGER)' },
      { home_team: 'Spain (KraftVK)', away_team: 'Argentina (Uncle)' },
      { home_team: 'Fenerbahce (MeLToSiK)', away_team: 'Aston Villa (Boulevard)' },
      { home_team: 'England (mko1919)', away_team: 'Germany (nikklitta)' },
      { home_team: 'FC Salzburg (DaVa)', away_team: 'FC Porto (Revange)' },
    ];
    for (const p of virtual) expect(isVirtualOrCrossport(p)).toBe(true);
  });

  it('null/undefined/{} → não throw, retorna false', () => {
    expect(isVirtualOrCrossport(null)).toBe(false);
    expect(isVirtualOrCrossport(undefined)).toBe(false);
    expect(isVirtualOrCrossport({})).toBe(false);
  });

  it('só home_team preenchido (sem virtual) → false', () => {
    expect(isVirtualOrCrossport({ home_team: 'Real Madrid' })).toBe(false);
  });

  it('match formato "Casa v Fora" virtual → true', () => {
    expect(isVirtualOrCrossport({
      match: 'Manchester United (Pro) v Chelsea (King)',
    })).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2.2 — isVirtualOrCrossport: cross-sport NBA leak', () => {
  it('home_team "Lakers" + sport=football → cross-sport', () => {
    expect(isVirtualOrCrossport({ home_team: 'Lakers', away_team: 'Boston' }, { sport: 'football' })).toBe(true);
  });

  it('"Magic" em sport=football → cross-sport', () => {
    expect(isVirtualOrCrossport({ home_team: 'Magic', away_team: 'Heat' }, { sport: 'football' })).toBe(true);
  });

  it('NBA team em sport=basketball → NÃO bloqueia (correto)', () => {
    expect(isVirtualOrCrossport({ home_team: 'Lakers', away_team: 'Celtics' }, { sport: 'basketball' })).toBe(false);
  });

  it('default sport=football quando não passado', () => {
    expect(isVirtualOrCrossport({ home_team: 'Warriors', away_team: 'Bulls' })).toBe(true);
  });

  it('time real não-NBA + sport=football → false', () => {
    expect(isVirtualOrCrossport({ home_team: 'Real Madrid', away_team: 'Barcelona' }, { sport: 'football' })).toBe(false);
  });

  it('abreviações NBA (LAL, GSW, BOS, ...) detectadas', () => {
    expect(isVirtualOrCrossport({ home_team: 'LAL', away_team: 'BOS' })).toBe(true);
    expect(isVirtualOrCrossport({ home_team: 'GSW', away_team: 'MIA' })).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2.2 — comboHasVirtual', () => {
  it('combo com nenhuma leg virtual → false', () => {
    expect(comboHasVirtual({
      legs: [
        { home_team: 'Flamengo', away_team: 'Cusco FC' },
        { home_team: 'Sao Paulo', away_team: 'Boston River' },
      ],
    })).toBe(false);
  });

  it('combo com 1 leg virtual → true (bloqueia combo inteiro)', () => {
    expect(comboHasVirtual({
      legs: [
        { home_team: 'Flamengo', away_team: 'Cusco FC' },
        { home_team: 'Galatasaray (Viper)', away_team: 'Bodo/Glimt (Arthur)' },
        { home_team: 'Sao Paulo', away_team: 'Boston River' },
      ],
    })).toBe(true);
  });

  it('combo TODAS legs virtuais → true', () => {
    expect(comboHasVirtual({
      legs: [
        { home_team: 'Galatasaray (Viper)', away_team: 'Bodo/Glimt (Arthur)' },
        { home_team: 'PSG (THREAT)', away_team: 'Bayern (JAEGER)' },
      ],
    })).toBe(true);
  });

  it('combo sem legs → false', () => {
    expect(comboHasVirtual({})).toBe(false);
    expect(comboHasVirtual({ legs: [] })).toBe(false);
  });

  it('null/undefined → false (defensive, não throw)', () => {
    expect(comboHasVirtual(null)).toBe(false);
    expect(comboHasVirtual(undefined)).toBe(false);
  });

  it('legs não-array → false', () => {
    expect(comboHasVirtual({ legs: 'not array' })).toBe(false);
    expect(comboHasVirtual({ legs: null })).toBe(false);
  });

  it('cross-sport NBA dentro do combo → true em sport=football', () => {
    expect(comboHasVirtual({
      legs: [
        { home_team: 'Flamengo', away_team: 'Cusco FC' },
        { home_team: 'Lakers', away_team: 'Celtics' },
      ],
    }, { sport: 'football' })).toBe(true);
  });

  it('cross-sport NBA dentro do combo → false em sport=basketball', () => {
    expect(comboHasVirtual({
      legs: [
        { home_team: 'Lakers', away_team: 'Celtics' },
      ],
    }, { sport: 'basketball' })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2.4 — REAL_TEAM_PARENS_WHITELIST (reduce false positives)', () => {
  it.each([
    ['(II)',         true],
    ['(III)',        true],
    ['(IV)',         true],
    ['(B)',          true],
    ['(C)',          true],
    ['(W)',          true],
    ['(F)',          true],
    ['(U17)',        true],
    ['(U19)',        true],
    ['(U20)',        true],
    ['(U21)',        true],
    ['(U23)',        true],
    ['(Reserves)',   true],
    ['(Reserve)',    true],
    ['(Sub)',        true],
    ['(CF)',         true],
    ['(FC)',         true],
    ['(SC)',         true],
    ['(Viper)',      false],
    ['(THREAT)',     false],
    ['(KraftVK)',    false],
    ['(MeLToSiK)',   false],
    ['(mko1919)',    false],
    ['(Boulevard)',  false],
    ['(Banega)',     false],
  ])('"%s" → whitelist match=%s', (paren, expected) => {
    expect(REAL_TEAM_PARENS_WHITELIST.test(paren)).toBe(expected);
  });
});

describe('R6K-F2.4 — isVirtualOrCrossport respects whitelist', () => {
  it('"Bayern Munich (II)" → NÃO virtual (reserva)', () => {
    expect(isVirtualOrCrossport({ home_team: 'Bayern Munich (II)', away_team: 'Stuttgart' })).toBe(false);
  });
  it('"Real Madrid (B)" → NÃO virtual', () => {
    expect(isVirtualOrCrossport({ home_team: 'Real Madrid (B)', away_team: 'Sevilla' })).toBe(false);
  });
  it('"Spain (U21)" → NÃO virtual', () => {
    expect(isVirtualOrCrossport({ home_team: 'Spain (U21)', away_team: 'Italy (U21)' })).toBe(false);
  });
  it('"Barcelona (W)" → NÃO virtual (feminino)', () => {
    expect(isVirtualOrCrossport({ home_team: 'Barcelona (W)', away_team: 'Real Madrid (W)' })).toBe(false);
  });

  // Mix: 1 whitelist + 1 gamertag = STILL virtual (qualquer leg gamertag bloqueia)
  it('"Bayern (II) v Real Madrid (Viper)" → virtual (gamertag presente)', () => {
    expect(isVirtualOrCrossport({
      home_team: 'Bayern (II)', away_team: 'Real Madrid (Viper)',
    })).toBe(true);
  });

  // Gamertag puro continua sendo virtual
  it('"Galatasaray (Viper)" → virtual (sem whitelist match)', () => {
    expect(isVirtualOrCrossport({ home_team: 'Galatasaray (Viper)', away_team: 'Bodo/Glimt' })).toBe(true);
  });

  // Edge: time real com 2 parens, ambos whitelist (raro)
  it('"FC Bayern (II) v Borussia (B)" → NÃO virtual', () => {
    expect(isVirtualOrCrossport({ home_team: 'FC Bayern (II)', away_team: 'Borussia (B)' })).toBe(false);
  });

  // Edge: time real + parens whitelist + match string
  it('match="FC Bayern (II) v Real Madrid (B)" → NÃO virtual', () => {
    expect(isVirtualOrCrossport({ match: 'FC Bayern (II) v Real Madrid (B)' })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2.2 — cenário real R6K-DEPLOY1 visual regression', () => {
  // Mega VIP "VENCEDOR + BTTS CONSERVADOR" com 18 jogos do print do operador.
  // Misturava jogos reais (Flamengo v Cusco FC, Sao Paulo v Boston River,
  // Nigeria v Zimbabwe, etc.) com virtuais (Galatasaray (Viper), PSG (THREAT),
  // Spain (KraftVK), England (mko1919), Fenerbahce (MeLToSiK), FC Salzburg (DaVa)).

  it('Mega completa do print é bloqueada por comboHasVirtual', () => {
    const megaFromPrint = {
      legs: [
        { home_team: 'Flamengo', away_team: 'Cusco FC' },
        { home_team: 'Galatasaray (Viper)', away_team: 'Bodo/Glimt (Arthur)' },  // virtual
        { home_team: 'Palestino', away_team: 'Deportivo Riestra' },
        { home_team: 'Sao Paulo', away_team: 'Boston River' },
        { home_team: 'England (mko1919)', away_team: 'Germany (nikklitta)' },     // virtual
        { home_team: 'Nigeria', away_team: 'Zimbabwe' },
        { home_team: 'Orebro SK', away_team: 'Helsingborg' },
        { home_team: 'St Etienne', away_team: 'Nice' },
        { home_team: 'Lanus', away_team: 'Mirassol' },
        { home_team: 'Santos', away_team: 'Deportivo Cuenca' },
        { home_team: 'PSG (THREAT)', away_team: 'Bayern (JAEGER)' },              // virtual
        { home_team: 'Spain (KraftVK)', away_team: 'Argentina (Uncle)' },         // virtual
        { home_team: 'Fenerbahce (MeLToSiK)', away_team: 'Aston Villa (Boulevard)' }, // virtual
        { home_team: 'Millonarios', away_team: "O'Higgins" },
        { home_team: 'Greuther Furth', away_team: 'Rot-Weiss Essen' },
        { home_team: 'FC Salzburg (DaVa)', away_team: 'FC Porto (Revange)' },     // virtual
        { home_team: 'San Lorenzo', away_team: 'Deportivo Recoleta' },
        { home_team: 'São Paulo', away_team: 'Boston River' },
      ],
    };
    expect(comboHasVirtual(megaFromPrint)).toBe(true);
  });

  it('Mega só com jogos reais NÃO é bloqueada', () => {
    const realOnlyMega = {
      legs: [
        { home_team: 'Flamengo', away_team: 'Cusco FC' },
        { home_team: 'Palestino', away_team: 'Deportivo Riestra' },
        { home_team: 'Sao Paulo', away_team: 'Boston River' },
        { home_team: 'Nigeria', away_team: 'Zimbabwe' },
        { home_team: 'Orebro SK', away_team: 'Helsingborg' },
      ],
    };
    expect(comboHasVirtual(realOnlyMega)).toBe(false);
  });
});
