#!/usr/bin/env node
// scripts/dryrun-odds-snapshot-linker.mjs — P3.9 R2B Dry-Run
//
// Mede o linker (oddsSnapshotLinker) contra o D1 ATUAL, read-only.
// Não escreve nada. Sem UPDATE/INSERT/DELETE. Sem --apply (não existe).
//
// USO:
//   node scripts/dryrun-odds-snapshot-linker.mjs
//   node scripts/dryrun-odds-snapshot-linker.mjs --limit 500
//   node scripts/dryrun-odds-snapshot-linker.mjs --window-ms 1800000000000  # janela ts customizada
//
// Saída: SUMMARY JSON + breakdown por market + deltas + 5 exemplos linked.

import {
  linkShadowBetToOddsSnapshot,
  buildOddsSnapshotLinkingSummary,
  normalizeShadowMarket,
  parseShadowKickoff,
} from '../src/services/oddsSnapshotLinker.js';
import { eventId } from '../src/odds/normalize.js';

const CF_ACCOUNT_ID = '8aca021a28790477e7d1478f17530a64';
const CF_DB_ID      = '984fa15a-3e26-4766-8df4-bd09d239002d';
const CF_TOKEN      = process.env.CLOUDFLARE_API_TOKEN;
if (!CF_TOKEN) { console.error('CLOUDFLARE_API_TOKEN missing'); process.exit(2); }

const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Math.max(1, parseInt(args[li + 1], 10) || 0) : null;

async function d1(sql) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/'
    + CF_ACCOUNT_ID + '/d1/database/' + CF_DB_ID + '/query';
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
console.log('[dryrun] fetching shadow_bets (training_eligible=1) ' + (LIMIT ? `[limit=${LIMIT}]` : '[all]'));
const sbData = await d1(`SELECT ${SB_COLS} FROM shadow_bets WHERE training_eligible=1 ${limClause}`);
const sb = sbData[0].results;
console.log('shadow_bets rows:', sb.length);

// odds_snapshots em janela ampla pra cobrir kickoffs
console.log('[dryrun] fetching odds_snapshots (h2h/btts, last 30d)...');
const odSql = `SELECT id,event_id,book,market,outcome,line,price,ts FROM odds_snapshots WHERE market IN ('h2h','btts') AND ts >= (CAST(strftime('%s','now') AS INTEGER) - 2592000) * 1000`;
const odData = await d1(odSql);
const od = odData[0].results;
console.log('odds_snapshots rows:', od.length);

// Index por event_id
const byEvent = new Map();
for (const s of od) {
  const arr = byEvent.get(s.event_id) || [];
  arr.push(s);
  byEvent.set(s.event_id, arr);
}
console.log('distinct event_ids em snapshots:', byEvent.size);

const results = [];
let computedEventIds = 0;
let foundInIndex = 0;
for (const bet of sb) {
  const m = normalizeShadowMarket(bet.market);
  if (m === 'unsupported_market') {
    results.push(linkShadowBetToOddsSnapshot(bet, []));
    continue;
  }
  const ko = parseShadowKickoff(bet.kickoff);
  let cand = [];
  if (bet.home_team && bet.away_team && ko != null) {
    const eid = eventId(bet.home_team, bet.away_team, ko);
    computedEventIds++;
    const sub = byEvent.get(eid);
    if (sub) { foundInIndex++; cand = sub; }
  }
  results.push(linkShadowBetToOddsSnapshot(bet, cand));
}

console.log('computed event_ids (supported markets):', computedEventIds);
console.log('event_ids casadas no índice:', foundInIndex);

const summary = buildOddsSnapshotLinkingSummary(results);
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));

// Breakdown por market
const byMarket = {};
for (let i = 0; i < sb.length; i++) {
  const mkt = sb[i].market || '(null)';
  const st = results[i].status;
  byMarket[mkt] = byMarket[mkt] || { total: 0 };
  byMarket[mkt][st] = (byMarket[mkt][st] || 0) + 1;
  byMarket[mkt].total++;
}
console.log('\n=== BY MARKET (top 12) ===');
const marketList = Object.entries(byMarket).sort((a, b) => b[1].total - a[1].total).slice(0, 12);
for (const [k, v] of marketList) console.log(k, v);

// Deltas
const deltas = results.filter(r => r.status === 'linked').map(r => r.delta).sort((a, b) => a - b);
if (deltas.length) {
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const med = deltas[Math.floor(deltas.length / 2)];
  console.log('\n=== DELTAS (linked) ===');
  console.log('n_linked:', deltas.length, 'avg:', +avg.toFixed(2), 'median:', med, 'min:', deltas[0], 'max:', deltas[deltas.length - 1]);
}

// Exemplos linked
console.log('\n=== 5 EXAMPLES (linked) ===');
let shown = 0;
for (let i = 0; i < results.length && shown < 5; i++) {
  if (results[i].status === 'linked') {
    const bet = sb[i];
    console.log({
      market: bet.market, selection: bet.selection,
      home: bet.home_team, away: bet.away_team,
      kickoff: bet.kickoff,
      before_score: results[i].before_score,
      after_score: results[i].after_score,
      delta: results[i].delta,
      before_tier: results[i].before_tier,
      after_tier: results[i].after_tier,
    });
    shown++;
  }
}
