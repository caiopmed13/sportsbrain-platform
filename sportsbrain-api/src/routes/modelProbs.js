// modelProbs.js — D1 read/write para probabilidades do modelo próprio (logistic regression)
// Treinado semanalmente via scripts/train_model.py (GitHub Actions cron domingo 01h UTC)
//
// Exports:
//   handleUpdateModelProbs(request, env) — POST /internal/update-model-probs
//   handleGetModelProb(env, marketFamily, oddBand, leagueTier) — função interna

import { corsHeaders } from './health.js'
import { isValidIngestSecret } from '../utils/ingestAuth.js'

async function ensureModelProbsTable(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS model_probs (id INTEGER PRIMARY KEY AUTOINCREMENT, market_family TEXT NOT NULL, odd_band TEXT NOT NULL, league_tier INTEGER NOT NULL DEFAULT 0, predicted_prob REAL NOT NULL, n_samples INTEGER NOT NULL DEFAULT 0, n_green INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(market_family, odd_band, league_tier))`)
}

// POST /internal/update-model-probs
// Body: { buckets: [{ market_family, odd_band, league_tier, predicted_prob, n_samples, n_green }] }
// Auth: X-Ingest-Secret header
export async function handleUpdateModelProbs(request, env) {
  if (!isValidIngestSecret(request, env)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  if (!env.SB_DB) {
    return new Response(JSON.stringify({ error: 'no db' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  const buckets = Array.isArray(body?.buckets) ? body.buckets : []
  if (buckets.length === 0) {
    return new Response(JSON.stringify({ error: 'no_buckets' }), {
      status: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  try {
    await ensureModelProbsTable(env.SB_DB)

    let updated = 0
    for (const b of buckets) {
      const { market_family, odd_band, league_tier, predicted_prob, n_samples, n_green } = b
      if (!market_family || !odd_band || predicted_prob == null) continue
      await env.SB_DB.prepare(`
        INSERT INTO model_probs (market_family, odd_band, league_tier, predicted_prob, n_samples, n_green, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(market_family, odd_band, league_tier) DO UPDATE SET
          predicted_prob = excluded.predicted_prob,
          n_samples = excluded.n_samples,
          n_green = excluded.n_green,
          updated_at = excluded.updated_at
      `).bind(
        String(market_family),
        String(odd_band),
        Number(league_tier ?? 0),
        Number(predicted_prob),
        Number(n_samples ?? 0),
        Number(n_green ?? 0)
      ).run()
      updated++
    }

    console.log(`[model-probs] updated ${updated} buckets`)
    return new Response(JSON.stringify({ ok: true, updated }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('[model-probs] update error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }
}

// Função interna (não é rota HTTP) — busca prob do modelo para uma combinação de features
// Retorna { predicted_prob, n_samples } ou null se não encontrado / n_samples < 5
export async function handleGetModelProb(env, marketFamily, oddBand, leagueTier) {
  if (!env.SB_DB || !marketFamily || !oddBand) return null
  try {
    const row = await env.SB_DB.prepare(`
      SELECT predicted_prob, n_samples
      FROM model_probs
      WHERE market_family = ? AND odd_band = ? AND league_tier = ?
    `).bind(
      String(marketFamily),
      String(oddBand),
      Number(leagueTier ?? 0)
    ).first()
    if (!row || row.n_samples < 5) return null
    return { predicted_prob: row.predicted_prob, n_samples: row.n_samples }
  } catch {
    return null
  }
}
