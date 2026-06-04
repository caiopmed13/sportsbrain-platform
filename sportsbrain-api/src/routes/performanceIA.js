// ══════════════════════════════════════════════════════════════════════════
// Performance IA Route — P3.9 R6K-F3
// ══════════════════════════════════════════════════════════════════════════
//
// GET /v1/premium/performance-ia
//
// Read-only endpoint que mede a IA do Premium contra o próprio histórico
// (pick_history). Retorna:
//   - overall:       WR/ROI/n/streak/sample_total
//   - by_method:     ai_singles, ai_combo, tipster, faixa, mega
//   - by_tier:       tier1..tier4 (via _tier inferido do origin)
//   - by_origin:     8 origens (tier1_single, tier2_leg, ...)
//   - by_market:     agrupado por market normalizado
//   - by_odd_bucket: WR e margem vs breakeven por bucket
//   - by_math_verdict:   gold/value/fair/trap/unknown
//   - by_design_verdict: long_shot / none
//   - verdict_calibration: ajuste #3 — insufficient_sample não é blocker
//   - convergence:   ready / blockers
//
// Query params:
//   window_days  (default 30, clamp 1..365)
//   sport        (default 'football')
//   method       (optional — filtra um method_family específico)
//
// Resposta sempre traz lab_mode=true, can_beta=false, can_sell=false,
// micro_test_active=false (annotate-don't-sell).
//
// NÃO ativa comercial. NÃO escreve no D1.
// ══════════════════════════════════════════════════════════════════════════

import {
  computeWR,
  computeROI,
  computeStreak,
  computeWRByGroup,
  computeWRByOddBucket,
} from '../services/wrCalculator.js';
import { computeConvergence } from '../services/convergenceMetric.js';
import { ensurePickHistoryF3Schema } from '../services/pickHistorySchema.js';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const MIN_WINDOW_DAYS = 1;

const ORIGIN_TO_TIER = Object.freeze({
  tier1_single:    'tier1',
  tier2_leg:       'tier2',
  tier3_leg:       'tier3',
  tier4_leg:       'tier4',
  bet_builder_leg: 'bet_builder',
  results_acca_leg:'results_acca',
  top_picks_today: 'top_picks_today',
  tipster_leg:     'tipster',
});

function clampWindowDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_DAYS;
  if (n < MIN_WINDOW_DAYS) return MIN_WINDOW_DAYS;
  if (n > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS;
  return Math.floor(n);
}

function dateNDaysAgoBR(daysAgo) {
  const t = new Date(Date.now() - 3 * 3600_000 - daysAgo * 86400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(t.getUTCDate()).padStart(2,'0')}`;
}

/**
 * Carrega rows pick_history da janela. Defensive contra schema mismatch.
 *
 * @returns {Promise<object[]>}
 */
async function loadHistoryRows(env, { windowDays, sport, method }) {
  const since = dateNDaysAgoBR(windowDays);
  const params = [since, sport];
  // origin IS NOT NULL filtra apenas rows do schema R6K-F3.
  // Rows do auto-save legacy (tier1 sem origin) NÃO entram aqui — evita
  // contagem dupla quando o auto-save antigo e o novo coexistem.
  let sql = `
    SELECT
      id, pick_date, sport, match, home_team, away_team, league,
      stat AS market, direction, line,
      real_odd, ev_real AS ev_pct,
      result, profit_unit, settled_at,
      origin, parent_combo_id, method_family,
      math_verdict, design_verdict, risk_tags_json
    FROM pick_history
    WHERE pick_date >= ?
      AND COALESCE(sport, 'football') = ?
      AND origin IS NOT NULL
  `;
  if (method) {
    sql += ' AND method_family = ?';
    params.push(method);
  }
  sql += ' ORDER BY pick_date ASC LIMIT 5000';

  try {
    const res = await env.SB_DB.prepare(sql).bind(...params).all();
    return res?.results || [];
  } catch (_e) {
    return [];
  }
}

/**
 * Computa o payload completo. Pura — aceita rows + opts.
 *
 * @param {object[]} rows
 * @param {object} opts
 * @returns {object}
 */
export function buildPerformanceIaPayload(rows, opts = {}) {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  const safe = Array.isArray(rows) ? rows : [];
  const settledRows = safe.filter(r => r?.result === 'W' || r?.result === 'L' || r?.result === 'P');
  const overallWr = computeWR(safe);
  const overallRoi = computeROI(safe);
  const streak = computeStreak(safe);

  // by_origin → por origem (8 valores possíveis)
  const by_origin = computeWRByGroup(safe, 'origin');

  // by_tier — derivado de origin
  const by_tier = computeWRByGroup(safe, (r) => ORIGIN_TO_TIER[r?.origin] || 'unknown');

  // by_method
  const by_method = computeWRByGroup(safe, 'method_family');

  // by_market
  const by_market = computeWRByGroup(safe, 'market');

  // by_odd_bucket
  const by_odd_bucket = computeWRByOddBucket(safe);

  // by_math_verdict / by_design_verdict
  const by_math_verdict   = computeWRByGroup(safe, 'math_verdict');
  const by_design_verdict = computeWRByGroup(safe, (r) => r?.design_verdict || 'none');

  // Convergência (inclui verdict_calibration internamente)
  const convergence = computeConvergence(safe);

  return {
    ok: true,
    window_days: windowDays,
    sample_total: overallWr.n,
    overall: {
      n:        overallWr.n,
      settled:  overallWr.settled,
      pending:  overallWr.pending,
      wins:     overallWr.wins,
      losses:   overallWr.losses,
      pushes:   overallWr.pushes,
      wr:       overallWr.wr,
      roi_pct:  overallRoi.roi,
      profit_unit: overallRoi.profit_total,
      streak,
    },
    by_method,
    by_tier,
    by_origin,
    by_market,
    by_odd_bucket,
    by_math_verdict,
    by_design_verdict,
    verdict_calibration: convergence.verdict_calibration,
    convergence: {
      ready:        convergence.ready,
      sample_total: convergence.sample_total,
      roi_pct:      convergence.roi_pct,
      wr:           convergence.wr,
      blockers:     convergence.blockers,
      target:       convergence.target,
    },
    // safety flags — LAB mode preserved (NÃO ativa comercial)
    lab_mode:           true,
    can_beta:           false,
    can_sell:           false,
    micro_test_active:  false,
    disclaimer:         'LAB_ONLY_PERFORMANCE_NOT_BETTING_ADVICE',
    generated_at:       new Date().toISOString(),
    settled_count_debug: settledRows.length,
  };
}

/**
 * Handler do endpoint GET /v1/premium/performance-ia
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handlePerformanceIa(request, env) {
  if (!env || !env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'no_db' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const windowDays = clampWindowDays(url.searchParams.get('window_days'));
  const sport = url.searchParams.get('sport') || 'football';
  const method = url.searchParams.get('method') || null;

  // Garante schema R6K-F3 (idempotente — path normal da aplicação)
  await ensurePickHistoryF3Schema(env);

  const rows = await loadHistoryRows(env, { windowDays, sport, method });
  const payload = buildPerformanceIaPayload(rows, { windowDays });

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60',
    },
  });
}
