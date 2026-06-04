-- ═══════════════════════════════════════════════════════════════════════════
-- ml_training_samples — histórico próprio para treinar modelos
-- ═══════════════════════════════════════════════════════════════════════════
-- 1 linha por (event_id, market). Features capturadas pré-jogo, label preenchido
-- depois que o resultado sai. O job de training faz SELECT ... WHERE label IS NOT NULL.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ml_training_samples (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sport          TEXT    NOT NULL,           -- 'basketball', 'soccer', ...
  market         TEXT    NOT NULL,           -- 'spread', 'total', 'h2h', 'btts', ...
  event_id       TEXT    NOT NULL,
  league         TEXT,
  home_team      TEXT,
  away_team      TEXT,
  commence_time  INTEGER NOT NULL,           -- ms epoch
  -- Features JSON (qualquer forma; o treino filtra por market)
  features_json  TEXT    NOT NULL,
  -- Snapshot do mercado (closing lines / melhor odd) no momento do collect
  closing_json   TEXT    NOT NULL,
  -- Label — null até o jogo acabar. Convenções por market:
  --   spread → 1 se home cobriu, 0 se não
  --   total  → 1 se OVER, 0 se UNDER
  --   h2h    → 1 se home venceu, 0 se away (para empate: draw_label=1, label=NULL)
  label          INTEGER,
  draw_label     INTEGER,                    -- só soccer h2h: 1 se empatou
  home_score     INTEGER,
  away_score     INTEGER,
  collected_at   INTEGER NOT NULL,
  resulted_at    INTEGER,
  UNIQUE (event_id, market)
);

CREATE INDEX IF NOT EXISTS idx_mlts_sport_market ON ml_training_samples(sport, market);
CREATE INDEX IF NOT EXISTS idx_mlts_label        ON ml_training_samples(label) WHERE label IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mlts_commence     ON ml_training_samples(commence_time);
CREATE INDEX IF NOT EXISTS idx_mlts_collected    ON ml_training_samples(collected_at);
