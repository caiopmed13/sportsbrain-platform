#!/usr/bin/env node
// scripts/backfill-confidence-tier.mjs — P3.9 R2A
//
// Recalcula bet_confidence_score / bet_confidence_tier usando a função
// EXISTENTE (calcBetConfidenceScore) — sem mudar thresholds, sem mexer
// em outras colunas. O D1 está stale: 100% das 2035 rows em 'no_bet',
// mas a função atual classifica ~1339 como 'lab_only'. Este script
// reconcilia o tier persistido com a função canônica.
//
// USO:
//   node scripts/backfill-confidence-tier.mjs --dry-run            # default
//   node scripts/backfill-confidence-tier.mjs --dry-run --limit 500
//   node scripts/backfill-confidence-tier.mjs --dry-run --all
//   node scripts/backfill-confidence-tier.mjs --apply --all         # exige autorização
//   node scripts/backfill-confidence-tier.mjs --dry-run --since "2026-05-19 22:24:00"
//   node scripts/backfill-confidence-tier.mjs --apply  --since "2026-05-19 22:24:00"  # R6G
//
// SEGURANÇA:
//   - dry-run é o default; --apply é EXPLÍCITO.
//   - Só atualiza bet_confidence_score e bet_confidence_tier.
//   - NUNCA toca result_status/training_eligible/can_post/audit_status/
//     trust_level/market/selection/odd/clv_status/clv_pct/closing_odd.
//   - Pula rows onde score+tier calculados já batem com o D1 (idempotente).
//   - Token CF tem que estar em env (CLOUDFLARE_API_TOKEN); secret nunca logado.

import { calcBetConfidenceScore } from '../src/services/betConfidence.js';

const CF_ACCOUNT_ID = '8aca021a28790477e7d1478f17530a64';
const CF_DB_ID      = '984fa15a-3e26-4766-8df4-bd09d239002d';
const CF_TOKEN      = process.env.CLOUDFLARE_API_TOKEN;
if (!CF_TOKEN) { console.error('CLOUDFLARE_API_TOKEN env missing'); process.exit(2); }

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const idxLimit = args.indexOf('--limit');
const LIMIT = idxLimit >= 0 ? Math.max(1, parseInt(args[idxLimit + 1], 10) || 0) : null;
// P3.9 R6G: filtro --since "YYYY-MM-DD HH:MM:SS" para reconciliar somente
// rows recentes (ex.: lote fresh stale de premium-accumulation).
const idxSince = args.indexOf('--since');
const SINCE = idxSince >= 0 ? String(args[idxSince + 1] || '').trim() : null;
if (SINCE && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(SINCE)) {
  console.error('--since deve estar no formato YYYY-MM-DD [HH:MM[:SS]]');
  process.exit(2);
}
const BATCH = 50;

const SELECT_COLS = [
  'id', 'sport', 'market', 'selection', 'home_team', 'away_team',
  'kickoff', 'odd', 'entry_odd',
  'audit_status', 'trust_level', 'can_post',
  'market_available', 'availability_confidence',
  'odds_snapshot_id', 'clv_status',
  'golden_score', 'golden_support_score',
  'legs_count', 'source_family',
  'bet_confidence_score', 'bet_confidence_tier',
].join(',');

async function d1(sql, params = []) {
  // Cloudflare D1 HTTP API — mesmo token, sem subprocess.
  const url = 'https://api.cloudflare.com/client/v4/accounts/'
    + CF_ACCOUNT_ID + '/d1/database/' + CF_DB_ID + '/query';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CF_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const js = await res.json();
  if (!res.ok || !js.success) {
    const errs = (js.errors || []).map(e => e.code + ':' + e.message).join('; ');
    throw new Error('D1 API failed (' + res.status + '): ' + errs);
  }
  return js.result; // array; result[0].results = rows
}

// --- pull rows ---
// Ordem dos modificadores: WHERE created_at > ? (opcional) + LIMIT (opcional).
// Se --since estiver presente, --all/--limit ainda valem como bound superior.
const whereClause = SINCE ? `WHERE created_at > '${SINCE.replace(/'/g, "''")}'` : '';
const rangeClause = LIMIT ? `LIMIT ${LIMIT}` : (ALL || SINCE ? '' : 'LIMIT 100');
const sql = `SELECT ${SELECT_COLS} FROM shadow_bets ${whereClause} ${rangeClause}`.trim();
console.log('[backfill] dry_run=' + !APPLY
  + ' since=' + (SINCE || 'null')
  + ' limit=' + (LIMIT || (ALL || SINCE ? 'all' : 100)));
console.log('[backfill] fetching shadow_bets from D1 (remote, read-only)...');
const data = await d1(sql);
const rows = data[0].results;
console.log('[backfill] rows_fetched: ' + rows.length);

// --- compute new score/tier per row using existing fn ---
const tierBefore = {};
const tierAfter = {};
const updates = [];
const noChange = [];
let scoreMin = Infinity, scoreMax = -Infinity, scoreSum = 0, scoreN = 0;

for (const r of rows) {
  const before_tier = r.bet_confidence_tier || 'no_bet';
  tierBefore[before_tier] = (tierBefore[before_tier] || 0) + 1;
  const calc = calcBetConfidenceScore(r);
  const after_tier = calc.tier;
  tierAfter[after_tier] = (tierAfter[after_tier] || 0) + 1;
  scoreN++;
  scoreSum += calc.score;
  if (calc.score < scoreMin) scoreMin = calc.score;
  if (calc.score > scoreMax) scoreMax = calc.score;
  const sameScore = Math.abs((r.bet_confidence_score ?? 0) - calc.score) < 0.05;
  const sameTier = before_tier === after_tier;
  if (sameScore && sameTier) {
    noChange.push(r.id);
  } else {
    updates.push({ id: r.id, score: calc.score, tier: calc.tier });
  }
}

const summary = {
  ok: true,
  dry_run: !APPLY,
  rows_scanned: rows.length,
  would_update_count: updates.length,
  no_change_count: noChange.length,
  tier_before: tierBefore,
  tier_after_simulated: tierAfter,
  score_min: scoreN ? scoreMin : 0,
  score_avg: scoreN ? +(scoreSum / scoreN).toFixed(3) : 0,
  score_max: scoreN ? scoreMax : 0,
  micro_test_count: tierAfter['micro_test'] || 0,
  columns_touched: APPLY
    ? ['bet_confidence_score', 'bet_confidence_tier']
    : [],
};
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));

// --- apply em lotes (só se --apply) ---
if (APPLY) {
  if (!updates.length) {
    console.log('[backfill] nothing to update, exiting');
    process.exit(0);
  }
  console.log('\n[backfill] APPLY mode: writing ' + updates.length + ' updates in batches of ' + BATCH);
  let applied = 0, failed = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const stmts = batch.map(u => {
      const safeId = String(u.id).replace(/'/g, "''");
      const safeTier = String(u.tier).replace(/'/g, "''");
      return 'UPDATE shadow_bets SET bet_confidence_score='
        + Number(u.score) + ', bet_confidence_tier=\''
        + safeTier + '\' WHERE id=\'' + safeId + '\';';
    }).join('\n');
    try {
      await d1(stmts);
      applied += batch.length;
      process.stdout.write('\rapplied: ' + applied + '/' + updates.length);
    } catch (e) {
      failed += batch.length;
      console.error('\nbatch failed at offset ' + i + ': ' + e.message);
      break;
    }
  }
  console.log('\n[backfill] applied=' + applied + ' failed=' + failed);
}
