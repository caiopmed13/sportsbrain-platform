// faixaHTGenerator.js — Gerador de picks HT baseados em chutes + escanteios (FAIXA method)
// Metodologia FAIXA: 4 legs por jogo
//   • HOME SHOTS OVER  : time da casa domina chutes no 1ºT  (shot_events)
//   • AWAY SHOTS UNDER : visitante é passivo em chutes 1ºT  (shot_events)
//   • HOME CORNERS OVER: mandante ganha escanteios no 1ºT   (team_stats + Poisson)
//   • AWAY CORNERS UNDER: visitante perde escanteios 1ºT    (team_stats + Poisson)

// ── Poisson CDF helper ─────────────────────────────────────────────────────
// P(X <= k) onde X ~ Poisson(lambda)
function poissonCDF(k, lambda) {
  if (lambda <= 0) return 1
  if (k < 0) return 0
  let sum = 0, term = Math.exp(-lambda)
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += term
    term *= lambda / (i + 1)
  }
  return Math.min(1, sum)
}
// P(X > line) = 1 - P(X <= floor(line))
function poissonOver(line, lambda) { return 1 - poissonCDF(Math.floor(line), lambda) }
// P(X < line) = P(X <= ceil(line) - 1)
function poissonUnder(line, lambda) { return poissonCDF(Math.ceil(line) - 1, lambda) }

// ── Busca stats de escanteios 1ºT no team_stats (fuzzy match) ─────────────
async function queryCornersHT(db, teamName, homeAway) {
  if (!db || !teamName) return null
  const n = teamName.trim()
  // Tenta match exato primeiro, depois LIKE, depois substring reverso
  const row = await db.prepare(`
    SELECT corners_ht_per_game, corners_per_game, games_played
    FROM team_stats
    WHERE sport = 'football'
      AND home_away IN (?, 'all')
      AND (LOWER(team_name) = LOWER(?)
           OR LOWER(team_name) LIKE LOWER(?)
           OR LOWER(?) LIKE '%' || LOWER(team_name) || '%')
    ORDER BY CASE WHEN home_away = ? THEN 0 ELSE 1 END,
             games_played DESC
    LIMIT 1
  `).bind(homeAway, n, `%${n}%`, n, homeAway).first().catch(() => null)
  if (!row) return null
  // corners_ht_per_game direto; fallback: 42% dos escanteios totais ficam no 1ºT
  const ht = row.corners_ht_per_game || (row.corners_per_game ? row.corners_per_game * 0.42 : null)
  return ht && ht > 0.3 ? { cornersHT: +ht.toFixed(2), n: row.games_played || 0 } : null
}

/**
 * @param {object} env    — Cloudflare Worker env (com SB_DB)
 * @param {Array}  fixtures — picks com { home_team, away_team, match, league, kickoff }
 * @returns {Promise<Array>} picks no formato do premiumPicks (stat: ht_shots_home / ht_shots_away / ht_corners_home / ht_corners_away)
 */
export async function generateFaixaHTStats(env, fixtures) {
  if (!env?.SB_DB || !fixtures?.length) return []
  const picks = []

  // ── Deduplica fixtures por par de times ──────────────────────────────────
  const seen = new Set()
  const unique = []
  for (const f of fixtures) {
    if (!f.home_team || !f.away_team) continue
    const key = `${f.home_team}|||${f.away_team}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(f)
  }
  if (!unique.length) return []

  // Janela de histórico: últimos 120 dias (garante amostra suficiente)
  const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)

  for (const fix of unique.slice(0, 25)) {  // cap: 25 fixtures → até 50 picks
    const { home_team, away_team, match, league, kickoff } = fix

    try {
      // ── HOME: chutes no 1ºT como mandante (últimas 10 partidas em casa) ──
      const homeRes = await env.SB_DB.prepare(`
        SELECT
          SUM(CASE WHEN s.period = 1 THEN 1 ELSE 0 END)  AS shots_1t,
          SUM(CASE WHEN s.period = 1 AND s.on_target = 1 THEN 1 ELSE 0 END) AS on_target_1t,
          COUNT(s.rowid)                                  AS shots_total
        FROM matches_raw m
        JOIN shot_events s ON s.match_id = m.match_id AND s.is_home = 1
        WHERE m.home_team_norm = ? AND m.status = 'post'
          AND m.match_date >= ? AND m.match_date < date('now')
        GROUP BY m.match_id
        ORDER BY m.match_date DESC
        LIMIT 10
      `).bind(home_team, cutoff).all().catch(() => ({ results: [] }))

      // ── AWAY: chutes no 1ºT como visitante (últimas 10 partidas fora) ──
      const awayRes = await env.SB_DB.prepare(`
        SELECT
          SUM(CASE WHEN s.period = 1 THEN 1 ELSE 0 END)  AS shots_1t,
          SUM(CASE WHEN s.period = 1 AND s.on_target = 1 THEN 1 ELSE 0 END) AS on_target_1t,
          COUNT(s.rowid)                                  AS shots_total
        FROM matches_raw m
        JOIN shot_events s ON s.match_id = m.match_id AND s.is_home = 0
        WHERE m.away_team_norm = ? AND m.status = 'post'
          AND m.match_date >= ? AND m.match_date < date('now')
        GROUP BY m.match_id
        ORDER BY m.match_date DESC
        LIMIT 10
      `).bind(away_team, cutoff).all().catch(() => ({ results: [] }))

      const homeData = (homeRes.results || []).filter(r => (r.shots_total || 0) >= 1)
      const awayData = (awayRes.results || []).filter(r => (r.shots_total || 0) >= 1)

      // ── HOME OVER ─────────────────────────────────────────────────────────
      if (homeData.length >= 5) {
        const avg = homeData.reduce((s, r) => s + (r.shots_1t || 0), 0) / homeData.length
        if (avg >= 2.5) {  // mínimo: time realmente ataca no 1ºT
          // Linha: 0.5 abaixo do floor da média (ex: avg=5.2 → floor=5 → linha=4.5)
          const line = Math.max(1.5, Math.floor(avg) - 0.5)
          const hits = homeData.filter(r => (r.shots_1t || 0) > line).length
          const hitRate = hits / homeData.length

          if (hitRate >= 0.55) {
            const prob    = +(hitRate * 0.90).toFixed(4)   // desconto conservador 10%
            const bookOdd = +(1 / hitRate * 1.08).toFixed(2) // margem 8% (mercado típico HT)
            const fairOdd = +(1 / prob).toFixed(2)
            const ev      = +((prob * bookOdd - 1) * 100).toFixed(2)

            picks.push({
              match,
              match_id: `faixa_ht_home_over_${home_team.replace(/\s/g,'_')}_${line}`,
              home_team, away_team,
              league:   league || 'HT Model',
              kickoff,
              market:    'HT_SHOTS',
              stat:      'ht_shots_home',
              direction: 'over',
              line,
              team:       home_team,
              player_name: null,
              selection: `${home_team} Mais de ${line} chutes 1ºT`,
              odd:       bookOdd,
              book_odds: bookOdd,
              fair_odds: fairOdd,
              prob,
              conf:       Math.round(prob * 100),
              confidence: Math.round(prob * 100),
              ev_pct:    ev,
              consensus_count:    homeData.length,
              consensus_channels: 1,
              score:     ev,
              recommended_stake_pct: 1,
              bet365: false,
              odd_source: 'faixa_model',
              source:    'faixa_ht',
              _is_direct_b365: false,
              _has_real_wr:    true,
              _is_faixa_ht:    true,
              faixa_avg_shots_1t: +avg.toFixed(2),
              faixa_sample_n:     homeData.length,
              faixa_hit_rate:     +hitRate.toFixed(3),
              faixa_line_type:    'conservative',
              analysis: `${home_team} média ${avg.toFixed(1)} chutes 1ºT em casa (${homeData.length}j). ` +
                        `OVER ${line}: ${(hitRate*100).toFixed(0)}% hit rate histórico.`,
              channel_name: 'FAIXA HT Model',
              is_faixa:    true,
            })
          }

          // ── HOME OVER AGRESSIVO — linha mais alta, odds 3-10x para acumuladores Mega ──
          // Mesma lógica FAIXA: mesmo jogo, linha mais difícil → ativa o tier de alta odd
          if (avg >= 3.5) {
            const aggrLine = Math.max(4.5, Math.ceil(avg) + 1.5)
            const aggrHits = homeData.filter(r => (r.shots_1t || 0) > aggrLine).length
            const aggrHR   = aggrHits / homeData.length
            if (aggrHR >= 0.15 && aggrHR <= 0.45) {
              const aggrProb    = +(aggrHR * 0.88).toFixed(4)
              const aggrBookOdd = +(1 / aggrHR * 1.12).toFixed(2)
              picks.push({
                match,
                match_id: `faixa_ht_home_over_aggr_${home_team.replace(/\s/g,'_')}_${aggrLine}`,
                home_team, away_team,
                league:   league || 'HT Model',
                kickoff,
                market:    'HT_SHOTS',
                stat:      'ht_shots_home',
                direction: 'over',
                line:       aggrLine,
                team:       home_team,
                player_name: null,
                selection: `${home_team} Mais de ${aggrLine} chutes 1ºT`,
                odd:       aggrBookOdd,
                book_odds: aggrBookOdd,
                fair_odds: +(1 / aggrProb).toFixed(2),
                prob:      aggrProb,
                conf:      Math.round(aggrProb * 100),
                confidence: Math.round(aggrProb * 100),
                ev_pct:    +((aggrProb * aggrBookOdd - 1) * 100).toFixed(2),
                consensus_count:    homeData.length,
                consensus_channels: 1,
                score:     +((aggrProb * aggrBookOdd - 1) * 100).toFixed(2),
                recommended_stake_pct: 0.5,
                bet365: false,
                odd_source: 'faixa_model',
                source:    'faixa_ht',
                _is_direct_b365: false,
                _has_real_wr:    true,
                _is_faixa_ht:    true,
                faixa_avg_shots_1t: +avg.toFixed(2),
                faixa_sample_n:     homeData.length,
                faixa_hit_rate:     +aggrHR.toFixed(3),
                faixa_line_type:    'aggressive',
                analysis: `🎯 ${home_team} AGRESSIVO: Mais de ${aggrLine} chutes 1ºT — ` +
                          `${(aggrHR*100).toFixed(0)}% hit rate. Odd alta para acumuladores Mega.`,
                channel_name: 'FAIXA HT Model',
                is_faixa:    true,
              })
            }
          }
        }
      }

      // ── AWAY UNDER ───────────────────────────────────────────────────────
      if (awayData.length >= 5) {
        const avg = awayData.reduce((s, r) => s + (r.shots_1t || 0), 0) / awayData.length
        if (avg <= 6) {  // só se visitante realmente chuta pouco
          // Linha: 0.5 acima do ceil da média (ex: avg=3.1 → ceil=4 → linha=4.5)
          const line = Math.max(2.5, Math.ceil(avg) + 0.5)
          const hits = awayData.filter(r => (r.shots_1t || 0) < line).length
          const hitRate = hits / awayData.length

          if (hitRate >= 0.55) {
            const prob    = +(hitRate * 0.90).toFixed(4)
            const bookOdd = +(1 / hitRate * 1.08).toFixed(2)
            const fairOdd = +(1 / prob).toFixed(2)
            const ev      = +((prob * bookOdd - 1) * 100).toFixed(2)

            picks.push({
              match,
              match_id: `faixa_ht_away_under_${away_team.replace(/\s/g,'_')}_${line}`,
              home_team, away_team,
              league:   league || 'HT Model',
              kickoff,
              market:    'HT_SHOTS',
              stat:      'ht_shots_away',
              direction: 'under',
              line,
              team:       away_team,
              player_name: null,
              selection: `${away_team} Menos de ${line} chutes 1ºT`,
              odd:       bookOdd,
              book_odds: bookOdd,
              fair_odds: fairOdd,
              prob,
              conf:       Math.round(prob * 100),
              confidence: Math.round(prob * 100),
              ev_pct:    ev,
              consensus_count:    awayData.length,
              consensus_channels: 1,
              score:     ev,
              recommended_stake_pct: 1,
              bet365: false,
              odd_source: 'faixa_model',
              source:    'faixa_ht',
              _is_direct_b365: false,
              _has_real_wr:    true,
              _is_faixa_ht:    true,
              faixa_avg_shots_1t: +avg.toFixed(2),
              faixa_sample_n:     awayData.length,
              faixa_hit_rate:     +hitRate.toFixed(3),
              faixa_line_type:    'conservative',
              analysis: `${away_team} média ${avg.toFixed(1)} chutes 1ºT fora (${awayData.length}j). ` +
                        `UNDER ${line}: ${(hitRate*100).toFixed(0)}% hit rate histórico.`,
              channel_name: 'FAIXA HT Model',
              is_faixa:    true,
            })
          }

          // ── AWAY UNDER AGRESSIVO — linha mais baixa, odds 3-10x para acumuladores Mega ──
          {
            const aggrLine = Math.max(0.5, Math.floor(avg) - 0.5)
            const aggrHits = awayData.filter(r => (r.shots_1t || 0) < aggrLine).length
            const aggrHR   = aggrHits / awayData.length
            if (aggrHR >= 0.15 && aggrHR <= 0.45 && aggrLine >= 0.5) {
              const aggrProb    = +(aggrHR * 0.88).toFixed(4)
              const aggrBookOdd = +(1 / aggrHR * 1.12).toFixed(2)
              picks.push({
                match,
                match_id: `faixa_ht_away_under_aggr_${away_team.replace(/\s/g,'_')}_${aggrLine}`,
                home_team, away_team,
                league:   league || 'HT Model',
                kickoff,
                market:    'HT_SHOTS',
                stat:      'ht_shots_away',
                direction: 'under',
                line:       aggrLine,
                team:       away_team,
                player_name: null,
                selection: `${away_team} Menos de ${aggrLine} chutes 1ºT`,
                odd:       aggrBookOdd,
                book_odds: aggrBookOdd,
                fair_odds: +(1 / aggrProb).toFixed(2),
                prob:      aggrProb,
                conf:      Math.round(aggrProb * 100),
                confidence: Math.round(aggrProb * 100),
                ev_pct:    +((aggrProb * aggrBookOdd - 1) * 100).toFixed(2),
                consensus_count:    awayData.length,
                consensus_channels: 1,
                score:     +((aggrProb * aggrBookOdd - 1) * 100).toFixed(2),
                recommended_stake_pct: 0.5,
                bet365: false,
                odd_source: 'faixa_model',
                source:    'faixa_ht',
                _is_direct_b365: false,
                _has_real_wr:    true,
                _is_faixa_ht:    true,
                faixa_avg_shots_1t: +avg.toFixed(2),
                faixa_sample_n:     awayData.length,
                faixa_hit_rate:     +aggrHR.toFixed(3),
                faixa_line_type:    'aggressive',
                analysis: `🎯 ${away_team} AGRESSIVO: Menos de ${aggrLine} chutes 1ºT — ` +
                          `${(aggrHR*100).toFixed(0)}% hit rate. Odd alta para acumuladores Mega.`,
                channel_name: 'FAIXA HT Model',
                is_faixa:    true,
              })
            }
          }
        }
      }

      // ── CORNERS HOME OVER + AWAY UNDER (team_stats + Poisson) ─────────────
      // Replica a segunda metade da tip FAIXA: escanteios 1ºT para completar 4-leg
      try {
        const [hCS, aCS] = await Promise.all([
          queryCornersHT(env.SB_DB, home_team, 'home'),
          queryCornersHT(env.SB_DB, away_team, 'away'),
        ])

        // HOME CORNERS OVER — mandante domina escanteios (alta média)
        if (hCS?.cornersHT >= 2.0) {
          const lambda = hCS.cornersHT
          // Conservador: linha 0.5 abaixo da média
          const line = Math.max(1.5, +(Math.floor(lambda) - 0.5).toFixed(1))
          const hitRate = poissonOver(line, lambda)
          if (hitRate >= 0.52 && hitRate < 0.88) {
            const prob    = +(hitRate * 0.90).toFixed(4)
            const bookOdd = +(1 / hitRate * 1.08).toFixed(2)
            picks.push({
              match, match_id: `faixa_ht_home_corners_over_${home_team.replace(/\s/g,'_')}_${line}`,
              home_team, away_team, league: league || 'HT Model', kickoff,
              market: 'HT_CORNERS', stat: 'ht_corners_home', direction: 'over',
              line, team: home_team, player_name: null,
              selection: `Mais de ${line} Escanteios 1ºT para ${home_team}`,
              odd: bookOdd, book_odds: bookOdd, fair_odds: +(1 / prob).toFixed(2),
              prob, conf: Math.round(prob * 100), confidence: Math.round(prob * 100),
              ev_pct: +((prob * bookOdd - 1) * 100).toFixed(2),
              consensus_count: hCS.n, consensus_channels: 1,
              score: +((prob * bookOdd - 1) * 100).toFixed(2),
              recommended_stake_pct: 1,
              bet365: false, odd_source: 'faixa_model', source: 'faixa_ht',
              _is_direct_b365: false, _has_real_wr: !!(hCS.n >= 5), _is_faixa_ht: true,
              faixa_avg_shots_1t: lambda, faixa_sample_n: hCS.n,
              faixa_hit_rate: +hitRate.toFixed(3), faixa_line_type: 'conservative',
              analysis: `${home_team} média ${lambda.toFixed(1)} escanteios 1ºT em casa. ` +
                        `OVER ${line}: ${(hitRate*100).toFixed(0)}% hit rate (Poisson).`,
              channel_name: 'FAIXA HT Model', is_faixa: true,
            })
          }
        }

        // AWAY CORNERS UNDER — visitante perde escanteios (baixa média)
        if (aCS?.cornersHT >= 0.5 && aCS?.cornersHT <= 4.0) {
          const lambda = aCS.cornersHT
          // Conservador: linha 0.5 acima da média
          const line = Math.max(1.5, +(Math.ceil(lambda) + 0.5).toFixed(1))
          const hitRate = poissonUnder(line, lambda)
          if (hitRate >= 0.52 && hitRate < 0.88) {
            const prob    = +(hitRate * 0.90).toFixed(4)
            const bookOdd = +(1 / hitRate * 1.08).toFixed(2)
            picks.push({
              match, match_id: `faixa_ht_away_corners_under_${away_team.replace(/\s/g,'_')}_${line}`,
              home_team, away_team, league: league || 'HT Model', kickoff,
              market: 'HT_CORNERS', stat: 'ht_corners_away', direction: 'under',
              line, team: away_team, player_name: null,
              selection: `Menos de ${line} Escanteios 1ºT para ${away_team}`,
              odd: bookOdd, book_odds: bookOdd, fair_odds: +(1 / prob).toFixed(2),
              prob, conf: Math.round(prob * 100), confidence: Math.round(prob * 100),
              ev_pct: +((prob * bookOdd - 1) * 100).toFixed(2),
              consensus_count: aCS.n, consensus_channels: 1,
              score: +((prob * bookOdd - 1) * 100).toFixed(2),
              recommended_stake_pct: 1,
              bet365: false, odd_source: 'faixa_model', source: 'faixa_ht',
              _is_direct_b365: false, _has_real_wr: !!(aCS.n >= 5), _is_faixa_ht: true,
              faixa_avg_shots_1t: lambda, faixa_sample_n: aCS.n,
              faixa_hit_rate: +hitRate.toFixed(3), faixa_line_type: 'conservative',
              analysis: `${away_team} média ${lambda.toFixed(1)} escanteios 1ºT fora. ` +
                        `UNDER ${line}: ${(hitRate*100).toFixed(0)}% hit rate (Poisson).`,
              channel_name: 'FAIXA HT Model', is_faixa: true,
            })
          }
        }
      } catch (_ce) { /* corners opcionais — ignora silenciosamente */ }

    } catch (_e) {
      // Fixture sem dados — ignora silenciosamente
    }
  }

  return picks
}
