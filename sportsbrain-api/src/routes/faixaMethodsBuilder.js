// FAIXA-Methods Tier MVP builder.
// Spec: docs/superpowers/specs/2026-05-27-faixa-methods-tier-design.md
//
// Reads from annotatedWithAll (rich pool with .match/.stat/.odd/.prob/.ev_pct/...).
// Output: { ht_chutes: {cards,duplas,quadras}, faixa_result_btts: {cards,duplas,quadras} }

// Normaliza match string para chave de dedupe (NFD + lowercase).
// Mesma estratégia do fix F2.16.1 que resolveu o bug Bolivar/Bolívar.
// F2.90: agora dedupa por team SET ordenado — "Arsenal v Paris SG" e
// "PSG v Arsenal" passam a ter mesma key.
const _PSG_ALIAS = { 'paris sg': 'psg', 'paris saintgermain': 'psg', 'paris saint germain': 'psg' };
export const _normMatchKey = (s) => {
  const raw = (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const parts = raw.split(/\s+(?:v|vs|x)\s+/);
  if (parts.length !== 2) return raw;
  let a = parts[0].trim(); let b = parts[1].trim();
  a = _PSG_ALIAS[a] || a; b = _PSG_ALIAS[b] || b;
  return [a, b].sort().join('|');
};

// Markets aceitos no MÉTODO HT-CHUTES.
const HT_CHUTES_STATS = new Set([
  'Chutes 1º Tempo · Casa',
  'Chutes 1º Tempo · Fora',
  'Escanteios 1º Tempo · Casa',
  'Escanteios 1º Tempo · Fora',
]);

// F2.55: baixado de 1.5 → 1.25 pra capturar linhas reais publicadas
// (FAIXA real publica HT shots/corners com odds 1.3-1.5 frequentemente).
// Acima de 1.5 estávamos rejeitando ~90% das HT picks do pool.
const HT_MIN_ODD = 1.25;
const HT_MAX_ODD = 4.0;

// F2.41: aceita stats normalizados ht_shots_home/away, ht_corners_home/away (lowercase do backend),
// além dos labels canonical "Chutes 1º Tempo · Casa" etc usados pelos tipsters tradutores.
// F2.61: "finaliza" como sinônimo de "chute" (PT-BR books usam ambos).
// Spec §13.1 "HT-Finalizações" colapsado em HT-CHUTES pois são o mesmo conceito.
const _HT_STAT_REGEX = /^(ht_(shots|corners|finaliz)_(home|away)|chutes\s*1[ºo]\s*tempo|finaliza[çc]?[õo]?es\s*1[ºo]\s*tempo|escanteios\s*1[ºo]\s*tempo)/i;
const _isHtChutesStat = (s) => HT_CHUTES_STATS.has(s) || _HT_STAT_REGEX.test(String(s || '').trim());

// F2.41: reject only EXPLICIT non-football (tennis/amateur). When league info missing, ALLOW (tests + bet365 picks sem league).
const _TENNIS_OR_AMATEUR = /tennis|tênis|tenis|itf|atp|wta|chall(enger|enge)|roland\s*garros|wimbledon|us\s*open|australian\s*open|french\s*open|\bsub.?\d|m.?\d{2}|w.?\d{2}|\bcategoria\b|amateur|amador|3.?divis|4.?divis|regional|estadual.*juvenil/i;

// F2.66: tennis player surname blocklist (top 50+ ATP/WTA). Detecta quando match
// name contém nome de jogador conhecido — fallback pra quando league info falta.
const _TENNIS_PLAYERS = /\b(djokovic|nadal|federer|alcaraz|sinner|zverev|medvedev|rublev|tsitsipas|ruud|hurkacz|fritz|paul|shelton|fonseca|tirante|carreno\s*busta|michelsen|jodar|teichmann|muchova|swiatek|sabalenka|gauff|rybakina|jabeur|pegula|paolini|krejcikova|navratilova|williams|halep|osaka|raducanu|kvitova|kerber|wozniacki|azarenka|sharapova|ivanovic|li\s*na|barty|schiavone|nishikori|murray|wawrinka|del\s*potro|cilic|isner|querrey|raonic|gasquet|tsonga|monfils|berdych|ferrer|simon|verdasco|youzhny|kohlschreiber|haas|gulbis|llodra|tipsarevic|chardy|robredo|fognini|garin|coria|baghdatis|nalbandian|kuerten|gaudio|moya|kafelnikov|safin|kuznetsov|davydenko|kafelnikov|hingis|capriati|seles|graf|sanchez\s*vicario|navratilova|evert|king|kramer|laver|borg|connors|mcenroe|sampras|agassi|courier|chang|edberg|becker|lendl|wilander|kuerten)\b/i;
const _rejectNonFootball = (p) => {
  const league = (p.league || p.league_label || p.league_name || '').toString();
  if (league && _TENNIS_OR_AMATEUR.test(league)) return true;
  // F2.66: fallback — check match name for tennis player surname
  const match = (p.match || '').toString();
  if (match && _TENNIS_PLAYERS.test(match)) return true;
  return false;
};

export function _filterHtChutesLegs(legs) {
  return (legs || []).filter(p => {
    if (!p || !p.match) return false;
    if (!_isHtChutesStat(p.stat) && !_isHtChutesStat(p.market)) return false;
    // F2.41: bloqueia tênis/amador explicitamente. Se sem league info, allow.
    if (_rejectNonFootball(p)) return false;
    const odd = +p.odd;
    if (!(odd >= HT_MIN_ODD && odd <= HT_MAX_ODD)) return false;
    const prob = +p.prob;
    if (!(prob > 0 && prob <= 1)) return false;
    return true;
  });
}

export function _groupByMatch(legs) {
  const out = new Map();
  for (const p of (legs || [])) {
    if (!p || !p.match) continue;
    const key = _normMatchKey(p.match);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(p);
  }
  return out;
}

// Score interno pra escolher melhor leg quando há duplicatas.
// Privilegia value (EV positivo) sobre prob crua.
const _legScore = (p) => {
  const ev = Math.max(0, +p.ev_pct || 0);
  return (+p.prob || 0) * (1 + ev / 100);
};

// Range thresholds alinhados com FAIXA real (decisão de produto sec 2 do spec).
const TIER_CARDS_MAX        = 100;     // < 100x  → cards
const TIER_CONSERVADOR_MAX  = 10000;   // 100-9999x → conservador
                                       // >= 10000x → agressivo

export function _classifyTier(combined_odd) {
  const odd = +combined_odd;
  if (!Number.isFinite(odd) || odd <= 0) return 'cards';
  if (odd < TIER_CARDS_MAX)       return 'cards';
  if (odd < TIER_CONSERVADOR_MAX) return 'conservador';
  return 'agressivo';
}

// Hash determinístico simples pra card_id (match-based).
const _cardId = (match, method) =>
  `${method}|${_normMatchKey(match)}|${Date.now().toString(36).slice(-4)}`;

export function _buildHtChutesCard(legs) {
  if (!legs || legs.length === 0) return null;

  // Escolhe melhor leg por (stat). Cada stat distinct vira 1 leg do card.
  const bestPerStat = new Map();
  for (const p of legs) {
    const k = p.stat;
    const prev = bestPerStat.get(k);
    if (!prev || _legScore(p) > _legScore(prev)) bestPerStat.set(k, p);
  }
  const chosen = [...bestPerStat.values()];
  if (chosen.length < 3) return null;

  const combined_odd = chosen.reduce((acc, p) => acc * (+p.odd || 1), 1);
  const combined_prob = chosen.reduce((acc, p) => acc * (+p.prob || 0), 1);
  const match = chosen[0].match;
  const ev_pct = +(((combined_prob * combined_odd) - 1) * 100).toFixed(2);

  return {
    card_id: _cardId(match, 'ht_chutes'),
    method: 'ht_chutes',
    match,
    kickoff_iso: chosen[0].kickoff_iso || null,
    legs: chosen,
    n_legs: chosen.length,
    combined_odd: +combined_odd.toFixed(2),
    combined_prob: +combined_prob.toFixed(4),
    ev_pct,
    tier_class: _classifyTier(combined_odd),
  };
}

export const HT_CHUTES_DUPLAS_CAP  = 10;
export const HT_CHUTES_QUADRAS_CAP = 5;

export function buildHtChutes(pool) {
  const filtered = _filterHtChutesLegs(pool);
  const grouped = _groupByMatch(filtered);
  const cards = [];
  for (const [, legs] of grouped) {
    const card = _buildHtChutesCard(legs);
    if (card) cards.push(card);
  }
  cards.sort((a, b) => b.combined_prob - a.combined_prob);
  const duplas  = _pickTopCombos(cards, 2, HT_CHUTES_DUPLAS_CAP);
  const triplas = _pickTopCombos(cards, 3, 8);
  // F2.89: 3-perfil quadras
  const perfilHt = _buildPerfilQuadras(cards);
  const quadras = [perfilHt.conservador, perfilHt.medio, perfilHt.agressivo].filter(Boolean);
  // F2.66c: SEXTAS/SETIMAS pra MEGA tab. HT-CHUTES card odd ~4. Sexta = 4^6 = 4096x
  // (conservador), Setima = 16384x (MEGA), Oitava = 65k (MEGA).
  const quintas = _pickTopCombos(cards, 5, 5);
  const sextas  = _pickTopCombos(cards, 6, 5);
  const setimas = _pickTopCombos(cards, 7, 3);
  const oitavas = _pickTopCombos(cards, 8, 2);
  return { cards, duplas, triplas, quadras, quintas, sextas, setimas, oitavas };
}

// Gera C(arr, k) — enumeração não-recursiva.
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

export function _pickTopCombos(cards, k, maxOut) {
  if (!cards || cards.length < k) return [];
  const out = [];
  for (const combo of _combos(cards, k)) {
    const matchKeys = combo.map(c => _normMatchKey(c.match || ''));
    if (new Set(matchKeys).size !== matchKeys.length) continue;
    const combined_odd  = combo.reduce((acc, c) => acc * (+c.combined_odd || 1), 1);
    const combined_prob = combo.reduce((acc, c) => acc * (+c.combined_prob || 0), 1);
    const item = {
      cards: combo,
      n_cards: combo.length,
      n_legs: combo.reduce((acc, c) => acc + (c.n_legs || 0), 0),
      combined_odd:  +combined_odd.toFixed(2),
      combined_prob: +combined_prob.toFixed(6),
      ev_pct: +((combined_prob * combined_odd - 1) * 100).toFixed(2),
      tier_class: _classifyTier(combined_odd),
    };
    // F2.63: COBERTURA MÃE — para Quadras (k=4), pre-computa as 6 sub-duplas
    // que compõem a cobertura. UI usa pra mostrar "esta quadra cobre N duplas".
    if (k === 4) {
      item.derived_duplas = _buildDerivedDuplas(combo);
    }
    out.push(item);
  }
  // F2.59: sort por combined_prob DESC (combos mais seguros primeiro), EV como tiebreak
  out.sort((a, b) => (b.combined_prob - a.combined_prob) || (b.ev_pct - a.ev_pct));
  return out.slice(0, maxOut);
}

/**
 * F2.89: gera 3 quadras (Conservador/Médio/Agressivo) particionando cards
 * em 3 bins por combined_odd. Cards mais seguros (odd baixo) = Conservador,
 * top odd = Agressivo. SEM sobreposição de jogos entre perfis.
 *
 * Requer >= 12 cards pra ter 4 por perfil. Com menos, distribui o que dá.
 *
 * @returns {conservador: quadra, medio: quadra, agressivo: quadra} (qualquer pode ser null)
 */
export function _buildPerfilQuadras(cards) {
  const out = { conservador: null, medio: null, agressivo: null };
  if (!Array.isArray(cards) || cards.length < 4) return out;
  // ordena por combined_odd ASC (mais seguro primeiro)
  const sorted = [...cards].sort((a, b) => (+a.combined_odd || 0) - (+b.combined_odd || 0));
  const n = sorted.length;
  // distribui em 3 bins. Cada bin precisa ter >= 4 cards pra formar quadra.
  // Se n < 12: prioriza perfis "extremos" (conservador + agressivo) e descarta médio.
  let consPool, medPool, aggPool;
  if (n >= 12) {
    const third = Math.floor(n / 3);
    consPool = sorted.slice(0, 4);              // 4 mais seguros
    medPool  = sorted.slice(third, third + 4);  // 4 médios
    aggPool  = sorted.slice(n - 4, n);           // 4 mais arriscados
  } else if (n >= 8) {
    consPool = sorted.slice(0, 4);
    aggPool  = sorted.slice(n - 4, n);
    medPool  = null;   // pula médio quando pool pequeno
  } else {
    consPool = sorted.slice(0, 4);
    aggPool  = null;
    medPool  = null;
  }
  const make = (group, profile) => {
    if (!group || group.length < 4) return null;
    const matches = group.map(c => _normMatchKey(c.match || ''));
    if (new Set(matches).size !== matches.length) return null;
    const combined_odd  = group.reduce((a, c) => a * (+c.combined_odd || 1), 1);
    const combined_prob = group.reduce((a, c) => a * (+c.combined_prob || 0), 1);
    return {
      cards: group, n_cards: 4,
      n_legs: group.reduce((a, c) => a + (c.n_legs || 0), 0),
      combined_odd:  +combined_odd.toFixed(2),
      combined_prob: +combined_prob.toFixed(6),
      ev_pct: +((combined_prob * combined_odd - 1) * 100).toFixed(2),
      tier_class: _classifyTier(combined_odd),
      _profile: profile,
      derived_duplas: _buildDerivedDuplas(group),
    };
  };
  out.conservador = make(consPool, 'CONSERVADOR');
  out.medio       = make(medPool, 'MÉDIO');
  out.agressivo   = make(aggPool, 'AGRESSIVO');
  return out;
}

/**
 * F2.63: gera todas as sub-duplas (C(4,2)=6) de uma quadra. Frontend usa
 * pra mostrar "Cobertura mãe — esta quadra cobre estas 6 duplas".
 */
export function _buildDerivedDuplas(quadraCards) {
  if (!Array.isArray(quadraCards) || quadraCards.length !== 4) return [];
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const a = quadraCards[i];
      const b = quadraCards[j];
      const combined_odd  = (+a.combined_odd || 1) * (+b.combined_odd || 1);
      const combined_prob = (+a.combined_prob || 0) * (+b.combined_prob || 0);
      out.push({
        card_ids: [a.card_id, b.card_id],
        matches: [a.match, b.match],
        combined_odd:  +combined_odd.toFixed(2),
        combined_prob: +combined_prob.toFixed(6),
        ev_pct: +((combined_prob * combined_odd - 1) * 100).toFixed(2),
        tier_class: _classifyTier(combined_odd),
      });
    }
  }
  out.sort((a, b) => (b.combined_prob - a.combined_prob) || (b.ev_pct - a.ev_pct));
  return out;
}

const _empty = () => ({ cards: [], duplas: [], quadras: [] });

// ─── buildMegaSimples (F2.78) ─────────────────────────────────────────────────
// Card único por match juntando FT (Result + BTTS) + HT (chutes home/away +
// escanteios home/away). 6 legs × ~1.5x avg = ~11x por simples. Combinando 4
// matches diferentes em quadra → ~15k MEGA real.
// Diferente de libertadores (só FT) ou ht_chutes (só HT) — UNIFICA pra max odd.
const MS_MIN_ODD = 1.15;
const MS_MAX_ODD = 5.0;
const _isResultStatMS = (s) => /^1x2$|^result|resultado|match.*result/i.test(s || '');
const _isBttsStatMS   = (s) => /^btts$|both.*teams|ambos.*marcam/i.test(s || '');
const _isHtCorners    = (s) => /^ht_corners_(home|away)$|escanteios.*1[ºo]\s*t/i.test(s || '');
const _isHtShots      = (s) => /^ht_(shots|finaliz)_(home|away)$|chutes.*1[ºo]\s*t|finaliza.*1[ºo]\s*t/i.test(s || '');

function _msBestLegsPerMatch(pool) {
  const byMatch = new Map();
  for (const p of (pool || [])) {
    if (!p || !p.match) continue;
    if (_rejectNonFootball(p)) continue;
    const odd = +p.odd;
    if (!(odd >= MS_MIN_ODD && odd <= MS_MAX_ODD)) continue;
    const prob = +p.prob;
    if (!(prob > 0 && prob <= 1)) continue;
    const sb = `${p.stat || ''} ${p.market || ''}`;
    const isResult = _isResultStatMS(sb);
    const isBtts   = _isBttsStatMS(sb);
    const isHC     = _isHtCorners(sb);
    const isHS     = _isHtShots(sb);
    if (!isResult && !isBtts && !isHC && !isHS) continue;
    const sel = (p.selection || '').toLowerCase().trim();
    if (isResult && /empate|draw|^x$|tie/i.test(sel)) continue;
    if (isBtts && /n.?o|no/i.test(sel) && !/sim|yes/i.test(sel)) continue;
    const key = _normMatchKey(p.match);
    if (!key) continue;
    if (!byMatch.has(key)) {
      byMatch.set(key, { match: p.match, kickoff_iso: p.kickoff_iso, result: null, btts: null, htc_home: null, htc_away: null, hts_home: null, hts_away: null });
    }
    const slot = byMatch.get(key);
    const score = _legScore(p);
    const stat = (p.stat || '').toLowerCase();
    if (isResult && (!slot.result || score > _legScore(slot.result))) slot.result = p;
    if (isBtts   && (!slot.btts   || score > _legScore(slot.btts)))   slot.btts   = p;
    if (isHC && /home/.test(stat) && (!slot.htc_home || score > _legScore(slot.htc_home))) slot.htc_home = p;
    if (isHC && /away/.test(stat) && (!slot.htc_away || score > _legScore(slot.htc_away))) slot.htc_away = p;
    if (isHS && /home/.test(stat) && (!slot.hts_home || score > _legScore(slot.hts_home))) slot.hts_home = p;
    if (isHS && /away/.test(stat) && (!slot.hts_away || score > _legScore(slot.hts_away))) slot.hts_away = p;
  }
  return byMatch;
}

function _msBuildMatchCard(slot) {
  const legs = [];
  for (const k of ['result','btts','htc_home','htc_away','hts_home','hts_away']) {
    if (slot[k]) legs.push(slot[k]);
  }
  if (legs.length < 3) return null;  // precisa de no minimo 3 mercados pra valer
  const combined_odd  = +legs.reduce((a, l) => a * +l.odd, 1).toFixed(2);
  const combined_prob = +legs.reduce((a, l) => a * +l.prob, 1).toFixed(6);
  const ev_pct = +(((combined_prob * combined_odd) - 1) * 100).toFixed(2);
  return {
    card_id: _cardId(slot.match, 'mega_simples'),
    method: 'mega_simples',
    match: slot.match,
    kickoff_iso: slot.kickoff_iso || null,
    legs,
    n_legs: legs.length,
    combined_odd,
    combined_prob,
    ev_pct,
    tier_class: _classifyTier(combined_odd),
  };
}

export function buildMegaSimples(pool) {
  const byMatch = _msBestLegsPerMatch(pool);
  const cards = [];
  for (const [, slot] of byMatch) {
    const card = _msBuildMatchCard(slot);
    if (card) cards.push(card);
  }
  cards.sort((a, b) => (b.combined_odd - a.combined_odd) || (b.combined_prob - a.combined_prob));
  const top = cards.slice(0, 24);
  // Quadras = 4 cards distintos (já garantidos por byMatch)
  const quadras = [];
  for (const combo of _combos(top.slice(0, 14), 4)) {
    const combined_odd  = combo.reduce((a, c) => a * +c.combined_odd, 1);
    const combined_prob = combo.reduce((a, c) => a * +c.combined_prob, 1);
    quadras.push({
      cards: combo,
      n_cards: 4,
      n_legs: combo.reduce((a, c) => a + (c.n_legs || c.legs?.length || 1), 0),
      combined_odd:  +combined_odd.toFixed(2),
      combined_prob: +combined_prob.toFixed(8),
      ev_pct: +(((combined_prob * combined_odd) - 1) * 100).toFixed(2),
      tier_class: _classifyTier(combined_odd),
    });
  }
  quadras.sort((a, b) => b.combined_odd - a.combined_odd);
  const duplas = [];
  for (const combo of _combos(top.slice(0, 12), 2)) {
    const combined_odd  = combo.reduce((a, c) => a * +c.combined_odd, 1);
    const combined_prob = combo.reduce((a, c) => a * +c.combined_prob, 1);
    duplas.push({
      cards: combo, n_cards: 2,
      n_legs: combo.reduce((a, c) => a + (c.n_legs || c.legs?.length || 1), 0),
      combined_odd: +combined_odd.toFixed(2),
      combined_prob: +combined_prob.toFixed(6),
      ev_pct: +(((combined_prob * combined_odd) - 1) * 100).toFixed(2),
      tier_class: _classifyTier(combined_odd),
    });
  }
  duplas.sort((a, b) => b.combined_odd - a.combined_odd);
  return { cards: top, duplas: duplas.slice(0, 10), triplas: [], quadras: quadras.slice(0, 10), quintas: [] };
}

// ─── buildMegaQuadras (F2.70/F2.71) ────────────────────────────────────────
// MÉTODO MEGA QUADRAS: chega em 10000x+ usando QUATRO cards cross-method.
// v2 (F2.71): consome cards JÁ PRODUZIDOS pelos outros builders
// (libertadores, resultado, ht_chutes, faixa_result_btts) — cada card tem
// combined_odd 2-10x; 4 cards bem escolhidos → 10000x+ sem precisar
// sextas/setimas/oitavas.
// F2.72: cada "célula" da quadra pode ser um card OU uma dupla/tripla (combo
// pre-pronto com odd 15-300x). 4 células × 20x avg = 160k+ x → MEGA real.
const MEGA_CELL_MIN_ODD = 5.0;
const MEGA_CELL_MAX_ODD = 500.0;
const MEGA_MIN_COMBINED_ODD = 10000;
const MEGA_QUADRAS_MAX_OUT = 10;
const MEGA_QUINTAS_MAX_OUT = 6;

// Helper: flatten "cells" (cards/duplas/triplas) -> array de match strings cobertos.
function _cellMatches(cell) {
  if (!cell) return [];
  // Card: tem `match` direto
  if (cell.match && (!cell.cards || cell.cards.length === 0)) return [cell.match];
  // Combo: tem `cards` array com objetos {match}
  if (Array.isArray(cell.cards)) return cell.cards.map(c => c.match).filter(Boolean);
  return [];
}

// F2.75: cells = APENAS single-match cards (1 jogo = 1 simples, 4 jogos = 1 quadra).
// Sem duplas/triplas como células — quadra estruturalmente correta = 4 matches distintos.
function _megaQuadrasForMethod(mod) {
  if (!mod) return { quadras: [], quintas: [] };
  const cards = [];
  for (const c of (mod.cards || [])) {
    if (!c.match) continue;
    if (_TENNIS_PLAYERS.test(c.match)) continue;
    const odd = +c.combined_odd;
    if (!(odd >= 1.5 && odd <= 50.0)) continue;
    if (!(+c.combined_prob > 0)) continue;
    cards.push(c);
  }
  if (cards.length < 4) return { quadras: [], quintas: [] };
  // dedupe por match (mantém maior odd)
  const bestPerMatch = new Map();
  for (const c of cards) {
    const key = _normMatchKey(c.match);
    if (!key) continue;
    const prev = bestPerMatch.get(key);
    if (!prev || (+c.combined_odd || 0) > (+prev.combined_odd || 0)) bestPerMatch.set(key, c);
  }
  const candidates = [...bestPerMatch.values()]
    .sort((a, b) => (b.combined_odd - a.combined_odd) || (b.combined_prob - a.combined_prob))
    .slice(0, 18);
  if (candidates.length < 4) return { quadras: [], quintas: [] };
  // Enumera quadras: 4 cards = 4 matches distintos (já garantido por bestPerMatch)
  // F2.75: SEM gate >=10000x — surfar TOP QUADRAS por odd DESC; client tier_class
  // automaticamente coloca quadra na FAIXA/Jackpot/Mega tab pelo combined_odd.
  const quadrasRaw = [];
  for (const combo of _combos(candidates, 4)) {
    const combined_odd  = combo.reduce((a, c) => a * (+c.combined_odd || 1), 1);
    const combined_prob = combo.reduce((a, c) => a * (+c.combined_prob || 0), 1);
    quadrasRaw.push({
      cards: combo,
      n_cards: 4,
      n_legs: combo.reduce((a, c) => a + (c.n_legs || c.legs?.length || 1), 0),
      combined_odd:  +combined_odd.toFixed(2),
      combined_prob: +combined_prob.toFixed(8),
      ev_pct: +(((combined_prob * combined_odd) - 1) * 100).toFixed(2),
      tier_class: _classifyTier(combined_odd),
    });
  }
  const quadras = quadrasRaw
    .sort((a, b) => (b.combined_odd - a.combined_odd))   // top odd primeiro (alimenta MEGA tab)
    .slice(0, MEGA_QUADRAS_MAX_OUT);
  // Quintas = 5 jogos
  const quintasRaw = [];
  for (const combo of _combos(candidates.slice(0, 14), 5)) {
    const combined_odd  = combo.reduce((a, c) => a * (+c.combined_odd || 1), 1);
    const combined_prob = combo.reduce((a, c) => a * (+c.combined_prob || 0), 1);
    quintasRaw.push({
      cards: combo,
      n_cards: 5,
      n_legs: combo.reduce((a, c) => a + (c.n_legs || c.legs?.length || 1), 0),
      combined_odd:  +combined_odd.toFixed(2),
      combined_prob: +combined_prob.toFixed(8),
      ev_pct: +(((combined_prob * combined_odd) - 1) * 100).toFixed(2),
      tier_class: _classifyTier(combined_odd),
    });
  }
  const quintas = quintasRaw
    .sort((a, b) => (b.combined_odd - a.combined_odd))
    .slice(0, MEGA_QUINTAS_MAX_OUT);
  return { quadras, quintas };
}

// F2.74: agora retorna {libertadores, ht_chutes, resultado, faixa_result_btts, chutes}
// cada um com {quadras, quintas} próprias — SEM mistura entre métodos.
export function buildMegaQuadras(builders) {
  const sources = builders && typeof builders === 'object' ? builders : {};
  const out = {};
  for (const [key, mod] of Object.entries(sources)) {
    const r = _megaQuadrasForMethod(mod);
    if (r.quadras.length > 0 || r.quintas.length > 0) out[key] = r;
  }
  return out;
}

export function buildFaixaMethods(annotatedWithAll, tipsterPicksAll) {
  const pool = Array.isArray(annotatedWithAll) ? annotatedWithAll : [];
  // F2.36-1: tipsterPicksAll contém player_shots (legacy tier2 já usa). Merge pra buildChutes encontrar dados.
  const tipsters = Array.isArray(tipsterPicksAll) ? tipsterPicksAll : [];
  const extendedPool = [...pool, ...tipsters];
  let ht_chutes         = _empty();
  let faixa_result_btts = _empty();
  let chutes            = _empty();
  let libertadores      = { cards: [], duplas: [], triplas: [], quadras: [], quintas: [] };
  try {
    ht_chutes = buildHtChutes(pool);
  } catch (e) {
    console.error('[faixaMethods] ht_chutes build failed:', e?.message || e);
  }
  try {
    // F2.58: usa extendedPool (= pool + tipsters) igual libertadores/resultado.
    // Antes só pool deixava match Cruzeiro v Barcelona SC (do tipster) fora.
    faixa_result_btts = buildFaixaResultBtts(extendedPool);
  } catch (e) {
    console.error('[faixaMethods] faixa_result_btts build failed:', e?.message || e);
  }
  try {
    chutes = buildChutes(extendedPool);
  } catch (e) {
    console.error('[faixaMethods] chutes build failed:', e?.message || e);
  }
  try {
    libertadores = buildLibertadoresMegas(extendedPool);
  } catch (e) {
    console.error('[faixaMethods] libertadores build failed:', e?.message || e);
  }
  let resultado = { cards: [], duplas: [], triplas: [], quadras: [], quintas: [] };
  try {
    resultado = buildResultadoCombos(extendedPool);
  } catch (e) {
    console.error('[faixaMethods] resultado build failed:', e?.message || e);
  }
  // F2.62: SUPERODD — single legs boostadas (Crie sua Aposta, Aposta Aumentada, Boosts).
  let superodd = { cards: [] };
  try {
    superodd = buildSuperOdd(extendedPool);
  } catch (e) {
    console.error('[faixaMethods] superodd build failed:', e?.message || e);
  }
  // F2.79: removido mega_simples (misturava FT+HT). Cada método agora gera suas
  // próprias quadras puras. mega_quadras consolida per-method.
  let mega_quadras = {};
  try {
    mega_quadras = buildMegaQuadras({ libertadores, resultado, ht_chutes, faixa_result_btts, chutes });
  } catch (e) {
    console.error('[faixaMethods] mega_quadras build failed:', e?.message || e);
  }
  return { ht_chutes, faixa_result_btts, chutes, libertadores, resultado, superodd, mega_quadras };
}

// ─── buildSuperOdd (F2.62) ────────────────────────────────────────────────────
// MÉTODO SUPERODD: singles boostadas estilo "Crie sua Aposta" / "Aposta Aumentada".
// Aceita 2 tipos de input:
//   1) Picks com flag _is_boost=true ou source='boosts' (do scraper bet365)
//   2) Picks com market contendo "boost/turbinada/aumentada/super odd"
// Cada card = 1 leg. Sort por EV DESC (boosts são +EV por definição).

const SUPERODD_MIN_ODD = 1.5;
const SUPERODD_MAX_ODD = 8.0;
const SUPERODD_CARDS_CAP = 10;

export function _isSuperOddLeg(p) {
  if (!p || !p.match) return false;
  // Source/flag explicit
  if (p._is_boost === true || p.is_boost === true) return true;
  if (/^boost/i.test(p.source || '')) return true;
  if (p.odd_source === 'boosts') return true;
  // Market/selection contém boost markers
  const blob = `${p.market || ''} ${p.selection || ''} ${p.channel_name || ''}`.toLowerCase();
  if (/(\bboost\w*|\bturbinad\w*|\baumentad\w*|super[\s-]?odd|odd[\s-]?turbinada|crie[\s-]?sua[\s-]?aposta|criar[\s-]?aposta)/i.test(blob)) {
    return true;
  }
  return false;
}

export function buildSuperOdd(pool) {
  const filtered = (pool || []).filter(p => {
    if (!_isSuperOddLeg(p)) return false;
    const odd = +p.odd;
    if (!(odd >= SUPERODD_MIN_ODD && odd <= SUPERODD_MAX_ODD)) return false;
    const prob = +p.prob;
    if (!(prob > 0 && prob <= 1)) return false;
    return true;
  });
  // Dedup por (match, market+line+direction) — mantém melhor EV
  const bySig = new Map();
  for (const p of filtered) {
    const sig = `${_normMatchKey(p.match)}|${(p.market || '').toLowerCase()}|${p.line ?? ''}|${p.direction ?? ''}`;
    const prev = bySig.get(sig);
    if (!prev || (p.ev_pct || 0) > (prev.ev_pct || 0)) bySig.set(sig, p);
  }
  const cards = [...bySig.values()].map(leg => ({
    card_id: `superodd|${_normMatchKey(leg.match)}|${(leg.market || '').toLowerCase()}|${Date.now().toString(36).slice(-4)}`,
    method: 'superodd',
    match: leg.match,
    kickoff_iso: leg.kickoff_iso || null,
    legs: [leg],
    n_legs: 1,
    combined_odd: +(+leg.odd || 1).toFixed(2),
    combined_prob: +(+leg.prob || 0).toFixed(4),
    ev_pct: +(((+leg.prob || 0) * (+leg.odd || 0) - 1) * 100).toFixed(2),
    tier_class: _classifyTier(+leg.odd || 0),
  }));
  cards.sort((a, b) => (b.ev_pct - a.ev_pct) || (b.combined_prob - a.combined_prob));
  return { cards: cards.slice(0, SUPERODD_CARDS_CAP) };
}

// ─── buildResultadoCombos (F2.41) ──────────────────────────────────────────
// Combos puros 1X2 cross-match — sem BTTS, sem escanteios. Apenas vencedores.
// Pega Casa Vence ou Fora Vence (skip Empate) por match de major football.
export function buildResultadoCombos(pool) {
  const byMatch = new Map();
  for (const p of (pool || [])) {
    if (!p || !p.match) continue;
    if (_rejectNonFootball(p)) continue;  // F2.66 anti-tennis
    if (!_isLibMajor(p)) continue;
    const odd = +p.odd;
    if (!(odd >= 1.15 && odd <= 8.0)) continue;
    const prob = +p.prob;
    if (!(prob > 0 && prob <= 1)) continue;
    const isResult = _isResultStat(p.stat) || _isResultStat(p.market);
    if (!isResult) continue;
    const sel = (p.selection || '').toLowerCase().trim();
    if (/empate|draw|^x$|tie/i.test(sel)) continue;     // skip Empate
    const key = _normMatchKey(p.match);
    if (!key) continue;
    const prev = byMatch.get(key);
    if (!prev || _legScore(p) > _legScore(prev.leg)) byMatch.set(key, { match: p.match, kickoff_iso: p.kickoff_iso, leg: p });
  }
  const cards = [];
  for (const [, slot] of byMatch) {
    const leg = slot.leg;
    cards.push({
      card_id: _cardId(slot.match, 'resultado'),
      method: 'resultado',
      match: slot.match,
      kickoff_iso: slot.kickoff_iso || null,
      legs: [leg],
      n_legs: 1,
      combined_odd: +(+leg.odd).toFixed(2),
      combined_prob: +(+leg.prob).toFixed(4),
      ev_pct: +(((+leg.prob) * (+leg.odd) - 1) * 100).toFixed(2),
      tier_class: _classifyTier(+leg.odd),
    });
  }
  // F2.59: sort por combined_prob DESC (FAIXA logic — favoritos primeiro)
  cards.sort((a, b) => (b.combined_prob - a.combined_prob) || (b.ev_pct - a.ev_pct));
  const duplas  = _libCombos(cards, 2, 15, 'DUPLA');
  const triplas = _libCombos(cards, 3, 10, 'TRIPLA');
  // F2.89: 3-perfil quadras
  const perfilRes = _buildPerfilQuadras(cards);
  const quadras = [perfilRes.conservador, perfilRes.medio, perfilRes.agressivo].filter(Boolean);
  const quintas = _libCombos(cards, 5, 5,  'QUINTA');
  const sextas  = _libCombos(cards, 6, 5,  'SEXTA');
  const setimas = _libCombos(cards, 7, 3,  'SÉTIMA');
  const oitavas = _libCombos(cards, 8, 2,  'OITAVA');
  return { cards: cards.slice(0, 20), duplas, triplas, quadras, quintas, sextas, setimas, oitavas };
}

// ─── buildLibertadoresMegas (F2.40) ────────────────────────────────────────
// User feedback: filtering produzia 1 card só. Em vez disso, GERAR megas REAIS
// combinando 4-6 jogos top-tier com mix de Result + BTTS.
// Source: pool de major football. Por match pega 2 picks (Casa Vence + BTTS Sim).
// Output: Simples (1 jogo, 2 legs), Duplas, Triplas, Quadras, Quintas, Sextas.

const LIB_MIN_ODD = 1.2;
const LIB_MAX_ODD = 12.0;

// F2.43: whitelist EXPANDIDA — todas as competições major + nacionais relevantes.
// Cobre 30+ ligas, incluindo: continentais (Libertadores, Sudamericana, Champions,
// Europa, Conference, AFC, CAF), top-5 europeias + suas divisões B, Brasileiras
// (A/B/C/D + Copa + estaduais), sul-americanas, México, EUA, Ásia top, Africa.
const _LIB_MAJOR_LEAGUES = new RegExp([
  // Continentais
  'libertadores', 'sul.?americana', 'sudamericana',
  'champions', 'europa', 'conference', 'uefa',
  'afc', 'caf', 'concacaf', 'gold.?cup',
  // Brasil
  'brasileirao', 'brasileir.o', 's.rie.[abcd]', 'copa.*do.*brasil',
  'paulista', 'paulist.o', 'carioca', 'mineiro', 'gaucho', 'baiano', 'pernambucano',
  'goiano', 'cearense', 'paranaense', 'catarinense',
  'copa.*verde', 'copa.*nordeste',
  // Top-5 europeias
  'premier.?league', 'efl', 'championship', 'league.?(one|two)',
  'la.?liga', 'segunda', 'copa.*del.*rey',
  'serie.?[ab]', 'coppa.*italia',
  'bundesliga', '2.?bundesliga', 'dfb.?pokal',
  'ligue.?[12]', 'coupe.*de.*france',
  // Outras europeias
  'eredivisie', 'jupiler', 'primeira.*liga', 'liga.?portugal', 'taca.*portugal',
  'super.?lig', 'super.?league', 'allsvenskan', 'tipico', 'austria',
  'scottish', 'rangers', 'celtic', 'efl.?cup',
  // Américas
  'argentina.*primera', 'argentina.*nacional', 'copa.*argentina',
  'chile.*primera', 'colombia.*primera', 'peru.*primera',
  'uruguay.*primera', 'paraguay.*primera', 'ecuador.*primera', 'venezuela',
  'liga.?mx', 'liga.?expansion', 'apertura', 'clausura',
  'mls', 'us.?open.?cup', 'usl',
  // Ásia/Oceania
  'k.?league', 'j.?league', 'a.?league', 'chinese.*super', 'csl',
  'saudi', 'qatar', 'uae', 'jordan',
  // Internacionais
  'world.?cup', 'eliminat.*ria', 'qualifier', 'qualifying',
  'nations.?league', 'friendly.*international',
  // Copas + Open Cup variations
  'copa.?america', 'eurocopa', 'euro.?20',
].join('|'), 'i');

const _isLibMajor = (p) => {
  const league = (p.league || p.league_label || p.league_name || '').toString();
  if (_LIB_MAJOR_LEAGUES.test(league)) return true;
  // bet365 direct sem league mas marcado como futebol
  const src = (p.source || '').toString();
  if (/bet365/i.test(src)) return true;
  return false;
};

function _libBestLegsPerMatch(pool) {
  // Por match, pega: 1X2 (não-Empate) + BTTS Sim + Over 2.5 Goals + Over Corners (F2.75)
  const byMatch = new Map();
  const _isOverGoals = (s) => /total.*goals|total.*gols|^over.?(_|\s)?goals|^totals_goals|over.?2\.5/i.test(s || '');
  const _isOverCorners = (s) => /total.*corners|corners.*ou|^corners|escanteios.*total|over.*escanteios/i.test(s || '');
  for (const p of (pool || [])) {
    if (!p || !p.match) continue;
    if (_rejectNonFootball(p)) continue;
    if (!_isLibMajor(p)) continue;
    const odd = +p.odd;
    if (!(odd >= LIB_MIN_ODD && odd <= LIB_MAX_ODD)) continue;
    const prob = +p.prob;
    if (!(prob > 0 && prob <= 1)) continue;
    const key = _normMatchKey(p.match);
    if (!key) continue;
    const isResult  = _isResultStat(p.stat) || _isResultStat(p.market);
    const isBtts    = _isBttsStat(p.stat)   || _isBttsStat(p.market);
    const statBlob  = `${p.stat || ''} ${p.market || ''}`;
    const isOG      = !isResult && !isBtts && _isOverGoals(statBlob);
    const isOC      = !isResult && !isBtts && !isOG && _isOverCorners(statBlob);
    if (!isResult && !isBtts && !isOG && !isOC) continue;
    const sel = (p.selection || '').toLowerCase().trim();
    const dir = (p.direction || '').toLowerCase();
    if (isResult && /empate|draw|^x$|tie/i.test(sel)) continue;
    if (isBtts && /n.?o|no/i.test(sel) && !/sim|yes/i.test(sel)) continue;
    if (isOG && /under|menos/i.test(`${sel} ${dir}`)) continue;   // skip Under p/ mega over
    if (isOC && /under|menos/i.test(`${sel} ${dir}`)) continue;
    if (!byMatch.has(key)) byMatch.set(key, { match: p.match, kickoff_iso: p.kickoff_iso, result: null, btts: null, og: null, oc: null });
    const slot = byMatch.get(key);
    if (isResult && (!slot.result || _legScore(p) > _legScore(slot.result))) slot.result = p;
    if (isBtts   && (!slot.btts   || _legScore(p) > _legScore(slot.btts)))   slot.btts   = p;
    if (isOG     && (!slot.og     || _legScore(p) > _legScore(slot.og)))     slot.og     = p;
    if (isOC     && (!slot.oc     || _legScore(p) > _legScore(slot.oc)))     slot.oc     = p;
  }
  return byMatch;
}

function _libBuildMatchCard(match, kickoff_iso, result, btts, og, oc) {
  if (!result || !btts) return null;
  // F2.75: legs = [result, btts] + opcionalmente over_goals e over_corners
  const legs = [result, btts];
  if (og) legs.push(og);
  if (oc) legs.push(oc);
  const combined_odd  = +legs.reduce((a, l) => a * +l.odd, 1).toFixed(2);
  const combined_prob = +legs.reduce((a, l) => a * +l.prob, 1).toFixed(4);
  const ev_pct = +(((combined_prob * combined_odd) - 1) * 100).toFixed(2);
  return {
    card_id: _cardId(match, 'libertadores'),
    method: 'libertadores',
    match,
    kickoff_iso: kickoff_iso || null,
    legs,
    n_legs: legs.length,
    combined_odd,
    combined_prob,
    ev_pct,
    tier_class: _classifyTier(combined_odd),
  };
}

// Builds combinations of N cards (cross-match) — variations of _pickTopCombos.
function _libCombos(cards, k, maxOut, kindLabel) {
  if (!cards || cards.length < k) return [];
  const out = [];
  let count = 0;
  for (const combo of _combos(cards, k)) {
    if (count++ >= 2000) break;
    const matchKeys = combo.map(c => _normMatchKey(c.match || ''));
    if (new Set(matchKeys).size !== matchKeys.length) continue;
    const combined_odd  = combo.reduce((acc, c) => acc * (+c.combined_odd || 1), 1);
    const combined_prob = combo.reduce((acc, c) => acc * (+c.combined_prob || 0), 1);
    const item = {
      cards: combo,
      n_cards: combo.length,
      n_legs: combo.reduce((acc, c) => acc + (c.n_legs || 0), 0),
      combined_odd:  +combined_odd.toFixed(2),
      combined_prob: +combined_prob.toFixed(6),
      ev_pct: +((combined_prob * combined_odd - 1) * 100).toFixed(2),
      tier_class: _classifyTier(combined_odd),
      kind: kindLabel,
    };
    // F2.63: cobertura mãe para Quadras
    if (k === 4) item.derived_duplas = _buildDerivedDuplas(combo);
    out.push(item);
  }
  // F2.59: sort por combined_prob DESC (combos mais seguros primeiro), EV como tiebreak
  out.sort((a, b) => (b.combined_prob - a.combined_prob) || (b.ev_pct - a.ev_pct));
  return out.slice(0, maxOut);
}

export function buildLibertadoresMegas(pool) {
  const byMatch = _libBestLegsPerMatch(pool);
  const cards = [];
  for (const [, slot] of byMatch) {
    const card = _libBuildMatchCard(slot.match, slot.kickoff_iso, slot.result, slot.btts, slot.og, slot.oc);
    if (card) cards.push(card);
  }
  // F2.59: sort por combined_prob DESC (FAIXA logic — favoritos primeiro)
  cards.sort((a, b) => (b.combined_prob - a.combined_prob) || (b.ev_pct - a.ev_pct));

  // Gera combinações
  // F2.66c: estendido a SEXTAS/SETIMAS/OITAVAS pra alimentar MEGA tab (>=10000x).
  // Pool atual brasileiro/CONMEBOL: 4 cards × ~4 odd = quintas ~1024x (conservador).
  // Sextas 4^6 = 4096x (ainda conservador), septas 4^7 = 16384x (MEGA!).
  const duplas  = _libCombos(cards, 2, 15, 'DUPLA');
  const triplas = _libCombos(cards, 3, 10, 'TRIPLA');
  // F2.89: 3-perfil quadras (Conservador/Médio/Agressivo) sem sobreposição
  const perfil = _buildPerfilQuadras(cards);
  const quadras = [perfil.conservador, perfil.medio, perfil.agressivo].filter(Boolean);
  const quintas = _libCombos(cards, 5, 5,  'QUINTA');
  const sextas  = _libCombos(cards, 6, 5,  'SEXTA');
  const setimas = _libCombos(cards, 7, 3,  'SÉTIMA');
  const oitavas = _libCombos(cards, 8, 2,  'OITAVA');

  return { cards: cards.slice(0, 20), duplas, triplas, quadras, quintas, sextas, setimas, oitavas };
}

// ─── buildChutes (F2.32) ─────────────────────────────────────────────────────
// MÉTODO CHUTES (FAIXA real): junta 3-4 player_shots props em JOGOS DIFERENTES.
// Cada "card" aqui é 1 leg (1 jogador em 1 jogo). Combinação cruza matches.
// Source: stats com 'PLAYER_SHOTS' ou 'Chutes do Jogador' + direction OVER/Mais.

const CHUTES_MIN_ODD = 1.5;
const CHUTES_MAX_ODD = 15.0;
const CHUTES_CARDS_CAP   = 20;
const CHUTES_DUPLAS_CAP  = 10;
const CHUTES_TRIPLAS_CAP = 8;
const CHUTES_QUADRAS_CAP = 5;

function _isChutesPlayerLeg(p) {
  if (!p || !p.match) return false;
  const blob = `${p.market || ''} ${p.stat || ''}`.toUpperCase();
  const isShots = /PLAYER_?SHOTS?|CHUTES DO JOGADOR|CHUTES A GOL DO JOGADOR/i.test(blob);
  if (!isShots) return false;
  const dir = (p.direction || p.selection || '').toString();
  if (!/(OVER|MAIS|MORE)/i.test(dir)) return false;
  const odd = +p.odd;
  if (!(odd >= CHUTES_MIN_ODD && odd <= CHUTES_MAX_ODD)) return false;
  const prob = +p.prob;
  if (!(prob > 0 && prob <= 1)) return false;
  return true;
}

function _buildChutesCard(leg) {
  const match = leg.match || '';
  const player = leg.player_name || leg.team || '';
  return {
    card_id: `chutes|${_normMatchKey(match)}|${_normMatchKey(player)}|${Date.now().toString(36).slice(-4)}`,
    method: 'chutes',
    match,
    player_name: player,
    kickoff_iso: leg.kickoff_iso || null,
    legs: [leg],
    n_legs: 1,
    combined_odd:  +(+leg.odd || 1).toFixed(2),
    combined_prob: +(+leg.prob || 0).toFixed(4),
    ev_pct: +(((+leg.prob || 0) * (+leg.odd || 0) - 1) * 100).toFixed(2),
    tier_class: _classifyTier(+leg.odd || 0),
  };
}

export function buildChutes(pool) {
  const filtered = (pool || []).filter(_isChutesPlayerLeg);
  // 1 melhor leg por (match + player) — evita duplicatas
  const bestByPlayerMatch = new Map();
  for (const p of filtered) {
    const key = `${_normMatchKey(p.match)}|${_normMatchKey(p.player_name || p.team || '')}`;
    const prev = bestByPlayerMatch.get(key);
    if (!prev || _legScore(p) > _legScore(prev)) bestByPlayerMatch.set(key, p);
  }
  let cards = [...bestByPlayerMatch.values()]
    .map(_buildChutesCard)
    .sort((a, b) => b.combined_prob - a.combined_prob)
    .slice(0, CHUTES_CARDS_CAP);

  // Combos: cross-match obrigatório (cada player_name único + match único).
  const duplas  = _pickTopCombos(cards, 2, CHUTES_DUPLAS_CAP);
  const triplas = _pickTopCombos(cards, 3, CHUTES_TRIPLAS_CAP);
  // F2.89: 3-perfil quadras
  const perfilCh = _buildPerfilQuadras(cards);
  const quadras = [perfilCh.conservador, perfilCh.medio, perfilCh.agressivo].filter(Boolean);

  return { cards, duplas, triplas, quadras };
}

// ─── buildFaixaResultBtts ────────────────────────────────────────────────────

// F2.37: Aceita variações de stat — bet365 direct usa 'h2h'/'btts' lowercase,
// tipster usa 'Resultado Final'/'BTTS'/'Ambos Marcam', model usa '1X2'.
// Antes era Set exato, perdia ~80% dos picks. Agora regex permissive.
const _isResultStat = (s) => /(h2h|1x2|moneyline|match[\s_]?result|resultado|match[\s_]?winner|^winner$)/i.test(String(s || '').trim());
const _isBttsStat   = (s) => /(btts|both[\s_]?teams|ambos.*marcar|ambas.*marcam|both[\s_]?score)/i.test(String(s || '').trim());

// F2.59: 1.3 → 1.20 pra capturar favoritos super claros (Cruzeiro home odd 1.286
// não passava). FAIXA logic: favoritos extremos em odd baixa são picks aceitáveis.
const FAIXA_RB_MIN_ODD = 1.20;
const FAIXA_RB_MAX_ODD = 10.0;
const FAIXA_RB_CARDS_CAP   = 30;
const FAIXA_RB_DUPLAS_CAP  = 20;
const FAIXA_RB_QUADRAS_CAP = 10;

function _filterFaixaResultBttsLegs(legs) {
  return (legs || []).filter(p => {
    if (!p || !p.match) return false;
    // F2.66: bloqueia tennis/amador (era só em HT-CHUTES, agora em FAIXA-RESULT-BTTS também)
    if (_rejectNonFootball(p)) return false;
    const isResult = _isResultStat(p.stat) || _isResultStat(p.market);
    const isBtts   = _isBttsStat(p.stat)   || _isBttsStat(p.market);
    if (!isResult && !isBtts) return false;
    const odd = +p.odd;
    if (!(odd >= FAIXA_RB_MIN_ODD && odd <= FAIXA_RB_MAX_ODD)) return false;
    const prob = +p.prob;
    if (!(prob > 0 && prob <= 1)) return false;
    // tag the leg with the canonical type for downstream pairing
    p.__faixaType = isResult ? 'result' : 'btts';
    return true;
  });
}

// F2.37: gera TODAS as combinações Result × BTTS por match e retorna as melhores por EV.
// FAIXA real publica múltiplos cards por match com seleções diferentes (Empate+BTTS Sim, Casa+BTTS Sim etc).
// Antes: pegava .find() = primeiro qualquer = combinação aleatória → EV negativo sistemático.
// Agora: produz array de cards (1 por par result×btts) com EV calculado, retorna o(s) melhor(es).
// F2.37.1: FAIXA real evita "Empate" no método Result+BTTS — favorece time
// vencedor (Casa Vence / Fora Vence) + BTTS Sim/Não. Empate fica de fora.
const _isDrawSelection = (sel) => /\b(empate|draw|x|tie)\b/i.test(String(sel || '').trim());

function _buildFaixaResultBttsCards(legs) {
  const resultLegs = legs
    .filter(l => l.__faixaType === 'result' || _isResultStat(l.stat) || _isResultStat(l.market))
    .filter(l => !_isDrawSelection(l.selection));  // F2.37.1: exclude Empate
  const bttsLegs   = legs.filter(l => l.__faixaType === 'btts'   || _isBttsStat(l.stat)   || _isBttsStat(l.market));
  if (resultLegs.length === 0 || bttsLegs.length === 0) return [];

  const out = [];
  for (const r of resultLegs) {
    for (const b of bttsLegs) {
      const chosen = [r, b];
      const combined_odd  = chosen.reduce((acc, p) => acc * (+p.odd  || 1), 1);
      const combined_prob = chosen.reduce((acc, p) => acc * (+p.prob || 0), 1);
      const ev_pct = +(((combined_prob * combined_odd) - 1) * 100).toFixed(2);
      // F2.59: PROB-BASED filter (FAIXA logic real). Antes filtrava EV; agora aceita
      // combo se prob_combinada >= 12% (favoritos stackeados). FAIXA real vende
      // "combos seguros" não +EV bets — alta prob × odd média > EV positivo.
      // Bloqueia só combos manifestamente improváveis (<12%) ou EV catastrófico (<-85).
      if (combined_prob < 0.12) continue;
      // F2.66: aperta EV cutoff -85 → -40. Combos com EV < -40% (ex: Andorra v Iraq
      // Iraq+BTTS-Não EV -41%) são manifestamente ruins, não devem aparecer como top.
      if (ev_pct < -40) continue;
      const match = chosen[0].match;
      out.push({
        card_id: _cardId(match, 'faixa_result_btts'),
        method: 'faixa_result_btts',
        match,
        kickoff_iso: chosen[0].kickoff_iso || null,
        legs: chosen,
        n_legs: 2,
        combined_odd:  +combined_odd.toFixed(2),
        combined_prob: +combined_prob.toFixed(4),
        ev_pct,
        tier_class: _classifyTier(combined_odd),
      });
    }
  }
  return out;
}

export function buildFaixaResultBtts(pool) {
  const filtered = _filterFaixaResultBttsLegs(pool);
  const grouped  = _groupByMatch(filtered);
  const cards = [];
  for (const [, legs] of grouped) {
    const matchCards = _buildFaixaResultBttsCards(legs);
    cards.push(...matchCards);
  }
  // F2.59: sort por PROB DESC primeiro (FAIXA logic — combos seguros primeiro),
  // depois EV DESC pra tiebreak. Antes era EV first (escolhia combos arriscados).
  cards.sort((a, b) => (b.combined_prob - a.combined_prob) || (b.ev_pct - a.ev_pct));
  const capped = cards.slice(0, FAIXA_RB_CARDS_CAP);
  const duplas  = _pickTopCombos(capped, 2, FAIXA_RB_DUPLAS_CAP);
  const triplas = _pickTopCombos(capped, 3, 12);
  // F2.89: 3-perfil quadras
  const perfilRb = _buildPerfilQuadras(capped);
  const quadras = [perfilRb.conservador, perfilRb.medio, perfilRb.agressivo].filter(Boolean);
  // F2.66c: estendido a QUINTAS/SEXTAS/SETIMAS pra MEGA tab.
  // FAIXA RB card odd ~3.5. Sexta = 3.5^6 = 1838x (conservador),
  // Setima = 6433x (conservador), Oitava = 22517x (MEGA!).
  const quintas = _pickTopCombos(capped, 5, 8);
  const sextas  = _pickTopCombos(capped, 6, 5);
  const setimas = _pickTopCombos(capped, 7, 3);
  const oitavas = _pickTopCombos(capped, 8, 2);
  return { cards: capped, duplas, triplas, quadras, quintas, sextas, setimas, oitavas };
}
