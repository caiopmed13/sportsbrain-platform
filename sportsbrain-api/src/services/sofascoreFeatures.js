// src/services/sofascoreFeatures.js
// ─────────────────────────────────────────────────────────────────────────────
// Feature engine: computa inteligência histórica por time a partir do D1.
// Lê sofascore_team_matches — nunca inventa dados, missing = null.
//
// Política de dados:
//   - Se matchesAvailable < MIN_MATCHES → dataQuality.meetsMinimum = false
//   - Todas as features usam apenas os N matches mais recentes (event_date DESC)
//   - Nenhuma feature é inventada: se D1 não tem dado, retorna null
// ─────────────────────────────────────────────────────────────────────────────

const MIN_MATCHES    = 5;
const DEFAULT_WINDOW = 30;  // usa últimas 30 partidas (~6 meses) para stats gerais

/**
 * Busca as últimas N partidas de um time no D1.
 * @param {number} teamId
 * @param {number} n — janela de partidas
 * @param {object} env — Cloudflare Workers env com SB_DB
 * @returns {Array} rows de sofascore_team_matches, ordenadas por event_date DESC
 */
async function fetchRecentMatches(teamId, n, env) {
  if (!env?.SB_DB) return [];
  try {
    const rows = await env.SB_DB.prepare(
      `SELECT * FROM sofascore_team_matches WHERE ss_team_id = ? ORDER BY event_date DESC LIMIT ?`
    ).bind(teamId, n).all().catch(() => ({ results: [] }));
    return rows.results || [];
  } catch {
    return [];
  }
}

/**
 * Calcula features de forma para um time.
 * @param {number} teamId
 * @param {object} env
 * @param {object} opts — { window: 10 }
 * @returns {object} inteligência do time
 */
export async function getTeamFeatures(teamId, env, opts = {}) {
  const window = opts.window ?? DEFAULT_WINDOW;
  const matches = await fetchRecentMatches(teamId, window, env);

  const dataQuality = {
    matchesAvailable: matches.length,
    meetsMinimum: matches.length >= MIN_MATCHES,
    window,
  };

  if (!matches.length) {
    return { teamId, dataQuality, form: null, bttsRate: null, over25Rate: null, cornerAvg: null, attackScore: null, defenseScore: null };
  }

  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
  let btts = 0, over25 = 0;
  let cornersFor = 0, cornersAgainst = 0;
  let htGoals = 0, htBtts = 0, htOver05 = 0;
  let recentWins = 0, recentDraws = 0, recentLosses = 0, recentGf = 0, recentGa = 0;

  for (const m of matches) {
    const isHome   = m.side === 'home';
    const scored   = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
    const conceded = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);

    gf += scored;
    ga += conceded;

    const total = scored + conceded;
    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;

    if (scored > 0 && conceded > 0) btts++;
    if (total > 2.5) over25++;

    const cornersTeam = isHome ? (m.corner_home ?? 0) : (m.corner_away ?? 0);
    const cornersOpp  = isHome ? (m.corner_away ?? 0) : (m.corner_home ?? 0);
    cornersFor     += cornersTeam;
    cornersAgainst += cornersOpp;

    // HT stats
    const htHome = m.home_ht ?? null;
    const htAway = m.away_ht ?? null;
    if (htHome !== null && htAway !== null) {
      htGoals += htHome + htAway;
      if (htHome > 0 && htAway > 0) htBtts++;
      if (htHome + htAway > 0.5) htOver05++;
    }

    // Forma recente (últimos 5 — já ordenados por date DESC)
    if (matches.indexOf(m) < 5) {
      const rScored   = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
      const rConceded = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);
      recentGf += rScored; recentGa += rConceded;
      if (rScored > rConceded) recentWins++;
      else if (rScored === rConceded) recentDraws++;
      else recentLosses++;
    }
  }

  const n = matches.length;

  return {
    teamId,
    dataQuality,
    form: {
      wins, draws, losses,
      gf, ga,
      gfPerMatch: +(gf / n).toFixed(2),
      gaPerMatch: +(ga / n).toFixed(2),
      points: wins * 3 + draws,
    },
    bttsRate:    +(btts   / n).toFixed(3),
    over25Rate:  +(over25  / n).toFixed(3),
    cornerAvg: {
      forTeam:  +(cornersFor     / n).toFixed(2),
      against:  +(cornersAgainst / n).toFixed(2),
      total:    +((cornersFor + cornersAgainst) / n).toFixed(2),
    },
    attackScore:  +(gf / n).toFixed(2),
    defenseScore: +(ga / n).toFixed(2),
    htStats: n > 0 ? {
      avgGoals:   +(htGoals  / n).toFixed(2),
      bttsRate:   +(htBtts   / n).toFixed(3),
      over05Rate: +(htOver05 / n).toFixed(3),
    } : null,
    recentForm5: matches.length >= 1 ? {
      wins: recentWins, draws: recentDraws, losses: recentLosses,
      points: recentWins * 3 + recentDraws,
      gfPerMatch: +(recentGf / Math.min(n, 5)).toFixed(2),
      gaPerMatch: +(recentGa / Math.min(n, 5)).toFixed(2),
      inForm:     (recentWins * 3 + recentDraws) >= 9,   // ≥9pts/5 = boa forma
      outOfForm:  (recentWins * 3 + recentDraws) <= 3,   // ≤3pts/5 = má forma
    } : null,
  };
}

/**
 * Busca H2H entre dois times (da perspectiva do homeTeamId).
 * Retorna até N partidas onde homeTeamId jogou contra awayTeamId.
 */
async function fetchH2HMatches(homeTeamId, awayTeamId, env, n = 8) {
  if (!env?.SB_DB) return [];
  try {
    const rows = await env.SB_DB.prepare(
      `SELECT * FROM sofascore_team_matches
       WHERE ss_team_id = ? AND opponent_team_id = ?
       ORDER BY event_date DESC LIMIT ?`
    ).bind(homeTeamId, awayTeamId, n).all().catch(() => ({ results: [] }));
    return rows.results || [];
  } catch { return []; }
}

/**
 * Computa estatísticas H2H entre dois times.
 * Análise da perspectiva do homeTeamId.
 */
async function getH2H(homeTeamId, awayTeamId, env) {
  const matches = await fetchH2HMatches(homeTeamId, awayTeamId, env, 8);
  if (matches.length < 2) return null;

  let homeTeamWins = 0, awayTeamWins = 0, draws = 0;
  let totalGoalsSum = 0, btts = 0, over25 = 0;

  for (const m of matches) {
    // m.ss_team_id = homeTeamId, m.side = 'home'|'away' neste confronto específico
    const myScore  = m.side === 'home' ? (m.home_score ?? 0) : (m.away_score ?? 0);
    const oppScore = m.side === 'home' ? (m.away_score ?? 0) : (m.home_score ?? 0);
    const total    = myScore + oppScore;

    if (myScore > oppScore) homeTeamWins++;
    else if (myScore < oppScore) awayTeamWins++;
    else draws++;

    if (myScore > 0 && oppScore > 0) btts++;
    if (total > 2.5) over25++;
    totalGoalsSum += total;
  }

  const n = matches.length;
  return {
    matches: n,
    homeTeamWinRate:  +(homeTeamWins  / n).toFixed(3),
    awayTeamWinRate:  +(awayTeamWins  / n).toFixed(3),
    drawRate:         +(draws         / n).toFixed(3),
    bttsRate:         +(btts          / n).toFixed(3),
    over25Rate:       +(over25        / n).toFixed(3),
    avgGoals:         +(totalGoalsSum / n).toFixed(2),
  };
}

/**
 * Computa inteligência para uma partida (par de times).
 * v2: inclui splits por lado (home/away) e H2H para scoring mais preciso.
 *
 * @param {number} homeTeamId
 * @param {number} awayTeamId
 * @param {object} env
 * @returns {object|null}
 */
export async function getMatchIntelligence(homeTeamId, awayTeamId, env) {
  if (!homeTeamId || !awayTeamId) return null;

  // Busca em paralelo: form geral, splits por lado e H2H
  const [
    homeFeatures,
    awayFeatures,
    homeAtHome,   // performance do mandante jogando EM CASA
    awayOnRoad,   // performance do visitante jogando FORA
    h2h,
  ] = await Promise.all([
    getTeamFeatures(homeTeamId, env),
    getTeamFeatures(awayTeamId, env),
    getTeamFeaturesBySide(homeTeamId, 'home', env, { window: 18 }),  // ~9 meses de jogos em casa
    getTeamFeaturesBySide(awayTeamId, 'away', env, { window: 18 }),  // ~9 meses fora
    getH2H(homeTeamId, awayTeamId, env),
  ]);

  const homeMeets = homeFeatures.dataQuality.meetsMinimum;
  const awayMeets = awayFeatures.dataQuality.meetsMinimum;

  const confidence = (homeMeets && awayMeets) ? 'high'
    : (homeMeets || awayMeets) ? 'low'
    : 'none';

  // Taxas combinadas: prefere splits por lado quando disponíveis (mais precisas)
  const homeBtts   = homeAtHome?.bttsRate   ?? homeFeatures.bttsRate   ?? 0;
  const awayBtts   = awayOnRoad?.bttsRate   ?? awayFeatures.bttsRate   ?? 0;
  const homeOver25 = homeAtHome?.over25Rate ?? homeFeatures.over25Rate ?? 0;
  const awayOver25 = awayOnRoad?.over25Rate ?? awayFeatures.over25Rate ?? 0;

  return {
    confidence,
    home: homeFeatures,
    away: awayFeatures,
    // Splits lado-específicos (mais precisos para picks de mandante/visitante)
    homeAtHome,   // como o mandante joga em casa
    awayOnRoad,   // como o visitante joga fora
    // H2H direto entre estes dois times
    h2h,
    // Combined: usa lado-específico quando disponível
    combined: confidence === 'high' ? {
      bttsRate:       +((homeBtts   + awayBtts)   / 2).toFixed(3),
      over25Rate:     +((homeOver25 + awayOver25) / 2).toFixed(3),
      cornerAvgTotal: +((homeFeatures.cornerAvg?.total ?? 0) + (awayFeatures.cornerAvg?.total ?? 0) / 2).toFixed(2),
      homeAttack:     homeAtHome?.gfPerMatch  ?? homeFeatures.attackScore,
      awayAttack:     awayOnRoad?.gfPerMatch  ?? awayFeatures.attackScore,
      homeDefense:    homeAtHome?.gaPerMatch  ?? homeFeatures.defenseScore,
      awayDefense:    awayOnRoad?.gaPerMatch  ?? awayFeatures.defenseScore,
      // Win rates lado-específicos
      homeWinRate:    homeAtHome?.winRate     ?? null,
      awayWinRate:    awayOnRoad?.winRate     ?? null,
    } : null,
  };
}

/**
 * Busca partidas filtradas por lado (home ou away).
 */
async function fetchMatchesBySide(teamId, side, n, env) {
  if (!env?.SB_DB) return [];
  try {
    const rows = await env.SB_DB.prepare(
      `SELECT * FROM sofascore_team_matches WHERE ss_team_id = ? AND side = ? ORDER BY event_date DESC LIMIT ?`
    ).bind(teamId, side, n).all().catch(() => ({ results: [] }));
    return rows.results || [];
  } catch { return []; }
}

/**
 * Features específicas por lado (home ou away). Mais preciso para picks de mandante/visitante.
 */
export async function getTeamFeaturesBySide(teamId, side, env, opts = {}) {
  const window = opts.window ?? DEFAULT_WINDOW;
  const matches = await fetchMatchesBySide(teamId, side, window, env);
  if (!matches.length) return null;

  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, btts = 0, over25 = 0;
  for (const m of matches) {
    const scored   = side === 'home' ? (m.home_score ?? 0) : (m.away_score ?? 0);
    const conceded = side === 'home' ? (m.away_score ?? 0) : (m.home_score ?? 0);
    gf += scored; ga += conceded;
    if (scored > conceded) wins++;
    else if (scored === conceded) draws++;
    else losses++;
    if (scored > 0 && conceded > 0) btts++;
    if (scored + conceded > 2.5) over25++;
  }
  const n = matches.length;
  return {
    side, matchesUsed: n,
    winRate:   +(wins   / n).toFixed(3),
    drawRate:  +(draws  / n).toFixed(3),
    lossRate:  +(losses / n).toFixed(3),
    gfPerMatch: +(gf / n).toFixed(2),
    gaPerMatch: +(ga / n).toFixed(2),
    bttsRate:   +(btts   / n).toFixed(3),
    over25Rate: +(over25  / n).toFixed(3),
    cleanSheetRate: +((matches.filter(m => (side==='home' ? m.away_score : m.home_score) === 0).length) / n).toFixed(3),
  };
}

/**
 * Computa score de alinhamento entre um pick e inteligência histórica.
 * Retorna { score: number, label: string|null }
 *   score > 0 = pick alinhado com histórico → boost PQS
 *   score < 0 = pick contradiz histórico → penalidade PQS
 *   label     = string para exibir ao usuário (quando significativo)
 *
 * @param {object} pick — pick com stat/market, direction, home_team, away_team
 * @param {object} intel — retorno de getMatchIntelligence
 */
/**
 * Scoring direcional entre pick e inteligência histórica.
 * v2: usa home/away splits quando disponíveis + bônus de confirmação H2H.
 *
 * Escala:
 *   +14/+12   padrão histórico forte alinhado com o pick
 *   +7/+6/+5  alinhamento moderado
 *   0         neutro (dados existem mas sem padrão claro)
 *   -5/-8     pick leve contra padrão
 *   -12/-10   pick fortemente contra o padrão histórico
 *   +3 bônus  quando H2H confirma independentemente o padrão
 */
export function computePickAlignment(pick, intel) {
  if (!intel || intel.confidence === 'none') return { score: 0, label: null };

  const stat = (pick.stat || pick.market || '').toUpperCase();
  const cb         = intel.combined;
  const homeAtHome = intel.homeAtHome;  // mandante jogando em casa
  const awayOnRoad = intel.awayOnRoad;  // visitante jogando fora
  const h2h        = intel.h2h;         // histórico direto entre os dois

  // ── helpers ─────────────────────────────────────────────────────────────────
  // H2H bonus: se H2H confirma o padrão, adiciona +3 de confiança
  const h2hBonus = (h2hRate, threshold, isPositive) => {
    if (!h2h || h2h.matches < 2) return 0;
    return (isPositive ? h2hRate >= threshold : h2hRate <= threshold) ? 3 : 0;
  };

  // ── BTTS ────────────────────────────────────────────────────────────────────
  const isBttsMarket = /BTTS|AMBAS|BOTH.*SCORE/i.test(stat);
  if (isBttsMarket) {
    const isYes = /YES|SIM|_1$|_Y$/i.test(stat) || pick.direction === 'yes';
    const isNo  = /NO|NAO|NÃO|_0$|_N$/i.test(stat) || pick.direction === 'no';
    // Usa splits lado-específicos quando disponíveis (mais precisos)
    const homeBtts = homeAtHome?.bttsRate ?? intel.home?.bttsRate ?? 0;
    const awayBtts = awayOnRoad?.bttsRate ?? intel.away?.bttsRate ?? 0;
    const rate = cb?.bttsRate ?? ((homeBtts + awayBtts) / 2);
    // P1: rate===0 é dado válido ("0% BTTS histórico"), não deve suprimir label —
    // cai naturalmente nos checks de threshold abaixo (≤0.32 → score negativo com label)
    if (isYes) {
      const bonus = h2hBonus(h2h?.bttsRate, 0.55, true);
      if (rate >= 0.62) return { score: 14 + bonus, label: `BTTS: ${Math.round(rate*100)}% histórico (em casa/fora) ✓` };
      if (rate >= 0.52) return { score: 7  + bonus, label: `BTTS: ${Math.round(rate*100)}% histórico` };
      if (rate <= 0.32) return { score: -12 + (bonus > 0 ? 3 : 0), label: `⚠️ BTTS baixo: só ${Math.round(rate*100)}% histórico` };
      if (rate <= 0.42) return { score: -5, label: null };
    } else if (isNo) {
      const bonus = h2hBonus(h2h?.bttsRate, 0.40, false);
      if (rate <= 0.32) return { score: 14 + bonus, label: `BTTS baixo: ${Math.round((1-rate)*100)}% sem ambos marcarem ✓` };
      if (rate <= 0.42) return { score: 7  + bonus, label: `BTTS ${Math.round(rate*100)}% — parcialmente suportado` };
      if (rate >= 0.62) return { score: -10, label: `⚠️ BTTS alto: ${Math.round(rate*100)}% histórico — contra-indicado` };
      if (rate >= 0.52) return { score: -4,  label: null };
    }
    return { score: intel.confidence === 'high' ? 5 : 3, label: null };
  }

  // ── Over/Under Gols ─────────────────────────────────────────────────────────
  const isGoalMarket = /GOAL|GOL|OVER|UNDER|2[\._]5|1[\._]5|3[\._]5/i.test(stat)
    && !/CORNER|ESCAN|CARD|CART/i.test(stat);
  if (isGoalMarket) {
    const isOver  = /OVER|ACIMA|MAIS|^O\d/i.test(stat) || pick.direction === 'over';
    const isUnder = /UNDER|ABAIXO|MENOS|^U\d/i.test(stat) || pick.direction === 'under';
    const homeO25 = homeAtHome?.over25Rate ?? intel.home?.over25Rate ?? 0;
    const awayO25 = awayOnRoad?.over25Rate ?? intel.away?.over25Rate ?? 0;
    const rate = cb?.over25Rate ?? ((homeO25 + awayO25) / 2);
    // P1: rate===0 é dado válido ("0% Over 2.5 histórico"), não deve suprimir label —
    // cai naturalmente nos checks de threshold abaixo (≤0.30 → score negativo com label)
    if (isOver) {
      const bonus = h2hBonus(h2h?.over25Rate, 0.55, true);
      if (rate >= 0.62) return { score: 14 + bonus, label: `Over 2.5: ${Math.round(rate*100)}% histórico ✓` };
      if (rate >= 0.52) return { score: 7  + bonus, label: `Over 2.5: ${Math.round(rate*100)}% histórico` };
      if (rate <= 0.30) return { score: -12, label: `⚠️ Poucos gols: só ${Math.round(rate*100)}% acima 2.5 histórico` };
      if (rate <= 0.40) return { score: -5,  label: null };
    } else if (isUnder) {
      const bonus = h2hBonus(h2h?.over25Rate, 0.40, false);
      if (rate <= 0.30) return { score: 14 + bonus, label: `Under: ${Math.round((1-rate)*100)}% fechado historicamente ✓` };
      if (rate <= 0.40) return { score: 7  + bonus, label: `Under: ${Math.round((1-rate)*100)}% de jogos fechados` };
      if (rate >= 0.62) return { score: -10, label: `⚠️ Jogo aberto: ${Math.round(rate*100)}% acima 2.5 — contra-indicado` };
      if (rate >= 0.52) return { score: -4,  label: null };
    }
    return { score: intel.confidence === 'high' ? 5 : 3, label: null };
  }

  // ── Resultado (1X2 / Home Win / Away Win / Draw / Double Chance) ─────────────
  const isResultMarket = /RESULT|1X2|1X2_ADJ|WINNER|VENCEDOR/i.test(stat)
    || /^(home|away|draw).*win/i.test(stat);
  if (isResultMarket) {
    const isHome  = /HOME|CASA|_1$|MAND/i.test(stat) || pick.direction === 'home';
    const isAway  = /AWAY|VISIT|_2$|VIS/i.test(stat)  || pick.direction === 'away';
    const isDraw  = /DRAW|EMPATE|_X$|EMPAT/i.test(stat) || pick.direction === 'draw';
    // Double chance: "12" = home or away (não-empate), "1X" = home or draw, "X2" = draw or away
    const isDC12  = pick.direction === '12' || pick.direction === '1or2';

    if (isHome) {
      // Usa win rate do mandante JOGANDO EM CASA (mais preciso)
      const wr = cb?.homeWinRate ?? homeAtHome?.winRate
        ?? (intel.home?.form
          ? intel.home.form.wins / Math.max(1, intel.home.form.wins + intel.home.form.draws + intel.home.form.losses)
          : null);
      if (wr !== null) {
        const bonus = h2hBonus(h2h?.homeTeamWinRate, 0.55, true);
        if (wr >= 0.60) return { score: 14 + bonus, label: `Mandante: ${Math.round(wr*100)}% vitórias em casa ✓` };
        if (wr >= 0.50) return { score: 8  + bonus, label: `Mandante: ${Math.round(wr*100)}% em casa` };
        if (wr >= 0.40) return { score: 4,           label: null };
        if (wr <= 0.20) return { score: -9,           label: `⚠️ Mandante fraco: só ${Math.round(wr*100)}% em casa` };
        if (wr <= 0.30) return { score: -4,           label: null };
      }
    }

    if (isAway) {
      // Usa win rate do visitante JOGANDO FORA (mais preciso)
      const wr = cb?.awayWinRate ?? awayOnRoad?.winRate
        ?? (intel.away?.form
          ? intel.away.form.wins / Math.max(1, intel.away.form.wins + intel.away.form.draws + intel.away.form.losses)
          : null);
      if (wr !== null) {
        const bonus = h2hBonus(h2h?.awayTeamWinRate, 0.45, true);
        if (wr >= 0.50) return { score: 14 + bonus, label: `Visitante: ${Math.round(wr*100)}% vitórias fora ✓` };
        if (wr >= 0.40) return { score: 8  + bonus, label: `Visitante: ${Math.round(wr*100)}% fora` };
        if (wr >= 0.30) return { score: 4,           label: null };
        if (wr <= 0.12) return { score: -9,           label: `⚠️ Visitante fraco: só ${Math.round(wr*100)}% fora` };
        if (wr <= 0.20) return { score: -4,           label: null };
      }
    }

    if (isDraw && cb) {
      // Estima taxa de empate: 1 - homeWinRate - awayWinRate
      const homeWr = cb.homeWinRate ?? 0;
      const awayWr = cb.awayWinRate ?? 0;
      const drawEst = Math.max(0, 1 - homeWr - awayWr);
      if (drawEst >= 0.30) return { score: 8, label: `Empate: ${Math.round(homeWr*100)}% casa / ${Math.round(awayWr*100)}% fora — jogo disputado` };
      if (drawEst >= 0.20) return { score: 4, label: null };
    }

    if (isDC12 && cb) {
      // Dupla hipótese: mandante ou visitante ganha (excl. empate)
      const homeWr = cb.homeWinRate ?? 0;
      const awayWr = cb.awayWinRate ?? 0;
      const winProb = homeWr + awayWr;
      // Retorna nota contextual sem forte penalidade/bônus (dupla hipótese é conservadora)
      if (winProb >= 0.75) return { score: 7, label: `1X2: ${Math.round(homeWr*100)}% casa + ${Math.round(awayWr*100)}% fora histórico` };
      if (winProb >= 0.60) return { score: 4, label: `${Math.round(homeWr*100)}% casa / ${Math.round(awayWr*100)}% fora histórico` };
      return { score: 3, label: null };
    }

    // Bônus/penalidade de forma recente (últimos 5 jogos)
    const homeRecent = intel.homeAtHome ? null : intel.home?.recentForm5;
    const awayRecent = intel.awayOnRoad ? null : intel.away?.recentForm5;
    if (isHome && homeRecent) {
      if (homeRecent.inForm)    return { score: 7, label: `Forma ✓ (${homeRecent.wins}V últimos 5)` };
      if (homeRecent.outOfForm) return { score: -5, label: null };
    }
    if (isAway && awayRecent) {
      if (awayRecent.inForm)    return { score: 6, label: null };
      if (awayRecent.outOfForm) return { score: -4, label: null };
    }
    return { score: intel.confidence === 'high' ? 5 : 3, label: null };
  }

  // ── HT Gols (1º Tempo) ───────────────────────────────────────────────────────
  const isHtMarket = /\bHT\b|HALF.*TIME|1.*TEMPO|PRIMEIRO.*TEMPO|1ST.*HALF/i.test(stat);
  if (isHtMarket) {
    const homeHt = intel.homeAtHome?.htStats ?? intel.home?.htStats;
    const awayHt = intel.awayOnRoad?.htStats ?? intel.away?.htStats;
    if (homeHt && awayHt) {
      const avgHtGoals = +(homeHt.avgGoals + awayHt.avgGoals) / 2;
      const isOver     = /OVER|ACIMA/i.test(stat) || pick.direction === 'over';
      if (isOver) {
        if (avgHtGoals >= 1.4) return { score: 12, label: `${avgHtGoals.toFixed(1)} gols/HT histórico ✓` };
        if (avgHtGoals >= 1.0) return { score: 6,  label: null };
        if (avgHtGoals <= 0.5) return { score: -8, label: null };
      } else {
        if (avgHtGoals <= 0.6) return { score: 12, label: null };
        if (avgHtGoals <= 0.9) return { score: 6,  label: null };
        if (avgHtGoals >= 1.4) return { score: -8, label: null };
      }
    }
    return { score: intel.confidence === 'high' ? 4 : 2, label: null };
  }

  // ── Fallback: dado existe mas pick não mapeado ────────────────────────────────
  if (intel.confidence === 'high') return { score: 5, label: null };
  if (intel.confidence === 'low')  return { score: 3, label: null };
  return { score: 0, label: null };
}
