/**
 * Market Intelligence Routes — SportsBrain Data API v1
 * ──────────────────────────────────────────────────────
 * GET /v1/market/lines/:sport          — latest lines per sport from D1
 * GET /v1/market/movement/:prop_key    — odds history for a specific prop
 * GET /v1/market/consensus             — consensus picks + market signals
 *
 * These endpoints expose the market intelligence layer — the analysis of
 * how lines move, where sharp money is going, and what consensus looks like.
 * All data is sourced from the D1 line_snapshots table + intelligence cache.
 */

import { sbResponse, sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';

export async function handleMarket(pathname, request, env, services) {
  const { cache } = services;
  const url = new URL(request.url);

  // ── GET /v1/market/lines/:sport ───────────────────────────────────────
  // Latest line snapshot per prop_key, filtered by sport
  const linesMatch = pathname.match(/^\/v1\/market\/lines\/(\w+)$/);
  if (linesMatch) {
    const sport = linesMatch[1];
    const validSports = ['football', 'basketball', 'all'];
    if (!validSports.includes(sport)) {
      return jsonResponse(sbError('BAD_REQUEST', `Invalid sport: ${sport}. Use: football, basketball, all`, 400), 400);
    }

    try {
      const db = env.SB_DB;
      let rows;

      if (sport === 'all') {
        const stmt = db.prepare(`
          SELECT ls.prop_key, ls.sport, ls.stat, ls.line, ls.bookmaker,
                 ls.odds_over, ls.odds_under, ls.recorded_at,
                 prev.line as prev_line,
                 (ls.line - prev.line) as line_movement
          FROM line_snapshots ls
          LEFT JOIN line_snapshots prev ON prev.prop_key = ls.prop_key
            AND prev.recorded_at = (
              SELECT MAX(recorded_at) FROM line_snapshots
              WHERE prop_key = ls.prop_key AND recorded_at < ls.recorded_at
            )
          WHERE ls.recorded_at = (
            SELECT MAX(recorded_at) FROM line_snapshots WHERE prop_key = ls.prop_key
          )
          ORDER BY ls.sport, ls.recorded_at DESC
          LIMIT 100
        `);
        const result = await stmt.all();
        rows = result.results || [];
      } else {
        const stmt = db.prepare(`
          SELECT ls.prop_key, ls.sport, ls.stat, ls.line, ls.bookmaker,
                 ls.odds_over, ls.odds_under, ls.recorded_at,
                 prev.line as prev_line,
                 (ls.line - prev.line) as line_movement
          FROM line_snapshots ls
          LEFT JOIN line_snapshots prev ON prev.prop_key = ls.prop_key
            AND prev.recorded_at = (
              SELECT MAX(recorded_at) FROM line_snapshots
              WHERE prop_key = ls.prop_key AND recorded_at < ls.recorded_at
            )
          WHERE ls.sport = ?
            AND ls.recorded_at = (
              SELECT MAX(recorded_at) FROM line_snapshots WHERE prop_key = ls.prop_key
            )
          ORDER BY ls.recorded_at DESC
          LIMIT 50
        `);
        const result = await stmt.bind(sport).all();
        rows = result.results || [];
      }

      // Enrich with movement direction
      const lines = rows.map(row => ({
        prop_key:        row.prop_key,
        sport:           row.sport,
        stat:            row.stat,
        current_line:    row.line,
        bookmaker:       row.bookmaker || 'market',
        odds_over:       row.odds_over,
        odds_under:      row.odds_under,
        prev_line:       row.prev_line || null,
        line_movement:   row.line_movement ? parseFloat(row.line_movement.toFixed(2)) : 0,
        movement_direction: row.line_movement > 0 ? 'up' : row.line_movement < 0 ? 'down' : 'stable',
        last_updated:    row.recorded_at,
      }));

      return jsonResponse(sbResponse({
        data: {
          sport,
          count: lines.length,
          lines,
          market_status: lines.length > 0 ? 'active' : 'no_data',
          note: lines.length === 0 ? 'No snapshots recorded yet. Snapshots populate automatically when props are generated.' : undefined,
        },
        meta: { endpoint: pathname },
      }));
    } catch (e) {
      console.error('[Market] lines failed:', e.message);
      return jsonResponse(sbError('INTERNAL_ERROR', 'Failed to fetch market lines', 500), 500);
    }
  }

  // ── GET /v1/market/movement/:prop_key ──────────────────────────────────
  // Full odds history for a specific prop (line movement timeline)
  const movementMatch = pathname.match(/^\/v1\/market\/movement\/(.+)$/);
  if (movementMatch) {
    const prop_key = decodeURIComponent(movementMatch[1]);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

    try {
      const stmt = env.SB_DB.prepare(`
        SELECT prop_key, sport, stat, line, bookmaker, odds_over, odds_under, recorded_at
        FROM line_snapshots
        WHERE prop_key = ?
        ORDER BY recorded_at DESC
        LIMIT ?
      `);
      const result = await stmt.bind(prop_key, limit).all();
      const snapshots = result.results || [];

      if (snapshots.length === 0) {
        return jsonResponse(sbResponse({
          data: {
            prop_key,
            snapshots: [],
            analysis: null,
            message: 'No movement data found for this prop key.',
          },
          meta: { endpoint: pathname },
        }));
      }

      // Calculate movement analysis
      const lines = snapshots.map(s => s.line);
      const opened_line = lines[lines.length - 1];
      const current_line = lines[0];
      const high = Math.max(...lines);
      const low = Math.min(...lines);
      const total_movement = parseFloat((current_line - opened_line).toFixed(2));
      const direction = total_movement > 0 ? 'up' : total_movement < 0 ? 'down' : 'stable';

      return jsonResponse(sbResponse({
        data: {
          prop_key,
          sport:     snapshots[0].sport,
          stat:      snapshots[0].stat,
          analysis: {
            opened_line,
            current_line,
            high,
            low,
            total_movement,
            movement_direction: direction,
            movement_pct:       opened_line > 0 ? parseFloat((total_movement / opened_line * 100).toFixed(2)) : 0,
            snapshots_count:    snapshots.length,
            first_recorded:     snapshots[snapshots.length - 1].recorded_at,
            last_recorded:      snapshots[0].recorded_at,
            sharp_signal: Math.abs(total_movement) >= 0.5 ? 'possible_sharp_action' : 'normal',
          },
          snapshots: snapshots.map(s => ({
            line:       s.line,
            bookmaker:  s.bookmaker,
            odds_over:  s.odds_over,
            odds_under: s.odds_under,
            recorded_at: s.recorded_at,
          })),
        },
        meta: { endpoint: pathname, limit },
      }));
    } catch (e) {
      console.error('[Market] movement failed:', e.message);
      return jsonResponse(sbError('INTERNAL_ERROR', 'Failed to fetch movement data', 500), 500);
    }
  }

  // ── GET /v1/market/consensus ───────────────────────────────────────────
  // Consensus market view: aggregated signals from picks cache + line data
  if (pathname === '/v1/market/consensus') {
    const sport = url.searchParams.get('sport') || 'all';

    const cachedPicks = await cache.get('intelligence:picks:today');
    const picks = cachedPicks?.picks || [];

    const filtered = sport !== 'all' ? picks.filter(p => p.sport === sport) : picks;

    // Aggregate consensus data
    const byMarket = {};
    for (const p of filtered) {
      const key = `${p.sport}|${p.market || p.stat}`;
      if (!byMarket[key]) {
        byMarket[key] = {
          market: p.market || p.stat,
          sport: p.sport,
          picks_count: 0,
          avg_confidence: 0,
          direction_over: 0,
          direction_under: 0,
          avg_opportunity_score: 0,
          top_pick: null,
        };
      }
      byMarket[key].picks_count++;
      byMarket[key].avg_confidence += p.confidence || 0;
      byMarket[key].avg_opportunity_score += p.opportunity_score || 0;
      if (p.direction === 'over') byMarket[key].direction_over++;
      else if (p.direction === 'under') byMarket[key].direction_under++;
      if (!byMarket[key].top_pick || (p.opportunity_score > (byMarket[key].top_pick.opportunity_score || 0))) {
        byMarket[key].top_pick = { id: p.id, title: p.title, confidence: p.confidence };
      }
    }

    // Finalize averages
    const consensus = Object.values(byMarket).map(m => ({
      ...m,
      avg_confidence: m.picks_count > 0 ? Math.round(m.avg_confidence / m.picks_count) : 0,
      avg_opportunity_score: m.picks_count > 0 ? Math.round(m.avg_opportunity_score / m.picks_count) : 0,
      consensus_direction: m.direction_over >= m.direction_under ? 'over' : 'under',
      consensus_strength: m.picks_count > 0 ? Math.round(
        Math.max(m.direction_over, m.direction_under) / m.picks_count * 100
      ) : 0,
    })).sort((a, b) => b.avg_opportunity_score - a.avg_opportunity_score);

    return jsonResponse(sbResponse({
      data: {
        sport,
        date: new Date().toISOString().slice(0, 10),
        total_markets: consensus.length,
        total_picks:   filtered.length,
        consensus,
        market_summary: {
          most_picked_market: consensus[0]?.market || null,
          strongest_consensus: consensus.find(c => c.consensus_strength >= 80) || null,
          high_confidence_markets: consensus.filter(c => c.avg_confidence >= 65).length,
        },
      },
      meta: { endpoint: pathname, filters: { sport } },
    }));
  }

  return jsonResponse(sbError('NOT_FOUND', `Route ${pathname} not found`, 404), 404);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: corsHeaders(),
  });
}
