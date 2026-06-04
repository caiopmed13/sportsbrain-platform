/**
 * Analytics Routes — SportsBrain Data API v1
 * ────────────────────────────────────────────
 * GET /v1/analytics/team/:team_id      — team analytical profile
 * GET /v1/analytics/player/:player_id  — player analytical profile
 * GET /v1/analytics/performance/me     — my API key performance metrics
 *
 * This is the premium analytics layer — the highest-value tier.
 * Provides deep historical profiles, accountability metrics and
 * long-term pattern analysis that goes beyond day-of picks.
 */

import { sbResponse, sbError, DQ } from '../schemas/base.js';
import { recencyWeight, projectionRange, formStreak, opportunityScore } from '../intelligence/engine.js';
import { corsHeaders } from './health.js';

export async function handleAnalytics(pathname, request, env, services) {
  const { cache, football, basketball } = services;
  const url = new URL(request.url);

  // ── GET /v1/analytics/team/:team_id ────────────────────────────────────
  // Full analytical profile for a team
  const teamMatch = pathname.match(/^\/v1\/analytics\/team\/(.+)$/);
  if (teamMatch) {
    const team_id = decodeURIComponent(teamMatch[1]);
    const sport = url.searchParams.get('sport') || 'football';

    try {
      let teamStats = null;
      let analyticsProfile = null;

      if (sport === 'football') {
        teamStats = await football.getTeamStats(team_id);

        if (teamStats) {
          const shots = teamStats.shots_per_game || 6.5;
          const corners = teamStats.corners?.per_game || 5.0;
          const goals = teamStats.goals?.per_game || 1.4;

          analyticsProfile = {
            team:  team_id,
            sport: 'football',
            summary: {
              data_quality: teamStats.source === 'real' ? DQ.REAL : DQ.EST,
              games_analyzed: teamStats.games?.played || 0,
              data_source: teamStats.source || 'est',
            },
            attack: {
              shots_per_game:    parseFloat(shots.toFixed(2)),
              shots_on_target:   teamStats.shots?.on_target || null,
              goals_per_game:    parseFloat(goals.toFixed(2)),
              corners_per_game:  parseFloat(corners.toFixed(2)),
              btts_rate:         teamStats.both_teams_score_pct || null,
              over_2_5_rate:     teamStats.over_2_5_goals_pct || null,
            },
            defense: {
              shots_allowed_pg:  teamStats.shots_allowed_pg || null,
              goals_allowed_pg:  teamStats.goals?.allowed_pg || null,
            },
            projections: {
              shots_range:   projectionRange(shots, 0.22),
              goals_range:   projectionRange(goals, 0.35),
              corners_range: projectionRange(corners, 0.28),
            },
            tier_lines: {
              shots:   { safe: Math.round(shots * 0.72 * 2) / 2, median: Math.round(shots * 0.88 * 2) / 2 },
              corners: { safe: Math.round(corners * 0.72 * 2) / 2, median: Math.round(corners * 0.88 * 2) / 2 },
            },
          };
        }
      } else if (sport === 'basketball') {
        teamStats = await basketball.getTeamStats(team_id);

        if (teamStats) {
          const pts = teamStats.season_averages?.points || 110;
          const reb = teamStats.season_averages?.rebounds || 44;
          const ast = teamStats.season_averages?.assists || 25;

          analyticsProfile = {
            team:  team_id,
            sport: 'basketball',
            summary: {
              data_quality: teamStats.source ? DQ.PARTIAL : DQ.EST,
              data_source: teamStats.source || 'est',
            },
            offense: {
              points_per_game:   pts,
              rebounds_per_game: reb,
              assists_per_game:  ast,
              field_goal_pct:    teamStats.season_averages?.field_goal_pct || null,
              three_point_pct:   teamStats.season_averages?.three_point_pct || null,
            },
            projections: {
              points_range:   projectionRange(pts, 0.10),
              total_range:    projectionRange(pts * 2, 0.08),
            },
            tier_lines: {
              points:  { safe: Math.round(pts * 0.94 * 2) / 2, median: Math.round(pts * 0.97 * 2) / 2 },
              total:   { safe: Math.round(pts * 1.88 * 2) / 2, median: Math.round(pts * 1.94 * 2) / 2 },
            },
          };
        }
      }

      if (!analyticsProfile) {
        return jsonResponse(sbResponse({
          data: {
            team: team_id,
            sport,
            message: 'Team data not available. Profile is generated from available stats.',
            fallback_profile: {
              team: team_id,
              sport,
              data_quality: DQ.EST,
              note: 'No real data found. Projections are based on league averages.',
            },
          },
          meta: { endpoint: pathname },
        }));
      }

      return jsonResponse(sbResponse({
        data: analyticsProfile,
        meta: { endpoint: pathname, sport },
      }));
    } catch (e) {
      console.error('[Analytics] team profile failed:', e.message);
      return jsonResponse(sbError('INTERNAL_ERROR', 'Failed to generate team profile', 500), 500);
    }
  }

  // ── GET /v1/analytics/player/:player_id ───────────────────────────────
  // Full analytical profile for a player
  const playerMatch = pathname.match(/^\/v1\/analytics\/player\/(.+)$/);
  if (playerMatch) {
    const player_id = decodeURIComponent(playerMatch[1]);
    const sport = url.searchParams.get('sport') || 'basketball';
    const stat = url.searchParams.get('stat') || 'points';

    try {
      if (sport === 'basketball') {
        const playerData = await basketball.getPlayerStats(player_id);

        if (!playerData || !playerData.player) {
          return jsonResponse(sbResponse({
            data: {
              player_id,
              message: 'Player not found.',
              suggestion: 'Try the exact player name (e.g., LeBron James) or NBA player ID.',
            },
            meta: { endpoint: pathname },
          }));
        }

        const avg = playerData.averages?.[stat] ||
                    playerData.averages?.points || 0;

        const statVariance = {
          points:  0.22, rebounds: 0.28, assists: 0.32,
          steals:  0.45, blocks:   0.50,
        }[stat] || 0.28;

        // Simulated recent games for demonstration
        // In production these would come from real boxscore history
        const recentGames = playerData.recent_games || [];
        const recencyAnalysis = recentGames.length > 0
          ? recencyWeight(recentGames, 0.85)
          : { weighted_avg: avg, sample_size: 0, recency_score: 0 };

        const streak = recencyAnalysis.sample_size >= 3
          ? formStreak(recentGames.map(g => g > avg))
          : { streak_type: 'insufficient_data', streak_length: 0, streak_confidence: 0 };

        const profile = {
          player:   playerData.player,
          sport:    'basketball',
          stat_analyzed: stat,
          summary: {
            season_avg:      avg,
            data_quality:    playerData.quality?.level || DQ.EST,
            games_analyzed:  playerData.averages?.games_played || 0,
          },
          projections: {
            base_projection:   avg,
            range:             projectionRange(avg, statVariance),
            recency_adjusted:  recencyAnalysis.weighted_avg,
            recency_score:     recencyAnalysis.recency_score,
          },
          form_analysis: streak,
          tier_lines: {
            safe:       Math.round(avg * 0.78 * 2) / 2,
            median:     Math.round(avg * 0.90 * 2) / 2,
            aggressive: Math.round(avg * 1.05 * 2) / 2,
          },
          opportunity_score: opportunityScore({
            conf: Math.min(80, 50 + recencyAnalysis.recency_score * 0.3),
            ev:   null,
            dq:   playerData.quality?.level || DQ.EST,
            tier: 'median',
            streak_confidence: streak.streak_confidence,
          }),
          availability: playerData.availability || { status: 'unknown' },
          usage:        playerData.usage || null,
        };

        return jsonResponse(sbResponse({
          data: profile,
          meta: { endpoint: pathname, sport, stat },
        }));
      }

      return jsonResponse(sbError('BAD_REQUEST', `Sport ${sport} not yet supported for player analytics`, 400), 400);
    } catch (e) {
      console.error('[Analytics] player profile failed:', e.message);
      return jsonResponse(sbError('INTERNAL_ERROR', 'Failed to generate player profile', 500), 500);
    }
  }

  // ── GET /v1/analytics/performance/me ──────────────────────────────────
  // API key performance accountability — how good are my picks?
  if (pathname === '/v1/analytics/performance/me') {
    const apiKey = request.headers.get('X-SB-Key') ||
                   new URL(request.url).searchParams.get('key');

    if (!apiKey) {
      return jsonResponse(sbResponse({
        data: {
          message: 'Provide your API key via X-SB-Key header or ?key= param to see your performance metrics.',
          sample_metrics: {
            total_picks_consumed: 0,
            markets_tracked:      0,
            avg_confidence:       0,
            note:                 'Performance tracking begins when you start consuming picks.',
          },
        },
        meta: { endpoint: pathname },
      }));
    }

    try {
      // Query api_usage_log for this key's stats
      const stmt = env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total_requests,
          SUM(CASE WHEN endpoint LIKE '%picks%' OR endpoint LIKE '%recommendations%' THEN 1 ELSE 0 END) as pick_requests,
          SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) as successful_requests,
          AVG(response_time_ms) as avg_response_time,
          MIN(recorded_at) as first_request,
          MAX(recorded_at) as last_request,
          COUNT(DISTINCT DATE(recorded_at)) as active_days
        FROM api_usage_log
        WHERE api_key_hash = ?
          AND recorded_at > datetime('now', '-30 days')
      `);

      const simpleHash = (str) => {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
          h = ((h << 5) - h) + str.charCodeAt(i);
          h |= 0;
        }
        return Math.abs(h).toString(36);
      };

      const result = await stmt.bind(simpleHash(apiKey)).first();

      return jsonResponse(sbResponse({
        data: {
          period: 'last_30_days',
          usage: {
            total_requests:    result?.total_requests || 0,
            pick_requests:     result?.pick_requests || 0,
            successful:        result?.successful_requests || 0,
            avg_response_time_ms: result?.avg_response_time ? parseFloat(result.avg_response_time.toFixed(0)) : null,
            active_days:       result?.active_days || 0,
            first_request:     result?.first_request || null,
            last_request:      result?.last_request || null,
          },
          performance: {
            hit_tracking_status: 'pending',
            note: 'Hit rate tracking activates after prop results are recorded. Coming in v4.2.',
            roi_estimate:   null,
            win_rate:       null,
            clv_avg:        null,
          },
        },
        meta: { endpoint: pathname },
      }));
    } catch (e) {
      console.error('[Analytics] performance/me failed:', e.message);
      return jsonResponse(sbError('INTERNAL_ERROR', 'Failed to fetch performance data', 500), 500);
    }
  }

  return jsonResponse(sbError('NOT_FOUND', `Route ${pathname} not found`, 404), 404);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: corsHeaders(),
  });
}
