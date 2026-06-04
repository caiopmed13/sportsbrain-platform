// tests/shadowAuditSyncR6HF.test.js — P3.9 R6H-F
// Cobre o fix do "insert path stale": rows com audit_status='valid' (vindas do
// admin endpoint /internal/admin/resync-confidence-scores) escapavam do
// AUDIT_SYNC_SQL (WHERE audit_status='unknown') e ficavam com score/tier stale
// para sempre. O CONFIDENCE_UPGRADE_SQL adicionado é mutex com o anterior:
//
//   AUDIT_SYNC_SQL:        WHERE id=? AND audit_status='unknown'
//   CONFIDENCE_UPGRADE_SQL: WHERE id=? AND audit_status != 'unknown'
//                            AND can_post=1 AND training_eligible=1
//                            AND bet_confidence_score < ?
//
// Casos cobertos:
//   - row 'valid'+supported+can_post=1+training=1 com score stale → upgrade
//   - row 'valid' mas can_post=0 → não upgrade (não é lab-safe)
//   - row 'valid' mas training_eligible=0 → não upgrade
//   - row 'valid' com score já >= canonical → não upgrade (guard upgrade-only)
//   - row 'unknown' continua passando pelo AUDIT_SYNC_SQL como antes (mutex)
//   - rows mistas (unknown + valid stale) — ambas processadas no mesmo run
//   - falha do segundo batch é reportada em confidence_upgrade_errors
//   - sample_ids separados para confidence_upgrade_sample_ids

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncShadowBetAuditAnnotations } from '../src/services/shadowBets.js';

// ─────────────────────────────────────────────────────────────────────
// Fake D1 — separa primeiro batch (audit) do segundo batch (upgrade)
// ─────────────────────────────────────────────────────────────────────
function makeFakeDb({ auditChanges = null, upgradeChanges = null } = {}) {
  const captured = { audit: [], upgrade: [] };
  let batchCallIndex = 0;
  return {
    captured,
    prepare(sql) {
      const isUpgrade = sql.includes('AND bet_confidence_score <');
      return {
        bind(...args) { return { _bind: args, _sql: sql, _isUpgrade: isUpgrade }; },
      };
    },
    async batch(stmts) {
      batchCallIndex++;
      const bucket = stmts.length > 0 && stmts[0]._isUpgrade ? 'upgrade' : 'audit';
      for (const s of stmts) captured[bucket].push({ sql: s._sql, args: s._bind });
      const provided = bucket === 'audit' ? auditChanges : upgradeChanges;
      return stmts.map((_s, i) => {
        // Por padrão simula sucesso. Se o test passou um array, usa.
        const changes = Array.isArray(provided) ? (provided[i] ?? 1) : 1;
        return { meta: { changes } };
      });
    },
  };
}

function makeValidPick(overrides = {}) {
  // Pick canonical já enriquecido: audit_status objeto, trust_level supported,
  // can_post true. calcBetConfidenceScore deve produzir score realista (~40-50).
  return {
    bet365_event_id: '194081799',
    fixture_id: null,
    home_team: 'Team A',
    away_team: 'Team B',
    market: '1X2',
    stat: '1X2',
    selection: 'home',
    direction: 'home',
    odd: 2.1,
    line: null,
    period: null,
    sport: 'football',
    league: null,
    source_family: 'bet365_direct',
    source: 'bet365_direct',
    bet365: true,
    kickoff: '2026-05-25T18:00:00Z',
    market_available: true,
    odds_snapshot_id: 'snap_1',
    odds_snapshot_count: 3,
    audit_status: {
      pickAuditStatus: 'valid',
      trust_level: 'supported',
      can_post: true,
    },
    trust_level: 'supported',
    can_post: true,
    resolvability: { can_resolve: true },
    ev_pct: 8.5,
    prob: 0.55,
    golden_score: 7,
    golden_support_score: 12,
    bet_confidence_score: 45,
    bet_confidence_tier: 'lab_only',
    method_validation: { validated: true },
    source_trace: { provenance: 'bet365_direct' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════
describe('R6H-F — CONFIDENCE_UPGRADE_SQL guards', () => {
  it('não roda upgrade quando NÃO há nenhum skipped (todos updated no primeiro batch)', async () => {
    // auditChanges=[1,1] simula audit sync atualizando todas as rows
    const db = makeFakeDb({ auditChanges: [1, 1] });
    const items = [makeValidPick(), makeValidPick({ bet365_event_id: '999' })];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.updated).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.confidence_upgraded).toBe(0);
    expect(db.captured.upgrade).toHaveLength(0);
  });

  it('roda upgrade para rows skipped no primeiro batch (audit_status já anotado)', async () => {
    // auditChanges=[0,0] simula audit sync FALHANDO (WHERE audit_status=unknown
    // não casa — rows já tem audit='valid' set pelo admin resync)
    // upgradeChanges=[1,1] simula CONFIDENCE_UPGRADE_SQL casando (canonical > current)
    const db = makeFakeDb({ auditChanges: [0, 0], upgradeChanges: [1, 1] });
    const items = [makeValidPick(), makeValidPick({ bet365_event_id: '999' })];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.updated).toBe(0);
    expect(res.skipped).toBe(2);
    expect(res.confidence_upgraded).toBe(2);
    expect(res.confidence_upgrade_sample_ids.length).toBeLessThanOrEqual(5);
    expect(db.captured.upgrade.length).toBe(2);
    // Verifica que o SQL do segundo batch é o UPGRADE
    expect(db.captured.upgrade[0].sql).toContain('AND bet_confidence_score <');
    expect(db.captured.upgrade[0].sql).toContain("audit_status != 'unknown'");
    expect(db.captured.upgrade[0].sql).toContain('can_post = 1');
    expect(db.captured.upgrade[0].sql).toContain('training_eligible = 1');
  });

  it('mistura: row 1 atualizada pelo audit, row 2 upgraded pelo confidence', async () => {
    const db = makeFakeDb({ auditChanges: [1, 0], upgradeChanges: [1] });
    const items = [makeValidPick(), makeValidPick({ bet365_event_id: '999' })];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.confidence_upgraded).toBe(1);
    expect(res.confidence_upgrade_skipped).toBe(0);
  });

  it('upgrade que retorna changes=0 (score canonical NÃO maior que current) vira confidence_upgrade_skipped', async () => {
    // Primeira batch falha (WHERE unknown não casa), segundo batch também falha
    // (canonical score já <= current — guard upgrade-only protegeu)
    const db = makeFakeDb({ auditChanges: [0], upgradeChanges: [0] });
    const items = [makeValidPick()];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.updated).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.confidence_upgraded).toBe(0);
    expect(res.confidence_upgrade_skipped).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('R6H-F — upgrade só roda para rows lab-safe', () => {
  it('pick com can_post=false NÃO entra em upgrade candidates', async () => {
    // can_post=false → isTrainingEligible=0 → mesmo se skipped no primeiro batch,
    // não é enfileirado para upgrade (consistente com R6J-A safety: rows
    // can_post=0 são lab-only e não devem ter score upgraded)
    const db = makeFakeDb({ auditChanges: [0] });
    const items = [makeValidPick({
      audit_status: { pickAuditStatus: 'valid', trust_level: 'supported', can_post: false },
      can_post: false,
    })];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.skipped).toBe(1);
    expect(res.confidence_upgraded).toBe(0);
    expect(res.confidence_upgrade_skipped).toBe(0);
    expect(db.captured.upgrade).toHaveLength(0);
  });

  it('pick que não passa training_eligible NÃO entra em upgrade', async () => {
    // resolvability.can_resolve=false → isTrainingEligible=0
    const db = makeFakeDb({ auditChanges: [0] });
    const items = [makeValidPick({
      resolvability: { can_resolve: false },
    })];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.skipped).toBe(1);
    expect(res.confidence_upgraded).toBe(0);
    expect(db.captured.upgrade).toHaveLength(0);
  });

  it('pick com pickAuditStatus="observation" não chega no upgrade (skipped no início)', async () => {
    // pickAuditStatus !== 'valid' faz isTrainingEligible=0 e ainda é skipped
    // pelo `if (!pickAuditStatus || pickAuditStatus === 'unknown')` mas
    // observation passa o gate inicial. Verifica: não vai pra upgrade.
    const db = makeFakeDb({ auditChanges: [0] });
    const items = [makeValidPick({
      audit_status: { pickAuditStatus: 'observation', trust_level: 'supported', can_post: true },
    })];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.confidence_upgraded).toBe(0);
    expect(db.captured.upgrade).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('R6H-F — guard upgrade-only é SQL-level (no JS)', () => {
  it('CONFIDENCE_UPGRADE_SQL contém guard `bet_confidence_score < ?`', async () => {
    const db = makeFakeDb({ auditChanges: [0] });
    const items = [makeValidPick()];
    await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(db.captured.upgrade.length).toBeGreaterThan(0);
    const sql = db.captured.upgrade[0].sql;
    expect(sql).toContain('bet_confidence_score < ?');
    expect(sql).toContain("audit_status != 'unknown'");
    expect(sql).toContain('can_post = 1');
    expect(sql).toContain('training_eligible = 1');
    // NÃO mexe em result_status, settled_at, audit_status, training_eligible
    // no bloco SET. Extrai só o trecho SET ... WHERE para evitar match nas
    // colunas que aparecem na WHERE clause (audit_status, can_post, etc).
    const setBlock = sql.split('WHERE')[0];
    expect(setBlock).not.toContain('result_status');
    expect(setBlock).not.toContain('settled_at');
    expect(setBlock).not.toContain('audit_status');
    expect(setBlock).not.toContain('training_eligible');
    expect(setBlock).not.toContain('trust_level');
    expect(setBlock).not.toContain('can_post');
    // Single source of truth: SET só toca confidence
    expect(setBlock).toContain('bet_confidence_score');
    expect(setBlock).toContain('bet_confidence_tier');
  });

  it('binds do upgrade: confScore, confTier, id, confScore (guard)', async () => {
    const db = makeFakeDb({ auditChanges: [0] });
    const pick = makeValidPick();
    await syncShadowBetAuditAnnotations([pick], { SB_DB: db });
    expect(db.captured.upgrade.length).toBe(1);
    const args = db.captured.upgrade[0].args;
    expect(args).toHaveLength(4);
    // args = [confScore_set, confTier_set, id, confScore_guard]
    // O score do SET deve ser igual ao do guard (mesma variável)
    expect(args[0]).toBe(args[3]);
    expect(typeof args[1]).toBe('string'); // tier
    expect(typeof args[2]).toBe('string'); // id
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('R6H-F — error handling', () => {
  it('erro no batch de upgrade não derruba sync; vai para confidence_upgrade_errors', async () => {
    const db = {
      prepare(sql) {
        return { bind(...args) { return { _sql: sql, _args: args, _isUpgrade: sql.includes('bet_confidence_score <') }; } };
      },
      async batch(stmts) {
        if (stmts[0]?._isUpgrade) throw new Error('upgrade batch failed');
        return stmts.map(() => ({ meta: { changes: 0 } }));  // audit sync skipped
      },
    };
    const items = [makeValidPick()];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.skipped).toBe(1);
    expect(res.confidence_upgrade_errors).toBe(1);
    expect(res.confidence_upgraded).toBe(0);
  });

  it('sem upgrade candidates não chama batch upgrade', async () => {
    const captured = { batchCalls: 0 };
    const db = {
      prepare(sql) {
        return { bind() { return { _sql: sql }; } };
      },
      async batch(stmts) {
        captured.batchCalls++;
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    };
    const items = [makeValidPick()];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(res.updated).toBe(1);
    expect(captured.batchCalls).toBe(1);  // só o audit batch
    expect(res.confidence_upgrade_errors).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('R6H-F — mutex AUDIT_SYNC_SQL vs CONFIDENCE_UPGRADE_SQL', () => {
  it('AUDIT_SYNC_SQL ainda usa WHERE audit_status="unknown" (não foi alterado)', async () => {
    const db = makeFakeDb({ auditChanges: [1] });
    const items = [makeValidPick()];
    await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    expect(db.captured.audit.length).toBe(1);
    const sql = db.captured.audit[0].sql;
    expect(sql).toContain("audit_status='unknown'");
    expect(sql).toContain('SET');
    expect(sql).toContain('audit_status=?');
    expect(sql).toContain('bet_confidence_score=?');
    expect(sql).toContain('bet_confidence_tier=?');
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('R6H-F — result shape backward-compatible', () => {
  it('result inclui campos antigos + novos R6H-F', async () => {
    const db = makeFakeDb({ auditChanges: [1] });
    const items = [makeValidPick()];
    const res = await syncShadowBetAuditAnnotations(items, { SB_DB: db });
    // Campos antigos preservados
    expect(res).toHaveProperty('attempted');
    expect(res).toHaveProperty('updated');
    expect(res).toHaveProperty('skipped');
    expect(res).toHaveProperty('errors');
    expect(res).toHaveProperty('duration_ms');
    expect(res).toHaveProperty('sample_ids');
    // Novos campos R6H-F
    expect(res).toHaveProperty('confidence_upgraded');
    expect(res).toHaveProperty('confidence_upgrade_skipped');
    expect(res).toHaveProperty('confidence_upgrade_errors');
    expect(res).toHaveProperty('confidence_upgrade_sample_ids');
  });
});
