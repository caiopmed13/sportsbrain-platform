-- migrations/006_signal_tables.sql
-- Signal Architecture tables — run via:
--   npx wrangler d1 execute sportsbrain-db --file=./migrations/006_signal_tables.sql --remote

-- ── S3 Steam: computed steam signal per (event, market, outcome) ──────────
-- Keyed by home_canon|away_canon|market|outcome so signalBlender can look up
-- by team name without needing to resolve Bet365 fixture_id → odds event_id.
CREATE TABLE IF NOT EXISTS odds_signals (
  id              TEXT PRIMARY KEY,         -- home_canon|away_canon|market|outcome
  event_id        TEXT,                     -- odds_events.id (for debugging)
  home_team       TEXT,
  away_team       TEXT,
  market          TEXT NOT NULL,
  outcome         TEXT NOT NULL,            -- 'home'|'away'|'draw'|'over'|'under'
  line            REAL,
  odd_now         REAL,
  odd_2h_ago      REAL,
  pct_change      REAL,                     -- negative = shortened (bet into)
  is_steam        INTEGER DEFAULT 0,        -- 1 if shortened >= 5%
  is_drift        INTEGER DEFAULT 0,        -- 1 if drifted >= 5%
  steam_strength  TEXT DEFAULT 'none',      -- 'weak'|'medium'|'strong'|'none'
  signal_factor   REAL DEFAULT 1.0,         -- multiplier 0.80–1.20
  computed_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_os_homeaway ON odds_signals(home_team, away_team);

-- ── S1 Form: last-5 match stats per team ─────────────────────────────────
CREATE TABLE IF NOT EXISTS team_form_cache (
  team_id         TEXT NOT NULL,            -- API-Football team id (or ESPN id)
  team_name       TEXT NOT NULL,
  team_name_norm  TEXT NOT NULL,            -- lowercase trim for matching
  sport           TEXT NOT NULL DEFAULT 'football',
  last5_scored    REAL DEFAULT 0,           -- avg goals scored last 5
  last5_conceded  REAL DEFAULT 0,           -- avg goals conceded last 5
  btts_rate       REAL DEFAULT 0,           -- BTTS % last 5 (0.0–1.0)
  form_pts        INTEGER DEFAULT 0,        -- points (W=3,D=1,L=0) last 5
  clean_sheets    INTEGER DEFAULT 0,        -- clean sheets last 5
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (team_id, sport)
);
CREATE INDEX IF NOT EXISTS idx_tfc_name ON team_form_cache(team_name_norm, sport);

-- ── S2 Lineup: confirmed XI + absences ───────────────────────────────────
-- Keyed by home_norm|away_norm (not fixture_id, avoids ESPN vs Bet365 ID gap)
CREATE TABLE IF NOT EXISTS match_lineups (
  id                    TEXT PRIMARY KEY,   -- home_norm|away_norm
  home_team             TEXT,
  away_team             TEXT,
  home_has_lineup       INTEGER DEFAULT 0,
  away_has_lineup       INTEGER DEFAULT 0,
  home_missing_key      INTEGER DEFAULT 0,  -- top scorer or GK absent
  away_missing_key      INTEGER DEFAULT 0,
  home_missing_count    INTEGER DEFAULT 0,
  away_missing_count    INTEGER DEFAULT 0,
  home_signal_factor    REAL DEFAULT 1.0,
  away_signal_factor    REAL DEFAULT 1.0,
  fetched_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ml_teams ON match_lineups(home_team, away_team);

-- ── S5 Referee: per-referee card tendencies ───────────────────────────────
CREATE TABLE IF NOT EXISTS referee_signals (
  referee_name          TEXT PRIMARY KEY,
  avg_yellow_per_game   REAL DEFAULT 0,
  avg_red_per_game      REAL DEFAULT 0,
  avg_fouls_per_game    REAL DEFAULT 0,
  games_analyzed        INTEGER DEFAULT 0,
  card_tendency         TEXT DEFAULT 'normal',  -- 'strict'|'normal'|'lenient'
  signal_factor_cards   REAL DEFAULT 1.0,       -- for card/foul markets
  updated_at            TEXT NOT NULL
);

-- Per-fixture referee assignment (home_norm|away_norm → referee)
CREATE TABLE IF NOT EXISTS match_referee (
  id              TEXT PRIMARY KEY,   -- home_norm|away_norm
  home_team       TEXT,
  away_team       TEXT,
  referee_name    TEXT,
  fetched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mr_ref ON match_referee(referee_name);
