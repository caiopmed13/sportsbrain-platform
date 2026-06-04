-- Tier 1: Lineups + Players + extra fields
-- Run: wrangler d1 execute sportsbrain-db --file=./schema-tier1.sql --remote

-- ── Lineups (formação + titulares + reservas) ───────────────────────────
CREATE TABLE IF NOT EXISTS lineups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        TEXT NOT NULL,
  team            TEXT NOT NULL,
  team_norm       TEXT NOT NULL,
  is_home         INTEGER,
  formation       TEXT,                     -- '4-3-3', '4-2-3-1'...
  is_confirmed    INTEGER DEFAULT 0,
  player_name     TEXT NOT NULL,
  player_norm     TEXT,
  jersey          TEXT,
  position        TEXT,
  is_starter      INTEGER DEFAULT 0,
  is_captain      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lineups_match ON lineups(match_id);
CREATE INDEX IF NOT EXISTS idx_lineups_team  ON lineups(team_norm);
CREATE INDEX IF NOT EXISTS idx_lineups_player ON lineups(player_norm);

-- ── Player season stats (ESPN athletes) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS players_season (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  espn_athlete_id TEXT,
  player_name     TEXT NOT NULL,
  player_norm     TEXT NOT NULL,
  team            TEXT,
  team_norm       TEXT,
  league_slug     TEXT,
  season          TEXT,
  position        TEXT,
  jersey          TEXT,
  appearances     INTEGER DEFAULT 0,
  starts          INTEGER DEFAULT 0,
  minutes         INTEGER DEFAULT 0,
  goals           INTEGER DEFAULT 0,
  assists         INTEGER DEFAULT 0,
  shots           INTEGER DEFAULT 0,
  shots_on_target INTEGER DEFAULT 0,
  yellow_cards    INTEGER DEFAULT 0,
  red_cards       INTEGER DEFAULT 0,
  fouls_committed INTEGER DEFAULT 0,
  fouls_suffered  INTEGER DEFAULT 0,
  pass_completion_pct REAL,
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(player_norm, team_norm, season)
);
CREATE INDEX IF NOT EXISTS idx_players_name ON players_season(player_norm);
CREATE INDEX IF NOT EXISTS idx_players_team ON players_season(team_norm, season);

INSERT OR IGNORE INTO product_changelog(version, change_type, description, module)
VALUES('5.1.0', 'feature', 'Tier 1 data expansion: lineups + players_season + expanded league coverage (52 leagues)', 'data-pipeline');
