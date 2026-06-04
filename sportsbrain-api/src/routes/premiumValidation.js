/**
 * SportsBrain Premium — Camada de Validação Pre-Monetização
 * ──────────────────────────────────────────────────────────
 *
 *   GET  /v1/premium/validation         → dashboard interno completo
 *   GET  /v1/premium/proof              → social proof para /vip (sem inflar)
 *   POST /internal/resolve-premium      → resolve resultados via ESPN (cron)
 *
 * Objetivo: responder "O Premium está bom o suficiente para cobrar?"
 *
 * Regras de ROI:
 *   stake = 1 unidade por pick
 *   green     → lucro = (odd - 1)     [ex: odd 2.10 → +1.10 un]
 *   red       → lucro = -1 un
 *   void      → lucro = 0 (stake devolvida)
 *   half_green→ lucro = (odd - 1) / 2
 *   half_red  → lucro = -0.5
 *   unknown   → excluído do ROI
 */

import { corsHeaders } from './health.js';
import { normTeam } from '../utils/teamNorm.js';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function calcProfit(resultStatus, odd) {
  const o = parseFloat(odd) || 0;
  switch (resultStatus) {
    case 'green':      return +(o - 1).toFixed(4);
    case 'red':        return -1;
    case 'void':       return 0;
    case 'half_green': return +((o - 1) / 2).toFixed(4);
    case 'half_red':   return -0.5;
    default:           return null; // unknown / pending — excluído do cálculo
  }
}

function buildStats(rows) {
  const resolved    = rows.filter(r => ['green','red','void','half_green','half_red'].includes(r.result_status));
  const greens      = rows.filter(r => r.result_status === 'green' || r.result_status === 'half_green');
  const reds        = rows.filter(r => r.result_status === 'red'   || r.result_status === 'half_red');
  const voids       = rows.filter(r => r.result_status === 'void');
  const unknowns    = rows.filter(r => r.result_status === 'unknown');
  const pending     = rows.filter(r => r.result_status === 'pending');

  // Calcula profit de cada pick resolvida
  let totalProfit = 0;
  let totalStake  = 0;
  const oddsResolved = [];

  for (const r of resolved) {
    if (r.result_status === 'void') continue; // void não conta como stake
    const profit = calcProfit(r.result_status, r.odd);
    if (profit !== null) {
      totalProfit += profit;
      totalStake  += 1;
      if (r.odd) oddsResolved.push(parseFloat(r.odd));
    }
  }

  const winRate   = resolved.length > 0 ? +(greens.length / resolved.filter(r => r.result_status !== 'void').length * 100).toFixed(1) : null;
  const roi       = totalStake > 0 ? +(totalProfit / totalStake * 100).toFixed(2) : null;
  const yield_pct = totalStake > 0 ? +(totalProfit / totalStake * 100).toFixed(2) : null; // = ROI para stake fixa 1u
  const avgOdd    = oddsResolved.length > 0 ? +(oddsResolved.reduce((a, b) => a + b, 0) / oddsResolved.length).toFixed(2) : null;
  const unknownPct = rows.length > 0 ? +(unknowns.length / rows.length * 100).toFixed(1) : null;

  return {
    total_picks:   rows.length,
    resolved:      resolved.length,
    pending:       pending.length,
    greens:        greens.length,
    reds:          reds.length,
    voids:         voids.length,
    unknowns:      unknowns.length,
    win_rate_pct:  winRate,
    roi_pct:       roi,
    yield_pct,
    profit_units:  +totalProfit.toFixed(2),
    total_stake:   totalStake,
    avg_odd:       avgOdd,
    unknown_pct:   unknownPct,
  };
}

function groupBy(rows, key, labelFn = null) {
  const groups = {};
  for (const r of rows) {
    const k = r[key] || 'unknown';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  return Object.entries(groups)
    .map(([k, arr]) => ({
      group:  k,
      label:  labelFn ? labelFn(k) : k,
      ...buildStats(arr),
    }))
    .sort((a, b) => b.total_picks - a.total_picks);
}

// Classifica mercado por nome legível
function marketLabel(market) {
  const m = (market || '').toUpperCase();
  if (/^1X2$|^RESULT|^MATCH_WINNER|^HOME|^AWAY|^DRAW/.test(m)) return 'Resultado 1X2';
  if (/BTTS|BOTH_TEAMS/.test(m))   return 'BTTS';
  if (/OVER|UNDER|O\/U|GOALS/.test(m)) return 'Over/Under Gols';
  if (/CORNER|ESCANTEIO/.test(m))  return 'Escanteios';
  if (/CARD|CART/.test(m))         return 'Cartões';
  if (/SHOT|CHUTE|FINALIZ/.test(m)) return 'Chutes/Finalizações';
  if (/PLAYER_|JOGADOR/.test(m))   return 'Player Props';
  if (/DOUBLE_CHANCE|DC/.test(m))  return 'Double Chance';
  if (/DNB|DRAW_NO_BET/.test(m))   return 'Draw No Bet';
  if (/HT|HALF/.test(m))           return '1º Tempo';
  return market || 'Outros';
}

// Normaliza fonte para label legível
function sourceLabel(source) {
  if (!source) return 'Desconhecido';
  const s = source.toLowerCase();
  if (s.includes('bet365') || s.includes('b365')) return 'Bet365 Direct';
  if (s.includes('tipster') || s.includes('telegram')) return 'Tipster';
  if (s.includes('ml') || s.includes('model'))   return 'ML Model';
  if (s.includes('desajust') || s.includes('steam') || s.includes('devig')) return 'Desajuste';
  if (s.includes('faixa'))  return 'FAIXA Method';
  if (s.includes('ht') || s.includes('half'))     return 'HT Method';
  if (s.includes('pattern') || s.includes('ia'))  return 'Pattern IA';
  return source;
}

// Badge label para display
function badgeLabel(r) {
  if (r.desajuste_level === 'premium') return 'Desajustada Premium';
  if (r.desajuste_level === 'forte')   return 'Desajustada Forte';
  if (r.desajuste_level === 'leve')    return 'Desajuste Leve';
  if (r.value_bet_level === 'strong_value') return 'Strong Value';
  if (r.value_bet_level === 'value')   return 'Value Bet';
  if (r.premium_tier_quality === 'elite') return 'Elite Pick';
  if (r.premium_tier_quality === 'strong') return 'Strong Pick';
  if (r.premium_tier_quality === 'playable') return 'Playable';
  return 'Sem Badge';
}

// ── Critérios de monetização ─────────────────────────────────────────────
function evaluateMonetizationReadiness(overallStats, byTier, bySinglesVsCombos) {
  const MIN_SAMPLE = 50;
  const IDEAL_SAMPLE = 100;
  const MAX_UNKNOWN_PCT = 30;
  const MIN_ROI_FOR_READY = 3;
  const MIN_ROI_FOR_BETA = 0;

  const singles = bySinglesVsCombos.find(g => g.group === 'single');
  const singlesResolved = singles?.resolved || 0;
  const singlesROI = singles?.roi_pct;
  const unknownPct = overallStats.unknown_pct || 0;

  const reasons = [];
  const positives = [];
  const warnings = [];

  // ── Bloqueadores absolutos ───────────────────────────────────────────
  if (singlesResolved < MIN_SAMPLE) {
    reasons.push(`Amostra insuficiente: ${singlesResolved}/${MIN_SAMPLE} singles resolvidas necessárias`);
  }

  if (unknownPct > MAX_UNKNOWN_PCT) {
    reasons.push(`Taxa de unknown muito alta: ${unknownPct}% (máx ${MAX_UNKNOWN_PCT}%)`);
    warnings.push('Muitos mercados impossíveis de resolver automaticamente — reduz confiança no track record');
  }

  if (singlesROI !== null && singlesROI < 0 && singlesResolved >= MIN_SAMPLE) {
    reasons.push(`ROI negativo em singles: ${singlesROI}%`);
  }

  // ── Sinais positivos ─────────────────────────────────────────────────
  if (singlesResolved >= IDEAL_SAMPLE) positives.push(`Amostra ótima: ${singlesResolved} singles resolvidas`);
  else if (singlesResolved >= MIN_SAMPLE) positives.push(`Amostra suficiente: ${singlesResolved} singles`);

  if (singlesROI !== null && singlesROI > 0) positives.push(`ROI positivo em singles: +${singlesROI}%`);
  if (singlesROI !== null && singlesROI > MIN_ROI_FOR_READY) positives.push(`ROI forte: +${singlesROI}% (acima do threshold ${MIN_ROI_FOR_READY}%)`);

  const eliteGroup  = byTier.find(g => g.group === 'elite');
  const strongGroup = byTier.find(g => g.group === 'strong');
  const playGroup   = byTier.find(g => g.group === 'playable');

  if (eliteGroup?.roi_pct != null && playGroup?.roi_pct != null && eliteGroup.roi_pct > playGroup.roi_pct) {
    positives.push(`Elite performa melhor que Playable (${eliteGroup.roi_pct}% vs ${playGroup.roi_pct}%)`);
  }
  if (strongGroup?.roi_pct != null && playGroup?.roi_pct != null && strongGroup.roi_pct > playGroup.roi_pct) {
    positives.push(`Strong performa melhor que Playable (${strongGroup.roi_pct}% vs ${playGroup.roi_pct}%)`);
  }

  if (unknownPct !== null && unknownPct < 15) positives.push(`Baixa taxa de unknown: ${unknownPct}%`);

  // ── Avisos não-bloqueadores ──────────────────────────────────────────
  if (singlesROI !== null && singlesROI >= 0 && singlesROI < MIN_ROI_FOR_READY) {
    warnings.push(`ROI positivo mas abaixo do ideal (${singlesROI}% < ${MIN_ROI_FOR_READY}%) — pode ser beta`);
  }

  // ── Scorecard final ──────────────────────────────────────────────────
  let status;
  let statusLabel;
  let statusDescription;

  if (reasons.length > 0 && singlesResolved < MIN_SAMPLE) {
    status = 'testing';
    statusLabel = '🔬 Em Validação';
    statusDescription = `Coletando dados. Progresso: ${singlesResolved}/${MIN_SAMPLE} singles mínimas.`;
  } else if (reasons.length > 0) {
    status = 'not_ready';
    statusLabel = '❌ Não Pronto';
    statusDescription = `Problemas identificados impedem monetização: ${reasons[0]}`;
  } else if (singlesROI !== null && singlesROI >= MIN_ROI_FOR_READY && singlesResolved >= IDEAL_SAMPLE && unknownPct < 15) {
    status = 'ready_to_sell';
    statusLabel = '✅ Pronto para Vender';
    statusDescription = `ROI ${singlesROI}%+, ${singlesResolved} picks resolvidas, unknown ${unknownPct}% — pode abrir VIP.`;
  } else if (singlesROI !== null && singlesROI >= MIN_ROI_FOR_BETA && singlesResolved >= MIN_SAMPLE) {
    status = 'beta_ready';
    statusLabel = '🟡 Beta Ready';
    statusDescription = `Sinais positivos. Pode testar VIP beta com poucos usuários ou acesso gratuito limitado.`;
  } else {
    status = 'not_ready';
    statusLabel = '❌ Não Pronto';
    statusDescription = reasons[0] || 'Dados insuficientes para avaliação.';
  }

  return {
    status,
    status_label:       statusLabel,
    status_description: statusDescription,
    can_sell:           status === 'ready_to_sell',
    can_beta:           status === 'beta_ready' || status === 'ready_to_sell',
    blockers:           reasons,
    positives,
    warnings,
    thresholds: {
      min_sample:          MIN_SAMPLE,
      ideal_sample:        IDEAL_SAMPLE,
      max_unknown_pct:     MAX_UNKNOWN_PCT,
      min_roi_for_ready:   MIN_ROI_FOR_READY,
      min_roi_for_beta:    MIN_ROI_FOR_BETA,
    },
    progress: {
      singles_resolved:     singlesResolved,
      sample_progress_pct:  Math.min(100, Math.round(singlesResolved / MIN_SAMPLE * 100)),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE RESULTADOS VIA ESPN
// ═══════════════════════════════════════════════════════════════════════════

const ESPN_SOCCER_LEAGUES = [
  'bra.1','bra.2','bra.3','bra.copa_do_brazil',
  'eng.1','esp.1','ger.1','ita.1','fra.1','por.1',
  'ned.1','bel.1','tur.1','arg.1',
  'uefa.champions','uefa.europa','conmebol.libertadores','conmebol.sudamericana',
];

async function fetchScoresForDate(dateStr) {
  const d = dateStr.replace(/-/g, '');
  const map = {};
  await Promise.allSettled(ESPN_SOCCER_LEAGUES.map(async slug => {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${d}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) return;
      const data = await res.json();
      for (const ev of (data.events || [])) {
        if (ev.status?.type?.state !== 'post') continue;
        const comp  = ev.competitions?.[0];
        const home  = comp?.competitors?.find(c => c.homeAway === 'home');
        const away  = comp?.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away) continue;
        const hs = parseInt(home.score ?? -1);
        const as_ = parseInt(away.score ?? -1);
        if (hs < 0 || as_ < 0) continue;
        const hN = normTeam(home.team?.displayName || home.team?.name || '');
        const aN = normTeam(away.team?.displayName || away.team?.name || '');
        if (hN && aN) map[`${hN}|${aN}`] = { home: hs, away: as_ };
      }
    } catch {}
  }));
  return map;
}

// Resolve um mercado: retorna 'green'|'red'|'void'|'half_green'|'half_red'|null
function resolveMarket(market, selection, line, homeScore, awayScore) {
  const m  = (market || '').toUpperCase();
  const s  = (selection || '').toLowerCase();
  const total = homeScore + awayScore;
  const btts  = homeScore > 0 && awayScore > 0;
  const homeWin = homeScore > awayScore;
  const awayWin = awayScore > homeScore;
  const isDraw  = homeScore === awayScore;
  const L = line != null ? parseFloat(line) : null;

  // Resultado 1X2
  if (/^1X2$|^RESULT|^MATCH_WINNER/.test(m) || /^home$|^1$/.test(s)) {
    if (/home|^1$|casa/.test(s))  return homeWin ? 'green' : 'red';
    if (/away|^2$|fora|visit/.test(s)) return awayWin ? 'green' : 'red';
    if (/draw|^x$|empate/.test(s)) return isDraw ? 'green' : 'red';
  }

  // BTTS
  if (/BTTS|BOTH_TEAMS/.test(m)) {
    if (/yes|sim|btts_yes/.test(s)) return btts ? 'green' : 'red';
    if (/no$|não|nao|btts_no/.test(s)) return !btts ? 'green' : 'red';
  }

  // Over/Under
  if (/OVER|UNDER|O\/U|GOALS/.test(m) || /over|under|mais|menos/.test(s)) {
    if (L === null) return null;
    const isOver  = /over|mais|acima/.test(s);
    const isUnder = /under|menos|abaixo/.test(s);
    // Asian handicap — meia-bola
    if (L % 1 !== 0) {
      const halfLine = L;
      if (isOver)  return total > halfLine ? 'green' : 'red';
      if (isUnder) return total < halfLine ? 'green' : 'red';
    }
    // Linha inteira — push (void) se empate exato
    if (isOver)  return total > L ? 'green' : total === L ? 'void' : 'red';
    if (isUnder) return total < L ? 'green' : total === L ? 'void' : 'red';
  }

  // Double Chance
  if (/DOUBLE_CHANCE|DC/.test(m)) {
    if (/1x|dc_1x/.test(s)) return (homeWin || isDraw) ? 'green' : 'red';
    if (/x2|dc_x2/.test(s)) return (awayWin || isDraw) ? 'green' : 'red';
    if (/12|dc_12/.test(s)) return !isDraw ? 'green' : 'red';
  }

  // Draw No Bet
  if (/DNB|DRAW_NO_BET/.test(m)) {
    if (/home|1/.test(s)) return isDraw ? 'void' : homeWin ? 'green' : 'red';
    if (/away|2/.test(s)) return isDraw ? 'void' : awayWin ? 'green' : 'red';
  }

  return null; // mercado não reconhecido → unknown
}

// Verifica se o mercado nunca pode ser resolvido via placar final (corners, cards, etc.)
function isUnresolvableMarket(market) {
  const m = (market || '').toUpperCase();
  return /CORNER|ESCANTEIO|CARD|CART|SHOT|CHUTE|FOUL|FALTA|OFFSIDE|IMPEDIMENTO|PLAYER_|JOGADOR|HT\b|HALF_TIME|1T\b|CORRECT_SCORE/.test(m);
}

// ── Core: resolve picks pendentes ────────────────────────────────────────
export async function resolvePremiumExposures(env) {
  if (!env.SB_DB) return { resolved: 0, error: 'no_db' };

  try {
    // Pega pendentes até 5 dias atrás
    const cutoff5d = Date.now() - 5 * 86400_000;
    const { results: pending } = await env.SB_DB.prepare(`
      SELECT id, pick_date, fixture_id, sport, home_team, away_team,
             market, selection, line, odd, result_status
      FROM premium_pick_exposures
      WHERE result_status = 'pending'
        AND shown_at >= ?
      ORDER BY pick_date DESC LIMIT 500
    `).bind(cutoff5d).all().catch(() => ({ results: [] }));

    if (!pending?.length) return { resolved: 0, pending: 0 };

    // Agrupa por data para fetch ESPN
    const dateMap = {};
    for (const p of pending) {
      const d = p.pick_date || new Date(p.shown_at).toISOString().slice(0, 10);
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push(p);
    }

    const scoresByDate = {};
    await Promise.allSettled(
      Object.keys(dateMap).map(async d => {
        scoresByDate[d] = await fetchScoresForDate(d).catch(() => ({}));
      })
    );

    let resolved = 0, voided = 0, unknown = 0;

    for (const pick of pending) {
      const d = pick.pick_date;
      const scoresMap = scoresByDate[d] || {};

      // Mercados que nunca podem ser resolvidos por placar → unknown
      if (isUnresolvableMarket(pick.market)) {
        const isOld = (Date.now() - new Date(d).getTime()) > 2 * 86400_000;
        if (isOld) {
          await env.SB_DB.prepare(`
            UPDATE premium_pick_exposures
            SET result_status = 'unknown', updated_at = datetime('now'), settled_at = ?
            WHERE id = ?
          `).bind(Date.now(), pick.id).run().catch(() => {});
          unknown++;
        }
        continue;
      }

      // Localiza placar do jogo
      const hN = normTeam(pick.home_team || '');
      const aN = normTeam(pick.away_team || '');
      const k1 = `${hN}|${aN}`;
      const k2 = `${aN}|${hN}`;
      let scores = scoresMap[k1] || null;
      let swapped = false;
      if (!scores && scoresMap[k2]) { scores = { home: scoresMap[k2].away, away: scoresMap[k2].home }; swapped = true; }

      // Fuzzy match (5 chars)
      if (!scores && hN && aN) {
        const p1 = hN.slice(0, 5), p2 = aN.slice(0, 5);
        for (const [k, v] of Object.entries(scoresMap)) {
          const [h2, a2] = k.split('|');
          if (h2.startsWith(p1) && a2.startsWith(p2)) { scores = v; break; }
          if (h2.startsWith(p2) && a2.startsWith(p1)) { scores = { home: v.away, away: v.home }; break; }
        }
      }

      if (!scores) {
        // Jogo não encontrado — se data antiga, marca unknown
        const isOld = (Date.now() - new Date(d).getTime()) > 2 * 86400_000;
        if (isOld) {
          await env.SB_DB.prepare(`
            UPDATE premium_pick_exposures
            SET result_status = 'unknown', updated_at = datetime('now'), settled_at = ?
            WHERE id = ?
          `).bind(Date.now(), pick.id).run().catch(() => {});
          unknown++;
        }
        continue;
      }

      // Resolve
      const verdict = resolveMarket(pick.market, pick.selection, pick.line, scores.home, scores.away);
      if (!verdict) {
        await env.SB_DB.prepare(`
          UPDATE premium_pick_exposures
          SET result_status = 'unknown', updated_at = datetime('now'), settled_at = ?
          WHERE id = ?
        `).bind(Date.now(), pick.id).run().catch(() => {});
        unknown++;
        continue;
      }

      const profit = calcProfit(verdict, pick.odd);
      await env.SB_DB.prepare(`
        UPDATE premium_pick_exposures
        SET result_status = ?, profit_unit = ?, settled_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(verdict, profit, Date.now(), pick.id).run().catch(() => {});

      if (verdict === 'green' || verdict === 'half_green') resolved++;
      else if (verdict === 'void') voided++;
      else resolved++;
    }

    return {
      resolved,
      voided,
      unknown,
      total_pending: pending.length,
    };
  } catch (e) {
    return { resolved: 0, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// P3.8.3.7 — Shadow Bet Result Resolver
// Reutiliza fetchScoresForDate + resolveMarket do resolver de exposures.
// Regras: green→profit positivo, red→negativo, void→0, unknown→nunca red.
// ═══════════════════════════════════════════════════════════════════════════
export async function resolveShadowBets(env) {
  if (!env.SB_DB) return { resolved: 0, error: 'no_db' };

  const debug = {
    pending_before:           0,
    attempted:                0,
    resolved_green:           0,
    resolved_red:             0,
    resolved_total:           0,
    voided:                   0,
    unknown:                  0,
    skipped_not_finished:     0,
    skipped_no_result_source: 0,
    skipped_no_market_match:  0,
    skipped_missing_fixture:  0,
    errors:                   0,
    pending_after:            0,
    resolved_valid_before:    0,
    resolved_valid_after:     0,
    remaining_to_micro_test:  0,
    can_micro_test:           false,
    duration_ms:              0,
    sample_resolved:          [],
    sample_skipped:           [],
  };
  const t0 = Date.now();

  try {
    const cutoff5d = Date.now() - 5 * 86400_000;
    const { results: pending } = await env.SB_DB.prepare(`
      SELECT id, pick_date, fixture_id, bet365_event_id, sport, home_team, away_team,
             market, selection, line, odd, stake_simulated
      FROM shadow_bets
      WHERE result_status = 'pending'
        AND created_at >= datetime(?/1000, 'unixepoch')
      ORDER BY pick_date DESC LIMIT 500
    `).bind(cutoff5d).all().catch(() => ({ results: [] }));

    debug.pending_before = pending?.length ?? 0;
    const rvBeforeRow = await env.SB_DB.prepare(
      `SELECT COUNT(*) as n FROM shadow_bets WHERE training_eligible=1 AND result_status IN ('green','red')`
    ).all().catch(() => ({ results: [{ n: 0 }] }));
    debug.resolved_valid_before = rvBeforeRow?.results?.[0]?.n ?? 0;

    if (!pending?.length) {
      debug.resolved_valid_after = debug.resolved_valid_before;
      debug.remaining_to_micro_test = Math.max(0, 30 - debug.resolved_valid_before);
      debug.can_micro_test = debug.resolved_valid_before >= 30;
      debug.duration_ms = Date.now() - t0;
      return { shadow_resolver_debug: debug };
    }

    // Group by date for ESPN fetch
    const dateMap = {};
    for (const p of pending) {
      if (!p.pick_date) continue;
      if (!dateMap[p.pick_date]) dateMap[p.pick_date] = [];
      dateMap[p.pick_date].push(p);
    }

    const scoresByDate = {};
    await Promise.allSettled(
      Object.keys(dateMap).map(async d => {
        scoresByDate[d] = await fetchScoresForDate(d).catch(() => ({}));
      })
    );

    for (const pick of pending) {
      debug.attempted++;
      const d = pick.pick_date;
      if (!d) {
        debug.skipped_no_result_source++;
        if (debug.sample_skipped.length < 3) debug.sample_skipped.push({ id: pick.id, reason: 'no_pick_date' });
        continue;
      }

      const scoresMap = scoresByDate[d] || {};

      // Missing fixture anchor: no team names to look up in scoresMap
      if (!pick.home_team && !pick.away_team) {
        debug.skipped_missing_fixture++;
        if (debug.sample_skipped.length < 3) debug.sample_skipped.push({ id: pick.id, reason: 'no_team_names', pick_date: d });
        continue;
      }

      // Markets that can never resolve by score → unknown after 2d
      if (isUnresolvableMarket(pick.market)) {
        const isOld = (Date.now() - new Date(d).getTime()) > 2 * 86400_000;
        if (!isOld) {
          debug.skipped_not_finished++;
          if (debug.sample_skipped.length < 3) debug.sample_skipped.push({ id: pick.id, reason: 'unresolvable_market_pending', market: pick.market, pick_date: d });
          continue;
        }
        await env.SB_DB.prepare(`
          UPDATE shadow_bets
          SET result_status='unknown', result_source='espn', result_confidence='unresolvable',
              settled_at=?, profit_unit=null, profit_brl=null
          WHERE id=?
        `).bind(Date.now(), pick.id).run().catch(() => {});
        debug.unknown++;
        continue;
      }

      // Locate match score
      const hN = normTeam(pick.home_team || '');
      const aN = normTeam(pick.away_team || '');
      let scores = scoresMap[`${hN}|${aN}`] || null;
      if (!scores && scoresMap[`${aN}|${hN}`]) {
        const s = scoresMap[`${aN}|${hN}`];
        scores = { home: s.away, away: s.home };
      }
      if (!scores && hN && aN) {
        const p1 = hN.slice(0, 5), p2 = aN.slice(0, 5);
        for (const [k, v] of Object.entries(scoresMap)) {
          const [h2, a2] = k.split('|');
          if (h2.startsWith(p1) && a2.startsWith(p2)) { scores = v; break; }
          if (h2.startsWith(p2) && a2.startsWith(p1)) { scores = { home: v.away, away: v.home }; break; }
        }
      }

      if (!scores) {
        const isOld = (Date.now() - new Date(d).getTime()) > 2 * 86400_000;
        if (!isOld) {
          debug.skipped_not_finished++;
          if (debug.sample_skipped.length < 3) debug.sample_skipped.push({ id: pick.id, reason: 'game_not_finished', pick_date: d, home: pick.home_team, away: pick.away_team });
          continue;
        }
        // Old and no score found → unknown (never red)
        await env.SB_DB.prepare(`
          UPDATE shadow_bets
          SET result_status='unknown', result_source='espn', result_confidence='no_score',
              settled_at=?, profit_unit=null, profit_brl=null
          WHERE id=?
        `).bind(Date.now(), pick.id).run().catch(() => {});
        debug.unknown++;
        continue;
      }

      const verdict = resolveMarket(pick.market, pick.selection, pick.line, scores.home, scores.away);
      if (!verdict) {
        // market not recognized or inconclusive → unknown (never red) + track as no_market_match
        debug.skipped_no_market_match++;
        await env.SB_DB.prepare(`
          UPDATE shadow_bets
          SET result_status='unknown', result_source='espn', result_confidence='unresolved',
              settled_at=?, profit_unit=null, profit_brl=null
          WHERE id=?
        `).bind(Date.now(), pick.id).run().catch(() => {});
        debug.unknown++;
        if (debug.sample_skipped.length < 3) debug.sample_skipped.push({ id: pick.id, reason: 'no_market_match', market: pick.market, selection: pick.selection, pick_date: d });
        continue;
      }

      const stake = pick.stake_simulated ?? 0.50;
      const profitUnit = calcProfit(verdict, pick.odd);
      const profitBrl  = profitUnit !== null ? +(profitUnit * stake).toFixed(4) : null;

      await env.SB_DB.prepare(`
        UPDATE shadow_bets
        SET result_status=?, result_source='espn', result_confidence='high',
            profit_unit=?, profit_brl=?, settled_at=?
        WHERE id=?
      `).bind(verdict, profitUnit, profitBrl, Date.now(), pick.id).run().catch(() => { debug.errors++; });

      if (verdict === 'green' || verdict === 'half_green') {
        debug.resolved_green++;
        if (debug.sample_resolved.length < 3) debug.sample_resolved.push({ id: pick.id, verdict, pick_date: d, home: pick.home_team, away: pick.away_team, market: pick.market, odd: pick.odd, profit_brl: profitBrl });
      } else if (verdict === 'red' || verdict === 'half_red') {
        debug.resolved_red++;
        if (debug.sample_resolved.length < 3) debug.sample_resolved.push({ id: pick.id, verdict, pick_date: d, home: pick.home_team, away: pick.away_team, market: pick.market, odd: pick.odd, profit_brl: profitBrl });
      } else if (verdict === 'void') {
        debug.voided++;
        if (debug.sample_resolved.length < 3) debug.sample_resolved.push({ id: pick.id, verdict, pick_date: d, home: pick.home_team, away: pick.away_team, market: pick.market });
      }
    }

    // Count remaining pending + resolved_valid after
    const [afterRows, rvAfterRow] = await Promise.all([
      env.SB_DB.prepare(`SELECT COUNT(*) as n FROM shadow_bets WHERE result_status='pending'`)
        .all().catch(() => ({ results: [{ n: 0 }] })),
      env.SB_DB.prepare(`SELECT COUNT(*) as n FROM shadow_bets WHERE training_eligible=1 AND result_status IN ('green','red')`)
        .all().catch(() => ({ results: [{ n: 0 }] })),
    ]);
    debug.pending_after = afterRows?.results?.[0]?.n ?? 0;
    debug.resolved_total = debug.resolved_green + debug.resolved_red;
    debug.resolved_valid_after = rvAfterRow?.results?.[0]?.n ?? 0;
    debug.remaining_to_micro_test = Math.max(0, 30 - debug.resolved_valid_after);
    debug.can_micro_test = debug.resolved_valid_after >= 30;

  } catch (e) {
    debug.errors++;
    debug.error = e.message;
  }

  debug.duration_ms = Date.now() - t0;
  return { shadow_resolver_debug: debug };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/premium/validation — dashboard completo
// ═══════════════════════════════════════════════════════════════════════════
export async function handlePremiumValidation(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    });
  }

  const url  = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 90);
  const cutoff = Date.now() - days * 86400_000;

  try {
    // Busca todas as picks do período (inclui colunas de audit P3.3)
    const { results: rows } = await env.SB_DB.prepare(`
      SELECT
        id, pick_date, shown_at, sport, league, home_team, away_team,
        market, selection, line, odd, bookmaker,
        tier, premium_quality_score, premium_tier_quality,
        value_bet_level, desajuste_level, ev_pct,
        is_combo, combo_id, source,
        has_steam, steam_strength, is_devig,
        result_status, profit_unit, settled_at,
        pick_audit_status, trust_level, source_family,
        golden_audit_status, resolvability_status,
        audit_reasons_json
      FROM premium_pick_exposures
      WHERE shown_at >= ?
      ORDER BY shown_at DESC
    `).bind(cutoff).all().catch(() => ({ results: [] }));

    const allRows = rows || [];

    if (allRows.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        note: 'Sem picks registradas ainda. Acesse /v1/picks/premium para gerar as primeiras.',
        days,
        monetization_readiness: evaluateMonetizationReadiness({ unknown_pct: 100 }, [], []),
      }), { status: 200, headers: corsHeaders({ 'Cache-Control': 'no-store' }) });
    }

    // ── Dimensões de análise ─────────────────────────────────────────────
    const singles = allRows.filter(r => r.tier === 'single' || (!r.is_combo && r.tier !== 'combo' && r.tier !== 'jackpot'));
    const combos  = allRows.filter(r => r.tier === 'combo');
    const jackpot = allRows.filter(r => r.tier === 'jackpot');

    // Por tier de qualidade (singles only para decisão principal)
    const byQuality = groupBy(singles, 'premium_tier_quality', t => {
      const labels = { elite: '⭐ Elite', strong: '💪 Strong', playable: '📊 Playable', watchlist: '👀 Watchlist' };
      return labels[t] || t;
    });

    // Por tipo (single / combo / jackpot)
    const byType = groupBy(allRows, 'tier', t => {
      const l = { single: 'Singles', combo: 'Combos', jackpot: 'Jackpot' };
      return l[t] || t;
    });

    // Por badge
    const withBadge = allRows.map(r => ({ ...r, _badge: badgeLabel(r) }));
    const byBadge = groupBy(withBadge, '_badge');

    // Por mercado
    const withMarket = allRows.map(r => ({ ...r, _mkt_label: marketLabel(r.market) }));
    const byMarket = groupBy(withMarket, '_mkt_label');

    // Por fonte
    const withSource = allRows.map(r => ({ ...r, _src_label: sourceLabel(r.source) }));
    const bySource = groupBy(withSource, '_src_label');

    // Por esporte
    const bySport = groupBy(allRows, 'sport');

    // Por desajuste
    const byDesajuste = groupBy(
      allRows.filter(r => r.desajuste_level),
      'desajuste_level',
      d => ({ premium: '⚡ Desajustada Premium', forte: '⚡ Desajustada Forte', leve: '⚡ Desajuste Leve' }[d] || d)
    );

    // Por value_bet_level
    const byValue = groupBy(
      allRows.filter(r => r.value_bet_level && r.value_bet_level !== 'none'),
      'value_bet_level',
      v => ({ strong_value: '💰 Strong Value', value: '💰 Value Bet', watch: '👀 Watch' }[v] || v)
    );

    // PQS validation: picks PQS alto (≥60) vs baixo (<40) — são diferentes?
    const highPQS = singles.filter(r => r.premium_quality_score != null && r.premium_quality_score >= 60);
    const midPQS  = singles.filter(r => r.premium_quality_score != null && r.premium_quality_score >= 40 && r.premium_quality_score < 60);
    const lowPQS  = singles.filter(r => r.premium_quality_score != null && r.premium_quality_score < 40);
    const pqsValidation = {
      high_pqs_60plus: buildStats(highPQS),
      mid_pqs_40_60:   buildStats(midPQS),
      low_pqs_under40: buildStats(lowPQS),
      pqs_predicts_quality: (() => {
        const hROI = buildStats(highPQS).roi_pct;
        const lROI = buildStats(lowPQS).roi_pct;
        if (hROI === null || lROI === null) return null;
        return hROI > lROI;
      })(),
    };

    // Greens recentes (últimos 7 dias)
    const last7Cutoff = Date.now() - 7 * 86400_000;
    const recentGreens = allRows
      .filter(r => r.result_status === 'green' && (r.settled_at || 0) >= last7Cutoff)
      .sort((a, b) => (b.settled_at || 0) - (a.settled_at || 0))
      .slice(0, 20)
      .map(r => ({
        id: r.id,
        pick_date: r.pick_date,
        match: `${r.home_team || ''} vs ${r.away_team || ''}`,
        market: r.market,
        selection: r.selection,
        odd: r.odd,
        profit_unit: r.profit_unit,
        tier: r.premium_tier_quality,
        source: r.source,
      }));

    // Stats gerais
    const overallStats  = buildStats(allRows);
    const singlesStats  = buildStats(singles);

    // ── P3.3: Por audit_status ─────────────────────────────────────────────
    // Segrega ROI por status de auditoria. Rows sem pick_audit_status = legacy.
    const byAuditStatus = groupBy(
      allRows.map(r => ({ ...r, _audit_key: r.pick_audit_status || 'legacy_unknown' })),
      '_audit_key',
      s => ({ valid: '✅ Valid', observation: '👁 Observação', 'observation-forte': '👁 Observação Forte', hidden: '🚫 Hidden', blocked: '❌ Bloqueado', legacy_unknown: '⬜ Legacy (sem audit)' }[s] || s)
    );

    // ── P3.3: Por trust_level ──────────────────────────────────────────────
    const byTrustLevel = groupBy(
      allRows.map(r => ({ ...r, _tl_key: r.trust_level || 'legacy_unknown' })),
      '_tl_key',
      t => ({ verified: '✅ Verificado', supported: '🟢 Suportado', partial: '🟡 Parcial', weak: '🟠 Fraco', blocked: '❌ Bloqueado', legacy_unknown: '⬜ Legacy' }[t] || t)
    );

    // ── P3.3: Por source_family ────────────────────────────────────────────
    const bySourceFamily = groupBy(
      allRows.filter(r => r.source_family).map(r => ({ ...r, _sf_key: r.source_family })),
      '_sf_key',
      f => ({ single: 'Single', result_btts: 'Result + BTTS', golden: '✨ Golden', jackpot: 'Jackpot', mega: '🎰 Mega', ht: 'HT Method', shots: 'Chutes', bingo: 'Bingo' }[f] || f)
    );

    // ── P3.3: Golden validation performance ───────────────────────────────
    const goldenRows = allRows.filter(r => r.source_family === 'golden' || r.golden_audit_status != null);
    const goldenValid = goldenRows.filter(r => r.pick_audit_status === 'valid');
    const goldenObs   = goldenRows.filter(r => r.pick_audit_status === 'observation' || r.pick_audit_status === 'observation-forte');
    const goldenValidStats = buildStats(goldenValid);
    const goldenObsStats   = buildStats(goldenObs);
    const goldenValidation = {
      total:       goldenRows.length,
      valid:       { count: goldenValid.length, ...goldenValidStats },
      observation: { count: goldenObs.length,   ...goldenObsStats   },
      comparison: {
        valid_roi:          goldenValidStats.roi_pct,
        observation_roi:    goldenObsStats.roi_pct,
        valid_outperforms:  goldenValidStats.roi_pct != null && goldenObsStats.roi_pct != null
                              ? goldenValidStats.roi_pct > goldenObsStats.roi_pct : null,
      },
    };

    // ── P3.3: ML model learning debug ─────────────────────────────────────
    // shouldTrainMainModel: valid + verified/supported + resolved + resolvable
    const trainable = allRows.filter(r =>
      r.pick_audit_status === 'valid' &&
      ['verified', 'supported'].includes(r.trust_level) &&
      ['green', 'red', 'void'].includes(r.result_status) &&
      r.resolvability_status === 'resolvable'
    );
    const modelLearningDebug = {
      trainable_count:            trainable.length,
      trainable_stats:            buildStats(trainable),
      excluded_legacy_unknown:    allRows.filter(r => r.pick_audit_status == null).length,
      excluded_by_audit_status:   allRows.filter(r => r.pick_audit_status != null && r.pick_audit_status !== 'valid').length,
      excluded_by_trust_level:    allRows.filter(r => r.pick_audit_status === 'valid' && !['verified', 'supported'].includes(r.trust_level)).length,
      excluded_pending_result:    allRows.filter(r => !['green', 'red', 'void'].includes(r.result_status)).length,
      excluded_unresolvable:      allRows.filter(r => ['green', 'red', 'void'].includes(r.result_status) && r.resolvability_status === 'unresolvable').length,
      // P3.5: market unavailable exclusion (detected via audit_reasons_json)
      excluded_market_unavailable: allRows.filter(r => {
        try { return (JSON.parse(r.audit_reasons_json || '[]')).includes('market_not_found_in_availability'); }
        catch (_) { return false; }
      }).length,
      shouldTrainMainModel_criteria: 'valid + (verified|supported) + (green|red|void) + resolvable + market_available != false',
    };

    // ── P3.3: Valid-only singles (para monetization_readiness confiável) ──
    const validSingles = singles.filter(r =>
      r.pick_audit_status === 'valid' &&
      ['verified', 'supported'].includes(r.trust_level)
    );
    const hasEnoughValidData = validSingles.length >= 10;
    const validSinglesStats = buildStats(validSingles);

    // Monetization readiness — usa valid-only quando há dados suficientes
    const monetizationReadiness = evaluateMonetizationReadiness(
      hasEnoughValidData ? validSinglesStats : overallStats,
      byQuality,
      hasEnoughValidData
        ? [{ group: 'single', ...validSinglesStats }]
        : byType
    );

    // result_source breakdown — mostra qual fonte resolveu mais picks
    const sourceRows = await env.SB_DB.prepare(`
      SELECT
        result_source,
        result,
        count(*) as n
      FROM pick_history
      WHERE result IS NOT NULL AND result IN ('W','L','V')
        AND saved_at >= ?
      GROUP BY result_source, result
      ORDER BY n DESC
    `).bind(Date.now() - 30 * 86_400_000).all().catch(() => ({ results: [] }));

    const bySourceDB = {};
    for (const r of (sourceRows.results || [])) {
      const src = r.result_source || 'unknown';
      if (!bySourceDB[src]) bySourceDB[src] = { source: src, W: 0, L: 0, V: 0, total: 0 };
      bySourceDB[src][r.result] = (bySourceDB[src][r.result] || 0) + r.n;
      bySourceDB[src].total += r.n;
    }

    const resultSourceBreakdown = Object.values(bySourceDB)
      .sort((a, b) => b.total - a.total)
      .map(s => ({
        source:   s.source,
        total:    s.total,
        wins:     s.W || 0,
        losses:   s.L || 0,
        voids:    s.V || 0,
        win_rate: s.total > 0 ? +((s.W || 0) / Math.max(1, s.total - (s.V || 0)) * 100).toFixed(1) : null,
      }));

    return new Response(JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      period_days: days,
      disclaimer: 'Performance passada não garante resultado futuro. Apostas envolvem risco.',

      // ── Scorecard principal ────────────────────────────────────────────
      monetization_readiness: {
        ...monetizationReadiness,
        data_basis: hasEnoughValidData
          ? `valid-only (${validSingles.length} picks auditadas com trust verified/supported)`
          : `all picks — sem dados válidos suficientes (${validSingles.length} válidas, mín 10)`,
      },

      // ── Stats gerais ───────────────────────────────────────────────────
      overall: overallStats,
      singles: singlesStats,
      combos:  buildStats(combos),
      jackpots: buildStats(jackpot),

      // ── P3.3 — Valid-only stats ────────────────────────────────────────
      valid_only: {
        singles_count: validSingles.length,
        has_enough_data: hasEnoughValidData,
        stats: validSinglesStats,
      },

      // ── Por dimensão ──────────────────────────────────────────────────
      by_quality:   byQuality,
      by_type:      byType,
      by_badge:     byBadge,
      by_market:    byMarket,
      by_source:    bySource,
      by_sport:     bySport,
      by_desajuste: byDesajuste,
      by_value_bet: byValue,

      // ── P3.3 — Por audit dimensions ───────────────────────────────────
      by_audit_status:  byAuditStatus,
      by_trust_level:   byTrustLevel,
      by_source_family: bySourceFamily,

      // ── P3.3 — Golden validation ──────────────────────────────────────
      golden_validation: goldenValidation,

      // ── P3.3 — ML model learning debug ────────────────────────────────
      model_learning_debug: modelLearningDebug,

      // ── Validação do PQS ──────────────────────────────────────────────
      pqs_validation: pqsValidation,

      // ── Greens recentes ───────────────────────────────────────────────
      recent_greens: recentGreens,
      recent_greens_count: recentGreens.length,

      // ── Breakdown por fonte de resultado ─────────────────────────────
      result_source_breakdown: resultSourceBreakdown,
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'no-store' }),
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/premium/proof — social proof (sem inflar dados)
// ═══════════════════════════════════════════════════════════════════════════
export async function handlePremiumProof(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    });
  }

  try {
    const now = Date.now();
    const cut7  = now - 7  * 86400_000;
    const cut30 = now - 30 * 86400_000;

    // Só singles resolvidos como GREEN real
    const { results: singles7 } = await env.SB_DB.prepare(`
      SELECT odd, profit_unit, pick_date, market, premium_tier_quality, source, home_team, away_team, selection
      FROM premium_pick_exposures
      WHERE result_status = 'green' AND tier = 'single' AND settled_at >= ?
      ORDER BY odd DESC
    `).bind(cut7).all().catch(() => ({ results: [] }));

    const { results: all30 } = await env.SB_DB.prepare(`
      SELECT result_status, profit_unit, tier, odd
      FROM premium_pick_exposures
      WHERE settled_at >= ?
        AND result_status IN ('green','red','void','half_green','half_red')
        AND tier = 'single'
    `).bind(cut30).all().catch(() => ({ results: [] }));

    const stats7  = buildStats(singles7.map(r => ({ ...r, result_status: 'green' })));
    const stats30 = buildStats(all30 || []);

    // Melhor odd green
    const bestGreen = (singles7 || [])
      .filter(r => r.odd)
      .sort((a, b) => b.odd - a.odd)[0] || null;

    // Top mercados por win rate (mín 5 resolvidos)
    const mktMap = {};
    for (const r of all30 || []) {
      const mk = marketLabel(r.market || '');
      if (!mktMap[mk]) mktMap[mk] = [];
      mktMap[mk].push(r);
    }
    const topMarkets = Object.entries(mktMap)
      .map(([label, rows]) => ({ market: label, ...buildStats(rows) }))
      .filter(m => m.resolved >= 5)
      .sort((a, b) => (b.roi_pct || -99) - (a.roi_pct || -99))
      .slice(0, 3);

    // Últimos greens para print/Telegram (máx 5)
    const lastGreens = (singles7 || []).slice(0, 5).map(r => ({
      match:     `${r.home_team || '?'} vs ${r.away_team || '?'}`,
      market:    r.market,
      selection: r.selection,
      odd:       r.odd,
      profit:    `+${r.profit_unit?.toFixed(2) || '?'} un`,
      date:      r.pick_date,
      tier:      r.premium_tier_quality,
    }));

    // Print-ready Telegram
    const telegramSummary = lastGreens.length > 0
      ? [
          '✅ *Últimos Greens SportsBrain Premium*',
          '',
          ...lastGreens.map((g, i) => `${i+1}. ${g.match} — ${g.market} @ ${g.odd} ${g.profit}`),
          '',
          `📊 ROI 7d: ${stats7.roi_pct != null ? `+${stats7.roi_pct}%` : 'calculando...'}`,
          `📊 ROI 30d: ${stats30.roi_pct != null ? `${stats30.roi_pct > 0 ? '+' : ''}${stats30.roi_pct}%` : 'calculando...'}`,
          `🎯 ${stats30.total_picks} picks registradas | ${stats30.greens} greens | Win Rate ${stats30.win_rate_pct || '?'}%`,
          '',
          '⚠️ Performance passada não garante resultados futuros. Jogue com responsabilidade.',
        ].join('\n')
      : 'Ainda sem greens suficientes para prova social. Continue acompanhando.';

    return new Response(JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      disclaimer: 'Apenas greens REAIS resolvidos via ESPN. Sem picks pendentes ou estimadas.',

      // ── Dados para /vip ────────────────────────────────────────────────
      last_greens:          lastGreens,
      roi_7d:               stats7.roi_pct,
      roi_30d:              stats30.roi_pct,
      win_rate_7d:          stats7.win_rate_pct,
      win_rate_30d:         stats30.win_rate_pct,
      picks_resolved_30d:   stats30.resolved,
      picks_total_30d:      stats30.total_picks,
      greens_count_7d:      singles7?.length || 0,
      best_odd_green:       bestGreen?.odd || null,
      best_green_match:     bestGreen ? `${bestGreen.home_team} vs ${bestGreen.away_team}` : null,
      top_markets:          topMarkets,
      profit_units_30d:     stats30.profit_units,
      avg_odd_30d:          stats30.avg_odd,

      // ── Conteúdo Telegram-ready ────────────────────────────────────────
      telegram_summary: telegramSummary,

      // ── Alerta de fase ────────────────────────────────────────────────
      phase_note: stats30.resolved < 50
        ? `Fase de validação: ${stats30.resolved}/50 picks mínimas resolvidas. Dados parciais.`
        : null,
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'public, max-age=300' }),
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: corsHeaders(),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /internal/resolve-premium — força resolução (para cron + trigger manual)
// ═══════════════════════════════════════════════════════════════════════════
export async function handleResolvePremium(request, env) {
  const result = await resolvePremiumExposures(env);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200, headers: corsHeaders(),
  });
}
