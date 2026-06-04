// desajustePicks.js — Gera picks a partir de desajustes de mercado
//
// Duas fontes de evidência:
//   1. STEAM  — Pinnacle odd encurtou >6% em 2h (dinheiro profissional)
//               tabela: odds_signals (is_steam=1, atualizado a cada 5min)
//   2. DEVIG  — Devig interno Bet365: lado com EV > 3% vs fair calculado
//               fonte: bet365_markets_snapshots (snapshot mais recente)
//
// Retorna:
//   picks    → Pick[] em formato padrão premiumPicks
//   steamMap → Map<key, {strength, pct_change, factor}> para tagging de picks existentes

import { attachFixtureIdentity } from '../services/fixtureIdentity.js'

// ─── helpers ────────────────────────────────────────────────────────────────
function normN(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
    .replace(/\b(fc|cf|sc|cd|sp|rs|mg|rj|pr|sg|sk|jrs)\b/g, '')
    .trim()
}

function cleanN(s) {
  // Limpa nomes de times mantendo legibilidade
  if (!s) return ''
  return String(s).trim().replace(/\s*\bfc\b\s*/gi, '').replace(/\s+/g, ' ').trim()
}

function devigOdds(odds) {
  if (!odds?.length || odds.some(o => !o || o <= 1.01)) return null
  const impl = odds.map(o => 1 / o)
  const sum  = impl.reduce((a, b) => a + b, 0)
  if (sum < 0.85 || sum > 2.6) return null
  return impl.map(p => p / sum)
}

const MKT_PT = {
  '1X2': 'Resultado Final', 'RESULT': 'Resultado Final', 'MATCH_WINNER': 'Resultado Final',
  'BTTS': 'Ambos Marcam', 'TOTAL_GOALS': 'Total de Gols',
  'CORNERS_OU': 'Escanteios', 'HANDICAP': 'Handicap Asiático',
  'DRAW_NO_BET': 'Empate Anula', 'HT_FT': 'Intervalo/Final',
  'PLAYER_SHOTS': 'Chutes do Jogador', 'PLAYER_CARDS': 'Cartão do Jogador',
}

function mktLabel(k) { return MKT_PT[k] || k }

function selLabel(direction, line, home, away) {
  const d = (direction || '').toLowerCase()
  if (d === 'home' || d === '1' || d === 'win')  return `${home} Vence`
  if (d === 'away' || d === '2')                  return `${away} Vence`
  if (d === 'draw' || d === 'x')                  return 'Empate'
  if (d === 'over')  return `Mais de ${line ?? ''}`.trim()
  if (d === 'under') return `Menos de ${line ?? ''}`.trim()
  if (d === 'yes' || d === 'sim')  return 'Ambos Marcam: Sim'
  if (d === 'no'  || d === 'não')  return 'Ambos Marcam: Não'
  return direction || ''
}

// ─── export principal ────────────────────────────────────────────────────────
export async function getDesajustePicks(env) {
  const picks   = []
  const steamMap = new Map()  // key → {strength, pct_change, factor, odd_2h_ago}
  if (!env?.SB_DB) return { picks, steamMap }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. STEAM PICKS — odds_signals (Pinnacle steam, detectado pelo steamDetector.js)
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const { results: steamRows } = await env.SB_DB.prepare(`
      SELECT id, home_team, away_team, market, outcome, line,
             odd_now, odd_2h_ago, pct_change, steam_strength, signal_factor, computed_at
      FROM odds_signals
      WHERE is_steam = 1
        AND steam_strength IN ('medium','strong')
        AND computed_at >= datetime('now', '-1 hour')
      ORDER BY signal_factor DESC
      LIMIT 60
    `).all().catch(() => ({ results: [] }))

    for (const s of (steamRows || [])) {
      if (!s.home_team || !s.away_team) continue

      // steamMap usa chave normalizada para cross-match com picks existentes
      const mapKey = `${normN(s.home_team)}|${normN(s.away_team)}|${s.market}|${s.outcome}`
      steamMap.set(mapKey, {
        strength:    s.steam_strength,
        pct_change:  s.pct_change,
        factor:      s.signal_factor,
        odd_2h_ago:  s.odd_2h_ago,
        odd_now:     s.odd_now,
      })

      // Prob: Pinnacle preço já é sharp (~4.5% vig → fairProb = impliedProb / 1.045)
      if (!s.odd_now || s.odd_now <= 1) continue
      const fairProb = Math.min(0.93, (1 / s.odd_now) * 0.97)
      if (fairProb < 0.08) continue

      const home  = cleanN(s.home_team)
      const away  = cleanN(s.away_team)
      const ev    = +((fairProb * s.odd_now - 1) * 100).toFixed(2)
      const sel   = selLabel(s.outcome, s.line, home, away)

      picks.push({
        match:        `${home} v ${away}`,
        match_id:     `steam_${s.id}`,
        home_team:    home,
        away_team:    away,
        league:       mktLabel(s.market),
        kickoff:      null,
        market:       s.market,
        stat:         s.market,
        direction:    s.outcome,
        line:         s.line ?? null,
        selection:    sel,
        odd:          +s.odd_now.toFixed(2),
        book_odds:    +s.odd_now.toFixed(2),
        fair_odds:    +(1 / fairProb).toFixed(2),
        prob:         +fairProb.toFixed(4),
        conf:         Math.round(fairProb * 100),
        ev_pct:       ev,
        consensus_count:    1,
        consensus_channels: 1,
        source:        'steam_signal',
        odd_source:    'pinnacle_steam',
        bet365:        false,
        pinnacle:      true,
        _is_direct_b365: false,
        _has_real_wr:    false,
        _has_steam:      true,
        steam_strength:  s.steam_strength,
        steam_pct_change: s.pct_change,
        steam_factor:    s.signal_factor,
        bet365_event_id: null,  // steam picks from Pinnacle — no bet365 fixture id
        fixture_id: null,
        recommended_stake_pct: s.steam_strength === 'strong' ? 2.0 : 1.0,
        analysis: `🔥 Steam Pinnacle: linha encurtou ${(s.pct_change * 100).toFixed(1)}% em 2h ` +
                  `(${s.odd_2h_ago?.toFixed(2)} → ${s.odd_now.toFixed(2)}) — dinheiro profissional detectado`,
      })
    }
    console.log(`[desajuste] Steam picks: ${picks.filter(p => p.source === 'steam_signal').length}`)
  } catch (e) {
    console.warn('[desajuste] steam error:', e.message)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DEVIG PICKS — Bet365 internal devig (sem livro externo necessário)
  //    Deviga todas as sides do mesmo mercado. Pega lado com melhor EV.
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const mkRow = await env.SB_DB.prepare(
      `SELECT payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first().catch(() => null)

    if (mkRow?.payload) {
      const markets = JSON.parse(mkRow.payload) || []

      // Agrupa por (fixtureId, market, line) para devig por grupo de mercado
      const groups = {}
      for (const m of markets) {
        if (!m.fixtureId || !m.market || !m.odd) continue
        if (m.odd < 1.05 || m.odd > 25) continue
        // Skip mercados ruins: placar exato, faixa gols, DC, player props sem nome
        if (/CORRECT_SCORE|GOALS_RANGE|WINNING_MARGIN|FIRST_BASKET/i.test(m.market)) continue
        if (/DOUBLE_CHANCE|DRAW_NO_BET|DNB/i.test(m.market)) continue
        if (/PLAYER_SCORE_OR_ASSIST|PLAYER_SCORE$/i.test(m.market)) continue
        const gk = `${m.fixtureId}|${m.market}|${m.line ?? ''}`
        if (!groups[gk]) groups[gk] = { fixture: m, items: [] }
        groups[gk].items.push(m)
      }

      let devigCount = 0
      for (const [, g] of Object.entries(groups)) {
        const { fixture, items } = g
        if (items.length < 2) continue  // precisa de pelo menos 2 lados para devig

        const odds = items.map(i => i.odd)
        const fair = devigOdds(odds)
        if (!fair) continue

        // Pega o lado com maior EV
        let bestEV = -Infinity, bestIdx = -1
        for (let i = 0; i < items.length; i++) {
          const ev = (fair[i] * items[i].odd - 1) * 100
          if (ev > bestEV) { bestEV = ev; bestIdx = i }
        }
        if (bestIdx < 0 || bestEV < 3.0) continue  // threshold 3% EV mínimo

        const best      = items[bestIdx]
        const fairProb  = fair[bestIdx]
        if (fairProb < 0.08 || fairProb > 0.93) continue

        // DC proibida nos devig picks (não é pick de convicção)
        if (/DOUBLE_CHANCE|DNB/i.test(best.market)) continue

        const home = cleanN(fixture.home || '')
        const away = cleanN(fixture.away || '')
        if (!home || !away) continue

        const direction = best.side || best.selection || ''
        const sel       = selLabel(direction, best.line, home, away)
        const kickoff   = fixture.startTime || fixture.kickoff || null

        // Tag no steamMap (para cross-match com picks existentes)
        const mapKey = `${normN(home)}|${normN(away)}|${best.market}|${direction}`
        if (!steamMap.has(mapKey)) {
          steamMap.set(mapKey, { strength: 'devig', ev: bestEV })
        }

        picks.push({
          match:        `${home} v ${away}`,
          match_id:     `devig_${fixture.fixtureId}_${best.market}_${direction}_${best.line ?? ''}`,
          home_team:    home,
          away_team:    away,
          league:       mktLabel(best.market),
          kickoff,
          market:       best.market,
          stat:         best.market,
          direction,
          line:         best.line ?? null,
          selection:    sel,
          odd:          +best.odd.toFixed(2),
          book_odds:    +best.odd.toFixed(2),
          fair_odds:    +(1 / fairProb).toFixed(2),
          prob:         +fairProb.toFixed(4),
          conf:         Math.round(fairProb * 100),
          ev_pct:       +bestEV.toFixed(2),
          consensus_count:    items.length,
          consensus_channels: 1,
          source:        'devig',
          odd_source:    'bet365_devig',
          bet365:        true,
          pinnacle:      false,
          _is_direct_b365: true,
          _has_real_wr:    false,
          _is_devig:       true,
          bet365_event_id: fixture.fixtureId ? String(fixture.fixtureId) : null,
          fixture_id: null,
          recommended_stake_pct: bestEV >= 8 ? 2.0 : 1.5,
          analysis: `📐 Devig Bet365: ${items.length} lados → fair ${(fairProb * 100).toFixed(1)}% ` +
                    `vs implied ${(100 / best.odd).toFixed(1)}% → +${bestEV.toFixed(1)}% EV`,
        })
        devigCount++
      }
      console.log(`[desajuste] Devig picks: ${devigCount}`)
    }
  } catch (e) {
    console.warn('[desajuste] devig error:', e.message)
  }

  // Ordena: steam forte primeiro, depois maior EV
  picks.sort((a, b) => {
    const aS = a._has_steam && a.steam_strength === 'strong' ? 2 : a._has_steam ? 1 : 0
    const bS = b._has_steam && b.steam_strength === 'strong' ? 2 : b._has_steam ? 1 : 0
    if (aS !== bS) return bS - aS
    return (b.ev_pct || 0) - (a.ev_pct || 0)
  })

  // Attach fixture identity to all desajuste picks
  picks.forEach(p => attachFixtureIdentity(p, p))

  return { picks, steamMap }
}
