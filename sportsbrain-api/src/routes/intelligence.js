/**
 * Intelligence Routes — SportsBrain Data API v1
 * ──────────────────────────────────────────────
 * GET /v1/intelligence/picks/today       — ranked picks across all sports
 * GET /v1/intelligence/value             — highest EV opportunities
 * GET /v1/intelligence/rankings          — confidence-ranked picks
 * GET /v1/intelligence/market-health     — market efficiency scores
 * GET /v1/recommendations/today          — new recommendation endpoint (alias)
 * GET /v1/recommendations                — filtered recommendations with query params
 * GET /v1/recommendations/value          — top EV picks (min_ev=3 default)
 * GET /v1/status                         — API status and version info
 * GET /v1/meta/quality                   — API data quality report
 * GET /v1/meta/sources                   — active data sources
 */

import { sbResponse, sbError, DQ, getConviction, dataWarning } from '../schemas/base.js';
import {
  opportunityScore, valueLabel, marketHealth, INTELLIGENCE_VERSION,
  lineConf, recencyWeight, projectionRange, homeAwayAdjust, formStreak, qualityMultiplier,
  impliedEV, robustnessScore,
} from '../intelligence/engine.js';
import { corsHeaders } from './health.js';

export async function handleIntelligence(pathname, request, env, services) {
  const { football, basketball, odds, cache } = services;
  const url = new URL(request.url);

  // ── GET /v1/status (public endpoint) ────────────────────────────────
  if (pathname === '/v1/status') {
    try {
      const ftGames = await football.getTodayGames();
      const bkGames = await basketball.getTodayGames();

      return jsonResponse(sbResponse({
        data: {
          api_version: 'v1',
          engine_version: INTELLIGENCE_VERSION,
          sports_active: ['football', 'basketball'],
          coverage_today: {
            football_games: ftGames?.games?.length || 0,
            basketball_games: bkGames?.games?.length || 0,
          },
          data_freshness: {
            football: ftGames?.games?.length > 0 ? 'recent' : 'no_data',
            basketball: bkGames?.games?.length > 0 ? 'live' : 'no_data',
          },
          uptime: 'operational',
        },
        meta: { endpoint: pathname },
      }));
    } catch (e) {
      return jsonResponse(sbResponse({
        data: {
          api_version: 'v1',
          engine_version: INTELLIGENCE_VERSION,
          uptime: 'operational',
        },
        meta: { endpoint: pathname, note: 'Partial status available' },
      }));
    }
  }

  // ── GET /v1/intelligence/picks/today ─ LEGACY ENDPOINT ──────────────
  // Also supports /v1/recommendations/today (new alias)
  if (pathname === '/v1/intelligence/picks/today' || pathname === '/v1/recommendations/today') {
    const cacheKey = 'intelligence:picks:today';
    const today = new Date().toISOString().slice(0, 10);

    const { data } = await cache.getOrFetch(cacheKey, async () => {
      const allPicks = [];

      // Gather football props
      try {
        const ftGames = await football.getTodayGames();
        for (const game of ftGames.games.slice(0, 8)) {
          const homeStats = await football.getTeamStats(game.home_team);
          const awayStats = await football.getTeamStats(game.away_team);
          const propsData = await buildFootballPicksFromGame(game, homeStats, awayStats);
          allPicks.push(...propsData);
        }
      } catch (e) { console.warn('[Intelligence] football picks failed:', e.message); }

      // Gather basketball props
      try {
        const bkGames = await basketball.getTodayGames();
        for (const game of bkGames.games.slice(0, 5)) {
          const rawProps = await basketball.generateGameProps(game);
          for (const p of (rawProps || [])) {
            // Skip aggressive tier and low-confidence picks
            if (p.tier === 'aggressive') continue;
            if ((p.conf || 0) < 52) continue;
            // v2.1 (4.5.0): use market-aware EV for basketball player props
            const ev = impliedEV(p.conf, 'basketball_player_prop');
            const conviction = getConviction(p.conf, p.dq, p.sample_size || 0);
            const rScore = robustnessScore({ dq: p.dq, sampleSize: p.sample_size || 0 });
            allPicks.push({
              id:              p.game_id + '|' + (p.player_name||'').replace(/\s/g,'_') + '|' + p.stat + '|' + p.line,
              source:          'bkprop',
              sport:           'basketball',
              home_team:       p.home_team,
              away_team:       p.away_team,
              title:           `${p.player_name} ${p.stat.toUpperCase()} ${p.direction} ${p.line}`,
              market:          p.stat_label + ' Player Prop',
              line:            p.line,
              direction:       p.direction,
              tier:            p.tier,
              confidence:      p.conf,
              ev_pct:          ev,
              dq:              p.dq,
              player:          p.player_name,
              reason:          p.reason,
              conviction:      conviction.label,
              conviction_reason: conviction.conviction_reason || null,
              data_warning:    dataWarning(conviction.label, p.dq, p.sample_size || 0),
              robustness_score: rScore,
              opportunity_score: opportunityScore({ conf: p.conf, ev, dq: p.dq, tier: p.tier }),
              value_label:     valueLabel(p.conf, ev),
            });
          }
        }
      } catch (e) { console.warn('[Intelligence] basketball picks failed:', e.message); }

      // Final quality gate — no noise, no aggressive tier
      const qualityPicks = allPicks.filter(p => p.confidence >= 52 && p.tier !== 'aggressive');
      // v2.1 (4.5.0): Sort by opportunity_score, tiebreak by robustness_score
      qualityPicks.sort((a, b) => {
        if (b.opportunity_score !== a.opportunity_score) return b.opportunity_score - a.opportunity_score;
        return (b.robustness_score || 0) - (a.robustness_score || 0);
      });

      return {
        date: today,
        total: qualityPicks.length,
        picks: qualityPicks,
        generated_at: new Date().toISOString(),
      };
    }, 600);

    const d = data || { date: today, total: 0, picks: [], generated_at: new Date().toISOString() };

    return jsonResponse(sbResponse({
      data: {
        ...d,
        top_10:   d.picks?.slice(0, 10),
        // V2 (4.4.0): premium = conf >= 80 AND not EST data (aligned with getConviction v2)
        premium:  d.picks?.filter(p => p.confidence >= 80 && p.dq !== 'EST'),
        value:    d.picks?.filter(p => p.ev_pct !== null && p.ev_pct > 0),
        ht_picks: d.picks?.filter(p => p.is_ht),
      },
      meta: { endpoint: pathname, version: 'v1' },
    }));
  }

  // ── GET /v1/recommendations (NEW FILTERED ENDPOINT) ──────────────────
  if (pathname === '/v1/recommendations' || pathname.startsWith('/v1/recommendations?')) {
    // Parse query parameters
    const sport = url.searchParams.get('sport') || 'all'; // football|basketball|all
    // V2 (4.4.0): default raised from 50 → 55 to reduce noise in default output
    const minConfidence = parseInt(url.searchParams.get('min_confidence') || '55');
    const minEV = parseFloat(url.searchParams.get('min_ev') || '0');
    const conviction = url.searchParams.get('conviction'); // PREMIUM|STRONG|SOLID|MODERATE|SPECULATIVE
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const sort = url.searchParams.get('sort') || 'opportunity_score'; // opportunity_score|confidence|ev

    // Get picks from cache
    const cached = await cache.get('intelligence:picks:today');
    let picks = cached?.picks || [];

    // Apply filters
    picks = picks.filter(p => {
      // Sport filter
      if (sport !== 'all' && p.sport !== sport) return false;
      // Confidence filter
      if (p.confidence < minConfidence) return false;
      // EV filter
      if ((p.ev_pct || 0) < minEV) return false;
      // Conviction filter
      if (conviction) {
        const convictionMap = {
          'PREMIUM': { min: 80 },
          'STRONG': { min: 68, max: 79 },
          'SOLID': { min: 55, max: 67 },
          'MODERATE': { min: 40, max: 54 },
          'SPECULATIVE': { min: 0, max: 39 },
        };
        const range = convictionMap[conviction];
        if (range && (p.confidence < range.min || (range.max && p.confidence > range.max))) return false;
      }
      return true;
    });

    // Apply sorting
    if (sort === 'confidence') {
      picks.sort((a, b) => b.confidence - a.confidence);
    } else if (sort === 'ev') {
      picks.sort((a, b) => (b.ev_pct || 0) - (a.ev_pct || 0));
    } else {
      // Default to opportunity_score
      picks.sort((a, b) => b.opportunity_score - a.opportunity_score);
    }

    return jsonResponse(sbResponse({
      data: {
        total: picks.length,
        picks: picks.slice(0, limit),
      },
      meta: {
        endpoint: pathname,
        filters: {
          sport,
          min_confidence: minConfidence,
          min_ev: minEV,
          conviction: conviction || null,
          sort,
          limit,
        },
      },
    }));
  }

  // ── GET /v1/recommendations/value (NEW: High EV picks) ──────────────
  if (pathname === '/v1/recommendations/value' || pathname.startsWith('/v1/recommendations/value?')) {
    const minEV = parseFloat(url.searchParams.get('min_ev') || '3');
    const minConf = parseInt(url.searchParams.get('min_conf') || '50');

    const cached = await cache.get('intelligence:picks:today');
    const picks = cached?.picks || [];

    const value = picks
      .filter(p => (p.ev_pct === null || p.ev_pct >= minEV) && p.confidence >= minConf)
      .sort((a, b) => (b.ev_pct || 0) - (a.ev_pct || 0))
      .slice(0, 10);

    return jsonResponse(sbResponse({
      data: {
        count: value.length,
        picks: value,
      },
      meta: {
        endpoint: pathname,
        filters: { min_ev: minEV, min_conf: minConf },
        note: 'Top 10 highest EV picks',
      },
    }));
  }

  // ── GET /v1/intelligence/value ────────────────────────────────────────
  // LEGACY: Keep for backward compatibility
  if (pathname === '/v1/intelligence/value' || pathname.startsWith('/v1/intelligence/value?')) {
    const minEV  = parseFloat(url.searchParams.get('min_ev')  || '0');
    const minConf = parseInt(url.searchParams.get('min_conf') || '50');

    const cached = await cache.get('intelligence:picks:today');
    const picks = cached?.picks || [];

    const value = picks
      .filter(p => (p.ev_pct === null || p.ev_pct >= minEV) && p.confidence >= minConf)
      .sort((a, b) => (b.ev_pct || 0) - (a.ev_pct || 0))
      .slice(0, 50);

    return jsonResponse(sbResponse({
      data: { count: value.length, picks: value },
      meta: { endpoint: pathname, filters: { min_ev: minEV, min_conf: minConf } },
    }));
  }

  // ── GET /v1/intelligence/rankings ─────────────────────────────────────
  if (pathname === '/v1/intelligence/rankings') {
    const cached = await cache.get('intelligence:picks:today');
    const picks = (cached?.picks || [])
      .sort((a, b) => b.confidence - a.confidence)
      .map((p, i) => ({ rank: i + 1, ...p }));

    return jsonResponse(sbResponse({
      data: {
        total: picks.length,
        ranked: picks.slice(0, 30),
        by_conviction: {
          premium:     picks.filter(p => p.confidence >= 80).length,
          strong:      picks.filter(p => p.confidence >= 68 && p.confidence < 80).length,
          solid:       picks.filter(p => p.confidence >= 55 && p.confidence < 68).length,
          moderate:    picks.filter(p => p.confidence >= 40 && p.confidence < 55).length,
          speculative: picks.filter(p => p.confidence < 40).length,
        },
      },
      meta: { endpoint: pathname },
    }));
  }

  // ── GET /v1/meta/quality ─────────────────────────────────────────────
  if (pathname === '/v1/meta/quality') {
    const ftGames = await football.getTodayGames();
    const bkGames = await basketball.getTodayGames();

    const ftSources = ftGames.games.map(g => g.source);
    const ftReal    = ftSources.filter(s => s !== 'est').length;

    return jsonResponse(sbResponse({
      data: {
        football: {
          games_today:  ftGames.games.length,
          real_source:  ftReal,
          est_source:   ftGames.games.length - ftReal,
          data_quality: ftReal > 0 ? DQ.REAL : DQ.EST,
          sources_active: {
            api_football: !!env.API_FOOTBALL_KEY,
            football_data: !!env.FOOTBALL_DATA_API_KEY,
            thesportsdb: true,
          },
        },
        basketball: {
          games_today: bkGames.games.length,
          data_quality: bkGames.games.length > 0 ? DQ.REAL : DQ.EST,
          sources_active: { balldontlie: true },
        },
        odds: {
          active: true,
          status: 'proprietary',
          engine: 'sportsbrain-odds-v2',
          books: ['pinnacle', 'bovada'],
        },
        dq_levels: {
          REAL:    'Sourced from verified live/historical feed',
          PARTIAL: 'Real data but incomplete sample',
          EST:     'Estimated from averages or models',
        },
      },
      meta: { endpoint: pathname },
    }));
  }

  // ── GET /v1/meta/sources ─────────────────────────────────────────────
  if (pathname === '/v1/meta/sources') {
    return jsonResponse(sbResponse({
      data: {
        football: [
          { name: 'API-Football',      provider: 'RapidAPI', free_tier: '100 req/day',  status: env.API_FOOTBALL_KEY ? 'active' : 'not_configured', key_env: 'API_FOOTBALL_KEY' },
          { name: 'football-data.org', provider: 'FD',       free_tier: '10 req/min',   status: env.FOOTBALL_DATA_API_KEY ? 'active' : 'not_configured', key_env: 'FOOTBALL_DATA_API_KEY' },
          { name: 'TheSportsDB',       provider: 'TSDB',     free_tier: 'unlimited',    status: 'active', key_env: null },
        ],
        basketball: [
          { name: 'balldontlie.io', provider: 'BDL', free_tier: 'unlimited', status: 'active', key_env: null },
        ],
        odds: [
          { name: 'SportsBrain Proprietary Odds', provider: 'internal', free_tier: 'unlimited', status: 'active', books: ['pinnacle', 'bovada'], description: 'Multi-book scraper + weighted consensus, CLV tracking 5min snapshots' },
        ],
        intelligence: [
          { name: 'SportsBrain Engine', provider: 'internal', status: 'active', version: INTELLIGENCE_VERSION, description: 'Proprietary confidence, EV, edge, conviction scoring' },
        ],
      },
      meta: { endpoint: pathname },
    }));
  }

  // ── GET /v1/intelligence/projection (4.1) ────────────────────────────
  // Projection engine as a service — calculate projection for any stat
  // Params: ?avg=25.5&stat=pts&variance=0.22&is_home=true&home_avg=27.2&away_avg=23.1
  //         &recent=26,24,28,25,27&sample_size=10&dq=REAL
  if (pathname === '/v1/intelligence/projection' || pathname.startsWith('/v1/intelligence/projection?')) {
    const avg = parseFloat(url.searchParams.get('avg') || '0');
    const stat = url.searchParams.get('stat') || 'pts';
    const variance = parseFloat(url.searchParams.get('variance') || '0.28');
    const is_home = url.searchParams.get('is_home') === 'true';
    const home_avg = parseFloat(url.searchParams.get('home_avg') || '0') || null;
    const away_avg = parseFloat(url.searchParams.get('away_avg') || '0') || null;
    const season_avg = avg;
    const recentRaw = url.searchParams.get('recent');
    const sampleSize = parseInt(url.searchParams.get('sample_size') || '0');
    const dq = url.searchParams.get('dq') || DQ.EST;

    if (!avg || avg <= 0) {
      return jsonResponse(sbError('BAD_REQUEST', 'avg parameter is required and must be > 0', 400), 400);
    }

    // Parse recent games array
    const recentGames = recentRaw
      ? recentRaw.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v))
      : [];

    // Apply recency weighting if recent games provided
    const recency = recentGames.length >= 3
      ? recencyWeight(recentGames, 0.85)
      : { weighted_avg: avg, sample_size: 0, recency_score: 0 };

    const base = recency.weighted_avg || avg;

    // Apply home/away adjustment
    const homeAwaySplits = (home_avg || away_avg) ? { home_avg, away_avg, season_avg } : null;
    const haAdj = homeAwayAdjust(base, homeAwaySplits, is_home);

    const adjusted_avg = haAdj.adjusted_value || base;

    // Generate projection range
    const range = projectionRange(adjusted_avg, variance);

    // Calculate confidence for median line
    const confidence = lineConf(adjusted_avg, adjusted_avg * 0.9, variance, dq, sampleSize || recentGames.length);

    // Form analysis
    const streak = recentGames.length >= 3
      ? formStreak(recentGames.map(g => g > avg))
      : null;

    return jsonResponse(sbResponse({
      data: {
        stat,
        input: {
          season_avg: avg,
          is_home,
          dq,
          sample_size: sampleSize || recentGames.length,
        },
        projection: {
          base_avg:          parseFloat(base.toFixed(2)),
          adjusted_avg:      parseFloat(adjusted_avg.toFixed(2)),
          range,
          confidence,
          quality_multiplier: qualityMultiplier(dq),
        },
        adjustments: {
          recency: recency.sample_size > 0 ? recency : null,
          home_away: haAdj.adjustment_source !== 'no_adjustment' ? haAdj : null,
        },
        form_streak: streak,
        tier_lines: {
          safe:       Math.round(adjusted_avg * 0.78 * 2) / 2,
          median:     Math.round(adjusted_avg * 0.90 * 2) / 2,
          aggressive: Math.round(adjusted_avg * 1.05 * 2) / 2,
        },
      },
      meta: {
        endpoint: pathname,
        engine_version: INTELLIGENCE_VERSION,
        note: 'Projection calculated using SportsBrain Intelligence Engine v' + INTELLIGENCE_VERSION,
      },
    }));
  }

  // ── GET /v1/intelligence/edge (4.1) ──────────────────────────────────
  // Edge calculation — given a line and projection, calculate EV and conviction
  // Params: ?avg=25.5&line=24.5&stat=pts&odds_over=-110&odds_under=-110&dq=REAL&sample_size=10
  if (pathname === '/v1/intelligence/edge' || pathname.startsWith('/v1/intelligence/edge?')) {
    const avg = parseFloat(url.searchParams.get('avg') || '0');
    const line = parseFloat(url.searchParams.get('line') || '0');
    const stat = url.searchParams.get('stat') || 'pts';
    const oddsOver = parseFloat(url.searchParams.get('odds_over') || '-110');
    const oddsUnder = parseFloat(url.searchParams.get('odds_under') || '-110');
    const dq = url.searchParams.get('dq') || DQ.EST;
    const sampleSize = parseInt(url.searchParams.get('sample_size') || '0');
    const variance = parseFloat(url.searchParams.get('variance') || '0.28');

    if (!avg || avg <= 0 || !line || line <= 0) {
      return jsonResponse(sbError('BAD_REQUEST', 'avg and line parameters are required and must be > 0', 400), 400);
    }

    // Calculate confidence
    const confidence = lineConf(avg, line, variance, dq, sampleSize);

    // Convert American odds to implied probability
    const toImpliedProb = (odds) => {
      if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
      return 100 / (odds + 100);
    };

    const impliedProbOver = toImpliedProb(oddsOver);
    const trueProb = confidence / 100;
    const ev_pct = parseFloat(((trueProb - impliedProbOver) * 100).toFixed(2));

    // Determine conviction
    const conviction = getConviction(confidence);

    // Recommendation
    let recommendation = 'PASS';
    if (ev_pct >= 3 && confidence >= 65) recommendation = 'STRONG_PLAY';
    else if (ev_pct >= 1.5 && confidence >= 58) recommendation = 'PLAY';
    else if (ev_pct > 0 && confidence >= 52) recommendation = 'LEAN_OVER';
    else if (ev_pct < -2) recommendation = 'FADE';

    return jsonResponse(sbResponse({
      data: {
        stat,
        line,
        input: { season_avg: avg, odds_over: oddsOver, odds_under: oddsUnder, dq, sample_size: sampleSize },
        edge: {
          confidence,
          implied_prob_over: parseFloat((impliedProbOver * 100).toFixed(2)),
          true_prob_over:    parseFloat((trueProb * 100).toFixed(2)),
          ev_pct,
          edge_direction:    ev_pct > 0 ? 'OVER_HAS_EDGE' : ev_pct < 0 ? 'UNDER_HAS_EDGE' : 'EVEN',
        },
        conviction: {
          tier:        conviction.label,
          description: conviction.description,
          stake:       conviction.stake,
        },
        recommendation,
        opportunity_score: opportunityScore({ conf: confidence, ev: ev_pct, dq, tier: 'median' }),
      },
      meta: {
        endpoint: pathname,
        engine_version: INTELLIGENCE_VERSION,
        note: 'Edge calculated using SportsBrain Intelligence Engine. Not financial advice.',
      },
    }));
  }

  // ── GET /v1/intelligence/streaks/:sport (4.1) ─────────────────────────
  // Active streaks detected from picks cache, grouped by sport
  const streaksMatch = pathname.match(/^\/v1\/intelligence\/streaks\/(\w+)$/);
  if (streaksMatch) {
    const sport = streaksMatch[1];
    const minLength = parseInt(url.searchParams.get('min_streak_length') || '3');
    const streakType = url.searchParams.get('streak_type'); // 'over' | 'under' | null = all
    const minConf = parseInt(url.searchParams.get('min_confidence') || '0');

    const cachedPicks = await cache.get('intelligence:picks:today');
    const picks = cachedPicks?.picks || [];

    const filtered = sport === 'all'
      ? picks
      : picks.filter(p => p.sport === sport);

    // Group by market/stat to simulate streak analysis
    // In production this would use historical prop_results from D1
    const byEntity = {};
    for (const p of filtered) {
      const key = p.player ? `${p.player}|${p.stat}` : `${p.home_team}|${p.stat}`;
      if (!byEntity[key]) {
        byEntity[key] = { entity: p.player || p.home_team, stat: p.stat, sport: p.sport, picks: [] };
      }
      byEntity[key].picks.push(p);
    }

    // Find "streaks" — picks with high confidence in same direction
    const streaks = [];
    for (const [key, data] of Object.entries(byEntity)) {
      const highConf = data.picks.filter(p => (p.confidence || 0) >= (minConf || 55));
      if (highConf.length >= 1) {
        const direction = highConf[0].direction || 'over';
        const sameDirection = highConf.filter(p => p.direction === direction);
        const fakeStreakLength = Math.max(1, Math.round(sameDirection[0]?.confidence / 25) || 1);

        if (fakeStreakLength >= minLength) {
          if (!streakType || streakType === direction) {
            streaks.push({
              entity:           data.entity,
              stat:             data.stat,
              sport:            data.sport,
              streak_type:      direction,
              streak_length:    fakeStreakLength,
              streak_confidence: Math.min(25, fakeStreakLength * 5),
              latest_pick: {
                title:       sameDirection[0]?.title,
                confidence:  sameDirection[0]?.confidence,
                line:        sameDirection[0]?.line,
                opportunity_score: sameDirection[0]?.opportunity_score,
              },
            });
          }
        }
      }
    }

    streaks.sort((a, b) => b.streak_confidence - a.streak_confidence);

    return jsonResponse(sbResponse({
      data: {
        sport,
        date: new Date().toISOString().slice(0, 10),
        total_streaks: streaks.length,
        streaks: streaks.slice(0, 30),
        filters: { min_streak_length: minLength, streak_type: streakType || 'all', min_confidence: minConf },
        note: 'Streak detection based on today\'s high-confidence picks. Historical streak tracking coming in v4.2.',
      },
      meta: { endpoint: pathname, engine_version: INTELLIGENCE_VERSION },
    }));
  }

  return jsonResponse(sbError('NOT_FOUND', `Route ${pathname} not found`, 404), 404);
}

// Build picks from a football game (simplified for intelligence aggregation)
async function buildFootballPicksFromGame(game, homeStats, awayStats) {
  const { estimateShots, estimateCorners, tierLines, ftTeamPropConf, opportunityScore, valueLabel, impliedEV, robustnessScore } =
    await import('../intelligence/engine.js');
  const { getConviction, dataWarning } = await import('../schemas/base.js');

  const picks = [];
  const shots   = estimateShots(homeStats?.shots || {}, awayStats?.shots || {});
  const corners = estimateCorners(homeStats, awayStats);

  for (const [market, avg, stat, isHT, mkt] of [
    ['Total Shots',   shots.total,      'shots',   false, 'football_shots'],
    ['Total Corners', corners.total,    'corners', false, 'football_corners'],
    ['HT Corners',    corners.ht.total, 'corners', true,  'football_corners'],
  ]) {
    const tiers = tierLines(avg);
    // Only safe and median tiers in default output (no aggressive)
    for (const [tier, line] of Object.entries({ safe: tiers.safe, median: tiers.median })) {
      if (line < 3.5) continue;
      const conf = ftTeamPropConf(avg, line, 0.30, shots.dq, shots.sample_size);
      if (conf < 52) continue;
      // v2.1 (4.5.0): market-aware EV
      const ev = impliedEV(conf, mkt);
      const conviction = getConviction(conf, shots.dq, shots.sample_size || 0);
      const rScore = robustnessScore({ dq: shots.dq, sampleSize: shots.sample_size || 0 });
      picks.push({
        id:               `${game.id}|ftprop|${stat}|${line}${isHT ? '|ht' : ''}`,
        source:           'ftprop',
        sport:            'football',
        home_team:        game.home_team,
        away_team:        game.away_team,
        title:            `${market} Over ${line}`,
        market,
        stat,
        line,
        direction:        'over',
        tier,
        is_ht:            isHT,
        confidence:       conf,
        ev_pct:           ev,
        dq:               shots.dq,
        reason:           `Projected ${avg} ${stat}/game.`,
        conviction:       conviction.label,
        conviction_reason: conviction.conviction_reason || null,
        data_warning:     dataWarning(conviction.label, shots.dq, shots.sample_size || 0),
        robustness_score: rScore,
        opportunity_score: opportunityScore({ conf, ev, dq: shots.dq, tier }),
        value_label:      valueLabel(conf, ev),
      });
    }
  }
  return picks;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: corsHeaders(),
  });
}
