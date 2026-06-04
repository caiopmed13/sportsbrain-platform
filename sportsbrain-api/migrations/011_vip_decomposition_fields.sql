-- ══════════════════════════════════════════════════════════════════════════
-- Migration 011: VIP Decomposition fields
-- Adds method_group_id, decomposition_level, parent_combo_id + leg tracking
-- to premium_pick_exposures, and full VIP metadata to premium_combo_exposures.
-- ══════════════════════════════════════════════════════════════════════════
-- Execute via:
--   wrangler d1 execute sportsbrain-db --file=./migrations/011_vip_decomposition_fields.sql --remote
-- ══════════════════════════════════════════════════════════════════════════

-- ── premium_pick_exposures — per-leg VIP tracking ─────────────────────────
ALTER TABLE premium_pick_exposures ADD COLUMN method_group_id     TEXT;
ALTER TABLE premium_pick_exposures ADD COLUMN decomposition_level TEXT;
ALTER TABLE premium_pick_exposures ADD COLUMN pairing_strategy    TEXT;
ALTER TABLE premium_pick_exposures ADD COLUMN game_block_count    INTEGER;
ALTER TABLE premium_pick_exposures ADD COLUMN risk_profile        TEXT;
ALTER TABLE premium_pick_exposures ADD COLUMN derived_from_mega   INTEGER DEFAULT 0;
ALTER TABLE premium_pick_exposures ADD COLUMN original_mega_odd   REAL;
ALTER TABLE premium_pick_exposures ADD COLUMN parent_combo_id     TEXT;
ALTER TABLE premium_pick_exposures ADD COLUMN leg_index           INTEGER;
ALTER TABLE premium_pick_exposures ADD COLUMN block_index         INTEGER;

CREATE INDEX IF NOT EXISTS idx_ppe_method_group ON premium_pick_exposures(method_group_id);
CREATE INDEX IF NOT EXISTS idx_ppe_decomp_level ON premium_pick_exposures(decomposition_level);
CREATE INDEX IF NOT EXISTS idx_ppe_parent       ON premium_pick_exposures(parent_combo_id);

-- ── premium_combo_exposures — full VIP combo metadata ────────────────────
ALTER TABLE premium_combo_exposures ADD COLUMN method_group_id       TEXT;
ALTER TABLE premium_combo_exposures ADD COLUMN parent_combo_id       TEXT;
ALTER TABLE premium_combo_exposures ADD COLUMN decomposition_level   TEXT;
ALTER TABLE premium_combo_exposures ADD COLUMN pairing_strategy      TEXT;
ALTER TABLE premium_combo_exposures ADD COLUMN game_block_count      INTEGER;
ALTER TABLE premium_combo_exposures ADD COLUMN total_legs            INTEGER;
ALTER TABLE premium_combo_exposures ADD COLUMN original_mega_odd     REAL;
ALTER TABLE premium_combo_exposures ADD COLUMN risk_profile          TEXT;
ALTER TABLE premium_combo_exposures ADD COLUMN recommended_stake_unit REAL;

CREATE INDEX IF NOT EXISTS idx_pce_method_group ON premium_combo_exposures(method_group_id);
CREATE INDEX IF NOT EXISTS idx_pce_decomp_level ON premium_combo_exposures(decomposition_level);
CREATE INDEX IF NOT EXISTS idx_pce_parent       ON premium_combo_exposures(parent_combo_id);
