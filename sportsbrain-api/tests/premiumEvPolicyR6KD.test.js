// tests/premiumEvPolicyR6KD.test.js — P3.9 R6K-D
// Cobre o endurecimento da política de EV / prob no pipeline tier1Raw.
// Bypass _is_direct_b365 foi removido — picks Bet365 direct NÃO passam mais
// pelo gate só por serem devigged. Apenas faixa_mirror permanece exception.
// Evidência R6K-A baseline: 316 legs com EV negativo em produção, min -79.82%.

import { describe, it, expect } from 'vitest';
import {
  MIN_PROB_DEFAULT,
  hasPositiveEvValue,
  isExemptFromEvPolicy,
  passesPremiumEvGate,
  passesPremiumProbGate,
} from '../src/services/premiumEvPolicy.js';

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-D — constantes', () => {
  it('MIN_PROB_DEFAULT = 0.45 (espelha pre-fix)', () => {
    expect(MIN_PROB_DEFAULT).toBe(0.45);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-D — hasPositiveEvValue', () => {
  it('número positivo passa', () => {
    expect(hasPositiveEvValue(1)).toBe(true);
    expect(hasPositiveEvValue(0.01)).toBe(true);
    expect(hasPositiveEvValue(100)).toBe(true);
  });
  it('zero NÃO passa (estritamente > 0)', () => {
    expect(hasPositiveEvValue(0)).toBe(false);
  });
  it('número negativo NÃO passa', () => {
    expect(hasPositiveEvValue(-0.01)).toBe(false);
    expect(hasPositiveEvValue(-9.16)).toBe(false);
    expect(hasPositiveEvValue(-79.82)).toBe(false);
  });
  it('null/undefined/NaN NÃO passa', () => {
    expect(hasPositiveEvValue(null)).toBe(false);
    expect(hasPositiveEvValue(undefined)).toBe(false);
    expect(hasPositiveEvValue(NaN)).toBe(false);
  });
  it('Infinity NÃO passa', () => {
    expect(hasPositiveEvValue(Infinity)).toBe(false);
    expect(hasPositiveEvValue(-Infinity)).toBe(false);
  });
  it('string coerce para number', () => {
    expect(hasPositiveEvValue('5')).toBe(true);
    expect(hasPositiveEvValue('-5')).toBe(false);
    expect(hasPositiveEvValue('abc')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-D — isExemptFromEvPolicy', () => {
  it('_is_faixa_mirror=true → exempt', () => {
    expect(isExemptFromEvPolicy({ _is_faixa_mirror: true })).toBe(true);
  });
  it('source="faixa_mirror" → exempt', () => {
    expect(isExemptFromEvPolicy({ source: 'faixa_mirror' })).toBe(true);
  });
  it('_is_direct_b365=true NÃO é exempt (KEY change R6K-D)', () => {
    expect(isExemptFromEvPolicy({ _is_direct_b365: true })).toBe(false);
  });
  it('source="bet365_direct" NÃO é exempt', () => {
    expect(isExemptFromEvPolicy({ source: 'bet365_direct' })).toBe(false);
  });
  it('null/undefined retorna false', () => {
    expect(isExemptFromEvPolicy(null)).toBe(false);
    expect(isExemptFromEvPolicy(undefined)).toBe(false);
  });
  it('objeto vazio retorna false', () => {
    expect(isExemptFromEvPolicy({})).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-D — passesPremiumEvGate', () => {
  describe('happy path', () => {
    it('ev_pct=5, _is_direct_b365=false → passa', () => {
      expect(passesPremiumEvGate({ ev_pct: 5 })).toBe(true);
    });
    it('ev_pct=0.01 → passa', () => {
      expect(passesPremiumEvGate({ ev_pct: 0.01 })).toBe(true);
    });
  });

  describe('block path (KEY R6K-D — _is_direct_b365 NÃO bypass)', () => {
    it('ev_pct=-9.16, _is_direct_b365=true → NÃO passa (era PASS pré-R6K-D)', () => {
      expect(passesPremiumEvGate({ ev_pct: -9.16, _is_direct_b365: true })).toBe(false);
    });
    it('ev_pct=-79.82, _is_direct_b365=true → NÃO passa (caso tier4 min)', () => {
      expect(passesPremiumEvGate({ ev_pct: -79.82, _is_direct_b365: true })).toBe(false);
    });
    it('ev_pct=0, _is_direct_b365=true → NÃO passa (zero não é > 0)', () => {
      expect(passesPremiumEvGate({ ev_pct: 0, _is_direct_b365: true })).toBe(false);
    });
    it('ev_pct=null, _is_direct_b365=true → NÃO passa (sem EV não tem como avaliar)', () => {
      expect(passesPremiumEvGate({ ev_pct: null, _is_direct_b365: true })).toBe(false);
    });
    it('ev_pct=undefined, _is_direct_b365=true → NÃO passa', () => {
      expect(passesPremiumEvGate({ _is_direct_b365: true })).toBe(false);
    });
  });

  describe('faixa_mirror exception (preservada)', () => {
    it('_is_faixa_mirror=true + EV=-50 → passa (tipster history)', () => {
      expect(passesPremiumEvGate({ ev_pct: -50, _is_faixa_mirror: true })).toBe(true);
    });
    it('source="faixa_mirror" + EV negativa → passa', () => {
      expect(passesPremiumEvGate({ ev_pct: -10, source: 'faixa_mirror' })).toBe(true);
    });
    it('_is_faixa_mirror=true sem EV → passa', () => {
      expect(passesPremiumEvGate({ _is_faixa_mirror: true })).toBe(true);
    });
  });

  describe('robustness', () => {
    it('null pick → não passa', () => {
      expect(passesPremiumEvGate(null)).toBe(false);
    });
    it('undefined → não passa', () => {
      expect(passesPremiumEvGate(undefined)).toBe(false);
    });
    it('objeto vazio → não passa (sem EV)', () => {
      expect(passesPremiumEvGate({})).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-D — passesPremiumProbGate', () => {
  describe('happy path', () => {
    it('prob=0.6 → passa', () => {
      expect(passesPremiumProbGate({ prob: 0.6 })).toBe(true);
    });
    it('prob=0.45 (boundary) → passa', () => {
      expect(passesPremiumProbGate({ prob: 0.45 })).toBe(true);
    });
  });

  describe('block path (R6K-D — _is_direct_b365 NÃO bypass)', () => {
    it('prob=0.30, _is_direct_b365=true → NÃO passa (era PASS pré-R6K-D)', () => {
      expect(passesPremiumProbGate({ prob: 0.30, _is_direct_b365: true })).toBe(false);
    });
    it('prob=0.44 (just below) → NÃO passa', () => {
      expect(passesPremiumProbGate({ prob: 0.44 })).toBe(false);
    });
    it('prob=null → NÃO passa', () => {
      expect(passesPremiumProbGate({ prob: null })).toBe(false);
    });
  });

  describe('faixa_mirror exception (preservada)', () => {
    it('_is_faixa_mirror=true + prob=0.1 → passa', () => {
      expect(passesPremiumProbGate({ prob: 0.1, _is_faixa_mirror: true })).toBe(true);
    });
    it('source=faixa_mirror sem prob → passa', () => {
      expect(passesPremiumProbGate({ source: 'faixa_mirror' })).toBe(true);
    });
  });

  describe('minProb customizado', () => {
    it('minProb=0.3 + prob=0.35 → passa', () => {
      expect(passesPremiumProbGate({ prob: 0.35 }, { minProb: 0.3 })).toBe(true);
    });
    it('minProb=0.3 + prob=0.25 → NÃO passa', () => {
      expect(passesPremiumProbGate({ prob: 0.25 }, { minProb: 0.3 })).toBe(false);
    });
    it('minProb NaN → fallback para default 0.45', () => {
      expect(passesPremiumProbGate({ prob: 0.45 }, { minProb: NaN })).toBe(true);
      expect(passesPremiumProbGate({ prob: 0.44 }, { minProb: NaN })).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-D — cenário real R6K-A baseline', () => {
  // Reproduz os exemplos concretos que apareceram em produção pre-R6K-D
  // e confirma que TODOS são bloqueados pelo novo gate.

  const realStaleEvSamples = [
    // tier1 (4 picks com EV<0)
    { id: 'palestino_riestra', _is_direct_b365: true, ev_pct: -3.33, prob: 0.40 },
    { id: 'santos_cuenca_btts_no', _is_direct_b365: true, ev_pct: -9.16, prob: 0.50 },
    { id: 'st_etienne_nice_draw', _is_direct_b365: true, ev_pct: -2.13, prob: 0.30 },
    { id: 'millonarios_higgins_btts', _is_direct_b365: true, ev_pct: -7.36, prob: 0.55 },
    // tier3 (min -58)
    { id: 'tier3_worst', _is_direct_b365: true, ev_pct: -58.24, prob: 0.20 },
    // tier4 (min -79)
    { id: 'tier4_worst', _is_direct_b365: true, ev_pct: -79.82, prob: 0.10 },
  ];

  for (const sample of realStaleEvSamples) {
    it(`bloqueia EV<0 real (${sample.id}, ev=${sample.ev_pct})`, () => {
      expect(passesPremiumEvGate(sample)).toBe(false);
    });
  }

  it('todos os exemplos reais bloqueados pelo novo gate', () => {
    const allBlocked = realStaleEvSamples.every(p => !passesPremiumEvGate(p));
    expect(allBlocked).toBe(true);
  });

  it('pick equivalente mas com EV>0 + _is_direct_b365 → passa', () => {
    expect(passesPremiumEvGate({
      _is_direct_b365: true,
      ev_pct: 5.5,
      prob: 0.55,
    })).toBe(true);
  });

  it('pick faixa_mirror com EV negativo continua passando (exception preservada)', () => {
    expect(passesPremiumEvGate({
      _is_faixa_mirror: true,
      ev_pct: -3.0,
      prob: 0.45,
    })).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-D — composição: ambos gates devem passar', () => {
  it('EV+prob ambos OK → passa nos dois', () => {
    const p = { ev_pct: 5, prob: 0.5, _is_direct_b365: true };
    expect(passesPremiumEvGate(p)).toBe(true);
    expect(passesPremiumProbGate(p)).toBe(true);
  });

  it('EV ok + prob baixa + _is_direct_b365 → ev pass, prob fail (KEY)', () => {
    const p = { ev_pct: 5, prob: 0.3, _is_direct_b365: true };
    expect(passesPremiumEvGate(p)).toBe(true);
    expect(passesPremiumProbGate(p)).toBe(false);
  });

  it('EV<0 + prob ok + _is_direct_b365 → ev fail, prob pass — pick não entra (EV gate first)', () => {
    const p = { ev_pct: -5, prob: 0.5, _is_direct_b365: true };
    expect(passesPremiumEvGate(p)).toBe(false);
    expect(passesPremiumProbGate(p)).toBe(true);
  });
});
