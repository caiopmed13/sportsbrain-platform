// ═══════════════════════════════════════════════════════════════════════════
// tipsterBayesian.js — Ranking Bayesiano dos tipsters com Wilson LCB
// ═══════════════════════════════════════════════════════════════════════════
// Diferença vs TQS atual:
// - TQS atual usa shrinkage simples (boost por sample size)
// - Aqui: Beta-Binomial posterior + Wilson Lower Confidence Bound (95%)
// - LCB filtra "sortudos" (n=3 W=3 = WR raw 100% mas LCB ~30% — descartado)
// - Buckets sustentáveis = LCB > 0.55 (reliable above breakeven)
// ═══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js'

// Wilson Lower Confidence Bound (one-sided 95%) for proportion p = wins/n
// Mais robusto que CI normal pra n pequeno e p próximo de 0/1
function wilsonLCB(wins, n, z = 1.645) {
  if (n === 0) return 0
  const p = wins / n
  const denom = 1 + z * z / n
  const center = p + z * z / (2 * n)
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return Math.max(0, (center - margin) / denom)
}

// Beta-Binomial posterior mean com prior Jeffreys (0.5, 0.5)
function bayesPosteriorMean(wins, losses, priorAlpha = 0.5, priorBeta = 0.5) {
  return (wins + priorAlpha) / (wins + losses + priorAlpha + priorBeta)
}

export async function handleTipsterBayesian(request, env) {
  if (!env?.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    })
  }
  try {
    const url = new URL(request.url)
    const minN = parseInt(url.searchParams.get('min_n') || '5', 10)

    // Lê todas tips resolvidas (W/L)
    const { results } = await env.SB_DB.prepare(
      `SELECT channel_id, channel_name, market, odd, result
       FROM telegram_tips
       WHERE result IN ('W','L') AND odd > 0`
    ).all()

    const tips = results || []
    if (!tips.length) {
      return new Response(JSON.stringify({ ok: false, error: 'no_resolved_tips' }), {
        status: 200, headers: corsHeaders(),
      })
    }

    // Bucketize por (channel, market, odd_band)
    const oddBand = (odd) => {
      if (odd < 1.5) return '<1.5'
      if (odd < 2) return '1.5-2.0'
      if (odd < 3) return '2.0-3.0'
      if (odd < 5) return '3.0-5.0'
      if (odd < 10) return '5.0-10.0'
      return '10.0+'
    }

    const buckets = {}
    for (const t of tips) {
      const market = t.market || 'unknown'
      const band = oddBand(t.odd)
      const key = `${t.channel_id}|${market}|${band}`
      if (!buckets[key]) {
        buckets[key] = {
          channel_id: t.channel_id, channel_name: t.channel_name,
          market, odd_band: band,
          wins: 0, losses: 0, oddSum: 0, n: 0,
        }
      }
      const b = buckets[key]
      b.n++
      b.oddSum += t.odd
      if (t.result === 'W') b.wins++
      else b.losses++
    }

    // Aplica LCB + posterior mean
    const ranked = Object.values(buckets)
      .filter(b => b.n >= minN)
      .map(b => {
        const rawWR = b.wins / b.n
        const lcb = wilsonLCB(b.wins, b.n)
        const posteriorMean = bayesPosteriorMean(b.wins, b.losses)
        const avgOdd = b.oddSum / b.n
        // EV cálculo: posterior mean * avg_odd - 1 (mais conservador que raw_wr * avg_odd - 1)
        const evPosterior = (posteriorMean * avgOdd - 1) * 100
        const evLCB = (lcb * avgOdd - 1) * 100
        return {
          channel_id: b.channel_id,
          channel_name: b.channel_name,
          market: b.market,
          odd_band: b.odd_band,
          n: b.n,
          wins: b.wins,
          losses: b.losses,
          raw_wr: +(rawWR * 100).toFixed(1),
          posterior_mean: +(posteriorMean * 100).toFixed(1),
          wilson_lcb: +(lcb * 100).toFixed(1),
          avg_odd: +avgOdd.toFixed(2),
          ev_posterior_pct: +evPosterior.toFixed(1),
          ev_lcb_pct: +evLCB.toFixed(1),
          // Sustentabilidade: LCB indica edge real ou apenas sorte
          sustainable: lcb > 0.55 && evLCB > 0,  // LCB acima breakeven E EV positivo
          reliable_sample: b.n >= 20,
        }
      })
      .sort((a, b) => b.wilson_lcb - a.wilson_lcb)  // ranking por LCB (não raw_wr!)

    const sustainable = ranked.filter(r => r.sustainable)
    const sustainable_reliable = ranked.filter(r => r.sustainable && r.reliable_sample)
    return new Response(JSON.stringify({
      ok: true,
      method: 'wilson_lcb_one_sided_95',
      prior: 'jeffreys_0.5_0.5',
      total_tips_resolved: tips.length,
      total_buckets: Object.keys(buckets).length,
      eligible_buckets: ranked.length,
      sustainable_buckets: sustainable.length,
      sustainable_reliable_buckets: sustainable_reliable.length,
      // Top 20 sustentáveis com sample reliable (n >= 20)
      top_sustainable: sustainable_reliable.slice(0, 20),
      // Lucky/uncertain: alta WR mas LCB baixo (NÃO use)
      lucky_or_uncertain: ranked
        .filter(r => r.raw_wr >= 80 && r.wilson_lcb < 55)
        .slice(0, 10),
      // Full ranking
      all_ranked: ranked,
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
