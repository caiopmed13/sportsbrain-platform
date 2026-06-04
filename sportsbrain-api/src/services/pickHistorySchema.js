// ══════════════════════════════════════════════════════════════════════════
// Pick History Schema — P3.9 R6K-F3
// ══════════════════════════════════════════════════════════════════════════
//
// Mantém o schema de pick_history forward-compatible. Cada coluna nova é
// adicionada via ALTER TABLE ADD COLUMN dentro de try/catch, então rodar o
// helper 2x não falha (idempotente).
//
// SQLite (D1) NÃO suporta "ALTER TABLE ADD COLUMN IF NOT EXISTS"; a
// idempotência vem do `.catch(() => {})` que silencia erros de coluna
// duplicada.
//
// Filosofia: este é "path normal da aplicação" — não é D1 manual write.
// Roda no contexto de request (auto-save Premium ou GET performance-ia).
//
// Colunas R6K-F3 adicionadas:
//   - origin           TEXT  — 'tier1_single' | 'tier2_leg' | 'tier3_leg' |
//                              'tier4_leg' | 'bet_builder_leg' |
//                              'results_acca_leg' | 'top_picks_today' |
//                              'tipster_leg' | 'faixa_leg' | 'jackpot_leg' |
//                              'mega_leg'
//   - parent_combo_id  TEXT  — null para tier1_single; ID do combo pai senão
//   - method_family    TEXT  — 'ai_singles' | 'ai_combo' | 'tipster' |
//                              'faixa' | 'mega'
//   - math_verdict     TEXT  — gold/value/fair/trap/unknown
//   - design_verdict   TEXT  — long_shot | null
//   - risk_tags_json   TEXT  — JSON.stringify(string[])
//
// NÃO altera ranking, scoring, threshold global, motor de picks.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Colunas R6K-F3 a garantir. Lista mantida frozen para deixar claro o
 * contrato. Use `pick_history_f3_columns` em testes/queries para enumerar.
 */
export const PICK_HISTORY_F3_COLUMNS = Object.freeze([
  'origin',
  'parent_combo_id',
  'method_family',
  'math_verdict',
  'design_verdict',
  'risk_tags_json',
]);

/**
 * Cada item: { name, sql } onde sql é a ALTER TABLE completa para essa
 * coluna. Frozen para evitar mutação.
 */
export const PICK_HISTORY_F3_MIGRATIONS = Object.freeze([
  { name: 'origin',          sql: 'ALTER TABLE pick_history ADD COLUMN origin TEXT' },
  { name: 'parent_combo_id', sql: 'ALTER TABLE pick_history ADD COLUMN parent_combo_id TEXT' },
  { name: 'method_family',   sql: 'ALTER TABLE pick_history ADD COLUMN method_family TEXT' },
  { name: 'math_verdict',    sql: 'ALTER TABLE pick_history ADD COLUMN math_verdict TEXT' },
  { name: 'design_verdict',  sql: 'ALTER TABLE pick_history ADD COLUMN design_verdict TEXT' },
  { name: 'risk_tags_json',  sql: 'ALTER TABLE pick_history ADD COLUMN risk_tags_json TEXT' },
]);

/**
 * Roda as ALTER TABLEs idempotentemente. Cada uma envolvida em try/catch
 * para sobreviver à 2ª execução (coluna já existe).
 *
 * @param {{ SB_DB?: any }} env — wrangler env com binding D1 'SB_DB'
 * @returns {Promise<{ ok: boolean, attempted: number, succeeded: number, errors: Array<{name: string, message: string}> }>}
 */
export async function ensurePickHistoryF3Schema(env) {
  if (!env || !env.SB_DB || typeof env.SB_DB.prepare !== 'function') {
    return { ok: false, attempted: 0, succeeded: 0, errors: [{ name: 'env', message: 'SB_DB missing' }] };
  }

  let succeeded = 0;
  const errors = [];

  for (const mig of PICK_HISTORY_F3_MIGRATIONS) {
    try {
      await env.SB_DB.prepare(mig.sql).run();
      succeeded++;
    } catch (e) {
      // ALTER TABLE em coluna existente = "duplicate column name". Considera
      // como sucesso idempotente — coluna está lá. Outros erros são reais.
      const msg = (e && e.message) ? String(e.message) : String(e);
      if (/duplicate column name/i.test(msg)) {
        succeeded++;
      } else {
        errors.push({ name: mig.name, message: msg });
      }
    }
  }

  return {
    ok: errors.length === 0,
    attempted: PICK_HISTORY_F3_MIGRATIONS.length,
    succeeded,
    errors,
  };
}
