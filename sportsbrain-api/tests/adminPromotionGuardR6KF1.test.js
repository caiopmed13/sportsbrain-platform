// tests/adminPromotionGuardR6KF1.test.js — P3.9 R6K-F1
// Cobre o guard refinado: protege contra DADOS CORROMPIDOS, não contra
// mercado arriscado. Substitui adminPromotionGuardR6HG.test.js.
//
// Mudanças vs R6H-G:
//   - REMOVIDO: bloqueio por tier=no_bet, score<40, market high-risk
//   - ADICIONADO: no_fixture / no_market / no_selection / audit_unknown_zero / score_absurd

import { describe, it, expect } from 'vitest';
import {
  SCORE_ABSURD_MAX,
  BLOCK_REASONS,
  shouldAdminPromoteStaleCandidate,
} from '../src/services/adminPromotionGuard.js';

// Helper: base válida (passa todos os guards). Customize via spread.
function base(overrides = {}) {
  return {
    row: {
      fixture_id: 'fix-123',
      market: '1X2',
      selection: 'Home',
      ...(overrides.row || {}),
    },
    audit: {
      pickAuditStatus: 'valid',
      trustLevel: 'verified',
      canPost: true,
      trainingEligible: 1,
      ...(overrides.audit || {}),
    },
    confidence: {
      score: 50,
      tier: 'lab_only',
      ...(overrides.confidence || {}),
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — constantes públicas', () => {
  it('SCORE_ABSURD_MAX = 100', () => {
    expect(SCORE_ABSURD_MAX).toBe(100);
  });

  it('BLOCK_REASONS expõe os 5 motivos', () => {
    expect(BLOCK_REASONS.NO_FIXTURE).toBe('no_fixture');
    expect(BLOCK_REASONS.NO_MARKET).toBe('no_market');
    expect(BLOCK_REASONS.NO_SELECTION).toBe('no_selection');
    expect(BLOCK_REASONS.AUDIT_UNKNOWN_ZERO).toBe('audit_unknown_zero');
    expect(BLOCK_REASONS.SCORE_ABSURD).toBe('score_absurd');
  });

  it('BLOCK_REASONS é frozen (immutable)', () => {
    expect(Object.isFrozen(BLOCK_REASONS)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — passthrough: audit.canPost=false', () => {
  it('audit.canPost=false → canPost=0, blocked=false (sem mudança)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ audit: { canPost: false } }));
    expect(r.canPost).toBe(0);
    expect(r.trainingEligible).toBe(0);
    expect(r.blocked).toBe(false);
    expect(r.reason).toBeNull();
  });

  it('audit ausente → não promove e não marca blocked', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'x', market: 'm', selection: 's' },
      audit: {},
      confidence: { score: 50 },
    });
    expect(r.canPost).toBe(0);
    expect(r.blocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — Guard 1: no_fixture', () => {
  it('fixture_id null → blocked no_fixture', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { fixture_id: null } }));
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('no_fixture');
    expect(r.canPost).toBe(0);
    expect(r.trainingEligible).toBe(0);
  });

  it('fixture_id undefined → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { fixture_id: undefined } }));
    expect(r.reason).toBe('no_fixture');
  });

  it('fixture_id "" → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { fixture_id: '' } }));
    expect(r.reason).toBe('no_fixture');
  });

  it('fixture_id 0 (numérico falso) → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { fixture_id: 0 } }));
    expect(r.reason).toBe('no_fixture');
  });

  it('fixture_id NaN → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { fixture_id: NaN } }));
    expect(r.reason).toBe('no_fixture');
  });

  it('fixture_id number positivo → passa esse guard', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { fixture_id: 12345 } }));
    expect(r.blocked).toBe(false);
  });

  it('event_id usado como fallback de fixture_id', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { event_id: 'ev-9', market: '1X2', selection: 'Home' },
      audit: { canPost: true, trainingEligible: 1 },
      confidence: { score: 50 },
    });
    expect(r.blocked).toBe(false);
    expect(r.canPost).toBe(1);
  });

  it('bet365_event_id usado como fallback', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { bet365_event_id: 'b365-77', market: '1X2', selection: 'Home' },
      audit: { canPost: true, trainingEligible: 1 },
      confidence: { score: 50 },
    });
    expect(r.blocked).toBe(false);
  });

  it('fixtureId camelCase aceito', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixtureId: 1, market: 'm', selection: 's' },
      audit: { canPost: true, trainingEligible: 1 },
      confidence: { score: 50 },
    });
    expect(r.blocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — Guard 2: no_market', () => {
  it('market null → blocked no_market', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { market: null } }));
    expect(r.reason).toBe('no_market');
    expect(r.blocked).toBe(true);
  });

  it('market "" → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { market: '' } }));
    expect(r.reason).toBe('no_market');
  });

  it('market "   " (whitespace) → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { market: '   ' } }));
    expect(r.reason).toBe('no_market');
  });

  it('market "BTTS" → passa', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { market: 'BTTS' } }));
    expect(r.blocked).toBe(false);
  });

  it('CORRECT_SCORE NÃO é mais bloqueado pelo guard (filosofia annotate)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { market: 'CORRECT_SCORE' } }));
    expect(r.blocked).toBe(false);
    expect(r.canPost).toBe(1);
  });

  it('HT_FT NÃO é mais bloqueado', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { market: 'HT_FT' } }));
    expect(r.blocked).toBe(false);
  });

  it('DRAW_NO_BET NÃO é mais bloqueado', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { market: 'DRAW_NO_BET' } }));
    expect(r.blocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — Guard 3: no_selection', () => {
  it('selection null → blocked no_selection', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { selection: null } }));
    expect(r.reason).toBe('no_selection');
    expect(r.blocked).toBe(true);
  });

  it('selection "" → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { selection: '' } }));
    expect(r.reason).toBe('no_selection');
  });

  it('selection "  " → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { selection: '  ' } }));
    expect(r.reason).toBe('no_selection');
  });

  it('selection "Home" → passa', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ row: { selection: 'Home' } }));
    expect(r.blocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — Guard 4: audit_unknown_zero', () => {
  it('audit=unknown + trust=unknown + score=0 → blocked audit_unknown_zero', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      audit: { pickAuditStatus: 'unknown', trustLevel: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    }));
    expect(r.reason).toBe('audit_unknown_zero');
    expect(r.blocked).toBe(true);
    expect(r.canPost).toBe(0);
    expect(r.trainingEligible).toBe(0);
  });

  it('audit=valid + trust=unknown + score=0 → cai em score_absurd, NÃO audit_unknown_zero', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      audit: { pickAuditStatus: 'valid', trustLevel: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    }));
    expect(r.reason).toBe('score_absurd');
  });

  it('audit=unknown + trust=verified + score=0 → cai em score_absurd', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      audit: { pickAuditStatus: 'unknown', trustLevel: 'verified', canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    }));
    expect(r.reason).toBe('score_absurd');
  });

  it('audit=unknown + trust=unknown + score=15 → NÃO blocked (rows low-confidence passam no F1)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      audit: { pickAuditStatus: 'unknown', trustLevel: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 15 },
    }));
    expect(r.blocked).toBe(false);
    expect(r.canPost).toBe(1);
  });

  it('trust_level snake_case também aceito (sem trustLevel camelCase)', () => {
    // Construído sem base() porque base() injeta trustLevel: 'verified' por
    // default — aqui precisamos provar que ENTRADA SÓ COM trust_level é aceita.
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'x', market: '1X2', selection: 'Home' },
      audit: { pickAuditStatus: 'unknown', trust_level: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    });
    expect(r.reason).toBe('audit_unknown_zero');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — Guard 5: score_absurd', () => {
  it('score=0 (com audit válido) → blocked score_absurd', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: 0 } }));
    expect(r.reason).toBe('score_absurd');
    expect(r.blocked).toBe(true);
  });

  it('score=101 → blocked score_absurd', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: 101 } }));
    expect(r.reason).toBe('score_absurd');
  });

  it('score=999 → blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: 999 } }));
    expect(r.reason).toBe('score_absurd');
  });

  it('score=100 (limite) → passa (não absurdo)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: 100 } }));
    expect(r.blocked).toBe(false);
  });

  it('score=1 → passa (não é mais bloqueado por <40)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: 1 } }));
    expect(r.blocked).toBe(false);
    expect(r.canPost).toBe(1);
  });

  it('score=15 (caso real R6H-F observation) → passa (annotate-don\'t-filter)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: 15 } }));
    expect(r.blocked).toBe(false);
  });

  it('score=39 (boundary do R6H-G antigo) → passa no F1', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: 39 } }));
    expect(r.blocked).toBe(false);
  });

  it('score=null → não dispara guard, passa', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: null } }));
    expect(r.blocked).toBe(false);
  });

  it('score=NaN → não dispara guard, passa', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: NaN } }));
    expect(r.blocked).toBe(false);
  });

  it('score=Infinity → não-finite, passa', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: Infinity } }));
    expect(r.blocked).toBe(false);
  });

  it('score=-5 (negativo) → passa (não é 0 nem >100)', () => {
    // Defensive: spec só lista ===0 e >100. Score negativo seria outro bug
    // mas não está no contrato deste guard.
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: -5 } }));
    expect(r.blocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — comportamento ANTIGO R6H-G REMOVIDO', () => {
  it('tier=no_bet com fixture/market/selection OK e score>0 → NÃO mais blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      confidence: { score: 50, tier: 'no_bet' },
    }));
    expect(r.blocked).toBe(false);
    expect(r.canPost).toBe(1);
  });

  it('CORRECT_SCORE com score alto → NÃO mais blocked (vai como badge no F2)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      row: { market: 'CORRECT_SCORE' },
      confidence: { score: 70, tier: 'lab_only' },
    }));
    expect(r.blocked).toBe(false);
  });

  it('score=20 (era <40 do R6H-G) → NÃO mais blocked', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      confidence: { score: 20, tier: 'lab_only' },
    }));
    expect(r.blocked).toBe(false);
    expect(r.canPost).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — ordem de avaliação', () => {
  it('no_fixture tem precedência sobre no_market', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: null, market: '', selection: '' },
      audit: { canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    });
    expect(r.reason).toBe('no_fixture');
  });

  it('no_market tem precedência sobre no_selection', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'x', market: '', selection: '' },
      audit: { canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    });
    expect(r.reason).toBe('no_market');
  });

  it('no_selection tem precedência sobre audit_unknown_zero', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'x', market: 'm', selection: '' },
      audit: { pickAuditStatus: 'unknown', trustLevel: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    });
    expect(r.reason).toBe('no_selection');
  });

  it('audit_unknown_zero tem precedência sobre score_absurd quando ambos casam', () => {
    const r = shouldAdminPromoteStaleCandidate(base({
      audit: { pickAuditStatus: 'unknown', trustLevel: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 0 },
    }));
    expect(r.reason).toBe('audit_unknown_zero');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — happy path', () => {
  it('row completa + audit ok + score 50 → promove', () => {
    const r = shouldAdminPromoteStaleCandidate(base());
    expect(r.canPost).toBe(1);
    expect(r.trainingEligible).toBe(1);
    expect(r.blocked).toBe(false);
    expect(r.reason).toBeNull();
  });

  it('audit trainingEligible=0 → canPost=1 mas training=0', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ audit: { trainingEligible: 0 } }));
    expect(r.canPost).toBe(1);
    expect(r.trainingEligible).toBe(0);
    expect(r.blocked).toBe(false);
  });

  it('score=null + row completa + audit ok → promove (sem score válido = sem absurdo)', () => {
    const r = shouldAdminPromoteStaleCandidate(base({ confidence: { score: null } }));
    expect(r.canPost).toBe(1);
    expect(r.blocked).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — robustness', () => {
  it('inputs undefined retorna canPost=0/blocked=false sem throw', () => {
    const r = shouldAdminPromoteStaleCandidate();
    expect(r.canPost).toBe(0);
    expect(r.trainingEligible).toBe(0);
    expect(r.blocked).toBe(false);
  });

  it('row undefined com audit ok → blocked no_fixture', () => {
    const r = shouldAdminPromoteStaleCandidate({
      audit: { canPost: true, trainingEligible: 1 },
      confidence: { score: 50 },
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('no_fixture');
  });

  it('confidence undefined + row ok + audit ok → promove (sem score = sem absurdo)', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'x', market: 'm', selection: 's' },
      audit: { canPost: true, trainingEligible: 1 },
    });
    expect(r.canPost).toBe(1);
    expect(r.blocked).toBe(false);
  });

  it('NÃO retorna campos de audit/trust no output (read-only)', () => {
    const r = shouldAdminPromoteStaleCandidate(base());
    expect(r).not.toHaveProperty('audit_status');
    expect(r).not.toHaveProperty('pickAuditStatus');
    expect(r).not.toHaveProperty('trust_level');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-F1 — cenário real: stale row de produção', () => {
  // Stale row típica observada no R6H-F: market e selection presentes, score
  // baixo mas finito (e.g. 11-16), audit_status=unknown+trust=unknown.
  // No R6H-G era bloqueada (tier_no_bet ou score<40); no R6K-F1, se houver
  // sinal mínimo (score>0), passa para virar badge no R6K-F2.

  it('stale típica score=15 + audit_unknown + trust_unknown → passa (vira badge no F2)', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'fx-9', market: '1X2', selection: 'Empate' },
      audit: { pickAuditStatus: 'unknown', trustLevel: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 15, tier: 'no_bet' },
    });
    expect(r.blocked).toBe(false);
    expect(r.canPost).toBe(1);
  });

  it('row CORROMPIDA score=0 + audit_unknown + trust_unknown → blocked audit_unknown_zero', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'fx-9', market: '1X2', selection: 'Empate' },
      audit: { pickAuditStatus: 'unknown', trustLevel: 'unknown', canPost: true, trainingEligible: 1 },
      confidence: { score: 0, tier: 'no_bet' },
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('audit_unknown_zero');
  });

  it('row sem market (DB corrompido) → blocked no_market mesmo com score bom', () => {
    const r = shouldAdminPromoteStaleCandidate({
      row: { fixture_id: 'fx-9', market: null, selection: 'Empate' },
      audit: { pickAuditStatus: 'valid', trustLevel: 'verified', canPost: true, trainingEligible: 1 },
      confidence: { score: 70, tier: 'lab_only' },
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('no_market');
  });
});
