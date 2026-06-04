-- ══════════════════════════════════════════════════════════════════════════
-- SportsBrain Odds Engine — proprietary odds layer
-- ══════════════════════════════════════════════════════════════════════════
-- Tabelas:
--   odds_events        → eventos normalizados (1 por home+away+commence_time)
--   odds_snapshots     → snapshots de preço por book/mercado (time-series)
--   odds_consensus     → consenso cacheado (última agregação)
--   odds_books         → metadata dos bookmakers
-- ══════════════════════════════════════════════════════════════════════════

-- ── Eventos normalizados ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS odds_events (
  id             TEXT PRIMARY KEY,           -- hash(home_canon|away_canon|commence_date)
  sport          TEXT NOT NULL,              -- 'soccer' | 'basketball'
  league         TEXT,                        -- display label
  league_slug    TEXT,                        -- canonical slug (eng.1, blr.1, nba)
  home           TEXT NOT NULL,
  away           TEXT NOT NULL,
  home_canon     TEXT NOT NULL,               -- lowercased normalized
  away_canon     TEXT NOT NULL,
  commence_time  INTEGER NOT NULL,            -- unix ms
  status         TEXT DEFAULT 'scheduled',    -- scheduled | live | ft
  first_seen     INTEGER DEFAULT (unixepoch() * 1000),
  updated_at     INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_odds_events_commence ON odds_events(commence_time);
CREATE INDEX IF NOT EXISTS idx_odds_events_sport    ON odds_events(sport, commence_time);
CREATE INDEX IF NOT EXISTS idx_odds_events_canon    ON odds_events(home_canon, away_canon);

-- ── Snapshots (time-series, 1 linha por book/mercado/outcome/momento) ────
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   TEXT NOT NULL,
  book       TEXT NOT NULL,                   -- 'betano' | 'superbet' | 'betfair_ex' | 'pinnacle'
  market     TEXT NOT NULL,                   -- 'h2h' | 'totals' | 'spreads' | 'btts' | 'player_pts' ...
  outcome    TEXT NOT NULL,                   -- 'home' | 'away' | 'draw' | 'over' | 'under' | player name
  line       REAL,                             -- só para totals/spreads/props
  price      REAL NOT NULL,                   -- decimal odds (ex: 2.10)
  ts         INTEGER NOT NULL,                -- unix ms
  FOREIGN KEY (event_id) REFERENCES odds_events(id)
);
CREATE INDEX IF NOT EXISTS idx_odds_snap_event  ON odds_snapshots(event_id, market, outcome);
CREATE INDEX IF NOT EXISTS idx_odds_snap_ts     ON odds_snapshots(ts);
CREATE INDEX IF NOT EXISTS idx_odds_snap_book   ON odds_snapshots(book, ts);

-- ── Consenso cacheado (última agregação) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS odds_consensus (
  event_id     TEXT,
  market       TEXT,
  outcome      TEXT,
  line         REAL,
  best_price   REAL,                           -- melhor odd entre todos os books
  best_book    TEXT,
  median_price REAL,                           -- mediana (consenso)
  sharp_price  REAL,                           -- preço do Pinnacle/Betfair (se disponível)
  fair_prob    REAL,                           -- probabilidade justa (1/sharp_price sem overround)
  n_books      INTEGER,
  updated_at   INTEGER DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (event_id, market, outcome, line)
);

-- ── Metadata de bookmakers ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS odds_books (
  key        TEXT PRIMARY KEY,
  title      TEXT,
  type       TEXT,   -- 'sharp' | 'soft' | 'exchange'
  region     TEXT,   -- 'br' | 'eu' | 'world'
  weight     REAL DEFAULT 1.0,  -- peso no consenso
  last_ok    INTEGER,
  last_err   TEXT
);

-- Seed dos books
INSERT OR IGNORE INTO odds_books (key, title, type, region, weight) VALUES
  ('pinnacle',   'Pinnacle',         'sharp',    'world', 2.0),
  ('betfair_ex', 'Betfair Exchange', 'exchange', 'world', 2.0),
  ('smarkets',   'Smarkets',         'exchange', 'uk',    1.8),
  ('kambi',      'Kambi/Unibet',     'soft',     'eu',    1.3),
  ('bovada',     'Bovada',           'soft',     'us',    1.2),
  ('1xbet',      '1xBet',            'soft',     'world', 1.0),
  ('draftkings', 'DraftKings',       'soft',     'us',    1.2),
  ('fanduel',    'FanDuel',          'soft',     'us',    1.2),
  ('caesars',    'Caesars',          'soft',     'us',    1.1),
  ('betmgm',     'BetMGM',           'soft',     'us',    1.1),
  ('betano',     'Betano',           'soft',     'br',    1.1),
  ('superbet',   'Superbet',         'soft',     'br',    1.0),
  ('kto',        'KTO',              'soft',     'br',    0.9),
  ('bet365',     'bet365',           'soft',     'world', 1.3),
  ('stake',      'Stake',            'soft',     'world', 1.0),
  ('betway',     'Betway',           'soft',     'world', 1.0);

-- ══════════════════════════════════════════════════════════════════════════
-- Extensões v2 — features "top 1"
-- ══════════════════════════════════════════════════════════════════════════

-- Movement alerts (steam detection, sharp money, RLM)
CREATE TABLE IF NOT EXISTS odds_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL,
  market      TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  line        REAL,
  kind        TEXT NOT NULL,    -- 'steam' | 'rlm' | 'freeze' | 'value' | 'arb' | 'middle'
  severity    REAL,             -- 0-1
  detail      TEXT,             -- JSON
  created_at  INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_odds_alerts_evt ON odds_alerts(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_alerts_kind ON odds_alerts(kind, created_at DESC);

-- Book performance tracking (CLV by book — descobrir books "soft")
CREATE TABLE IF NOT EXISTS odds_book_perf (
  book        TEXT NOT NULL,
  sport       TEXT NOT NULL,
  market      TEXT NOT NULL,
  n_games     INTEGER DEFAULT 0,
  avg_clv     REAL,              -- CLV médio vs Pinnacle close
  avg_hold    REAL,              -- overround médio
  updated_at  INTEGER DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (book, sport, market)
);

-- Portfolio picks (user bet tracking)
CREATE TABLE IF NOT EXISTS odds_portfolio (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  market       TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  line         REAL,
  book         TEXT NOT NULL,
  price_entry  REAL NOT NULL,
  price_close  REAL,
  stake        REAL NOT NULL,
  ev_pct       REAL,
  kelly        REAL,
  status       TEXT DEFAULT 'open',  -- open | won | lost | push | void
  clv_pct      REAL,
  placed_at    INTEGER DEFAULT (unixepoch() * 1000),
  settled_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_portfolio_user ON odds_portfolio(user_key, placed_at DESC);
