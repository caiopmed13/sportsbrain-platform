CREATE TABLE IF NOT EXISTS match_analytics (
  fixture_id TEXT PRIMARY KEY,
  home_team TEXT,
  away_team TEXT,
  league TEXT,
  match_date TEXT,
  home_form TEXT,
  away_form TEXT,
  h2h_avg_goals REAL,
  h2h_avg_corners REAL,
  h2h_avg_cards REAL,
  home_goals_avg REAL,
  away_goals_avg REAL,
  home_btts_pct REAL,
  away_btts_pct REAL,
  context_pt TEXT,
  scraped_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_match_analytics_date ON match_analytics(match_date);
