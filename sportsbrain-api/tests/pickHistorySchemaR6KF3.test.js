// tests/pickHistorySchemaR6KF3.test.js — P3.9 R6K-F3

import { describe, it, expect, vi } from 'vitest';
import {
  PICK_HISTORY_F3_COLUMNS,
  PICK_HISTORY_F3_MIGRATIONS,
  ensurePickHistoryF3Schema,
} from '../src/services/pickHistorySchema.js';

// Mock env factory — simulates D1 prepare/run
function mockEnv({ runImpl } = {}) {
  const calls = [];
  return {
    SB_DB: {
      prepare: (sql) => ({
        run: () => {
          calls.push(sql);
          if (runImpl) return runImpl(sql);
          return Promise.resolve({ success: true });
        },
      }),
    },
    _calls: calls,
  };
}

describe('R6K-F3 — constantes públicas', () => {
  it('PICK_HISTORY_F3_COLUMNS expõe 6 colunas', () => {
    expect(PICK_HISTORY_F3_COLUMNS).toEqual([
      'origin', 'parent_combo_id', 'method_family',
      'math_verdict', 'design_verdict', 'risk_tags_json',
    ]);
  });

  it('PICK_HISTORY_F3_COLUMNS é frozen', () => {
    expect(Object.isFrozen(PICK_HISTORY_F3_COLUMNS)).toBe(true);
  });

  it('PICK_HISTORY_F3_MIGRATIONS tem 6 entradas', () => {
    expect(PICK_HISTORY_F3_MIGRATIONS).toHaveLength(6);
  });

  it('cada migration tem name + sql ALTER TABLE', () => {
    for (const m of PICK_HISTORY_F3_MIGRATIONS) {
      expect(m.name).toBeTruthy();
      expect(m.sql).toMatch(/^ALTER TABLE pick_history ADD COLUMN/);
    }
  });
});

describe('R6K-F3 — ensurePickHistoryF3Schema: cold run', () => {
  it('roda todas as 6 ALTER TABLE em DB virgem', async () => {
    const env = mockEnv();
    const res = await ensurePickHistoryF3Schema(env);
    expect(res.ok).toBe(true);
    expect(res.attempted).toBe(6);
    expect(res.succeeded).toBe(6);
    expect(res.errors).toEqual([]);
    expect(env._calls).toHaveLength(6);
    for (const sql of env._calls) {
      expect(sql).toMatch(/^ALTER TABLE pick_history ADD COLUMN/);
    }
  });
});

describe('R6K-F3 — ensurePickHistoryF3Schema: idempotência', () => {
  it('2ª execução com "duplicate column name" conta como sucesso', async () => {
    const env = mockEnv({
      runImpl: () => Promise.reject(new Error('duplicate column name: origin')),
    });
    const res = await ensurePickHistoryF3Schema(env);
    expect(res.ok).toBe(true);
    expect(res.succeeded).toBe(6);
    expect(res.errors).toEqual([]);
  });

  it('erros não-duplicate são reportados como falha', async () => {
    const env = mockEnv({
      runImpl: () => Promise.reject(new Error('something else broke')),
    });
    const res = await ensurePickHistoryF3Schema(env);
    expect(res.ok).toBe(false);
    expect(res.succeeded).toBe(0);
    expect(res.errors).toHaveLength(6);
    expect(res.errors[0].message).toMatch(/something else broke/);
  });

  it('erros mistos: 3 duplicate (ok) + 3 fail', async () => {
    let count = 0;
    const env = mockEnv({
      runImpl: () => {
        count++;
        if (count <= 3) return Promise.reject(new Error('duplicate column name'));
        return Promise.reject(new Error('disk full'));
      },
    });
    const res = await ensurePickHistoryF3Schema(env);
    expect(res.succeeded).toBe(3);
    expect(res.errors).toHaveLength(3);
  });
});

describe('R6K-F3 — ensurePickHistoryF3Schema: robustness', () => {
  it('env sem SB_DB → ok=false sem throw', async () => {
    const res = await ensurePickHistoryF3Schema({});
    expect(res.ok).toBe(false);
    expect(res.errors[0].name).toBe('env');
  });

  it('env undefined → ok=false sem throw', async () => {
    const res = await ensurePickHistoryF3Schema();
    expect(res.ok).toBe(false);
  });

  it('SB_DB sem prepare → ok=false', async () => {
    const res = await ensurePickHistoryF3Schema({ SB_DB: {} });
    expect(res.ok).toBe(false);
  });
});
