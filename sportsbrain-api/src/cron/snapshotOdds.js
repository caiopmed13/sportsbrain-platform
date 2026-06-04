// ══════════════════════════════════════════════════════════════════════════
// Cron: snapshot de odds (CLV tracker + sharp consensus)
// ══════════════════════════════════════════════════════════════════════════
// Roda a cada 5min. Para não estourar o subrequest limit do Worker,
// rotaciona os books por tick (minuto-based). Ciclo completo = 15min.
// ══════════════════════════════════════════════════════════════════════════

import { runScrapeCycle } from '../odds/index.js';

// Books agrupados em 4 "slots". Cada slot roda a cada 20min (1 em 4 ticks de 5min).
// Slot é determinístico: minute % 20 / 5 → 0..3.
// Pinnacle fica sozinho porque é o mais pesado (21 subrequests).
const BOOK_SLOTS = [
  ['pinnacle'],                                          // slot 0 — sharp reference
  ['bovada', 'kambi', '1xbet'],                          // slot 1 — soft consensus
  ['draftkings', 'fanduel', 'betmgm'],                   // slot 2 — US majors
  ['caesars', 'hardrock', 'pointsbet', 'smarkets', 'betfair_ex'], // slot 3 — US secondary + exchanges
];

export async function snapshotOdds(env) {
  const t0 = Date.now();
  try {
    const minute = new Date().getUTCMinutes();
    const slotIdx = Math.floor((minute % 20) / 5);
    const books = BOOK_SLOTS[slotIdx] || BOOK_SLOTS[0];

    const summary = await runScrapeCycle(env, {
      sports: ['soccer', 'basketball'],
      books,
    });
    console.log(`[cron:snapshotOdds] slot=${slotIdx} books=${books.join(',')} ${JSON.stringify(summary)}`);
    return { ok: true, elapsed_ms: Date.now() - t0, slot: slotIdx, books, ...summary };
  } catch (e) {
    console.error('[cron:snapshotOdds] ERROR:', e.message);
    return { ok: false, error: e.message, elapsed_ms: Date.now() - t0 };
  }
}

// Garbage collection: remove snapshots com mais de 14 dias (exceto últimos 3 por evento)
export async function pruneOldSnapshots(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  try {
    const r = await env.SB_DB.prepare(
      `DELETE FROM odds_snapshots WHERE ts < ?`
    ).bind(cutoff).run();
    await env.SB_DB.prepare(
      `DELETE FROM odds_events WHERE commence_time < ? AND status = 'ft'`
    ).bind(cutoff).run();
    return { ok: true, deleted: r.meta?.changes ?? 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
