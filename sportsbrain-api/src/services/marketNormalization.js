/**
 * marketNormalization.js
 * =============================================================================
 * Pure helpers that normalize market/selection/period/player names to canonical
 * keys used as dedup IDs in the market_availability table (P3.5 / DM3).
 *
 * All functions are sync and side-effect-free.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Market name → canonical key
// ---------------------------------------------------------------------------

const MARKET_MAP = [
  // Match result / 1X2
  [/^(match.?winner|1x2|moneyline|resultado.?final|vencedor|resultado|1x2)$/i, 'match_winner'],

  // BTTS / Both Teams To Score
  [/^(btts|both.?teams?.?to.?score|ambas?.?marcam?|ggtg|gg)$/i, 'btts'],

  // Double chance
  [/^(double.?chance|dupla.?chance)$/i, 'double_chance'],

  // Draw No Bet
  [/^(draw.?no.?bet|dnb|empate.?sem.?aposta)$/i, 'draw_no_bet'],

  // Total goals (generic)
  [/^(total.?gols?|total.?goals?|over.?under|mais.?menos?)$/i, 'total_goals'],
  [/^(total.?gols?.*match|match.?goals?)$/i, 'total_goals'],

  // Asian handicap
  [/^(asian.?handicap|handicap.?asi.tico|ah)$/i, 'asian_handicap'],

  // European handicap
  [/^(european.?handicap|handicap.?europeu|eh)$/i, 'european_handicap'],

  // HT/FT
  [/^(ht.?ft|halftime.?fulltime|intervalo.?final)$/i, 'ht_ft'],

  // First half result
  [/^(1st?.?half.?result|resultado.?1.?.?tempo|1t|ht.?result)$/i, 'ht_result'],

  // Corners — total
  [/^(total.?corners?|escanteios?.?total)$/i, 'corners_total'],

  // Corners — 1st half
  [/^(corners?.?(1st?|first|1.?.?half|1t)|1st?.?half.?corners?|escanteios?.?1.?.?tempo)$/i, 'corners_1h'],

  // Corners — 2nd half
  [/^(corners?.?(2nd?|second|2.?.?half|2t)|2nd?.?half.?corners?|escanteios?.?2.?.?tempo)$/i, 'corners_2h'],

  // Shots on target total
  [/^(shots?.?on.?target|chutes?.?ao.?gol|total.?shots?)$/i, 'shots_on_target'],

  // Shots — 1st half
  [/^(shots?.*1.?.?half|chutes?.*1.?.?tempo|1h.?shots?)$/i, 'shots_1h'],

  // Cards
  [/^(cards?|bookings?|yellow.?cards?|cartes?|amarelos?)$/i, 'cards_total'],

  // Player props
  [/^(player.?points?|pontos?.?jogador)$/i, 'player_points'],
  [/^(player.?rebounds?|rebotes?.?jogador)$/i, 'player_rebounds'],
  [/^(player.?assists?|assistencias?.?jogador)$/i, 'player_assists'],
  [/^(player.?shots?|chutes?.?jogador)$/i, 'player_shots'],
  [/^(player.?shots?.?on.?target|player.?sot)$/i, 'player_shots_on_target'],
  [/^(player.?3.?pointers?|arremessos?.?3.?pontos?)$/i, 'player_3pointers'],
  [/^(player.?blocks?|tocos?|player.?steals?)$/i, 'player_blocks'],

  // Basketball total points
  [/^(total.?points?|pontos?.?total|nba.?total)$/i, 'total_points'],

  // Correct score
  [/^(correct.?score|placar.?exato|resultado.?exato)$/i, 'correct_score'],

  // Anytime goalscorer
  [/^(anytime.?goalscorer|marcar.?quando.?for|artilheiro)$/i, 'anytime_goalscorer'],

  // Next goalscorer
  [/^(next.?goalscorer|pr.ximo.?gol)$/i, 'next_goalscorer'],

  // Outright / winner
  [/^(outright|winner|campe.o|vencedor.?torneio)$/i, 'outright_winner'],

  // BINGO (SportsBrain internal — chutes 1T multi)
  [/^bingo/i, 'bingo_1h_shots'],

  // HT method (SportsBrain internal)
  [/^ht_method|^ht$/i, 'ht_method'],

  // Result + BTTS combo
  [/result.?btts|btts.?result/i, 'result_btts'],
];

/**
 * Converts a raw market name to a canonical underscore_key.
 * Falls back to slugified original if no pattern matches.
 *
 * @param {string} market
 * @returns {string}
 */
export function normalizeMarketName(market) {
  if (!market) return 'unknown_market';
  const str = String(market).trim();
  for (const [re, canonical] of MARKET_MAP) {
    if (re.test(str)) return canonical;
  }
  // Fallback: slugify
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'unknown_market';
}

// ---------------------------------------------------------------------------
// Selection name → canonical key
// ---------------------------------------------------------------------------

const SELECTION_MAP = [
  // Home win
  [/^(home|1|casa|mandante|time.?da.?casa|h)$/i, 'home'],

  // Away win
  [/^(away|2|fora|visitante|time.?visit|a)$/i, 'away'],

  // Draw
  [/^(draw|empate|x|tie)$/i, 'draw'],

  // BTTS Yes
  [/^(yes|sim|gg|btts.?yes|yes.?btts|both.?score)$/i, 'yes'],

  // BTTS No
  [/^(no|n.o|ng|btts.?no|no.?btts|not.?both)$/i, 'no'],

  // Over
  [/^(over|mais|acima|m.?|o)$/i, 'over'],

  // Under
  [/^(under|menos|abaixo|u)$/i, 'under'],

  // Odd / Even
  [/^(odd|.mpar)$/i, 'odd'],
  [/^(even|par)$/i, 'even'],

  // 1X (home or draw)
  [/^(1x|1.?or.?x|home.?or.?draw|casa.?ou.?empate)$/i, '1x'],

  // X2 (draw or away)
  [/^(x2|x.?or.?2|draw.?or.?away|empate.?ou.?fora)$/i, 'x2'],

  // 12 (home or away)
  [/^(12|1.?or.?2|home.?or.?away|casa.?ou.?fora)$/i, '12'],
];

/**
 * Converts a raw selection name to a canonical key.
 * Falls back to slugified original.
 *
 * @param {string} selection
 * @returns {string}
 */
export function normalizeSelectionName(selection) {
  if (!selection) return '';
  const str = String(selection).trim();
  for (const [re, canonical] of SELECTION_MAP) {
    if (re.test(str)) return canonical;
  }
  // Fallback: slugify
  return str
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30) || '';
}

// ---------------------------------------------------------------------------
// Period → canonical key
// ---------------------------------------------------------------------------

/**
 * Normalizes a period string to a short canonical key.
 *
 * @param {string|null} period
 * @returns {string|null}
 */
export function normalizePeriod(period) {
  if (!period) return null;
  const s = String(period).trim().toLowerCase();
  if (/^(ft|full.?time|90|full|normal.?time)$/.test(s)) return 'ft';
  if (/^(1h|1st|first|1t|1\.?half|ht|halftime)$/.test(s)) return '1h';
  if (/^(2h|2nd|second|2t|2\.?half|second.?half)$/.test(s)) return '2h';
  if (/^(q1|first.?quarter|1st?.?quarter)$/.test(s)) return 'q1';
  if (/^(q2|second.?quarter)$/.test(s)) return 'q2';
  if (/^(q3|third.?quarter)$/.test(s)) return 'q3';
  if (/^(q4|fourth.?quarter)$/.test(s)) return 'q4';
  if (/^(et|extra.?time|aet|pens?)$/.test(s)) return 'et';
  // Unknown but present
  return s.replace(/[^a-z0-9]/g, '').slice(0, 10) || null;
}

// ---------------------------------------------------------------------------
// Player name → normalized (lowercase, trimmed)
// ---------------------------------------------------------------------------

/**
 * Normalizes a player/team name for storage and lookup.
 * Removes accents, lowercases, strips extra spaces.
 *
 * @param {string|null} name
 * @returns {string}
 */
export function normalizePlayerName(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    // Normalize common accented chars
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Remove punctuation except hyphens
    .replace(/[^a-z0-9 \-]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Line → normalized number
// ---------------------------------------------------------------------------

/**
 * Parses and normalizes a betting line value.
 * Returns null for invalid/missing values.
 *
 * @param {any} line
 * @returns {number|null}
 */
export function normalizeLine(line) {
  if (line == null) return null;
  const n = parseFloat(line);
  if (isNaN(n)) return null;
  // Round to nearest 0.5 to normalize e.g. 2.499 → 2.5
  return Math.round(n * 2) / 2;
}
