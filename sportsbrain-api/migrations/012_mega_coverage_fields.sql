-- migrations/012_mega_coverage_fields.sql
-- Mega Coverage Expansion — add tracking fields to premium_combo_exposures
-- Run via:
--   npx wrangler d1 execute sportsbrain-db --file=./migrations/012_mega_coverage_fields.sql --remote

ALTER TABLE premium_combo_exposures ADD COLUMN mega_size_tier TEXT;
ALTER TABLE premium_combo_exposures ADD COLUMN display_odd    TEXT;
ALTER TABLE premium_combo_exposures ADD COLUMN ev_reliable    INTEGER;  -- 0/1 boolean

CREATE INDEX IF NOT EXISTS idx_pce_size_tier ON premium_combo_exposures(mega_size_tier);
