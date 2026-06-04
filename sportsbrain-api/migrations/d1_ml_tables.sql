-- ═══════════════════════════════════════════════════════════════════════════
-- D1 tables for enrichment + ML
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS team_xg (
  team          TEXT NOT NULL,
  league        TEXT NOT NULL,
  xg_per_game   REAL,
  xga_per_game  REAL,
  last_updated  INTEGER NOT NULL,
  PRIMARY KEY (team, league)
);

CREATE TABLE IF NOT EXISTS team_features (
  event_id      TEXT PRIMARY KEY,
  features_json TEXT NOT NULL,
  built_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_features_built ON team_features(built_at);

CREATE TABLE IF NOT EXISTS ml_models (
  name               TEXT PRIMARY KEY,
  trees_json         TEXT NOT NULL,
  feature_order_json TEXT NOT NULL,
  base_score         REAL DEFAULT 0,
  trained_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calibration_curves (
  sport      TEXT NOT NULL,
  market     TEXT NOT NULL,
  curve_json TEXT NOT NULL,
  trained_at INTEGER NOT NULL,
  n_samples  INTEGER NOT NULL,
  PRIMARY KEY (sport, market)
);
