#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# SportsBrain Data API — Deploy Script
# ─────────────────────────────────────────────────────────────────
# Usage:
#   export CLOUDFLARE_API_TOKEN=<your-token>
#   bash deploy.sh
#
# Get your token at: https://dash.cloudflare.com/profile/api-tokens
# Required permissions: Workers Scripts:Edit, Account KV:Edit, D1:Edit
# ─────────────────────────────────────────────────────────────────

set -e

echo "═══════════════════════════════════════════════════════"
echo "  SportsBrain Data API — Deployment"
echo "═══════════════════════════════════════════════════════"

# Check token
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "❌ ERROR: CLOUDFLARE_API_TOKEN is not set."
  echo "   Get your token at: https://dash.cloudflare.com/profile/api-tokens"
  exit 1
fi

# Step 1: Create D1 database
echo ""
echo "▶ Step 1: Creating D1 database..."
DB_RESULT=$(npx wrangler d1 create sportsbrain-db 2>&1) || true
DB_ID=$(echo "$DB_RESULT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2)
if [ -n "$DB_ID" ]; then
  echo "  ✅ D1 database created: $DB_ID"
  # Update wrangler.toml with the real DB ID
  sed -i "s/database_id = \"REPLACE_AFTER_CREATION\"/database_id = \"$DB_ID\"/" wrangler.toml
  # Uncomment D1 binding
  sed -i 's/# \[\[d1_databases\]\]/[[d1_databases]]/' wrangler.toml
  sed -i 's/# binding = "SB_DB"/binding = "SB_DB"/' wrangler.toml
  sed -i 's/# database_name = "sportsbrain-db"/database_name = "sportsbrain-db"/' wrangler.toml
  sed -i "s/# database_id = \"REPLACE_AFTER_CREATION\"/database_id = \"$DB_ID\"/" wrangler.toml
else
  echo "  ℹ DB already exists or: $DB_RESULT"
fi

# Step 2: Initialize D1 schema
echo ""
echo "▶ Step 2: Initializing D1 schema..."
npx wrangler d1 execute sportsbrain-db --file=./schema.sql --yes
echo "  ✅ Schema applied"

# Step 3: Deploy Worker
echo ""
echo "▶ Step 3: Deploying Worker..."
npx wrangler deploy
echo "  ✅ Worker deployed"

# Step 4: Print endpoint
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ SportsBrain Data API is LIVE"
echo ""
echo "  Test your endpoints:"
echo "  curl https://sportsbrain-api.<your-account>.workers.dev/health"
echo "  curl https://sportsbrain-api.<your-account>.workers.dev/v1/basketball/games/today"
echo "  curl https://sportsbrain-api.<your-account>.workers.dev/v1/football/games/today"
echo "  curl https://sportsbrain-api.<your-account>.workers.dev/v1/intelligence/picks/today"
echo ""
echo "  Optional: set API keys as secrets:"
echo "  npx wrangler secret put FOOTBALL_DATA_API_KEY"
echo "  npx wrangler secret put API_FOOTBALL_KEY"
echo "  npx wrangler secret put ODDS_API_KEY"
echo "═══════════════════════════════════════════════════════"
