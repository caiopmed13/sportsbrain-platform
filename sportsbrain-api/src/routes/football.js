/**
 * Football Routes — SportsBrain Data API v1
 * ──────────────────────────────────────────
 * GET /v1/football/games/today
 * GET /v1/football/games/:date          (YYYY-MM-DD)
 * GET /v1/football/game/:id/props
 * GET /v1/football/team/:name/stats
 * GET /v1/football/player/:name/stats
 * GET /v1/football/props/today
 */

import { sbResponse, sbError, DQ, SOURCE_RELIABILITY, makeOddsValue } from '../schemas/base.js';
import { makeFootballProp } from '../schemas/football.js';
import {
  ftTeamPropConf, ftPlayerPropConf,
  tierLines, estimateShots, estimateCorners, estimateMatchImportance,
  estimateGoals, estimateCards, estimateOffsides, estimate1X2, probGoalsOver,
  opportunityScore, valueLabel, marketHealth, probToConf
} from '../intelligence/engine.js';
import { corsHeaders } from './health.js';
import { getBayesianMultipliers, marketFamily, confBand, getMLModel, predictML, extractMLFeatures } from './bayesianLearning.js';

export async function handleFootball(pathname, request, env, services, ctx) {
  const { football, odds, cache, persist } = services;

  // ── GET /v1/football/games/today ─────────────────────────────────────
  if (/^\/v1\/football\/games\/(today|[\d-]{10})$/.test(pathname)) {
    const m = pathname.match(/\/v1\/football\/games\/(.+)/);
    const dateParam = m[1] === 'today' ? null : m[1];
    const result = await football.getTodayGames(dateParam);

    // Persist games when live (non-blocking)
    if (result.source !== 'cache' && result.games.length && persist && ctx) {
      ctx.waitUntil(persist.upsertGames(result.games, 'football'));
    }

    return jsonResponse(sbResponse({
      data: {
        date: result.date,
        count: result.games.length,
        games: result.games,
        source: result.source,
      },
      meta: { endpoint: pathname, cached: result.source === 'cache' },
    }));
  }

  // ── GET /v1/football/game/:id/props ──────────────────────────────────
  if (/^\/v1\/football\/game\/[^/]+\/props$/.test(pathname)) {
    const gameId = pathname.split('/')[4];
    const cacheKey = `football:props:${gameId}`;
    let builtProps = null;
    let gameDate   = null;

    const { data: cachedProps, fromCache } = await cache.getOrFetch(
      cacheKey,
      async () => {
        // Find game in today's cache
        const today = await football.getTodayGames();
        const game = today.games.find(g => String(g.id) === String(gameId));
        if (!game) return null;

        const homeStats = await football.getTeamStats(game.home_team);
        const awayStats = await football.getTeamStats(game.away_team);
        const result    = await buildFootballProps(game, homeStats, awayStats, odds, env);

        // Stash for persistence below
        builtProps = result;
        gameDate   = game.date || game.game_date;

        // Persist team stats (non-blocking)
        if (persist && ctx) {
          if (homeStats) ctx.waitUntil(persist.upsertTeamStats(homeStats, 'football', 'home'));
          if (awayStats) ctx.waitUntil(persist.upsertTeamStats(awayStats, 'football', 'away'));
        }

        return result;
      },
      900
    );

    if (!cachedProps) return jsonResponse(sbError('GAME_NOT_FOUND', `Game ${gameId} not found`, 404), 404);

    // Persist props when this was a fresh build (not from cache)
    if (!fromCache && cachedProps?.props?.length && persist && ctx) {
      ctx.waitUntil(persist.insertPropResults(
        cachedProps.props, 'football',
        gameDate || new Date().toISOString().slice(0, 10),
        gameId
      ));
    }

    return jsonResponse(sbResponse({
      data: cachedProps,
      meta: { endpoint: pathname, game_id: gameId },
    }));
  }

  // ── GET /v1/football/props/today ─────────────────────────────────────
  // ENHANCED v2: une fonte API-Football (stats sólidos) com Bet365 capturados
  // (cobertura ampla: Brasileirão, Libertadores, etc) e enriquece com odds reais.
  if (pathname === '/v1/football/props/today') {
    const today = await football.getTodayGames();
    const allProps = [];

    // Persist games if live
    if (today.source !== 'cache' && today.games.length && persist && ctx) {
      ctx.waitUntil(persist.upsertGames(today.games, 'football'));
    }

    // ── Carrega matches Bet365 capturados pra ampliar cobertura ──────────
    let bet365Matches = []
    let bet365MarketsByFid = {}
    let calibrationByMarket = {}   // shifts históricos (W/L) por mercado
    // ── BAYESIAN AI LEARNING: multipliers per (sport, market_family, conf_band) ──
    let bayesianAdj = {}
    let bayesianLeagueAdj = {}
    let bayesianSampleSize = 0
    try {
      const bResult = await getBayesianMultipliers(env)
      bayesianAdj = bResult.adjustments || {}
      bayesianLeagueAdj = bResult.league_adjustments || {}
      bayesianSampleSize = bResult.sample_size || 0
    } catch {}

    // ── TIPSTER QUALITY SCORE: WR ajustado por (channel × market × odd_band) ──
    // Pra cada pick gerado, se algum tipster com TQS alto bateu market+odd similar,
    // boost confidence. TQS Bayesian = (k×prior + W) / (k + N), k=8.
    let tipsterScores = {}
    let tipsterGlobalWR = 0.5
    try {
      const { getTipsterQualityScores } = await import('./telegramTips.js')
      const tqs = await getTipsterQualityScores(env)
      tipsterScores = tqs.scores || {}
      tipsterGlobalWR = tqs.global_wr || 0.5
    } catch {}

    // ── TELEGRAM TIPS CONSENSUS: lê tips últimas 12h pra boost picks ──
    let telegramConsensus = {}  // {market_tag|line: {channels, total, avg_odd}}
    let telegramTipsCount = 0
    try {
      if (env.SB_DB) {
        const cutoff = Date.now() - 12 * 3600_000
        const { results } = await env.SB_DB.prepare(`
          SELECT market_tag, line, teams, COUNT(DISTINCT channel_id) AS ch, COUNT(*) AS total
          FROM telegram_tips
          WHERE posted_at >= ? AND market IS NOT NULL AND confidence_score >= 0.5
          GROUP BY market_tag, line, teams
        `).bind(cutoff).all()
        for (const r of (results || [])) {
          const teams = r.teams ? JSON.parse(r.teams) : []
          for (const team of teams) {
            const k = `${team}|${r.market_tag}|${r.line}`
            telegramConsensus[k] = { channels: r.ch, total: r.total }
            telegramTipsCount++
          }
        }
      }
    } catch {}
    // ── ML MODEL: gradient boosting treinado localmente, uploaded via /v1/ml/upload-model ──
    let mlModel = null
    try { mlModel = await getMLModel(env) } catch {}
    try {
      if (env.SB_DB) {
        const matchRow = await env.SB_DB.prepare(
          `SELECT payload FROM bet365_matches_snapshots ORDER BY created_at DESC LIMIT 1`
        ).first()
        if (matchRow) {
          try { bet365Matches = JSON.parse(matchRow.payload) || [] } catch {}
        }
        const mkRow = await env.SB_DB.prepare(
          `SELECT payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`
        ).first()
        if (mkRow) {
          try {
            const marketsList = JSON.parse(mkRow.payload) || []
            for (const m of marketsList) {
              if (m.fixtureId) {
                if (!bet365MarketsByFid[m.fixtureId]) bet365MarketsByFid[m.fixtureId] = []
                bet365MarketsByFid[m.fixtureId].push(m)
              }
            }
          } catch {}
        }
        // ── PINNACLE FALLBACK: carrega Pinnacle markets pra subir cobertura ──
        try {
          const pinRow = await env.SB_DB.prepare(
            `SELECT payload FROM pinnacle_markets_snapshots ORDER BY created_at DESC LIMIT 1`
          ).first()
          if (pinRow) {
            const pinList = JSON.parse(pinRow.payload) || []
            const pinMatches = []
            const pinByFid = {}
            const seenFid = new Set()
            for (const m of pinList) {
              if (!m.fixtureId) continue
              if (!pinByFid[m.fixtureId]) pinByFid[m.fixtureId] = []
              pinByFid[m.fixtureId].push(m)
              if (!seenFid.has(m.fixtureId)) {
                seenFid.add(m.fixtureId)
                pinMatches.push({ fixtureId: m.fixtureId, home: m.home, away: m.away, startTime: m.startTime })
              }
            }
            env.__pinnacleMatches = pinMatches
            env.__pinnacleByFid = pinByFid
          }
        } catch {}
        // Calibração: pega últimos 30d de pick_history e calcula W/L por (sport, market)
        try {
          const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString()
          const histRows = await env.SB_DB.prepare(
            `SELECT stat, conf, result FROM pick_history
             WHERE sport='football' AND (result='W' OR result='L') AND saved_at >= ? LIMIT 2000`
          ).bind(cutoff).all()
          const buckets = {}
          for (const r of (histRows.results || [])) {
            const k = (r.stat || '').toLowerCase().slice(0, 30)
            if (!buckets[k]) buckets[k] = { wins: 0, total: 0, confSum: 0 }
            buckets[k].total++
            buckets[k].confSum += r.conf || 0
            if (r.result === 'W') buckets[k].wins++
          }
          for (const [k, b] of Object.entries(buckets)) {
            if (b.total < 8) continue   // amostra mín
            const predicted = b.confSum / b.total
            const actual = (b.wins / b.total) * 100
            calibrationByMarket[k] = { multiplier: predicted > 0 ? actual/predicted : 1, sample: b.total }
          }
        } catch {}
      }
    } catch {}

    // ── Une fontes: games da API + matches Bet365 não cobertos ────────────
    const normTeam = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
    // Match fuzzy: aceita match parcial nos primeiros 5 chars (cobre variações de nome)
    const teamMatch = (a, b) => {
      const na = normTeam(a)
      const nb = normTeam(b)
      if (!na || !nb) return false
      if (na === nb) return true
      // Substring match nos 5 chars iniciais
      const a5 = na.slice(0, 5); const b5 = nb.slice(0, 5)
      return a5.length >= 4 && (na.includes(b5) || nb.includes(a5))
    }
    const apiKeys = new Set(today.games.map(g => `${normTeam(g.home_team)}|${normTeam(g.away_team)}`))
    const augmentedGames = [...today.games]
    let bet365OnlyCount = 0
    for (const bm of bet365Matches) {
      const k = `${normTeam(bm.home)}|${normTeam(bm.away)}`
      if (apiKeys.has(k)) continue
      // Match exclusivo Bet365 → adiciona como game minimal pra gerar props
      augmentedGames.push({
        id: bm.fixtureId || `bet365_${bet365OnlyCount++}`,
        home_team: bm.home, away_team: bm.away,
        league: bm.competition || 'Bet365', kickoff: bm.startTime || null,
        status: 'scheduled', score: null, season: '2025', source: 'bet365',
        _fromBet365Only: true,
      })
    }

    for (const game of augmentedGames.slice(0, 100)) { // cap 100 games (era 60 — mais cobertura Bet365)
      const homeStats = await football.getTeamStats(game.home_team).catch(() => null)
      const awayStats = await football.getTeamStats(game.away_team).catch(() => null)
      // Implied xG do Bet365 capturado (proprietário) — passa via leagueContext
      // Match fuzzy: tenta exato primeiro, depois substring
      const fidMatch = bet365Matches.find(bm =>
        teamMatch(bm.home, game.home_team) && teamMatch(bm.away, game.away_team)
      ) || bet365Matches.find(bm =>
        // Tenta home/away invertidos (eventual erro de annotation)
        teamMatch(bm.home, game.away_team) && teamMatch(bm.away, game.home_team)
      )
      const fidMarkets = fidMatch ? (bet365MarketsByFid[fidMatch.fixtureId] || []) : []
      let impliedXG = null
      if (fidMarkets.length) {
        impliedXG = deriveImpliedXG(fidMarkets)
      }
      const enrichedHome = impliedXG ? { ...(homeStats || {}), xg: { for: { per_game: impliedXG.lambdaHome }, against: { per_game: impliedXG.lambdaAway * 0.9 } } } : homeStats
      const enrichedAway = impliedXG ? { ...(awayStats || {}), xg: { for: { per_game: impliedXG.lambdaAway }, against: { per_game: impliedXG.lambdaHome * 0.9 } } } : awayStats
      const props = await buildFootballProps(game, enrichedHome, enrichedAway, odds, env)
      if (!props) continue
      // ── Enriquece cada prop com odd real Bet365 capturada (reusa fidMatch já calculado acima) ──
      if (fidMatch) {
        for (const p of props.props) {
          // Tenta encontrar odd real pelo stat + line + direction
          const realOdd = findBet365RealOdd(p, fidMarkets)
          if (realOdd) {
            p.book_odds = realOdd
            if (p.fair_odds && realOdd) {
              p.ev_pct = +((p.fair_odds / realOdd - 1) * 100).toFixed(2)
              p.edge_pct = +(((p.confidence/100) - (1/realOdd)) * 100).toFixed(2)
              p.is_value = p.ev_pct > 0
            }
            p._bet365_match = true
            p._odd_source = 'bet365'
          }
        }
      }
      // ── FALLBACK Pinnacle: matching MAIS AGRESSIVO (Pinnacle usa nomes EN) ──
      if (typeof env.__pinnacleMatches !== 'undefined') {
        // Aliases comuns BR/PT → EN (Pinnacle nomeia diferente)
        const ALIASES = {
          'sao paulo': ['sp','spaulo'], 'corinthians': ['timao'],
          'flamengo': ['fla','mengao'], 'fluminense': ['flu'],
          'palmeiras': ['palm','verdao'], 'santos': ['peixe'],
          'gremio': ['immortal'], 'internacional': ['inter','colorado'],
          'atletico mineiro': ['atletico mg','galo','mineiro'],
          'atletico paranaense': ['athletico','furacao','atletico pr'],
          'cruzeiro': ['raposa'], 'vasco': ['vasco da gama','gigante'],
          'botafogo': ['fogao','glorioso'], 'bahia': ['esquadrao'],
          'fortaleza': ['leao do pici'], 'ceara': ['vovo'],
          'real madrid': ['real','los blancos'], 'barcelona': ['barca','blaugrana'],
          'manchester city': ['man city','citizens'], 'manchester united': ['man utd','red devils'],
          'liverpool': ['reds'], 'chelsea': ['blues'],
          'bayer leverkusen': ['leverkusen'], 'bayern munich': ['bayern','munich'],
          'borussia dortmund': ['dortmund','bvb'],
          'paris saint germain': ['psg'], 'juventus': ['juve','old lady'],
          'inter milan': ['inter','internazionale'], 'ac milan': ['milan','rossoneri'],
          'river plate': ['river','river plate ar'],
          'boca juniors': ['boca','xeneizes'],
          'libertad': ['libertad py'], 'olimpia': ['olimpia py'],
          'penarol': ['penarol uy'], 'nacional': ['nacional uy','national'],
        }
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
        const aliasOf = (s) => {
          const n = norm(s)
          const direct = ALIASES[n] || []
          // Tenta também substring base
          for (const k of Object.keys(ALIASES)) {
            if (n.includes(k) || k.includes(n)) {
              return [k, ...direct, ...(ALIASES[k] || [])]
            }
          }
          return [n, ...direct]
        }
        const aggressiveMatch = (a, b) => {
          if (!a || !b) return false
          const aliasesA = aliasOf(a)
          const aliasesB = aliasOf(b)
          // qualquer combinação alias casa
          for (const aa of aliasesA) {
            for (const bb of aliasesB) {
              if (aa === bb) return true
              if (aa.length >= 4 && bb.length >= 4) {
                if (aa.slice(0, 5) === bb.slice(0, 5)) return true
                if (aa.slice(0, 4) === bb.slice(0, 4)) return true
                if (bb.includes(aa) || aa.includes(bb)) return true
              }
            }
          }
          // Last-name match (com 4+ chars)
          const aLast = (a.split(/\s+/).pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
          const bLast = (b.split(/\s+/).pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
          if (aLast.length >= 5 && aLast === bLast) return true
          return false
        }
        const pinFidMatch = env.__pinnacleMatches.find(pm =>
          aggressiveMatch(pm.home, game.home_team) && aggressiveMatch(pm.away, game.away_team)
        ) || env.__pinnacleMatches.find(pm =>
          aggressiveMatch(pm.home, game.away_team) && aggressiveMatch(pm.away, game.home_team)
        )
        if (pinFidMatch) {
          const pinMarkets = (env.__pinnacleByFid || {})[pinFidMatch.fixtureId] || []
          for (const p of props.props) {
            if (p._bet365_match) continue  // já matchou Bet365
            const pinOdd = findBet365RealOdd(p, pinMarkets)  // mesma lógica funciona pra Pinnacle
            if (pinOdd) {
              p.book_odds = pinOdd
              if (p.fair_odds) {
                p.ev_pct = +((p.fair_odds / pinOdd - 1) * 100).toFixed(2)
                p.edge_pct = +(((p.confidence/100) - (1/pinOdd)) * 100).toFixed(2)
                p.is_value = p.ev_pct > 0
              }
              p._pinnacle_match = true
              p._odd_source = 'pinnacle'
            }
          }
        }
      }
      // Aplica calibração histórica: ajusta confidence baseado em W/L real do mercado
      for (const p of props.props) {
        const k = (p.stat || '').toLowerCase().slice(0, 30)
        const cal = calibrationByMarket[k]
        if (cal && cal.multiplier > 0.4 && cal.multiplier < 1.6 && cal.sample >= 8) {
          const newConf = Math.round(p.confidence * cal.multiplier)
          p._calibrated_from = p.confidence
          p._calibration_mult = cal.multiplier
          p._calibration_sample = cal.sample
          p.confidence = Math.max(35, Math.min(95, newConf))
          // Reaplica conviction
          if (p.fair_odds && p.book_odds) {
            p.ev_pct = +((p.fair_odds / p.book_odds - 1) * 100).toFixed(2)
            p.edge_pct = +(((p.confidence/100) - (1/p.book_odds)) * 100).toFixed(2)
          }
        }
      }

      // ── ML MODEL ENSEMBLE: aplica modelo gradient boosting (treino diário local) ──
      // Composto: blend ML prediction com confidence atual via average ponderado.
      // ML peso = 0.4 (modelo ainda em desenvolvimento, sample 713 picks).
      if (mlModel) {
        for (const p of props.props) {
          const features = extractMLFeatures(p)
          const mlProb = predictML(mlModel, features)
          if (mlProb != null && mlProb > 0.05 && mlProb < 0.95) {
            const oldConf = p.confidence
            const blended = oldConf * 0.6 + mlProb * 100 * 0.4
            p._ml_prob = +(mlProb * 100).toFixed(1)
            p._ml_from = oldConf
            p.confidence = Math.max(35, Math.min(95, Math.round(blended)))
            // Reaplica EV se book_odds presente
            if (p.fair_odds && p.book_odds) {
              p.ev_pct = +((p.fair_odds / p.book_odds - 1) * 100).toFixed(2)
              p.edge_pct = +(((p.confidence/100) - (1/p.book_odds)) * 100).toFixed(2)
            }
          }
        }
      }

      // ── TIPSTER QUALITY SCORE BOOST — se tipster com TQS alto cobriu mesma market+odd ──
      if (Object.keys(tipsterScores).length > 0 && telegramTipsCount > 0) {
        const oddBand = (o) => o < 2 ? 'low' : o < 5 ? 'mid' : o < 10 ? 'high' : 'very_high'
        for (const p of props.props) {
          if (!p.book_odds) continue
          const market = (p.stat || '').toUpperCase()
          const band = oddBand(p.book_odds)
          // Procura buckets pra QUALQUER channel onde TQS > 0.55 e market+band match
          let bestTQS = null
          for (const [key, score] of Object.entries(tipsterScores)) {
            const [_chId, mkt, b] = key.split('|')
            if (b !== band) continue
            // Match parcial market (TOTAL_GOALS ↔ goals etc)
            if (!mkt.toLowerCase().includes(market.toLowerCase().slice(0, 6)) &&
                !market.toLowerCase().includes(mkt.toLowerCase().slice(0, 6))) continue
            if (score.tqs >= 0.55 && score.n >= 5) {
              if (!bestTQS || score.tqs > bestTQS.tqs) bestTQS = score
            }
          }
          if (bestTQS) {
            // Boost: TQS 60% → 1.05x, 70% → 1.10x, 80%+ → 1.15x
            const boost = bestTQS.tqs >= 0.80 ? 1.15 : bestTQS.tqs >= 0.70 ? 1.10 : 1.05
            p._tqs_boost = +(bestTQS.tqs).toFixed(3)
            p._tqs_n = bestTQS.n
            p._tqs_mult = boost
            p.confidence = Math.min(95, Math.round(p.confidence * boost))
          }
        }
      }

      // ── TELEGRAM CONSENSUS BOOST — picks com 2+ tipsters alinhados sobem confidence ──
      if (telegramTipsCount > 0) {
        const homeNorm = (game.home_team || '').toLowerCase()
        const awayNorm = (game.away_team || '').toLowerCase()
        for (const p of props.props) {
          // Mapeia nosso stat pra market_tag do parser
          let tag = null
          const s = (p.stat || '').toLowerCase()
          if (s === 'goals' && p.direction === 'over') tag = 'over_goals'
          else if (s === 'goals' && p.direction === 'under') tag = 'under_goals'
          else if (s === 'corners' && p.direction === 'over') tag = 'over_corners'
          else if (s === 'btts') tag = 'btts'
          else if (s === 'result') tag = 'win'
          if (!tag) continue
          // Busca consenso pra qualquer time mencionado
          let bestConsensus = null
          for (const team of [homeNorm, awayNorm]) {
            for (const hint of [team, team.split(' ')[0], team.split(' ').slice(0,2).join(' ')]) {
              const k = `${hint}|${tag}|${p.line}`
              if (telegramConsensus[k] && (!bestConsensus || telegramConsensus[k].channels > bestConsensus.channels)) {
                bestConsensus = telegramConsensus[k]
              }
            }
          }
          if (bestConsensus && bestConsensus.channels >= 2) {
            // 2 channels: +5%, 3+: +8%, 5+: +12%
            const boost = bestConsensus.channels >= 5 ? 1.12 : bestConsensus.channels >= 3 ? 1.08 : 1.05
            p._telegram_consensus = { channels: bestConsensus.channels, tips: bestConsensus.total, boost }
            p.confidence = Math.min(95, Math.round(p.confidence * boost))
          }
        }
      }

      // ── BAYESIAN AI LEARNING — aplica shrinkage por (sport, market_family, conf_band) ──
      // Funciona com poucas amostras (Beta-Binomial prior). Composto após calibração.
      if (Object.keys(bayesianAdj).length > 0 || Object.keys(bayesianLeagueAdj).length > 0) {
        for (const p of props.props) {
          const fam = marketFamily(p.stat)
          const band = confBand(p.confidence)
          const generalKey = `football|${fam}|${band}`
          const leagueKey = `football|${fam}|${(game.league || 'unknown').slice(0, 30)}`
          // Liga-specific tem prioridade (mais granular). Senão geral.
          const leagueMult = bayesianLeagueAdj[leagueKey]
          const generalMult = bayesianAdj[generalKey]
          let mult = 1
          if (leagueMult != null) mult = leagueMult
          else if (generalMult != null) mult = generalMult
          if (mult !== 1) {
            const newConf = Math.round(p.confidence * mult)
            p._bayesian_from = p.confidence
            p._bayesian_mult = +mult.toFixed(3)
            p._bayesian_source = leagueMult != null ? 'league' : 'general'
            p.confidence = Math.max(35, Math.min(95, newConf))
            // Reaplica EV se tem book_odds
            if (p.fair_odds && p.book_odds) {
              p.ev_pct = +((p.fair_odds / p.book_odds - 1) * 100).toFixed(2)
              p.edge_pct = +(((p.confidence/100) - (1/p.book_odds)) * 100).toFixed(2)
            }
          }
        }
      }
      allProps.push(...props.props);

      // Persist team stats and props (non-blocking)
      if (persist && ctx) {
        if (homeStats) ctx.waitUntil(persist.upsertTeamStats(homeStats, 'football', 'home'));
        if (awayStats) ctx.waitUntil(persist.upsertTeamStats(awayStats, 'football', 'away'));
        if (props?.props?.length) {
          ctx.waitUntil(persist.insertPropResults(
            props.props, 'football',
            today.date,
            String(game.id)
          ));
        }
      }
    }

    // Sort: picks com odd real Bet365 primeiro, depois por opportunity score
    allProps.sort((a, b) => {
      if (a._bet365_match !== b._bet365_match) return b._bet365_match ? 1 : -1
      return (b.opportunity_score || 0) - (a.opportunity_score || 0)
    });

    // Cache movido pra endpoint dedicado /internal/cache-picks-today
    // (props/today já usa muitos subrequests, não cabe mais aqui)

    return jsonResponse(sbResponse({
      data: {
        date: today.date,
        total_props: allProps.length,
        bet365_matched: allProps.filter(p => p._bet365_match).length,
        bayesian_applied: allProps.filter(p => p._bayesian_mult != null).length,
        ml_applied: allProps.filter(p => p._ml_prob != null).length,
        coverage: { api_games: today.games.length, bet365_added: augmentedGames.length - today.games.length },
        ai_learning: {
          bayesian_sample_size: bayesianSampleSize,
          calibration_buckets: Object.keys(calibrationByMarket).length,
          bayesian_buckets: Object.keys(bayesianAdj).length,
          bayesian_league_buckets: Object.keys(bayesianLeagueAdj).length,
          ml_model_loaded: !!mlModel,
          ml_model_version: mlModel?.version || null,
          ml_model_metrics: mlModel?.metrics || null,
          telegram_tips_active: telegramTipsCount,
          telegram_consensus_applied: allProps.filter(p => p._telegram_consensus).length,
          tqs_buckets: Object.keys(tipsterScores).length,
          tqs_boost_applied: allProps.filter(p => p._tqs_boost).length,
          tipster_global_wr: +(tipsterGlobalWR * 100).toFixed(1),
        },
        top_props: allProps.slice(0, 800),  // 120 → 800 (cabe HT picks + variedade)
        all_props: new URL(request.url).searchParams.get('compact') === '1' ? undefined : allProps,
      },
      meta: { endpoint: pathname },
    }));
  }

  // ── GET /v1/football/team/:name/stats ────────────────────────────────
  if (/^\/v1\/football\/team\/[^/]+\/stats$/.test(pathname)) {
    const teamName = decodeURIComponent(pathname.split('/')[4]);
    const stats = await football.getTeamStats(teamName);

    // Persist team stats (non-blocking)
    if (stats && persist && ctx) {
      ctx.waitUntil(persist.upsertTeamStats(stats, 'football', stats.home_away || 'all'));
    }

    return jsonResponse(sbResponse({
      data: stats,
      meta: { endpoint: pathname, team: teamName },
    }));
  }

  return jsonResponse(sbError('NOT_FOUND', `Route ${pathname} not found`, 404), 404);
}

// ── deriveImpliedXG: extrai λ_home/λ_away dos markets capturados Bet365 ───
// PROPRIETÁRIO: deriva xG-equivalente do consenso de mercado (sem deps externas)
function deriveImpliedXG(fidMarkets) {
  const totals = fidMarkets.filter(r => r.market === 'TOTAL_GOALS' && r.over && r.under)
  if (!totals.length) return null
  let lambdaTotal = null
  // Linha 0.5 dá λ direto: P(>0.5) = 1 - exp(-λ)
  const t05 = totals.find(t => Math.abs(t.line - 0.5) < 0.01)
  if (t05) {
    const sumImpl = 1/t05.over + 1/t05.under
    const fairOver = (1/t05.over) / sumImpl
    lambdaTotal = -Math.log(Math.max(0.01, 1 - fairOver))
  }
  // Senão, linha mais próxima de 2.5 com busca binária
  if (lambdaTotal == null) {
    const t = totals.reduce((a, b) => Math.abs(b.line - 2.5) < Math.abs(a.line - 2.5) ? b : a)
    const sumImpl = 1/t.over + 1/t.under
    const fairOver = (1/t.over) / sumImpl
    let lo = 0.5, hi = 5
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2
      let cum = 0
      for (let k = 0; k <= Math.floor(t.line); k++) {
        let p = Math.exp(-mid)
        for (let j = 1; j <= k; j++) p *= mid / j
        cum += p
      }
      const pOver = 1 - cum
      if (pOver > fairOver) hi = mid
      else lo = mid
    }
    lambdaTotal = (lo + hi) / 2
  }
  // Razão home/away via 1X2
  const oneXtwo = fidMarkets.filter(r => r.market === '1X2')
  let ratio = 1.0
  if (oneXtwo.length === 3) {
    const sumImpl = oneXtwo.reduce((s, r) => s + 1/r.odd, 0)
    const homeRow = oneXtwo.find(r => r.selection === 'home')
    const awayRow = oneXtwo.find(r => r.selection === 'away')
    if (homeRow && awayRow) {
      const pH = (1/homeRow.odd) / sumImpl
      const pA = (1/awayRow.odd) / sumImpl
      ratio = pH / Math.max(0.05, pA)
    }
  }
  const lambdaHome = +(lambdaTotal * ratio / (1 + ratio)).toFixed(2)
  const lambdaAway = +(lambdaTotal / (1 + ratio)).toFixed(2)
  return { lambdaTotal: +lambdaTotal.toFixed(2), lambdaHome, lambdaAway }
}

// ── findBet365RealOdd: encontra odd real Bet365 pra um prop ───────────────
function findBet365RealOdd(prop, fidMarkets) {
  const stat = (prop.stat || '').toLowerCase()
  const line = prop.line
  const direction = (prop.direction || '').toLowerCase()
  // ── Mercados sem linha (1X2, BTTS, DC, DNB) ──────────────────────────
  // Disambiguate: stat='result' pode ser 1X2 OU Double Chance (depende do market name)
  if (stat === 'result' || stat === 'win' || stat === '1x2' || stat === 'double_chance' || stat === 'dc') {
    const isDC = stat === 'double_chance' || stat === 'dc' ||
                 (prop.market && /chance dupla|double chance/i.test(prop.market))
    const dirNorm = (direction || '').toLowerCase()
    if (isDC) {
      // DC: '1x'/'12'/'x2' (também aceita 'home_draw'/'home_away'/'draw_away')
      const wantSel = ['1x','home_draw','homedraw','hd','hx','home/draw'].includes(dirNorm) ? '1X'
                    : ['12','home_away','homeaway','ha','home/away'].includes(dirNorm) ? '12'
                    : ['x2','draw_away','drawaway','da','draw/away'].includes(dirNorm) ? 'X2'
                    : (direction || '').toUpperCase()
      // 1) Tenta market DC direto
      const r = fidMarkets.find(m => m.market === 'DOUBLE_CHANCE' && (m.selection || '').toUpperCase() === wantSel)
      if (r?.odd && r.odd >= 1.3) return +r.odd.toFixed(2)
      // 2) FALLBACK: derive DC odd das odds 1X2 stored (Bet365 nem sempre captura DC pure)
      // DC '1X' = 1/(1/home + 1/draw), '12' = 1/(1/home+1/away), 'X2' = 1/(1/draw+1/away)
      const r1x2 = fidMarkets.filter(m => m.market === 'RESULT' || m.market === '1X2')
      const home = r1x2.find(m => (m.selection || '').toLowerCase() === 'home')?.odd
      const away = r1x2.find(m => (m.selection || '').toLowerCase() === 'away')?.odd
      const draw = r1x2.find(m => (m.selection || '').toLowerCase() === 'draw')?.odd
      if (home && away && draw) {
        // Aplica overround correction (~1.05x = books margin típica BR)
        const margin = 1.05
        let dcOdd = null
        if (wantSel === '1X') dcOdd = margin / (1/home + 1/draw)
        else if (wantSel === '12') dcOdd = margin / (1/home + 1/away)
        else if (wantSel === 'X2') dcOdd = margin / (1/draw + 1/away)
        if (dcOdd && dcOdd >= 1.05 && dcOdd <= 5) return +dcOdd.toFixed(2)
      }
      return null
    }
    // 1X2 puro
    const wantSel = ['home','1'].includes(dirNorm) ? 'home'
                  : ['away','2'].includes(dirNorm) ? 'away'
                  : ['draw','x','empate','tie'].includes(dirNorm) ? 'draw'
                  : dirNorm
    const r = fidMarkets.find(m => (m.market === 'RESULT' || m.market === '1X2') && (m.selection || '').toLowerCase() === wantSel)
    if (r?.odd && r.odd >= 1.3 && r.odd <= 15) return +r.odd.toFixed(2)
    return null
  }
  if (stat === 'btts' || stat === 'both_teams_score' || stat === 'ambos_marcam') {
    const dirNorm = (direction || '').toLowerCase()
    const wantSel = ['over','yes','sim','y'].includes(dirNorm) ? 'yes' : 'no'
    const r = fidMarkets.find(m => m.market === 'BTTS' && (m.selection || '').toLowerCase() === wantSel)
    if (r?.odd && r.odd >= 1.3) return +r.odd.toFixed(2)
    return null
  }
  if (stat === 'double_chance' || stat === 'dc' || (prop.market && /chance dupla|double chance/i.test(prop.market))) {
    const dirNorm = (direction || '').toLowerCase()
    // Mapa: '1x'/'home_draw'→'1X', '12'/'home_away'→'12', 'x2'/'draw_away'→'X2'
    const wantSel = ['1x','home_draw','homedraw','hx'].includes(dirNorm) ? '1X'
                  : ['12','home_away','homeaway','hw','ha','hw'].includes(dirNorm) ? '12'
                  : ['x2','draw_away','drawaway','dw','xa'].includes(dirNorm) ? 'X2'
                  : (direction || '').toUpperCase()
    const r = fidMarkets.find(m => m.market === 'DOUBLE_CHANCE' && (m.selection || '').toUpperCase() === wantSel)
    if (r?.odd && r.odd >= 1.3) return +r.odd.toFixed(2)
    return null
  }
  if (stat === 'draw_no_bet' || (prop.market && /empate anula|draw no bet/i.test(prop.market))) {
    const r = fidMarkets.find(m => m.market === 'DRAW_NO_BET' && m.selection === direction)
    if (r?.odd && r.odd >= 1.3) return +r.odd.toFixed(2)
    return null
  }
  if (stat === 'asian_handicap' || stat === 'corner_handicap' || stat === 'first_team_score' ||
      stat === 'half_more_goals' || stat === 'win_to_nil' || stat === 'clean_sheet' ||
      stat === 'htft' || stat === 'score_range' || stat === 'result_btts' ||
      stat === 'penalty' || stat === 'red_card') {
    return null  // mercados derivados sem match direto Bet365
  }
  if (line == null) return null
  // ── Mercados com linha (Total Goals, Corners, Cards, Shots, Player props) ──
  // Inclui PLAYER_SHOTS, PLAYER_SHOTS_ON_TARGET, PLAYER_CARDS, PLAYER_FOULS, PLAYER_TACKLES, PLAYER_HEADERS
  const buckets = (() => {
    if (stat === 'goals')        return { keys: ['TOTAL_GOALS', 'GOALS_RANGE'], kw: /gol|goal/i }
    if (stat === 'team_goals')   return { keys: ['TEAM_GOALS_RANGE', 'OTHER'], kw: /team|time/i }
    if (stat === 'corners')      return { keys: ['CORNERS_OU'], kw: /corner|escanteio/i }
    if (stat === 'cards')        return { keys: ['CARDS_OU'], kw: /card|cart/i }
    if (stat === 'shots')        return { keys: ['PLAYER_SHOTS', 'PLAYER_SHOTS_ON_TARGET', 'OTHER'], kw: /shot|chute|finaliz/i }
    if (stat === 'sot')          return { keys: ['PLAYER_SHOTS_ON_TARGET', 'OTHER'], kw: /chute.*ao gol|shot.*on.*target/i }
    if (stat === 'offsides')     return { keys: ['OTHER'], kw: /offside|impedi/i }
    if (stat === 'fouls')        return { keys: ['PLAYER_FOULS', 'OTHER'], kw: /falta|foul/i }
    if (stat === 'tackles')      return { keys: ['PLAYER_TACKLES', 'OTHER'], kw: /desarme|tackle/i }
    return { keys: [], kw: null }
  })()
  // Tolerance 0.51: aceita 1.5 ↔ 1.25/1.5/1.75/2.0 (asian halves), mas NÃO 1.5 ↔ 2.5
  for (const r of fidMarkets) {
    if (!buckets.keys.includes(r.market) && !(r.market === 'OTHER' && buckets.kw && buckets.kw.test(r.mgName || ''))) continue
    if (r.line == null) continue
    if (Math.abs(r.line - line) > 0.51) continue
    const side = r.side || (r.over != null ? 'over' : r.under != null ? 'under' : null)
    if (direction && side && direction !== side) continue
    const odd = (r.over && direction === 'over') ? r.over
              : (r.under && direction === 'under') ? r.under
              : r.odd
    if (odd && odd >= 1.3 && odd <= 15) return +odd.toFixed(2)
  }
  return null
}

// ── Build all props for a football game ──────────────────────────────────
async function buildFootballProps(game, homeStats, awayStats, oddsService, env) {
  // Compute match importance BEFORE shots/corners (affects projections)
  const matchImportance = estimateMatchImportance(game);

  // Pass full stats objects (not sub-objects) — estimateShots reads shots.per_game internally
  const shots   = estimateShots(homeStats, awayStats, {}, matchImportance);
  const corners = estimateCorners(homeStats, awayStats, {}, matchImportance);
  const goals   = estimateGoals(homeStats, awayStats, {}, matchImportance);
  const cards   = estimateCards(homeStats, awayStats, {}, null);
  const offs    = estimateOffsides(homeStats, awayStats);
  const probs1X2 = estimate1X2(goals.home, goals.away);

  // ═══ HT (1º Tempo) ESTIMATIVAS PER-TEAM (FAIXA pattern) ═══
  // Heurística empírica: HT é ~44% do total FT (stats Premier/La Liga/Br)
  const htRatio = 0.44
  const htShotsHome = +(shots.home * htRatio).toFixed(1)
  const htShotsAway = +(shots.away * htRatio).toFixed(1)
  const htCornersHome = +((corners.home || corners.total * 0.5) * htRatio).toFixed(1)
  const htCornersAway = +((corners.away || corners.total * 0.5) * htRatio).toFixed(1)
  // Função pra gerar prob via Poisson approximation
  const poissonOver = (lambda, line) => {
    let cum = 0
    for (let k = 0; k <= Math.floor(line); k++) {
      let p = Math.exp(-lambda)
      for (let i = 1; i <= k; i++) p *= lambda / i
      cum += p
    }
    return 1 - cum
  }

  const oddsData = oddsService ? await oddsService.getOdds('football') : { odds: [] };
  const gameOdds = oddsData?.odds?.length
    ? oddsService.matchGameOdds(oddsData.odds, game.home_team, game.away_team)
    : null;

  const props = [];

  // ── Team Shots FT ──────────────────────────────────────────────────
  const shTiers = tierLines(shots.total);
  for (const [tier, line] of Object.entries(shTiers)) {
    if (line < 4.5) continue;
    const conf = ftTeamPropConf(shots.total, line, 0.28, shots.dq, shots.sample_size);
    const bkOdds = _extractBookOdds(gameOdds, 'totals');
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'shots', market: 'Total Shots FT',
      is_ht: false, line, direction: 'over', tier, avg: shots.total, conf,
      book_odds: bkOdds, dq: shots.dq, source_reliability: SOURCE_RELIABILITY.MEDIUM,
      sample_size: shots.sample_size,
      reason: `${game.home_team} ~${shots.home} + ${game.away_team} ~${shots.away} = ${shots.total} shots/game projected.`,
      positive: shots.dq === DQ.REAL ? 'Based on real shot data' : 'Estimated from scoring average',
      negative: 'Shot volume has high game-to-game variance',
    }));
  }

  // ── Team Shots HT ──────────────────────────────────────────────────
  const shotsHT  = parseFloat((shots.total * 0.44).toFixed(1));
  const shHTiers = tierLines(Math.max(shotsHT, 3.5));
  for (const [tier, line] of Object.entries({ safe: shHTiers.safe, median: shHTiers.median })) {
    if (line < 3.5) continue;
    const conf = ftTeamPropConf(shotsHT, line, 0.34, shots.dq, shots.sample_size);
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'shots', market: 'Total Shots HT',
      is_ht: true, line, direction: 'over', tier, avg: shotsHT, conf,
      dq: shots.dq, source_reliability: SOURCE_RELIABILITY.MEDIUM,
      sample_size: shots.sample_size,
      reason: `HT shots ~44% of FT avg (${shots.total} → ${shotsHT}).`,
      positive: 'First-half shot markets are more stable', negative: 'Fewer possessions = higher variance',
    }));
  }

  // ── Corners FT ────────────────────────────────────────────────────
  const cnTiers = tierLines(corners.total);
  for (const [tier, line] of Object.entries(cnTiers)) {
    if (line < 4.5) continue;
    const conf = ftTeamPropConf(corners.total, line, 0.30, corners.dq, corners.sample_size);
    const cornersProb = probGoalsOver(corners.total, line);
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'corners', market: 'Total Corners FT',
      is_ht: false, line, direction: 'over', tier, avg: corners.total, conf,
      dq: corners.dq, source_reliability: SOURCE_RELIABILITY.MEDIUM, sample_size: corners.sample_size,
      model_prob: cornersProb,
      reason: `${game.home_team} ~${corners.home} + ${game.away_team} ~${corners.away} = ${corners.total} corners/game.`,
      positive: corners.dq === DQ.REAL ? 'Real corner data' : 'Historical league average',
      negative: 'Corner markets highly sensitive to game flow',
    }));
  }

  // ── Corners HT ────────────────────────────────────────────────────
  const cnHTiers = tierLines(corners.ht.total);
  for (const [tier, line] of Object.entries({ safe: cnHTiers.safe, median: cnHTiers.median })) {
    if (line < 2.5) continue;
    const conf = ftTeamPropConf(corners.ht.total, line, 0.38, corners.dq, corners.sample_size);
    const cornersHTProb = probGoalsOver(corners.ht.total, line);
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'corners', market: 'Total Corners HT',
      is_ht: true, line, direction: 'over', tier, avg: corners.ht.total, conf,
      dq: corners.dq, source_reliability: SOURCE_RELIABILITY.MEDIUM, sample_size: corners.sample_size,
      model_prob: cornersHTProb,
      reason: `HT corners ~42% of FT avg (${corners.total} → ${corners.ht.total}).`,
      positive: 'First-half corner market — more stable than FT', negative: 'Small sample in HT',
    }));
  }

  // ── TOTAL GOALS FT (Poisson) ────────────────────────────────────────
  const goalLines = [1.5, 2.5, 3.5]
  for (const line of goalLines) {
    const probOver = probGoalsOver(goals.total, line)
    const probUnder = 1 - probOver
    // Over
    const confOver = probToConf(probOver, goals.dq, goals.sample_size)
    if (confOver >= 50) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'goals', market: 'Total Goals',
        is_ht: false, line, direction: 'over',
        tier: line === 1.5 ? 'safe' : line === 2.5 ? 'median' : 'aggressive',
        avg: goals.total, conf: confOver, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        model_prob: probOver,
        reason: `Lambda Poisson ${goals.home}+${goals.away}=${goals.total}; P(>${line}) = ${(probOver*100).toFixed(1)}%`,
        positive: 'Modelo Poisson com força ofensiva/defensiva real',
        negative: 'Variance natural alta em jogos de gol único',
      }))
    }
    // Under
    const confUnder = probToConf(probUnder, goals.dq, goals.sample_size)
    if (confUnder >= 55 && line >= 2.5) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'goals', market: 'Total Goals',
        is_ht: false, line, direction: 'under',
        tier: line === 2.5 ? 'safe' : 'median',
        avg: goals.total, conf: confUnder, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        model_prob: probUnder,
        reason: `Lambda total ${goals.total}; P(<${line}) = ${(probUnder*100).toFixed(1)}%`,
        positive: 'Defesas fortes ou ataques em má fase favorecem under',
        negative: 'Pênaltis tardios e VAR mudam under no fim',
      }))
    }
  }

  // ── TOTAL GOALS HT ──────────────────────────────────────────────────
  for (const line of [0.5, 1.5]) {
    const probOver = probGoalsOver(goals.ht.total, line)
    const conf = probToConf(probOver, goals.dq, goals.sample_size)
    if (conf >= 55) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'goals', market: 'Total Goals',
        is_ht: true, line, direction: 'over',
        tier: line === 0.5 ? 'safe' : 'median',
        avg: goals.ht.total, conf, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        model_prob: probOver,
        reason: `HT goals ~40% do FT (${goals.total}→${goals.ht.total}); P(>${line}) HT = ${(probOver*100).toFixed(1)}%`,
        positive: 'Times atacam mais cedo em jogos importantes',
        negative: 'Início cauteloso é tendência em ligas defensivas',
      }))
    }
  }

  // ── BTTS (Both Teams to Score) ──────────────────────────────────────
  const bttsConf = probToConf(goals.btts_prob, goals.dq, goals.sample_size)
  if (bttsConf >= 55) {
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'btts', market: 'Both Teams to Score',
      is_ht: false, line: null, direction: 'over', tier: 'safe',
      avg: goals.btts_prob, conf: bttsConf, dq: goals.dq, sample_size: goals.sample_size,
      source_reliability: SOURCE_RELIABILITY.MEDIUM,
      model_prob: goals.btts_prob,
      reason: `P(BTTS) = ${(goals.btts_prob*100).toFixed(1)}% (lambdas ${goals.home}/${goals.away})`,
      positive: 'Ambos os times costumam marcar',
      negative: 'Times defensivos podem zerar 1 lado',
    }))
  } else if ((1-goals.btts_prob) >= 0.55) {
    const noConf = probToConf(1 - goals.btts_prob, goals.dq, goals.sample_size)
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'btts', market: 'Both Teams to Score',
      is_ht: false, line: null, direction: 'under', tier: 'median',
      avg: 1-goals.btts_prob, conf: noConf, dq: goals.dq, sample_size: goals.sample_size,
      source_reliability: SOURCE_RELIABILITY.MEDIUM,
      model_prob: 1-goals.btts_prob,
      reason: `P(no BTTS) = ${((1-goals.btts_prob)*100).toFixed(1)}%`,
      positive: 'Defesa forte ou ataque fraco favorece NÃO',
      negative: 'Gol tardio do azarão pode estragar',
    }))
  }

  // ── MATCH RESULT 1X2 (TODOS os outcomes com prob >= 0.30) ──────────
  // Antes: só pickava favorito com prob >= 0.50 (1 pick por jogo)
  // Agora: gera up to 3 picks (home, draw, away) com prob >= 0.30 — Bet365 odds
  // verificadas vão filtrar EV+ depois. Mais variedade no Tier 1.
  const allOutcomes = [
    { sel: 'home', prob: probs1X2.home, label: 'Casa Vence' },
    { sel: 'draw', prob: probs1X2.draw, label: 'Empate' },
    { sel: 'away', prob: probs1X2.away, label: 'Fora Vence' },
  ]
  for (const oc of allOutcomes) {
    if (oc.prob < 0.30) continue
    const conf1X2 = probToConf(oc.prob, goals.dq, goals.sample_size)
    if (conf1X2 < 50) continue
    const tier1X2 = oc.prob >= 0.55 ? 'safe' : oc.prob >= 0.40 ? 'median' : 'aggressive'
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'result', market: 'Match Result',
      is_ht: false, line: null, direction: oc.sel, tier: tier1X2,
      avg: oc.prob, conf: conf1X2, dq: goals.dq, sample_size: goals.sample_size,
      source_reliability: SOURCE_RELIABILITY.MEDIUM,
      model_prob: oc.prob,
      reason: `1X2 Poisson: ${oc.label} ${(oc.prob*100).toFixed(0)}% (h${(probs1X2.home*100).toFixed(0)}/d${(probs1X2.draw*100).toFixed(0)}/a${(probs1X2.away*100).toFixed(0)})`,
      positive: 'Modelo Poisson + força ofensiva/defensiva',
      negative: 'Não captura lesões/lineups · empate é variance high',
    }))
  }

  // ── DOUBLE CHANCE — todos com prob 0.55-0.90 (mais picks pra matchar Bet365)
  const dcs = [
    { sel: '1X', prob: probs1X2.home + probs1X2.draw, label: 'Casa ou Empate' },
    { sel: '12', prob: probs1X2.home + probs1X2.away, label: 'Casa ou Fora' },
    { sel: 'X2', prob: probs1X2.draw + probs1X2.away, label: 'Empate ou Fora' },
  ]
  for (const dc of dcs) {
    if (dc.prob < 0.55 || dc.prob > 0.92) continue  // skip muito safe/risk
    const dcConf = probToConf(dc.prob, goals.dq, goals.sample_size)
    if (dcConf < 50) continue
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'team', stat: 'result', market: 'Double Chance',
      is_ht: false, line: null, direction: dc.sel,
      tier: dc.prob >= 0.75 ? 'safe' : 'median',
      avg: dc.prob, conf: dcConf, dq: goals.dq, sample_size: goals.sample_size,
      source_reliability: SOURCE_RELIABILITY.MEDIUM,
      model_prob: dc.prob,
      reason: `DC ${dc.label}: ${(dc.prob*100).toFixed(1)}% (Poisson 1X2)`,
      positive: 'Cobertura dupla = menor variance',
      negative: 'Odds menores = retorno limitado',
    }))
  }

  // ── CARDS FT/HT ─────────────────────────────────────────────────────
  const cdTiers = tierLines(cards.total)
  for (const [tier, line] of Object.entries(cdTiers)) {
    if (line < 2.5) continue
    const conf = ftTeamPropConf(cards.total, line, 0.32, cards.dq, cards.sample_size)
    const cardsProb = probGoalsOver(cards.total, line)
    if (conf >= 55) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'cards', market: 'Total Cards',
        is_ht: false, line, direction: 'over', tier, avg: cards.total, conf,
        dq: cards.dq, sample_size: cards.sample_size, source_reliability: SOURCE_RELIABILITY.MEDIUM,
        model_prob: cardsProb,
        reason: `Cartões: ${cards.home} casa + ${cards.away} fora = ${cards.total}`,
        positive: 'Jogos físicos e árbitros rigorosos elevam linha',
        negative: 'Variance alta — depende muito do árbitro do jogo',
      }))
    }
  }

  // ── OFFSIDES (when data available) ──────────────────────────────────
  if (offs.dq === DQ.PARTIAL) {
    const ofTiers = tierLines(offs.total)
    for (const [tier, line] of Object.entries({ safe: ofTiers.safe })) {
      if (line < 2.5) continue
      const conf = ftTeamPropConf(offs.total, line, 0.36, offs.dq, 0)
      const offsProb = probGoalsOver(offs.total, line)
      if (conf >= 58) {
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', stat: 'offsides', market: 'Total Offsides',
          is_ht: false, line, direction: 'over', tier, avg: offs.total, conf,
          dq: offs.dq, sample_size: 0, source_reliability: SOURCE_RELIABILITY.MEDIUM,
          model_prob: offsProb,
          reason: `Impedimentos: ${offs.home} + ${offs.away} = ${offs.total}/jogo`,
          positive: 'Linhas defensivas adiantadas elevam impedimentos',
          negative: 'VAR pode anular alguns lances',
        }))
      }
    }
  }

  // ── HT/FT (Intervalo/Final) — combos prováveis ─────────────────────
  // Estima HT result via lambdas HT (40% das lambdas FT)
  const htProbs = estimate1X2(goals.ht.home, goals.ht.away)
  // Combos prob = P(HT result) × P(FT result) — assumindo correlação leve
  const htftCombos = [
    { key: 'home/home', label: '1/1 (Casa/Casa)',     prob: htProbs.home * probs1X2.home * 1.15, odd: 'high' },
    { key: 'draw/home', label: 'X/1 (Empate/Casa)',   prob: htProbs.draw * probs1X2.home * 0.85, odd: 'medium' },
    { key: 'away/away', label: '2/2 (Fora/Fora)',     prob: htProbs.away * probs1X2.away * 1.15, odd: 'high' },
    { key: 'draw/away', label: 'X/2 (Empate/Fora)',   prob: htProbs.draw * probs1X2.away * 0.85, odd: 'medium' },
    { key: 'draw/draw', label: 'X/X (Empate/Empate)', prob: htProbs.draw * probs1X2.draw * 1.20, odd: 'medium' },
  ]
  const bestHTFT = htftCombos.reduce((a, b) => b.prob > a.prob ? b : a)
  if (bestHTFT.prob >= 0.18 && bestHTFT.prob <= 0.55) {
    const conf = probToConf(bestHTFT.prob, goals.dq, goals.sample_size)
    if (conf >= 50) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'htft', market: 'Intervalo / Final',
        is_ht: false, line: null, direction: bestHTFT.key, tier: 'aggressive',
        avg: bestHTFT.prob, conf, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        reason: `HT/FT ${bestHTFT.label}: ${(bestHTFT.prob*100).toFixed(1)}% (HT 1X2 × FT 1X2 com correlação)`,
        positive: 'Combo de alta variance traz odds atrativas (3-15+)',
        negative: 'Difícil acertar 2 momentos do jogo simultâneos',
      }))
    }
  }

  // ── SCORE RANGE (faixas de gols) ────────────────────────────────────
  // Discretiza P(0-1), P(2-3), P(4+) usando Poisson total
  function poissonAt(k, lambda) {
    let p = Math.exp(-lambda)
    for (let i = 1; i <= k; i++) p *= lambda / i
    return p
  }
  const lambdaT = goals.total
  let pRange01 = 0, pRange23 = 0, pRange4p = 0
  for (let n = 0; n <= 12; n++) {
    const p = poissonAt(n, lambdaT)
    if (n <= 1) pRange01 += p
    else if (n <= 3) pRange23 += p
    else pRange4p += p
  }
  const ranges = [
    { key: '0-1', label: 'Faixa de Gols 0–1',   prob: pRange01, tier: 'safe' },
    { key: '2-3', label: 'Faixa de Gols 2–3',   prob: pRange23, tier: 'median' },
    { key: '4+',  label: 'Faixa de Gols 4 ou +', prob: pRange4p, tier: 'aggressive' },
  ]
  const bestRange = ranges.reduce((a, b) => b.prob > a.prob ? b : a)
  if (bestRange.prob >= 0.32) {
    const conf = probToConf(bestRange.prob, goals.dq, goals.sample_size)
    if (conf >= 55) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'score_range', market: 'Faixa de Gols',
        is_ht: false, line: null, direction: bestRange.key, tier: bestRange.tier,
        avg: bestRange.prob, conf, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        reason: `${bestRange.label}: ${(bestRange.prob*100).toFixed(1)}% (Poisson λ=${lambdaT})`,
        positive: 'Faixa larga = mais robusto que linha exata',
        negative: 'Odd menor que Over/Under tradicional',
      }))
    }
  }

  // ── WIN TO NIL (vence sem sofrer) ────────────────────────────────────
  // P(home wins to nil) = P(home wins) × P(away no goal)
  const pAwayNoGoal = Math.exp(-goals.away)
  const pHomeNoGoal = Math.exp(-goals.home)
  const pHomeWTN = probs1X2.home * pAwayNoGoal
  const pAwayWTN = probs1X2.away * pHomeNoGoal
  const wtns = [
    { side: 'home', label: `${game.home_team} sem sofrer`, prob: pHomeWTN, lambdaOpp: goals.away },
    { side: 'away', label: `${game.away_team} sem sofrer`, prob: pAwayWTN, lambdaOpp: goals.home },
  ]
  for (const w of wtns) {
    if (w.prob >= 0.22 && w.prob <= 0.55) {
      const conf = probToConf(w.prob, goals.dq, goals.sample_size)
      if (conf >= 55) {
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', stat: 'win_to_nil', market: 'Vencer Sem Sofrer Gols',
          is_ht: false, line: null, direction: w.side, tier: 'median',
          avg: w.prob, conf, dq: goals.dq, sample_size: goals.sample_size,
          source_reliability: SOURCE_RELIABILITY.MEDIUM,
          reason: `${w.label}: ${(w.prob*100).toFixed(1)}% (P(vitória)×P(opponente=0gols, λ=${w.lambdaOpp}))`,
          positive: 'Combo defesa sólida + vitória — evidência dupla',
          negative: 'Gol relâmpago do oponente quebra a aposta',
        }))
      }
    }
  }

  // ── CLEAN SHEET (não sofre gol) ─────────────────────────────────────
  for (const [side, lambdaOpp, teamName] of [
    ['home', goals.away, game.home_team],
    ['away', goals.home, game.away_team],
  ]) {
    const pCS = Math.exp(-lambdaOpp)
    if (pCS >= 0.30 && pCS <= 0.70) {
      const conf = probToConf(pCS, goals.dq, goals.sample_size)
      if (conf >= 55) {
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', team: teamName, stat: 'clean_sheet', market: 'Não Sofre Gol',
          is_ht: false, line: null, direction: side, tier: 'median',
          avg: pCS, conf, dq: goals.dq, sample_size: goals.sample_size,
          source_reliability: SOURCE_RELIABILITY.MEDIUM,
          reason: `${teamName} clean sheet: P(opponente 0 gols, λ=${lambdaOpp.toFixed(2)}) = ${(pCS*100).toFixed(1)}%`,
          positive: 'Defesa forte + ataque adversário fraco',
          negative: 'Pênalti no fim arrasa a aposta',
        }))
      }
    }
  }

  // ── BTTS HT (Ambos Marcam no 1º Tempo) ──────────────────────────────
  const bttsHTProb = (1 - Math.exp(-goals.ht.home)) * (1 - Math.exp(-goals.ht.away))
  if (bttsHTProb >= 0.18 && bttsHTProb <= 0.50) {
    const conf = probToConf(bttsHTProb, goals.dq, goals.sample_size)
    if (conf >= 55) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'btts', market: 'Ambos Marcam no 1º Tempo',
        is_ht: true, line: null, direction: 'over', tier: 'aggressive',
        avg: bttsHTProb, conf, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        reason: `BTTS HT: ${(bttsHTProb*100).toFixed(1)}% (lambdas HT ${goals.ht.home}/${goals.ht.away})`,
        positive: 'Jogos de início aberto favorecem',
        negative: 'Maioria dos times entra cauteloso no início',
      }))
    }
  }

  // ── RESULTADO + AMBOS MARCAM (combo +EV em jogos abertos) ──────────
  const rbttsCombos = [
    { side: 'home', resProb: probs1X2.home, label: `${game.home_team} vence + Ambos Marcam` },
    { side: 'away', resProb: probs1X2.away, label: `${game.away_team} vence + Ambos Marcam` },
  ]
  for (const c of rbttsCombos) {
    const comboProb = c.resProb * goals.btts_prob * 0.92  // pequena penalidade por correlação
    if (comboProb >= 0.18 && comboProb <= 0.42) {
      const conf = probToConf(comboProb, goals.dq, goals.sample_size)
      if (conf >= 55) {
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', stat: 'result_btts', market: 'Resultado + Ambos Marcam',
          is_ht: false, line: null, direction: `${c.side}_yes`, tier: 'aggressive',
          avg: comboProb, conf, dq: goals.dq, sample_size: goals.sample_size,
          source_reliability: SOURCE_RELIABILITY.MEDIUM,
          reason: `${c.label}: P(vitória)${(c.resProb*100).toFixed(0)}% × P(BTTS)${(goals.btts_prob*100).toFixed(0)}% = ${(comboProb*100).toFixed(1)}%`,
          positive: 'Combo +EV em duelos abertos — odd 3.5-6.0',
          negative: 'Jogo travado destrói os 2 lados',
        }))
      }
    }
  }

  // ── PLAYER GOALS — top 3 artilheiros (a marcar qualquer momento) ────
  const topScorers = [
    ...(homeStats?.top_scorers || homeStats?.players?.scorers || []).slice(0, 3).map(p => ({ ...p, team: game.home_team, lambdaTeam: goals.home })),
    ...(awayStats?.top_scorers || awayStats?.players?.scorers || []).slice(0, 3).map(p => ({ ...p, team: game.away_team, lambdaTeam: goals.away })),
  ]
  for (const sc of topScorers) {
    const goalsPerGame = sc.goals_per_game ?? sc.goals_per_90 ?? (sc.season_goals && sc.played ? sc.season_goals / sc.played : null)
    if (!goalsPerGame || goalsPerGame < 0.15) continue
    // P(player marca) ≈ 1 - exp(-goalsPerGame) ajustado pela proporção do team lambda
    const playerLambda = goalsPerGame * Math.min(1.5, sc.lambdaTeam / 1.4)
    const probScore = 1 - Math.exp(-playerLambda)
    if (probScore < 0.18) continue
    const conf = probToConf(probScore, DQ.PARTIAL, sc.played || 0)
    if (conf < 50) continue
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'player', player_name: sc.name || sc.player_name, team: sc.team,
      stat: 'player_goal', market: 'Jogador a Marcar (Qualquer Momento)',
      is_ht: false, line: 0.5, direction: 'over', tier: 'aggressive',
      avg: probScore, conf, dq: DQ.PARTIAL, sample_size: sc.played || 0,
      source_reliability: SOURCE_RELIABILITY.MEDIUM,
      reason: `${sc.name}: ${goalsPerGame.toFixed(2)} gols/jogo · λ ajustado ${playerLambda.toFixed(2)} · P(marca) = ${(probScore*100).toFixed(1)}%`,
      positive: 'Artilheiros consistentes mantêm volume mesmo em maus jogos',
      negative: 'Marcação especial pode anular',
    }))
  }

  // ── PLAYER CARDS — top fouls/cards de cada time ─────────────────────
  const cardCandidates = [
    ...(homeStats?.players?.cards || []).slice(0, 2).map(p => ({ ...p, team: game.home_team, isHome: true })),
    ...(awayStats?.players?.cards || []).slice(0, 2).map(p => ({ ...p, team: game.away_team, isHome: false })),
  ]
  for (const c of cardCandidates) {
    const cardsPerGame = c.cards_per_game ?? c.yellows_per_game
    if (!cardsPerGame || cardsPerGame < 0.25) continue
    const refMult = 1.0 // placeholder pra refereeBias
    const probCard = 1 - Math.exp(-cardsPerGame * refMult)
    if (probCard < 0.30 || probCard > 0.75) continue
    const conf = probToConf(probCard, DQ.PARTIAL, 0)
    if (conf < 55) continue
    props.push(makeFootballProp({
      match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
      type: 'player', player_name: c.name, team: c.team,
      stat: 'player_card', market: 'Cartão Amarelo do Jogador',
      is_ht: false, line: null, direction: 'yes', tier: 'aggressive',
      avg: probCard, conf, dq: DQ.PARTIAL, sample_size: 0,
      source_reliability: SOURCE_RELIABILITY.LOW,
      reason: `${c.name}: ${cardsPerGame.toFixed(2)} cartões/jogo. P(amarelo) = ${(probCard*100).toFixed(1)}%`,
      positive: 'Volantes/zagueiros físicos têm taxa estável',
      negative: 'Substituição precoce mata a aposta',
    }))
  }

  // ── B2B / FADIGA ─────────────────────────────────────────────────────
  // Detecta jogos seguidos < 3 dias atrás
  const b2bPenalty = (() => {
    const lastPlay = homeStats?.last_match_date || awayStats?.last_match_date
    if (!lastPlay) return 0
    const days = (Date.now() - new Date(lastPlay).getTime()) / (24*3600_000)
    if (days < 3) return 0.92  // -8% projeção ofensiva
    if (days < 4.5) return 0.96
    return 1.0
  })()
  // Aplica em goals (já passou — placeholder pra próximas runs)
  // Marca props com flag pra UI
  for (const p of props) p._b2b_factor = b2bPenalty

  // ── PÊNALTI NO JOGO ─────────────────────────────────────────────────
  // Heurística: liga média ~25% jogos com pen. Ajusta com cards (jogo físico)
  const penProb = Math.min(0.40, 0.22 + (cards.total - 4.0) * 0.03)
  if (penProb >= 0.18 && penProb <= 0.45) {
    const conf = probToConf(penProb, DQ.EST, 0)
    if (conf >= 50) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'penalty', market: 'Pênalti no Jogo',
        is_ht: false, line: null, direction: 'yes', tier: 'aggressive',
        avg: penProb, conf, dq: DQ.EST, sample_size: 0,
        source_reliability: SOURCE_RELIABILITY.LOW,
        reason: `Probabilidade pênalti: ${(penProb*100).toFixed(1)}% (base 22% + bonus por físico — ${cards.total} cards/jogo)`,
        positive: 'Jogos físicos e VAR-revisados elevam taxa',
        negative: 'Variance alta — não tem como prever lance específico',
      }))
    }
  }

  // ── CARTÃO VERMELHO NO JOGO ─────────────────────────────────────────
  const redProb = Math.min(0.30, 0.10 + (cards.total - 4.0) * 0.025)
  if (redProb >= 0.12 && redProb <= 0.35) {
    const conf = probToConf(redProb, DQ.EST, 0)
    if (conf >= 50) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'red_card', market: 'Cartão Vermelho no Jogo',
        is_ht: false, line: null, direction: 'yes', tier: 'aggressive',
        avg: redProb, conf, dq: DQ.EST, sample_size: 0,
        source_reliability: SOURCE_RELIABILITY.LOW,
        reason: `Prob vermelho: ${(redProb*100).toFixed(1)}% (base 10% + bonus por cards ${cards.total})`,
        positive: 'Clássicos e jogos decisivos elevam',
        negative: 'Difícil prever — depende de árbitro e momento',
      }))
    }
  }

  // ── HANDICAP ASIÁTICO GOLS ±0.5 ─────────────────────────────────────
  // Favorito -0.5 (precisa vencer) vs azarão +0.5 (vence ou empata)
  const favProbs = [
    { side: 'home', adv: probs1X2.home, draw_back: probs1X2.draw + probs1X2.home, label: `${game.home_team} -0.5` },
    { side: 'away', adv: probs1X2.away, draw_back: probs1X2.draw + probs1X2.away, label: `${game.away_team} -0.5` },
  ]
  for (const f of favProbs) {
    if (f.adv >= 0.42 && f.adv <= 0.65) {
      const conf = probToConf(f.adv, goals.dq, goals.sample_size)
      if (conf >= 55) {
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', stat: 'asian_handicap', market: 'Handicap Asiático Gols',
          is_ht: false, line: -0.5, direction: f.side, tier: 'median',
          avg: f.adv, conf, dq: goals.dq, sample_size: goals.sample_size,
          source_reliability: SOURCE_RELIABILITY.MEDIUM,
          reason: `${f.label}: P(vitória) = ${(f.adv*100).toFixed(1)}% (Poisson 1X2)`,
          positive: 'Empate devolve stake (asiático) — risco menor que 1X2',
          negative: 'Odds menores que linha europeia',
        }))
      }
    }
  }

  // ── PRIMEIRO A MARCAR (Time, não jogador) ──────────────────────────
  // P(home marca primeiro) ≈ λ_home / (λ_home + λ_away)
  // P(no goal) ≈ exp(-λ_total)
  const pNoGoal = Math.exp(-goals.total)
  const pHomeFirst = (goals.home / (goals.home + goals.away)) * (1 - pNoGoal)
  const pAwayFirst = (goals.away / (goals.home + goals.away)) * (1 - pNoGoal)
  const firstScorers = [
    { side: 'home', prob: pHomeFirst, label: `${game.home_team} marca primeiro` },
    { side: 'away', prob: pAwayFirst, label: `${game.away_team} marca primeiro` },
    { side: 'none', prob: pNoGoal,    label: 'Nenhum gol no jogo' },
  ]
  const bestFirst = firstScorers.reduce((a, b) => b.prob > a.prob ? b : a)
  if (bestFirst.prob >= 0.40 && bestFirst.prob <= 0.70 && bestFirst.side !== 'none') {
    const conf = probToConf(bestFirst.prob, goals.dq, goals.sample_size)
    if (conf >= 55) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'first_team_score', market: 'Time a Marcar Primeiro',
        is_ht: false, line: null, direction: bestFirst.side, tier: 'safe',
        avg: bestFirst.prob, conf, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        reason: `${bestFirst.label}: ${(bestFirst.prob*100).toFixed(1)}% (λ_home/(λ_home+λ_away))`,
        positive: 'Quem marca primeiro vence ~70% das vezes — tendência forte',
        negative: 'Defesa+contragolpe pode atrasar primeiro gol',
      }))
    }
  }

  // ── INTERVALO COM MAIS GOLS ─────────────────────────────────────────
  // Compara λ_HT vs λ_2T. 2º tempo geralmente tem mais gols.
  const ht_total = goals.ht.total
  const tt_total = goals.total - ht_total
  const halves = [
    { key: '1H', label: '1º Tempo tem mais gols', lambda: ht_total },
    { key: '2H', label: '2º Tempo tem mais gols', lambda: tt_total },
    { key: 'EQ', label: 'Empate em gols por tempo', lambda: Math.min(ht_total, tt_total) },
  ]
  // Aproximação grosseira: tempo com maior lambda tem ~55-65% chance de ter mais gols
  const probLargerHT = ht_total > tt_total ? 0.55 : 0.30
  const probLarger2H = tt_total > ht_total ? 0.55 : 0.30
  const probEq = 1 - probLargerHT - probLarger2H
  const halfPicks = [
    { key: '1H', label: halves[0].label, prob: probLargerHT },
    { key: '2H', label: halves[1].label, prob: probLarger2H },
  ]
  const bestHalf = halfPicks.reduce((a, b) => b.prob > a.prob ? b : a)
  if (bestHalf.prob >= 0.50) {
    const conf = probToConf(bestHalf.prob, goals.dq, goals.sample_size)
    if (conf >= 55) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', stat: 'half_more_goals', market: 'Tempo com Mais Gols',
        is_ht: false, line: null, direction: bestHalf.key, tier: 'median',
        avg: bestHalf.prob, conf, dq: goals.dq, sample_size: goals.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        reason: `${bestHalf.label}: ~${(bestHalf.prob*100).toFixed(0)}% (λ_HT=${ht_total} vs λ_2T=${tt_total.toFixed(2)})`,
        positive: '2º tempo historicamente tem 1.5x mais gols',
        negative: 'Cansaço pode reduzir intensidade no 2º',
      }))
    }
  }

  // ── HANDICAP ESCANTEIOS ±2.5 ────────────────────────────────────────
  // Favorito tem vantagem ~2 escanteios em média
  const cornerDiff = Math.abs(corners.home - corners.away)
  if (cornerDiff >= 1.5) {
    const fav = corners.home > corners.away ? 'home' : 'away'
    const teamName = fav === 'home' ? game.home_team : game.away_team
    const probAdv = 0.50 + cornerDiff * 0.08
    const conf = probToConf(Math.min(0.72, probAdv), corners.dq, corners.sample_size)
    if (conf >= 55) {
      props.push(makeFootballProp({
        match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
        type: 'team', team: teamName, stat: 'corner_handicap', market: 'Handicap Escanteios',
        is_ht: false, line: -2.5, direction: fav, tier: 'median',
        avg: probAdv, conf, dq: corners.dq, sample_size: corners.sample_size,
        source_reliability: SOURCE_RELIABILITY.MEDIUM,
        reason: `${teamName} média ${fav === 'home' ? corners.home : corners.away} vs ${fav === 'home' ? corners.away : corners.home} = +${cornerDiff.toFixed(1)} corners. Handicap -2.5: ${(probAdv*100).toFixed(0)}%`,
        positive: 'Time dominante consistentemente força mais corners',
        negative: 'Time pode focar contra-ataque e abandonar volume',
      }))
    }
  }

  // ── TEAM GOALS (over 0.5/1.5 por time) ──────────────────────────────
  for (const [side, lambda, teamName] of [
    ['home', goals.home, game.home_team],
    ['away', goals.away, game.away_team],
  ]) {
    for (const line of [0.5, 1.5]) {
      const probOver = probGoalsOver(lambda, line)
      const conf = probToConf(probOver, goals.dq, goals.sample_size)
      if (conf >= 60 && probOver < 0.92) {
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', team: teamName, stat: 'team_goals', market: 'Team Total Goals',
          is_ht: false, line, direction: 'over', tier: line === 0.5 ? 'safe' : 'median',
          avg: lambda, conf, dq: goals.dq, sample_size: goals.sample_size,
          source_reliability: SOURCE_RELIABILITY.MEDIUM,
          model_prob: probOver,
          reason: `${teamName} lambda=${lambda}; P(>${line}) = ${(probOver*100).toFixed(1)}%`,
          positive: 'Foco em 1 lado reduz dependência do oponente',
          negative: 'Time pode ser blanked se defesa adversária excelente',
        }))
      }
    }
  }

  // ═══ HT FAIXA-STYLE PICKS: HT shots/corners por time individual ═══
  // FAIXA bate odd 10+ com pattern: Time atacante over chutes/corners + Time defensor under
  // Estimativa: ~44% do FT acontece no 1ºT (stats Premier/La Liga/BR)
  // Linha agressiva: home/casa atacante = +0.5 da projeção; away/defensor = -0.5
  const htMarkets = [
    { key: 'HT_SHOTS_HOME', team: 'home', label: 'Chutes 1ºT · Casa', mu: htShotsHome, market: 'Chutes 1º Tempo · Casa' },
    { key: 'HT_SHOTS_AWAY', team: 'away', label: 'Chutes 1ºT · Fora', mu: htShotsAway, market: 'Chutes 1º Tempo · Fora' },
    { key: 'HT_CORNERS_HOME', team: 'home', label: 'Escanteios 1ºT · Casa', mu: htCornersHome, market: 'Escanteios 1º Tempo · Casa' },
    { key: 'HT_CORNERS_AWAY', team: 'away', label: 'Escanteios 1ºT · Fora', mu: htCornersAway, market: 'Escanteios 1º Tempo · Fora' },
  ]
  for (const ht of htMarkets) {
    if (!ht.mu || ht.mu < 0.5) continue
    // Linhas reduzidas (cap CPU Worker) — pega só linhas mais relevantes
    const lines = ht.key.includes('CORNERS') ? [1.5, 2.5] : [3.5, 4.5, 5.5]
    for (const line of lines) {
      const probOver = poissonOver(ht.mu, line)
      const probUnder = 1 - probOver
      // OVER: gera sempre que prob >= 0.40 (combos FAIXA precisam de ambas direções)
      if (probOver >= 0.40 && probOver <= 0.95) {
        const conf = Math.round(probOver * 100)
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', stat: ht.key.toLowerCase(), market: ht.market,
          is_ht: true, line, direction: 'over', tier: probOver >= 0.75 ? 'safe' : probOver >= 0.55 ? 'median' : 'longshot',
          avg: ht.mu, conf, dq: shots.dq || DQ.EST, sample_size: shots.sample_size || 0,
          source_reliability: SOURCE_RELIABILITY.MEDIUM,
          model_prob: probOver,
          reason: `${ht.label}: μ ~${ht.mu.toFixed(1)} (44% FT). P(>${line}) = ${(probOver*100).toFixed(1)}%`,
          positive: 'FAIXA pattern: time atacante tem chutes/escanteios HT',
          negative: 'Variance HT alta · jogos travados podem ficar abaixo',
        }))
      }
      // UNDER: gera sempre que prob >= 0.40 (incluindo line 1.5 corners — necessário para combo 4-leg FAIXA)
      if (probUnder >= 0.40 && probUnder <= 0.95) {
        const conf = Math.round(probUnder * 100)
        props.push(makeFootballProp({
          match_id: game.id, home_team: game.home_team, away_team: game.away_team, league: game.league, kickoff: game.kickoff,
          type: 'team', stat: ht.key.toLowerCase(), market: ht.market,
          is_ht: true, line, direction: 'under', tier: probUnder >= 0.75 ? 'safe' : probUnder >= 0.55 ? 'median' : 'longshot',
          avg: ht.mu, conf, dq: shots.dq || DQ.EST, sample_size: shots.sample_size || 0,
          source_reliability: SOURCE_RELIABILITY.MEDIUM,
          model_prob: probUnder,
          reason: `${ht.label}: μ ~${ht.mu.toFixed(1)} (44% FT). P(<${line}) = ${(probUnder*100).toFixed(1)}%`,
          positive: 'FAIXA pattern: time defensor under',
          negative: 'Surpresas no HT acontecem',
        }))
      }
    }
  }

  // Score opportunity for each prop — high-stakes matches get a bonus
  const importanceBoost = matchImportance.is_high_stakes ? 3 : 0;
  const scored = props.map(p => ({
    ...p,
    opportunity_score: opportunityScore({
      conf: p.confidence, ev: p.ev_pct, dq: p.quality.level, tier: p.tier,
    }) + importanceBoost,
    value_label: valueLabel(p.confidence, p.ev_pct),
    market_health: marketHealth(p.book_odds, p.fair_odds),
    // Enrich reason with match importance context when relevant
    reason: matchImportance.is_high_stakes
      ? `[${matchImportance.label}] ${matchImportance.reasons[0]}. ${p.reason}`
      : p.reason,
  }));

  scored.sort((a, b) => b.opportunity_score - a.opportunity_score);

  return {
    match_id: game.id,
    home_team: game.home_team,
    away_team: game.away_team,
    league: game.league,
    kickoff: game.kickoff,
    total_props: scored.length,
    best_conf: scored[0]?.confidence || 0,
    props: scored,
    context: {
      shots_projection: shots,
      corners_projection: corners,
      goals_projection: goals,
      cards_projection: cards,
      offsides_projection: offs,
      probs_1x2: probs1X2,
      has_real_odds: !!gameOdds,
      match_importance: matchImportance,
    },
  };
}

function _extractBookOdds(gameOdds, market) {
  if (!gameOdds) return null;
  const bk = gameOdds.bookmakers?.[0];
  if (!bk) return null;
  const m = bk.markets?.find(m => m.key === market);
  return m?.outcomes?.[0]?.price || null;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: corsHeaders(),
  });
}
