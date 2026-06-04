// ════════════════════════════════════════════════════════════════════
// oddsSnapshotLinker.js — Liga shadow_bets a odds_snapshots
// ════════════════════════════════════════════════════════════════════
// P3.9 Recovery 1.
//
// Causa-raiz da degeneração de bet_confidence_tier (todas em no_bet):
// shadow_bets têm odds_snapshot_id NULL em 100%, então o componente
// odds_snapshot_component fica zerado e o score nunca passa de ~39.
//
// Este serviço é PURO (sem DB, sem rede). Recebe um shadow_bet e um
// array de snapshots candidatos; devolve a melhor escolha + os
// campos a popular + score/tier recalculados via betConfidence.js.
//
// Escopo MÍNIMO:
//   1X2  → h2h
//   BTTS → btts
//   CORRECT_SCORE, TOTAL_GOALS_RANGE, CORNERS_OU, props, cards,
//   handicaps complexos, ranges → unsupported_market (honesto).
//
// Sem fuzzy team-match: caller fornece event_id ou usamos eventId()
// determinístico de normalize.js (mesma chave que odds_events usa).
// ════════════════════════════════════════════════════════════════════

import { calcBetConfidenceScore } from './betConfidence.js';
import { eventId, normTeam } from '../odds/normalize.js';

// ── 1. Mapper de market ────────────────────────────────────────────
export function normalizeShadowMarket(market) {
  if (!market) return 'unsupported_market';
  const m = String(market).trim().toUpperCase();
  if (m === '1X2' || m === 'H2H' || m === 'MATCH_RESULT' || m === 'RESULT'
      || m === 'DRAW_NO_BET' || m === 'DNB')
    return 'h2h';  // DRAW_NO_BET = h2h sem draw (rejeitado em normalizeShadowOutcome)
  if (m === 'BTTS' || m === 'BOTH_TEAMS_TO_SCORE')
    return 'btts';
  return 'unsupported_market';
}

// ── 2. Mapper de outcome (conservador, sem fuzzy) ──────────────────
export function normalizeShadowOutcome(selection, market, homeTeam, awayTeam) {
  if (!selection) return { outcome: null, status: 'unmapped_outcome' };
  const sel = String(selection).trim().toLowerCase();
  const nm = normalizeShadowMarket(market);

  if (nm === 'h2h') {
    // DRAW_NO_BET: por definição não aceita empate (push, void) — não é
    // selection apostável; se vier 'empate', tratar como unmapped.
    const origMarket = String(market || '').trim().toUpperCase();
    const isDNB = origMarket === 'DRAW_NO_BET' || origMarket === 'DNB';
    // empate / draw (PT/EN)
    if (sel === 'empate' || sel === 'draw' || sel === 'x'
        || sel === 'tie' || sel.includes('empate')) {
      if (isDNB) return { outcome: null, status: 'unmapped_outcome' };
      return { outcome: 'draw', status: 'mapped' };
    }
    // home/away por normTeam (estrito — nada de fuzzy)
    if (homeTeam) {
      const h = normTeam(homeTeam);
      const sNorm = normTeam(sel);
      if (h && sNorm && sNorm.includes(h))
        return { outcome: 'home', status: 'mapped' };
    }
    if (awayTeam) {
      const a = normTeam(awayTeam);
      const sNorm = normTeam(sel);
      if (a && sNorm && sNorm.includes(a))
        return { outcome: 'away', status: 'mapped' };
    }
    return { outcome: null, status: 'unmapped_outcome' };
  }

  if (nm === 'btts') {
    // ordem importa: "não"/"no" antes de "sim"/"yes" pra evitar falsos
    if (sel === 'no' || sel === 'nao' || sel === 'não'
        || sel === 'btts_no' || sel.includes('btts_no')
        || /\b(nao|n[aã]o|no)\b/.test(sel))
      return { outcome: 'no', status: 'mapped' };
    if (sel === 'sim' || sel === 'yes'
        || sel === 'btts_yes' || sel.includes('btts_yes')
        || /\b(sim|yes)\b/.test(sel))
      return { outcome: 'yes', status: 'mapped' };
    return { outcome: null, status: 'unmapped_outcome' };
  }

  return { outcome: null, status: 'unmapped_outcome' };
}

// ── 3. Parser de kickoff (YYYYMMDDHHMMSS, ISO, ou unix ms) ─────────
export function parseShadowKickoff(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1000; // segundos→ms se aplicável
  }
  const s = String(value).trim();
  if (!s) return null;
  // YYYYMMDDHHMMSS (14 dígitos, UTC)
  const m14 = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (m14) {
    const t = Date.UTC(+m14[1], +m14[2] - 1, +m14[3],
                       +m14[4], +m14[5], +m14[6]);
    return Number.isFinite(t) ? t : null;
  }
  // dígitos puros (epoch s ou ms)
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 1e11 ? n : n * 1000;
  }
  // ISO
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// ── 4. event_id determinístico (mesma chave de odds_events) ───────
function _eventIdOf(shadowBet, kickoffMs) {
  if (shadowBet && typeof shadowBet.event_id === 'string'
      && shadowBet.event_id) return shadowBet.event_id;
  if (!shadowBet || !shadowBet.home_team || !shadowBet.away_team
      || kickoffMs == null) return null;
  return eventId(shadowBet.home_team, shadowBet.away_team, kickoffMs);
}

// ── 5. Query bundle ─────────────────────────────────────────────────
export function buildShadowBetOddsSnapshotQuery(shadowBet) {
  const market = normalizeShadowMarket(shadowBet && shadowBet.market);
  if (market === 'unsupported_market')
    return { status: 'unsupported_market', market };
  const out = normalizeShadowOutcome(
    shadowBet.selection, shadowBet.market,
    shadowBet.home_team, shadowBet.away_team);
  if (out.status !== 'mapped')
    return { status: 'unmapped_outcome', market };
  const kickoff = parseShadowKickoff(shadowBet.kickoff);
  if (kickoff == null)
    return { status: 'missing_kickoff', market, outcome: out.outcome };
  const evId = _eventIdOf(shadowBet, kickoff);
  if (!evId)
    return { status: 'missing_event_id',
             market, outcome: out.outcome, kickoff };
  return {
    status: 'ready',
    market, outcome: out.outcome, kickoff, event_id: evId,
  };
}

// ── 6. Seleção do snapshot ─────────────────────────────────────────
// Regras: mesmo event_id + market + outcome; ts <= kickoff;
// preferir Pinnacle (sharp), depois ts mais recente. SEM fuzzy.
export function selectBestOddsSnapshot(shadowBet, snapshots) {
  const q = buildShadowBetOddsSnapshotQuery(shadowBet);
  if (q.status !== 'ready')
    return { status: q.status, snapshot: null, count: 0 };
  const list = Array.isArray(snapshots) ? snapshots : [];
  const cand = list.filter(s =>
    s && s.event_id === q.event_id
      && s.market === q.market
      && s.outcome === q.outcome
      && typeof s.ts === 'number'
      && Number.isFinite(s.ts)
      && s.ts <= q.kickoff);
  if (!cand.length)
    return { status: 'missing_snapshot', snapshot: null, count: 0 };
  // Pinnacle preferido (sharp); empate = ts mais recente.
  cand.sort((a, b) => {
    const ap = a.book === 'pinnacle' ? 0 : 1;
    const bp = b.book === 'pinnacle' ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (b.ts || 0) - (a.ts || 0);
  });
  return { status: 'linked', snapshot: cand[0], count: cand.length };
}

// ── 7. Linker — devolve campos a popular + score/tier recalculados ─
export function linkShadowBetToOddsSnapshot(shadowBet, snapshots) {
  const before = calcBetConfidenceScore(shadowBet);
  const sel = selectBestOddsSnapshot(shadowBet, snapshots);
  if (sel.status !== 'linked') {
    return {
      status: sel.status,
      fields: {},
      before_score: before.score,
      before_tier: before.tier,
      after_score: before.score,
      after_tier: before.tier,
      delta: 0,
    };
  }
  const hydrated = Object.assign({}, shadowBet, {
    odds_snapshot_id: sel.snapshot.id,
    odds_snapshot_count: sel.count,
    market_available: true,
    availability_confidence: 'high',
  });
  const after = calcBetConfidenceScore(hydrated);
  return {
    status: 'linked',
    fields: {
      odds_snapshot_id: sel.snapshot.id,
      odds_snapshot_count: sel.count,
      market_available: 1,
      availability_confidence: 'high',
      bet_confidence_score: after.score,
      bet_confidence_tier: after.tier,
    },
    before_score: before.score,
    before_tier: before.tier,
    after_score: after.score,
    after_tier: after.tier,
    delta: +(after.score - before.score).toFixed(2),
  };
}

// ── 8. Sumarizador para dry-run ────────────────────────────────────
export function buildOddsSnapshotLinkingSummary(results) {
  const b = {
    rows_scanned: 0,
    linked_count: 0,
    unsupported_market_count: 0,
    missing_event_id_count: 0,
    missing_kickoff_count: 0,
    unmapped_outcome_count: 0,
    missing_snapshot_count: 0,
    tier_before: {},
    tier_after_simulated: {},
    score_delta_avg: 0,
    examples: [],
  };
  const list = Array.isArray(results) ? results : [];
  let deltaSum = 0;
  for (const r of list) {
    if (!r) continue;
    b.rows_scanned++;
    const tB = r.before_tier || 'no_bet';
    const tA = r.after_tier || tB;
    b.tier_before[tB] = (b.tier_before[tB] || 0) + 1;
    b.tier_after_simulated[tA] = (b.tier_after_simulated[tA] || 0) + 1;
    if (r.status === 'linked') {
      b.linked_count++;
      deltaSum += (r.delta || 0);
    } else if (r.status === 'unsupported_market') b.unsupported_market_count++;
    else if (r.status === 'missing_event_id') b.missing_event_id_count++;
    else if (r.status === 'missing_kickoff') b.missing_kickoff_count++;
    else if (r.status === 'unmapped_outcome') b.unmapped_outcome_count++;
    else if (r.status === 'missing_snapshot') b.missing_snapshot_count++;
    if (b.examples.length < 5 && r.status === 'linked' && (r.delta || 0) > 0) {
      b.examples.push({
        status: r.status, delta: r.delta,
        before_tier: r.before_tier, after_tier: r.after_tier,
      });
    }
  }
  b.score_delta_avg = b.linked_count
    ? +(deltaSum / b.linked_count).toFixed(2) : 0;
  return b;
}
