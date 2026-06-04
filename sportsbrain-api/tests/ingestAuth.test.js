// tests/ingestAuth.test.js — Fase 1: contrato único de auth de ingest.
// Roda via `npm test` (vitest include: tests/**/*.test.js).
import { describe, it, expect } from 'vitest';
import { isValidIngestSecret } from '../src/utils/ingestAuth.js';
import { handleIngest } from '../src/routes/ingest.js';

// Request fake com headers case-insensitive (mimetiza Headers.get).
function makeReq(headers = {}) {
  const norm = {};
  for (const k of Object.keys(headers)) norm[k.toLowerCase()] = headers[k];
  return {
    method: 'POST',
    url: 'https://x/internal/ingest',
    headers: { get: (k) => norm[String(k).toLowerCase()] ?? null },
    json: async () => ({}),
  };
}

describe('isValidIngestSecret — contrato único', () => {
  it('server sem SB_INGEST_SECRET → false', () => {
    expect(isValidIngestSecret(makeReq({ 'X-Ingest-Secret': 'x' }), {})).toBe(false);
  });

  it('sem header → false', () => {
    expect(isValidIngestSecret(makeReq({}), { SB_INGEST_SECRET: 's3cr3t' })).toBe(false);
  });

  it('secret errado → false', () => {
    expect(
      isValidIngestSecret(makeReq({ 'X-Ingest-Secret': 'nope' }), { SB_INGEST_SECRET: 's3cr3t' })
    ).toBe(false);
  });

  it('secret correto → true', () => {
    expect(
      isValidIngestSecret(makeReq({ 'X-Ingest-Secret': 's3cr3t' }), { SB_INGEST_SECRET: 's3cr3t' })
    ).toBe(true);
  });

  it('header case-insensitive (x-ingest-secret) → true', () => {
    expect(
      isValidIngestSecret(makeReq({ 'x-ingest-secret': 's3cr3t' }), { SB_INGEST_SECRET: 's3cr3t' })
    ).toBe(true);
  });

  it('SB_MASTER_KEY NÃO autentica ingest', () => {
    const env = { SB_INGEST_SECRET: 's3cr3t', SB_MASTER_KEY: 'master' };
    expect(isValidIngestSecret(makeReq({ 'X-Ingest-Secret': 'master' }), env)).toBe(false);
  });

  it('legado INGEST_SECRET (sem SB_) NÃO autentica mais', () => {
    const env = { INGEST_SECRET: 'old' }; // env errado, sem SB_INGEST_SECRET
    expect(isValidIngestSecret(makeReq({ 'X-Ingest-Secret': 'old' }), env)).toBe(false);
  });
});

describe('handleIngest — wiring do contrato', () => {
  it('sem secret → 401', async () => {
    const res = await handleIngest(makeReq({}), { SB_INGEST_SECRET: 's3cr3t' });
    expect(res.status).toBe(401);
  });

  it('SB_MASTER_KEY no header → 401 (não mistura admin com ingest)', async () => {
    const env = { SB_INGEST_SECRET: 's3cr3t', SB_MASTER_KEY: 'master' };
    const res = await handleIngest(makeReq({ 'X-Ingest-Secret': 'master' }), env);
    expect(res.status).toBe(401);
  });

  it('secret correto → passa auth (não 401; 503 por falta de SB_DB)', async () => {
    const env = { SB_INGEST_SECRET: 's3cr3t' }; // sem SB_DB de propósito
    const res = await handleIngest(makeReq({ 'X-Ingest-Secret': 's3cr3t' }), env);
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(503);
  });
});
