// ══════════════════════════════════════════════════════════════════════════
// Odds Engine — orchestrator
// ══════════════════════════════════════════════════════════════════════════
// Coordena scrapers, salva snapshots no D1, computa consenso.
// Usado por:
//   • cron de 3min (snapshotOdds.js) → scrape + save
//   • routes /v1/odds/* → leitura de consensus
// ══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────
// PROPRIETARY SCRAPERS — withheld from the public portfolio.
// The per-book scraper implementations are intentionally omitted. The local
// stubs below preserve this orchestrator's structure so module exports still
// resolve; each throws if invoked.
// ───────────────────────────────────────────────────────────────────────
const __SCRAPER_WITHHELD = 'Proprietary scraper — withheld from public portfolio.';
const scrapePinnacle    = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeBovada      = async () => { throw new Error(__SCRAPER_WITHHELD); };
const readBovadaBttsShadowOpts   = () => { throw new Error(__SCRAPER_WITHHELD); };
const measureBovadaBttsShadowFetch = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeKambi       = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrape1xBet       = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeSmarkets    = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeBetfair     = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeDraftKings  = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeFanDuel     = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeBetMGM      = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeCaesars     = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapeHardRock    = async () => { throw new Error(__SCRAPER_WITHHELD); };
const scrapePointsBet   = async () => { throw new Error(__SCRAPER_WITHHELD); };
import { upsertEvent, insertSnapshots, markBookStatus } from './storage.js';
import { aggregateConsensus, saveConsensus } from './consensus.js';

// ───────────────────────────────────────────────────────────────────────
// P3.9 R6E-A — Bovada BTTS per-event shadow measurement (dormant wrapper)
// ───────────────────────────────────────────────────────────────────────
// Sempre chama scrapeBovada (h2h/totals/spreads inalterados). DEPOIS,
// se e somente se BOVADA_BTTS_FETCH=true no env do Worker, dispara
// measureBovadaBttsShadowFetch para coletar BTTS per-event com caps
// conservadores (topN=4, jitter, retry backoff). Insert continua gated
// por BOVADA_BTTS_INSERT (default false). Erros NUNCA propagam para o
// main scraper — capturados em try/catch local. Sem flag, é no-op.
export async function runBovadaWithOptionalBttsShadow(sportKeys, env) {
  const result = await scrapeBovada(sportKeys);
  try {
    const opts = readBovadaBttsShadowOpts(env || {});
    if (opts.fetch) {
      const t0 = Date.now();
      const { metrics } = await measureBovadaBttsShadowFetch(result.events, opts);
      console.log('[bovada:btts-shadow]', JSON.stringify({
        btts_shadow_enabled:           metrics.btts_shadow_enabled,
        btts_insert_enabled:           metrics.btts_insert_enabled,
        events_considered:             metrics.events_considered,
        events_attempted:              metrics.events_attempted,
        requests_ok:                   metrics.requests_ok,
        requests_429:                  metrics.requests_429,
        requests_timeout:              metrics.requests_timeout,
        requests_failed:               metrics.requests_failed,
        bytes_downloaded_est:          metrics.bytes_downloaded_est,
        strict_btts_markets_found:     metrics.strict_btts_markets_found,
        compound_btts_markets_ignored: metrics.compound_btts_markets_ignored,
        btts_rows_generated:           metrics.btts_rows_generated,
        btts_rows_would_insert:        metrics.btts_rows_would_insert,
        insert_calls:                  metrics.insert_calls,
        elapsed_ms:                    metrics.elapsed_ms,
        wall_clock_ms:                 Date.now() - t0,
      }));
    }
  } catch (e) {
    // Defensive: jamais derruba o main scraper Bovada
    console.warn('[bovada:btts-shadow] error', e?.message || String(e));
  }
  return result;
}

// Scrapers in order of priority.
// Each scraper gets (sports, env?) — env passed for BYO-credentials (Betfair).
const SCRAPERS = [
  { key: 'pinnacle',   fn: (sp, env) => scrapePinnacle(sp)         },
  { key: 'bovada',     fn: (sp, env) => runBovadaWithOptionalBttsShadow(sp, env) },
  { key: 'kambi',      fn: (sp, env) => scrapeKambi(sp)            },
  { key: '1xbet',      fn: (sp, env) => scrape1xBet(sp)            },
  { key: 'smarkets',   fn: (sp, env) => scrapeSmarkets(sp)         },
  { key: 'betfair_ex', fn: (sp, env) => scrapeBetfair(sp, env)     },
  { key: 'draftkings', fn: (sp, env) => scrapeDraftKings(sp)       },
  { key: 'fanduel',    fn: (sp, env) => scrapeFanDuel(sp)          },
  { key: 'betmgm',     fn: (sp, env) => scrapeBetMGM(sp)           },
  { key: 'caesars',    fn: (sp, env) => scrapeCaesars(sp)          },
  { key: 'hardrock',   fn: (sp, env) => scrapeHardRock(sp)         },
  { key: 'pointsbet',  fn: (sp, env) => scrapePointsBet(sp)        },
];

// Scrape orchestrado: roda todos em paralelo, agrega, salva
// opts.sports = ['soccer', 'basketball']
// opts.books  = lista específica (opcional)
export async function runScrapeCycle(env, opts = {}) {
  const sports = opts.sports || ['soccer', 'basketball'];
  const useScrapers = opts.books
    ? SCRAPERS.filter(s => opts.books.includes(s.key))
    : SCRAPERS;

  const summary = { scrapers: {}, events_total: 0, snapshots_total: 0 };
  const allEvents   = new Map();  // id → event
  const allSnaps    = [];

  await Promise.allSettled(useScrapers.map(async s => {
    const t0 = Date.now();
    try {
      const { events, snapshots } = await s.fn(sports, env);
      for (const ev of events) {
        if (!allEvents.has(ev.id)) allEvents.set(ev.id, ev);
      }
      allSnaps.push(...snapshots);
      summary.scrapers[s.key] = {
        ok: true, events: events.length, snapshots: snapshots.length,
        elapsed_ms: Date.now() - t0,
      };
      await markBookStatus(env, s.key, true);
    } catch (e) {
      summary.scrapers[s.key] = { ok: false, error: e.message, elapsed_ms: Date.now() - t0 };
      await markBookStatus(env, s.key, false, e.message);
    }
  }));

  // Upsert events
  const eventIds = [];
  for (const ev of allEvents.values()) {
    const id = await upsertEvent(env, ev);
    if (id) eventIds.push(id);
  }
  summary.events_total = eventIds.length;

  // Insert snapshots (batch)
  const written = await insertSnapshots(env, allSnaps);
  summary.snapshots_total = written;

  // Rebuild consensus por evento (só pros que tiveram snapshots novos)
  const affectedEvents = new Set(allSnaps.map(s => s.event_id));
  let consensusCount = 0;
  for (const eid of affectedEvents) {
    const eventSnaps = allSnaps.filter(s => s.event_id === eid);
    if (!eventSnaps.length) continue;
    const rows = aggregateConsensus(eventSnaps);
    if (rows.length) {
      await saveConsensus(env, eid, rows);
      consensusCount += rows.length;
    }
  }
  summary.consensus_rows = consensusCount;

  summary.finished_at = Date.now();
  return summary;
}
