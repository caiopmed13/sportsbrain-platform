// ══════════════════════════════════════════════════════════════════════════
// Premium Risk Tags — P3.9 R6K-F2
// ══════════════════════════════════════════════════════════════════════════
//
// Conjunto de 16 tags (não-exaustivas, podem coexistir) que descrevem o
// perfil de risco/origem de um pick ou combo. Usadas pelo frontend para
// renderizar badges secundárias que complementam o math_verdict.
//
// "Annotate, don't filter": tags são INFORMATIVAS — não bloqueiam o item de
// aparecer no payload. O filtro continua apenas no gate R6K-D dos singles.
//
// Tags suportadas (alphabetical):
//   - ALTA_VARIANCIA         — mercado em ALTA_VARIANCIA_AUTO_MARKETS
//   - CORRECT_SCORE          — mercado é Correct Score
//   - DRAW_NO_BET            — mercado é Draw No Bet
//   - EV_AGREGADO_NEGATIVO   — combo.ev_pct < 0
//   - EV_NEGATIVO            — ev_pct < 0  (ajuste #1: QUALQUER ev<0)
//   - EV_NEUTRO              — ev_pct === 0
//   - EV_POSITIVO            — ev_pct > 0
//   - FAIXA                  — origem faixa_mirror / is_faixa
//   - HISTORICO_FORTE        — wr_history alta (preenchido pelo R6K-F3)
//   - HT_FT                  — mercado HT/FT
//   - JACKPOT                — tier3 (jackpot pool)
//   - LAB                    — sempre presente (LAB-only product)
//   - MEGA                   — tier4 (mega jackpot)
//   - MEGA_ILUSORIO          — long_shot + EV_AGREGADO_NEGATIVO
//   - TELEGRAM_STYLE         — origem telegram tipster
//   - WATCH                  — ALTA_VARIANCIA OU EV_AGREGADO_NEGATIVO
//
// AJUSTE OBRIGATÓRIO #1 (operador):
//   EV_NEGATIVO = QUALQUER ev_pct < 0 (não restrito a [-5, 0)). A "gravidade"
//   é informada pelo math_verdict ('fair' suave / 'trap' forte).
//
// CONSTANTE ALTA_VARIANCIA_AUTO_MARKETS = ['CORRECT_SCORE', 'HT_FT']
//   DRAW_NO_BET NÃO entra automaticamente em ALTA_VARIANCIA — DNB tem baixa
//   variância (alta probabilidade implícita, recompensa moderada).
//
// NÃO altera ranking, scoring, threshold global, motor de picks.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Conjunto fechado de todas as tags suportadas. Frozen.
 */
export const RISK_TAGS = Object.freeze([
  'LAB',
  'WATCH',
  'EV_POSITIVO',
  'EV_NEUTRO',
  'EV_NEGATIVO',
  'EV_AGREGADO_NEGATIVO',
  'ALTA_VARIANCIA',
  'MEGA_ILUSORIO',
  'FAIXA',
  'JACKPOT',
  'MEGA',
  'CORRECT_SCORE',
  'HT_FT',
  'DRAW_NO_BET',
  'TELEGRAM_STYLE',
  'HISTORICO_FORTE',
]);

/**
 * Mercados que dispararam ALTA_VARIANCIA automaticamente. DRAW_NO_BET NÃO
 * entra (baixa variância apesar de alto risco emocional).
 */
export const ALTA_VARIANCIA_AUTO_MARKETS = Object.freeze(['CORRECT_SCORE', 'HT_FT']);

/**
 * Patterns regex para detectar mercados específicos. Case-insensitive.
 */
const MARKET_PATTERNS = Object.freeze({
  CORRECT_SCORE: /^correct_?score(_?ht|_?2t)?$|placar\s*exato|placar\s*correto/i,
  HT_FT:         /^ht_?ft$|^htft$|intervalo[\s_/-]*final/i,
  DRAW_NO_BET:   /^draw_?no_?bet$|^dnb$|sem\s*empate/i,
});

/**
 * Tags em ordem canônica de severidade (mais crítica primeiro). Usada pelo
 * frontend RiskBadges para priorizar quais tags renderizar quando o espaço
 * é limitado.
 */
export const TAG_ORDER = Object.freeze([
  'MEGA_ILUSORIO',
  'WATCH',
  'ALTA_VARIANCIA',
  'EV_AGREGADO_NEGATIVO',
  'MEGA',
  'JACKPOT',
  'FAIXA',
  'EV_NEGATIVO',
  'EV_NEUTRO',
  'EV_POSITIVO',
  'CORRECT_SCORE',
  'HT_FT',
  'DRAW_NO_BET',
  'TELEGRAM_STYLE',
  'HISTORICO_FORTE',
  'LAB',
]);

// ──────────────────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────────────────

function asString(v) {
  if (v == null) return '';
  return String(v);
}

function matchesPattern(value, pattern) {
  if (!value) return false;
  return pattern.test(asString(value));
}

function evClass(ev_pct) {
  const n = Number(ev_pct);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return 'EV_POSITIVO';
  if (n < 0) return 'EV_NEGATIVO';
  return 'EV_NEUTRO';
}

function detectMarketTags(item) {
  const tags = [];
  const market = item.market ?? item.stat ?? '';
  if (matchesPattern(market, MARKET_PATTERNS.CORRECT_SCORE)) tags.push('CORRECT_SCORE');
  if (matchesPattern(market, MARKET_PATTERNS.HT_FT))         tags.push('HT_FT');
  if (matchesPattern(market, MARKET_PATTERNS.DRAW_NO_BET))   tags.push('DRAW_NO_BET');
  return tags;
}

function detectFaixaTag(item) {
  if (item.is_faixa === true) return true;
  if (item._is_faixa_mirror === true) return true;
  if (item.source === 'faixa_mirror') return true;
  if (Array.isArray(item.legs)) {
    return item.legs.some(l => l && (l._is_faixa_mirror === true || l.source === 'faixa_mirror'));
  }
  return false;
}

function detectTipsterTag(item) {
  if (item._is_telegram_tip === true) return true;
  if (item.source === 'telegram_tipster') return true;
  if (item._origin === 'tipster') return true;
  const src = asString(item.source).toLowerCase();
  if (src.startsWith('telegram') || src.startsWith('tipster')) return true;
  return false;
}

function isComboShape(item) {
  return (Array.isArray(item.legs) && item.legs.length > 0)
      || item._is_combo === true
      || item.is_combo === true;
}

function tierTag(item) {
  const tier = item.tier ?? item._tier;
  if (tier === 'tier3') return 'JACKPOT';
  if (tier === 'tier4') return 'MEGA';
  return null;
}

function legHasNegEv(leg) {
  if (!leg || typeof leg !== 'object') return false;
  // faixa_mirror legs são exempt (mesma política do R6K-D)
  if (leg._is_faixa_mirror === true) return false;
  if (leg.source === 'faixa_mirror') return false;
  const n = Number(leg.ev_pct);
  return Number.isFinite(n) && n < 0;
}

// ──────────────────────────────────────────────────────────────────────────
// API pública
// ──────────────────────────────────────────────────────────────────────────

/**
 * Computa o array de risk_tags para um item. Sempre inclui 'LAB'.
 *
 * Regras (aplicadas em qualquer ordem; resultado é dedup):
 *   - LAB                  → sempre
 *   - EV_POSITIVO/NEUTRO/NEGATIVO → de item.ev_pct (ajuste #1: ev<0 dispara)
 *   - EV_AGREGADO_NEGATIVO → se isCombo e item.ev_pct < 0
 *                            OU se nenhuma leg negativa mas algum leg tem
 *                            ev_pct definido e o combo ev<0
 *   - CORRECT_SCORE / HT_FT / DRAW_NO_BET → de market (com fallback p/ stat)
 *   - ALTA_VARIANCIA       → market ∈ ALTA_VARIANCIA_AUTO_MARKETS
 *   - JACKPOT              → tier3
 *   - MEGA                 → tier4
 *   - FAIXA                → faixa_mirror / is_faixa
 *   - TELEGRAM_STYLE       → telegram tipster
 *   - MEGA_ILUSORIO        → design_verdict='long_shot' + EV_AGREGADO_NEGATIVO
 *                            (computado a partir das tags já produzidas)
 *   - WATCH                → ALTA_VARIANCIA OU EV_AGREGADO_NEGATIVO
 *   - HISTORICO_FORTE      → item.wr_history?.strong === true (R6K-F3 popula)
 *
 * @param {object|null} item
 * @returns {string[]}
 */
export function computeRiskTags(item) {
  if (!item || typeof item !== 'object') return ['LAB'];

  const tags = new Set();
  tags.add('LAB');

  // EV scalar do item
  const evTag = evClass(item.ev_pct);
  if (evTag) tags.add(evTag);

  // Mercado
  for (const t of detectMarketTags(item)) tags.add(t);

  // Alta variância automática (CORRECT_SCORE / HT_FT)
  for (const auto of ALTA_VARIANCIA_AUTO_MARKETS) {
    if (tags.has(auto)) {
      tags.add('ALTA_VARIANCIA');
      break;
    }
  }

  // Tier-derivado
  const tt = tierTag(item);
  if (tt) tags.add(tt);

  // Origem
  if (detectFaixaTag(item)) tags.add('FAIXA');
  if (detectTipsterTag(item)) tags.add('TELEGRAM_STYLE');

  // EV agregado negativo (apenas em combos)
  if (isComboShape(item)) {
    const evCombo = Number(item.ev_pct);
    if (Number.isFinite(evCombo) && evCombo < 0) tags.add('EV_AGREGADO_NEGATIVO');
  }

  // MEGA_ILUSORIO: long_shot + EV_AGREGADO_NEGATIVO. design_verdict pode já
  // ter sido anotado pelo premiumVerdict; senão computamos inline (combinada
  // odd alta + EV agregado negativo).
  const isLongShot = item.design_verdict === 'long_shot'
    || (isComboShape(item)
        && Number.isFinite(Number(item.combined_odd))
        && Number(item.combined_odd) >= 500);
  if (isLongShot && tags.has('EV_AGREGADO_NEGATIVO')) {
    tags.add('MEGA_ILUSORIO');
  }

  // WATCH: derivada de alta variância ou EV agregado negativo
  if (tags.has('ALTA_VARIANCIA') || tags.has('EV_AGREGADO_NEGATIVO')) {
    tags.add('WATCH');
  }

  // HISTORICO_FORTE: populado por R6K-F3 (wr_history). Defensive aqui.
  const wr = item.wr_history;
  if (wr && (wr.strong === true || (Number.isFinite(Number(wr.wr)) && Number(wr.wr) >= 0.6 && Number(wr.n) >= 30))) {
    tags.add('HISTORICO_FORTE');
  }

  return Array.from(tags);
}

/**
 * Anota o item com `risk_tags` (in-place, idempotente). Retorna o item.
 *
 * @param {object|null} item
 * @returns {object|null}
 */
export function annotateRiskTags(item) {
  if (!item || typeof item !== 'object') return item;
  item.risk_tags = computeRiskTags(item);
  return item;
}

/**
 * Anota cada item de um array em-place.
 *
 * @param {Array|null} arr
 * @returns {number}
 */
export function annotateRiskTagsArray(arr) {
  if (!Array.isArray(arr)) return 0;
  let count = 0;
  for (const it of arr) {
    if (it && typeof it === 'object') {
      annotateRiskTags(it);
      count++;
    }
  }
  return count;
}

/**
 * Ordena tags conforme TAG_ORDER (mais crítico primeiro). Tags desconhecidas
 * vão para o final. Útil para o frontend renderizar com prioridade.
 *
 * @param {string[]|null} tags
 * @returns {string[]}
 */
export function sortTagsByPriority(tags) {
  if (!Array.isArray(tags)) return [];
  const order = new Map(TAG_ORDER.map((t, i) => [t, i]));
  const FALLBACK = TAG_ORDER.length;
  return [...tags].sort((a, b) => (order.get(a) ?? FALLBACK) - (order.get(b) ?? FALLBACK));
}
