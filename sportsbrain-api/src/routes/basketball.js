/**
 * Basketball Routes — SportsBrain Data API v1
 * ────────────────────────────────────────────
 * GET /v1/basketball/games/today
 * GET /v1/basketball/games/:date
 * GET /v1/basketball/game/:id/props
 * GET /v1/basketball/player/:name/stats
 * GET /v1/basketball/player/:name/props
 * GET /v1/basketball/team/:name/stats
 * GET /v1/basketball/props/today
 */

import { sbResponse, sbError } from '../schemas/base.js';
import { makeNBAProp } from '../schemas/basketball.js';
import { opportunityScore, valueLabel } from '../intelligence/engine.js';
import { corsHeaders } from './health.js';

export async function handleBasketball(pathname, request, env, services, ctx) {
  const { basketball, odds, cache, persist } = services;

  // ── GET /v1/basketball/games/today or /games/:date ───────────────────
  if (/^\/v1\/basketball\/games\/(today|[\d-]{10})$/.test(pathname)) {
    const m = pathname.match(/\/v1\/basketball\/games\/(.+)/);
    const dateParam = m[1] === 'today' ? null : m[1];
    const result = await basketball.getTodayGames(dateParam);

    // Persist games when live (non-blocking)
    if (result.source !== 'cache' && result.games.length && persist && ctx) {
      ctx.waitUntil(persist.upsertGames(result.games, 'basketball'));
    }

    return jsonResponse(sbResponse({
      data: {
        date:   result.date,
        count:  result.games.length,
        games:  result.games,
        source: result.source,
      },
      meta: { endpoint: pathname, cached: result.source === 'cache' },
    }));
  }

  // ── GET /v1/basketball/game/:id/props ────────────────────────────────
  if (/^\/v1\/basketball\/game\/[^/]+\/props$/.test(pathname)) {
    const gameId = pathname.split('/')[4];
    const cacheKey = `basketball:props:${gameId}`;
    let gameDate = null;

    const { data, fromCache } = await cache.getOrFetch(cacheKey, async () => {
      const today = await basketball.getTodayGames();
      const game = today.games.find(g => String(g.id) === String(gameId));
      if (!game) return null;

      // Persist the game itself (non-blocking)
      if (persist && ctx) ctx.waitUntil(persist.upsertGame(game, 'basketball'));

      gameDate = game.date;
      const rawProps = await basketball.generateGameProps(game);

      // Persist player stats encountered in props (non-blocking)
      if (persist && ctx && rawProps?.length) {
        const playerNames = [...new Set(rawProps.map(p => p.player_name).filter(Boolean))];
        for (const name of playerNames) {
          basketball.getPlayerStats(name).then(ps => {
            if (ps) ctx.waitUntil(persist.upsertPlayerStats(ps));
          }).catch(() => {});
        }
      }

      return buildNBAPropsResponse(game, rawProps);
    }, 900);

    if (!data) return jsonResponse(sbError('GAME_NOT_FOUND', `Game ${gameId} not found`, 404), 404);

    // Persist props when fresh build
    if (!fromCache && data?.props?.length && persist && ctx) {
      ctx.waitUntil(persist.insertPropResults(
        data.props, 'basketball',
        gameDate || new Date().toISOString().slice(0, 10),
        gameId
      ));
    }

    return jsonResponse(sbResponse({ data, meta: { endpoint: pathname, game_id: gameId } }));
  }

  // ── GET /v1/basketball/props/today ───────────────────────────────────
  // SELF-CONTAINED: usa SÓ Bet365 NBA markets stored — não depende de API externa
  if (pathname === '/v1/basketball/props/today') {
    // Tenta API se existir; senão, gera de Bet365 NBA puro
    const today = await basketball.getTodayGames().catch(() => ({ source: 'bet365_only', games: [], date: new Date().toISOString().slice(0, 10) }));
    const allProps = [];

    if (today.source !== 'cache' && today.games.length && persist && ctx) {
      ctx.waitUntil(persist.upsertGames(today.games, 'basketball'));
    }

    // Carrega Bet365 matches+markets pra cobertura ampla + odds reais
    let bet365Matches = []
    let bet365MarketsByFid = {}
    try {
      if (env.SB_DB) {
        const matchRow = await env.SB_DB.prepare(
          `SELECT payload FROM bet365_matches_snapshots ORDER BY created_at DESC LIMIT 1`
        ).first()
        if (matchRow) {
          try {
            const allM = JSON.parse(matchRow.payload) || []
            bet365Matches = allM.filter(m => /nba|basket/i.test(m.competition || ''))
          } catch {}
        }
        const mkRow = await env.SB_DB.prepare(
          `SELECT payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`
        ).first()
        if (mkRow) {
          try {
            const marketsList = JSON.parse(mkRow.payload) || []
            for (const m of marketsList) {
              if (m.fixtureId && /^NBA_/.test(m.market || '')) {
                if (!bet365MarketsByFid[m.fixtureId]) bet365MarketsByFid[m.fixtureId] = []
                bet365MarketsByFid[m.fixtureId].push(m)
              }
            }
          } catch {}
        }
      }
    } catch {}

    const normTeam = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
    const apiKeys = new Set(today.games.map(g => `${normTeam(g.home_team)}|${normTeam(g.away_team)}`))
    const augmentedGames = [...today.games]
    for (const bm of bet365Matches) {
      const k = `${normTeam(bm.home)}|${normTeam(bm.away)}`
      if (apiKeys.has(k)) continue
      augmentedGames.push({
        id: bm.fixtureId, home_team: bm.home, away_team: bm.away,
        date: today.date, tip_off: bm.startTime || null, status: 'scheduled',
        source: 'bet365', _fromBet365Only: true,
      })
    }

    for (const game of augmentedGames.slice(0, 12)) {
      const rawProps = await basketball.generateGameProps(game).catch(() => [])
      const built = buildNBAPropsResponse(game, rawProps);
      if (!built) continue
      // Match Bet365 markets pra esse jogo
      const fidMatch = bet365Matches.find(bm =>
        normTeam(bm.home) === normTeam(game.home_team) &&
        normTeam(bm.away) === normTeam(game.away_team)
      )
      const fidMarkets = fidMatch ? (bet365MarketsByFid[fidMatch.fixtureId] || []) : []
      // Enriquece com odd Bet365 real quando casa
      for (const p of built.props) {
        const realOdd = findNBARealOdd(p, fidMarkets)
        if (realOdd) {
          p.book_odds = realOdd
          if (p.fair_odds) {
            p.ev_pct = +((p.fair_odds / realOdd - 1) * 100).toFixed(2)
            p.edge_pct = +(((p.confidence/100) - (1/realOdd)) * 100).toFixed(2)
            p.is_value = p.ev_pct > 0
          }
          p._bet365_match = true
        }
      }
      allProps.push(...built.props);

      if (persist && ctx && built?.props?.length) {
        ctx.waitUntil(persist.insertPropResults(
          built.props, 'basketball',
          today.date,
          String(game.id)
        ));
      }
    }

    // ─── FALLBACK: se allProps vazio/pouco, gera DIRETO dos Bet365 NBA markets ──
    // Devig: fairProb = (1/odd) / sumImpl_market → pick com prob real
    if (allProps.length < 5 && Object.keys(bet365MarketsByFid).length > 0) {
      const dateStr = today.date || new Date().toISOString().slice(0, 10)
      for (const [fid, markets] of Object.entries(bet365MarketsByFid)) {
        // Acha home/away do match — primeiro tenta bet365Matches, depois pega do próprio market
        const fxMatch = bet365Matches.find(bm => bm.fixtureId === fid)
        // Fallback: extrai dos markets (parser bet365 inclui m.home e m.away)
        const firstMarketWithTeams = markets.find(m => m.home && m.away)
        const home = fxMatch?.home || firstMarketWithTeams?.home || `Time ${fid}`
        const away = fxMatch?.away || firstMarketWithTeams?.away || '?'
        // Skip se ainda não tem ambos times
        if (away === '?' && home.startsWith('Time ')) continue
        // Agrupa por (market, line, side)
        const grouped = {}
        for (const m of markets) {
          const k = `${m.market}|${m.line ?? ''}`
          if (!grouped[k]) grouped[k] = []
          grouped[k].push(m)
        }
        for (const [, group] of Object.entries(grouped)) {
          const sumImpl = group.reduce((s, m) => s + 1/m.odd, 0)
          // Solo market: usa implied prob direto. Group ≥ 2: aplica devig
          const useDevig = group.length >= 2 && sumImpl >= 0.85 && sumImpl <= 3.5
          for (const m of group) {
            const fairProb = useDevig ? (1/m.odd) / sumImpl : (1/m.odd)
            if (fairProb < 0.20 || fairProb > 0.95) continue  // mais permissivo
            // Selection PT-BR limpa (deduplica team name no Resultado Duplo HT/FT)
            let sel = m.selection || m.side || (m.line != null ? `${m.line}` : 'pick')
            if (typeof sel === 'string' && sel.includes(' - ')) {
              const [a, b] = sel.split(' - ').map(s => s.trim())
              if (a === b) sel = `${a} (HT e FT)`
              else sel = `${a} (HT) → ${b} (FT)`
            }
            // Market label PT-BR
            const mkLabel = m.market === 'NBA_DOUBLE_RESULT' ? 'NBA · Resultado Duplo' :
                           m.market === 'NBA_GAME_LINES' ? 'NBA · Linhas do Jogo' :
                           m.market === 'NBA_HALF1' ? 'NBA · 1º Tempo' :
                           m.market === 'NBA_QUARTER' ? 'NBA · Quarto' :
                           m.market === 'NBA_TEAM_TOTALS' ? 'NBA · Total por Time' :
                           m.market === 'NBA_FIRST_BASKET' ? 'NBA · Primeira Cesta' :
                           m.market === 'NBA_WINNING_MARGIN' ? 'NBA · Margem Vitória' :
                           m.market === 'TOTAL_POINTS' ? 'Total de Pontos' :
                           m.market
            allProps.push({
              id: `${fid}|nba_b365|${m.market}|${m.line ?? ''}|${sel}`,
              match_id: fid,
              home_team: home, away_team: away,
              league: 'NBA · Bet365',
              type: 'team', stat: m.market.toLowerCase(),
              market: mkLabel,
              line: m.line, direction: sel,
              tier: fairProb >= 0.65 ? 'safe' : 'median',
              projected_avg: null,
              model_prob: fairProb, confidence: +(fairProb * 100).toFixed(1),
              fair_odds: +(1/fairProb).toFixed(2),
              book_odds: m.odd,
              ev_pct: 0, edge_pct: 0,
              kickoff: m.startTime || null,
              _bet365_match: true,
              _odd_source: 'bet365',
              source: 'bet365_direct_nba',
            })
          }
        }
      }
    }

    allProps.sort((a, b) => {
      if (a._bet365_match !== b._bet365_match) return b._bet365_match ? 1 : -1
      return (b.opportunity_score || 0) - (a.opportunity_score || 0);
    });

    return jsonResponse(sbResponse({
      data: {
        date:           today.date,
        total_props:    allProps.length,
        bet365_matched: allProps.filter(p => p._bet365_match).length,
        coverage:       { api_games: today.games.length, bet365_added: augmentedGames.length - today.games.length },
        top_props:      allProps.slice(0, 30),
        all_props:      allProps,
      },
      meta: { endpoint: pathname },
    }));
  }

  // ── GET /v1/basketball/player/:name/stats ────────────────────────────
  if (/^\/v1\/basketball\/player\/[^/]+\/stats$/.test(pathname)) {
    const playerName = decodeURIComponent(pathname.split('/')[4].replace(/_/g, ' '));
    const stats = await basketball.getPlayerStats(playerName);
    if (!stats) return jsonResponse(sbError('PLAYER_NOT_FOUND', `Player "${playerName}" not found`, 404), 404);

    // Persist player stats (non-blocking)
    if (stats && persist && ctx) {
      ctx.waitUntil(persist.upsertPlayerStats(stats));
    }

    return jsonResponse(sbResponse({ data: stats, meta: { endpoint: pathname, player: playerName } }));
  }

  // ── GET /v1/basketball/player/:name/props ─────────────────────────────
  if (/^\/v1\/basketball\/player\/[^/]+\/props$/.test(pathname)) {
    const playerName = decodeURIComponent(pathname.split('/')[4].replace(/_/g, ' '));
    const playerData = await basketball.getPlayerStats(playerName);
    if (!playerData) return jsonResponse(sbError('PLAYER_NOT_FOUND', `Player "${playerName}" not found`, 404), 404);

    const props = [];
    for (const stat of ['pts', 'reb', 'ast']) {
      const avg = playerData.season_averages[stat];
      if (!avg || avg < 1) continue;
      props.push({
        stat,
        projected_avg: avg,
        message: 'Use /v1/basketball/game/:id/props for game-specific props with matchup context.',
      });
    }

    return jsonResponse(sbResponse({
      data: { player: playerData, season_prop_projections: props },
      meta: { endpoint: pathname },
    }));
  }

  // ── GET /v1/basketball/team/:name/stats ──────────────────────────────
  if (/^\/v1\/basketball\/team\/[^/]+\/stats$/.test(pathname)) {
    const teamName = decodeURIComponent(pathname.split('/')[4].replace(/_/g, ' '));
    const stats = await basketball.getTeamStats(teamName);
    return jsonResponse(sbResponse({ data: stats, meta: { endpoint: pathname, team: teamName } }));
  }

  return jsonResponse(sbError('NOT_FOUND', `Route ${pathname} not found`, 404), 404);
}

// ── NBA mercados extras (Doubles, Race, Quarter, Margin, First Basket) ───
// Adiciona ao response de cada game props extra baseado em totals/team strength
function buildExtraNBAProps(game, rawProps) {
  const extra = []
  // Heurística: pega total esperado do jogo (somando team totals médias)
  const homePts = rawProps?.find(p => p._is_team_total && p._is_home)?.projected_avg || 110
  const awayPts = rawProps?.find(p => p._is_team_total && !p._is_home)?.projected_avg || 110
  const totalGame = homePts + awayPts
  // Race to 20 — primeiro a 20 (~3.5min de jogo)
  const homeAdv = homePts > awayPts ? 0.55 : 0.45
  extra.push({
    match_id: game.id, sport: 'basketball',
    home_team: game.home_team, away_team: game.away_team,
    type: 'team', stat: 'race_to_20', market: 'Primeiro a 20 Pontos',
    line: 20, direction: 'home',
    confidence: Math.round(homeAdv * 100),
    projected_avg: homeAdv,
    tier: 'aggressive',
    reason: `Time mais ofensivo tem ~55% chance de chegar primeiro a 20`,
  })
  // Margin of Victory ranges
  const marginRanges = [
    { range: '1-5',   prob: 0.30, label: 'Margem 1-5' },
    { range: '6-10',  prob: 0.25, label: 'Margem 6-10' },
    { range: '11-15', prob: 0.20, label: 'Margem 11-15' },
    { range: '16+',   prob: 0.15, label: 'Margem 16 ou +' },
  ]
  const bestMargin = marginRanges.reduce((a, b) => b.prob > a.prob ? b : a)
  extra.push({
    match_id: game.id, sport: 'basketball',
    home_team: game.home_team, away_team: game.away_team,
    type: 'team', stat: 'margin', market: 'Faixa de Margem',
    line: null, direction: bestMargin.range,
    confidence: Math.round(bestMargin.prob * 200),  // amplifica pra range relativo
    projected_avg: bestMargin.prob,
    tier: 'median',
    reason: `${bestMargin.label}: ${(bestMargin.prob*100).toFixed(0)}% (heurística distribuição NBA)`,
  })
  // Player Doubles: top scorers >= 18ppg + 8reb/ast → double-double prob ~50%
  for (const p of (rawProps || []).filter(x => x.player_name && x.stat === 'pts').slice(0, 4)) {
    const pts = p.projected_avg || 0
    if (pts < 18) continue
    const probDD = Math.min(0.55, (pts - 15) * 0.05 + 0.20)
    extra.push({
      match_id: game.id, sport: 'basketball',
      home_team: game.home_team, away_team: game.away_team,
      type: 'player', player_name: p.player_name, team: p.team,
      stat: 'double_double', market: 'Double-Double',
      line: null, direction: 'yes',
      confidence: Math.round(probDD * 100),
      projected_avg: probDD,
      tier: 'aggressive',
      reason: `${p.player_name} ~${pts}pt/jg + reb/ast: P(DD) ~${(probDD*100).toFixed(0)}%`,
    })
  }
  return extra
}

// ── Skellam stub (diff de gols/pontos pra Asian Handicap) ─────────────────
// Skellam(λ1, λ2) = Poisson(λ1) - Poisson(λ2)
// Usado pra computar prob(home wins by ≥ N) ou (margin in range)
function skellamProb(lambda1, lambda2, k) {
  // P(X >= k) onde X = Skellam(λ1, λ2)
  // Aproximação: P(home_pts - away_pts >= k) via Poisson independente
  let cum = 0
  for (let h = 0; h <= 200; h++) {
    let pH = Math.exp(-lambda1)
    for (let i = 1; i <= h; i++) pH *= lambda1 / i
    if (pH < 1e-8) break
    for (let a = 0; a <= h - k; a++) {
      let pA = Math.exp(-lambda2)
      for (let j = 1; j <= a; j++) pA *= lambda2 / j
      if (pA < 1e-8) break
      cum += pH * pA
    }
  }
  return cum
}

// ── findNBARealOdd: busca odd real Bet365 pra um prop NBA ─────────────────
function findNBARealOdd(prop, fidMarkets) {
  const stat = (prop.stat || prop.market || '').toLowerCase()
  const player = (prop.player_name || '').toLowerCase()
  const line = prop.line
  const direction = prop.direction
  // Mapping prop.stat → mgKey + keyword pra mgName
  const buckets = (() => {
    if (/pts|points/.test(stat))    return { keys: ['NBA_PLAYER_POINTS'], kw: /points|pontos/i }
    if (/reb/.test(stat))           return { keys: ['NBA_PLAYER_REBOUNDS'], kw: /rebound|rebote/i }
    if (/ast|assist/.test(stat))    return { keys: ['NBA_PLAYER_ASSISTS'], kw: /assist/i }
    if (/3pt|three/.test(stat))     return { keys: ['NBA_PLAYER_3PT', 'NBA_PLAYER_3PT_OU'], kw: /3.?point|3.?pt|tres/i }
    if (/pra/.test(stat))           return { keys: ['NBA_PLAYER_PRA'], kw: /pra|p\+r\+a/i }
    if (/total/.test(stat))         return { keys: ['NBA_GAME_LINES', 'NBA_TEAM_TOTALS'], kw: /total/i }
    if (/spread|handicap/.test(stat)) return { keys: ['NBA_GAME_LINES'], kw: /spread/i }
    return { keys: [], kw: null }
  })()
  for (const r of fidMarkets) {
    if (!buckets.keys.includes(r.market) && !(buckets.kw && buckets.kw.test(r.mgName || ''))) continue
    // Player match (fuzzy): se prop.player e r.player presentes, precisam coincidir
    if (player && r.player && !r.player.toLowerCase().includes(player.split(' ').pop().toLowerCase())) continue
    if (r.line == null || line == null) {
      if (line == null && direction === r.side && r.odd >= 1.3) return +r.odd.toFixed(2)
      continue
    }
    if (Math.abs(r.line - line) > 1.5) continue
    if (direction && r.side && direction !== r.side) continue
    if (r.odd && r.odd >= 1.3 && r.odd <= 12) return +r.odd.toFixed(2)
  }
  return null
}

// ── Build structured NBA props response ───────────────────────────────────
function buildNBAPropsResponse(game, rawProps) {
  if (!rawProps || !rawProps.length) return null;

  const props = rawProps.map(p => {
    const built = makeNBAProp(p);
    return {
      ...built,
      opportunity_score: opportunityScore({
        conf: built.confidence,
        ev:   built.ev_pct,
        dq:   built.quality.level,
        tier: built.tier,
      }),
      value_label: valueLabel(built.confidence, built.ev_pct),
    };
  });

  props.sort((a, b) => b.opportunity_score - a.opportunity_score);

  // Group by player
  const byPlayer = {};
  for (const p of props) {
    if (!byPlayer[p.player_name]) byPlayer[p.player_name] = { player: p.player_name, team: p.team, props: [] };
    byPlayer[p.player_name].props.push(p);
  }

  return {
    game_id:      game.id,
    home_team:    game.home_team,
    away_team:    game.away_team,
    date:         game.date,
    tip_off:      game.tip_off,
    total_props:  props.length,
    best_conf:    props[0]?.confidence || 0,
    top_props:    props.slice(0, 10),
    props,
    by_player:    Object.values(byPlayer),
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: corsHeaders(),
  });
}
