/**
 * shadowBets.test.js
 * Run with: node src/services/shadowBets.test.js
 */
import assert from 'assert';
import {
  makeShadowBetId,
  shouldCreateMainShadowBet,
  shouldCreateLabShadowBet,
  buildShadowBetFromPick,
  buildShadowBetFromCombo,
  ingestShadowBets,
  buildShadowCreationDebug,
  syncShadowBetAnnotations,
  syncShadowBetAuditAnnotations,
} from './shadowBets.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ---------------------------------------------------------------------------
// 1. makeShadowBetId
// ---------------------------------------------------------------------------
console.log('\nmakeShadowBetId');

test('returns a string', () => assert.strictEqual(typeof makeShadowBetId({}), 'string'));
test('max 200 chars', () => {
  const id = makeShadowBetId({ bet365_event_id: 'EV123', market: '1X2', selection: 'home', pick_date: '2026-05-12' });
  assert.ok(id.length <= 200, `Too long: ${id.length}`);
});
test('same input → same ID (deterministic)', () => {
  const base = { bet365_event_id: 'EV555', market: '1X2', selection: 'home', pick_date: '2026-05-12', is_combo: false };
  assert.strictEqual(makeShadowBetId(base), makeShadowBetId(base));
});
test('different fixture → different ID', () => {
  const a = makeShadowBetId({ bet365_event_id: 'EV1', market: '1X2', selection: 'home', pick_date: '2026-05-12' });
  const b = makeShadowBetId({ bet365_event_id: 'EV2', market: '1X2', selection: 'home', pick_date: '2026-05-12' });
  assert.notStrictEqual(a, b);
});
test('different date → different ID', () => {
  const base = { bet365_event_id: 'EV1', market: '1X2', selection: 'home' };
  const a = makeShadowBetId({ ...base, pick_date: '2026-05-12' });
  const b = makeShadowBetId({ ...base, pick_date: '2026-05-13' });
  assert.notStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// 2. shouldCreateMainShadowBet
// ---------------------------------------------------------------------------
console.log('\nshouldCreateMainShadowBet');

const validPick = {
  audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: true },
  market_available: true, odd: 2.10,
  bet365_event_id: 'EV123', kickoff: '2026-05-12T15:00:00Z',
};

test('valid + verified + can_post → true', () => {
  assert.strictEqual(shouldCreateMainShadowBet(validPick), true);
});
test('valid + supported → true', () => {
  assert.strictEqual(shouldCreateMainShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'valid', trust_level: 'supported', can_post: true },
  }), true);
});
test('observation → false (main)', () => {
  assert.strictEqual(shouldCreateMainShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'observation', trust_level: 'weak', can_post: false },
  }), false);
});
test('blocked → false', () => {
  assert.strictEqual(shouldCreateMainShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'blocked', trust_level: 'blocked', can_post: false },
  }), false);
});
test('no odd → false', () => {
  assert.strictEqual(shouldCreateMainShadowBet({ ...validPick, odd: null }), false);
});
test('odd ≤ 1 → false', () => {
  assert.strictEqual(shouldCreateMainShadowBet({ ...validPick, odd: 1.0 }), false);
});
test('no fixture anchor → false', () => {
  const { bet365_event_id, ...rest } = validPick;
  assert.strictEqual(shouldCreateMainShadowBet({ ...rest, fixture_id: null }), false);
});
test('no kickoff → false', () => {
  assert.strictEqual(shouldCreateMainShadowBet({ ...validPick, kickoff: null }), false);
});
test('can_post false → false', () => {
  assert.strictEqual(shouldCreateMainShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: false },
  }), false);
});
test('market_available false → false', () => {
  assert.strictEqual(shouldCreateMainShadowBet({ ...validPick, market_available: false }), false);
});
test('market_available null → true (fallback safe)', () => {
  assert.strictEqual(shouldCreateMainShadowBet({ ...validPick, market_available: null }), true);
});

// ---------------------------------------------------------------------------
// 3. shouldCreateLabShadowBet
// ---------------------------------------------------------------------------
console.log('\nshouldCreateLabShadowBet');

test('observation → true (lab)', () => {
  assert.strictEqual(shouldCreateLabShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'observation', trust_level: 'weak', can_post: false },
  }), true);
});
test('valid + verified (main eligible) → false (lab)', () => {
  // Main shadow candidates don't go to lab
  assert.strictEqual(shouldCreateLabShadowBet(validPick), false);
});
test('blocked → false (lab)', () => {
  assert.strictEqual(shouldCreateLabShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'blocked', trust_level: 'blocked', can_post: false },
  }), false);
});
test('no odd → false (lab)', () => {
  assert.strictEqual(shouldCreateLabShadowBet({
    ...validPick, odd: null,
    audit_status: { pickAuditStatus: 'observation', trust_level: 'weak', can_post: false },
  }), false);
});

// ---------------------------------------------------------------------------
// 4. buildShadowBetFromPick
// ---------------------------------------------------------------------------
console.log('\nbuildShadowBetFromPick');

test('valid pick → returns record with correct fields', () => {
  const r = buildShadowBetFromPick(validPick);
  assert.ok(r, 'should return a record');
  assert.ok(r.id, 'id must be set');
  assert.strictEqual(r.is_combo, 0);
  assert.strictEqual(r.stake_simulated, 0.50);
  assert.ok(r.potential_return > r.stake_simulated, 'potential_return > stake');
});
test('observation → returns record tagged as lab', () => {
  const r = buildShadowBetFromPick({
    ...validPick,
    audit_status: { pickAuditStatus: 'observation', trust_level: 'weak', can_post: false },
  });
  assert.ok(r, 'observation should get lab shadow');
  assert.strictEqual(r._shadow_type, 'lab');
  assert.strictEqual(r.training_eligible, 0);
});
test('valid + verified → training_eligible = 1', () => {
  const r = buildShadowBetFromPick(validPick);
  assert.strictEqual(r._shadow_type, 'main');
  assert.strictEqual(r.training_eligible, 1);
});
test('blocked → returns null', () => {
  const r = buildShadowBetFromPick({
    ...validPick,
    audit_status: { pickAuditStatus: 'blocked', trust_level: 'blocked', can_post: false },
  });
  assert.strictEqual(r, null);
});
test('null input → null', () => assert.strictEqual(buildShadowBetFromPick(null), null));
test('potential_return = odd × stake', () => {
  const r = buildShadowBetFromPick({ ...validPick, odd: 3.00 });
  assert.ok(Math.abs(r.potential_return - 1.50) < 0.001, `Expected 1.50, got ${r.potential_return}`);
});
test('potential_profit = return - stake', () => {
  const r = buildShadowBetFromPick({ ...validPick, odd: 3.00 });
  assert.ok(Math.abs(r.potential_profit - 1.00) < 0.001);
});
test('bet365_event_id stringified', () => {
  const r = buildShadowBetFromPick({ ...validPick, bet365_event_id: 193552748 });
  assert.strictEqual(typeof r.bet365_event_id, 'string');
});
test('result_status defaults to pending', () => {
  const r = buildShadowBetFromPick(validPick);
  assert.strictEqual(r.result_status, 'pending');
});
test('clv_status defaults to unknown', () => {
  const r = buildShadowBetFromPick(validPick);
  assert.strictEqual(r.clv_status, 'unknown');
});

// ---------------------------------------------------------------------------
// 5. buildShadowBetFromCombo
// ---------------------------------------------------------------------------
console.log('\nbuildShadowBetFromCombo');

const validCombo = {
  combined_odd: 5.50,
  can_post: true,
  bet365_event_id: 'EV200',
  kickoff: '2026-05-12T18:00:00Z',
  selections: [{ market: '1X2' }, { market: 'BTTS' }],
  audit_status: { pickAuditStatus: 'valid', trust_level: 'supported', can_post: true },
};

test('valid combo → returns record with is_combo = 1', () => {
  const r = buildShadowBetFromCombo(validCombo);
  assert.ok(r, 'should return a record');
  assert.strictEqual(r.is_combo, 1);
  assert.strictEqual(r.legs_count, 2);
});
test('null combo → null', () => assert.strictEqual(buildShadowBetFromCombo(null), null));
test('combo with no selections → null', () => {
  assert.strictEqual(buildShadowBetFromCombo({ ...validCombo, selections: [] }), null);
});
test('combined_odd ≤ 1 → null', () => {
  assert.strictEqual(buildShadowBetFromCombo({ ...validCombo, combined_odd: 0.9 }), null);
});

// ---------------------------------------------------------------------------
// 6. ingestShadowBets — null-env guards
// ---------------------------------------------------------------------------
console.log('\ningestShadowBets (null-env guards)');

test('null env → returns default result shape', async () => {
  const r = await ingestShadowBets([], null);
  assert.strictEqual(r.ingested, 0);
  assert.strictEqual(r.skipped_invalid, 0);
  assert.strictEqual(r.skipped_dedup, 0);
  assert.strictEqual(r.skipped_no_table, false);
  assert.strictEqual(r.error, null);
});

test('empty records → returns default without D1 call', async () => {
  const r = await ingestShadowBets([], { SB_DB: {} });
  assert.strictEqual(r.ingested, 0);
});

test('records with no id skipped as invalid', async () => {
  const fakeEnv = {
    SB_DB: {
      batch: async () => [{ success: true, meta: { changes: 1 } }],
      prepare: () => ({ bind: () => ({ run: async () => ({}) }) }),
    },
  };
  const records = [null, { odd: 2.0 }, { id: 'sb-1', odd: 2.0 }];
  const r = await ingestShadowBets(records, fakeEnv);
  assert.strictEqual(r.skipped_invalid, 2);
});

test('duplicate ids skipped as dedup', async () => {
  const fakeEnv = {
    SB_DB: {
      batch: async () => [{ success: true, meta: { changes: 1 } }],
      prepare: () => ({ bind: () => ({ run: async () => ({}) }) }),
    },
  };
  const records = [{ id: 'sb-1', odd: 2.0 }, { id: 'sb-1', odd: 2.0 }];
  const r = await ingestShadowBets(records, fakeEnv);
  assert.strictEqual(r.skipped_dedup, 1);
});

test('table missing → skipped_no_table = true, no throw', async () => {
  const fakeEnv = {
    SB_DB: {
      batch: async () => { throw new Error('D1_ERROR: no such table: shadow_bets'); },
      prepare: () => ({ bind: () => ({}) }),
    },
  };
  const r = await ingestShadowBets([{ id: 'sb-1', odd: 2.0 }], fakeEnv);
  assert.strictEqual(r.skipped_no_table, true);
  assert.strictEqual(r.ingested, 0);
});

// ---------------------------------------------------------------------------
// P3.8.2 — shouldCreateLabShadowBet gap fix + buildShadowCreationDebug
// ---------------------------------------------------------------------------
console.log('\nshouldCreateLabShadowBet — P3.8.2 gap fix');

test('valid + verified + can_post=false → true (lab — P3.8.2 fix)', () => {
  assert.strictEqual(shouldCreateLabShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: false },
  }), true);
});

test('valid + supported + can_post=false → true (lab — P3.8.2 fix)', () => {
  assert.strictEqual(shouldCreateLabShadowBet({
    ...validPick,
    audit_status: { pickAuditStatus: 'valid', trust_level: 'supported', can_post: false },
  }), true);
});

console.log('\nbuildShadowBetFromPick — P3.8.2 lab record');

test('valid + trusted + can_post=false → lab record, training_eligible=0', () => {
  const r = buildShadowBetFromPick({
    ...validPick,
    audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: false },
  });
  assert.ok(r, 'should return a record (not null)');
  assert.strictEqual(r._shadow_type, 'lab');
  assert.strictEqual(r.training_eligible, 0);
});

console.log('\nbuildShadowCreationDebug');

test('counts main, lab, skipped correctly', () => {
  const candidates = [
    { ...validPick },
    { ...validPick, audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: false } },
    { ...validPick, odd: null },
  ];
  const r = buildShadowCreationDebug(candidates, { ingested: 2, skipped_dedup: 0, error: null });
  assert.strictEqual(r.total_candidates, 3);
  assert.strictEqual(r.main_candidates, 1);
  assert.strictEqual(r.lab_candidates, 1);
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(r.skipped_by_reason.missing_odd, 1);
  assert.strictEqual(r.skipped_by_reason.can_post_false, 0);
  assert.strictEqual(r.created, 2);
});

test('can_post_false = 0 after P3.8.2 fix (valid+trusted+!canPost goes to lab)', () => {
  const pick = { ...validPick, audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: false } };
  const r = buildShadowCreationDebug([pick], { ingested: 1, skipped_dedup: 0, error: null });
  assert.strictEqual(r.lab_candidates, 1);
  assert.strictEqual(r.skipped_by_reason.can_post_false, 0);
  assert.strictEqual(r.sample_created.length, 1);
  assert.strictEqual(r.sample_created[0].shadow_type, 'lab');
});

test('buildShadowCreationDebug(null, null) → safe empty result', () => {
  const r = buildShadowCreationDebug(null, null);
  assert.strictEqual(r.total_candidates, 0);
  assert.strictEqual(r.created, 0);
  assert.strictEqual(r.skipped, 0);
  assert.deepStrictEqual(r.sample_created, []);
  assert.deepStrictEqual(r.sample_skipped, []);
});

test('buildShadowCreationDebug: d1_error=1 when ingestResult.error truthy', () => {
  const r = buildShadowCreationDebug([], { ingested: 0, skipped_dedup: 0, error: 'timeout' });
  assert.strictEqual(r.skipped_by_reason.d1_error, 1);
});

// ---------------------------------------------------------------------------
// syncShadowBetAnnotations (P3.8.4.6)
// ---------------------------------------------------------------------------
console.log('\nsyncShadowBetAnnotations');

// Mock D1 environment helper
function makeMockD1(responsePerStmt = null) {
  const captured = [];
  const mockDb = {
    prepare(sql) {
      const params = [];
      return {
        bind(...args) { params.push(...args); return this; },
        run() { return Promise.resolve({ meta: { changes: 1 } }); },
        all() { return Promise.resolve({ results: [] }); },
        _sql: sql,
        _params: params,
      };
    },
    batch(stmts) {
      for (const s of stmts) captured.push({ sql: s._sql, params: s._params });
      // Default: each stmt reports 1 change (row updated)
      const res = stmts.map((_, i) =>
        responsePerStmt ? responsePerStmt[i] : { meta: { changes: 1 } }
      );
      return Promise.resolve(res);
    },
    _captured: captured,
  };
  return mockDb;
}

const annotatedPick = {
  bet365_event_id: 'EV999',
  fixture_id: null,
  stat: '1X2',
  selection: 'home',
  direction: null,
  source_family: 'b365',
  source: 'b365',
  is_combo: false,
  selections: null,
  odd: 2.10,
  betConfidenceResult: { score: 65, tier: 'valid_bet' },
  golden_score: 0.72,
  golden_support_score: 0.68,
  premiumQualityScore: 0.75,
  premium_quality_score: null,
  data_quality_score: 0.80,
  market_available: true,
  availability_confidence: 'high',
  odds_snapshot_id: 'SNAP001',
  entry_odd: 2.10,
  entry_line: null,
  entry_captured_at: '2026-05-13T04:00:00.000Z',
  odds_movement: { latest_odd: 2.05 },
  clv_pct: -2.38,
  clv_status: 'positive',
  notes_json: null,
};

test('returns attempted=0 when no items', async () => {
  const db = makeMockD1();
  const r = await syncShadowBetAnnotations([], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.strictEqual(r.attempted, 0);
  assert.strictEqual(r.updated, 0);
  assert.strictEqual(db._captured.length, 0);
});

test('returns attempted=0 when env has no SB_DB', async () => {
  const r = await syncShadowBetAnnotations([annotatedPick], {}, { pickDate: '2026-05-13' });
  assert.strictEqual(r.attempted, 0);
  assert.strictEqual(r.updated, 0);
});

test('issues one D1.batch per chunk of picks', async () => {
  const db = makeMockD1();
  const r = await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.strictEqual(r.attempted, 1);
  assert.strictEqual(r.batch_calls, 1);
  assert.strictEqual(db._captured.length, 1, 'should have captured 1 UPDATE statement');
});

test('UPDATE SQL does NOT contain training_eligible', async () => {
  const db = makeMockD1();
  await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  const sql = db._captured[0]?.sql ?? '';
  assert.ok(!sql.includes('training_eligible'), 'training_eligible must not appear in UPDATE');
});

test('UPDATE SQL does NOT contain result_status', async () => {
  const db = makeMockD1();
  await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  const sql = db._captured[0]?.sql ?? '';
  assert.ok(!sql.includes('result_status'), 'result_status must not appear in UPDATE');
});

test('UPDATE SQL does NOT contain profit_brl', async () => {
  const db = makeMockD1();
  await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  const sql = db._captured[0]?.sql ?? '';
  assert.ok(!sql.includes('profit_brl'), 'profit_brl must not appear in UPDATE');
});

test('UPDATE SQL does NOT contain settled_at', async () => {
  const db = makeMockD1();
  await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  const sql = db._captured[0]?.sql ?? '';
  assert.ok(!sql.includes('settled_at'), 'settled_at must not appear in UPDATE');
});

test('UPDATE SQL contains bet_confidence_score and WHERE id=?', async () => {
  const db = makeMockD1();
  await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  const sql = db._captured[0]?.sql ?? '';
  assert.ok(sql.includes('bet_confidence_score'), 'should update bet_confidence_score');
  assert.ok(sql.includes('WHERE id=?'), 'should use WHERE id=?');
});

test('counts updated when D1 batch reports changes=1', async () => {
  const db = makeMockD1([{ meta: { changes: 1 } }]);
  const r = await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.skipped, 0);
});

test('counts skipped when D1 batch reports changes=0 (row missing)', async () => {
  const db = makeMockD1([{ meta: { changes: 0 } }]);
  const r = await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.strictEqual(r.updated, 0);
  assert.strictEqual(r.skipped, 1);
});

test('reconstructed ID matches makeShadowBetId with same inputs', async () => {
  const db = makeMockD1([{ meta: { changes: 1 } }]);
  await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  // The last param in the UPDATE should be the reconstructed ID
  const capturedParams = db._captured[0]?.params ?? [];
  const lastParam = capturedParams[capturedParams.length - 1];
  const expectedId = makeShadowBetId({
    bet365_event_id: annotatedPick.bet365_event_id,
    fixture_id: annotatedPick.fixture_id,
    market: annotatedPick.stat || annotatedPick.market,
    selection: annotatedPick.selection || annotatedPick.direction,
    pick_date: '2026-05-13',
    source_family: annotatedPick.source_family || annotatedPick.source,
    is_combo: false,
  });
  assert.strictEqual(lastParam, expectedId, `ID mismatch: got ${lastParam}, expected ${expectedId}`);
});

test('null items are skipped gracefully', async () => {
  const db = makeMockD1();
  const r = await syncShadowBetAnnotations([null, undefined, annotatedPick, null], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.strictEqual(r.attempted, 1, 'only non-null items should be attempted');
  assert.strictEqual(r.batch_calls, 1);
});

test('sample_ids populated on successful updates', async () => {
  const db = makeMockD1([{ meta: { changes: 1 } }]);
  const r = await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.ok(r.sample_ids.length > 0, 'sample_ids should be populated when rows are updated');
});

test('duration_ms is a number >= 0', async () => {
  const db = makeMockD1();
  const r = await syncShadowBetAnnotations([annotatedPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.ok(typeof r.duration_ms === 'number' && r.duration_ms >= 0);
});

// ---------------------------------------------------------------------------
// syncShadowBetAuditAnnotations (P3.8.6.5)
// ---------------------------------------------------------------------------
console.log('\nsyncShadowBetAuditAnnotations');

const auditPick = {
  bet365_event_id: 'EVT999',
  fixture_id: null,
  stat: '1X2',
  market: '1X2',
  selection: 'home',
  direction: 'home',
  pick_date: '2026-05-13',
  source_family: 'bet365_direct',
  source: 'bet365_direct',
  audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: true },
  market_available: true,
  resolvability: { can_resolve: true, status: 'resolvable' },
  odd: 2.10,
};

test('syncShadowBetAuditAnnotations skips items with unknown audit_status', async () => {
  const db = makeMockD1();
  const unknownPick = { ...auditPick, audit_status: 'unknown' };
  const r = await syncShadowBetAuditAnnotations([unknownPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(r.attempted, 1);
  assert.strictEqual(db._captured.length, 0, 'no SQL should be issued for unknown audit');
});

test('syncShadowBetAuditAnnotations updates when audit is known', async () => {
  const db = makeMockD1([{ meta: { changes: 1 } }]);
  const r = await syncShadowBetAuditAnnotations([auditPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.strictEqual(r.attempted, 1);
  assert.ok(db._captured.length > 0, 'should issue an UPDATE statement');
  const sql = db._captured[0]?.sql ?? '';
  assert.ok(sql.includes('audit_status=?'), 'should set audit_status');
  assert.ok(sql.includes("AND audit_status='unknown'"), 'should only update unknown rows');
});

test('syncShadowBetAuditAnnotations sets training_eligible=1 for valid+verified+can_post+resolvable', async () => {
  const db = makeMockD1([{ meta: { changes: 1 } }]);
  await syncShadowBetAuditAnnotations([auditPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  const params = db._captured[0]?.params ?? [];
  // AUDIT_SYNC_SQL params: [pickAuditStatus, trustLevel, canPost, sourceFamily, trainingEligible, id]
  const trainingEligible = params[params.length - 2];
  assert.strictEqual(trainingEligible, 1, 'training_eligible should be 1');
});

test('syncShadowBetAuditAnnotations sets training_eligible=0 when can_post=false', async () => {
  const db = makeMockD1([{ meta: { changes: 1 } }]);
  const noCan = { ...auditPick, audit_status: { pickAuditStatus: 'valid', trust_level: 'verified', can_post: false } };
  await syncShadowBetAuditAnnotations([noCan], { SB_DB: db }, { pickDate: '2026-05-13' });
  const params = db._captured[0]?.params ?? [];
  const trainingEligible = params[params.length - 2];
  assert.strictEqual(trainingEligible, 0, 'training_eligible should be 0 when can_post=false');
});

test('syncShadowBetAuditAnnotations sets training_eligible=0 for observation audit', async () => {
  const db = makeMockD1([{ meta: { changes: 1 } }]);
  const obsPick = { ...auditPick, audit_status: { pickAuditStatus: 'observation', trust_level: 'partial', can_post: false } };
  await syncShadowBetAuditAnnotations([obsPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  const params = db._captured[0]?.params ?? [];
  const trainingEligible = params[params.length - 2];
  assert.strictEqual(trainingEligible, 0, 'training_eligible should be 0 for observation');
});

test('syncShadowBetAuditAnnotations returns early when env.SB_DB missing', async () => {
  const r = await syncShadowBetAuditAnnotations([auditPick], {}, { pickDate: '2026-05-13' });
  assert.strictEqual(r.attempted, 0);
});

test('syncShadowBetAuditAnnotations duration_ms is a number >= 0', async () => {
  const db = makeMockD1();
  const r = await syncShadowBetAuditAnnotations([auditPick], { SB_DB: db }, { pickDate: '2026-05-13' });
  assert.ok(typeof r.duration_ms === 'number' && r.duration_ms >= 0);
});

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
