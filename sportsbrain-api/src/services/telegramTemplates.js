// telegramTemplates.js — F2.64
// Helpers para gerar texto formatado pra copiar/colar no Telegram VIP.
// Spec: TELEGRAM-VIP-TEMPLATES.md
//
// Cada método tem um template específico. Output: string única com newlines.

const FOOTER = '🔗 sportsbrain.vercel.app/premium';

function fmtOdd(odd) { return Number(odd || 0).toFixed(2); }
function fmtPct(p) { return Math.round((Number(p) || 0) * 100); }
function fmtEv(ev) { return ev > 0 ? `+${Number(ev).toFixed(1)}` : Number(ev).toFixed(1); }
function fmtKickoff(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day}/${mon} ${hh}:${mm} UTC`;
  } catch { return ''; }
}

function _legLine(leg, idx) {
  const sel = leg.selection || `${leg.market || leg.stat || '?'} ${leg.direction || ''}`.trim();
  return `${idx}️⃣ ${leg.match || '?'}\n   ${sel} @${fmtOdd(leg.odd)}`;
}

/**
 * HT-CHUTES card (3-4 legs). Spec: HT-Chutes tier MVP.
 */
export function generateHtChutesText(card) {
  if (!card) return '';
  const legs = card.legs || [];
  const lines = legs.map((leg, i) => {
    const sel = leg.selection || `${leg.market || leg.stat} ${leg.direction}`.trim();
    return `${i + 1}️⃣ ${sel} @${fmtOdd(leg.odd)}`;
  }).join('\n');
  return [
    '⏱️ HT-CHUTES — 1º Tempo',
    '',
    `⚽ ${card.match}${card.kickoff_iso ? ` (${fmtKickoff(card.kickoff_iso)})` : ''}`,
    `🎯 ${legs.length} legs · Odd combinada @${fmtOdd(card.combined_odd)}`,
    '',
    lines,
    '',
    `📊 Prob combinada: ${fmtPct(card.combined_prob)}% · EV ${fmtEv(card.ev_pct)}%`,
    `💰 Stake: ${card.combined_odd > 100 ? '0.5%' : '1.5%'} banca`,
    '',
    FOOTER,
  ].join('\n');
}

/**
 * FAIXA-Result-BTTS card (2 legs).
 */
export function generateFaixaResultBttsText(card) {
  if (!card) return '';
  const [r, b] = card.legs || [];
  if (!r || !b) return '';
  return [
    '🥷 FAIXA RESULT+BTTS',
    '',
    `⚽ ${card.match}${card.kickoff_iso ? ` (${fmtKickoff(card.kickoff_iso)})` : ''}`,
    `📊 Combinada @${fmtOdd(card.combined_odd)} · Prob ${fmtPct(card.combined_prob)}%`,
    '',
    `1️⃣ Resultado: ${r.selection || r.direction} @${fmtOdd(r.odd)}`,
    `2️⃣ Ambos Marcam: ${b.selection || b.direction} @${fmtOdd(b.odd)}`,
    '',
    `EV ${fmtEv(card.ev_pct)}% · Stake 1.5% banca`,
    '',
    FOOTER,
  ].join('\n');
}

/**
 * CHUTES single (player props).
 */
export function generateChutesText(card) {
  if (!card) return '';
  const leg = (card.legs || [])[0] || {};
  return [
    '🎯 CHUTES — Player Props',
    '',
    `👤 ${card.player_name || leg.player_name || '?'} (${leg.team || ''})`,
    `⚽ ${card.match}${card.kickoff_iso ? ` (${fmtKickoff(card.kickoff_iso)})` : ''}`,
    '',
    `🎯 ${leg.selection || `Mais de ${leg.line || 1.5} chutes`} @${fmtOdd(leg.odd)}`,
    `📊 Prob ${fmtPct(card.combined_prob)}% · EV ${fmtEv(card.ev_pct)}%`,
    leg.analysis ? `\n📝 ${leg.analysis.slice(0, 200)}` : '',
    '',
    `💰 Stake 1% banca`,
    FOOTER,
  ].filter(Boolean).join('\n');
}

/**
 * FUTEBOL TOP (libertadores) / RESULTADO — 1-2 legs.
 */
export function generateFutebolTopText(card, methodLabel = 'FUTEBOL TOP') {
  if (!card) return '';
  const legs = card.legs || [];
  const linesArr = legs.map((leg, i) => {
    const sel = leg.selection || `${leg.market || leg.stat || ''} ${leg.direction || ''}`.trim();
    return `${i + 1}️⃣ ${sel} @${fmtOdd(leg.odd)}`;
  });
  return [
    `⚽ ${methodLabel}`,
    '',
    `🏆 ${card.match}${card.kickoff_iso ? ` (${fmtKickoff(card.kickoff_iso)})` : ''}`,
    `📊 Combinada @${fmtOdd(card.combined_odd)} · Prob ${fmtPct(card.combined_prob)}%`,
    '',
    linesArr.join('\n'),
    '',
    `EV ${fmtEv(card.ev_pct)}% · Stake ${card.combined_odd > 5 ? '0.5%' : '1.5%'} banca`,
    '',
    FOOTER,
  ].join('\n');
}

/**
 * SUPERODD — single boostada.
 */
export function generateSuperOddText(card) {
  if (!card) return '';
  const leg = (card.legs || [])[0] || {};
  return [
    '🚀 SUPER ODD — Aposta Boostada',
    '',
    `⚽ ${card.match}${card.kickoff_iso ? ` (${fmtKickoff(card.kickoff_iso)})` : ''}`,
    `🎯 ${leg.selection || leg.market || '?'} @${fmtOdd(leg.odd)}`,
    `📊 Prob ${fmtPct(card.combined_prob)}% · EV ${fmtEv(card.ev_pct)}%`,
    leg.channel_name ? `📺 ${leg.channel_name}` : '',
    '',
    '💰 Stake 2% banca (boost = max stake)',
    FOOTER,
  ].filter(Boolean).join('\n');
}

/**
 * DUPLA — combina 2 cards de matches diferentes.
 */
export function generateDuplaText(dupla, methodLabel = 'DUPLA') {
  if (!dupla?.cards || dupla.cards.length !== 2) return '';
  const [c1, c2] = dupla.cards;
  return [
    `🥷 ${methodLabel} — 2 jogos`,
    '',
    `⚡ Odd combinada @${fmtOdd(dupla.combined_odd)} · Prob ${fmtPct(dupla.combined_prob)}%`,
    '',
    `1️⃣ ${c1.match} @${fmtOdd(c1.combined_odd)} (${fmtPct(c1.combined_prob)}%)`,
    `2️⃣ ${c2.match} @${fmtOdd(c2.combined_odd)} (${fmtPct(c2.combined_prob)}%)`,
    '',
    `EV ${fmtEv(dupla.ev_pct)}% · Stake 1.5% banca`,
    '',
    FOOTER,
  ].join('\n');
}

/**
 * QUADRA — combina 4 cards. Inclui hint da cobertura mãe.
 */
export function generateQuadraText(quadra, methodLabel = 'QUADRA') {
  if (!quadra?.cards || quadra.cards.length !== 4) return '';
  const lines = quadra.cards.map((c, i) => `${i + 1}️⃣ ${c.match} @${fmtOdd(c.combined_odd)}`).join('\n');
  const coverHint = quadra.derived_duplas?.length
    ? `\n💡 Cobertura mãe: também publica as ${quadra.derived_duplas.length} duplas geradoras.`
    : '';
  return [
    `💎 ${methodLabel} — 4 jogos`,
    '',
    `🎲 Combinada @${fmtOdd(quadra.combined_odd)} · Prob ${fmtPct(quadra.combined_prob)}%`,
    '',
    lines,
    '',
    `EV ${fmtEv(quadra.ev_pct)}% · Stake 0.5% banca`,
    coverHint,
    '',
    FOOTER,
  ].filter(Boolean).join('\n');
}

/**
 * Despacha pra função certa por method/n_legs.
 */
export function generateTelegramText(item, options = {}) {
  if (!item) return '';
  const method = (item.method || options.method || '').toLowerCase();
  // Duplas/Quadras (sem method, usam .cards)
  if (Array.isArray(item.cards) && item.cards.length > 0 && item.cards[0]?.match) {
    if (item.cards.length === 2) return generateDuplaText(item, options.label || 'DUPLA');
    if (item.cards.length === 4) return generateQuadraText(item, options.label || 'QUADRA');
  }
  // Cards single (têm .legs direto)
  switch (method) {
    case 'ht_chutes':         return generateHtChutesText(item);
    case 'faixa_result_btts': return generateFaixaResultBttsText(item);
    case 'chutes':            return generateChutesText(item);
    case 'libertadores':      return generateFutebolTopText(item, 'FUTEBOL TOP');
    case 'resultado':         return generateFutebolTopText(item, 'RESULTADO');
    case 'superodd':          return generateSuperOddText(item);
    default:                  return generateFutebolTopText(item, 'PICK');
  }
}

/**
 * Enriquece faixa_methods adicionando .telegram_text em cada card/dupla/quadra.
 */
export function withTelegramTemplates(faixaMethods) {
  if (!faixaMethods || typeof faixaMethods !== 'object') return faixaMethods;
  const enrich = (item, method) => ({ ...item, telegram_text: generateTelegramText({ ...item, method }) });
  const out = {};
  for (const [methodName, group] of Object.entries(faixaMethods)) {
    if (!group || typeof group !== 'object') { out[methodName] = group; continue; }
    out[methodName] = {
      ...group,
      cards:    Array.isArray(group.cards)    ? group.cards.map(c => enrich(c, methodName)) : group.cards,
      duplas:   Array.isArray(group.duplas)   ? group.duplas.map(d => ({ ...d, telegram_text: generateDuplaText(d, `DUPLA ${methodName.toUpperCase()}`) })) : group.duplas,
      triplas:  Array.isArray(group.triplas)  ? group.triplas : group.triplas,
      quadras:  Array.isArray(group.quadras)  ? group.quadras.map(q => ({ ...q, telegram_text: generateQuadraText(q, `QUADRA ${methodName.toUpperCase()}`) })) : group.quadras,
      quintas:  group.quintas,
    };
  }
  return out;
}
