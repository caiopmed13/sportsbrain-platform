/**
 * Parlay Pricing Route — SportsBrain
 * ───────────────────────────────────
 * POST /v1/parlay/price
 * Body: { legs: [{ prob: 0.45, odds: 2.20, match?: "home-away", league?: "...",
 *                  market?: "resultado"|"btts"|"over25"|"resultado_btts"|... }] }
 *
 * Ou via GET:
 *   GET /v1/parlay/price?legs=0.45:2.20:match1:resultado,0.32:3.10:match2:btts
 *
 * Calcula:
 *   • Prob composta independente (naïve)
 *   • Prob composta ajustada por CORRELAÇÃO entre pernas
 *   • EV real (vs odds oferecida)
 *   • Kelly fraction recomendado
 *   • Warnings estruturados
 *
 * Regras de correlação (derivadas empiricamente):
 *   • Mesmo match, mercados diferentes → correlação forte
 *     - resultado(home) × btts → negativa (vitória dominante tende 1-0, 2-0)
 *     - resultado(away) × btts → negativa idem
 *     - resultado(empate) × btts → positiva (empate com gols)
 *     - over25 × btts → correlação POSITIVA forte (~0.6)
 *   • Mesmo dia, mesma liga → correlação leve (~0.05)
 *   • Independentes → 0
 */

import { sbResponse, sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';

// ═══════════════════════════════════════════════════════════════════════════
// Tabela de correlações intra-match (pearson aproximado derivado de FDco 2020-25)
// ═══════════════════════════════════════════════════════════════════════════
const INTRA_MATCH_CORR = {
  'resultado_home|btts':         -0.25,
  'resultado_away|btts':         -0.20,
  'resultado_draw|btts':          0.35,
  'resultado_home|over25':        0.30,
  'resultado_away|over25':        0.28,
  'resultado_draw|over25':        0.10,
  'btts|over25':                  0.62,
  'resultado_home|under25':      -0.25,
  'resultado_away|under25':      -0.24,
  // resultado_btts é um mercado combinado — se usuário manda separado por engano,
  // tratamos como conflito total
  'resultado_btts|resultado':     0.95,
  'resultado_btts|btts':          0.70,
  'resultado_btts|over25':        0.55,
};

function normMarket(m) {
  const s = (m || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (/^resultado_(home|draw|away|empate|casa|fora)/.test(s)) return s
    .replace('empate','draw').replace('casa','home').replace('fora','away');
  if (s === 'btts' || s === 'ambas' || s === 'ambas_marcam') return 'btts';
  if (s === 'over25' || s === 'mais_25') return 'over25';
  if (s === 'under25' || s === 'menos_25') return 'under25';
  if (s.includes('resultado') && s.includes('btts')) return 'resultado_btts';
  return s || 'unknown';
}

function corrBetween(marketA, marketB) {
  const a = normMarket(marketA), b = normMarket(marketB);
  if (a === b) return 1;
  const k1 = `${a}|${b}`, k2 = `${b}|${a}`;
  if (INTRA_MATCH_CORR[k1] != null) return INTRA_MATCH_CORR[k1];
  if (INTRA_MATCH_CORR[k2] != null) return INTRA_MATCH_CORR[k2];
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cópula bivariada simples: P(A ∩ B) ajustada por ρ
// Fórmula aproximada: P(A∩B) ≈ P(A)P(B) + ρ·√(P(A)(1-P(A))·P(B)(1-P(B)))
// Clamp [max(0, P(A)+P(B)-1), min(P(A),P(B))] (Fréchet bounds)
// ═══════════════════════════════════════════════════════════════════════════
function jointProb(pA, pB, rho) {
  const base = pA * pB;
  const adj = rho * Math.sqrt(Math.max(0, pA * (1 - pA)) * Math.max(0, pB * (1 - pB)));
  const raw = base + adj;
  const upper = Math.min(pA, pB);
  const lower = Math.max(0, pA + pB - 1);
  return Math.max(lower, Math.min(upper, raw));
}

// Agrupa pernas por match para aplicar correlação apenas dentro do mesmo jogo
function groupByMatch(legs) {
  const groups = new Map();
  for (const l of legs) {
    const key = l.match || `__solo_${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return groups;
}

// Prob conjunta dentro de um grupo (mesmo match): aplica correlação par-a-par
// Heurística: reduz para produto dos ajustes sequenciais
function groupJointProb(legs) {
  if (legs.length === 1) return legs[0].prob;
  let p = legs[0].prob;
  for (let i = 1; i < legs.length; i++) {
    // ρ médio entre a perna atual e cada anterior
    let rhoSum = 0;
    for (let j = 0; j < i; j++) rhoSum += corrBetween(legs[j].market, legs[i].market);
    const rhoAvg = rhoSum / i;
    p = jointProb(p, legs[i].prob, rhoAvg);
  }
  return p;
}

function impliedProb(odds) {
  if (!odds || odds <= 1) return 1;
  return 1 / odds;
}

function evaluateParlay(legs) {
  if (!legs.length) return null;

  // 1) Prob composta IGNORANDO correlação (naïve, do usuário típico)
  const pNaive = legs.reduce((acc, l) => acc * l.prob, 1);

  // 2) Prob composta COM correlação intra-match
  const groups = groupByMatch(legs);
  let pAdjusted = 1;
  const groupBreakdown = [];
  for (const [matchKey, group] of groups.entries()) {
    const pGroup = groupJointProb(group);
    pAdjusted *= pGroup;
    groupBreakdown.push({
      match: matchKey,
      legs: group.length,
      marketJoint: pGroup,
      marketsInvolved: group.map(g => normMarket(g.market)),
    });
  }

  // 3) Prob composta COM correlação intra-match × correlação leve entre jogos mesmo dia
  const uniqueLeagues = new Set(legs.map(l => (l.league || '').toLowerCase()).filter(Boolean));
  const sameLeagueSameDay = uniqueLeagues.size === 1 && legs.length >= 3;
  const pAdjustedWithDay = sameLeagueSameDay ? pAdjusted * Math.pow(0.97, legs.length - 2) : pAdjusted;

  // 4) Odds combinadas
  const combinedOdds = legs.reduce((acc, l) => acc * (l.odds || 0), 1);
  const impliedCombined = combinedOdds > 0 ? 1 / combinedOdds : 0;

  // 5) EV
  const evNaive    = pNaive    * combinedOdds - 1;
  const evAdjusted = pAdjustedWithDay * combinedOdds - 1;

  // 6) Kelly (apenas se EV > 0)
  // f* = (p*b - q) / b, onde b = odds - 1
  let kelly = 0;
  if (evAdjusted > 0 && combinedOdds > 1) {
    const b = combinedOdds - 1;
    kelly = (pAdjustedWithDay * b - (1 - pAdjustedWithDay)) / b;
    kelly = Math.max(0, Math.min(0.05, kelly));   // cap 5% bankroll
  }

  // 7) Warnings
  const warnings = [];
  if (legs.length >= 5) warnings.push({
    level: 'high', code: 'HIGH_LEG_COUNT',
    message: `Múltipla de ${legs.length} pernas: probabilidade composta ≈ ${(pAdjustedWithDay * 100).toFixed(3)}%. Variância extrema, não alocar >0.5% do bankroll.`,
  });
  if (pNaive / Math.max(pAdjustedWithDay, 1e-9) > 1.15) warnings.push({
    level: 'high', code: 'CORRELATION_OVERESTIMATES',
    message: `Correlação entre mercados reduz prob real em ${((1 - pAdjustedWithDay / pNaive) * 100).toFixed(1)}% vs o cálculo ingênuo. Book já precifica isso.`,
  });
  if (evAdjusted < 0) warnings.push({
    level: 'high', code: 'NEGATIVE_EV',
    message: `EV ajustado = ${(evAdjusted * 100).toFixed(1)}%. Esta aposta é perdedora estatisticamente no longo prazo.`,
  });
  // Conflitos explícitos: mesmo match com "resultado_home" E "resultado_away" = impossível
  for (const [matchKey, group] of groups.entries()) {
    const mkts = group.map(g => normMarket(g.market));
    const hasHome = mkts.includes('resultado_home');
    const hasDraw = mkts.includes('resultado_draw');
    const hasAway = mkts.includes('resultado_away');
    if ([hasHome, hasDraw, hasAway].filter(Boolean).length >= 2) {
      warnings.push({
        level: 'critical', code: 'CONTRADICTION',
        message: `Match "${matchKey}" tem resultados mutuamente exclusivos selecionados — impossível ambas acertarem.`,
      });
    }
  }
  if (sameLeagueSameDay) warnings.push({
    level: 'medium', code: 'SAME_LEAGUE_CONCENTRATION',
    message: `${legs.length} pernas todas da mesma liga: exposição concentrada a um único cenário macro (árbitro, clima regional, rodada fraca). Diversifique entre ligas.`,
  });

  return {
    legs: legs.length,
    combined_odds: +combinedOdds.toFixed(2),
    implied_prob_book: +(impliedCombined * 100).toFixed(3),
    prob_naive: +(pNaive * 100).toFixed(3),
    prob_adjusted: +(pAdjustedWithDay * 100).toFixed(3),
    correlation_penalty_pct: +((1 - pAdjustedWithDay / pNaive) * 100).toFixed(1),
    ev_naive_pct: +(evNaive * 100).toFixed(1),
    ev_adjusted_pct: +(evAdjusted * 100).toFixed(1),
    kelly_fraction: +kelly.toFixed(4),
    kelly_stake_hint: kelly > 0
      ? `Aposte no máximo ${(kelly * 100).toFixed(2)}% do bankroll (Kelly fractional).`
      : 'Kelly = 0 → não apostar (EV negativo ou correlação destrói edge).',
    group_breakdown: groupBreakdown,
    warnings,
    verdict: evAdjusted > 0.03
      ? '✅ APOSTA +EV mesmo após correlação. Considere stake Kelly fractional.'
      : evAdjusted > -0.02
        ? '⚖️ NEUTRO — EV próximo de zero. Entretenimento, não investimento.'
        : '🔴 EVITAR — EV negativo após correlação. Book já precificou tudo.',
    model_version: 'parlay-v1',
  };
}

// Parse GET query format: "0.45:2.20:match1:resultado_home,0.32:3.10:match1:btts"
function parseLegsFromQuery(str) {
  return (str || '').split(',').map(part => {
    const [p, o, m, mkt, lg] = part.split(':');
    return {
      prob: parseFloat(p) || 0,
      odds: parseFloat(o) || 0,
      match: m || null,
      market: mkt || 'unknown',
      league: lg || null,
    };
  }).filter(l => l.prob > 0 && l.odds > 0);
}

export async function handleParlay(pathname, request) {
  const url = new URL(request.url);

  if (pathname !== '/v1/parlay/price') {
    return new Response(JSON.stringify(sbError('NOT_FOUND', `Unknown parlay route ${pathname}`, 404)),
      { status: 404, headers: corsHeaders() });
  }

  let legs = [];
  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      legs = Array.isArray(body.legs) ? body.legs : [];
    } else {
      const qLegs = url.searchParams.get('legs');
      if (qLegs) legs = parseLegsFromQuery(qLegs);
    }
  } catch (err) {
    return new Response(JSON.stringify(sbError('BAD_REQUEST', `Parse error: ${err.message}`, 400)),
      { status: 400, headers: corsHeaders() });
  }

  // Validação
  legs = legs.filter(l => l && l.prob > 0 && l.prob <= 1 && l.odds > 1);
  if (!legs.length) {
    return new Response(JSON.stringify(sbError('BAD_REQUEST',
      'Provide at least one leg: { legs: [{ prob: 0.45, odds: 2.20, match: "home-away", market: "resultado_home" }] }', 400)),
      { status: 400, headers: corsHeaders() });
  }
  if (legs.length > 15) {
    return new Response(JSON.stringify(sbError('TOO_MANY_LEGS', 'Max 15 legs per parlay', 400)),
      { status: 400, headers: corsHeaders() });
  }

  const result = evaluateParlay(legs);
  return new Response(JSON.stringify(sbResponse({ data: result })), {
    status: 200,
    headers: { ...corsHeaders(), 'Cache-Control': 'no-store' },
  });
}
