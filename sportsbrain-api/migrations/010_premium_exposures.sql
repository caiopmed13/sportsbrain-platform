-- ══════════════════════════════════════════════════════════════════════════
-- Migration 010: premium_pick_exposures
-- Rastreia TODAS as picks exibidas no Premium para validação de performance.
-- ══════════════════════════════════════════════════════════════════════════
-- Execute via:
--   wrangler d1 execute sportsbrain-db --file=./migrations/010_premium_exposures.sql --remote
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS premium_pick_exposures (
  -- ── Identidade ────────────────────────────────────────────────────────
  id                  TEXT PRIMARY KEY,   -- hash estável: date|match|market|selection
  pick_date           TEXT NOT NULL,      -- YYYY-MM-DD (data do jogo, BR)
  shown_at            INTEGER NOT NULL,   -- Unix ms: quando a pick foi gerada/exibida
  date_filter         TEXT,               -- parâmetro date= passado pelo usuário

  -- ── Jogo ─────────────────────────────────────────────────────────────
  fixture_id          TEXT,
  sport               TEXT DEFAULT 'football',
  league              TEXT,
  home_team           TEXT,
  away_team           TEXT,
  kickoff             TEXT,               -- ISO timestamp do kickoff

  -- ── Mercado ──────────────────────────────────────────────────────────
  market              TEXT NOT NULL,      -- stat/market field
  selection           TEXT,               -- outcome/direction
  line                REAL,
  odd                 REAL,
  bookmaker           TEXT,

  -- ── Premium Engine v2 — scores e tiers ───────────────────────────────
  tier                TEXT DEFAULT 'single', -- 'single'|'combo'|'jackpot'
  premium_quality_score  REAL,            -- PQS 0-100
  premium_tier_quality   TEXT,            -- elite|strong|playable|watchlist
  value_bet_level        TEXT,            -- none|watch|value|strong_value
  desajuste_level        TEXT,            -- null|leve|forte|premium
  ev_pct              REAL,
  fair_prob           REAL,
  bayesian_lcb        REAL,

  -- ── Combo ────────────────────────────────────────────────────────────
  is_combo            INTEGER DEFAULT 0,
  combo_id            TEXT,               -- ID do combo ao qual pertence
  combo_quality_score REAL,
  combined_odd        REAL,               -- odd combinada do combo (quando is_combo=1)

  -- ── Fonte ────────────────────────────────────────────────────────────
  source              TEXT,               -- 'bet365'|'tipster'|'ml'|'desajuste'|'faixa'|...
  has_steam           INTEGER DEFAULT 0,
  steam_strength      TEXT,
  is_devig            INTEGER DEFAULT 0,

  -- ── Resultado ────────────────────────────────────────────────────────
  -- Statuses: pending | green | red | void | half_green | half_red | unknown
  result_status       TEXT DEFAULT 'pending',
  profit_unit         REAL,               -- green=(odd-1), red=-1, void=0, half_green=(odd-1)/2
  settled_at          INTEGER,            -- Unix ms

  -- ── Auditoria ────────────────────────────────────────────────────────
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- Índices para queries de analytics
CREATE INDEX IF NOT EXISTS idx_ppe_date        ON premium_pick_exposures(pick_date);
CREATE INDEX IF NOT EXISTS idx_ppe_status      ON premium_pick_exposures(result_status);
CREATE INDEX IF NOT EXISTS idx_ppe_tier        ON premium_pick_exposures(premium_tier_quality);
CREATE INDEX IF NOT EXISTS idx_ppe_source      ON premium_pick_exposures(source);
CREATE INDEX IF NOT EXISTS idx_ppe_sport       ON premium_pick_exposures(sport);
CREATE INDEX IF NOT EXISTS idx_ppe_type        ON premium_pick_exposures(tier);
CREATE INDEX IF NOT EXISTS idx_ppe_combo       ON premium_pick_exposures(combo_id);
CREATE INDEX IF NOT EXISTS idx_ppe_shown       ON premium_pick_exposures(shown_at);
CREATE INDEX IF NOT EXISTS idx_ppe_desajuste   ON premium_pick_exposures(desajuste_level);
CREATE INDEX IF NOT EXISTS idx_ppe_vbl         ON premium_pick_exposures(value_bet_level);

-- ── Tabela de combos ─────────────────────────────────────────────────────
-- Registra os combos como unidade — uma linha por combo, com legs como JSON.
CREATE TABLE IF NOT EXISTS premium_combo_exposures (
  id                  TEXT PRIMARY KEY,   -- hash do combo
  pick_date           TEXT NOT NULL,
  shown_at            INTEGER NOT NULL,
  sport               TEXT DEFAULT 'football',
  tier                TEXT,               -- 'T2'|'T3'|'T4'|'betbuilder'|'jackpot'
  n_legs              INTEGER,
  legs_json           TEXT,               -- JSON array com pick IDs das pernas
  combined_odd        REAL,
  combined_ev_pct     REAL,
  combo_quality_score REAL,
  result_status       TEXT DEFAULT 'pending',
  profit_unit         REAL,
  settled_at          INTEGER,
  created_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pce_date   ON premium_combo_exposures(pick_date);
CREATE INDEX IF NOT EXISTS idx_pce_status ON premium_combo_exposures(result_status);
