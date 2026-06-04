-- SportsBrain Data API — D1 Database Schema
-- Run: wrangler d1 execute sportsbrain-db --file=./schema.sql

-- ── Games (historical) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  sport           TEXT NOT NULL,   -- 'football' | 'basketball'
  home_team       TEXT NOT NULL,
  away_team       TEXT NOT NULL,
  league          TEXT,
  competition_id  TEXT,
  game_date       TEXT NOT NULL,   -- YYYY-MM-DD
  kickoff         TEXT,            -- ISO timestamp
  status          TEXT DEFAULT 'scheduled',
  score_home      INTEGER,
  score_away      INTEGER,
  score_ht_home   INTEGER,
  score_ht_away   INTEGER,
  season          TEXT,
  source          TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_date  ON games(game_date);
CREATE INDEX IF NOT EXISTS idx_games_sport ON games(sport);

-- ── Team Stats (rolling) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_stats (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name                   TEXT NOT NULL,
  sport                       TEXT NOT NULL,
  season                      TEXT,
  home_away                   TEXT DEFAULT 'all',  -- 'home' | 'away' | 'all'
  games_played                INTEGER DEFAULT 0,
  wins                        INTEGER DEFAULT 0,
  draws                       INTEGER DEFAULT 0,
  losses                      INTEGER DEFAULT 0,
  goals_for                   REAL,
  goals_against               REAL,
  shots_per_game              REAL,
  shots_on_target_per_game    REAL,
  shots_ht_per_game           REAL,
  corners_per_game            REAL,
  corners_ht_per_game         REAL,
  xg_per_game                 REAL,
  btts_pct                    REAL,
  over25_pct                  REAL,
  -- NBA specific
  pts_per_game                REAL,
  opp_pts_per_game            REAL,
  pace                        REAL,
  ortg                        REAL,
  drtg                        REAL,
  --
  data_quality                TEXT DEFAULT 'EST',
  source                      TEXT,
  updated_at                  TEXT DEFAULT (datetime('now')),
  UNIQUE(team_name, sport, season, home_away)
);
CREATE INDEX IF NOT EXISTS idx_team_stats_name ON team_stats(team_name, sport);

-- ── Player Stats (season + recent) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_stats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name     TEXT NOT NULL,
  sport           TEXT NOT NULL,
  team            TEXT,
  season          TEXT,
  position        TEXT,
  games_played    INTEGER DEFAULT 0,
  -- Football
  goals           INTEGER DEFAULT 0,
  assists         INTEGER DEFAULT 0,
  shots           INTEGER DEFAULT 0,
  shots_on_target INTEGER DEFAULT 0,
  -- Basketball
  pts_avg         REAL,
  reb_avg         REAL,
  ast_avg         REAL,
  stl_avg         REAL,
  blk_avg         REAL,
  to_avg          REAL,
  min_avg         REAL,
  fg_pct          REAL,
  fg3_pct         REAL,
  ft_pct          REAL,
  -- Availability
  injury_status   TEXT,
  -- Meta
  data_quality    TEXT DEFAULT 'EST',
  source          TEXT,
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(player_name, sport, season)
);
CREATE INDEX IF NOT EXISTS idx_player_stats_name ON player_stats(player_name, sport);

-- ── Prop Results (for calibration) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS prop_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prop_key        TEXT NOT NULL,
  game_id         TEXT,
  sport           TEXT NOT NULL,
  player_name     TEXT,
  team            TEXT,
  stat            TEXT NOT NULL,
  line            REAL NOT NULL,
  direction       TEXT DEFAULT 'over',
  tier            TEXT,
  is_ht           INTEGER DEFAULT 0,
  projected_avg   REAL,
  conf_at_time    INTEGER,
  ev_at_time      REAL,
  actual_value    REAL,
  result          TEXT,            -- 'hit' | 'miss' | 'push'
  data_quality    TEXT,
  game_date       TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prop_results_key  ON prop_results(prop_key);
CREATE INDEX IF NOT EXISTS idx_prop_results_date ON prop_results(game_date);
CREATE INDEX IF NOT EXISTS idx_prop_results_stat ON prop_results(stat, sport);

-- ── Odds History ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS odds_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     TEXT,
  sport       TEXT NOT NULL,
  home_team   TEXT,
  away_team   TEXT,
  bookmaker   TEXT,
  market      TEXT,
  outcome     TEXT,
  odds        REAL,
  recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_odds_history_game ON odds_history(game_id);

-- ── API Keys (for future commercial tiers) ──────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash    TEXT UNIQUE NOT NULL,
  plan        TEXT DEFAULT 'free',  -- 'free' | 'starter' | 'pro' | 'enterprise'
  owner_email TEXT,
  rate_limit  INTEGER DEFAULT 100,   -- requests per hour
  modules     TEXT DEFAULT '["football","basketball"]',  -- JSON array
  active      INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  expires_at  TEXT
);

-- ── Performance tracking ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL,         -- YYYY-MM or YYYY-WW
  sport       TEXT NOT NULL,
  stat        TEXT NOT NULL,
  tier        TEXT,
  total_props INTEGER DEFAULT 0,
  hits        INTEGER DEFAULT 0,
  misses      INTEGER DEFAULT 0,
  hit_rate    REAL,
  avg_conf    REAL,
  avg_ev      REAL,
  calibration_error REAL,            -- |predicted_hit_rate - actual_hit_rate|
  updated_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(period, sport, stat, tier)
);

-- ── Line snapshots for trend tracking (v4.0) ────────────────────────────
CREATE TABLE IF NOT EXISTS line_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prop_key     TEXT NOT NULL,
  sport        TEXT NOT NULL,
  stat         TEXT,
  line         REAL NOT NULL,
  bookmaker    TEXT,
  odds_over    REAL,
  odds_under   REAL,
  recorded_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_line_snapshots_key ON line_snapshots(prop_key, recorded_at);

-- ── API usage log for metering and observability (v4.0) ──────────────────
CREATE TABLE IF NOT EXISTS api_usage_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_hash    TEXT,
  endpoint        TEXT NOT NULL,
  method          TEXT DEFAULT 'GET',
  status_code     INTEGER,
  response_time_ms INTEGER,
  sport           TEXT,
  tier            TEXT,
  ip_hash         TEXT,
  recorded_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_log_key ON api_usage_log(api_key_hash, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_endpoint ON api_usage_log(endpoint, recorded_at);

-- ── SLA tracking (v4.0) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  period          TEXT NOT NULL,
  endpoint        TEXT,
  total_requests  INTEGER DEFAULT 0,
  errors          INTEGER DEFAULT 0,
  avg_response_ms REAL,
  p95_response_ms REAL,
  p99_response_ms REAL,
  uptime_pct      REAL,
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(period, endpoint)
);

-- ── Product changelog (v4.0) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_changelog (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL,
  change_type TEXT,  -- 'feature'|'fix'|'breaking'|'deprecation'
  description TEXT,
  module      TEXT,
  released_at TEXT DEFAULT (datetime('now'))
);

-- Insert current version
INSERT OR IGNORE INTO product_changelog(version, change_type, description, module)
VALUES('4.0.0', 'feature', 'SportsBrain Data API 4.0 — Professional schemas, intelligence engine upgrade, recommendations API', 'all');

-- ── Pick History (ROI tracking + auto-verificação de resultados) ─────────
CREATE TABLE IF NOT EXISTS pick_history (
  id            TEXT PRIMARY KEY,         -- formato: date|norm(match)|norm(stat)
  pick_date     TEXT NOT NULL,            -- YYYY-MM-DD
  match         TEXT NOT NULL,
  league        TEXT DEFAULT '',
  sport         TEXT DEFAULT 'football',
  stat          TEXT NOT NULL,
  conf          INTEGER DEFAULT 0,
  tier          TEXT DEFAULT 'aggressive',
  real_odd      REAL,
  ev_real       REAL,
  result        TEXT,                     -- 'W'|'L'|'V'|'P'|NULL (pendente)
  auto_verified INTEGER DEFAULT 0,        -- 1 = verificado pelo cron
  saved_at      TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pick_history_date    ON pick_history(pick_date);
CREATE INDEX IF NOT EXISTS idx_pick_history_result  ON pick_history(result);
CREATE INDEX IF NOT EXISTS idx_pick_history_pending ON pick_history(sport, pick_date) WHERE result IS NULL;
