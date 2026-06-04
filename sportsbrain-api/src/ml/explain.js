// ══════════════════════════════════════════════════════════════════════════
// Explain layer — turn a pick + context into a structured explanation.
// Usage: const { explain, drivers, signals } = await buildExplain(env, pick, ctx);
// ══════════════════════════════════════════════════════════════════════════
import { getTeamFeatures } from '../enrich/teamFeatures.js';
import { isAbnormalWeather } from '../enrich/weather.js';
import { isRefereeExtreme } from '../enrich/referee.js';
import { computeSharpSignal } from '../analytics/sharpPublic.js';

const TAG = '[ml:explain]';

async function clvHistoryForBook(env, book) {
  if (!env.SB_DB || !book) return null;
  try {
    const row = await env.SB_DB.prepare(
      `SELECT AVG(clv_pct) AS avg_clv, COUNT(*) AS n
         FROM picks_closed WHERE book = ? AND clv_pct IS NOT NULL`
    ).bind(book).first();
    if (!row || !row.n) return null;
    return { avg_clv: row.avg_clv, n: row.n };
  } catch { return null; }
}

// pick: { event_id, market, outcome, book, edge_pct, sharp_books, model_prob, fair_price_at_pick, price_at_pick }
export async function buildExplain(env, pick, { modelProbXG = null } = {}) {
  const drivers = [];
  const signals = [];

  // 1. edge
  if (pick.edge_pct != null) {
    drivers.push({ name: 'edge_pct', impact: +pick.edge_pct.toFixed(2) });
    signals.push(`Edge ${pick.edge_pct.toFixed(1)}%`);
  }

  // 2. sharp coverage
  const nSharp = Array.isArray(pick.sharp_books) ? pick.sharp_books.length : (pick.n_sharp || 0);
  drivers.push({ name: 'sharp_coverage', impact: nSharp });
  if (nSharp >= 3) signals.push(`steam ${nSharp} sharp books`);

  // 3. sharp signal
  try {
    const sig = await computeSharpSignal(env, { event_id: pick.event_id });
    const top = sig?.top_signal;
    if (top && top.sharpness >= 0.3) {
      drivers.push({ name: 'sharp_signal', impact: +top.diff_pp.toFixed(2) });
      signals.push(`sharp movement ${top.diff_pp.toFixed(1)}pp`);
    }
  } catch {}

  // 4. model agreement
  if (modelProbXG != null && pick.fair_price_at_pick) {
    const fairProb = 1 / pick.fair_price_at_pick;
    const agree = Math.abs(modelProbXG - fairProb) < 0.05;
    drivers.push({ name: 'model_agreement', impact: agree ? 1 : 0 });
    if (agree) signals.push('xG agree');
  }

  // 5. CLV history this book
  const clv = await clvHistoryForBook(env, pick.book);
  if (clv && clv.n >= 10) {
    drivers.push({ name: 'clv_history_this_book', impact: +clv.avg_clv.toFixed(3) });
    if (clv.avg_clv > 0.5) signals.push(`book CLV+${clv.avg_clv.toFixed(1)}%`);
  }

  // 6-8. weather/rest/referee flags
  try {
    const feats = await getTeamFeatures(env, pick.event_id);
    if (feats) {
      if (isAbnormalWeather(feats.weather)) {
        drivers.push({ name: 'weather_flag', impact: 1 });
        signals.push('weather abnormal');
      }
      const restH = feats.home?.rest_days, restA = feats.away?.rest_days;
      if (restH != null && restA != null) {
        const diff = +(restH - restA).toFixed(1);
        if (Math.abs(diff) >= 2) {
          drivers.push({ name: 'rest_advantage', impact: diff });
          signals.push(`rest ${diff > 0 ? 'home' : 'away'} +${Math.abs(diff)}d`);
        }
      }
      if (isRefereeExtreme(feats.referee)) {
        drivers.push({ name: 'referee_flag', impact: 1 });
        signals.push('referee extreme');
      }
    }
  } catch (e) { console.warn(`${TAG} feats: ${e.message}`); }

  const explain = signals.slice(0, 5).join(' + ');
  return { explain, drivers, signals };
}
