#!/bin/bash
set -e

echo ""
echo "═══════════════════════════════════════"
echo "   SportsBrain React — Deploy Script"
echo "═══════════════════════════════════════"
echo ""

# Detectar se wrangler está instalado
if ! command -v wrangler &> /dev/null; then
  echo "📦 Instalando Wrangler..."
  npm install -g wrangler
fi

echo "🔑 Fazendo login no Cloudflare (abrirá o browser)..."
wrangler login

echo ""
echo "🔨 Build de produção..."
npm run build

echo ""
echo "🚀 Fazendo deploy no Cloudflare Pages..."
npx wrangler pages deploy dist --project-name=sportsbrain --commit-dirty=true

echo ""
echo "✅ Deploy concluído!"
echo "🌐 Acesse: https://sportsbrain.pages.dev"
echo ""
