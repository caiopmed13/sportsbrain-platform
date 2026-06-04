// ══════════════════════════════════════════════════════════════════════════
// Bayesian Learning v2 — aprende com poucas amostras via shrinkage
//
// PROBLEMA: isotonic calibration precisa N>=100 picks resolvidos.
// SportsBrain hoje tem ~4 W/L (resto é VOID por stats não-resolvíveis).
// SOLUÇÃO: Beta-Binomial com prior do modelo.
//
// Algoritmo:
//   Posterior_prob = (alpha + wins) / (alpha + beta + total)
//   Onde alpha=k*prior, beta=k*(1-prior), k=strength da prior (default 10).
//
// Resultado: multiplier por (sport, market_family) que football.js aplica
// na confidence quando gera picks.
// ══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js'

// Família de mercado (agrupa stats similares)
function marketFamily(stat) {
  const s = (stat || '').toLowerCase()
  if (/goals|gol|over.*\d|under.*\d|mais de|menos de/i.test(s)) return 'goals'
  if (/corner|escanteio/i.test(s)) return 'corners'
  if (/card|cart/i.test(s)) return 'cards'
  if (/btts|ambos.*marca|gols.*ambos/i.test(s)) return 'btts'
  if (/casa|home|fora|away|empate|draw|win|1x2|result/i.test(s)) return 'result'
  if (/double.*chance|chance.*dupla|1x|x2/i.test(s)) return 'double_chance'
  if (/draw.*no.*bet|empate.*anula/i.test(s)) return 'dnb'
  if (/htft|intervalo.*final/i.test(s)) return 'htft'
  if (/score.*range|placar/i.test(s)) return 'score_range'
  if (/clean.*sheet|win.*to.*nil/i.test(s)) return 'clean_sheet'
  if (/spread|handicap/i.test(s)) return 'spread'
  if (/pontos|points|reb|ast|3pt/i.test(s)) return 'nba_player'
  return 'other'
}

// Banda de confidence (4 buckets)
function confBand(conf) {
  if (conf >= 75) return 'high'
  if (conf >= 65) return 'medium'
  if (conf >= 55) return 'low'
  return 'very_low'
}

// Beta-Binomial posterior com strength=k
// Prior strength k controla quanto a prior "puxa" o resultado.
// k=10 → significa que a prior conta tanto quanto 10 observações.
// Com poucas observações, posterior ≈ prior. Com muitas, ≈ MLE.
function beta_binomial_posterior(prior, wins, losses, k = 10) {
  const alpha = k * prior + wins
  const beta = k * (1 - prior) + losses
  return alpha / (alpha + beta)
}

// Multiplier = posterior / prior (clamp pra evitar overshoot com sample pequeno)
function shrinkage_multiplier(prior, wins, losses, k = 10) {
  if (prior <= 0 || prior >= 1) return 1
  const post = beta_binomial_posterior(prior, wins, losses, k)
  const raw_mult = post / prior
  // Clamp em [0.6, 1.4] — sem amostra suficiente, não confia muito
  return Math.max(0.6, Math.min(1.4, raw_mult))
}

export async function handleBayesianLearning(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    })
  }

  try {
    // Lê últimos 1000 picks resolvidos (W/L apenas, V não conta)
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString()
    const { results } = await env.SB_DB.prepare(
      `SELECT sport, league, stat, conf, result FROM pick_history
       WHERE result IN ('W','L') AND saved_at >= ?
       ORDER BY saved_at DESC LIMIT 1000`
    ).bind(cutoff).all()

    const picks = results || []

    // Agrupa por (sport, market_family, conf_band)
    // E também por (sport, market_family, league) pra liga-specific
    const buckets = {}        // key → { wins, losses, conf_sum }
    const leagueBuckets = {}  // key → { wins, losses, conf_sum }

    for (const p of picks) {
      const sport = p.sport || 'football'
      const fam = marketFamily(p.stat)
      const band = confBand(p.conf)
      const league = (p.league || 'unknown').slice(0, 30)
      const isWin = p.result === 'W'

      // Bucket geral (sport × market × conf_band)
      const k1 = `${sport}|${fam}|${band}`
      if (!buckets[k1]) buckets[k1] = { wins: 0, losses: 0, conf_sum: 0 }
      buckets[k1][isWin ? 'wins' : 'losses']++
      buckets[k1].conf_sum += p.conf || 0

      // Bucket por liga (sport × market × league) — só se tiver volume
      const k2 = `${sport}|${fam}|${league}`
      if (!leagueBuckets[k2]) leagueBuckets[k2] = { wins: 0, losses: 0, conf_sum: 0 }
      leagueBuckets[k2][isWin ? 'wins' : 'losses']++
      leagueBuckets[k2].conf_sum += p.conf || 0
    }

    // Calcula multipliers
    const adjustments = {}
    const overall = { wins: 0, losses: 0 }
    for (const p of picks) {
      if (p.result === 'W') overall.wins++
      else overall.losses++
    }
    const overallTotal = overall.wins + overall.losses
    const globalWR = overallTotal > 0 ? overall.wins / overallTotal : 0.5

    // Para cada bucket, calcula multiplier
    for (const [k, b] of Object.entries(buckets)) {
      const total = b.wins + b.losses
      if (total < 1) continue
      const avgConf = b.conf_sum / total
      const prior = avgConf / 100  // prior = confidence média do modelo
      const mult = shrinkage_multiplier(prior, b.wins, b.losses, 10)
      const post = beta_binomial_posterior(prior, b.wins, b.losses, 10)
      adjustments[k] = {
        mult: +mult.toFixed(3),
        prior: +(prior * 100).toFixed(1),
        posterior: +(post * 100).toFixed(1),
        wins: b.wins,
        losses: b.losses,
        n: total,
      }
    }

    // League-specific multipliers (só com N>=3)
    const leagueAdjustments = {}
    for (const [k, b] of Object.entries(leagueBuckets)) {
      const total = b.wins + b.losses
      if (total < 3) continue
      const avgConf = b.conf_sum / total
      const prior = avgConf / 100
      const mult = shrinkage_multiplier(prior, b.wins, b.losses, 8)
      leagueAdjustments[k] = {
        mult: +mult.toFixed(3),
        wins: b.wins, losses: b.losses, n: total,
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      method: 'beta_binomial_shrinkage',
      sample_size: picks.length,
      overall: {
        wins: overall.wins,
        losses: overall.losses,
        win_rate: +(globalWR * 100).toFixed(1),
      },
      adjustments,         // sport|market|conf_band → multiplier
      league_adjustments: leagueAdjustments,  // sport|market|league
      meta: {
        cutoff_days: 90,
        prior_strength: 10,
        clamp_range: [0.6, 1.4],
      },
    }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}

// Helper exportado pra football.js usar diretamente sem fetch
export async function getBayesianMultipliers(env) {
  if (!env.SB_DB) return { adjustments: {}, league_adjustments: {} }
  try {
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString()
    const { results } = await env.SB_DB.prepare(
      `SELECT sport, league, stat, conf, result FROM pick_history
       WHERE result IN ('W','L') AND saved_at >= ?
       ORDER BY saved_at DESC LIMIT 1000`
    ).bind(cutoff).all()
    const picks = results || []
    if (!picks.length) return { adjustments: {}, league_adjustments: {} }

    const buckets = {}
    const leagueBuckets = {}
    for (const p of picks) {
      const sport = p.sport || 'football'
      const fam = marketFamily(p.stat)
      const band = confBand(p.conf)
      const league = (p.league || 'unknown').slice(0, 30)
      const isWin = p.result === 'W'
      const k1 = `${sport}|${fam}|${band}`
      if (!buckets[k1]) buckets[k1] = { wins: 0, losses: 0, conf_sum: 0 }
      buckets[k1][isWin ? 'wins' : 'losses']++
      buckets[k1].conf_sum += p.conf || 0
      const k2 = `${sport}|${fam}|${league}`
      if (!leagueBuckets[k2]) leagueBuckets[k2] = { wins: 0, losses: 0, conf_sum: 0 }
      leagueBuckets[k2][isWin ? 'wins' : 'losses']++
      leagueBuckets[k2].conf_sum += p.conf || 0
    }

    const adjustments = {}
    for (const [k, b] of Object.entries(buckets)) {
      const total = b.wins + b.losses
      if (total < 1) continue
      const prior = (b.conf_sum / total) / 100
      adjustments[k] = shrinkage_multiplier(prior, b.wins, b.losses, 10)
    }
    const league_adjustments = {}
    for (const [k, b] of Object.entries(leagueBuckets)) {
      const total = b.wins + b.losses
      if (total < 3) continue
      const prior = (b.conf_sum / total) / 100
      league_adjustments[k] = shrinkage_multiplier(prior, b.wins, b.losses, 8)
    }
    return { adjustments, league_adjustments, sample_size: picks.length }
  } catch {
    return { adjustments: {}, league_adjustments: {} }
  }
}

// Re-export helpers pra football.js usar
export { marketFamily, confBand }

// ── ML Model Inference: aplica gradient boosting model treinado localmente ──
// Cache em memória (recarrega 1x por request via getMLModel)
function applyStump(stump, sample) {
  return sample[stump.feature] <= stump.threshold ? stump.left_value : stump.right_value
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)) }

export async function getMLModel(env) {
  if (!env.SB_DB) return null
  try {
    const row = await env.SB_DB.prepare(`SELECT version, payload, metrics FROM ml_models WHERE id = 1`).first()
    if (!row?.payload) return null
    const booster = JSON.parse(row.payload)
    return {
      version: row.version,
      booster,
      metrics: row.metrics ? JSON.parse(row.metrics) : null,
    }
  } catch { return null }
}

export function predictML(model, features) {
  if (!model?.booster?.trees) return null
  const b = model.booster
  let pred = b.init_pred
  for (const tree of b.trees) {
    pred += b.learningRate * applyStump(tree, features)
  }
  return sigmoid(pred)
}

// Extrai features do prop pra predição (mesmo schema do training)
export function extractMLFeatures(prop) {
  const stat = prop.stat || ''
  const sLow = stat.toLowerCase()
  let family = 8  // other
  if (/goals|gol|over|under|mais de|menos de/.test(sLow)) family = 0
  else if (/corner|escanteio/.test(sLow)) family = 1
  else if (/card|cart/.test(sLow)) family = 2
  else if (/btts|ambos.*marca/.test(sLow)) family = 3
  else if (/casa|home|fora|away|empate|draw|win|1x2/.test(sLow)) family = 4
  else if (/double.*chance|chance.*dupla/.test(sLow)) family = 5
  else if (/htft|intervalo/.test(sLow)) family = 6
  else if (/pontos|points|reb|ast/.test(sLow)) family = 7

  const lLow = (prop.league || '').toLowerCase()
  let tier = 3
  if (/premier league|la liga|serie a|bundesliga|ligue 1|champions/.test(lLow)) tier = 1
  else if (/serie b|championship|libertadores|sudamericana|brasileirao|nba/.test(lLow)) tier = 2

  return {
    conf: (prop.confidence || 50) / 100,
    odd: parseFloat(prop.book_odds || prop.real_odd || 2.0) || 2.0,
    ev: parseFloat(prop.ev_pct || prop.edge_pct || 0) || 0,
    family,
    tier,
    line: prop.line || 0,
    hour: 12,
    sport: 0,
  }
}
