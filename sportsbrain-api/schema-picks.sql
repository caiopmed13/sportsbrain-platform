-- ══════════════════════════════════════════════════════════════════════════
-- SportsBrain — Picks, CLV, Elo, Poisson features
-- ══════════════════════════════════════════════════════════════════════════
-- Objetivo: fechar o feedback loop pick→result→CLV→hit rate + alimentar
-- modelos estatísticos proprietários (Elo, Poisson com xG histórico).
-- ══════════════════════════════════════════════════════════════════════════

-- ── Picks publicados (toda value bet +EV que passou pelo engine) ─────────
CREATE TABLE IF NOT EXISTS picks_closed (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id           TEXT NOT NULL,
  sport              TEXT,
  league             TEXT,
  market             TEXT NOT NULL,          -- h2h | spreads | totals | btts | player_pts ...
  outcome            TEXT NOT NULL,
  line               REAL,
  book               TEXT NOT NULL,

  -- Estado no momento da publicação do pick
  price_at_pick      REAL NOT NULL,
  fair_price_at_pick REAL,
  edge_pct           REAL,
  n_sharp            INTEGER,
  sharp_books_json   TEXT,

  -- Score do ensemble (Elo/Poisson/histórico)
  model_prob         REAL,                    -- probabilidade do modelo proprietário
  ensemble_prob      REAL,                    -- blend fair + model + historical_clv
  confidence         TEXT,                    -- high | medium | low
  kelly_frac         REAL,                    -- fração sugerida da banca
  signals_json       TEXT,                    -- {steam, elo_gap, xg_trend, ...}
  explain            TEXT,                    -- string humana

  -- Captura de fechamento (para CLV)
  closing_price      REAL,
  closing_fair       REAL,
  clv_pct            REAL,                    -- edge vs closing fair

  -- Resultado
  result             TEXT,                    -- 'win' | 'loss' | 'push' | null
  pnl_units          REAL,                    -- considerando stake = 1 unit
  actual_score       TEXT,                    -- placar final pra debug

  commence_time      INTEGER NOT NULL,
  picked_at          INTEGER DEFAULT (unixepoch() * 1000),
  closed_at          INTEGER,                 -- quando capturou closing line
  resolved_at        INTEGER,                 -- quando marcou win/loss
  source             TEXT DEFAULT 'auto'      -- auto | manual | daily_pick
);
CREATE INDEX IF NOT EXISTS idx_picks_event     ON picks_closed(event_id);
CREATE INDEX IF NOT EXISTS idx_picks_commence  ON picks_closed(commence_time);
CREATE INDEX IF NOT EXISTS idx_picks_unresolved ON picks_closed(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_picks_unclosed   ON picks_closed(closed_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_picks_edge      ON picks_closed(edge_pct);

-- Dedup: evita gravar 2× o mesmo pick (mesmo event/market/outcome/book) na mesma hora
CREATE UNIQUE INDEX IF NOT EXISTS uniq_picks_slot
  ON picks_closed(event_id, market, outcome, line, book, picked_at);

-- ── Aliases de times (normaliza nomes entre books) ───────────────────────
CREATE TABLE IF NOT EXISTS teams_alias (
  alias       TEXT PRIMARY KEY,               -- lower-cased
  canonical   TEXT NOT NULL,                   -- nome oficial ESPN/Pinnacle
  sport       TEXT,
  confidence  REAL DEFAULT 1.0,                -- 0-1 se veio de fuzzy match
  source      TEXT DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_alias_canon ON teams_alias(canonical, sport);

-- ── Elo ratings por time × sport ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elo_ratings (
  team         TEXT,
  sport        TEXT,
  rating       REAL DEFAULT 1500,
  games        INTEGER DEFAULT 0,
  last_result_at INTEGER,
  last_update  INTEGER DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (team, sport)
);
CREATE INDEX IF NOT EXISTS idx_elo_sport ON elo_ratings(sport, rating DESC);

-- ── Histórico de resultados (alimenta Elo + Poisson) ─────────────────────
CREATE TABLE IF NOT EXISTS game_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT UNIQUE,
  sport         TEXT,
  league        TEXT,
  home          TEXT,
  away          TEXT,
  home_score    INTEGER,
  away_score    INTEGER,
  commence_time INTEGER,
  finished_at   INTEGER DEFAULT (unixepoch() * 1000),
  source        TEXT                           -- 'espn' | 'apifootball' | 'manual'
);
CREATE INDEX IF NOT EXISTS idx_results_teams ON game_results(home, away);
CREATE INDEX IF NOT EXISTS idx_results_sport ON game_results(sport, commence_time);

-- ── Stats de gols por time (rolling avg pra Poisson soccer) ──────────────
CREATE TABLE IF NOT EXISTS team_goal_stats (
  team             TEXT,
  league           TEXT,
  games            INTEGER,
  goals_for_avg    REAL,
  goals_against_avg REAL,
  home_goals_for   REAL,
  home_goals_against REAL,
  away_goals_for   REAL,
  away_goals_against REAL,
  last_update      INTEGER DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (team, league)
);

-- ── Métricas agregadas de performance (cached) ───────────────────────────
CREATE TABLE IF NOT EXISTS perf_buckets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_key  TEXT UNIQUE,                    -- 'edge_1_3', 'edge_3_5', 'edge_5_7', 'edge_7_plus', 'book:pinnacle', ...
  n_picks     INTEGER,
  n_wins      INTEGER,
  n_losses    INTEGER,
  n_push      INTEGER,
  roi_pct     REAL,
  avg_clv_pct REAL,
  updated_at  INTEGER DEFAULT (unixepoch() * 1000)
);
