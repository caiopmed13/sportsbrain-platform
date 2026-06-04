/**
 * /v1/ai/learning  GET  — analisa histórico de picks (W/L) e retorna ajustes
 *                          de confidence pra cada combinação (sport, market, edge_range).
 *
 * Pipeline:
 *   1. Lê todos picks com result definido (won/lost) do user_picks
 *   2. Agrupa por (sport, market, edge_bucket) — ex: futebol/1X2/edge3-5%
 *   3. Calcula hit rate vs expected (model_prob)
 *   4. Retorna multiplier por bucket (>1 = modelo subestimou, <1 = superestimou)
 *
 * Frontend usa pra ajustar prob/EV exibido nos picks novos.
 */
import { corsHeaders } from './health.js'

function getUserId(request) {
  return request.headers.get('X-User-Id') || 'anon'
}

function bucketEdge(ev) {
  if (ev == null) return 'na'
  if (ev < 0) return 'neg'
  if (ev < 2) return 'low'
  if (ev < 5) return 'medium'
  if (ev < 8) return 'high'
  return 'gold'
}

function bucketSport(comp) {
  const c = (comp || '').toLowerCase()
  if (/\bnba\b/.test(c)) return 'nba'
  if (/\bnbb\b|basquete/.test(c)) return 'nbb'
  if (/t[êe]nis|atp|wta/.test(c)) return 'tennis'
  return 'futebol'
}

export async function handleAILearning(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE', adjustments: {} }), {
      status: 503, headers: corsHeaders(),
    })
  }
  const uid = getUserId(request)
  try {
    // Verifica se tabela existe
    await env.SB_DB.exec(
      `CREATE TABLE IF NOT EXISTS user_picks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
    )
    const rows = await env.SB_DB.prepare(
      `SELECT payload, status FROM user_picks WHERE user_id = ? AND status IN ('won','lost')`
    ).bind(uid).all()

    const buckets = {}  // key: sport_market_evbucket → {wins, losses, totalEV, count}
    const overall = { wins: 0, losses: 0, count: 0 }

    for (const row of rows?.results || []) {
      let p = {}
      try { p = JSON.parse(row.payload) } catch {}
      const status = row.status
      // Cada combo pode ter múltiplas legs; agrega cada leg pro bucket
      const legs = p.legs || (p.market ? [{ market: p.market, ev: p.ev, fairProb: p.fairProb || p.prob, competition: p.competition || p.league }] : [])
      for (const leg of legs) {
        const sport = bucketSport(leg.competition)
        const mk = leg.market || 'unknown'
        const eb = bucketEdge(leg.ev)
        const key = `${sport}|${mk}|${eb}`
        if (!buckets[key]) buckets[key] = { wins: 0, losses: 0, count: 0, expectedHits: 0 }
        if (status === 'won') buckets[key].wins++
        else buckets[key].losses++
        buckets[key].count++
        buckets[key].expectedHits += (leg.fairProb || 0)
      }
      if (status === 'won') overall.wins++
      else overall.losses++
      overall.count++
    }

    // Calcula multiplier por bucket
    const adjustments = {}
    for (const [key, b] of Object.entries(buckets)) {
      if (b.count < 3) continue  // ignora samples muito pequenos
      const actualHitRate = b.wins / b.count
      const expectedHitRate = b.expectedHits / b.count
      // Multiplier: prob ajustada = prob × (actual/expected)
      // Clamp em [0.7, 1.3] pra evitar overfitting com poucas amostras
      const rawMult = expectedHitRate > 0 ? actualHitRate / expectedHitRate : 1
      const mult = Math.max(0.7, Math.min(1.3, rawMult))
      adjustments[key] = {
        mult: +mult.toFixed(3),
        actual: +(actualHitRate * 100).toFixed(1),
        expected: +(expectedHitRate * 100).toFixed(1),
        n: b.count,
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      uid,
      overall,
      hitRate: overall.count > 0 ? +(overall.wins / overall.count * 100).toFixed(1) : null,
      adjustments,
      sampleSize: rows?.results?.length || 0,
    }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
