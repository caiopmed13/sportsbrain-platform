// ══════════════════════════════════════════════════════════════════════════
// Analytics Engine — Camada A (core betting intelligence)
// ══════════════════════════════════════════════════════════════════════════
// Funções puras que operam sobre snapshots já armazenados no D1.
// Expostas pelas rotas /v1/odds/{value,arbitrage,middles,hold,steam,widest,no_vig,opening}
// ══════════════════════════════════════════════════════════════════════════

import { deOverround } from './consensus.js';

// Sharp books com pesos (quanto maior, mais confiança no preço justo)
// Pinnacle & Betfair Exchange = 3× (padrão-ouro mercado)
// Smarkets = 2× (exchange menor, liquidez ok)
// Prediction markets (Polymarket/Kalshi) = 2× (prob implícita direta, mas liquidez variável)
const SHARP_BOOKS = new Set(['pinnacle', 'betfair_ex', 'smarkets', 'polymarket', 'kalshi']);
const SHARP_WEIGHTS = {
  pinnacle:   3.0,
  betfair_ex: 3.0,
  smarkets:   2.0,
  polymarket: 2.0,
  kalshi:     2.0,
};
// Mínimo de books sharp cobrindo MESMO outcome antes de publicar fair price.
// Evita degenerado (fair_prob=1, edge=95%) quando só 1 book sharp existe.
const MIN_SHARP_BOOKS_FOR_FAIR = 2;

// ── Agrupadores utilitários ──────────────────────────────────────────────
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Weighted median helper — usado pra consenso de sharp books por outcome
function weightedMedian(items) {
  if (!items?.length) return null;
  const sorted = [...items].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, i) => s + i.weight, 0);
  let acc = 0;
  for (const it of sorted) {
    acc += it.weight;
    if (acc >= total / 2) return it.price;
  }
  return sorted[sorted.length - 1].price;
}

// No-vig (fair) price consolidado via weighted median entre TODOS sharp books
// disponíveis naquele outcome. Requer MIN_SHARP_BOOKS_FOR_FAIR sharp books
// cobrindo CADA outcome — senão retorna null (não publica edge degenerado).
// Retorna metadata sobre quantos sharp books participaram.
export function fairPriceFromPinnacle(snapshotsByOutcome) {
  const priceMap = {};
  const sharpCoverage = {};   // outcome → número de sharp books únicos
  const sharpBooksUsed = new Set();

  for (const [outcome, snaps] of Object.entries(snapshotsByOutcome)) {
    const sharps = snaps.filter(s => SHARP_BOOKS.has(s.book) && s.price > 1);
    // exige ≥2 sharp books no mesmo outcome
    const uniqSharp = new Map();
    for (const s of sharps) {
      if (!uniqSharp.has(s.book)) uniqSharp.set(s.book, s);
    }
    sharpCoverage[outcome] = uniqSharp.size;
    if (uniqSharp.size < MIN_SHARP_BOOKS_FOR_FAIR) return null;

    // Weighted median dos sharp prices (mais robusto que média)
    const items = [...uniqSharp.values()].map(s => ({
      price: s.price,
      weight: SHARP_WEIGHTS[s.book] || 1.0,
    }));
    const ref = weightedMedian(items);
    if (!ref || ref <= 1) return null;
    priceMap[outcome] = ref;
    for (const b of uniqSharp.keys()) sharpBooksUsed.add(b);
  }

  const dor = deOverround(priceMap);
  if (!dor) return null;

  const fairPrices = {};
  for (const [o, prob] of Object.entries(dor.fair)) {
    fairPrices[o] = prob > 0 && prob < 1 ? +(1 / prob).toFixed(3) : null;
  }
  // Sanity: se qualquer fair_prob >=0.99 ou <=0.01, rejeita (dado ruim)
  for (const p of Object.values(dor.fair)) {
    if (p >= 0.99 || p <= 0.01) return null;
  }
  return {
    fairPrices,
    fairProbs: dor.fair,
    overround: dor.overround,
    sharp_books: [...sharpBooksUsed],
    sharp_coverage: sharpCoverage,
  };
}

// ── 1. +EV Ranker ────────────────────────────────────────────────────────
// Retorna todas as apostas onde best soft price > fair (Pinnacle no-vig).
// Entry: snapshots de múltiplos eventos/books/mercados.
export function findValueBets(snapshots, minEdgePct = 1.5) {
  const byEventMarket = groupBy(snapshots,
    s => `${s.event_id}|${s.market}|${s.line ?? ''}`);
  const out = [];

  for (const [, snaps] of byEventMarket) {
    const byOutcome = groupBy(snaps, s => s.outcome);
    const snapshotsByOutcome = {};
    for (const [o, list] of byOutcome) snapshotsByOutcome[o] = list;

    const fair = fairPriceFromPinnacle(snapshotsByOutcome);
    if (!fair) continue;

    for (const [outcome, list] of byOutcome) {
      const fairPrice = fair.fairPrices[outcome];
      const fairProb = fair.fairProbs[outcome];
      if (!fairPrice || !fairProb) continue;

      // Best soft book (exclude sharp)
      const softs = list.filter(s => !SHARP_BOOKS.has(s.book));
      if (!softs.length) continue;
      const best = softs.reduce((a, b) => (b.price > a.price ? b : a));

      const edgePct = +((best.price / fairPrice - 1) * 100).toFixed(2);
      if (edgePct < minEdgePct) continue;

      const ev = +((fairProb * best.price - 1) * 100).toFixed(2);
      // Kelly fraction: (bp - q) / b; b = price-1, p = fairProb, q = 1-p
      const b = best.price - 1;
      const kelly = b > 0 ? Math.max(0, (b * fairProb - (1 - fairProb)) / b) : 0;

      out.push({
        event_id: best.event_id,
        market:   best.market,
        outcome:  best.outcome,
        line:     best.line,
        book:     best.book,
        price:    best.price,
        fair_price: fairPrice,
        fair_prob:  +fairProb.toFixed(4),
        edge_pct:   edgePct,
        ev_pct:     ev,
        kelly_frac: +kelly.toFixed(4),
        sharp_books: fair.sharp_books,
        n_sharp: fair.sharp_books.length,
      });
    }
  }

  return out.sort((a, b) => b.edge_pct - a.edge_pct);
}

// ── 2. Arbitrage Finder ──────────────────────────────────────────────────
// Arb = sum(1/best_price_per_outcome) < 1 usando books diferentes.
export function findArbitrage(snapshots) {
  const byEventMarket = groupBy(snapshots,
    s => `${s.event_id}|${s.market}|${s.line ?? ''}`);
  const arbs = [];

  for (const [key, snaps] of byEventMarket) {
    const byOutcome = groupBy(snaps, s => s.outcome);
    const outcomes = [...byOutcome.keys()];
    if (outcomes.length < 2) continue;

    // Best price (e book) por outcome
    const best = {};
    for (const [o, list] of byOutcome) {
      const top = list.reduce((a, b) => (b.price > a.price ? b : a));
      best[o] = top;
    }

    const sumInvProb = outcomes.reduce((s, o) => s + 1 / best[o].price, 0);
    if (sumInvProb >= 1) continue;

    const profitPct = +((1 / sumInvProb - 1) * 100).toFixed(2);
    if (profitPct < 0.3) continue; // min 0.3% pra valer a pena

    // Stakes pra 100 unidades totais, lucro uniforme
    const totalStake = 100;
    const stakes = {};
    for (const o of outcomes) {
      stakes[o] = +(totalStake / (best[o].price * sumInvProb)).toFixed(2);
    }

    arbs.push({
      event_id:   best[outcomes[0]].event_id,
      market:     best[outcomes[0]].market,
      line:       best[outcomes[0]].line,
      profit_pct: profitPct,
      legs: outcomes.map(o => ({
        outcome: o, book: best[o].book,
        price: best[o].price, stake: stakes[o],
      })),
    });
  }

  return arbs.sort((a, b) => b.profit_pct - a.profit_pct);
}

// ── 3. Middles Finder ────────────────────────────────────────────────────
// Middle = Book A tem spread/total em linha X, Book B em linha Y, X<Y.
// Se resultado cair no meio → ganha ambas.
export function findMiddles(snapshots) {
  const byEventMarket = groupBy(
    snapshots.filter(s => s.market === 'totals' || s.market === 'spreads'),
    s => `${s.event_id}|${s.market}`
  );
  const middles = [];

  for (const [key, snaps] of byEventMarket) {
    // Over + Under cross-line
    const overs  = snaps.filter(s => s.outcome === 'over'  || s.outcome === 'home');
    const unders = snaps.filter(s => s.outcome === 'under' || s.outcome === 'away');

    for (const o of overs) {
      for (const u of unders) {
        if (o.line == null || u.line == null) continue;
        if (o.book === u.book) continue;
        if (snaps[0].market === 'totals' && o.line < u.line) {
          const gap = +(u.line - o.line).toFixed(1);
          middles.push({
            event_id: o.event_id, market: 'totals',
            over:  { book: o.book, line: o.line, price: o.price },
            under: { book: u.book, line: u.line, price: u.price },
            gap,
            estimated_ev: +((o.price + u.price) / 2 - 2).toFixed(3),
          });
        }
        if (snaps[0].market === 'spreads' && o.line > u.line) {
          const gap = +(o.line - u.line).toFixed(1);
          middles.push({
            event_id: o.event_id, market: 'spreads',
            home: { book: o.book, line: o.line, price: o.price },
            away: { book: u.book, line: u.line, price: u.price },
            gap,
          });
        }
      }
    }
  }

  return middles.sort((a, b) => (b.gap || 0) - (a.gap || 0));
}

// ── 4. Hold % Calculator (vig por mercado/book) ──────────────────────────
export function calcHold(snapshots) {
  const byBookMarket = groupBy(snapshots,
    s => `${s.book}|${s.event_id}|${s.market}|${s.line ?? ''}`);
  const holds = [];

  for (const [key, snaps] of byBookMarket) {
    if (snaps.length < 2) continue;
    const sumInvProb = snaps.reduce((s, x) => s + 1 / x.price, 0);
    const hold = +((sumInvProb - 1) * 100).toFixed(2);
    if (!isFinite(hold)) continue;
    const [book, event_id, market, lineStr] = key.split('|');
    holds.push({
      book, event_id, market,
      line: lineStr === '' ? null : parseFloat(lineStr),
      hold_pct: hold,
      n_outcomes: snaps.length,
    });
  }

  return holds;
}

// Agregado: hold médio por book
export function holdByBook(holds) {
  const byBook = groupBy(holds, h => h.book);
  const out = [];
  for (const [book, list] of byBook) {
    const avg = list.reduce((s, x) => s + x.hold_pct, 0) / list.length;
    out.push({ book, avg_hold_pct: +avg.toFixed(2), n: list.length });
  }
  return out.sort((a, b) => a.avg_hold_pct - b.avg_hold_pct);
}

// ── 5. Steam Detector ────────────────────────────────────────────────────
// Steam = 3+ books sharp moving same direction within 10min.
// Entry: movimento tick-série [{book, price, ts}] por outcome.
export function detectSteam(timeSeries, windowMs = 10 * 60 * 1000, minBooks = 2) {
  if (!timeSeries?.length) return null;
  const now = Math.max(...timeSeries.map(s => s.ts));
  const recent = timeSeries.filter(s => now - s.ts <= windowMs);

  // Por book: primeiro vs último no window
  const byBook = groupBy(recent, s => s.book);
  const moves = [];
  for (const [book, series] of byBook) {
    if (series.length < 2) continue;
    const sorted = series.sort((a, b) => a.ts - b.ts);
    const first = sorted[0].price, last = sorted[sorted.length - 1].price;
    const pct = (last - first) / first;
    if (Math.abs(pct) < 0.02) continue;
    moves.push({ book, direction: pct > 0 ? 'up' : 'down', magnitude: +Math.abs(pct).toFixed(3) });
  }

  const ups = moves.filter(m => m.direction === 'up').length;
  const downs = moves.filter(m => m.direction === 'down').length;
  const dominant = ups > downs ? 'up' : (downs > ups ? 'down' : null);
  const steam = dominant && Math.max(ups, downs) >= minBooks;

  return {
    steam, direction: dominant,
    books_moving: moves.length,
    moves,
    window_min: windowMs / 60000,
    alert: steam
      ? `🔥 STEAM ${dominant.toUpperCase()}: ${Math.max(ups, downs)} books moveram ${dominant} em ${windowMs / 60000}min`
      : null,
  };
}

// ── 6. Widest Line (best price cross-book, formatado) ─────────────────────
export function widestLine(snapshots) {
  const byOutcome = groupBy(snapshots,
    s => `${s.event_id}|${s.market}|${s.outcome}|${s.line ?? ''}`);
  const out = [];
  for (const [key, list] of byOutcome) {
    const [event_id, market, outcome, lineStr] = key.split('|');
    const worst = list.reduce((a, b) => (b.price < a.price ? b : a));
    const best  = list.reduce((a, b) => (b.price > a.price ? b : a));
    const spread = +(best.price - worst.price).toFixed(3);
    if (spread < 0.1) continue;
    out.push({
      event_id, market, outcome,
      line: lineStr === '' ? null : parseFloat(lineStr),
      best: { book: best.book, price: best.price },
      worst: { book: worst.book, price: worst.price },
      spread,
      spread_pct: +((spread / worst.price) * 100).toFixed(2),
    });
  }
  return out.sort((a, b) => b.spread_pct - a.spread_pct);
}

// ── 7. No-vig fair line batch (pra rota /no_vig) ─────────────────────────
export function noVigBatch(snapshots) {
  const byEventMarket = groupBy(snapshots,
    s => `${s.event_id}|${s.market}|${s.line ?? ''}`);
  const out = [];
  for (const [key, snaps] of byEventMarket) {
    const byOutcome = groupBy(snaps, s => s.outcome);
    const obj = {};
    for (const [o, list] of byOutcome) obj[o] = list;
    const fair = fairPriceFromPinnacle(obj);
    if (!fair) continue;
    const [event_id, market, lineStr] = key.split('|');
    out.push({
      event_id, market,
      line: lineStr === '' ? null : parseFloat(lineStr),
      fair_prices: fair.fairPrices,
      fair_probs:  fair.fairProbs,
      overround:   +fair.overround.toFixed(4),
      sharp_books: fair.sharp_books,
    });
  }
  return out;
}

// ── 8. RLM (Reverse Line Movement) — detecta sharp money contra público ─
// Sem public_pct externo, usamos heurística: linha fechada move CONTRA
// favorito de mercado (outcome com menor preço abre) = RLM forte.
export function detectRLM(snapshotsSeries) {
  // snapshotsSeries = {h2h:{home:[{ts,price,book},...], away:[...], draw:[...]}}
  // Para cada outcome, pega first vs last.
  const out = {};
  for (const [outcome, series] of Object.entries(snapshotsSeries)) {
    if (!series?.length) continue;
    const sorted = [...series].sort((a, b) => a.ts - b.ts);
    out[outcome] = {
      open:   sorted[0].price,
      close:  sorted[sorted.length - 1].price,
      delta:  +(sorted[sorted.length - 1].price - sorted[0].price).toFixed(3),
    };
  }

  // Detect RLM: favorito (menor abertura) teve price AUMENTADO (indo contra público favorecendo-o)
  const outcomes = Object.entries(out).sort((a, b) => a[1].open - b[1].open);
  if (!outcomes.length) return null;
  const fav = outcomes[0];
  const favMovedAway = fav[1].delta > 0.05;  // fav's price lengthened

  return {
    favorite:      { outcome: fav[0], open: fav[1].open, close: fav[1].close, delta: fav[1].delta },
    all:           out,
    rlm_detected:  favMovedAway,
    alert:         favMovedAway
      ? `🎯 RLM: favorito (${fav[0]}) abriu ${fav[1].open} → fechou ${fav[1].close} (+${fav[1].delta}). Sharp money no underdog.`
      : null,
  };
}

// ── 9. Line movement basic (mantido) ─────────────────────────────────────
export function analyzeLineMovement(timeSeries) {
  if (!timeSeries?.length || timeSeries.length < 2) return null;
  const sorted = timeSeries.sort((a, b) => a.ts - b.ts);
  const first = sorted[0].price, last = sorted[sorted.length - 1].price;
  const pct = (last - first) / first;
  return {
    open: first,
    current: last,
    pct_change: +(pct * 100).toFixed(2),
    direction: pct > 0 ? 'lengthening' : 'shortening',
    n_ticks: sorted.length,
    rlm_candidate: Math.abs(pct) > 0.08,  // >8% move = sharp activity likely
  };
}
