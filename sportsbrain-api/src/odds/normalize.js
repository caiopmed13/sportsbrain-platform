// ══════════════════════════════════════════════════════════════════════════
// Normalization: team names, league mapping, event IDs
// ══════════════════════════════════════════════════════════════════════════
// Objetivo: casar jogos vindos de scrapers diferentes (Betano chama "Atlético MG",
// Superbet chama "Atletico-MG", ESPN chama "Atlético Mineiro") no MESMO event_id.
// ══════════════════════════════════════════════════════════════════════════

// Remove acentos, pontuação, sufixos comuns, e corta
export function normTeam(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
    .replace(/\b(fc|sc|ac|af|cf|sv|cd|ud|ca|uc|as|rc)\b/g, '')  // sufixos
    .replace(/\b(futebol|club|clube|sport|sporting)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20);
}

// Similaridade entre dois nomes normalizados (0..1)
export function teamSim(a, b) {
  const na = normTeam(a), nb = normTeam(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // prefixo comum
  let pre = 0;
  while (pre < na.length && pre < nb.length && na[pre] === nb[pre]) pre++;
  if (pre >= 5) return 0.9;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  if (na.slice(0, 4) === nb.slice(0, 4)) return 0.7;
  return 0;
}

// Match fuzzy entre dois times
export function teamMatch(a, b) {
  return teamSim(a, b) >= 0.7;
}

// Gera event_id determinístico
// Usa home_canon|away_canon|YYYY-MM-DD (não inclui hora exata pra tolerar mudanças)
export function eventId(home, away, commenceMs) {
  const hc = normTeam(home);
  const ac = normTeam(away);
  const date = new Date(commenceMs || Date.now()).toISOString().slice(0, 10);
  // Ordena pra ser resistente a home/away invertido em fontes diferentes
  const [a, b] = [hc, ac].sort();
  return `${a}|${b}|${date}`;
}

// ── League mapping ────────────────────────────────────────────────────────
// Mapa: título de bookmaker/API → slug canônico ESPN-style
const LEAGUE_MAP = [
  [/brasileir.*a\b|brasileir.o s.rie a/i,      'bra.1', 'Brasileirão A'],
  [/brasileir.*b\b|brasileir.o s.rie b/i,      'bra.2', 'Brasileirão B'],
  [/brasileir.*c\b|brasileir.o s.rie c/i,      'bra.3', 'Brasileirão C'],
  [/copa do brasil/i,                           'bra.copa_do_brazil', 'Copa do Brasil'],
  [/libertadores/i,                             'conmebol.libertadores', 'Libertadores'],
  [/sudamericana/i,                             'conmebol.sudamericana', 'Sudamericana'],
  [/liga argentin|argentin.*primera/i,          'arg.1', 'Liga Argentina'],
  [/copa argentin/i,                            'arg.copa', 'Copa Argentina'],
  [/english premier|premier league england/i,   'eng.1', 'Premier League'],
  [/la liga|spain.*primera|primera divisi.n/i,  'esp.1', 'La Liga'],
  [/bundesliga(?!.*2|.*ii)/i,                   'ger.1', 'Bundesliga'],
  [/bundesliga.*2|2\. bundesliga/i,             'ger.2', '2. Bundesliga'],
  [/serie a|italian serie a/i,                  'ita.1', 'Serie A'],
  [/ligue 1/i,                                  'fra.1', 'Ligue 1'],
  [/primeira liga|portugal.*primeira/i,         'por.1', 'Primeira Liga'],
  [/champions league|uefa champions/i,          'uefa.champions', 'Champions League'],
  [/europa league|uefa europa(?!.*conference)/i,'uefa.europa', 'Europa League'],
  [/conference league/i,                        'uefa.europa_conference', 'Conference League'],
  [/belarus/i,                                  'blr.1', 'Belarus Premier League'],
  [/russian? premier|russia.*premier/i,         'rus.1', 'Russia Premier League'],
  [/ukrain.*premier/i,                          'ukr.1', 'Ukraine Premier League'],
  [/scottish premier|scotland.*premier/i,       'sco.1', 'Scottish Premiership'],
  [/turk.*super|super lig/i,                    'tur.1', 'Süper Lig'],
  [/eredivisie/i,                               'ned.1', 'Eredivisie'],
  [/mls/i,                                      'usa.1', 'MLS'],
  [/liga mx/i,                                  'mex.1', 'Liga MX'],
  [/victoria.*premier/i,                        'aus.vic', 'Victoria Premier League'],
  [/australia.*a-league/i,                      'aus.1', 'A-League'],
  [/nba/i,                                      'nba', 'NBA'],
];

export function resolveLeague(raw) {
  if (!raw) return { slug: null, label: null };
  for (const [rx, slug, label] of LEAGUE_MAP) {
    if (rx.test(raw)) return { slug, label };
  }
  return { slug: null, label: raw };
}

// ── Market mapping ────────────────────────────────────────────────────────
// Padroniza nomes de mercado entre books
export const MARKETS = {
  H2H:        'h2h',          // 1X2 / moneyline
  SPREADS:    'spreads',      // handicap
  TOTALS:     'totals',       // over/under gols
  BTTS:       'btts',         // both teams to score
  DNB:        'dnb',          // draw no bet
  DOUBLE:     'double_chance',
  CARDS:      'cards_total',
  CORNERS:    'corners_total',
  PLAYER_PTS: 'player_points',  // NBA
  PLAYER_AST: 'player_assists',
  PLAYER_REB: 'player_rebounds',
  PLAYER_SOT: 'player_shots_on_target',  // futebol
  PLAYER_GOAL:'player_goal_scorer',
};

export function resolveMarket(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (/^(h2h|1x2|moneyline|match winner|match result|resultado final|winner)$/i.test(s)) return MARKETS.H2H;
  if (/total|over.*under|over\/under/i.test(s) && !/cart|corner|escanteio/.test(s)) return MARKETS.TOTALS;
  if (/handicap|spread/i.test(s)) return MARKETS.SPREADS;
  if (/btts|both.*teams.*score|ambas.*marcam/i.test(s)) return MARKETS.BTTS;
  if (/dnb|draw.*no.*bet|sem empate/i.test(s)) return MARKETS.DNB;
  if (/double.*chance|dupla.*chance/i.test(s)) return MARKETS.DOUBLE;
  if (/cart|card/i.test(s)) return MARKETS.CARDS;
  if (/corner|escanteio/i.test(s)) return MARKETS.CORNERS;
  if (/player.*points?|pontos/i.test(s)) return MARKETS.PLAYER_PTS;
  if (/player.*assist|assist.ncias/i.test(s)) return MARKETS.PLAYER_AST;
  if (/player.*rebound|rebote/i.test(s)) return MARKETS.PLAYER_REB;
  return s.slice(0, 30);
}

// ── Outcome normalization ─────────────────────────────────────────────────
export function normOutcome(raw, market, eventContext = {}) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (market === MARKETS.H2H || market === MARKETS.DNB) {
    if (/^(home|casa|1|mandante)$/.test(s)) return 'home';
    if (/^(away|fora|2|visitante)$/.test(s)) return 'away';
    if (/^(draw|empate|x|tie)$/.test(s)) return 'draw';
    // Por nome do time: compara com home/away do contexto
    if (eventContext.home && teamMatch(s, eventContext.home)) return 'home';
    if (eventContext.away && teamMatch(s, eventContext.away)) return 'away';
  }
  if (market === MARKETS.TOTALS || market === MARKETS.PLAYER_PTS ||
      market === MARKETS.PLAYER_AST || market === MARKETS.PLAYER_REB) {
    if (/over|mais|acima/.test(s)) return 'over';
    if (/under|menos|abaixo/.test(s)) return 'under';
  }
  if (market === MARKETS.BTTS) {
    if (/yes|sim|ambas.*marcam/.test(s)) return 'yes';
    if (/no|n.o|n.o.*marcam/.test(s)) return 'no';
  }
  return s.slice(0, 40);
}
