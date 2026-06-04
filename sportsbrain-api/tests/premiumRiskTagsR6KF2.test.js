// tests/premiumRiskTagsR6KF2.test.js — P3.9 R6K-F2
// Cobre computeRiskTags + annotateRiskTags + sortTagsByPriority.

import { describe, it, expect } from 'vitest';
import {
  RISK_TAGS,
  ALTA_VARIANCIA_AUTO_MARKETS,
  TAG_ORDER,
  computeRiskTags,
  annotateRiskTags,
  annotateRiskTagsArray,
  sortTagsByPriority,
} from '../src/services/premiumRiskTags.js';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — constantes', () => {
  it('RISK_TAGS expõe 16 tags frozen', () => {
    expect(RISK_TAGS.length).toBe(16);
    expect(Object.isFrozen(RISK_TAGS)).toBe(true);
    expect(RISK_TAGS).toContain('LAB');
    expect(RISK_TAGS).toContain('WATCH');
    expect(RISK_TAGS).toContain('MEGA_ILUSORIO');
    expect(RISK_TAGS).toContain('FAIXA');
    expect(RISK_TAGS).toContain('HISTORICO_FORTE');
  });

  it('ALTA_VARIANCIA_AUTO_MARKETS = [CORRECT_SCORE, HT_FT] (NÃO inclui DNB)', () => {
    expect([...ALTA_VARIANCIA_AUTO_MARKETS]).toEqual(['CORRECT_SCORE', 'HT_FT']);
    expect(ALTA_VARIANCIA_AUTO_MARKETS).not.toContain('DRAW_NO_BET');
    expect(Object.isFrozen(ALTA_VARIANCIA_AUTO_MARKETS)).toBe(true);
  });

  it('TAG_ORDER cobre todas as 16 tags', () => {
    expect(TAG_ORDER.length).toBe(16);
    for (const t of RISK_TAGS) expect(TAG_ORDER).toContain(t);
  });

  it('TAG_ORDER: MEGA_ILUSORIO é mais crítica, LAB é última', () => {
    expect(TAG_ORDER[0]).toBe('MEGA_ILUSORIO');
    expect(TAG_ORDER[TAG_ORDER.length - 1]).toBe('LAB');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — computeRiskTags: LAB sempre presente', () => {
  it('item vazio → ["LAB"]', () => {
    expect(computeRiskTags({})).toEqual(['LAB']);
  });

  it('null → ["LAB"] (defensive)', () => {
    expect(computeRiskTags(null)).toEqual(['LAB']);
  });

  it('undefined → ["LAB"]', () => {
    expect(computeRiskTags(undefined)).toEqual(['LAB']);
  });

  it('item complexo sempre inclui LAB', () => {
    const tags = computeRiskTags({ ev_pct: 10, legs: [{}, {}], combined_odd: 600 });
    expect(tags).toContain('LAB');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — EV tags (ajuste #1: QUALQUER ev<0 → EV_NEGATIVO)', () => {
  it('ev_pct=5 → EV_POSITIVO', () => {
    expect(computeRiskTags({ ev_pct: 5 })).toContain('EV_POSITIVO');
  });

  it('ev_pct=0 → EV_NEUTRO', () => {
    expect(computeRiskTags({ ev_pct: 0 })).toContain('EV_NEUTRO');
  });

  it('ev_pct=-0.1 → EV_NEGATIVO (ajuste #1: não-limitado a [-5, 0))', () => {
    expect(computeRiskTags({ ev_pct: -0.1 })).toContain('EV_NEGATIVO');
  });

  it('ev_pct=-3 → EV_NEGATIVO', () => {
    expect(computeRiskTags({ ev_pct: -3 })).toContain('EV_NEGATIVO');
  });

  it('ev_pct=-50 → EV_NEGATIVO (ajuste #1: grave também tagueado)', () => {
    expect(computeRiskTags({ ev_pct: -50 })).toContain('EV_NEGATIVO');
  });

  it('ev_pct=-79.82 (caso real R6K-A) → EV_NEGATIVO', () => {
    expect(computeRiskTags({ ev_pct: -79.82 })).toContain('EV_NEGATIVO');
  });

  it('ev_pct ausente → não tem EV_* tag (exceto LAB)', () => {
    const tags = computeRiskTags({ market: '1X2' });
    expect(tags).not.toContain('EV_POSITIVO');
    expect(tags).not.toContain('EV_NEUTRO');
    expect(tags).not.toContain('EV_NEGATIVO');
  });

  it('ev_pct=NaN → sem tag EV', () => {
    const tags = computeRiskTags({ ev_pct: NaN });
    expect(tags).not.toContain('EV_POSITIVO');
    expect(tags).not.toContain('EV_NEGATIVO');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — mercado tags', () => {
  it('market=CORRECT_SCORE → CORRECT_SCORE + ALTA_VARIANCIA + WATCH', () => {
    const tags = computeRiskTags({ market: 'CORRECT_SCORE', ev_pct: 5 });
    expect(tags).toContain('CORRECT_SCORE');
    expect(tags).toContain('ALTA_VARIANCIA');
    expect(tags).toContain('WATCH');
  });

  it('market="Placar Exato" (português) → CORRECT_SCORE', () => {
    expect(computeRiskTags({ market: 'Placar Exato' })).toContain('CORRECT_SCORE');
  });

  it('market=HT_FT → HT_FT + ALTA_VARIANCIA + WATCH', () => {
    const tags = computeRiskTags({ market: 'HT_FT' });
    expect(tags).toContain('HT_FT');
    expect(tags).toContain('ALTA_VARIANCIA');
    expect(tags).toContain('WATCH');
  });

  it('market="Intervalo/Final" → HT_FT', () => {
    expect(computeRiskTags({ market: 'Intervalo/Final' })).toContain('HT_FT');
  });

  it('market=DRAW_NO_BET → DRAW_NO_BET MAS NÃO ALTA_VARIANCIA (regra explícita)', () => {
    const tags = computeRiskTags({ market: 'DRAW_NO_BET' });
    expect(tags).toContain('DRAW_NO_BET');
    expect(tags).not.toContain('ALTA_VARIANCIA');
    expect(tags).not.toContain('WATCH');  // DNB sozinha não dispara WATCH
  });

  it('market="Sem empate" (português) → DRAW_NO_BET', () => {
    expect(computeRiskTags({ market: 'Sem Empate' })).toContain('DRAW_NO_BET');
  });

  it('market=BTTS → nenhuma tag de mercado especial', () => {
    const tags = computeRiskTags({ market: 'BTTS', ev_pct: 3 });
    expect(tags).not.toContain('CORRECT_SCORE');
    expect(tags).not.toContain('HT_FT');
    expect(tags).not.toContain('DRAW_NO_BET');
    expect(tags).not.toContain('ALTA_VARIANCIA');
  });

  it('stat usado como fallback de market', () => {
    expect(computeRiskTags({ stat: 'CORRECT_SCORE' })).toContain('CORRECT_SCORE');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — tier tags', () => {
  it('tier=tier3 → JACKPOT', () => {
    expect(computeRiskTags({ tier: 'tier3' })).toContain('JACKPOT');
  });

  it('tier=tier4 → MEGA', () => {
    expect(computeRiskTags({ tier: 'tier4' })).toContain('MEGA');
  });

  it('_tier=tier4 → MEGA', () => {
    expect(computeRiskTags({ _tier: 'tier4' })).toContain('MEGA');
  });

  it('tier=tier1 → sem JACKPOT/MEGA', () => {
    const tags = computeRiskTags({ tier: 'tier1' });
    expect(tags).not.toContain('JACKPOT');
    expect(tags).not.toContain('MEGA');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — FAIXA tag', () => {
  it('is_faixa=true → FAIXA', () => {
    expect(computeRiskTags({ is_faixa: true })).toContain('FAIXA');
  });

  it('_is_faixa_mirror=true → FAIXA', () => {
    expect(computeRiskTags({ _is_faixa_mirror: true })).toContain('FAIXA');
  });

  it('source=faixa_mirror → FAIXA', () => {
    expect(computeRiskTags({ source: 'faixa_mirror' })).toContain('FAIXA');
  });

  it('combo com leg faixa_mirror → FAIXA', () => {
    expect(computeRiskTags({ legs: [{ _is_faixa_mirror: true }] })).toContain('FAIXA');
  });

  it('item sem sinal de FAIXA → tag ausente', () => {
    expect(computeRiskTags({ ev_pct: 5 })).not.toContain('FAIXA');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — TELEGRAM_STYLE tag', () => {
  it('source=telegram_tipster → TELEGRAM_STYLE', () => {
    expect(computeRiskTags({ source: 'telegram_tipster' })).toContain('TELEGRAM_STYLE');
  });

  it('_is_telegram_tip=true → TELEGRAM_STYLE', () => {
    expect(computeRiskTags({ _is_telegram_tip: true })).toContain('TELEGRAM_STYLE');
  });

  it('_origin=tipster → TELEGRAM_STYLE', () => {
    expect(computeRiskTags({ _origin: 'tipster' })).toContain('TELEGRAM_STYLE');
  });

  it('source=tipster_paganelle → TELEGRAM_STYLE (prefix match)', () => {
    expect(computeRiskTags({ source: 'tipster_paganelle' })).toContain('TELEGRAM_STYLE');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — EV_AGREGADO_NEGATIVO (só em combos)', () => {
  it('combo ev_pct=-5 + legs → EV_AGREGADO_NEGATIVO', () => {
    const tags = computeRiskTags({ ev_pct: -5, legs: [{ ev_pct: 3 }] });
    expect(tags).toContain('EV_AGREGADO_NEGATIVO');
    expect(tags).toContain('EV_NEGATIVO');  // ajuste #1 também dispara
    expect(tags).toContain('WATCH');
  });

  it('combo ev_pct=5 + legs → SEM EV_AGREGADO_NEGATIVO', () => {
    const tags = computeRiskTags({ ev_pct: 5, legs: [{ ev_pct: 3 }] });
    expect(tags).not.toContain('EV_AGREGADO_NEGATIVO');
  });

  it('single avulso ev_pct=-10 → EV_NEGATIVO mas NÃO EV_AGREGADO_NEGATIVO', () => {
    const tags = computeRiskTags({ ev_pct: -10, market: '1X2' });
    expect(tags).toContain('EV_NEGATIVO');
    expect(tags).not.toContain('EV_AGREGADO_NEGATIVO');
  });

  it('combo via _is_combo flag também dispara', () => {
    const tags = computeRiskTags({ ev_pct: -3, _is_combo: true });
    expect(tags).toContain('EV_AGREGADO_NEGATIVO');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — MEGA_ILUSORIO', () => {
  // MEGA_ILUSORIO = long_shot (combined_odd>=500) + EV_AGREGADO_NEGATIVO

  it('combo long_shot + EV_AGREGADO_NEGATIVO → MEGA_ILUSORIO + WATCH', () => {
    const tags = computeRiskTags({
      ev_pct: -30, legs: [{}, {}, {}], combined_odd: 5000,
    });
    expect(tags).toContain('MEGA_ILUSORIO');
    expect(tags).toContain('EV_AGREGADO_NEGATIVO');
    expect(tags).toContain('WATCH');
  });

  it('combo long_shot mas EV agregado positivo → SEM MEGA_ILUSORIO', () => {
    const tags = computeRiskTags({
      ev_pct: 5, legs: [{}, {}], combined_odd: 1000,
    });
    expect(tags).not.toContain('MEGA_ILUSORIO');
  });

  it('combo com EV neg mas combined_odd<500 → SEM MEGA_ILUSORIO', () => {
    const tags = computeRiskTags({
      ev_pct: -5, legs: [{}, {}], combined_odd: 200,
    });
    expect(tags).not.toContain('MEGA_ILUSORIO');
    expect(tags).toContain('EV_AGREGADO_NEGATIVO');
  });

  it('design_verdict=long_shot já-anotado + EV neg → MEGA_ILUSORIO', () => {
    const tags = computeRiskTags({
      ev_pct: -10, legs: [{}, {}], design_verdict: 'long_shot',
    });
    expect(tags).toContain('MEGA_ILUSORIO');
  });

  it('single avulso com odd=999 + ev_pct=-50 → SEM MEGA_ILUSORIO (não é combo)', () => {
    const tags = computeRiskTags({ ev_pct: -50, market: '1X2', odd: 999 });
    expect(tags).not.toContain('MEGA_ILUSORIO');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — WATCH derivada', () => {
  it('item com ALTA_VARIANCIA → WATCH', () => {
    expect(computeRiskTags({ market: 'CORRECT_SCORE' })).toContain('WATCH');
  });

  it('item com EV_AGREGADO_NEGATIVO → WATCH', () => {
    expect(computeRiskTags({ ev_pct: -3, legs: [{}] })).toContain('WATCH');
  });

  it('item normal sem alta variância e ev>0 → SEM WATCH', () => {
    const tags = computeRiskTags({ ev_pct: 5, market: 'BTTS' });
    expect(tags).not.toContain('WATCH');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — HISTORICO_FORTE (R6K-F3 popula)', () => {
  it('sem wr_history → ausente', () => {
    expect(computeRiskTags({ ev_pct: 5 })).not.toContain('HISTORICO_FORTE');
  });

  it('wr_history.strong=true → HISTORICO_FORTE', () => {
    expect(computeRiskTags({ ev_pct: 5, wr_history: { strong: true } })).toContain('HISTORICO_FORTE');
  });

  it('wr_history.wr=0.7 + n=50 → HISTORICO_FORTE', () => {
    expect(computeRiskTags({ wr_history: { wr: 0.7, n: 50 } })).toContain('HISTORICO_FORTE');
  });

  it('wr_history.wr=0.8 + n=10 (sample baixa) → NÃO HISTORICO_FORTE', () => {
    expect(computeRiskTags({ wr_history: { wr: 0.8, n: 10 } })).not.toContain('HISTORICO_FORTE');
  });

  it('wr_history.wr=0.5 + n=100 (WR baixa) → NÃO HISTORICO_FORTE', () => {
    expect(computeRiskTags({ wr_history: { wr: 0.5, n: 100 } })).not.toContain('HISTORICO_FORTE');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — annotateRiskTags', () => {
  it('muta item.risk_tags', () => {
    const item = { ev_pct: 10, market: 'BTTS' };
    annotateRiskTags(item);
    expect(item.risk_tags).toContain('LAB');
    expect(item.risk_tags).toContain('EV_POSITIVO');
  });

  it('null → noop', () => {
    expect(annotateRiskTags(null)).toBeNull();
  });

  it('idempotente', () => {
    const item = { ev_pct: 5 };
    annotateRiskTags(item);
    const first = [...item.risk_tags];
    annotateRiskTags(item);
    expect(item.risk_tags).toEqual(first);
  });

  it('retorna o item', () => {
    const item = { ev_pct: 1 };
    expect(annotateRiskTags(item)).toBe(item);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — annotateRiskTagsArray', () => {
  it('anota array em-place', () => {
    const arr = [
      { ev_pct: 10 },
      { ev_pct: -5, legs: [{}, {}], combined_odd: 1000 },
    ];
    const n = annotateRiskTagsArray(arr);
    expect(n).toBe(2);
    expect(arr[0].risk_tags).toContain('EV_POSITIVO');
    expect(arr[1].risk_tags).toContain('MEGA_ILUSORIO');
  });

  it('null/non-array → 0', () => {
    expect(annotateRiskTagsArray(null)).toBe(0);
    expect(annotateRiskTagsArray({})).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — sortTagsByPriority', () => {
  it('ordena MEGA_ILUSORIO antes de LAB', () => {
    const sorted = sortTagsByPriority(['LAB', 'MEGA_ILUSORIO']);
    expect(sorted).toEqual(['MEGA_ILUSORIO', 'LAB']);
  });

  it('respeita TAG_ORDER completo', () => {
    const sorted = sortTagsByPriority(['HISTORICO_FORTE', 'WATCH', 'EV_POSITIVO', 'LAB']);
    expect(sorted).toEqual(['WATCH', 'EV_POSITIVO', 'HISTORICO_FORTE', 'LAB']);
  });

  it('tags desconhecidas vão para o final', () => {
    const sorted = sortTagsByPriority(['UNKNOWN_TAG', 'LAB']);
    expect(sorted[sorted.length - 1]).toBe('UNKNOWN_TAG');
    expect(sorted[0]).toBe('LAB');  // LAB conhecida vem antes
  });

  it('array vazio → []', () => {
    expect(sortTagsByPriority([])).toEqual([]);
  });

  it('null/non-array → []', () => {
    expect(sortTagsByPriority(null)).toEqual([]);
  });

  it('não muta input', () => {
    const input = ['LAB', 'MEGA_ILUSORIO'];
    sortTagsByPriority(input);
    expect(input).toEqual(['LAB', 'MEGA_ILUSORIO']);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F2 — cenários reais de produção', () => {
  it('Mega ilusório clássico (caso central do produto)', () => {
    const item = {
      ev_pct: -79.82,
      combined_odd: 50000,
      legs: [{ ev_pct: 0 }, { ev_pct: 0 }, { ev_pct: -10 }],
      tier: 'tier4',
    };
    const tags = computeRiskTags(item);
    expect(tags).toContain('LAB');
    expect(tags).toContain('MEGA');
    expect(tags).toContain('MEGA_ILUSORIO');
    expect(tags).toContain('EV_AGREGADO_NEGATIVO');
    expect(tags).toContain('EV_NEGATIVO');
    expect(tags).toContain('WATCH');
  });

  it('Daily single válido (tier1, EV positivo) — só tags positivas', () => {
    const item = { ev_pct: 5, market: 'BTTS', selection: 'Sim', tier: 'tier1' };
    const tags = computeRiskTags(item);
    expect(tags).toEqual(expect.arrayContaining(['LAB', 'EV_POSITIVO']));
    expect(tags).not.toContain('WATCH');
    expect(tags).not.toContain('ALTA_VARIANCIA');
    expect(tags).not.toContain('MEGA');
  });

  it('Tier3 Jackpot value-OK + correct_score → JACKPOT + CORRECT_SCORE + ALTA_VARIANCIA', () => {
    const item = {
      ev_pct: 3, tier: 'tier3', market: 'CORRECT_SCORE',
      legs: [{ ev_pct: 2 }, { ev_pct: 4 }], combined_odd: 50,
    };
    const tags = computeRiskTags(item);
    expect(tags).toContain('JACKPOT');
    expect(tags).toContain('CORRECT_SCORE');
    expect(tags).toContain('ALTA_VARIANCIA');
    expect(tags).toContain('WATCH');  // veio de ALTA_VARIANCIA
    expect(tags).toContain('EV_POSITIVO');
    expect(tags).not.toContain('EV_AGREGADO_NEGATIVO');
    expect(tags).not.toContain('MEGA_ILUSORIO');  // EV agregado positivo
  });

  it('FAIXA tipster combo positivo → FAIXA + EV_POSITIVO + LAB', () => {
    const item = {
      ev_pct: 4, is_faixa: true,
      legs: [{ ev_pct: 3, _is_faixa_mirror: true }, { ev_pct: 4 }],
      combined_odd: 12,
    };
    const tags = computeRiskTags(item);
    expect(tags).toContain('FAIXA');
    expect(tags).toContain('EV_POSITIVO');
    expect(tags).toContain('LAB');
  });
});
