// ════════════════════════════════════════════════════════════════════
// Picks Engine — gera palpites do dia com ensemble + Kelly + explain
// ════════════════════════════════════════════════════════════════════
// Pipeline por evento:
//   1. Busca value bets via findValueBets (fair_price no-vig com ≥2 sharp books)
//   2. Para cada value bet:
//      a. Computa model_prob (Poisson pra soccer, Elo pra basketball/outros)
//      b. Ensemble = blend (fair_prob, model_prob, historical_clv_signal)
//      c. Confidence tier: high | medium | low
//      d. Kelly fracionado por confidence: 0.5× / 0.25× / 0.1×
//      e. Explain string humana com os sinais que convergem
//   3. Grava em picks_closed + push Telegram das top-N
// ════════════════════════════════════════════════════════════════════

import { findValueBets, noVigBatch } from '../odds/analytics.js';
import { getRatings, probabilitiesFromElo } from './elo.js';
import { predictSoccerMatch } from './poisson.js';
import { recordPick } from './clv.js';
import { sendAlert } from './alerts.js';

const MIN_EDGE_PCT         = 2.5;  // floor pra entrar no funil
const CONFIDENCE_THRESHOLD = { high: 3, medium: 2 };  // n sinais positivos
const KELLY_MULTIPLIER     = { high: 0.5, medium: 0.25, low: 0.1 };

// ── Pipeline principal ──────────────────────────────────────────────
// Retorna array de picks (opcionalmente já persistidos + pushados no Telegram)
export async function generatePicks(env, {
  minEdge = MIN_EDGE_PCT,
  maxPicks = 10,
  persist = true,
  pushTelegram = true,
  hoursAhead = 24,
} = {}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };

  const { listUpcomingEvents, getLatestOdds } = await import('../odds/storage.js');
  const events = await listUpcomingEvents(env, { hours: hoursAhead });
  if (!events?.length) return { ok: true, picks: [], note: 'no_upcoming_events' };

  // Carrega snapshots recentes de cada evento
  const allSnaps = [];
  for (const ev of events.slice(0, 80)) {
    const odds = await getLatestOdds(env, { event_id: ev.id, maxAge: 60 * 60 * 1000 });
    for (const o of odds) {
      allSnaps.push({ ...o, event_id: ev.id, sport: ev.sport, league: ev.league });
    }
  }

  // Value bets candidatas
  const values = findValueBets(allSnaps, minEdge);
  if (!values.length) return { ok: true, picks: [], note: 'no_value_candidates' };

  // Enrichment com stats por evento
  const evMap = new Map(events.map(e => [e.id, e]));
  const picks = [];

  for (const v of values) {
    const ev = evMap.get(v.event_id);
    if (!ev) continue;

    const pick = await enrichPick(env, v, ev);
    if (pick) picks.push(pick);
    if (picks.length >= maxPicks * 3) break;  // pool pra rankear
  }

  // Ranking: prioriza confidence alta, depois edge
  picks.sort((a, b) => {
    const confScore = c => c === 'high' ? 3 : c === 'medium' ? 2 : 1;
    const diff = confScore(b.confidence) - confScore(a.confidence);
    return diff !== 0 ? diff : (b.edge_pct - a.edge_pct);
  });

  const top = picks.slice(0, maxPicks);

  // Persistir + push
  let saved = 0, pushed = 0;
  for (const p of top) {
    if (persist) {
      const res = await recordPick(env, p);
      if (res.ok) saved++;
    }
    if (pushTelegram && (p.confidence === 'high' || p.confidence === 'medium')) {
      await sendAlert(env, {
        kind: 'daily_pick',
        severity: p.confidence === 'high' ? 'critical' : 'warning',
        title: `${p.confidence.toUpperCase()} · ${p.outcome} @ ${p.book} (${p.edge_pct.toFixed(1)}%)`,
        detail: p.explain,
        meta: {
          event_id: p.event_id, market: p.market, outcome: p.outcome,
          edge_pct: p.edge_pct, book: p.book, price: p.price_at_pick,
        },
      });
      pushed++;
    }
  }

  return { ok: true, picks: top, saved, pushed };
}

// ── Enrichment: computa model_prob + ensemble + confidence + Kelly ──
async function enrichPick(env, v, ev) {
  // Fair prob = 1 / fair_price
  const fairProb = v.fair_price ? 1 / v.fair_price : null;
  if (!fairProb) return null;

  // Model prob
  let modelProb = null;
  let modelSource = null;
  if (ev.sport === 'soccer') {
    const poisson = await predictSoccerMatch(env, {
      home: ev.home, away: ev.away, league: ev.league,
    });
    modelProb = extractMarketProb(poisson, v.market, v.outcome, v.line);
    if (poisson) modelSource = 'poisson';
  } else if (ev.sport === 'basketball' || ev.sport === 'nfl' || ev.sport === 'nhl') {
    const ratings = await getRatings(env, [ev.home, ev.away], ev.sport);
    const elo     = probabilitiesFromElo(ratings[ev.home], ratings[ev.away], ev.sport);
    modelProb = v.outcome === 'home' || v.outcome === 'Home' ? elo.home
              : v.outcome === 'away' || v.outcome === 'Away' ? elo.away
              : v.outcome === 'draw' || v.outcome === 'Draw' ? elo.draw
              : null;
    if (modelProb != null) modelSource = 'elo';
  }

  // Ensemble: 60% fair (mercado sharp), 40% modelo próprio, fallback 100% fair se sem modelo
  const ensembleProb = modelProb != null
    ? 0.6 * fairProb + 0.4 * modelProb
    : fairProb;

  // Sinais que convergem → confidence
  const signals = computeSignals({
    fairProb, modelProb, edgePct: v.edge_pct, nSharp: v.n_sharp || (v.sharp_books?.length ?? 0),
  });
  const nPositive = Object.values(signals).filter(Boolean).length;
  const confidence = nPositive >= CONFIDENCE_THRESHOLD.high ? 'high'
                   : nPositive >= CONFIDENCE_THRESHOLD.medium ? 'medium'
                   : 'low';

  // Kelly fracionado: f* = (b*p - q) / b  com b = price - 1, p = ensembleProb, q = 1-p
  // Fração aplicada: high/med/low
  const b = v.price - 1;
  const pKelly = ensembleProb;
  const fStar = (b * pKelly - (1 - pKelly)) / b;
  const kellyFrac = Math.max(0, fStar * KELLY_MULTIPLIER[confidence]);

  // Explain humano
  const explainParts = [];
  explainParts.push(`Fair ${v.fair_price?.toFixed(2)} vs oferta ${v.price?.toFixed(2)} (edge ${v.edge_pct.toFixed(2)}%)`);
  if (modelProb != null) explainParts.push(`${modelSource}: ${(modelProb * 100).toFixed(1)}% vs implied ${((1 / v.price) * 100).toFixed(1)}%`);
  explainParts.push(`${v.n_sharp || (v.sharp_books?.length ?? 0)} sharp books coincidem`);
  const explain = explainParts.join(' · ');

  return {
    event_id: v.event_id,
    sport: ev.sport,
    league: ev.league,
    market: v.market,
    outcome: v.outcome,
    line: v.line ?? null,
    book: v.book,
    price_at_pick: v.price,
    fair_price: v.fair_price,
    edge_pct: v.edge_pct,
    n_sharp: v.n_sharp || (v.sharp_books?.length ?? 0),
    sharp_books: v.sharp_books || [],
    model_prob: modelProb,
    ensemble_prob: ensembleProb,
    confidence,
    kelly_frac: +kellyFrac.toFixed(4),
    signals,
    explain,
    commence_time: ev.commence_time,
    source: 'daily_pick',
  };
}

function computeSignals({ fairProb, modelProb, edgePct, nSharp }) {
  return {
    sharp_coverage:  (nSharp ?? 0) >= 2,
    strong_edge:     edgePct >= 3,
    model_confirms:  modelProb != null && modelProb > fairProb,
    model_strong:    modelProb != null && (modelProb - fairProb) > 0.02,
  };
}

// Extrai prob do modelo Poisson dado market+outcome+line
function extractMarketProb(poisson, market, outcome, line) {
  if (!poisson) return null;
  if (market === 'h2h') {
    if (outcome === 'home' || outcome === 'Home') return poisson.h2h.home;
    if (outcome === 'away' || outcome === 'Away') return poisson.h2h.away;
    if (outcome === 'draw' || outcome === 'Draw') return poisson.h2h.draw;
  }
  if (market === 'btts') {
    if (outcome === 'yes' || outcome === 'Yes') return poisson.btts.yes;
    if (outcome === 'no'  || outcome === 'No')  return poisson.btts.no;
  }
  if (market === 'totals' && line != null) {
    const key = String(line);
    if (poisson.totals[key]) {
      if (outcome === 'over'  || outcome === 'Over')  return poisson.totals[key].over;
      if (outcome === 'under' || outcome === 'Under') return poisson.totals[key].under;
    }
  }
  return null;
}
