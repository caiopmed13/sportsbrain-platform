/**
 * Briefing Route — SportsBrain Data API v1
 * ─────────────────────────────────────────
 * Endpoint unificado "tudo em um" — produto vendável principal.
 *
 *   GET /v1/briefing/:home/:away?league=&date=
 *
 * Agrega numa única chamada: fixtures + team stats + Poisson 1X2 +
 * BTTS + narrativa textual + metadados do modelo.
 *
 * Este é o diferencial do SportsBrain API vs concorrentes —
 * ninguém no tier sub-$500/mês entrega briefing empacotado.
 */

import { sbResponse, sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';

// ═══════════════════════════════════════════════════════════════════════════
// Poisson 1X2 (versão edge, sem dependências)
// ═══════════════════════════════════════════════════════════════════════════
function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

// Cup pedigree (resumo — versão completa fica no front)
const CUP_PEDIGREE = {
  'copa do brasil': {
    'cruzeiro': 1.12, 'gremio': 1.11, 'flamengo': 1.11, 'palmeiras': 1.10,
    'corinthians': 1.09, 'atletico-mg': 1.09, 'fluminense': 1.08, 'santos': 1.07,
  },
  'copa libertadores': {
    'boca juniors': 1.14, 'independiente': 1.12, 'river plate': 1.12,
    'palmeiras': 1.12, 'flamengo': 1.12, 'santos': 1.10, 'gremio': 1.09,
    'sao paulo': 1.08, 'internacional': 1.08,
  },
  'champions league': {
    'real madrid': 1.15, 'milan': 1.11, 'liverpool': 1.10, 'bayern munich': 1.10,
    'barcelona': 1.10, 'manchester united': 1.09, 'chelsea': 1.07,
  },
};

function cupPedigreeMult(team, league) {
  if (!league) return 1;
  const lgKey = (league || '').toLowerCase();
  const teamKey = (team || '').toLowerCase().replace(/-/g, ' ').trim();
  for (const [cup, teams] of Object.entries(CUP_PEDIGREE)) {
    if (lgKey.includes(cup)) {
      for (const [tk, mult] of Object.entries(teams)) {
        if (teamKey.includes(tk)) return mult;
      }
    }
  }
  return 1;
}

const LEAGUE_GOALS = {
  'brasileirão':      { total: 2.20, homeShare: 0.58 },
  'brasileirao':      { total: 2.20, homeShare: 0.58 },
  'premier league':   { total: 2.56, homeShare: 0.56 },
  'la liga':          { total: 2.36, homeShare: 0.55 },
  'serie a':          { total: 2.52, homeShare: 0.55 },
  'bundesliga':       { total: 2.84, homeShare: 0.56 },
  'ligue 1':          { total: 2.38, homeShare: 0.54 },
  'champions league': { total: 2.70, homeShare: 0.53 },
  'copa libertadores':{ total: 2.10, homeShare: 0.58 },
  'copa do brasil':   { total: 2.04, homeShare: 0.58 },
  'default':          { total: 2.30, homeShare: 0.55 },
};

function lgGoals(league) {
  const k = (league || '').toLowerCase();
  for (const [key, v] of Object.entries(LEAGUE_GOALS)) {
    if (key !== 'default' && k.includes(key)) return v;
  }
  return LEAGUE_GOALS.default;
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ═══════════════════════════════════════════════════════════════════════════
// Computa Poisson 1X2 + BTTS a partir de team stats básicos
// ═══════════════════════════════════════════════════════════════════════════
function computePoisson(home, away, league, hStats, aStats) {
  const lg = lgGoals(league);
  const lgHome = lg.total * lg.homeShare;
  const lgAway = lg.total * (1 - lg.homeShare);

  const hGF = hStats?.goals_for || null;
  const hGA = hStats?.goals_against || null;
  const aGF = aStats?.goals_for || null;
  const aGA = aStats?.goals_against || null;

  const homeAttack  = hGF != null ? clamp(hGF / lgHome, 0.55, 1.75) : 1;
  const homeDefense = hGA != null ? clamp(hGA / lgAway, 0.55, 1.75) : 1;
  const awayAttack  = aGF != null ? clamp(aGF / lgAway, 0.55, 1.75) : 1;
  const awayDefense = aGA != null ? clamp(aGA / lgHome, 0.55, 1.75) : 1;

  const homeAdv = 1.15;  // média cross-league
  const cupH = cupPedigreeMult(home, league);
  const cupA = cupPedigreeMult(away, league);

  const lambdaHome = clamp(lgHome * homeAttack * awayDefense * homeAdv * cupH, 0.15, 5);
  const lambdaAway = clamp(lgAway * awayAttack * homeDefense * cupA, 0.15, 5);

  // Matriz 6×6
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h < 6; h++) {
    for (let a = 0; a < 6; a++) {
      const c = poissonPMF(h, lambdaHome) * poissonPMF(a, lambdaAway);
      if (h > a) pH += c; else if (h < a) pA += c; else pD += c;
    }
  }
  const tot = pH + pD + pA;
  pH /= tot; pD /= tot; pA /= tot;

  // BTTS
  const pHome0 = poissonPMF(0, lambdaHome);
  const pAway0 = poissonPMF(0, lambdaAway);
  const pBtts = (1 - pHome0) * (1 - pAway0);

  return {
    pHome: +pH.toFixed(4), pDraw: +pD.toFixed(4), pAway: +pA.toFixed(4),
    pBtts: +pBtts.toFixed(4), pNoBtts: +(1 - pBtts).toFixed(4),
    lambdaHome: +lambdaHome.toFixed(2),
    lambdaAway: +lambdaAway.toFixed(2),
    expGoals:   +(lambdaHome + lambdaAway).toFixed(2),
    cupMultH: +cupH.toFixed(3),
    cupMultA: +cupA.toFixed(3),
    isCupGame: (cupH !== 1 || cupA !== 1),
    hasRealStats: !!(hStats && aStats),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Gerador de narrativa
// ═══════════════════════════════════════════════════════════════════════════
function buildNarrative(home, away, p) {
  const lines = [];
  const fav = p.pHome > p.pAway ? home : away;
  const favProb = Math.max(p.pHome, p.pAway);

  if (favProb >= 0.55)
    lines.push(`${fav} entra favorito com ${(favProb * 100).toFixed(0)}% pelo modelo Poisson (λ ${p.lambdaHome} × ${p.lambdaAway}).`);
  else if (favProb >= 0.42)
    lines.push(`Jogo equilibrado: ${fav} leve favorito (${(favProb * 100).toFixed(0)}%), empate em ${(p.pDraw * 100).toFixed(0)}%.`);
  else
    lines.push(`Partida sem claro favorito — ${(p.pHome*100).toFixed(0)}/${(p.pDraw*100).toFixed(0)}/${(p.pAway*100).toFixed(0)}.`);

  if (p.isCupGame) {
    if (p.cupMultH >= 1.08) lines.push(`🏆 ${home} é "copeiro" histórico (×${p.cupMultH.toFixed(2)}).`);
    if (p.cupMultA >= 1.08) lines.push(`🏆 ${away} tem DNA de copa (×${p.cupMultA.toFixed(2)}).`);
  }

  if (p.expGoals >= 3.0)        lines.push(`⚽ Total esperado: ${p.expGoals} gols — jogo aberto.`);
  else if (p.expGoals <= 2.0)   lines.push(`🔒 Total esperado: ${p.expGoals} gols — jogo travado.`);

  if (p.pBtts >= 0.55) lines.push(`✅ BTTS SIM provável (${Math.round(p.pBtts * 100)}%).`);
  else if (p.pBtts <= 0.40) lines.push(`❌ BTTS NÃO provável (${Math.round((1 - p.pBtts) * 100)}%).`);

  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fetch básico de stats via serviço D1 existente
// ═══════════════════════════════════════════════════════════════════════════
function normTeam(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b/g,'')
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Match-level enrichment: lineups + weather + xA/PPDA via D1 (Tier 1/2)
// Resolve o match_id por home/away (+ date opcional) e agrega os detalhes.
// Segue soft-fail: se não achar nada, retorna null e briefing continua sem.
// ═══════════════════════════════════════════════════════════════════════════
async function getMatchEnrichment(env, home, away, dateStr) {
  if (!env.SB_DB) return null;
  try {
    const hn = normTeam(home), an = normTeam(away);
    let sql = `SELECT match_id, match_date, kickoff_iso, status, venue
               FROM matches_raw
               WHERE home_team_norm LIKE ? AND away_team_norm LIKE ?`;
    const binds = [`%${hn}%`, `%${an}%`];
    if (dateStr) { sql += ` AND match_date = ?`; binds.push(dateStr); }
    sql += ` ORDER BY match_date DESC LIMIT 1`;
    const match = await env.SB_DB.prepare(sql).bind(...binds).first();
    if (!match) return null;

    const [lineups, weather, metrics, shots] = await Promise.all([
      env.SB_DB.prepare(`SELECT team_norm, is_home, formation, is_confirmed, player_name, is_starter
                         FROM lineups WHERE match_id = ?`).bind(match.match_id).all(),
      env.SB_DB.prepare(`SELECT temp_c, wind_kmh, precip_mm, condition, goal_impact_mult
                         FROM weather_snapshots WHERE match_id = ?`).bind(match.match_id).first(),
      env.SB_DB.prepare(`SELECT team_norm, is_home, ppda, possession_pct, xg_total, xa_total, shots, shots_on_target
                         FROM match_team_metrics WHERE match_id = ?`).bind(match.match_id).all(),
      env.SB_DB.prepare(`SELECT is_home, xg_computed, is_goal, player_name, assist_player
                         FROM shot_events WHERE match_id = ?`).bind(match.match_id).all(),
    ]);

    const ln = lineups.results || [];
    const lineupHome = ln.filter(r => r.is_home === 1);
    const lineupAway = ln.filter(r => r.is_home === 0);
    const mt = metrics.results || [];
    const teamMetric = (isHome) => mt.find(r => r.is_home === (isHome ? 1 : 0)) || null;

    return {
      match_id: match.match_id,
      match_date: match.match_date,
      status: match.status,
      venue: match.venue,
      lineups: (lineupHome.length || lineupAway.length) ? {
        home: {
          formation: lineupHome[0]?.formation || null,
          confirmed: lineupHome[0]?.is_confirmed === 1,
          starters: lineupHome.filter(p => p.is_starter).map(p => p.player_name),
        },
        away: {
          formation: lineupAway[0]?.formation || null,
          confirmed: lineupAway[0]?.is_confirmed === 1,
          starters: lineupAway.filter(p => p.is_starter).map(p => p.player_name),
        },
      } : null,
      weather: weather || null,
      team_metrics: {
        home: teamMetric(true),
        away: teamMetric(false),
      },
      shot_summary: {
        total_shots: (shots.results || []).length,
        goals: (shots.results || []).filter(s => s.is_goal === 1).length,
        xg_home: +((shots.results || []).filter(s => s.is_home === 1).reduce((a,s) => a + (s.xg_computed || 0), 0)).toFixed(2),
        xg_away: +((shots.results || []).filter(s => s.is_home === 0).reduce((a,s) => a + (s.xg_computed || 0), 0)).toFixed(2),
        with_xa: (shots.results || []).filter(s => s.assist_player).length,
      },
    };
  } catch (e) {
    console.error('[briefing.enrichment]', e.message);
    return null;
  }
}

async function getTeamStatsD1(env, teamName) {
  if (!env.SB_DB) return null;
  try {
    const row = await env.SB_DB.prepare(`
      SELECT team_name, games_played, wins, draws, losses, goals_for, goals_against,
             xg_per_game, btts_pct, over25_pct, data_quality
      FROM team_stats
      WHERE LOWER(team_name) = LOWER(?) AND sport = 'football' AND home_away = 'all'
      ORDER BY updated_at DESC LIMIT 1
    `).bind(teamName).first();
    if (!row || !row.games_played) return null;
    return {
      team: row.team_name,
      games: row.games_played,
      record: `${row.wins}W ${row.draws}D ${row.losses}L`,
      goals_for: row.games_played > 0 ? +(row.goals_for / row.games_played).toFixed(2) : null,
      goals_against: row.games_played > 0 ? +(row.goals_against / row.games_played).toFixed(2) : null,
      xg_per_game: row.xg_per_game,
      btts_pct: row.btts_pct,
      over25_pct: row.over25_pct,
      data_quality: row.data_quality || 'PARCIAL',
    };
  } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Handler principal — GET /v1/briefing/:home/:away?league=
// ═══════════════════════════════════════════════════════════════════════════
export async function handleBriefing(pathname, request, env, services) {
  const url = new URL(request.url);
  // pathname = /v1/briefing/:home/:away
  const parts = pathname.split('/').filter(Boolean); // [v1, briefing, home, away]
  if (parts.length < 4) {
    return new Response(JSON.stringify(sbError('BAD_REQUEST', 'Usage: /v1/briefing/:home/:away?league=', 400)),
      { status: 400, headers: corsHeaders() });
  }
  const home = decodeURIComponent(parts[2]);
  const away = decodeURIComponent(parts[3]);
  const league = url.searchParams.get('league') || '';
  const date   = url.searchParams.get('date') || '';

  // Busca stats em paralelo — inclui xG via proxy interno Understat + match detail D1
  const xgUrl = (team) => `${url.origin}/v1/xg?team=${encodeURIComponent(team)}&league=${encodeURIComponent(league)}`;
  const [hStats, aStats, xgH, xgA, matchEnrich] = await Promise.all([
    getTeamStatsD1(env, home),
    getTeamStatsD1(env, away),
    fetch(xgUrl(home)).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(xgUrl(away)).then(r => r.ok ? r.json() : null).catch(() => null),
    getMatchEnrichment(env, home, away, date),
  ]);

  const prediction = computePoisson(home, away, league, hStats, aStats);
  const narrative  = buildNarrative(home, away, prediction);

  // xG enhancement — se temos xG da temporada, enriquece prediction
  const xgHomeData = xgH?.data || null;
  const xgAwayData = xgA?.data || null;
  if (xgHomeData && xgAwayData) {
    narrative.unshift(
      `📊 xG temporada: ${home} ${xgHomeData.xg_per90}/j (${xgHomeData.goals}g em ${xgHomeData.games}) · ` +
      `${away} ${xgAwayData.xg_per90}/j (${xgAwayData.goals}g em ${xgAwayData.games}).`
    );
    if (xgHomeData.overperforming) narrative.push(`⚠️ ${home} está marcando ACIMA do xG — regressão à média provável.`);
    if (xgHomeData.underperforming) narrative.push(`📈 ${home} marca abaixo do xG — tendência de melhora ofensiva.`);
    if (xgAwayData.overperforming) narrative.push(`⚠️ ${away} marca ACIMA do xG — vulnerável a regressão.`);
    if (xgAwayData.underperforming) narrative.push(`📈 ${away} marca abaixo do xG — pode subir performance.`);
  }

  // Enriquecimento com match-level (Tier 1/2): lineups + weather + xA/PPDA
  if (matchEnrich) {
    if (matchEnrich.lineups) {
      const lh = matchEnrich.lineups.home, la = matchEnrich.lineups.away;
      if (lh?.formation && la?.formation) {
        const confTag = (lh.confirmed && la.confirmed) ? 'confirmada' : 'provável';
        narrative.push(`📋 Formações (${confTag}): ${home} ${lh.formation} × ${away} ${la.formation}.`);
      }
    }
    if (matchEnrich.weather) {
      const w = matchEnrich.weather;
      const mult = w.goal_impact_mult;
      if (mult && Math.abs(mult - 1) >= 0.04) {
        const dir = mult < 1 ? 'reduz' : 'favorece';
        const pct = Math.abs(Math.round((mult - 1) * 100));
        narrative.push(`🌦️ Clima (${w.temp_c}°C, vento ${w.wind_kmh}km/h, chuva ${w.precip_mm}mm, ${w.condition || '—'}) ${dir} gols em ~${pct}%.`);
      }
    }
    if (matchEnrich.status === 'post' && matchEnrich.team_metrics.home?.ppda != null) {
      const ph = matchEnrich.team_metrics.home.ppda;
      const pa = matchEnrich.team_metrics.away?.ppda;
      if (ph != null && pa != null) {
        const presser = ph < pa ? home : away;
        narrative.push(`🔥 PPDA histórico: ${home} ${ph.toFixed(1)} · ${away} ${pa.toFixed(1)} (${presser} pressiona mais alto).`);
      }
    }
  }

  const briefing = {
    fixture: { home, away, league: league || null },
    teamStats: {
      home: hStats || { data_quality: 'EST', note: 'No D1 stats available — using league baseline' },
      away: aStats || { data_quality: 'EST', note: 'No D1 stats available — using league baseline' },
    },
    xg: {
      home: xgHomeData,
      away: xgAwayData,
      available: !!(xgHomeData && xgAwayData),
      source: 'understat',
    },
    prediction,
    narrative,
    enrichment: matchEnrich || null,
    modelMeta: {
      model: 'sportsbrain-poisson-v3',
      features: ['league-baseline', 'team-attack-defense-ratio', 'home-advantage', 'cup-pedigree',
                 ...(matchEnrich?.lineups ? ['lineups'] : []),
                 ...(matchEnrich?.weather ? ['weather'] : []),
                 ...(matchEnrich?.team_metrics?.home?.ppda != null ? ['ppda','xa'] : [])],
      dataQuality: prediction.hasRealStats ? 'REAL' : 'EST',
      enriched: !!matchEnrich,
      model_card: '/v1/docs/model-card',
    },
    generated_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(sbResponse({
    data: briefing,
    meta: { endpoint: pathname, source: 'd1+poisson-v3' },
  })), {
    status: 200,
    headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=900' }, // 15min
  });
}
