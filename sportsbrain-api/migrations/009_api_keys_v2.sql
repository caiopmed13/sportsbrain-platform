-- ══════════════════════════════════════════════════════════════════
-- Migration 009: API Keys v2 — Planos comerciais VIP + Internal
-- ══════════════════════════════════════════════════════════════════
-- Execute via:
--   wrangler d1 execute sportsbrain-db --file=./migrations/009_api_keys_v2.sql
--
-- A tabela api_keys já existe (schema.sql). Esta migration:
--   1. Adiciona índice por plan para queries de rate limit serem rápidas
--   2. Insere uma API key de plano 'internal' para uso interno do SportsBrain
--   3. Documenta os planos v2 via comentários
-- ══════════════════════════════════════════════════════════════════

-- ── Planos v2 e seus limites ──────────────────────────────────────────────
-- free:     100 req/hora  | 3.000 req/mês    | endpoints: /v2/picks/premium (limitado)
-- vip:      208 req/hora  | 5.000 req/mês    | endpoints: /v2/picks/premium, greens, history
-- pro:    4.167 req/hora  | 100.000 req/mês  | endpoints: todos
-- internal: ilimitado     | ilimitado         | endpoints: todos + debug=1

-- ── Índice por plan (acelera consultas de audit) ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_api_keys_plan ON api_keys(plan, active);

-- ── API key interna padrão ────────────────────────────────────────────────
-- NOTA: Esta key usa um hash fixo para ser reproduzível.
-- Em produção, crie chaves reais via POST /v1/admin/keys
-- com X-Admin-Key: <SB_MASTER_KEY>.
--
-- key_hash = simpleHash('sb_internal_sportsbrain2026')
-- (função simpleHash do admin.js, mesmo algoritmo do index.js)
-- Para gerar a key real: POST /v1/admin/keys {"plan":"internal","owner_email":"admin@sportsbrain.app"}
INSERT OR IGNORE INTO api_keys (key_hash, plan, owner_email, rate_limit, modules, active)
VALUES (
  'sportsbrain_internal_placeholder',
  'internal',
  'admin@sportsbrain.app',
  999999,
  '["*"]',
  0   -- DESATIVADA por padrão — ative via /v1/admin/keys ou crie uma real
);

-- ── Comentário de referência dos planos ───────────────────────────────────
-- Para criar uma API key VIP via CLI:
--   curl -X POST https://sportsbrain-api.caiopaulosouza.workers.dev/v1/admin/keys \
--        -H "X-Admin-Key: $SB_MASTER_KEY" \
--        -H "Content-Type: application/json" \
--        -d '{"plan":"vip","owner_email":"usuario@email.com"}'
--
-- Resposta:
--   { "ok": true, "api_key": "sb_vip_xxxx...", "plan": "vip", "rate_limit_hour": 208 }
--
-- Para criar uma API key internal (para debug=1 em picks/premium):
--   curl -X POST ... -d '{"plan":"internal","owner_email":"dev@sportsbrain.app"}'
