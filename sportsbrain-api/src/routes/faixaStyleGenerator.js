// ═══════════════════════════════════════════════════════════════════════════
// faixaStyleGenerator.js — Aprende padrões de combos W e gera no mesmo estilo
// ═══════════════════════════════════════════════════════════════════════════
//
// PIPELINE:
// 1. Lê telegram_tips W/L com combo_group_id (combos agrupados)
// 2. Extrai padrões de combos W (avg legs, markets, odds individuais)
// 3. Gera combos similares com nossos picks (football + basketball)
// 4. Retorna formatado pra vender (template Telegram + JSON)
//
// PATTERN LEARNED FAIXA VIP:
// - 4 legs por combo (modal)
// - Odd individual 4-15 (longshots near-fair)
// - Mercados: CORNERS_OU, BTTS, DOUBLE_CHANCE, PLAYER_SHOTS
// - Combined odd 100-50000 (jackpots)
// ═══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js'

// Recupera times de raw_text quando parser só pegou 1 (ou 0)
function recoverTeams(teams, rawText) {
  let t1 = teams[0] || ''
  let t2 = teams[1] || ''
  if (t1 && t2) return [t1, t2]
  if (!rawText) return [t1 || '?', t2 || '?']
  const text = String(rawText).replace(/\s+/g, ' ').trim()
  const sepRegex = /([A-Za-zÀ-ÿ0-9.'&/_-]+(?:\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,4})\s+(?:x|vs|v|×|-|–)\s+([A-Za-zÀ-ÿ0-9.'&/_-]+(?:\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,4})/i
  const m = text.match(sepRegex)
  if (m) {
    if (!t1) t1 = m[1].trim()
    if (!t2) t2 = (m[1].trim().toLowerCase() === t1.toLowerCase()) ? m[2].trim() : (m[2].trim().toLowerCase() === t1.toLowerCase() ? m[1].trim() : m[2].trim())
  }
  if (t1 && !t2) {
    const esc = t1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m2 = text.match(new RegExp(`${esc}\\s+(?:x|vs|v|×|-|–)\\s+([A-Za-zÀ-ÿ0-9.'&/_-]+(?:\\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,3})`, 'i'))
    if (m2) t2 = m2[1].trim()
    else {
      const m3 = text.match(new RegExp(`([A-Za-zÀ-ÿ0-9.'&/_-]+(?:\\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,3})\\s+(?:x|vs|v|×|-|–)\\s+${esc}`, 'i'))
      if (m3) t2 = m3[1].trim()
    }
  }
  return [t1 || '?', t2 || '?']
}

async function learnPatterns(env) {
  if (!env?.SB_DB) return null
  try {
    // Lê todas tips agrupadas em combos do FAIXA VIP (e similares)
    const { results } = await env.SB_DB.prepare(
      `SELECT combo_group_id, market, market_tag, odd, line, result
       FROM telegram_tips
       WHERE combo_group_id IS NOT NULL AND odd IS NOT NULL`
    ).all()
    const tips = results || []
    if (!tips.length) return null

    // Agrupa por combo_group_id
    const combos = {}
    for (const t of tips) {
      if (!combos[t.combo_group_id]) combos[t.combo_group_id] = []
      combos[t.combo_group_id].push(t)
    }

    // Filtra só combos W (todas legs W)
    const winningCombos = []
    const losingCombos = []
    for (const [_id, parts] of Object.entries(combos)) {
      const allW = parts.every(p => p.result === 'W')
      const anyL = parts.some(p => p.result === 'L')
      if (allW && parts.length >= 2) winningCombos.push(parts)
      else if (anyL) losingCombos.push(parts)
    }

    if (!winningCombos.length) return null

    // Extrai padrões dos W
    const legsCount = {}
    const oddsBuckets = { '4-7': 0, '7-10': 0, '10-15': 0, '15-25': 0, '25+': 0 }
    const marketsCount = {}
    let totalLegs = 0
    let oddSum = 0

    for (const combo of winningCombos) {
      legsCount[combo.length] = (legsCount[combo.length] || 0) + 1
      for (const p of combo) {
        totalLegs++
        oddSum += p.odd
        if (p.odd < 4) {} // skip — abaixo do range FAIXA
        else if (p.odd < 7) oddsBuckets['4-7']++
        else if (p.odd < 10) oddsBuckets['7-10']++
        else if (p.odd < 15) oddsBuckets['10-15']++
        else if (p.odd < 25) oddsBuckets['15-25']++
        else oddsBuckets['25+']++
        const m = p.market || 'unknown'
        marketsCount[m] = (marketsCount[m] || 0) + 1
      }
    }

    // Modal n_legs (mais comum)
    const modalLegs = +Object.entries(legsCount).sort((a,b) => b[1] - a[1])[0]?.[0] || 4
    const avgLegOdd = totalLegs > 0 ? oddSum / totalLegs : 8

    // Top markets (top 5 por frequência)
    const topMarkets = Object.entries(marketsCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([m, n]) => ({ market: m, freq: +(n / totalLegs * 100).toFixed(1), count: n }))

    return {
      sample: { winning_combos: winningCombos.length, losing_combos: losingCombos.length, total_legs: totalLegs },
      modal_legs: modalLegs,
      avg_leg_odd: +avgLegOdd.toFixed(2),
      odds_distribution: oddsBuckets,
      top_markets: topMarkets,
      legs_distribution: legsCount,
    }
  } catch (e) {
    console.error('[learnPatterns]', e.message)
    return null
  }
}

// Gera combo C(arr, k)
function* combinations(arr, k) {
  if (k === 0) { yield []; return }
  if (arr.length < k) return
  for (let i = 0; i <= arr.length - k; i++) {
    for (const tail of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...tail]
    }
  }
}

// Score: o quão similar é o combo aos padrões aprendidos
function scoreSimilarityToPattern(combo, patterns) {
  if (!patterns) return 0
  let score = 0
  // Bonus se n_legs == modal
  if (combo.length === patterns.modal_legs) score += 30
  else if (Math.abs(combo.length - patterns.modal_legs) === 1) score += 15
  // Bonus se odd média está perto da média aprendida
  const avgOdd = combo.reduce((s, c) => s + c.odd, 0) / combo.length
  const oddDelta = Math.abs(avgOdd - patterns.avg_leg_odd)
  score += Math.max(0, 30 - oddDelta * 2)  // 30 se delta=0, 0 se delta>=15
  // Bonus por market hit
  const targetMarkets = patterns.top_markets.map(m => m.market.toLowerCase())
  for (const leg of combo) {
    const mkt = (leg.stat || leg.market || '').toLowerCase()
    if (targetMarkets.some(m => m.includes(mkt.slice(0, 6)) || mkt.includes(m.slice(0, 6)))) {
      score += 10
    }
  }
  return +score.toFixed(1)
}

function makeSaleTemplate(combo, combinedOdd, prob) {
  const lines = combo.legs.map((l, i) => {
    const sel = l.team || l.player_name || (l.direction === 'over' ? 'Mais de' : 'Menos de')
    const mkt = l.market || l.stat
    const line = l.line != null ? ` ${l.line}` : ''
    return `${i + 1}️⃣ ${l.match}\n   ${mkt}${line} ${sel} @${l.odd}`
  }).join('\n\n')

  return `🔥 *COMBO DO DIA — ESTILO FAIXA VIP* 🔥\n\n${lines}\n\n💰 ODD COMBINADA: *${combinedOdd}*\n📊 Prob: ${(prob * 100).toFixed(1)}%\n\n💎 Pode pegar a SIMPLES de cada uma também!\n\n✅ Bons jogos!`
}

export async function handleFaixaStyleGenerator(request, env) {
  try {
    const url = new URL(request.url)
    const sport = url.searchParams.get('sport') || 'football'
    const mode = url.searchParams.get('mode') || 'safe'  // safe | longshot | hybrid

    // 1. Aprende padrões dos combos W
    const patterns = await learnPatterns(env)
    if (!patterns) {
      return new Response(JSON.stringify({ ok: false, error: 'no_pattern_data', message: 'Sem combos W agrupados pra aprender. Rode group-combos primeiro.' }), {
        status: 200, headers: corsHeaders(),
      })
    }

    // 2. Pega picks de hoje (compact=1 + accept multiple conf field names)
    // Lê picks de hoje do D1 cache (picks_cache_today populado por football/basketball routes)
    let allProps = []
    let fetchDebug = { method: 'd1_cache' }
    try {
      if (env.SB_DB) {
        // Garante tabela existe
        await env.SB_DB.exec(
          `CREATE TABLE IF NOT EXISTS picks_cache_today (sport TEXT PRIMARY KEY, generated_at INTEGER, payload TEXT)`
        ).catch(()=>{})
        const sports = sport === 'all' ? ['football', 'basketball'] : [sport]
        for (const s of sports) {
          const row = await env.SB_DB.prepare(
            `SELECT payload, generated_at FROM picks_cache_today WHERE sport = ?`
          ).bind(s).first()
          if (row?.payload) {
            try {
              const parsed = JSON.parse(row.payload)
              if (parsed.top_props) allProps.push(...parsed.top_props)
              fetchDebug[`${s}_age_min`] = Math.round((Date.now() - row.generated_at) / 60000)
            } catch {}
          } else {
            fetchDebug[`${s}_status`] = 'no cache row'
          }
        }
        fetchDebug.d1_picks = allProps.length
      }
    } catch (e) {
      fetchDebug.d1_error = String(e.message)
    }
    // Normaliza: conf pode estar em diferentes campos (confidence, conf, etc)
    allProps = allProps.map(p => ({
      ...p,
      confidence: p.confidence ?? p.conf ?? p.value?.confidence ?? 50,
    }))

    // HYBRID MODE: pega tips RECENTES do FAIXA VIP (real) com odd alta
    let faixaTipsRecent = []
    if (mode === 'hybrid' || mode === 'faixa_only') {
      try {
        const cutoff = Date.now() - 24 * 3600_000
        const { results } = await env.SB_DB.prepare(
          `SELECT * FROM telegram_tips
           WHERE channel_name LIKE '%FAIXA VIP%' AND posted_at >= ? AND odd >= 5
           ORDER BY posted_at DESC LIMIT 40`
        ).bind(cutoff).all()
        faixaTipsRecent = (results || []).map(r => {
          const teamsRaw = r.teams ? JSON.parse(r.teams) : []
          const [t1, t2] = recoverTeams(teamsRaw, r.raw_text)
          // Pula tips onde NENHUM time foi recuperado
          if (t1 === '?' && t2 === '?') return null
          return {
            match_id: `faixa_${r.message_id}`,
            home_team: t1, away_team: t2,
            match: `${t1} v ${t2}`,
            league: 'FAIXA VIP',
            market: r.market || 'unknown',
            stat: (r.market || '').toLowerCase(),
            line: r.line, direction: r.market_tag,
            odd: r.odd,
            prob: 0.50,  // assume 50% (média FAIXA WR é 84% mas pra prudência)
            conf: 60,
            confidence: 60,
            source: 'faixa_vip_real',
          }
        }).filter(Boolean)
      } catch {}
    }

    // Filtra por modo:
    //  - safe: odd 1.3-5, conf 50%+ (combos seguros, odd combinada baixa)
    //  - longshot: odd 4-25, conf 40%+ (combos jackpot estilo FAIXA real)
    //  - hybrid: incluir tips reais do FAIXA + nossos longshots (odd combinada 50+)
    //  - faixa_only: APENAS tips reais do FAIXA VIP recentes
    let oursFilter
    if (mode === 'longshot') oursFilter = (p) => p.book_odds >= 4 && p.book_odds <= 30
    else if (mode === 'hybrid') oursFilter = (p) => p.book_odds >= 3 && p.book_odds <= 30
    else if (mode === 'faixa_only') oursFilter = () => false   // só FAIXA, ignora nossos
    else oursFilter = (p) => p.book_odds >= 1.3 && p.book_odds <= 5
    const candidates = [
      ...allProps.filter(p => oursFilter(p) && (p.confidence ?? 50) >= 40)
                 .map(p => ({ ...p, source: p.source || 'ours' })),
      ...faixaTipsRecent,
    ]
      .map(p => ({
        match_id: p.match_id,
        match: p.match || `${p.home_team || '?'} v ${p.away_team || '?'}`,
        home_team: p.home_team, away_team: p.away_team,
        market: p.market, stat: p.stat, line: p.line,
        direction: p.direction, team: p.team, player_name: p.player_name,
        odd: p.book_odds || p.odd,
        prob: (p.confidence ?? p.conf ?? 50) / 100,
        conf: p.confidence ?? p.conf ?? 50,
        source: p.source || 'ours',
      }))
      .sort((a, b) => b.prob - a.prob)

    // Dedupe por match
    const uniq = {}
    for (const p of candidates) if (!uniq[p.match_id]) uniq[p.match_id] = p
    const pool = Object.values(uniq).slice(0, 25)

    if (pool.length < patterns.modal_legs) {
      return new Response(JSON.stringify({
        ok: true, patterns, candidates_pool: pool.length,
        debug: {
          fetch: fetchDebug,
          all_props_count: allProps.length,
          sample_keys: allProps[0] ? Object.keys(allProps[0]).slice(0, 20) : [],
          sample_odds: allProps.slice(0, 5).map(p => ({ market: p.market, odd: p.book_odds, conf: p.confidence })),
          candidates_count: candidates.length,
        },
        message: `Pool insuficiente (${pool.length} picks, precisa ${patterns.modal_legs} pra modal)`,
        combos: [],
      }), { status: 200, headers: corsHeaders() })
    }

    // 3. Gera combos com N = modal_legs
    const N = patterns.modal_legs
    const generated = []
    let count = 0
    for (const combo of combinations(pool, N)) {
      if (count >= 1000) break
      count++
      const combinedOdd = combo.reduce((acc, c) => acc * c.odd, 1)
      const combinedProb = combo.reduce((acc, c) => acc * c.prob, 1)
      // Filtra: combined_odd 5+ (FAIXA quer odd alta, mas aceita medium pra mostrar opções)
      if (combinedOdd < 5 || combinedOdd > 100000) continue
      const ev = combinedProb * combinedOdd - 1
      const similarity = scoreSimilarityToPattern(combo, patterns)
      // Score combinado: similarity (até 60) + ev_bonus (até 40)
      const totalScore = similarity + Math.min(40, Math.max(0, ev * 100))
      const comboObj = {
        legs: combo,
        n_legs: combo.length,
        combined_odd: +combinedOdd.toFixed(2),
        combined_prob: +(combinedProb * 100).toFixed(2),
        ev_pct: +(ev * 100).toFixed(2),
        similarity_score: similarity,
        total_score: +totalScore.toFixed(1),
      }
      comboObj.sale_template = makeSaleTemplate(comboObj, comboObj.combined_odd, combinedProb)
      generated.push(comboObj)
    }

    // Ranqueia por total_score
    generated.sort((a, b) => b.total_score - a.total_score)

    return new Response(JSON.stringify({
      ok: true,
      mode,
      patterns,
      candidates_pool: pool.length,
      total_combos_generated: generated.length,
      faixa_recent_tips: faixaTipsRecent.length,
      top_combos: generated.slice(0, 15),
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
