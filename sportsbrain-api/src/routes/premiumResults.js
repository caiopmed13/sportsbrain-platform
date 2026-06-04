// premiumResults.js — Resultados do dia: picks gerados pela IA do Premium (pick_history)
// Mostra os picks resolvidos mais recentes para a aba ONTEM.
import { corsHeaders } from './health.js'

export async function handlePremiumResults(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    const url   = new URL(request.url)
    const sport = url.searchParams.get('sport') || 'football'
    const days  = Math.min(parseInt(url.searchParams.get('days') || '2', 10), 30)

    // Picks dos últimos N dias (inclui hoje) — sem excluir o dia atual
    const cutoffDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

    // Busca TODOS os picks recentes — resolvidos (W/L/V) e pendentes do dia atual
    const phRows = await env.SB_DB.prepare(`
      SELECT id, pick_date, match, league, sport, stat, direction, line,
             conf, tier, real_odd, ev_real, result, auto_verified, saved_at
      FROM pick_history
      WHERE sport = ? AND pick_date >= ?
      ORDER BY pick_date DESC, saved_at DESC
      LIMIT 5000
    `).bind(sport, cutoffDate).all().catch(e => { console.error('premiumResults query error:', e); return { results: [] } })

    const picks = (phRows.results || []).map(r => ({
      source: 'pick_history',
      id: r.id,
      date: r.pick_date,
      match: r.match,
      league: r.league,
      stat: r.stat,
      direction: r.direction,
      line: r.line,
      conf: r.conf,
      odd: r.real_odd,
      ev: r.ev_real,
      tier: r.tier,
      result: r.result ?? null,
      auto_verified: !!r.auto_verified,
      saved_at: r.saved_at,
    }))

    const wins    = picks.filter(r => r.result === 'W').length
    const losses  = picks.filter(r => r.result === 'L').length
    const voids   = picks.filter(r => r.result === 'V').length
    const pending = picks.filter(r => !r.result).length
    const resolved = wins + losses
    const oddsArr   = picks.filter(r => r.result === 'W' || r.result === 'L').map(r => r.odd).filter(Boolean)
    const avgOdd    = oddsArr.length ? +(oddsArr.reduce((s, v) => s + v, 0) / oddsArr.length).toFixed(2) : null

    // Agrupa por data para o frontend exibir por dia
    const byDate = {}
    for (const p of picks) {
      if (!byDate[p.date]) byDate[p.date] = []
      byDate[p.date].push(p)
    }

    return new Response(JSON.stringify({
      ok: true,
      days,
      sport,
      summary: {
        total: picks.length,
        wins,
        losses,
        voids,
        pending,
        wr_pct: resolved > 0 ? +((wins / resolved) * 100).toFixed(1) : null,
        avg_odd: avgOdd,
      },
      picks,
      by_date: byDate,
    }), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'no-cache' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}
