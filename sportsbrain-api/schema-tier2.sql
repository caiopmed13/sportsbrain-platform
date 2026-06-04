-- Tier 2: xA + PPDA
ALTER TABLE shot_events ADD COLUMN assist_player TEXT;

CREATE TABLE IF NOT EXISTS match_team_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        TEXT NOT NULL,
  team_norm       TEXT NOT NULL,
  is_home         INTEGER,
  ppda            REAL,
  possession_pct  REAL,
  shots           INTEGER DEFAULT 0,
  shots_on_target INTEGER DEFAULT 0,
  xg_total        REAL DEFAULT 0,
  xa_total        REAL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(match_id, team_norm)
);
CREATE INDEX IF NOT EXISTS idx_team_metrics_match ON match_team_metrics(match_id);
CREATE INDEX IF NOT EXISTS idx_team_metrics_team ON match_team_metrics(team_norm);

INSERT OR IGNORE INTO product_changelog(version, change_type, description, module)
VALUES('5.2.0', 'feature', 'Tier 2: xA attribution + PPDA aproximado (pressing metric). Match-level team metrics table.', 'data-pipeline');
