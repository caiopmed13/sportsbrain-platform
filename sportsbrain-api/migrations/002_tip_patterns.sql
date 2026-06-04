-- tip_patterns: padrões aprendidos de W/L dos tipsters
-- Agregado diariamente por (market, odd_band, league_tier, fav_strength)
-- Wilson LCB >= 0.55 → padrão confiável para gerar picks próprios
CREATE TABLE IF NOT EXISTS tip_patterns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  market        TEXT    NOT NULL,
  odd_band      TEXT    NOT NULL,     -- '<1.5' | '1.5-2.0' | '2.0-3.0' | '3.0-5.0' | '5.0-10.0' | '10.0+'
  league_tier   TEXT    NOT NULL,     -- 'top5_eu' | 'south_america' | 'other'
  fav_strength  TEXT    NOT NULL,     -- 'heavy' (<1.5 fav odd) | 'moderate' | 'tossup'
  n_total       INTEGER DEFAULT 0,
  n_won         INTEGER DEFAULT 0,
  win_rate      REAL    DEFAULT 0.0,
  wilson_lcb    REAL    DEFAULT 0.0,  -- lower bound 90% CI
  updated_at    TEXT    DEFAULT (datetime('now')),
  UNIQUE(market, odd_band, league_tier, fav_strength)
);

CREATE INDEX IF NOT EXISTS idx_tip_patterns_lcb ON tip_patterns(wilson_lcb DESC);
CREATE INDEX IF NOT EXISTS idx_tip_patterns_market ON tip_patterns(market, odd_band);
