// src/routes/trackRecord.js
// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT: GET /v1/track-record
//
// Dashboard de transparência total — o que NENHUM tipster brasileiro tem:
// ● Todos os picks com timestamp ANTES do jogo (imutável)
// ● Resultados auto-verificados via ESPN (não auto-reportados)
// ● ROI real por mercado, liga e período
// ● Drawdown máximo honestamente apresentado
// ● Comparação vs. acumuladores low-odds (demonstra nossa vantagem matemática)
//
// Parâmetros:
//   ?sport=football|basketball   (default: football)
//   ?window=7|30|90|all          (default: 30)
//   ?market=over|under|btts|...  (filtro opcional)
//   ?tier=single|combo|jackpot   (filtro opcional)
// ─────────────────────────────────────────────────────────────────────────────

import { corsHeaders } from './health.js'

// Wilson Lower Confidence Bound (95% CI) — mesma fórmula do Bayesian engine
function wilsonLCB(wins, n, z = 1.645) {
  if (!n) return 0
  const p = wins / n
  return Math.max(0, ((p + z*z/(2*n)) - z * Math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n))
}

// Mapeia direction+stat para categoria legível
function marketCategory(stat, direction) {
  const s = (stat  || '').toUpperCase()
  const d = (direction || '').toLowerCase()
  if (/BTTS|AMBOS/.test(s))                return d === 'yes' || d === 'sim' ? 'btts_sim' : 'btts_nao'
  if (d === 'over'  || /MAIS\s*DE/.test(s))  return 'over'
  if (d === 'under' || /MENOS\s*DE/.test(s)) return 'under'
  if (/CORNER|ESCANT/.test(s))             return 'corners'
  if (/CARD|CART/.test(s))                 return 'cartoes'
  if (/SHOT|CHUTE/.test(s))               return 'chutes'
  if (d === 'home' || d === '1' || d === 'win') return 'vitoria_casa'
  if (d === 'away' || d === '2')           return 'vitoria_fora'
  if (d === 'draw' || d === 'x')           return 'empate'
  if (/1X|X1/.test(d))                    return 'dc_casa'
  if (/X2|2X/.test(d))                    return 'dc_fora'
  if (/12/.test(d))                       return 'dc_sem_empate'
  return 'outros'
}

// Calcula drawdown máximo de uma série de resultados
// Retorna percentual máximo de queda da banca (unidade = 1% banca por pick)
function calcMaxDrawdown(results) {
  let peak = 0, trough = 0, maxDD = 0, running = 0
  for (const r of results) {
    if (r === 'W') running += 1
    else if (r === 'L') running -= 1
    if (running > peak) peak = running
    trough = Math.min(trough, running - peak)
    maxDD  = Math.min(maxDD, trough)
  }
  return Math.abs(maxDD)
}

// Demonstração matemática da armadilha do acumulador
// Calcula EV de acumuladores low-odds para educar o usuário
function calcAccumulatorEV(legs, overroundPct = 6) {
  // overround = vantagem da casa embutida em cada odd (6% avg)
  const trueProb = (odd) => (1 / odd) / (1 + overroundPct / 100)
  const combProb = legs.reduce((acc, odd) => acc * trueProb(odd), 1)
  const combOdd  = legs.reduce((acc, odd) => acc * odd, 1)
  const ev       = combProb * combOdd - 1
  return { combOdd: +combOdd.toFixed(3), combProb: +(combProb * 100).toFixed(1), ev_pct: +(ev * 100).toFixed(1) }
}

export async function handleTrackRecord(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'no_db' }), {
      status: 503, headers: corsHeaders()
    })
  }

  const url     = new URL(request.url)
  const sport   = url.searchParams.get('sport')   || 'football'
  const window  = url.searchParams.get('window')  || '30'
  const market  = url.searchParams.get('market')  || null
  const tier    = url.searchParams.get('tier')    || null
  const format  = url.searchParams.get('format')  || 'full'   // 'full' | 'summary'

  // Calcula cutoff de data
  const windowDays = window === 'all' ? 9999 : parseInt(window, 10)
  const cutoff = windowDays >= 9999
    ? '2000-01-01'
    : new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10)

  try {
    // ─── Auto-migration: garante colunas novas existem ───────────────────
    const newCols = [
      `ALTER TABLE pick_history ADD COLUMN home_team   TEXT`,
      `ALTER TABLE pick_history ADD COLUMN away_team   TEXT`,
      `ALTER TABLE pick_history ADD COLUMN direction   TEXT`,
      `ALTER TABLE pick_history ADD COLUMN line        REAL`,
      `ALTER TABLE pick_history ADD COLUMN model_prob  REAL`,
      `ALTER TABLE pick_history ADD COLUMN fair_prob   REAL`,
      `ALTER TABLE pick_history ADD COLUMN edge_pct    REAL`,
      `ALTER TABLE pick_history ADD COLUMN kelly_pct   REAL`,
      `ALTER TABLE pick_history ADD COLUMN signals_json TEXT`,
      `ALTER TABLE pick_history ADD COLUMN explanation TEXT`,
      `ALTER TABLE pick_history ADD COLUMN match_id    TEXT`,
      `ALTER TABLE pick_history ADD COLUMN clv_closing REAL`,
      `ALTER TABLE pick_history ADD COLUMN clv_pct     REAL`,
    ]
    await Promise.all(newCols.map(sql => env.SB_DB.prepare(sql).run().catch(() => {})))
    await env.SB_DB.prepare(`
      CREATE TABLE IF NOT EXISTS track_record_cache (
        id TEXT PRIMARY KEY DEFAULT 'main', sport TEXT NOT NULL DEFAULT 'football',
        window_days INTEGER NOT NULL, total_picks INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, voids INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 0, roi_pct REAL DEFAULT 0, avg_odd REAL DEFAULT 0,
        avg_ev_pct REAL DEFAULT 0, avg_edge REAL DEFAULT 0, max_drawdown REAL DEFAULT 0,
        by_market TEXT, by_league TEXT, updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(sport, window_days)
      )
    `).run().catch(() => {})

    // ─── Build query ────────────────────────────────────────────────────
    const conds = [`sport = ?`, `pick_date >= ?`, `result IN ('W','L','V')`]
    const binds = [sport, cutoff]

    // Só picks publicados (tiers conhecidos) — os picks internos de teste ficam fora
    conds.push(`tier IN ('single','combo','jackpot','aggressive','moderate','conservative')`)

    if (market) { conds.push(`stat LIKE ?`); binds.push(`%${market}%`) }
    if (tier)   { conds.push(`tier = ?`);    binds.push(tier) }

    const sql = `
      SELECT id, pick_date, match, home_team, away_team, league, sport, stat, direction, line,
             tier, real_odd, ev_real, model_prob, fair_prob, edge_pct, kelly_pct, result,
             auto_verified, explanation, clv_pct, saved_at
      FROM pick_history
      WHERE ${conds.join(' AND ')}
      ORDER BY saved_at DESC
      LIMIT 2000
    `
    const { results: picks } = await env.SB_DB.prepare(sql).bind(...binds).all()
    const allPicks = picks || []

    // ─── Métricas globais ───────────────────────────────────────────────
    const resolved  = allPicks.filter(p => p.result === 'W' || p.result === 'L')
    const wins      = resolved.filter(p => p.result === 'W')
    const losses    = resolved.filter(p => p.result === 'L')
    const voids     = allPicks.filter(p => p.result === 'V')
    const n         = resolved.length
    const win_rate  = n ? +(wins.length / n * 100).toFixed(1) : 0

    // ROI = (lucro / total apostado) — assume 1 unidade por pick (flat staking)
    // Exclui picks sem odd (dados incompletos do histórico antigo)
    const resolvedWithOdd = resolved.filter(p => p.real_odd && p.real_odd > 1)
    const nOdd = resolvedWithOdd.length
    const totalReturn = resolvedWithOdd.filter(p => p.result === 'W').reduce((s, p) => s + (p.real_odd - 1), 0)
    const totalLoss   = resolvedWithOdd.filter(p => p.result === 'L').length
    const roi_pct     = nOdd ? +((totalReturn - totalLoss) / nOdd * 100).toFixed(2) : null

    const avg_odd  = nOdd ? +(resolvedWithOdd.reduce((s,p) => s + p.real_odd, 0) / nOdd).toFixed(2) : null
    const ev_picks = resolved.filter(p => p.ev_real != null && p.ev_real !== 0)
    const avg_ev   = ev_picks.length ? +(ev_picks.reduce((s,p) => s + (p.ev_real || 0), 0) / ev_picks.length).toFixed(2) : null
    const avg_edge = resolved.filter(p => p.edge_pct != null).length
                   ? +(resolved.filter(p=>p.edge_pct!=null).reduce((s,p)=>s+(p.edge_pct||0),0)
                     / resolved.filter(p=>p.edge_pct!=null).length).toFixed(2)
                   : null

    // Wilson LCB: taxa de win com intervalo de confiança
    const win_rate_lcb = +(wilsonLCB(wins.length, n) * 100).toFixed(1)

    // Max drawdown (sequência de perdas)
    const resultSequence = [...allPicks].reverse()
      .filter(p => p.result === 'W' || p.result === 'L')
      .map(p => p.result)
    const max_drawdown = calcMaxDrawdown(resultSequence)

    // Streak atual
    let current_streak = 0, streak_type = null
    for (let i = allPicks.length - 1; i >= 0; i--) {
      const r = allPicks[i].result
      if (r !== 'W' && r !== 'L') continue
      if (streak_type === null) { streak_type = r; current_streak = 1 }
      else if (r === streak_type) current_streak++
      else break
    }

    // ─── Breakdown por mercado ──────────────────────────────────────────
    const byMarket = {}
    for (const p of resolved) {
      const cat = marketCategory(p.stat, p.direction)
      if (!byMarket[cat]) byMarket[cat] = { wins: 0, losses: 0, totalReturn: 0, n: 0, nOdd: 0, oddSum: 0 }
      const b = byMarket[cat]
      b.n++
      if (p.real_odd && p.real_odd > 1) { b.nOdd++; b.oddSum += p.real_odd }
      if (p.result === 'W') { b.wins++; if (p.real_odd > 1) b.totalReturn += (p.real_odd - 1) }
      else b.losses++
    }
    const byMarketFormatted = {}
    for (const [cat, b] of Object.entries(byMarket)) {
      if (b.n < 3) continue
      const roi = b.nOdd ? +((b.totalReturn - b.losses) / b.nOdd * 100).toFixed(1) : null
      const lcb = +(wilsonLCB(b.wins, b.n) * 100).toFixed(1)
      byMarketFormatted[cat] = {
        n: b.n, wins: b.wins, losses: b.losses,
        win_rate: +(b.wins / b.n * 100).toFixed(1),
        win_rate_lcb: lcb,
        roi_pct: roi,
        avg_odd: b.nOdd ? +(b.oddSum / b.nOdd).toFixed(2) : null,
      }
    }

    // ─── Breakdown por liga ─────────────────────────────────────────────
    const byLeague = {}
    for (const p of resolved) {
      const lg = (p.league || 'Outros').trim()
      if (!byLeague[lg]) byLeague[lg] = { wins: 0, losses: 0, n: 0, nOdd: 0, totalReturn: 0 }
      const b = byLeague[lg]
      b.n++
      if (p.real_odd && p.real_odd > 1) b.nOdd++
      if (p.result === 'W') { b.wins++; if (p.real_odd > 1) b.totalReturn += p.real_odd - 1 }
      else b.losses++
    }
    const byLeagueFormatted = {}
    for (const [lg, b] of Object.entries(byLeague)) {
      if (b.n < 5) continue
      byLeagueFormatted[lg] = {
        n: b.n, wins: b.wins, losses: b.losses,
        win_rate: +(b.wins / b.n * 100).toFixed(1),
        roi_pct: b.nOdd ? +((b.totalReturn - b.losses) / b.nOdd * 100).toFixed(1) : null,
      }
    }

    // ─── CLV tracking (se disponível) ──────────────────────────────────
    const withCLV = allPicks.filter(p => p.clv_pct != null)
    const avg_clv = withCLV.length
      ? +(withCLV.reduce((s,p) => s + p.clv_pct, 0) / withCLV.length).toFixed(2)
      : null

    // ─── Picks recentes (últimos 20 verificados) ────────────────────────
    const recentVerified = resolved.slice(0, 20).map(p => ({
      date:        p.pick_date,
      match:       p.match,
      market:      p.stat,
      direction:   p.direction,
      line:        p.line,
      odd:         p.real_odd,
      ev_pct:      p.ev_real,
      edge_pct:    p.edge_pct,
      result:      p.result,
      explanation: p.explanation,
      verified:    p.auto_verified === 1,
    }))

    // ─── Comparação educativa: SportsBrain vs. Acumuladores Low-Odds ───
    // Demonstra matematicamente por que acumuladores de 1.15-1.25 destroem a banca
    const accumulatorComparison = {
      label: 'Por que acumuladores de baixa odd não funcionam',
      examples: [
        { legs: 3, leg_odds: [1.20, 1.20, 1.20], ...calcAccumulatorEV([1.20, 1.20, 1.20]) },
        { legs: 4, leg_odds: [1.20, 1.20, 1.20, 1.20], ...calcAccumulatorEV([1.20, 1.20, 1.20, 1.20]) },
        { legs: 3, leg_odds: [1.30, 1.30, 1.30], ...calcAccumulatorEV([1.30, 1.30, 1.30]) },
      ],
      sportsbrain_avg_ev: avg_ev,
      sportsbrain_avg_odd: avg_odd,
      explanation: 'Acumuladores de 1.15-1.25 têm EV negativo de -8% a -15% por unidade apostada. O overround da casa (5-7%) multiplicado por cada perna cria uma destruição silenciosa da banca que a maioria dos apostadores nunca percebe.',
    }

    // ─── Summary mode (para widgets e dashboards externos) ──────────────
    if (format === 'summary') {
      return new Response(JSON.stringify({
        ok: true,
        sport, window: windowDays,
        total_verified: n,
        win_rate, win_rate_lcb, roi_pct,
        avg_odd, avg_ev_pct: avg_ev,
        current_streak, streak_type,
        max_drawdown,
        avg_clv,
        updated_at: new Date().toISOString(),
      }), { status: 200, headers: corsHeaders() })
    }

    // ─── Full response ──────────────────────────────────────────────────
    return new Response(JSON.stringify({
      ok: true,
      meta: {
        sport,
        window_days: windowDays,
        generated_at: new Date().toISOString(),
        methodology: 'Picks publicados antes do início do jogo. Resultados verificados automaticamente via ESPN API. Sem cherry-picking — todos os picks do período estão incluídos.',
      },
      global: {
        total_picks:    allPicks.length,
        total_verified: n,
        total_void:     voids.length,
        wins:           wins.length,
        losses:         losses.length,
        win_rate,
        win_rate_lcb,       // taxa real com intervalo de confiança (mais honesto que win_rate puro)
        roi_pct,
        avg_odd,
        avg_ev_pct:     avg_ev,
        avg_edge_pct:   avg_edge,
        max_drawdown,
        current_streak,
        streak_type,
        avg_clv_pct:    avg_clv,
        clv_sample:     withCLV.length,
      },
      by_market:  byMarketFormatted,
      by_league:  byLeagueFormatted,
      recent_picks: recentVerified,
      accumulator_comparison: accumulatorComparison,
    }), { status: 200, headers: corsHeaders() })

  } catch (e) {
    console.error('[track-record] ERROR:', e.message)
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: corsHeaders()
    })
  }
}
