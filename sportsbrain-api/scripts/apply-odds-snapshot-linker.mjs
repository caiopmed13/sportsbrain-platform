#!/usr/bin/env node
// scripts/apply-odds-snapshot-linker.mjs — P3.9 R2B Apply
//
// Aplica o linker em shadow_bets que casam com odds_snapshots (status='linked').
// dry-run default; --apply explícito; sem fuzzy match; só atualiza as 6 colunas
// permitidas pelo escopo (NUNCA result_status/training_eligible/can_post/
// audit_status/trust_level/market/selection/odd/clv_status/clv_pct/closing_odd/
// created_at).
//
// USO:
//   node scripts/apply-odds-snapshot-linker.mjs                 # dry-run
//   node scripts/apply-odds-snapshot-linker.mjs --limit 100     # dry-run com cap
//   node scripts/apply-odds-snapshot-linker.mjs --apply --limit 100
//   node scripts/apply-odds-snapshot-linker.mjs --apply --all
//
// Lê D1 via Cloudflare API (mesmo CLOUDFLARE_API_TOKEN). Sem subprocess.

import {
  linkShadowBetToOddsSnapshot,
  normalizeShadowMarket,
  parseShadowKickoff,
} from '../src/services/oddsSnapshotLinker.js';
import { eventId } from '../src/odds/normalize.js';

const CF_ACCOUNT_ID = '8aca021a28790477e7d1478f17530a64';
const CF_DB_ID      = '984fa15a-3e26-4766-8df4-bd09d239002d';
const CF_TOKEN      = process.env.CLOUDFLARE_API_TOKEN;
if (!CF_TOKEN) { console.error('CLOUDFLARE_API_TOKEN missing'); process.exit(2); }

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Math.max(1, parseInt(args[li + 1], 10) || 0) : null;
const BATCH = 25;

// Colunas que o script pode ATUALIZAR (escopo R2B aprovado, intersected
// com o schema REAL — `odds_snapshot_count` foi removida porque não
// existe no shadow_bets; o componente do score continua respeitado
// porque o linker hidrata in-memory antes de calcBetConfidenceScore).
const ALLOWED_UPDATE_COLS = new Set([
  'odds_snapshot_id',
  'market_available', 'availability_confidence',
  'bet_confidence_score', 'bet_confidence_tier',
]);
// odds_snapshot_count: usada apenas em memória pelo linker, não persistida.

async function d1(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DB_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const js = await res.json();
  if (!res.ok || !js.success) {
    const errs = (js.errors || []).map(e => e.code + ':' + e.message).join('; ');
    throw new Error('D1 API failed (' + res.status + '): ' + errs);
  }
  return js.result;
}

const SB_COLS = [
  'id', 'sport', 'market', 'selection', 'home_team', 'away_team',
  'kickoff', 'odd', 'entry_odd',
  'audit_status', 'trust_level', 'can_post',
  'market_available', 'availability_confidence',
  'odds_snapshot_id', 'clv_status',
  'golden_score', 'golden_support_score',
  'legs_count', 'source_family',
  'bet_confidence_score', 'bet_confidence_tier',
].join(',');

const limClause = LIMIT ? `LIMIT ${LIMIT}` : '';
console.log('[r2b] dry_run=' + !APPLY + ' limit=' + (LIMIT || (ALL ? 'all' : 'default')));
console.log('[r2b] fetching shadow_bets (training_eligible=1) ...');
const sbData = await d1(`SELECT ${SB_COLS} FROM shadow_bets WHERE training_eligible=1 ${limClause}`);
const sb = sbData[0].results;
console.log('[r2b] shadow_bets rows:', sb.length);

console.log('[r2b] fetching odds_snapshots (h2h/btts, last 30d) ...');
const odSql = `SELECT id,event_id,book,market,outcome,line,price,ts FROM odds_snapshots WHERE market IN ('h2h','btts') AND ts >= (CAST(strftime('%s','now') AS INTEGER) - 2592000) * 1000`;
const odData = await d1(odSql);
const od = odData[0].results;
console.log('[r2b] odds_snapshots rows:', od.length);

const byEvent = new Map();
for (const s of od) {
  const arr = byEvent.get(s.event_id) || [];
  arr.push(s);
  byEvent.set(s.event_id, arr);
}

// Roda o linker; coleta apenas status='linked'
const linkedUpdates = [];
const statusCount = {};
for (const bet of sb) {
  let r;
  const m = normalizeShadowMarket(bet.market);
  if (m === 'unsupported_market') {
    r = linkShadowBetToOddsSnapshot(bet, []);
  } else {
    const ko = parseShadowKickoff(bet.kickoff);
    let cand = [];
    if (bet.home_team && bet.away_team && ko != null) {
      const eid = eventId(bet.home_team, bet.away_team, ko);
      const sub = byEvent.get(eid);
      if (sub) cand = sub;
    }
    r = linkShadowBetToOddsSnapshot(bet, cand);
  }
  statusCount[r.status] = (statusCount[r.status] || 0) + 1;
  if (r.status !== 'linked') continue;
  // Filtra fields para conter apenas colunas que existem no schema.
  // odds_snapshot_count NUNCA é persistida (não existe na tabela).
  const persistedFields = {};
  for (const k of Object.keys(r.fields)) {
    if (ALLOWED_UPDATE_COLS.has(k)) persistedFields[k] = r.fields[k];
    // demais campos (e.g., odds_snapshot_count) ficam só em-memória
  }
  linkedUpdates.push({ id: bet.id, fields: persistedFields });
}

console.log('\n=== STATUS COUNT ===');
console.log(JSON.stringify(statusCount, null, 2));
console.log('[r2b] linked_count (targets de UPDATE):', linkedUpdates.length);
console.log('[r2b] columns_touched:', [...ALLOWED_UPDATE_COLS].join(','));

if (!APPLY) {
  console.log('[r2b] DRY-RUN — nenhum write executado. Use --apply para gravar.');
  process.exit(0);
}

if (!linkedUpdates.length) {
  console.log('[r2b] nada a atualizar; exit.');
  process.exit(0);
}

// Apply em batches via UPDATEs multi-statement
console.log('\n[r2b] APPLY mode: writing ' + linkedUpdates.length + ' UPDATEs em batches de ' + BATCH);
let applied = 0, failed = 0;
for (let i = 0; i < linkedUpdates.length; i += BATCH) {
  const batch = linkedUpdates.slice(i, i + BATCH);
  const stmts = batch.map(u => {
    const f = u.fields;
    const safeId = String(u.id).replace(/'/g, "''");
    const safeAvail = String(f.availability_confidence).replace(/'/g, "''");
    const safeTier = String(f.bet_confidence_tier).replace(/'/g, "''");
    const safeSnap = String(f.odds_snapshot_id).replace(/'/g, "''");
    return 'UPDATE shadow_bets SET '
      + 'odds_snapshot_id=\'' + safeSnap + '\', '
      + 'market_available=' + Number(f.market_available) + ', '
      + 'availability_confidence=\'' + safeAvail + '\', '
      + 'bet_confidence_score=' + Number(f.bet_confidence_score) + ', '
      + 'bet_confidence_tier=\'' + safeTier + '\' '
      + 'WHERE id=\'' + safeId + '\';';
  }).join('\n');
  try {
    await d1(stmts);
    applied += batch.length;
    process.stdout.write('\rapplied: ' + applied + '/' + linkedUpdates.length);
  } catch (e) {
    failed += batch.length;
    console.error('\n[r2b] batch failed at offset ' + i + ': ' + e.message);
    break;
  }
}
console.log('\n[r2b] applied=' + applied + ' failed=' + failed);
