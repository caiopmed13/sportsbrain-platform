// ══════════════════════════════════════════════════════════════════════════
// Consensus engine — agrega snapshots de múltiplos books em preço justo
// ══════════════════════════════════════════════════════════════════════════
// Entrada: array de snapshots [{book, market, outcome, line, price, ts}]
// Saída:   agregação por (market, outcome, line) com best/median/sharp/fair_prob
// ══════════════════════════════════════════════════════════════════════════

// Pesos dos books — sharp books 3× pra dominar o weighted median do consenso.
// Recreativos 1× (ou menos pra casas notoriamente generosas/"trap").
const BOOK_WEIGHTS = {
  // Sharp anchor — padrão-ouro
  pinnacle:   3.0,
  betfair_ex: 3.0,
  // Exchange menor + prediction markets regulados
  smarkets:   2.0,
  polymarket: 2.0,
  kalshi:     2.0,
  // Kambi network (vários skins)
  kambi:      1.3,
  // Recreativos principais
  bet365:     1.2,
  draftkings: 1.2,
  fanduel:    1.2,
  caesars:    1.1,
  betmgm:     1.1,
  betano:     1.0,
  superbet:   1.0,
  kto:        1.0,
  bovada:     1.0,
  '1xbet':    0.9,
  stake:      0.9,
  betsson:    0.8,
  betway:     0.8,
};

const SHARP_BOOKS = new Set(['betfair_ex', 'pinnacle', 'smarkets', 'polymarket', 'kalshi']);

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function weightedMedian(items) {
  // items = [{price, weight}]
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, i) => s + i.weight, 0);
  let acc = 0;
  for (const it of sorted) {
    acc += it.weight;
    if (acc >= total / 2) return it.price;
  }
  return sorted[sorted.length - 1].price;
}

// Remove overround de um set de preços no mesmo mercado/evento
// (h2h: 3 outcomes. BTTS/totals: 2 outcomes)
// Retorna probabilidades normalizadas tal que somam 1.
export function deOverround(pricesByOutcome) {
  const outcomes = Object.keys(pricesByOutcome);
  const impliedProbs = {};
  let sum = 0;
  for (const o of outcomes) {
    const p = pricesByOutcome[o];
    if (!p || p <= 1) return null;
    impliedProbs[o] = 1 / p;
    sum += 1 / p;
  }
  if (!sum) return null;
  // Normaliza (overround removal via proportional method — "Basic" normalization)
  const fair = {};
  for (const o of outcomes) fair[o] = impliedProbs[o] / sum;
  return { fair, overround: sum - 1 };
}

// Agrega snapshots em consenso
// Retorna [{ market, outcome, line, best_price, best_book, median_price, sharp_price, fair_prob, n_books }]
export function aggregateConsensus(snapshots) {
  if (!snapshots?.length) return [];

  // Agrupa por (market, outcome, line)
  const groups = new Map();
  for (const s of snapshots) {
    const key = `${s.market}|${s.outcome}|${s.line ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const out = [];
  for (const [key, items] of groups) {
    const [market, outcome, lineStr] = key.split('|');
    const line = lineStr === '' ? null : parseFloat(lineStr);

    // Best odd (maior preço = melhor pra apostador)
    let best = items[0];
    for (const it of items) if (it.price > best.price) best = it;

    // Median ponderada
    const weighted = items.map(it => ({ price: it.price, weight: BOOK_WEIGHTS[it.book] || 0.7 }));
    const medPrice = weightedMedian(weighted);

    // Sharp: preço do Pinnacle ou Betfair
    const sharpItems = items.filter(it => SHARP_BOOKS.has(it.book));
    const sharpPrice = sharpItems.length ? median(sharpItems.map(it => it.price)) : null;

    out.push({
      market, outcome, line,
      best_price:  +best.price.toFixed(2),
      best_book:   best.book,
      median_price: medPrice ? +medPrice.toFixed(2) : null,
      sharp_price:  sharpPrice ? +sharpPrice.toFixed(2) : null,
      n_books:      items.length,
      updated_at:   Date.now(),
    });
  }

  // Pós-processo: de-overround por (market, line) → fair_prob
  // Agrupa por market+line pra pegar todos os outcomes do mesmo mercado
  const byMarket = new Map();
  for (const row of out) {
    const k = `${row.market}|${row.line ?? ''}`;
    if (!byMarket.has(k)) byMarket.set(k, []);
    byMarket.get(k).push(row);
  }
  for (const [, rows] of byMarket) {
    // Usa sharp_price se disponível, senão median
    const priceMap = {};
    for (const r of rows) priceMap[r.outcome] = r.sharp_price || r.median_price;
    const dor = deOverround(priceMap);
    if (!dor) continue;
    for (const r of rows) {
      if (dor.fair[r.outcome] != null) r.fair_prob = +dor.fair[r.outcome].toFixed(4);
      r.overround = +dor.overround.toFixed(4);
    }
  }

  return out;
}

// Detecta movimento significativo (sharp money entrando)
// Recebe série temporal [{price, ts, book}] e retorna { direction, magnitude, alert }
export function detectMovement(series) {
  if (!series?.length || series.length < 2) return null;
  const sorted = [...series].sort((a, b) => a.ts - b.ts);
  const first = sorted[0].price;
  const last = sorted[sorted.length - 1].price;
  if (!first || !last) return null;
  const pct = (last - first) / first;
  const direction = pct > 0 ? 'up' : 'down';
  const magnitude = Math.abs(pct);
  // Alert: queda ≥5% em <2h = sharp money (linha curta = mercado acredita mais)
  const spanMs = sorted[sorted.length - 1].ts - sorted[0].ts;
  const fast = spanMs < 2 * 60 * 60 * 1000;
  const alert = magnitude >= 0.05 && fast;
  return {
    direction, magnitude: +magnitude.toFixed(4),
    from: first, to: last,
    span_hours: +(spanMs / 3600000).toFixed(2),
    alert,
    reason: alert
      ? `${direction === 'down' ? '📉 Odd caindo' : '📈 Odd subindo'} ${(magnitude*100).toFixed(1)}% em ${(spanMs/3600000).toFixed(1)}h — possível sharp money`
      : null,
  };
}

// CLV: compara odd obtida na entrada vs odd de fechamento
export function computeCLV(entryPrice, closingPrice) {
  if (!entryPrice || !closingPrice || entryPrice <= 1 || closingPrice <= 1) return null;
  const entryProb = 1 / entryPrice;
  const closeProb = 1 / closingPrice;
  const clv = (closeProb - entryProb) / entryProb;  // negativo = apostei melhor que fechamento
  return {
    entry_price: entryPrice,
    closing_price: closingPrice,
    clv_pct: +(-clv * 100).toFixed(2),   // positivo = beat the close
    beat_close: clv < 0,
  };
}

// Salva consensus no D1 (cache pra leituras rápidas)
export async function saveConsensus(env, eventId, consensusRows) {
  if (!env.SB_DB || !consensusRows?.length) return 0;
  const stmt = env.SB_DB.prepare(`
    INSERT INTO odds_consensus (event_id, market, outcome, line, best_price, best_book, median_price, sharp_price, fair_prob, n_books, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, market, outcome, line) DO UPDATE SET
      best_price   = excluded.best_price,
      best_book    = excluded.best_book,
      median_price = excluded.median_price,
      sharp_price  = excluded.sharp_price,
      fair_prob    = excluded.fair_prob,
      n_books      = excluded.n_books,
      updated_at   = excluded.updated_at
  `);
  const batch = consensusRows.map(r => stmt.bind(
    eventId, r.market, r.outcome, r.line,
    r.best_price, r.best_book, r.median_price, r.sharp_price,
    r.fair_prob ?? null, r.n_books, r.updated_at
  ));
  try {
    await env.SB_DB.batch(batch);
    return batch.length;
  } catch (e) {
    console.warn('[consensus:save]', e.message);
    return 0;
  }
}
