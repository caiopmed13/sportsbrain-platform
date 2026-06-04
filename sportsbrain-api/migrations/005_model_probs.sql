CREATE TABLE IF NOT EXISTS model_probs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_family TEXT NOT NULL,
  odd_band TEXT NOT NULL,
  league_tier INTEGER NOT NULL DEFAULT 0,
  predicted_prob REAL NOT NULL,
  n_samples INTEGER NOT NULL DEFAULT 0,
  n_green INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(market_family, odd_band, league_tier)
);
