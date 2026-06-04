/**
 * SportsBrain Data API 4.0 — Basketball / NBA Schemas
 * ───────────────────────────────────────────────────
 * Canonical data models for NBA player props and game data.
 */

import {
  makeQuality,
  makeOddsValue,
  makeLineMovement,
  makeContext,
  DATA_QUALITY,
  DQ,
  SOURCE_RELIABILITY,
} from './base.js';

// ── NBA Player ────────────────────────────────────────────────────────────
export function makeNBAPlayer({
  id = null,
  name,
  team,
  team_id = null,
  position = null,   // 'G' | 'F' | 'C' | 'G-F' | 'F-C'
  // Season averages (full names)
  points = null,
  rebounds = null,
  assists = null,
  steals = null,
  blocks = null,
  turnovers = null,
  minutes = null,
  field_goal_pct = null,
  three_point_pct = null,
  free_throw_pct = null,
  field_goal_attempts = null,
  field_goal_made = null,
  three_point_attempts = null,
  three_point_made = null,
  free_throw_attempts = null,
  free_throw_made = null,
  // Games data
  games_played = 0,
  games_started = 0,
  // Availability
  availability = null,  // { status, injury_type, injury_body_part, return_date, source }
  projected_minutes = null,
  is_b2b = false,
  // Usage and role
  usage = null,  // { usage_rate, minutes_trend, role }
  // Recent form (last 5)
  recent_pts = [],
  recent_reb = [],
  recent_ast = [],
  quality = {},
}) {
  const gpf = (v) => (v !== null ? parseFloat(v) : null);

  const defaultAvailability = {
    status: null,          // 'active' | 'questionable' | 'doubtful' | 'out' | 'gtd' | null
    injury_type: null,
    injury_body_part: null,
    return_date: null,
    source: null,
  };

  const defaultUsage = {
    usage_rate: null,
    minutes_trend: null,   // 'up' | 'down' | 'stable' | null
    role: null,            // 'starter' | 'rotation' | 'bench' | null
  };

  return {
    id,
    name,
    team,
    team_id,
    position,
    season_averages: {
      points: gpf(points),
      rebounds: gpf(rebounds),
      assists: gpf(assists),
      steals: gpf(steals),
      blocks: gpf(blocks),
      turnovers: gpf(turnovers),
      minutes: gpf(minutes),
      field_goal_pct: gpf(field_goal_pct),
      three_point_pct: gpf(three_point_pct),
      free_throw_pct: gpf(free_throw_pct),
      field_goal_attempts: gpf(field_goal_attempts),
      field_goal_made: gpf(field_goal_made),
      three_point_attempts: gpf(three_point_attempts),
      three_point_made: gpf(three_point_made),
      free_throw_attempts: gpf(free_throw_attempts),
      free_throw_made: gpf(free_throw_made),
    },
    games: { played: games_played, started: games_started },
    recent_form: {
      points: recent_pts.slice(-5),
      rebounds: recent_reb.slice(-5),
      assists: recent_ast.slice(-5),
    },
    availability: availability || defaultAvailability,
    usage: usage || defaultUsage,
    projected_minutes,
    is_b2b,
    quality: makeQuality({
      level: games_played >= 5 ? DATA_QUALITY.REAL : games_played >= 1 ? DATA_QUALITY.PARTIAL : DATA_QUALITY.EST,
      sourceReliability: games_played >= 10 ? SOURCE_RELIABILITY.HIGH : SOURCE_RELIABILITY.MEDIUM,
      sampleSize: games_played,
      ...quality,
    }),
  };
}

// ── NBA Team Stats ────────────────────────────────────────────────────────
export function makeNBATeamStats({
  name,
  abbreviation = null,
  conference = null,
  division = null,
  wins = 0,
  losses = 0,
  pts_per_game = null,
  opp_pts_per_game = null,
  reb_per_game = null,
  ast_per_game = null,
  pace = null,               // possessions per 48 min
  ortg = null,
  drtg = null,               // offensive/defensive rating
  ts_pct = null,             // true shooting %
  quality = {},
}) {
  return {
    name,
    abbreviation,
    conference,
    division,
    record: {
      wins,
      losses,
      pct: wins + losses > 0 ? parseFloat((wins / (wins + losses)).toFixed(3)) : null,
    },
    offense: { pts_per_game, ast_per_game, ortg },
    defense: { opp_pts_per_game, drtg },
    style: { pace, reb_per_game, ts_pct },
    pace_tier: pace ? (pace > 100 ? 'fast' : pace > 96 ? 'medium' : 'slow') : null,
    quality: makeQuality({
      level: wins + losses >= 10 ? DATA_QUALITY.REAL : wins + losses >= 5 ? DATA_QUALITY.PARTIAL : DATA_QUALITY.EST,
      sourceReliability: SOURCE_RELIABILITY.HIGH,
      sampleSize: wins + losses,
      ...quality,
    }),
  };
}

// ── NBA Game ──────────────────────────────────────────────────────────────
export function makeNBAGame({
  id,
  home_team,
  away_team,
  home_team_id = null,
  away_team_id = null,
  date,              // YYYY-MM-DD
  tip_off = null,    // ISO timestamp
  status = 'scheduled', // scheduled | in_progress | final
  score = null,      // { home: 110, away: 105, period: 4, time: '2:30' }
  arena = null,
  season = null,
  source = 'api',
  context = null,    // match context from makeContext()
  pace_context = null,  // { expected_pace, over_under, total_projection }
  quality = {},
}) {
  const defaultContext = {
    is_playoff: null,
    is_neutral_venue: null,
    is_rivalry: null,
    is_revenge_game: null,
    weather: null,
    head_to_head: null,
  };

  const defaultPaceContext = {
    expected_pace: null,
    over_under: null,
    total_projection: null,
  };

  return {
    id: String(id),
    home_team,
    away_team,
    home_team_id,
    away_team_id,
    date,
    tip_off,
    status,
    score,
    arena,
    season,
    source,
    context: context || defaultContext,
    pace_context: pace_context || defaultPaceContext,
    quality: makeQuality({
      level: source === 'api' ? DATA_QUALITY.REAL : DATA_QUALITY.EST,
      sourceReliability: source === 'api' ? SOURCE_RELIABILITY.HIGH : SOURCE_RELIABILITY.LOW,
      ...quality,
    }),
  };
}

// ── NBA Player Prop ───────────────────────────────────────────────────────
export function makeNBAProp({
  game_id,
  home_team,
  away_team,
  player_name,
  team,
  team_side,         // 'home' | 'away'
  stat,              // 'points' | 'rebounds' | 'assists' (full names)
  stat_label,        // 'Points' | 'Rebounds' | 'Assists'
  line,
  direction = 'over',
  tier,
  confidence,
  book_odds = null,
  fair_odds = null,
  projected_avg,
  dataQuality = DATA_QUALITY.EST,
  source_reliability = SOURCE_RELIABILITY.LOW,
  sample_size = 0,
  is_b2b = false,
  is_real_data = false,
  matchup_note = null,
  reason,
  freshness = null,
  line_movement = null,        // use makeLineMovement()
  matchup_context = null,      // { opponent_rank_vs_position, opponent_allows_stat_avg, matchup_advantage }
  projection_range = null,     // { low, median, high }
}) {
  const ov = makeOddsValue({
    confidence,
    bookOdds: book_odds,
    fairOdds: fair_odds,
  });

  const id = `${game_id}|${player_name.replace(/\s/g, '_')}|${stat}|${line}`;
  const key = `${stat}_${direction}_${line}_${player_name.replace(/\s/g, '_')}`;

  const defaultLineMovement = {
    opened_at: null,
    current_line: null,
    high: null,
    low: null,
    movement_direction: null,
    movement_pct: null,
    snapshots_count: null,
    last_snapshot_at: null,
  };

  const defaultMatchupContext = {
    opponent_rank_vs_position: null,
    opponent_allows_stat_avg: null,
    matchup_advantage: null,  // 'favorable' | 'neutral' | 'unfavorable' | null
  };

  const defaultProjectionRange = {
    low: null,
    median: null,
    high: null,
  };

  return {
    id,
    key,
    game_id,
    home_team,
    away_team,
    player_name,
    team,
    team_side,
    sport: 'basketball',
    stat,
    stat_label,
    market: `${player_name} ${stat_label} ${direction} ${line}`,
    line,
    direction,
    tier,
    projected_avg,
    ...ov,
    line_movement: line_movement || defaultLineMovement,
    matchup_context: matchup_context || defaultMatchupContext,
    projection_range: projection_range || defaultProjectionRange,
    flags: {
      is_b2b,
      is_real_data,
    },
    analysis: { reason, matchup_note },
    quality: makeQuality({
      level: dataQuality,
      sourceReliability: source_reliability,
      sampleSize: sample_size,
      freshness,
    }),
  };
}
