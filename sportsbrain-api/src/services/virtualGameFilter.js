// ══════════════════════════════════════════════════════════════════════════
// Virtual Game Filter — P3.9 R6K-F2.2
// ══════════════════════════════════════════════════════════════════════════
//
// Bloqueia jogos virtuais (FIFA/eSports/eSoccer simulation) e cross-sport
// leaks (NBA teams em pick com sport=football) de entrarem no payload Premium.
//
// Filtro existia inline em premiumPicks.js como `_isVirtualOrCrossport`
// desde antes do R6K-F1. Extraído para service em R6K-F2.2 porque:
//   1. Estava declarado tarde demais (L943) — tipsterPicksAll já tinha sido
//      carregado e usado em builders antes do filter rodar.
//   2. Não havia teste isolado.
//   3. Outras fontes (cascadeMega/htMegaCombos/etc) também precisam aplicar.
//
// Filosofia: pure function, sem side-effects. Aceita um pick/leg shape
// heterogêneo e retorna boolean. Combo-level helper drop-by-leg via
// `comboHasVirtual`.
//
// NÃO altera ranking, scoring, threshold global, motor de picks.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Regex de NBA team names. Match em pick com sport=football indica cross-sport
 * leak (NBA team apareceu em tipster Telegram sem flag de basquete).
 *
 * Frozen via Object.freeze não aplicável a RegExp; usar com cuidado.
 */
export const NBA_WORDS = /\b(magic|pistons|lakers|warriors|celtics|heat|bucks|nuggets|suns|sixers|76ers|clippers|nets|knicks|raptors|bulls|cavaliers|cavs|hawks|hornets|wizards|pacers|grizzlies|spurs|mavericks|mavs|rockets|thunder|jazz|trail blazers|blazers|kings|timberwolves|wolves|pelicans|ORL|DET|LAL|LAC|GSW|BOS|MIA|MIL|DEN|PHX|PHI|BKN|NYK|TOR|CHI|CLE|ATL|CHA|WAS|IND|MEM|SAS|DAL|HOU|OKC|UTA|POR|SAC|MIN|NOP)\b/i;

/**
 * Regex para detectar gamertag pattern em nome de time: parêntese com 1+ letra
 * latina seguida de alfanum/espaço/hífen/ponto/apóstrofe.
 *
 * Exemplos que MATCHAM (virtual/FIFA):
 *   "Galatasaray (Viper)"
 *   "PSG (THREAT)"
 *   "Spain (KraftVK)"
 *   "Fenerbahce (MeLToSiK)"
 *   "England (mko1919)"  — começa com letra, segue alfanum
 *   "FC Salzburg (DaVa)"
 *
 * Exemplos que NÃO matcham:
 *   "Flamengo"
 *   "Sao Paulo"
 *   "FC Porto"
 *
 * NOTA: a regex sozinha tem falsos positivos (e.g., "Bayern (II)" =
 * reserva real). Use `isVirtualOrCrossport` que aplica REAL_TEAM_PARENS_WHITELIST
 * para isentar padrões conhecidos de time real.
 */
export const VIRTUAL_PARENS_PATTERN = /\([A-Za-zÀ-ÿ][\w\s\-\.']+\)/;

/**
 * Whitelist de padrões dentro de parênteses que indicam TIME REAL, não virtual.
 * R6K-F2.4: introduzido para reduzir falsos positivos do VIRTUAL_PARENS_PATTERN.
 *
 * Cobertura:
 *   - Reserva/B-team: (II), (III), (B), (C), (D), (Reserves), (Reserve), (Sub)
 *   - Categorias de base: (U17), (U18), (U19), (U20), (U21), (U23)
 *   - Gênero: (W), (F) — feminino; (M) — masculino quando explicitado
 *   - Abreviações de federação: (CF), (FC), (SC), (AC), (BK)
 *
 * Match completo (anchored com ^...$) — APENAS quando o conteúdo INTEIRO
 * dentro dos parênteses é um padrão real conhecido. Evita matar gamertags
 * que coincidentalmente começam com letra de whitelist.
 *
 * Case-insensitive.
 */
export const REAL_TEAM_PARENS_WHITELIST = /^\((II|III|IV|V|VI|B|C|D|W|F|M|U1[5-9]|U2[0-3]|Reserves?|Sub|CF|FC|SC|AC|BK|EC|RC|SE|GE|AA|AD|AE)\)$/i;

/**
 * Decide se um pick/leg é virtual ou cross-sport.
 *
 * @param {object|null} p — pick/leg com pelo menos { home_team?, away_team?, match? }
 * @param {object} [opts]
 * @param {string} [opts.sport='football'] — esporte do contexto. NBA cross-sport
 *   check só aplica se sport === 'football'.
 * @returns {boolean}
 */
/**
 * Extrai TODOS os conteúdos dentro de parênteses de uma string.
 * Para "Bayern Munich (II) v Real Madrid (B)" retorna ["(II)", "(B)"].
 */
function extractAllParens(s) {
  if (!s) return [];
  const matches = String(s).match(/\([A-Za-zÀ-ÿ][\w\s\-\.']+\)/g);
  return matches || [];
}

/**
 * Verifica se uma string contém match de gamertag NÃO-whitelisted.
 * Retorna true se houver parens que NÃO é padrão real conhecido.
 * R6K-F2.4: introduzido para suportar whitelist sem falsos positivos.
 */
function hasNonWhitelistedParens(s) {
  const allParens = extractAllParens(s);
  if (allParens.length === 0) return false;
  for (const paren of allParens) {
    if (!REAL_TEAM_PARENS_WHITELIST.test(paren)) return true;
  }
  return false;
}

export function isVirtualOrCrossport(p, opts = {}) {
  if (!p || typeof p !== 'object') return false;
  const sport = opts.sport ?? 'football';
  const h = String(p.home_team ?? '');
  const a = String(p.away_team ?? '');
  const m = String(p.match ?? '');
  // Virtual/FIFA: parêntese com player name em qualquer um dos 3 campos,
  // mas isenta padrões REAIS conhecidos via REAL_TEAM_PARENS_WHITELIST.
  if (hasNonWhitelistedParens(h) || hasNonWhitelistedParens(a) || hasNonWhitelistedParens(m)) {
    return true;
  }
  // Cross-sport: NBA team names em pick com sport=football
  if (sport === 'football' && (NBA_WORDS.test(h) || NBA_WORDS.test(a) || NBA_WORDS.test(m))) {
    return true;
  }
  return false;
}

/**
 * Decide se um combo deve ser bloqueado por ter QUALQUER leg virtual/crossport.
 *
 * @param {object|null} combo — combo com { legs?: object[] }
 * @param {object} [opts]
 * @returns {boolean} true se combo tem pelo menos 1 leg virtual
 */
export function comboHasVirtual(combo, opts = {}) {
  if (!combo || typeof combo !== 'object') return false;
  const legs = combo.legs;
  if (!Array.isArray(legs)) return false;
  for (const l of legs) {
    if (isVirtualOrCrossport(l, opts)) return true;
  }
  return false;
}
