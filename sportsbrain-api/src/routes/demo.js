/**
 * Demo Route — SportsBrain Data API v1
 * ──────────────────────────────────────
 * GET /v1/demo        — fully structured mock response, no auth required
 * GET /v1/demo/game   — mock game with all 4.1 fields
 * GET /v1/demo/player — mock player with analytics profile
 * GET /v1/demo/edge   — mock edge calculation result
 *
 * This endpoint exists for developer onboarding.
 * A developer can explore the FULL schema of every response type
 * without creating an account or entering a credit card.
 *
 * Zero friction entry = more developers in the funnel.
 */

import { corsHeaders } from './health.js';
import { INTELLIGENCE_VERSION } from '../intelligence/engine.js';

const DEMO_TAG = { demo: true, note: 'This is mock data for exploration only. Sign up at sportsbrain.io/api for real data.' };

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders(), 'X-SB-Demo': 'true', 'X-SB-Version': '4.5.0' },
  });
}

export function handleDemo(pathname) {

  const meta = (ep) => ({
    api_version:    'v1',
    generated_at:   new Date().toISOString(),
    source:         'SportsBrain Data API',
    endpoint:       ep,
    engine_version: INTELLIGENCE_VERSION,
    demo_mode:      true,
    signup_url:     'https://sportsbrain.io/api/signup',
    docs_url:       'https://sportsbrain.io/api/docs',
  });

  // ── GET /v1/demo ─────────────────────────────────────────────────────
  if (pathname === '/v1/demo') {
    return jsonResponse({
      ok: true,
      version: 'v1',
      timestamp: new Date().toISOString(),
      meta: meta('/v1/demo'),
      data: {
        ...DEMO_TAG,
        description:  'SportsBrain Data API — Demo Mode. Explore all endpoint schemas below.',
        endpoints: {
          demo_game:   'GET /v1/demo/game   — mock NBA game with full 4.1 schema',
          demo_player: 'GET /v1/demo/player — mock player profile with analytics',
          demo_edge:   'GET /v1/demo/edge   — mock edge calculation',
          real_status: 'GET /v1/status      — live API status (no key needed)',
          real_picks:  'GET /v1/intelligence/picks/today (requires free API key)',
        },
        getting_started: {
          step_1: 'Explore the /v1/demo/* endpoints to understand the schema',
          step_2: 'Sign up at sportsbrain.io/api for a free API key (no credit card)',
          step_3: 'Use X-SB-Key header or ?key= param on all authenticated endpoints',
          step_4: 'Start with /v1/intelligence/picks/today for immediate value',
        },
        tiers: {
          free:       { price: '$0/mo', rate_limit: '100 req/hr', modules: ['football', 'basketball'], picks_per_day: 'today\'s picks' },
          starter:    { price: '$29/mo', rate_limit: '1000 req/hr', modules: ['football', 'basketball', 'market'], picks_per_day: 'all picks + filters' },
          pro:        { price: '$99/mo', rate_limit: '10000 req/hr', modules: 'all', picks_per_day: 'all + edge + projections + analytics' },
          enterprise: { price: 'custom', rate_limit: 'unlimited', modules: 'all + white-label', sla: '99.9% uptime' },
        },
      },
    });
  }

  // ── GET /v1/demo/game ───────────────────────────────────────────────
  if (pathname === '/v1/demo/game') {
    return jsonResponse({
      ok: true,
      version: 'v1',
      timestamp: new Date().toISOString(),
      meta: meta('/v1/demo/game'),
      data: {
        ...DEMO_TAG,
        game: {
          id: 'demo_game_001',
          home_team: 'Boston Celtics',
          away_team: 'Los Angeles Lakers',
          home_team_id: 2,
          away_team_id: 14,
          date: new Date().toISOString().slice(0, 10),
          tip_off: '19:30',
          status: 'scheduled',
          score: { home: 0, away: 0, period: 0, time: null },
          arena: 'TD Garden',
          season: 2025,
          source: 'balldontlie',
          quality: {
            level: 'REAL', data_status: 'recent', integrity_score: 92,
            source_reliability: 'HIGH', sample_size: 68,
          },
          context: {
            is_playoff: false, is_neutral_venue: false,
            is_rivalry: true, is_revenge_game: false,
            weather: null,
            head_to_head: { last_5_h2h: '3-2 BOS', last_meeting: '2025-12-14', avg_total: 223.5 },
          },
          pace_context: {
            expected_pace: 101.2,
            over_under: 220.5,
            total_projection: { low: 208.5, median: 221.0, high: 234.5, spread: 26.0 },
          },
          props: [
            {
              id: 'demo_prop_001',
              player_name: 'Jayson Tatum',
              team: 'BOS',
              stat: 'points',
              stat_label: 'Points',
              line: 27.5,
              direction: 'over',
              tier: 'median',
              confidence: 68,
              dataQuality: 'REAL',
              reason: 'Season avg 29.2pts. Recency-adjusted 30.1. Strong home advantage (factor 1.08).',
              projection_range: { low: 21.9, median: 29.2, high: 36.5, spread: 14.6 },
              line_movement: {
                opened_at: '2025-01-02T09:00:00Z', current_line: 27.5,
                high: 28.0, low: 27.0,
                movement_direction: 'down', movement_pct: -1.8,
                snapshots_count: 12, last_snapshot_at: '2025-01-03T18:00:00Z',
              },
              matchup_context: {
                opponent_rank_vs_position: 28,
                opponent_allows_stat_avg: 31.4,
                matchup_advantage: 'FAVORABLE',
              },
              opportunity_score: 72,
              value_label: 'STRONG',
            },
          ],
        },
      },
    });
  }

  // ── GET /v1/demo/player ─────────────────────────────────────────────
  if (pathname === '/v1/demo/player') {
    return jsonResponse({
      ok: true,
      version: 'v1',
      timestamp: new Date().toISOString(),
      meta: meta('/v1/demo/player'),
      data: {
        ...DEMO_TAG,
        player: {
          id: 'demo_player_001',
          first_name: 'LeBron',
          last_name: 'James',
          team: 'Los Angeles Lakers',
          position: 'F',
          height: '6-9',
          weight: 250,
          season_averages: {
            points: 25.1, rebounds: 7.4, assists: 8.2,
            steals: 1.3, blocks: 0.6, turnovers: 3.5,
            minutes: 35.2, field_goal_pct: 0.524, three_point_pct: 0.411,
            free_throw_pct: 0.737, field_goal_attempts: 18.2, field_goal_made: 9.5,
            games_played: 52,
          },
          availability: {
            status: 'available',
            injury_type: null, injury_body_part: null,
            return_date: null, source: 'balldontlie',
          },
          usage: { usage_rate: 0.296, minutes_trend: 'stable', role: 'primary_scorer' },
          analytics_profile: {
            stat_analyzed: 'points',
            projection: {
              base_avg: 25.1,
              adjusted_avg: 26.8,
              range: { low: 18.1, median: 25.1, high: 32.1, spread: 14.0 },
              recency_adjusted: 26.8,
              recency_score: 75,
            },
            form_streak: { streak_type: 'over', streak_length: 5, streak_confidence: 25 },
            tier_lines: { safe: 19.5, median: 22.5, aggressive: 26.5 },
            opportunity_score: 74,
          },
        },
      },
    });
  }

  // ── GET /v1/demo/edge ────────────────────────────────────────────────
  if (pathname === '/v1/demo/edge') {
    return jsonResponse({
      ok: true,
      version: 'v1',
      timestamp: new Date().toISOString(),
      meta: meta('/v1/demo/edge'),
      data: {
        ...DEMO_TAG,
        description: 'Edge calculation from GET /v1/intelligence/edge?avg=25.1&line=24.5&stat=pts&odds_over=-110&dq=REAL&sample_size=52',
        edge: {
          stat: 'points',
          line: 24.5,
          input: {
            season_avg: 25.1, odds_over: -110, odds_under: -110,
            dq: 'REAL', sample_size: 52,
          },
          edge_result: {
            confidence: 71,
            implied_prob_over: 52.38,
            true_prob_over: 71.0,
            ev_pct: 18.62,
            edge_direction: 'OVER_HAS_EDGE',
          },
          conviction: {
            tier: 'STRONG', description: 'High confidence play — 2-3% bankroll',
            stake: '2-3 units',
          },
          recommendation: 'STRONG_PLAY',
          opportunity_score: 78,
        },
      },
    });
  }

  return new Response(JSON.stringify({
    ok: false, error: 'NOT_FOUND',
    message: `Demo route ${pathname} not found. Try /v1/demo, /v1/demo/game, /v1/demo/player or /v1/demo/edge`,
  }), { status: 404, headers: corsHeaders() });
}
