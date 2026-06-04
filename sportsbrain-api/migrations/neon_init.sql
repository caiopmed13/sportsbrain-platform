-- ══════════════════════════════════════════════════════════════════════════
-- Neon (Postgres 16) — long-term odds history
-- ══════════════════════════════════════════════════════════════════════════
-- D1 = cache quente (últimos 30d). Neon = histórico 2 anos.
-- Sem TimescaleDB: usa partições nativas por mês + índices btree.
-- Neon comprime automaticamente dados antigos no storage layer.
-- ══════════════════════════════════════════════════════════════════════════

-- Eventos (denormalizado pra evitar join na hora da leitura)
CREATE TABLE IF NOT EXISTS odds_events_lt (
  id             TEXT PRIMARY KEY,
  sport          TEXT NOT NULL,
  league         TEXT,
  league_slug    TEXT,
  home           TEXT NOT NULL,
  away           TEXT NOT NULL,
  commence_time  BIGINT NOT NULL,
  first_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_lt_sport_league ON odds_events_lt (sport, league_slug);
CREATE INDEX IF NOT EXISTS idx_events_lt_commence    ON odds_events_lt (commence_time);

-- Snapshots particionados por mês (RANGE em ts millis)
CREATE TABLE IF NOT EXISTS odds_snapshots_lt (
  id         BIGSERIAL,
  event_id   TEXT NOT NULL,
  book       TEXT NOT NULL,
  market     TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  line       DOUBLE PRECISION,
  price      DOUBLE PRECISION NOT NULL,
  ts         BIGINT NOT NULL,
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

CREATE INDEX IF NOT EXISTS idx_snap_lt_event ON odds_snapshots_lt (event_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_snap_lt_book  ON odds_snapshots_lt (book, ts DESC);
CREATE INDEX IF NOT EXISTS idx_snap_lt_mkt   ON odds_snapshots_lt (market, outcome, ts DESC);

-- Função helper pra criar partições mensais automaticamente
CREATE OR REPLACE FUNCTION ensure_month_partition(year INT, month INT) RETURNS VOID AS $$
DECLARE
  part_name TEXT;
  start_ms  BIGINT;
  end_ms    BIGINT;
BEGIN
  part_name := format('odds_snapshots_lt_%s_%s', year, lpad(month::TEXT, 2, '0'));
  start_ms  := EXTRACT(EPOCH FROM make_timestamp(year, month, 1, 0, 0, 0))::BIGINT * 1000;
  end_ms    := EXTRACT(EPOCH FROM (make_timestamp(year, month, 1, 0, 0, 0) + INTERVAL '1 month'))::BIGINT * 1000;
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF odds_snapshots_lt FOR VALUES FROM (%s) TO (%s)',
    part_name, start_ms, end_ms
  );
END;
$$ LANGUAGE plpgsql;

-- Cria partições pros próximos 24 meses já
DO $$
DECLARE
  d DATE := DATE_TRUNC('month', NOW())::DATE;
  i INT;
BEGIN
  FOR i IN 0..23 LOOP
    PERFORM ensure_month_partition(
      EXTRACT(YEAR FROM d + (i || ' months')::INTERVAL)::INT,
      EXTRACT(MONTH FROM d + (i || ' months')::INTERVAL)::INT
    );
  END LOOP;
END $$;

-- Picks persistidos (espelho do picks_closed do D1, pra histórico longo)
CREATE TABLE IF NOT EXISTS picks_closed_lt (
  id             BIGSERIAL PRIMARY KEY,
  event_id       TEXT NOT NULL,
  sport          TEXT,
  league_slug    TEXT,
  book           TEXT,
  market         TEXT,
  outcome        TEXT,
  line           DOUBLE PRECISION,
  price_open     DOUBLE PRECISION,
  price_close    DOUBLE PRECISION,
  fair_price     DOUBLE PRECISION,
  edge_pct       DOUBLE PRECISION,
  confidence     TEXT,
  kelly_stake    DOUBLE PRECISION,
  clv_pct        DOUBLE PRECISION,
  result         TEXT,  -- win | loss | push | pending
  pnl_units      DOUBLE PRECISION,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  settled_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_picks_lt_result ON picks_closed_lt (result, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_picks_lt_book   ON picks_closed_lt (book, result);

-- Calibration curves (isotonic por sport/market)
CREATE TABLE IF NOT EXISTS calibration_curves (
  sport        TEXT NOT NULL,
  market       TEXT NOT NULL,
  curve_json   JSONB NOT NULL,
  n_samples    INT,
  trained_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (sport, market)
);

-- ML models (XGBoost trees serializados pra inferência no Worker)
CREATE TABLE IF NOT EXISTS ml_models (
  name             TEXT PRIMARY KEY,
  trees_json       JSONB NOT NULL,
  feature_order    JSONB NOT NULL,
  trained_at       TIMESTAMPTZ DEFAULT NOW(),
  metrics_json     JSONB
);

-- Grant (se você criar role separada no futuro)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO sportsbrain_writer;
