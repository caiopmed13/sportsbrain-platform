/**
 * SportsBrain Odds Service — 100% PROPRIETARY
 * ───────────────────────────────────────────
 * Reads from D1 odds_* tables (populated by scrapers Pinnacle + Bovada).
 * No external paid API. API surface mantida compatível com callers antigos
 * (football.js, basketball.js) pra evitar ripple.
 */

import { listUpcomingEvents, getLatestOdds } from '../odds/storage.js';

const SPORT_MAP = {
  football:   'soccer',
  basketball: 'basketball',
};

export class OddsService {
  constructor(env, cache) {
    this.env   = env;
    this.cache = cache;
  }

  // ── Odds por esporte (formato TheOddsAPI-like pra compat) ────────────────
  async getOdds(sport = 'basketball', _region = 'us', _market = 'h2h') {
    const sportKey = SPORT_MAP[sport] || sport;
    const cacheKey = `odds_prop:${sportKey}`;

    const { data, fromCache } = await this.cache.getOrFetch(
      cacheKey,
      () => this._loadFromD1(sportKey),
      300
    );

    return { odds: data || [], source: fromCache ? 'cache' : 'proprietary' };
  }

  async _loadFromD1(sport) {
    if (!this.env.SB_DB) return [];
    try {
      const events = await listUpcomingEvents(this.env, { sport, hours: 72 });
      if (!events.length) return [];

      // Monta formato TheOddsAPI-like
      const out = [];
      for (const ev of events) {
        const snaps = await getLatestOdds(this.env, { event_id: ev.id, maxAge: 60 * 60 * 1000 });
        if (!snaps.length) continue;
        const bookmakers = {};
        for (const o of snaps) {
          if (!bookmakers[o.book]) bookmakers[o.book] = { key: o.book, title: o.book, markets: {} };
          if (!bookmakers[o.book].markets[o.market]) bookmakers[o.book].markets[o.market] = { key: o.market, outcomes: [] };
          bookmakers[o.book].markets[o.market].outcomes.push({
            name: o.outcome, price: o.price, point: o.line,
          });
        }
        out.push({
          id: ev.id,
          sport_key:     sport,
          sport_title:   ev.league,
          commence_time: new Date(ev.commence_time).toISOString(),
          home_team:     ev.home,
          away_team:     ev.away,
          bookmakers: Object.values(bookmakers).map(bk => ({
            key: bk.key, title: bk.title,
            markets: Object.values(bk.markets),
          })),
        });
      }
      return out;
    } catch (e) {
      console.warn('[OddsService] D1 read error:', e.message);
      return [];
    }
  }

  // ── Match evento por nome de time (compat antigo) ────────────────────────
  matchGameOdds(events, home, away) {
    if (!events?.length || !home || !away) return null;
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
    const nh = norm(home), na = norm(away);
    return events.find(e => {
      const eh = norm(e.home_team), ea = norm(e.away_team);
      return (eh === nh && ea === na) ||
             (eh === na && ea === nh) ||
             (eh.startsWith(nh.slice(0,5)) && ea.startsWith(na.slice(0,5)));
    }) || null;
  }

  // ── All events (shortcut — usa /v1/odds/all route pra eficiência) ────────
  async getAllEvents() {
    return this._loadFromD1('soccer').then(async soccer => {
      const basket = await this._loadFromD1('basketball');
      return { events: [...soccer, ...basket], source: 'proprietary' };
    });
  }
}
