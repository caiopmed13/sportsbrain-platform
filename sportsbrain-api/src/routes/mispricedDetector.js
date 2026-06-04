/**
 * /v1/bet365/markets/mispriced  GET
 *
 * Detecta odds desajustadas em 3 categorias:
 *
 * 1. CROSS-BOOK MISPRICING — Bet365 odd > Bovada no-vig fair × threshold
 *    Indica que Bet365 está pagando mais do que o mercado precifica.
 *
 * 2. STEAM MOVE — odd caiu/subiu >X% no último snapshot vs anteriores
 *    Indica dinheiro profissional movendo a linha. Lado contrário fica vantajoso.
 *
 * 3. DRIFT — linha movendo consistentemente em uma direção sem cross-book mover
 *    Quando consenso é estável mas Bet365 drifta, oportunidade contra o drift.
 *
 * Query params:
 *   ?minEdge=3      — só mispricing com edge ≥ 3pp
 *   ?steamPct=8     — só steam moves ≥ 8% movimento
 *   ?lookback=3     — quantos snapshots históricos analisar (default 3)
 */
import { corsHeaders } from './health.js'

function devig(odds) {
  if (!odds || !odds.length || odds.some(o => !o || o <= 1)) return null
  const implied = odds.map(o => 1 / o)
  const sum = implied.reduce((a, b) => a + b, 0)
  if (sum < 1.0 || sum > 2.0) return null
  return implied.map(p => p / sum)
}
function calcEV(odd, fairProb) {
  if (!odd || !fairProb) return null
  return +((fairProb * odd - 1) * 100).toFixed(2)
}
const TEAM_ALIASES = {
  'man utd': 'manchester united', 'man city': 'manchester city',
  'a madrid': 'atletico madrid', 'atletico de madrid': 'atletico madrid',
  'a bilbao': 'athletic bilbao', 'espanhol': 'espanyol',
  'bayern de munique': 'bayern munich', 'inter de milao': 'inter milan', 'inter de milão': 'inter milan',
  'paris sg': 'paris saint germain', 'psg': 'paris saint germain',
  'det pistons': 'detroit pistons', 'okc thunder': 'oklahoma city thunder',
  'min timberwolves': 'minnesota timberwolves', 'den nuggets': 'denver nuggets',
  'phx suns': 'phoenix suns', 'orl magic': 'orlando magic',
  'phi 76ers': 'philadelphia 76ers', 'bos celtics': 'boston celtics',
  'la lakers': 'los angeles lakers', 'la clippers': 'los angeles clippers',
  'atl hawks': 'atlanta hawks', 'tor raptors': 'toronto raptors',
  'por trail blazers': 'portland trail blazers', 'sa spurs': 'san antonio spurs',
  'ny knicks': 'new york knicks', 'hou rockets': 'houston rockets',
  'cle cavaliers': 'cleveland cavaliers',
}
function normTeam(s) {
  if (!s) return ''
  let t = String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  if (TEAM_ALIASES[t]) t = TEAM_ALIASES[t]
  t = t.replace(/\b(fc|cf|sc|cd|af|sp|mg|rj|rs|pr|sg|sk|jrs|junior)\b/g, '').replace(/\s+/g, ' ').trim()
  return t
}

export async function handleBet365Mispriced(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE', alerts: [] }), {
      status: 503, headers: corsHeaders(),
    })
  }

  const url = new URL(request.url)
  const minEdge = parseFloat(url.searchParams.get('minEdge') || '3')
  const steamPct = parseFloat(url.searchParams.get('steamPct') || '8')
  const lookback = Math.min(10, parseInt(url.searchParams.get('lookback') || '3', 10))

  try {
    // 1. Lê últimos N snapshots
    const rows = await env.SB_DB.prepare(
      `SELECT captured_at, payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT ?`
    ).bind(lookback + 1).all()
    if (!rows?.results?.length) {
      return new Response(JSON.stringify({ ok: true, alerts: [], message: 'no_snapshots' }), {
        status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=60' }),
      })
    }
    const latest = rows.results[0]
    const previous = rows.results.slice(1)
    let latestMarkets = []
    try { latestMarkets = JSON.parse(latest.payload) } catch {}

    // 2. Cross-book (Bovada via internal call)
    const { handleOddsEngine } = await import('./oddsEngine.js')
    let crossOdds = {}
    try {
      const fakeReq = new Request(new URL(request.url).origin + '/v1/odds/all')
      const xRes = await handleOddsEngine('/v1/odds/all', fakeReq, env)
      if (xRes && xRes.status === 200) {
        const xData = await xRes.json()
        for (const e of xData.events || []) {
          const key = `${normTeam(e.home_team)}|${normTeam(e.away_team)}`
          crossOdds[key] = e
        }
      }
    } catch {}

    // 3. Index histórico por (fid|market|selection|line)
    function pickKey(m) {
      return `${m.fixtureId}|${m.market}|${m.selection || m.player || ''}|${m.line ?? ''}`
    }
    const history = {}  // key → [{ts, odd}]
    for (const row of previous) {
      let prev = []
      try { prev = JSON.parse(row.payload) } catch {}
      for (const m of prev) {
        const k = pickKey(m)
        if (!history[k]) history[k] = []
        const odd = m.odd ?? m.over ?? m.under
        if (odd) history[k].push({ ts: row.captured_at, odd })
      }
    }

    // 4. Detecta alertas
    const alerts = []
    const seenKeys = new Set()  // dedup

    for (const m of latestMarkets) {
      const k = pickKey(m)
      if (seenKeys.has(k)) continue
      seenKeys.add(k)
      const currentOdd = m.odd ?? m.over ?? m.under
      if (!currentOdd) continue

      // ─── Steam Move detection ─────────────────────────────────────────────
      const hist = history[k] || []
      if (hist.length >= 1) {
        const oldestOdd = hist[hist.length - 1].odd
        const movePct = ((currentOdd - oldestOdd) / oldestOdd) * 100
        if (Math.abs(movePct) >= steamPct) {
          alerts.push({
            type: 'STEAM',
            severity: Math.abs(movePct) >= 15 ? 'high' : 'medium',
            fixtureId: m.fixtureId, home: m.home, away: m.away, competition: m.competition,
            market: m.market, selection: m.selection || m.player, line: m.line,
            currentOdd, previousOdd: oldestOdd,
            movePct: +movePct.toFixed(1),
            direction: movePct > 0 ? 'up' : 'down',
            trail: hist.map(h => h.odd),
            message: `Linha moveu ${movePct > 0 ? '+' : ''}${movePct.toFixed(1)}% (${oldestOdd.toFixed(2)} → ${currentOdd.toFixed(2)})`,
          })
        }
      }

      // ─── Cross-book mispricing ────────────────────────────────────────────
      if (m.home && m.away) {
        const ckey = `${normTeam(m.home)}|${normTeam(m.away)}`
        const ckeyR = `${normTeam(m.away)}|${normTeam(m.home)}`
        const cross = crossOdds[ckey] || crossOdds[ckeyR]
        if (cross && m.market === '1X2') {
          const xH2h = cross.bookmakers?.[0]?.markets?.find(mm => mm.key === 'h2h')
          const xHome = xH2h?.outcomes?.find(o => o.name === 'home')?.price
          const xDraw = xH2h?.outcomes?.find(o => o.name === 'draw')?.price
          const xAway = xH2h?.outcomes?.find(o => o.name === 'away')?.price
          if (xHome && xDraw && xAway) {
            const xFair = devig([xHome, xDraw, xAway])
            if (xFair) {
              const idx = m.selection === 'home' ? 0 : m.selection === 'draw' ? 1 : 2
              const ev = calcEV(currentOdd, xFair[idx])
              if (ev != null && ev >= minEdge) {
                alerts.push({
                  type: 'CROSS_BOOK',
                  severity: ev >= 8 ? 'high' : ev >= 5 ? 'medium' : 'low',
                  fixtureId: m.fixtureId, home: m.home, away: m.away, competition: m.competition,
                  market: m.market, selection: m.selection, line: m.line,
                  currentOdd, fairOdd: +(1/xFair[idx]).toFixed(2),
                  fairProb: +(xFair[idx] * 100).toFixed(1),
                  ev,
                  crossBook: cross.bookmakers?.[0]?.key || 'cross',
                  message: `Bet365 ${currentOdd.toFixed(2)} vs fair ${(1/xFair[idx]).toFixed(2)} (cross ${cross.bookmakers?.[0]?.key || 'book'}) → +${ev}% EV`,
                })
              }
            }
          }
        }
        // Para O/U: cross-book vs Bet365
        if (cross && (m.market === 'TOTAL_GOALS' || m.market === 'CORNERS_OU')) {
          const xTotals = cross.bookmakers?.[0]?.markets?.find(mm => mm.key === 'totals')
          if (xTotals && m.line != null) {
            const xOver = xTotals.outcomes?.find(o => o.name === 'over' && Math.abs(o.point - m.line) < 0.01)?.price
            const xUnder = xTotals.outcomes?.find(o => o.name === 'under' && Math.abs(o.point - m.line) < 0.01)?.price
            if (xOver && xUnder) {
              const xFair = devig([xOver, xUnder])
              if (xFair && m.over && m.under) {
                const overEV = calcEV(m.over, xFair[0])
                const underEV = calcEV(m.under, xFair[1])
                if (overEV != null && overEV >= minEdge) {
                  alerts.push({
                    type: 'CROSS_BOOK',
                    severity: overEV >= 8 ? 'high' : overEV >= 5 ? 'medium' : 'low',
                    fixtureId: m.fixtureId, home: m.home, away: m.away, competition: m.competition,
                    market: m.market, selection: 'over', line: m.line,
                    currentOdd: m.over, fairOdd: +(1/xFair[0]).toFixed(2),
                    fairProb: +(xFair[0] * 100).toFixed(1),
                    ev: overEV,
                    crossBook: cross.bookmakers?.[0]?.key || 'cross',
                    message: `Over ${m.line}: Bet365 ${m.over.toFixed(2)} vs fair ${(1/xFair[0]).toFixed(2)} → +${overEV}% EV`,
                  })
                }
                if (underEV != null && underEV >= minEdge) {
                  alerts.push({
                    type: 'CROSS_BOOK',
                    severity: underEV >= 8 ? 'high' : underEV >= 5 ? 'medium' : 'low',
                    fixtureId: m.fixtureId, home: m.home, away: m.away, competition: m.competition,
                    market: m.market, selection: 'under', line: m.line,
                    currentOdd: m.under, fairOdd: +(1/xFair[1]).toFixed(2),
                    fairProb: +(xFair[1] * 100).toFixed(1),
                    ev: underEV,
                    crossBook: cross.bookmakers?.[0]?.key || 'cross',
                    message: `Under ${m.line}: Bet365 ${m.under.toFixed(2)} vs fair ${(1/xFair[1]).toFixed(2)} → +${underEV}% EV`,
                  })
                }
              }
            }
          }
        }
      }
    }

    // 5. Ordena: high severity primeiro, depois EV/movePct
    alerts.sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2 }
      if (sevOrder[a.severity] !== sevOrder[b.severity]) {
        return sevOrder[a.severity] - sevOrder[b.severity]
      }
      const aScore = a.ev || Math.abs(a.movePct || 0)
      const bScore = b.ev || Math.abs(b.movePct || 0)
      return bScore - aScore
    })

    return new Response(JSON.stringify({
      ok: true,
      capturedAt: latest.captured_at,
      snapshotsAnalyzed: previous.length + 1,
      totalAlerts: alerts.length,
      byType: {
        steam: alerts.filter(a => a.type === 'STEAM').length,
        crossBook: alerts.filter(a => a.type === 'CROSS_BOOK').length,
      },
      alerts: alerts.slice(0, 50),  // limit pra não estourar response
    }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'INTERNAL', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
