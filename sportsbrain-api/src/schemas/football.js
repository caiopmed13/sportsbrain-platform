/**
 * SportsBrain Data API 4.0 — Football (Soccer) Schemas
 * ────────────────────────────────────────────────────
 * Canonical data models for all football (soccer) data.
 */

import {
  makeQuality,
  makeOddsValue,
  makeLineMovement,
  makeContext,
  DATA_QUALITY,
  DQ,
  SOURCE_RELIABILITY,
  PROP_TIERS,
} from './base.js';

// ── Team Stats ────────────────────────────────────────────────────────────
export function makeTeamStats({
  name,
  played = 0,
  won = 0,
  drawn = 0,
  lost = 0,
  goals_for = 0,
  goals_against = 0,
  shots_per_game = null,
  shots_on_target_per_game = null,
  corners_per_game = null,
  corners_first_half_per_game = null,
  shots_first_half_per_game = null,
  xg_per_game = null,
  clean_sheets = 0,
  both_teams_score_pct = null,
  over_2_5_goals_pct = null,
  form = [],           // last 5: ['W','D','L','W','W']
  home_away = 'all',   // 'home' | 'away' | 'all'
  quality = {},
}) {
  return {
    name,
    played,
    record: { won, drawn, lost },
    goals: {
      for: goals_for,
      against: goals_against,
      per_game_for: played ? parseFloat((goals_for / played).toFixed(2)) : null,
      per_game_against: played ? parseFloat((goals_against / played).toFixed(2)) : null,
    },
    shots: {
      per_game: shots_per_game,
      on_target_per_game: shots_on_target_per_game,
      first_half_per_game: shots_first_half_per_game,
    },
    corners: {
      per_game: corners_per_game,
      first_half_per_game: corners_first_half_per_game,
    },
    xg: { per_game: xg_per_game },
    tendencies: {
      clean_sheets,
      both_teams_score_pct,
      over_2_5_goals_pct,
      form,
    },
    home_away_split: home_away,
    quality: makeQuality({
      level: played >= 5 ? DATA_QUALITY.REAL : played >= 1 ? DATA_QUALITY.PARTIAL : DATA_QUALITY.EST,
      sourceReliability: played >= 10 ? SOURCE_RELIABILITY.HIGH : SOURCE_RELIABILITY.MEDIUM,
      sampleSize: played,
      ...quality,
    }),
  };
}

// ── Match / Game ──────────────────────────────────────────────────────────
export function makeFootballGame({
  id,
  home_team,
  away_team,
  league,
  competition_id = null,
  kickoff,           // ISO timestamp
  status = 'scheduled', // scheduled | live | ht | ft | postponed
  score = null,      // { home: 1, away: 0, ht: { home: 0, away: 0 } }
  venue = null,
  matchday = null,
  season = null,
  source = 'est',
  context = null,    // match context from makeContext()
  form = null,       // { home_last_5: 'WWDLW', away_last_5: 'WLDWD' }
  officials = null,  // { referee, assistant_1, assistant_2 }
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

  const defaultForm = {
    home_last_5: null,
    away_last_5: null,
  };

  const defaultOfficials = {
    referee: null,
    assistant_1: null,
    assistant_2: null,
  };

  return {
    id,
    home_team,
    away_team,
    league,
    competition_id,
    kickoff,
    status,
    score,
    venue,
    matchday,
    season,
    source,
    context: context || defaultContext,
    form: form || defaultForm,
    officials: officials || defaultOfficials,
    quality: makeQuality({
      level: source === 'live' ? DATA_QUALITY.REAL : source === 'api' ? DATA_QUALITY.REAL : DATA_QUALITY.EST,
      sourceReliability: source === 'live' ? SOURCE_RELIABILITY.HIGH : SOURCE_RELIABILITY.MEDIUM,
      ...quality,
    }),
  };
}

// ── Football Prop ─────────────────────────────────────────────────────────
export function makeFootballProp({
  match_id,
  home_team,
  away_team,
  league,
  kickoff = null,  // ISO timestamp do jogo (pra filtrar por dia)
  type,           // 'team' | 'player'
  stat,           // 'shots' | 'sot' | 'corners' | 'goals' | 'cards' | 'offsides'
  market,         // human-readable market name
  player_name = null,
  team = null,
  is_ht = false,
  line,
  direction = 'over',
  tier,           // 'safe' | 'median' | 'aggressive'
  avg,            // projected average for this stat
  confidence,
  book_odds = null,
  fair_odds = null,
  dataQuality = DATA_QUALITY.EST,
  source_reliability = SOURCE_RELIABILITY.LOW,
  sample_size = 0,
  reason,
  positive,
  negative,
  matchup_note = null,
  lineup_impact = null,
  b2b_flag = false,
  freshness = null,
  line_movement = null,     // use makeLineMovement()
  market_context = null,    // { public_betting_pct, sharp_action, consensus_pick }
  model_prob = null,        // probabilidade calibrada do modelo (Poisson, Binomial, etc) — sobreescreve fallback frontend
}) {
  const ov = makeOddsValue({
    confidence,
    bookOdds: book_odds,
    fairOdds: fair_odds,
  });

  const key = [
    stat,
    direction,
    line,
    is_ht ? 'ht' : '',
    type === 'player' ? (player_name || '').replace(/\s/g, '_') : '',
  ]
    .filter(Boolean)
    .join('_');

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

  const defaultMarketContext = {
    public_betting_pct: null,
    sharp_action: null,
    consensus_pick: null,
  };

  return {
    id: `${match_id}|ftprop|${stat}|${line}${player_name ? '|' + player_name.replace(/\s/g, '_') : ''}`,
    key,
    match_id,
    home_team,
    away_team,
    league,
    kickoff,
    type,
    stat,
    market,
    player_name,
    team,
    is_ht,
    line,
    direction,
    tier,
    projected_avg: avg,
    model_prob,
    ...ov,
    line_movement: line_movement || defaultLineMovement,
    market_context: market_context || defaultMarketContext,
    analysis: {
      reason,
      positive,
      negative,
      matchup_note,
      lineup_impact,
      b2b_flag,
    },
    quality: makeQuality({
      level: dataQuality,
      sourceReliability: source_reliability,
      sampleSize: sample_size,
      freshness,
    }),
  };
}

// ── Football Player ───────────────────────────────────────────────────────
export function makeFootballPlayer({
  name,
  team,
  position = null,    // 'fwd' | 'mid' | 'def' | 'gk'
  season_goals = 0,
  season_assists = 0,
  season_shots = 0,
  season_sot = 0,
  games_played = 0,
  minutes_per_game = null,
  is_starter = null,
  injury_status = null,  // null | 'doubt' | 'out' | 'suspended'
  form = null,           // { last_5_goals, last_5_assists, last_5_minutes, trend }
  quality = {},
}) {
  const defaultForm = {
    last_5_goals: null,
    last_5_assists: null,
    last_5_minutes: null,
    trend: null,           // 'up' | 'down' | 'stable' | null
  };

  return {
    name,
    team,
    position,
    season: {
      goals: season_goals,
      assists: season_assists,
      shots: season_shots,
      shots_on_target: season_sot,
      games_played,
    },
    per_game: {
      goals: games_played ? parseFloat((season_goals / games_played).toFixed(3)) : null,
      assists: games_played ? parseFloat((season_assists / games_played).toFixed(3)) : null,
      shots: games_played ? parseFloat((season_shots / games_played).toFixed(2)) : null,
    },
    minutes_per_game,
    availability: {
      is_starter,
      injury_status,
      is_available: injury_status !== 'out' && injury_status !== 'suspended',
    },
    form: form || defaultForm,
    quality: makeQuality({
      level: games_played >= 5 ? DATA_QUALITY.REAL : games_played >= 1 ? DATA_QUALITY.PARTIAL : DATA_QUALITY.EST,
      sourceReliability: games_played >= 10 ? SOURCE_RELIABILITY.HIGH : SOURCE_RELIABILITY.MEDIUM,
      sampleSize: games_played,
      ...quality,
    }),
  };
}
