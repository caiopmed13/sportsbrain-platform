/**
 * /v1/bet365/markets/analyzed (GET) — markets analisados
 *
 * Pipeline:
 *   1. Lê último snapshot de bet365_markets_snapshots
 *   2. Agrupa por (fixtureId, market) e devig por mercado bilateral/trilateral
 *   3. Cruza com /v1/odds/all (Bovada) quando match achado, calcula edge
 *   4. Retorna estrutura agrupada por match → markets
 *
 * Query params:
 *   ?match=<fid>     — filtra um match específico
 *   ?sport=<key>     — futebol|nba|nbb
 *   ?market=<type>   — 1X2|BTTS|TOTAL_GOALS|etc
 *   ?minEdge=2       — só mostra markets com edge >= 2pp
 */
import { corsHeaders } from './health.js'

// Devig: dado um array de odds [a, b, c?] do mesmo mercado, retorna probs no-vig
// Multiplicative method: probs = (1/odd) / sum(1/odds)
function devig(odds) {
  if (!odds || !odds.length || odds.some(o => !o || o <= 1)) return null
  const implied = odds.map(o => 1 / o)
  const sum = implied.reduce((a, b) => a + b, 0)
  if (sum < 1.0 || sum > 2.0) return null  // sanity check
  return implied.map(p => p / sum)
}

// Calcula EV% se temos prob fair (no-vig) vs odd Bet365
function calcEV(odd, fairProb) {
  if (!odd || !fairProb) return null
  return +((fairProb * odd - 1) * 100).toFixed(2)
}

// Normaliza nome de time pra fuzzy match
// Aliases comuns: Bet365 vs Bovada/sportsbrain
const TEAM_ALIASES = {
  'man utd': 'manchester united',
  'man city': 'manchester city',
  'a madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'real madrid': 'real madrid',
  'a bilbao': 'athletic bilbao',
  'athletic bilbao': 'athletic bilbao',
  'espanhol': 'espanyol',
  'bayern de munique': 'bayern munich',
  'inter de milao': 'inter milan',
  'inter de milão': 'inter milan',
  'paris sg': 'paris saint germain',
  'psg': 'paris saint germain',
  'det pistons': 'detroit pistons',
  'okc thunder': 'oklahoma city thunder',
  'min timberwolves': 'minnesota timberwolves',
  'den nuggets': 'denver nuggets',
  'phx suns': 'phoenix suns',
  'orl magic': 'orlando magic',
  'phi 76ers': 'philadelphia 76ers',
  'bos celtics': 'boston celtics',
  'la lakers': 'los angeles lakers',
  'la clippers': 'los angeles clippers',
  'atl hawks': 'atlanta hawks',
  'tor raptors': 'toronto raptors',
  'por trail blazers': 'portland trail blazers',
  'sa spurs': 'san antonio spurs',
  'ny knicks': 'new york knicks',
  'hou rockets': 'houston rockets',
  'cle cavaliers': 'cleveland cavaliers',
  'milwaukee bucks': 'milwaukee bucks',
}
function normTeam(s) {
  if (!s) return ''
  let t = String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ').trim()
  // Aplica alias se existir
  if (TEAM_ALIASES[t]) t = TEAM_ALIASES[t]
  // Remove sufixos/prefixos genéricos APÓS alias
  t = t.replace(/\b(fc|cf|sc|cd|af|sp|mg|rj|rs|pr|sg|sk|jrs|junior)\b/g, '').replace(/\s+/g, ' ').trim()
  return t
}
function teamMatch(a, b) {
  const A = normTeam(a), B = normTeam(b)
  if (!A || !B) return false
  if (A === B) return true
  if (A.includes(B) || B.includes(A)) return true
  // Match por prefixo de 4 chars do primeiro word
  const aw = A.split(' ').filter(w => w.length >= 3)
  const bw = B.split(' ').filter(w => w.length >= 3)
  for (const wa of aw) {
    for (const wb of bw) {
      if (wa === wb) return true
      // Prefix match: ambos têm >=4 chars e os primeiros 4 batem
      if (wa.length >= 4 && wb.length >= 4 && wa.slice(0, 4) === wb.slice(0, 4)) return true
      // Um é prefixo do outro (>=3 chars)
      if (wa.length >= 3 && wb.startsWith(wa)) return true
      if (wb.length >= 3 && wa.startsWith(wb)) return true
    }
  }
  return false
}

export async function handleBet365MarketsAnalyzed(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    })
  }

  const url = new URL(request.url)
  const filterMatch = url.searchParams.get('match')
  const filterSport = url.searchParams.get('sport')
  const filterMarket = url.searchParams.get('market')
  const minEdge = parseFloat(url.searchParams.get('minEdge') || '0')

  try {
    // 1. Lê markets do último snapshot
    const row = await env.SB_DB.prepare(
      `SELECT captured_at, payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first()
    if (!row) {
      return new Response(JSON.stringify({ ok: true, matches: [], message: 'no_data_yet' }), {
        status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=60' }),
      })
    }
    let markets = []
    try { markets = JSON.parse(row.payload) } catch {}
    if (!markets.length) {
      return new Response(JSON.stringify({ ok: true, matches: [], capturedAt: row.captured_at }), {
        status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=60' }),
      })
    }

    // 2. Cruza com /v1/odds/all (Bovada) — chamada via handleOddsEngine
    let crossOdds = {}
    let crossDebug = { tried: false, ok: false, count: 0, error: null }
    try {
      crossDebug.tried = true
      const { handleOddsEngine } = await import('./oddsEngine.js')
      const fakeReq = new Request(new URL(request.url).origin + '/v1/odds/all')
      const xRes = await handleOddsEngine('/v1/odds/all', fakeReq, env)
      if (xRes && xRes.status === 200) {
        const xData = await xRes.json()
        crossDebug.ok = true
        for (const e of xData.events || []) {
          const key = `${normTeam(e.home_team)}|${normTeam(e.away_team)}`
          crossOdds[key] = e
          crossDebug.count++
        }
      }
    } catch (e) { crossDebug.error = e.message }

    // 3. Agrupa por match + market
    const byMatch = {}
    for (const m of markets) {
      if (!m.fixtureId) continue
      const fid = m.fixtureId
      if (!byMatch[fid]) {
        byMatch[fid] = {
          fixtureId: fid,
          home: m.home, away: m.away,
          competition: m.competition,
          markets: {},  // marketKey -> []
        }
      }
      // Filter individual market
      if (filterMarket && m.market !== filterMarket) continue
      const key = m.market || 'OTHER'
      if (!byMatch[fid].markets[key]) byMatch[fid].markets[key] = []
      byMatch[fid].markets[key].push(m)
    }

    // 4. Pra cada match, devig + edge
    const matches = []
    for (const fid of Object.keys(byMatch)) {
      const M = byMatch[fid]
      // Filter match/sport
      if (filterMatch && fid !== filterMatch) continue

      // Cross-book lookup
      const ckey = `${normTeam(M.home)}|${normTeam(M.away)}`
      const ckeyR = `${normTeam(M.away)}|${normTeam(M.home)}`
      const crossEvent = crossOdds[ckey] || crossOdds[ckeyR] || null

      const matchOut = {
        fixtureId: fid,
        home: M.home, away: M.away,
        competition: M.competition,
        commenceTime: crossEvent?.commence_time || null,
        crossBook: crossEvent ? crossEvent.bookmakers?.[0]?.key || null : null,
        marketCount: 0,
        markets: {},
      }

      // 1X2 — devig 3 outcomes
      if (M.markets['1X2']) {
        const arr = M.markets['1X2']
        const home = arr.find(x => x.selection === 'home')
        const draw = arr.find(x => x.selection === 'draw')
        const away = arr.find(x => x.selection === 'away')
        if (home && draw && away) {
          const noVig = devig([home.odd, draw.odd, away.odd])
          if (noVig) {
            // Cross com Bovada h2h se disponível
            const xH2h = crossEvent?.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')
            const xHome = xH2h?.outcomes?.find(o => o.name === 'home')?.price
            const xAway = xH2h?.outcomes?.find(o => o.name === 'away')?.price
            // No-vig do cross (2-way pra binary, 3-way pra 1X2)
            let xFair = null
            if (xHome && xAway) {
              const xDraw = xH2h.outcomes.find(o => o.name === 'draw')?.price
              if (xDraw) xFair = devig([xHome, xDraw, xAway])
            }
            matchOut.markets['1X2'] = [
              { selection: 'home', odd: home.odd, fairProb: noVig[0], xProb: xFair?.[0] || null, ev: xFair ? calcEV(home.odd, xFair[0]) : null },
              { selection: 'draw', odd: draw.odd, fairProb: noVig[1], xProb: xFair?.[1] || null, ev: xFair ? calcEV(draw.odd, xFair[1]) : null },
              { selection: 'away', odd: away.odd, fairProb: noVig[2], xProb: xFair?.[2] || null, ev: xFair ? calcEV(away.odd, xFair[2]) : null },
            ]
            matchOut.marketCount += 3
          }
        }
      }

      // BTTS — 2 outcomes (Yes/No). Cross-book com Bovada btts quando disponível
      if (M.markets['BTTS']) {
        const arr = M.markets['BTTS']
        const yes = arr.find(x => x.selection === 'yes')
        const no = arr.find(x => x.selection === 'no')
        if (yes && no) {
          const noVig = devig([yes.odd, no.odd])
          if (noVig) {
            // Cross-book Bovada BTTS
            let xFair = null
            const xBTTS = crossEvent?.bookmakers?.[0]?.markets?.find(mm => mm.key === 'btts' || mm.key === 'both_teams_to_score')
            if (xBTTS) {
              const xYes = xBTTS.outcomes.find(o => /yes|sim/i.test(o.name))?.price
              const xNo  = xBTTS.outcomes.find(o => /no|nao|não/i.test(o.name))?.price
              if (xYes && xNo) xFair = devig([xYes, xNo])
            }
            matchOut.markets['BTTS'] = [
              { selection: 'yes', odd: yes.odd, fairProb: xFair?.[0] || noVig[0], ev: xFair ? calcEV(yes.odd, xFair[0]) : null },
              { selection: 'no',  odd: no.odd,  fairProb: xFair?.[1] || noVig[1], ev: xFair ? calcEV(no.odd,  xFair[1]) : null },
            ]
            matchOut.marketCount += 2
          }
        }
      }

      // TOTAL_GOALS / TOTAL_POINTS / CORNERS_OU / CARDS_OU — over+under por linha
      for (const ouKey of ['TOTAL_GOALS', 'TOTAL_POINTS', 'CORNERS_OU', 'CARDS_OU']) {
        if (M.markets[ouKey]) {
          const list = []
          for (const m of M.markets[ouKey]) {
            if (!m.over || !m.under) continue
            const noVig = devig([m.over, m.under])
            if (!noVig) continue
            // Cross com totals do Bovada se mesma linha (ou linha mais próxima ±0.5)
            let xFair = null
            const xTotals = crossEvent?.bookmakers?.[0]?.markets?.find(mm => mm.key === 'totals')
            if (xTotals && ouKey === 'TOTAL_GOALS') {
              // 1) match exato de linha
              let xOver = xTotals.outcomes.find(o => o.name === 'over' && Math.abs(o.point - m.line) < 0.01)?.price
              let xUnder = xTotals.outcomes.find(o => o.name === 'under' && Math.abs(o.point - m.line) < 0.01)?.price
              // 2) linha mais próxima (até 1.0 de diferença) com ajuste por gols Poisson approx
              if (!xOver || !xUnder) {
                const nearestOver = xTotals.outcomes.find(o => o.name === 'over' && Math.abs(o.point - m.line) < 1.0)
                const nearestUnder = xTotals.outcomes.find(o => o.name === 'under' && Math.abs(o.point - m.line) < 1.0)
                if (nearestOver && nearestUnder) {
                  // Devig + ajuste linear da prob por diferença de linha
                  const noVigCross = devig([nearestOver.price, nearestUnder.price])
                  if (noVigCross) {
                    // Cada 0.5 a mais na linha → +5% prob de under
                    const delta = (m.line - nearestOver.point) * 0.10
                    const overProb = Math.max(0.05, Math.min(0.95, noVigCross[0] - delta))
                    xFair = [overProb, 1 - overProb]
                  }
                }
              } else {
                xFair = devig([xOver, xUnder])
              }
            }
            list.push({
              line: m.line,
              over: m.over, under: m.under,
              overProb: xFair?.[0] || noVig[0],
              underProb: xFair?.[1] || noVig[1],
              // EV só faz sentido com cross-book (xFair). Sem cross, null.
              overEV: xFair ? calcEV(m.over, xFair[0]) : null,
              underEV: xFair ? calcEV(m.under, xFair[1]) : null,
            })
          }
          if (list.length) {
            matchOut.markets[ouKey] = list.sort((a, b) => a.line - b.line)
            matchOut.marketCount += list.length * 2
          }
        }
      }

      // DOUBLE_CHANCE — 3 outcomes. Cross-book deriva de Bovada h2h (1X = home+draw, etc)
      if (M.markets['DOUBLE_CHANCE']) {
        const arr = M.markets['DOUBLE_CHANCE']
        const _1X = arr.find(x => x.selection === '1X')
        const _12 = arr.find(x => x.selection === '12')
        const _X2 = arr.find(x => x.selection === 'X2')
        if (_1X && _12 && _X2) {
          const noVig = devig([_1X.odd, _12.odd, _X2.odd])
          if (noVig) {
            // Cross-book: deriva DC do h2h Bovada (1X = pH+pD, 12 = pH+pA, X2 = pD+pA)
            let xFair = null
            if (xFair == null && crossEvent?.bookmakers?.[0]) {
              const h2h = crossEvent.bookmakers[0].markets?.find(mm => mm.key === 'h2h')
              if (h2h && h2h.outcomes?.length === 3) {
                const oH = h2h.outcomes.find(o => /home|^1$/i.test(o.name))?.price
                const oD = h2h.outcomes.find(o => /draw|^x$|empate/i.test(o.name))?.price
                const oA = h2h.outcomes.find(o => /away|^2$/i.test(o.name))?.price
                if (oH && oD && oA) {
                  const dv = devig([oH, oD, oA])
                  if (dv) xFair = [dv[0]+dv[1], dv[0]+dv[2], dv[1]+dv[2]]
                }
              }
            }
            matchOut.markets['DOUBLE_CHANCE'] = [
              { selection: '1X', odd: _1X.odd, fairProb: xFair?.[0] || noVig[0], ev: xFair ? calcEV(_1X.odd, xFair[0]) : null },
              { selection: '12', odd: _12.odd, fairProb: xFair?.[1] || noVig[1], ev: xFair ? calcEV(_12.odd, xFair[1]) : null },
              { selection: 'X2', odd: _X2.odd, fairProb: xFair?.[2] || noVig[2], ev: xFair ? calcEV(_X2.odd, xFair[2]) : null },
            ]
            matchOut.marketCount += 3
          }
        }
      }

      // Restantes (CORRECT_SCORE, HT_FT, GOALS_RANGE, NBA_*, OTHER) — mantém raw com implied prob
      const remainingKeys = Object.keys(M.markets).filter(k =>
        !['1X2', 'BTTS', 'TOTAL_GOALS', 'TOTAL_POINTS', 'CORNERS_OU', 'CARDS_OU', 'DOUBLE_CHANCE'].includes(k)
      )
      for (const k of remainingKeys) {
        matchOut.markets[k] = M.markets[k].map(m => ({
          ...m,
          impliedProb: m.odd ? +(1 / m.odd).toFixed(4) : null,
          impliedPct: m.odd ? +(100 / m.odd).toFixed(2) : null,
        }))
        matchOut.marketCount += M.markets[k].length
      }

      // Filtro EV
      if (minEdge > 0) {
        for (const k of Object.keys(matchOut.markets)) {
          matchOut.markets[k] = matchOut.markets[k].filter(m => {
            const ev = m.ev ?? m.overEV ?? m.underEV ?? 0
            return ev >= minEdge
          })
          if (!matchOut.markets[k].length) delete matchOut.markets[k]
        }
        matchOut.marketCount = Object.values(matchOut.markets).reduce((a, b) => a + b.length, 0)
      }

      // Sport filter
      if (filterSport) {
        const sport = (M.competition || '').toLowerCase()
        const isNBA = /\bnba\b/i.test(sport)
        const isNBB = /\bnbb\b|basquete/i.test(sport)
        const isFut = !isNBA && !isNBB
        if (filterSport === 'nba' && !isNBA) continue
        if (filterSport === 'nbb' && !isNBB) continue
        if (filterSport === 'futebol' && !isFut) continue
      }

      if (matchOut.marketCount > 0) matches.push(matchOut)
    }

    // Ordena: matches com cross-book primeiro, depois por # de markets
    matches.sort((a, b) => {
      if (!!a.crossBook !== !!b.crossBook) return a.crossBook ? -1 : 1
      return b.marketCount - a.marketCount
    })

    return new Response(JSON.stringify({
      ok: true,
      capturedAt: row.captured_at,
      totalMatches: matches.length,
      totalMarkets: matches.reduce((a, m) => a + m.marketCount, 0),
      crossDebug,
      matches,
    }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}

// /v1/bet365/markets/suggested-combos
// Gera top combos 2/3-leg automaticamente a partir dos picks +EV
// Otimiza por: max(joint * total_odd) considerando correlação
function pairCorrelation(a, b) {
  if (a.fixtureId !== b.fixtureId) return 1.0
  const ma = a.market, mb = b.market
  const sa = (a.selection || '').toLowerCase()
  const sb = (b.selection || '').toLowerCase()
  if (ma === mb && sa === sb) return 0
  if ((ma === '1X2' && mb === 'BTTS') || (ma === 'BTTS' && mb === '1X2')) {
    if (sa === 'yes' || sb === 'yes') return 1.15
    if (sa === 'no' || sb === 'no') return 0.85
  }
  if ((ma === '1X2' && mb === 'TOTAL_GOALS') || (ma === 'TOTAL_GOALS' && mb === '1X2')) {
    if (sa.startsWith('over') || sb.startsWith('over')) return 1.10
    if (sa.startsWith('under') || sb.startsWith('under')) return 0.95
  }
  if ((ma === 'BTTS' && mb === 'TOTAL_GOALS') || (ma === 'TOTAL_GOALS' && mb === 'BTTS')) {
    const isYes = sa === 'yes' || sb === 'yes'
    const isOver = sa.startsWith('over') || sb.startsWith('over')
    if (isYes && isOver) return 1.20
    if (!isYes && !isOver) return 1.10
  }
  return 1.05
}
function comboEV(legs) {
  if (!legs.length) return null
  let joint = legs[0].fairProb || 0
  let totalOdd = legs[0].odd || 1
  for (let i = 1; i < legs.length; i++) {
    let corr = 1
    for (let j = 0; j < i; j++) corr *= pairCorrelation(legs[j], legs[i])
    joint *= (legs[i].fairProb || 0) * corr
    totalOdd *= (legs[i].odd || 1)
  }
  if (joint <= 0 || totalOdd <= 1) return null
  return { joint, totalOdd, ev: +((joint * totalOdd - 1) * 100).toFixed(2) }
}
export async function handleBet365SuggestedCombos(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  const url = new URL(request.url)
  const minLegEV = parseFloat(url.searchParams.get('minLegEV') || '0')
  const maxLegs = Math.min(4, parseInt(url.searchParams.get('maxLegs') || '3', 10))
  try {
    // Reuse analyzed via internal call
    const analyzedReq = new Request(url.origin + '/v1/bet365/markets/analyzed?minEdge=' + minLegEV)
    const analyzedRes = await handleBet365MarketsAnalyzed(analyzedReq, env)
    const analyzed = await analyzedRes.json()
    if (!analyzed.ok) return new Response(JSON.stringify({ ok: false, error: 'analyzed failed' }), { status: 500, headers: corsHeaders() })
    // Achata picks (mesma lógica do frontend)
    const picks = []
    for (const M of analyzed.matches || []) {
      for (const [mk, rows] of Object.entries(M.markets || {})) {
        for (const r of rows) {
          if (r.over != null && r.under != null) {
            if (r.overEV != null && r.overEV >= minLegEV) {
              picks.push({ fixtureId: M.fixtureId, home: M.home, away: M.away, market: mk, selection: `Over ${r.line}`, line: r.line, odd: r.over, fairProb: r.overProb, ev: r.overEV })
            }
            if (r.underEV != null && r.underEV >= minLegEV) {
              picks.push({ fixtureId: M.fixtureId, home: M.home, away: M.away, market: mk, selection: `Under ${r.line}`, line: r.line, odd: r.under, fairProb: r.underProb, ev: r.underEV })
            }
          } else if (r.odd != null && r.ev != null && r.ev >= minLegEV) {
            picks.push({ fixtureId: M.fixtureId, home: M.home, away: M.away, market: mk, selection: r.selection || r.player || r.maName, line: r.line, odd: r.odd, fairProb: r.fairProb, ev: r.ev })
          }
        }
      }
    }
    // Top picks por EV
    const topPicks = picks.sort((a, b) => b.ev - a.ev).slice(0, 30)
    // Gera combos N-leg de forma greedy (combinação completa explode)
    const combos = []
    // 2-leg
    for (let i = 0; i < topPicks.length; i++) {
      for (let j = i + 1; j < topPicks.length; j++) {
        const legs = [topPicks[i], topPicks[j]]
        // Não permite mesmo selection no mesmo mercado mesmo jogo
        if (legs[0].fixtureId === legs[1].fixtureId && legs[0].market === legs[1].market && legs[0].selection === legs[1].selection) continue
        const ev = comboEV(legs)
        if (ev && ev.ev > 0) combos.push({ size: 2, legs, ...ev })
      }
    }
    // 3-leg (limitado pra não explodir)
    if (maxLegs >= 3) {
      const top10 = topPicks.slice(0, 12)
      for (let i = 0; i < top10.length; i++) {
        for (let j = i + 1; j < top10.length; j++) {
          for (let k = j + 1; k < top10.length; k++) {
            const legs = [top10[i], top10[j], top10[k]]
            // No duplicate market+selection
            const keys = new Set(legs.map(l => `${l.fixtureId}|${l.market}|${l.selection}`))
            if (keys.size < 3) continue
            const ev = comboEV(legs)
            if (ev && ev.ev > 5) combos.push({ size: 3, legs, ...ev })
          }
        }
      }
    }
    // Top 10 ranked por EV, mais filter pra não duplicar mesmas legs
    const seen = new Set()
    const finalCombos = []
    for (const c of combos.sort((a, b) => b.ev - a.ev)) {
      const sig = c.legs.map(l => `${l.fixtureId}|${l.market}|${l.selection}`).sort().join('+')
      if (seen.has(sig)) continue
      seen.add(sig)
      finalCombos.push(c)
      if (finalCombos.length >= 15) break
    }
    return new Response(JSON.stringify({ ok: true, capturedAt: analyzed.capturedAt, combos: finalCombos }), {
      status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=120' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'INTERNAL', detail: e.message }), { status: 500, headers: corsHeaders() })
  }
}

// /v1/bet365/markets/history?fid=X&market=Y&selection=Z&line=W
// Retorna array [{ts, odd, ev}] dos últimos snapshots pra plotar trajectory
export async function handleBet365MarketsHistory(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    })
  }
  const url = new URL(request.url)
  const fid = url.searchParams.get('fid')
  const market = url.searchParams.get('market')
  const selection = url.searchParams.get('selection')
  const line = url.searchParams.get('line')
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10))
  if (!fid || !market) {
    return new Response(JSON.stringify({ ok: false, error: 'fid + market required' }), {
      status: 400, headers: corsHeaders(),
    })
  }
  try {
    const rows = await env.SB_DB.prepare(
      `SELECT captured_at, payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all()
    const points = []
    for (const row of rows?.results || []) {
      let markets = []
      try { markets = JSON.parse(row.payload) } catch {}
      const matching = markets.find(m => {
        if (m.fixtureId !== fid || m.market !== market) return false
        if (selection && m.selection !== selection && m.player !== selection) return false
        if (line != null && m.line != null && Math.abs(m.line - parseFloat(line)) > 0.01) return false
        return true
      })
      if (matching) {
        points.push({
          ts: row.captured_at,
          odd: matching.odd ?? matching.over ?? matching.under ?? null,
        })
      }
    }
    points.sort((a, b) => a.ts - b.ts)
    return new Response(JSON.stringify({ ok: true, points }), {
      status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=120' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
