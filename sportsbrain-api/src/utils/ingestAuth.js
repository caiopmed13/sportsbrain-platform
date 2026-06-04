// ingestAuth.js — CONTRATO ÚNICO de autenticação de ingest.
//
// Fase 1 (2026-05-19): unifica o auth das rotas internas de
// ingest que estavam fragmentadas (INGEST_SECRET vs
// SB_INGEST_SECRET vs SB_MASTER_KEY), causando 401 mesmo com
// secret correto configurado.
//
// Contrato oficial e ÚNICO:
//   - Env oficial:    SB_INGEST_SECRET
//   - Header oficial:  X-Ingest-Secret  (case-insensitive)
//   - SB_MASTER_KEY    NÃO autentica ingest (é só admin).
//
// Regras: server sem secret -> false; sem header -> false;
// header != secret -> false; igual -> true.

/**
 * Valida o secret de ingest contra o contrato único.
 * @param {Request} request
 * @param {Record<string,string|undefined>} env
 * @returns {boolean} true só se X-Ingest-Secret === SB_INGEST_SECRET
 */
export function isValidIngestSecret(request, env) {
  const expected = env && env.SB_INGEST_SECRET;
  if (!expected) return false; // server sem secret configurado
  const provided =
    (request &&
      request.headers &&
      (request.headers.get('X-Ingest-Secret') ||
        request.headers.get('x-ingest-secret'))) ||
    null;
  if (!provided) return false; // sem header
  return provided === expected; // errado -> false; correto -> true
}
