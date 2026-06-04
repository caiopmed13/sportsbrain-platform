// tests/premiumSafetyR6JA.test.js — P3.9 R6J-A
// Cobre o safety hotfix do response Premium: garante que recommended_stake_pct
// e equivalentes saem como 0 enquanto can_beta/can_sell/micro_test_active=false,
// e também para itens com tier no_bet/lab_only ou ev_pct<=0 mesmo em produção.
// O sanitize não altera bet_confidence_score, bet_confidence_tier, audit_status,
// can_post, result_status ou training_eligible.

import { describe, it, expect } from 'vitest';
import {
  STAKE_FIELDS_TO_ZERO,
  isLabModeGlobal,
  isItemUnsafeForStake,
  zeroStakeFields,
  sanitizePremiumStakeFields,
  sanitizePremiumItems,
  makePremiumStakeSanitizer,
  PREMIUM_LAB_CONTEXT,
} from '../src/services/premiumSafety.js';

// Factory helpers
const lab = { can_beta: false, can_sell: false, micro_test_active: false };
const prod = { can_beta: true, can_sell: true, micro_test_active: true };

function pick(over = {}) {
  return {
    match: 'A vs B',
    market: 'BTTS',
    selection: 'Sim',
    odd: 1.9,
    ev_pct: 5.0,
    bet_confidence_score: 65,
    bet_confidence_tier: 'micro_test',
    recommended_stake_pct: 1.5,
    audit_status: { pickAuditStatus: 'valid', can_post: true, trust_level: 'verified' },
    result_status: 'pending',
    training_eligible: true,
    can_post: true,
    market_validation: { market: 'btts', market_available: true },
    ...over,
  };
}

function combo(over = {}) {
  return {
    legs: [{ match: 'A vs B' }, { match: 'C vs D' }],
    n_legs: 2,
    combined_odd: 3.5,
    combined_prob: 28.5,
    ev_pct: 4.0,
    recommended_stake_pct: 1.5,
    bet_confidence_tier: 'micro_test',
    audit_status: { pickAuditStatus: 'valid', can_post: true },
    ...over,
  };
}

describe('R6J-A — isLabModeGlobal', () => {
  it('lab mode quando can_beta=false', () => {
    expect(isLabModeGlobal({ can_beta: false, can_sell: true, micro_test_active: true })).toBe(true);
  });
  it('lab mode quando can_sell=false', () => {
    expect(isLabModeGlobal({ can_beta: true, can_sell: false, micro_test_active: true })).toBe(true);
  });
  it('lab mode quando micro_test_active=false', () => {
    expect(isLabModeGlobal({ can_beta: true, can_sell: true, micro_test_active: false })).toBe(true);
  });
  it('produto liberado quando todos os três flags são true', () => {
    expect(isLabModeGlobal(prod)).toBe(false);
  });
  it('lab mode quando ctx vazio (defaults conservadores)', () => {
    expect(isLabModeGlobal({})).toBe(true);
  });
  it('lab mode em PREMIUM_LAB_CONTEXT exportado', () => {
    expect(isLabModeGlobal(PREMIUM_LAB_CONTEXT)).toBe(true);
  });
});

describe('R6J-A — isItemUnsafeForStake', () => {
  it('tier no_bet é unsafe mesmo com EV positivo', () => {
    expect(isItemUnsafeForStake(pick({ bet_confidence_tier: 'no_bet', ev_pct: 10 }))).toBe(true);
  });
  it('tier lab_only é unsafe mesmo com EV positivo', () => {
    expect(isItemUnsafeForStake(pick({ bet_confidence_tier: 'lab_only', ev_pct: 8 }))).toBe(true);
  });
  it('ev_pct=0 é unsafe', () => {
    expect(isItemUnsafeForStake(pick({ ev_pct: 0 }))).toBe(true);
  });
  it('ev_pct negativo é unsafe', () => {
    expect(isItemUnsafeForStake(pick({ ev_pct: -2.5 }))).toBe(true);
  });
  it('ev_pct null/undefined é unsafe', () => {
    expect(isItemUnsafeForStake(pick({ ev_pct: null }))).toBe(true);
    expect(isItemUnsafeForStake(pick({ ev_pct: undefined }))).toBe(true);
  });
  it('combo sem bet_confidence_tier mas com EV positivo NÃO é unsafe', () => {
    expect(isItemUnsafeForStake({ ev_pct: 5, combined_odd: 3 })).toBe(false);
  });
  it('tier valid_bet ou premium_bet com EV positivo NÃO é unsafe', () => {
    expect(isItemUnsafeForStake(pick({ bet_confidence_tier: 'valid_bet', ev_pct: 7 }))).toBe(false);
    expect(isItemUnsafeForStake(pick({ bet_confidence_tier: 'premium_bet', ev_pct: 12 }))).toBe(false);
  });
  it('item null/undefined retorna false (não unsafe, mas trivial)', () => {
    expect(isItemUnsafeForStake(null)).toBe(false);
    expect(isItemUnsafeForStake(undefined)).toBe(false);
  });
});

describe('R6J-A — zeroStakeFields', () => {
  it('zera recommended_stake_pct quando presente', () => {
    const out = zeroStakeFields(pick({ recommended_stake_pct: 3.98 }));
    expect(out.recommended_stake_pct).toBe(0);
  });
  it('zera todos os campos da lista quando presentes', () => {
    const input = {
      recommended_stake_pct: 1.5,
      stake_pct: 2.0,
      kelly_stake_pct: 0.5,
      recommended_units: 2,
      recommended_stake_unit: 1,
      bankroll_pct: 5,
      exposure_pct: 10,
      suggested_stake_pct: 1.2,
    };
    const out = zeroStakeFields(input);
    for (const k of STAKE_FIELDS_TO_ZERO) {
      expect(out[k]).toBe(0);
    }
  });
  it('não adiciona campos que não existiam', () => {
    const out = zeroStakeFields({ ev_pct: 5, odd: 1.9 });
    expect('recommended_stake_pct' in out).toBe(false);
    expect('stake_pct' in out).toBe(false);
    expect(out.ev_pct).toBe(5);
    expect(out.odd).toBe(1.9);
  });
  it('preserva todos os outros campos (audit_status, score, tier, can_post)', () => {
    const p = pick({ recommended_stake_pct: 2 });
    const out = zeroStakeFields(p);
    expect(out.bet_confidence_score).toBe(p.bet_confidence_score);
    expect(out.bet_confidence_tier).toBe(p.bet_confidence_tier);
    expect(out.audit_status).toEqual(p.audit_status);
    expect(out.result_status).toBe(p.result_status);
    expect(out.training_eligible).toBe(p.training_eligible);
    expect(out.can_post).toBe(p.can_post);
    expect(out.market_validation).toEqual(p.market_validation);
    expect(out.ev_pct).toBe(p.ev_pct);
    expect(out.odd).toBe(p.odd);
  });
  it('não muta o input', () => {
    const p = pick({ recommended_stake_pct: 2.5 });
    const before = p.recommended_stake_pct;
    zeroStakeFields(p);
    expect(p.recommended_stake_pct).toBe(before);
  });
  it('null/undefined passa direto', () => {
    expect(zeroStakeFields(null)).toBe(null);
    expect(zeroStakeFields(undefined)).toBe(undefined);
  });
});

describe('R6J-A — sanitizePremiumStakeFields (item único)', () => {
  it('lab mode + EV positivo + tier micro_test => stake=0', () => {
    const p = pick({ bet_confidence_tier: 'micro_test', ev_pct: 6, recommended_stake_pct: 1.5 });
    const out = sanitizePremiumStakeFields(p, lab);
    expect(out.recommended_stake_pct).toBe(0);
  });
  it('produto liberado + tier no_bet + EV positivo => stake=0 (regra individual)', () => {
    const p = pick({ bet_confidence_tier: 'no_bet', ev_pct: 7.16, recommended_stake_pct: 3.98 });
    const out = sanitizePremiumStakeFields(p, prod);
    expect(out.recommended_stake_pct).toBe(0);
  });
  it('produto liberado + tier lab_only + EV positivo => stake=0', () => {
    const p = pick({ bet_confidence_tier: 'lab_only', ev_pct: 5, recommended_stake_pct: 1.0 });
    const out = sanitizePremiumStakeFields(p, prod);
    expect(out.recommended_stake_pct).toBe(0);
  });
  it('produto liberado + tier valid_bet + ev_pct=0 => stake=0 (regra de EV)', () => {
    const p = pick({ bet_confidence_tier: 'valid_bet', ev_pct: 0, recommended_stake_pct: 1.5 });
    const out = sanitizePremiumStakeFields(p, prod);
    expect(out.recommended_stake_pct).toBe(0);
  });
  it('produto liberado + tier valid_bet + ev_pct negativo => stake=0', () => {
    const p = pick({ bet_confidence_tier: 'valid_bet', ev_pct: -3, recommended_stake_pct: 2 });
    const out = sanitizePremiumStakeFields(p, prod);
    expect(out.recommended_stake_pct).toBe(0);
  });
  it('produto liberado + tier valid_bet + EV positivo => stake PRESERVADO', () => {
    const p = pick({ bet_confidence_tier: 'valid_bet', ev_pct: 8, recommended_stake_pct: 1.5 });
    const out = sanitizePremiumStakeFields(p, prod);
    expect(out.recommended_stake_pct).toBe(1.5);
    expect(out).toBe(p); // retorna mesma referência (zero alocação)
  });
  it('combo speculative tier2 com ev_pct=0 e stake=1.5 => stake=0 mesmo em prod', () => {
    const c = combo({ combo_type: 'speculative', ev_pct: 0, recommended_stake_pct: 1.5 });
    delete c.bet_confidence_tier; // combos especulativos podem não ter tier
    const out = sanitizePremiumStakeFields(c, prod);
    expect(out.recommended_stake_pct).toBe(0);
  });
});

describe('R6J-A — sanitizePremiumItems (array)', () => {
  it('lab mode → todo item recebe stake=0', () => {
    const arr = [
      pick({ bet_confidence_tier: 'valid_bet', ev_pct: 10, recommended_stake_pct: 2 }),
      pick({ bet_confidence_tier: 'no_bet', ev_pct: 5, recommended_stake_pct: 1 }),
      pick({ bet_confidence_tier: 'micro_test', ev_pct: 3, recommended_stake_pct: 0.5 }),
    ];
    const out = sanitizePremiumItems(arr, lab);
    expect(out).toHaveLength(3);
    expect(out.every(x => x.recommended_stake_pct === 0)).toBe(true);
  });
  it('produto liberado → só os unsafe são copiados', () => {
    const safe1 = pick({ bet_confidence_tier: 'valid_bet', ev_pct: 8, recommended_stake_pct: 1.5 });
    const unsafe = pick({ bet_confidence_tier: 'no_bet', ev_pct: 7, recommended_stake_pct: 3 });
    const safe2 = pick({ bet_confidence_tier: 'premium_bet', ev_pct: 12, recommended_stake_pct: 2.5 });
    const out = sanitizePremiumItems([safe1, unsafe, safe2], prod);
    expect(out[0]).toBe(safe1);  // mesma referência
    expect(out[1]).not.toBe(unsafe);
    expect(out[1].recommended_stake_pct).toBe(0);
    expect(out[2]).toBe(safe2);
  });
  it('produto liberado + tudo seguro → retorna o mesmo array (zero alocação)', () => {
    const arr = [
      pick({ bet_confidence_tier: 'valid_bet', ev_pct: 6 }),
      pick({ bet_confidence_tier: 'premium_bet', ev_pct: 11 }),
    ];
    const out = sanitizePremiumItems(arr, prod);
    expect(out).toBe(arr);
  });
  it('combos tier2/3/4 com ev_pct<=0 em lab mode → stake=0', () => {
    const combos = [
      combo({ ev_pct: -1, recommended_stake_pct: 1.5 }),
      combo({ ev_pct: 0, recommended_stake_pct: 1.5 }),
      combo({ ev_pct: 2, recommended_stake_pct: 1.0 }),
    ];
    const out = sanitizePremiumItems(combos, lab);
    expect(out.every(c => c.recommended_stake_pct === 0)).toBe(true);
  });
  it('array vazio retorna array vazio', () => {
    expect(sanitizePremiumItems([], lab)).toEqual([]);
  });
  it('não-array passa direto', () => {
    expect(sanitizePremiumItems(null, lab)).toBe(null);
    expect(sanitizePremiumItems(undefined, lab)).toBe(undefined);
    expect(sanitizePremiumItems('string', lab)).toBe('string');
  });
  it('não muta o array de entrada nem seus itens', () => {
    const p = pick({ bet_confidence_tier: 'no_bet', recommended_stake_pct: 3 });
    const arr = [p];
    sanitizePremiumItems(arr, lab);
    expect(arr[0]).toBe(p);
    expect(p.recommended_stake_pct).toBe(3);
  });
});

describe('R6J-A — não altera campos não relacionados a stake', () => {
  it('preserva bet_confidence_score, bet_confidence_tier após sanitize', () => {
    const p = pick({
      bet_confidence_tier: 'no_bet',
      bet_confidence_score: 24,
      recommended_stake_pct: 3.98,
    });
    const out = sanitizePremiumStakeFields(p, lab);
    expect(out.bet_confidence_score).toBe(24);
    expect(out.bet_confidence_tier).toBe('no_bet');
  });
  it('preserva audit_status integral', () => {
    const audit = { pickAuditStatus: 'valid', can_post: true, trust_level: 'verified', audit_reasons: ['ok'] };
    const p = pick({ audit_status: audit, recommended_stake_pct: 2 });
    const out = sanitizePremiumStakeFields(p, lab);
    expect(out.audit_status).toEqual(audit);
    expect(out.audit_status).toBe(audit); // mesma referência preservada (shallow copy)
  });
  it('preserva result_status, training_eligible, can_post', () => {
    const p = pick({ result_status: 'win', training_eligible: false, can_post: true });
    const out = sanitizePremiumStakeFields(p, lab);
    expect(out.result_status).toBe('win');
    expect(out.training_eligible).toBe(false);
    expect(out.can_post).toBe(true);
  });
  it('preserva ev_pct, odd, market, selection', () => {
    const p = pick({ ev_pct: 7.16, odd: 1.85, market: 'BTTS', selection: 'Sim', recommended_stake_pct: 2 });
    p.bet_confidence_tier = 'no_bet';
    const out = sanitizePremiumStakeFields(p, lab);
    expect(out.ev_pct).toBe(7.16);
    expect(out.odd).toBe(1.85);
    expect(out.market).toBe('BTTS');
    expect(out.selection).toBe('Sim');
  });
});

describe('R6J-A — makePremiumStakeSanitizer', () => {
  it('factory retorna função ligada ao contexto fornecido', () => {
    const safe = makePremiumStakeSanitizer(lab);
    const arr = [pick({ bet_confidence_tier: 'valid_bet', ev_pct: 10, recommended_stake_pct: 1.5 })];
    const out = safe(arr);
    expect(out[0].recommended_stake_pct).toBe(0);
  });
  it('factory com prod context preserva stakes seguros', () => {
    const safe = makePremiumStakeSanitizer(prod);
    const p = pick({ bet_confidence_tier: 'valid_bet', ev_pct: 6, recommended_stake_pct: 1.5 });
    const out = safe([p]);
    expect(out[0].recommended_stake_pct).toBe(1.5);
  });
});

describe('R6J-A — cenário real R6J (replicar bugs encontrados)', () => {
  it('tier1 pick com tier=no_bet e recommended_stake_pct=3.98 (caso real Náutico/Cuiabá) → 0', () => {
    const realCase = {
      match: 'Náutico vs Cuiabá EC',
      market: 'Double Chance',
      selection: 'Náutico ou Cuiabá EC',
      odd: 1.49,
      ev_pct: 7.16,
      bet_confidence_score: 29,
      bet_confidence_tier: 'no_bet',
      recommended_stake_pct: 3.98,
      verified: true,
    };
    const out = sanitizePremiumStakeFields(realCase, lab);
    expect(out.recommended_stake_pct).toBe(0);
    expect(out.bet_confidence_tier).toBe('no_bet');  // preservado
    expect(out.ev_pct).toBe(7.16);                    // preservado
  });
  it('combo speculative tier2 com ev_pct=0 e stake=1.5 (caso real) → 0', () => {
    const realCase = {
      combo_type: 'speculative',
      n_legs: 2,
      combined_odd: 10.69,
      combined_prob: 6.56,
      ev_pct: 0,
      recommended_stake_pct: 1.5,
    };
    const out = sanitizePremiumStakeFields(realCase, lab);
    expect(out.recommended_stake_pct).toBe(0);
    expect(out.combined_odd).toBe(10.69);
  });
  it('30 combos com ev_pct<=0 e stake>0 → todos 0 após sanitize', () => {
    const combos = [];
    for (let i = 0; i < 30; i++) {
      combos.push({ combo_type: 'speculative', ev_pct: -i * 0.1, recommended_stake_pct: 1.5 });
    }
    const out = sanitizePremiumItems(combos, lab);
    expect(out.every(c => c.recommended_stake_pct === 0)).toBe(true);
  });
});
