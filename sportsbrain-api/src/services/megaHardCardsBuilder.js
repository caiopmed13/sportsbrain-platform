// megaHardCardsBuilder.js — F2.80
// Gera cards MEGA HT-CHUTES com thresholds DIFÍCEIS (Mais 8.5 chutes, Mais 3
// escanteios etc) via Poisson sobre médias históricas dos times. Cada card
// tem 4 legs hard → odd ~10-15x. Quadra de 4 cards = MEGA real (10k-50k).
//
// Estrutura igual ao tipster da screenshot: MÉTODO HT com QUADRA 12100x usando
// linhas Mais 8.5/Menos 5.5 chutes + Mais 3/Menos 2 escanteios.

import { getTeamHtAverages, probOverLine, getBatchTeamHtAverages } from './htHistoricalAverages.js';

const BOOK_MARGIN = 0.92;
const MIN_LEG_ODD = 1.3;
const MAX_LEG_ODD = 2.8;
// F2.87: 3 tiers — CONSERVADOR (card ~5x, quadra ~625x), MÉDIO (card ~8x, quadra
// ~4k), AGRESSIVO (card ~12x, quadra ~20k MEGA). Estrutura: 8 jogos do dia
// divididos em 2 GRUPOS DE 4 sem sobreposição (cada jogo aparece em apenas 1 lado),
// gerando 6 quadras únicas (3 perfis × 2 grupos).
const PROFILES = {
  hard:         { targetLegOdd: 1.85, label: 'AGRESSIVO' },
  medium:       { targetLegOdd: 1.55, label: 'MÉDIO'   },
  conservative: { targetLegOdd: 1.30, label: 'CONSERVADOR' },
};
const MIN_CARD_LEGS = 3;
const MAX_CARDS = 10;       // F2.83: reduzido de 16 → 10 (economiza CPU)
const QUADRAS_MAX = 8;

// F2.80b: priors padrão pra times sem histórico (usa média de liga top)
const FALLBACK_PRIOR = {
  ht_shots_avg: 4.5,
  ht_corners_avg: 2.5,
  ht_shots_on_target_avg: 1.5,
  n_games: 5,  // pseudo-count moderado
};

function _normMatch(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// F2.90: dedupe key independente de home/away. "Arsenal v Paris SG" e "PSG v Arsenal"
// = mesmo jogo. Usa team set ordenado alfabeticamente.
function _matchTeamSet(matchStr, homeTeam, awayTeam) {
  let a = '', b = '';
  if (homeTeam && awayTeam) {
    a = _normMatch(homeTeam); b = _normMatch(awayTeam);
  } else {
    const parts = (matchStr || '').split(/\s+(?:v|vs|x)\s+/i);
    if (parts.length === 2) { a = _normMatch(parts[0]); b = _normMatch(parts[1]); }
    else return _normMatch(matchStr);
  }
  // Aliases comuns (PSG=Paris SG)
  const alias = { 'paris sg': 'psg', 'paris saintgermain': 'psg', 'paris saint germain': 'psg' };
  a = alias[a] || a; b = alias[b] || b;
  return [a, b].sort().join('|');
}

/**
 * Pra uma média (avg), encontra a linha mais "difícil" cuja prob de Over fica
 * em [0.30, 0.55] — odd resultante 1.8-3.3x (faixa MEGA-tier).
 * Retorna { line, prob, odd } ou null.
 */
function findHardOverLine(avg, targetLegOdd) {
  if (!Number.isFinite(avg) || avg <= 0) return null;
  const candidates = [];
  const lo = Math.max(0.5, Math.floor(avg) - 1.5);
  const hi = Math.ceil(avg) + 5.5;
  for (let line = lo; line <= hi; line += 1.0) {
    const prob = probOverLine(avg, line);
    if (!prob) continue;
    const odd = +(BOOK_MARGIN / prob).toFixed(2);
    if (odd >= MIN_LEG_ODD && odd <= MAX_LEG_ODD) candidates.push({ line, prob, odd });
  }
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Math.abs(a.odd - targetLegOdd) - Math.abs(b.odd - targetLegOdd))[0];
}

/**
 * Inverso: encontra linha de "Under" (Menos) com odd 1.8-3.3x.
 * Under(line) com Poisson(avg) = P(X <= line) = 1 - probOverLine
 */
function findHardUnderLine(avg, targetLegOdd) {
  if (!Number.isFinite(avg) || avg <= 0) return null;
  const candidates = [];
  const lo = Math.max(0.5, Math.floor(avg) - 3.5);
  const hi = Math.ceil(avg) + 2.5;
  for (let line = lo; line <= hi; line += 1.0) {
    const probOver = probOverLine(avg, line);
    if (!probOver) continue;
    const probUnder = 1 - probOver;
    if (!(probUnder > 0.12 && probUnder < 0.75)) continue;
    const odd = +(BOOK_MARGIN / probUnder).toFixed(2);
    if (odd >= MIN_LEG_ODD && odd <= MAX_LEG_ODD) candidates.push({ line, prob: probUnder, odd });
  }
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Math.abs(a.odd - targetLegOdd) - Math.abs(b.odd - targetLegOdd))[0];
}

/**
 * Pra um match (home_team, away_team), gera um card MEGA com 4-6 hard legs:
 *  - Mais X chutes home  (X = avg_home + 2)
 *  - Menos Y chutes away (Y = avg_away - 1)
 *  - Mais Z escanteios home
 *  - Menos W escanteios away
 * Retorna card { match, legs, combined_odd } ou null se sem histórico.
 */
// F2.81: agora aceita targetLegOdd pra gerar diferentes profiles (medium/hard)
// F2.84: agora SYNC (sem await) — recebe sharedAvgs do batch fetch externo.
function _buildOneMegaHardCardSync(matchKey, homeTeam, awayTeam, kickoffIso, profile = PROFILES.hard, sharedAvgs = null) {
  const target = profile.targetLegOdd;
  const profileLabel = profile.label;

  const { homeAvgs, awayAvgs, usedFallback } = sharedAvgs || { homeAvgs: FALLBACK_PRIOR, awayAvgs: FALLBACK_PRIOR, usedFallback: true };

  const legs = [];

  // helper pra montar leg com analysis explícita
  // F2.86: selection NÃO inclui teamName (statLabelWithTeam frontend já mostra o time)
  const mkLeg = (statKey, market, teamName, side, lineInfo, statLabel, avgVal, nGames) => ({
    match: matchKey, home_team: homeTeam, away_team: awayTeam,
    stat: statKey, market,
    selection: `${side} ${lineInfo.line}`,
    line: lineInfo.line, direction: side === 'Mais' ? 'over' : 'under',
    odd: lineInfo.odd, prob: lineInfo.prob,
    ev_pct: +(((lineInfo.prob * lineInfo.odd) - 1) * 100).toFixed(2),
    kickoff_iso: kickoffIso || null,
    _mega_profile: profileLabel,
    _basis: `Poisson(λ=${avgVal.toFixed(2)}, n=${nGames}${usedFallback ? '·prior' : ''})`,
    _analysis: `${teamName} promediates ${avgVal.toFixed(2)} ${statLabel}/jogo (${nGames} jogos${usedFallback ? ', prior liga' : ''}). ` +
               `Poisson(λ=${avgVal.toFixed(2)}) → P(${side} ${lineInfo.line}) = ${(lineInfo.prob*100).toFixed(1)}% → odd justa ${lineInfo.odd}.`,
  });

  // 1) Mais X chutes home (hard over)
  const homeShotsOver = findHardOverLine(homeAvgs.ht_shots_avg, target);
  if (homeShotsOver) legs.push(mkLeg(
    'ht_shots_home', 'Chutes 1º Tempo · Casa', homeTeam, 'Mais',
    homeShotsOver, 'chutes HT', homeAvgs.ht_shots_avg, homeAvgs.n_games
  ));

  // 2) Menos Y chutes away
  const awayShotsUnder = findHardUnderLine(awayAvgs.ht_shots_avg, target);
  if (awayShotsUnder) legs.push(mkLeg(
    'ht_shots_away', 'Chutes 1º Tempo · Fora', awayTeam, 'Menos',
    awayShotsUnder, 'chutes HT', awayAvgs.ht_shots_avg, awayAvgs.n_games
  ));

  // 3) Mais Z escanteios home
  const homeCornersOver = findHardOverLine(homeAvgs.ht_corners_avg, target);
  if (homeCornersOver) legs.push(mkLeg(
    'ht_corners_home', 'Escanteios 1º Tempo · Casa', homeTeam, 'Mais',
    homeCornersOver, 'escanteios HT', homeAvgs.ht_corners_avg, homeAvgs.n_games
  ));

  // 4) Menos W escanteios away
  const awayCornersUnder = findHardUnderLine(awayAvgs.ht_corners_avg, target);
  if (awayCornersUnder) legs.push(mkLeg(
    'ht_corners_away', 'Escanteios 1º Tempo · Fora', awayTeam, 'Menos',
    awayCornersUnder, 'escanteios HT', awayAvgs.ht_corners_avg, awayAvgs.n_games
  ));

  if (legs.length < MIN_CARD_LEGS) return null;

  const combined_odd  = +legs.reduce((a, l) => a * +l.odd, 1).toFixed(2);
  const combined_prob = +legs.reduce((a, l) => a * +l.prob, 1).toFixed(6);
  const ev_pct = +(((combined_prob * combined_odd) - 1) * 100).toFixed(2);

  // F2.81: analise resumida do card inteira
  const card_analysis = `${profileLabel}: linhas escolhidas via Poisson sobre médias HT históricas. ` +
    `Cada perna mira odd ~${target.toFixed(2)} (P real ${(legs.reduce((s,l)=>s+l.prob,0)/legs.length*100).toFixed(0)}% por perna). ` +
    `Combinada: P=${(combined_prob*100).toFixed(3)}%, odd=${combined_odd}x. ${usedFallback ? '⚠ Algum time sem histórico — usando prior de liga.' : '✓ Dados históricos reais.'}`;

  return {
    card_id: `mega_${profileLabel.toLowerCase()}|${_normMatch(matchKey)}|${Date.now().toString(36).slice(-4)}`,
    method: profile === PROFILES.medium ? 'mega_ht_medium' : 'mega_ht_hard',
    match: matchKey,
    home_team: homeTeam,
    away_team: awayTeam,
    kickoff_iso: kickoffIso || null,
    legs,
    n_legs: legs.length,
    combined_odd,
    combined_prob,
    ev_pct,
    tier_class: combined_odd >= 10000 ? 'agressivo' : combined_odd >= 100 ? 'conservador' : 'cards',
    _used_league_prior: usedFallback,
    _profile: profileLabel,
    analysis: card_analysis,
  };
}

// F2.84: helper agora consome cache de avgs já populado em batch (não faz I/O).
function _fetchAvgsFromCache(avgsByTeam, homeTeam, awayTeam) {
  const homeAvgsRaw = avgsByTeam.get(homeTeam) || null;
  const awayAvgsRaw = avgsByTeam.get(awayTeam) || null;
  const homeAvgs = (homeAvgsRaw && homeAvgsRaw.n_games >= 3) ? homeAvgsRaw : FALLBACK_PRIOR;
  const awayAvgs = (awayAvgsRaw && awayAvgsRaw.n_games >= 3) ? awayAvgsRaw : FALLBACK_PRIOR;
  const usedFallback = (homeAvgs === FALLBACK_PRIOR) || (awayAvgs === FALLBACK_PRIOR);
  return { homeAvgs, awayAvgs, usedFallback };
}

function* _combos(arr, k) {
  const n = arr.length;
  if (k < 0 || k > n) return;
  if (k === 0) { yield []; return; }
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map(i => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * Constrói cards e quadras MEGA HT difíceis pra uma lista de matches.
 * @param env - Cloudflare bindings (precisa de SB_DB pra getTeamHtAverages)
 * @param matches - Array<{match, home_team, away_team, kickoff_iso}>
 * @returns { cards, duplas, triplas, quadras }
 */
// F2.84: agora SYNC pure — nenhum I/O. CPU somente.
function _buildProfileOutputSync(capped, profile, sharedAvgsByKey) {
  const cards = [];
  for (const m of capped) {
    const sharedAvgs = sharedAvgsByKey.get(_normMatch(m.match));
    const card = _buildOneMegaHardCardSync(m.match, m.home_team, m.away_team, m.kickoff_iso, profile, sharedAvgs);
    if (card) cards.push(card);
  }
  cards.sort((a, b) => b.combined_odd - a.combined_odd);
  return _wrapCombosSplitGroups(cards);
}

// F2.87: divide cards em 2 grupos de 4 sem sobreposição → 2 quadras únicas
// (LADO A com top 4 cards, LADO B com cards 5-8). Mantém duplas/triplas pra
// usuário pegar "também as simples" do grupo escolhido.
function _wrapCombosSplitGroups(cards) {
  if (cards.length < 4) return { cards, duplas: [], triplas: [], quadras: [], quintas: [] };

  // Split: GRUPO A = top 4 (maior odd), GRUPO B = cards 5-8 (próximos 4)
  const groupA = cards.slice(0, 4);
  const groupB = cards.slice(4, 8);

  const quadras = [];
  // Quadra A: top 4 jogos (mais "fortes" por odd alta)
  if (groupA.length === 4) quadras.push(_makeQuadra(groupA, 'A'));
  // Quadra B: próximos 4 jogos (independente do A)
  if (groupB.length === 4) quadras.push(_makeQuadra(groupB, 'B'));

  // Duplas/triplas pra cobertura mãe — geradas DENTRO de cada grupo (sem misturar)
  const duplas = [];
  const triplas = [];
  for (const group of [groupA, groupB]) {
    if (group.length >= 2) {
      for (const combo of _combos(group, 2)) duplas.push(_makeNFold(combo, 2));
    }
    if (group.length >= 3) {
      for (const combo of _combos(group, 3)) triplas.push(_makeNFold(combo, 3));
    }
  }
  duplas.sort((a, b) => b.combined_odd - a.combined_odd);
  triplas.sort((a, b) => b.combined_odd - a.combined_odd);

  return {
    cards: cards.slice(0, 8),   // expõe todos 8 jogos como simples
    duplas: duplas.slice(0, 12),
    triplas: triplas.slice(0, 8),
    quadras,
    quintas: [],
  };
}

function _makeQuadra(cards, groupTag) {
  const combined_odd  = cards.reduce((a, c) => a * +c.combined_odd, 1);
  const combined_prob = cards.reduce((a, c) => a * +c.combined_prob, 1);
  return {
    cards,
    n_cards: 4,
    n_legs: cards.reduce((a, c) => a + c.n_legs, 0),
    combined_odd: +combined_odd.toFixed(2),
    combined_prob: +combined_prob.toFixed(8),
    ev_pct: +(((combined_prob * combined_odd) - 1) * 100).toFixed(2),
    tier_class: combined_odd >= 10000 ? 'agressivo' : combined_odd >= 100 ? 'conservador' : 'cards',
    _group: groupTag,
  };
}

function _makeNFold(cards, n) {
  const combined_odd = cards.reduce((a, c) => a * +c.combined_odd, 1);
  const combined_prob = cards.reduce((a, c) => a * +c.combined_prob, 1);
  return {
    cards, n_cards: n,
    n_legs: cards.reduce((a, c) => a + c.n_legs, 0),
    combined_odd: +combined_odd.toFixed(2),
    combined_prob: +combined_prob.toFixed(6),
    ev_pct: +(((combined_prob * combined_odd) - 1) * 100).toFixed(2),
    tier_class: combined_odd >= 10000 ? 'agressivo' : combined_odd >= 100 ? 'conservador' : 'cards',
  };
}

// _wrapCombos antigo removido em F2.87 — substituído por _wrapCombosSplitGroups

export async function buildMegaHtHardCards(env, matches) {
  const empty = { cards: [], duplas: [], triplas: [], quadras: [], quintas: [] };
  if (!env?.SB_DB || !Array.isArray(matches) || matches.length === 0) {
    return { hard: empty, medium: empty, conservative: empty };
  }
  // F2.90: dedupe por team SET (independe de home/away order) — antes deixava
  // "Arsenal v Paris SG" e "PSG v Arsenal" passarem como matches distintos.
  const seen = new Set();
  const uniqueMatches = [];
  for (const m of matches) {
    if (!m?.match || !m?.home_team || !m?.away_team) continue;
    const key = _matchTeamSet(m.match, m.home_team, m.away_team);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueMatches.push(m);
  }
  // F2.87: cap em 8 matches (não 10) — 2 grupos de 4 sem sobreposição.
  const capped = uniqueMatches.slice(0, 8);

  // F2.84: BATCH fetch — 3 queries D1 total. KV cache 1h.
  const allTeams = new Set();
  for (const m of capped) { allTeams.add(m.home_team); allTeams.add(m.away_team); }
  const avgsByTeam = await getBatchTeamHtAverages(env, [...allTeams]).catch(() => new Map());

  const sharedAvgsByKey = new Map();
  for (const m of capped) {
    sharedAvgsByKey.set(_normMatch(m.match), _fetchAvgsFromCache(avgsByTeam, m.home_team, m.away_team));
  }

  // F2.87: 3 profiles, cada um gera 2 quadras (Grupo A top4 + Grupo B 5-8) sem sobreposição
  const hard         = _buildProfileOutputSync(capped, PROFILES.hard,         sharedAvgsByKey);
  const medium       = _buildProfileOutputSync(capped, PROFILES.medium,       sharedAvgsByKey);
  const conservative = _buildProfileOutputSync(capped, PROFILES.conservative, sharedAvgsByKey);
  return { hard, medium, conservative };
}

