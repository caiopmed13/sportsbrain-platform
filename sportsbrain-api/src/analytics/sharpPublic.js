// ══════════════════════════════════════════════════════════════════════════
// Sharp vs Public proxy — compare price movement on sharp books vs soft books.
// ══════════════════════════════════════════════════════════════════════════

const TAG = '[analytics:sharpPublic]';

const SHARP_BOOKS = new Set(['pinnacle', 'betfair_ex', 'betfair', 'smarkets', 'matchbook']);
const SOFT_BOOKS  = new Set(['bovada', 'draftkings', 'fanduel', 'betmgm', 'caesars', 'hardrock', 'betano', 'superbet']);

// Compute sharp signal for a given event.
// Strategy: for each (market, outcome, line), compare avg % change of sharp
// books vs soft books over the last `windowHours`. If sharp moves price UP
// and soft stays flat/down → sharp money is backing that side.
export async function computeSharpSignal(env, { event_id, windowHours = 6 } = {}) {
  if (!env.SB_DB || !event_id) return null;
  const cutoff = Date.now() - windowHours * 3600 * 1000;
  const { results: snaps } = await env.SB_DB.prepare(`
    SELECT book, market, outcome, line, price, ts
      FROM odds_snapshots
     WHERE event_id = ? AND ts >= ?
     ORDER BY ts ASC
  `).bind(event_id, cutoff).all().catch(() => ({ results: [] }));
  if (!snaps?.length) return null;

  // Group by (market, outcome, line) with sharp/soft series
  const groups = new Map();
  for (const s of snaps) {
    const key = `${s.market}|${s.outcome}|${s.line ?? ''}`;
    const cohort = SHARP_BOOKS.has(String(s.book).toLowerCase())
      ? 'sharp'
      : (SOFT_BOOKS.has(String(s.book).toLowerCase()) ? 'soft' : null);
    if (!cohort) continue;
    if (!groups.has(key)) groups.set(key, { market: s.market, outcome: s.outcome, line: s.line, sharp: [], soft: [] });
    groups.get(key)[cohort].push({ price: s.price, ts: s.ts, book: s.book });
  }

  const signals = [];
  for (const [, g] of groups) {
    if (!g.sharp.length || !g.soft.length) continue;
    const deltaPct = (arr) => {
      if (arr.length < 2) return 0;
      const first = arr[0].price;
      const last  = arr[arr.length - 1].price;
      if (!first) return 0;
      return ((last - first) / first) * 100;
    };
    const dSharp = deltaPct(g.sharp);
    const dSoft  = deltaPct(g.soft);
    const diff   = dSharp - dSoft;
    // Sharpness: scaled |diff| (cap at 5pp)
    const sharpness = Math.max(0, Math.min(1, Math.abs(diff) / 5));
    signals.push({
      market: g.market, outcome: g.outcome, line: g.line,
      delta_sharp_pct: +dSharp.toFixed(3),
      delta_soft_pct:  +dSoft.toFixed(3),
      diff_pp: +diff.toFixed(3),
      sharpness: +sharpness.toFixed(3),
      side: diff > 0 ? 'toward' : 'against',
      n_sharp: g.sharp.length,
      n_soft:  g.soft.length,
    });
  }

  if (!signals.length) return null;
  signals.sort((a, b) => b.sharpness - a.sharpness);
  const top = signals[0];
  return {
    event_id,
    window_hours: windowHours,
    top_signal: top,
    all_signals: signals.slice(0, 20),
  };
}

// HTTP route: GET /v1/odds/sharp-signal?event_id=...
export async function handleSharpSignal(request, env) {
  try {
    const url = new URL(request.url);
    const event_id = url.searchParams.get('event_id');
    const windowHours = parseInt(url.searchParams.get('window') || '6', 10);
    if (!event_id) {
      return new Response(JSON.stringify({ ok: false, error: 'event_id required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const sig = await computeSharpSignal(env, { event_id, windowHours });
    return new Response(JSON.stringify({ ok: true, signal: sig }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.warn(`${TAG} err: ${e.message}`);
    return new Response(JSON.stringify({ ok: false, error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
