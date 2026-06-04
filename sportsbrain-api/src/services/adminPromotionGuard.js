// ══════════════════════════════════════════════════════════════════════════
// Admin Promotion Guard — P3.9 R6K-F1 (refinamento do R6H-G)
// ══════════════════════════════════════════════════════════════════════════
//
// Função pura usada pelo endpoint /internal/admin/resync-confidence-scores
// para decidir se uma row deve ser promovida para can_post=1/training_eligible=1
// no momento que o audit_status é setado.
//
// FILOSOFIA R6K-F1:
//
// O guard protege contra **dados corrompidos**, NÃO contra mercado arriscado.
// Mercado arriscado (correct_score / ht_ft / draw_no_bet) e EV negativo
// continuam aparecendo, mas como BADGE (verdict/risk_tags) no payload do
// Premium (R6K-F2), não como bloqueio na promoção.
//
// HISTÓRICO:
//
//   R6H-G (versão anterior) bloqueava:
//     - tier === 'no_bet'
//     - score finito < 40 (MIN_PROMOTION_SCORE)
//     - market high-risk (CORRECT_SCORE, HT_FT, DRAW_NO_BET, ...)
//
//   R6K-F1 (versão atual) bloqueia apenas:
//     - no_fixture        — fixture_id / event_id ausente ou inválido
//     - no_market         — market vazio/null
//     - no_selection      — selection vazia/null
//     - audit_unknown_zero — audit=unknown E trust=unknown E score=0
//                            (pick sem qualquer sinal — completamente cego)
//     - score_absurd      — score===0 OU score>100 (bug/corrupted)
//
//   Rows com score baixo mas finito (e.g. 6-16) NÃO são mais bloqueadas pelo
//   guard. A camada de annotate (R6K-F2 badges) marca essas rows visualmente
//   no Premium para o usuário decidir.
//
// NÃO TOCA audit_status — apenas evita promover can_post/training_eligible.
// Razão: audit_status='valid' tem semântica de "pick estruturalmente OK" e é
// consumido por outros caminhos do app. O guard apenas bloqueia o flip de
// can_post/training_eligible em rows quebradas.
//
// NÃO altera ranking, scoring, threshold global, motor de picks.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Score considerado "absurdo" — indica bug do pipeline de confidence ou row
 * corrompida. Score zero significa "calculadora não retornou nada útil"; valor
 * acima de 100 quebra a escala canônica (0-100).
 */
export const SCORE_ABSURD_MAX = 100;

/**
 * Razões públicas de block (úteis para observabilidade e telemetria).
 */
export const BLOCK_REASONS = Object.freeze({
  NO_FIXTURE:         'no_fixture',
  NO_MARKET:          'no_market',
  NO_SELECTION:       'no_selection',
  AUDIT_UNKNOWN_ZERO: 'audit_unknown_zero',
  SCORE_ABSURD:       'score_absurd',
});

/**
 * Extrai um identificador de fixture do row de forma tolerante. Aceita
 * `fixture_id`, `event_id`, `fixtureId`, `eventId`, ou `bet365_event_id`.
 *
 * @param {object} row
 * @returns {string|number|null}
 */
function pickFixtureIdentifier(row) {
  if (!row || typeof row !== 'object') return null;
  const candidates = [
    row.fixture_id,
    row.event_id,
    row.fixtureId,
    row.eventId,
    row.bet365_event_id,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string' && c.trim() === '') continue;
    if (typeof c === 'number' && (!Number.isFinite(c) || c === 0)) continue;
    return c;
  }
  return null;
}

/**
 * Verifica se um campo textual é "vazio" no sentido lógico: null, undefined,
 * string vazia ou só com whitespace.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isEmptyText(value) {
  if (value == null) return true;
  return String(value).trim() === '';
}

/**
 * Normaliza o score de confidence em number finito ou null.
 *
 * @param {*} raw
 * @returns {number|null}
 */
function normalizeScore(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Decide se uma row do admin resync deve ser promovida para
 * can_post=1/training_eligible=1.
 *
 * Inputs:
 *   - row: shape parcial { market, selection, fixture_id|event_id, ... }
 *   - audit: { pickAuditStatus, trustLevel, canPost, trainingEligible }
 *   - confidence: { score, tier }  (tier ignorado pelo F1 — mantido na API
 *                                    para compat com R6H-G callers)
 *
 * Output: { canPost, trainingEligible, blocked, reason }
 *
 * Regras (ordem de avaliação):
 *   0. Se audit.canPost=false → mantém canPost=0/training=0 (sem block flag)
 *   1. Se sem fixture identifier → block 'no_fixture'
 *   2. Se market vazio/null → block 'no_market'
 *   3. Se selection vazia/null → block 'no_selection'
 *   4. Se audit=unknown E trust=unknown E score=0 → block 'audit_unknown_zero'
 *   5. Se score finito e (=== 0 OU > SCORE_ABSURD_MAX) → block 'score_absurd'
 *   6. Caso contrário → promove conforme audit/admin
 *
 * @param {object} params
 * @param {object} params.row
 * @param {object} params.audit
 * @param {object} params.confidence
 * @returns {{ canPost: number, trainingEligible: number, blocked: boolean, reason: string|null }}
 */
export function shouldAdminPromoteStaleCandidate({ row, audit, confidence } = {}) {
  const safeRow = row || {};
  const safeAudit = audit || {};
  const safeConf = confidence || {};

  const auditCanPost = !!safeAudit.canPost;
  const auditTraining = safeAudit.trainingEligible === 1 || safeAudit.trainingEligible === true;

  // Passthrough: se audit já não permite can_post, não há promoção para bloquear.
  if (!auditCanPost) {
    return { canPost: 0, trainingEligible: 0, blocked: false, reason: null };
  }

  // Guard 1: no_fixture
  if (pickFixtureIdentifier(safeRow) == null) {
    return { canPost: 0, trainingEligible: 0, blocked: true, reason: BLOCK_REASONS.NO_FIXTURE };
  }

  // Guard 2: no_market
  if (isEmptyText(safeRow.market)) {
    return { canPost: 0, trainingEligible: 0, blocked: true, reason: BLOCK_REASONS.NO_MARKET };
  }

  // Guard 3: no_selection
  if (isEmptyText(safeRow.selection)) {
    return { canPost: 0, trainingEligible: 0, blocked: true, reason: BLOCK_REASONS.NO_SELECTION };
  }

  const score = normalizeScore(safeConf.score);
  const pickAuditStatus = safeAudit.pickAuditStatus ?? null;
  const trustLevel = safeAudit.trustLevel ?? safeAudit.trust_level ?? null;

  // Guard 4: audit_unknown_zero — pick completamente cego
  if (pickAuditStatus === 'unknown' && trustLevel === 'unknown' && score === 0) {
    return { canPost: 0, trainingEligible: 0, blocked: true, reason: BLOCK_REASONS.AUDIT_UNKNOWN_ZERO };
  }

  // Guard 5: score_absurd — score 0 ou > 100 (bug do pipeline)
  if (score !== null && (score === 0 || score > SCORE_ABSURD_MAX)) {
    return { canPost: 0, trainingEligible: 0, blocked: true, reason: BLOCK_REASONS.SCORE_ABSURD };
  }

  // Caso contrário: promoção permitida conforme audit/admin
  return {
    canPost: auditCanPost ? 1 : 0,
    trainingEligible: auditTraining ? 1 : 0,
    blocked: false,
    reason: null,
  };
}
