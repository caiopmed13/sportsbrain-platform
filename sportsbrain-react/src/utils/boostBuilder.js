// ═══════════════════════════════════════════════════════════════════════════
// Boost Scanner — Avaliação de Apostas Aumentadas (Bet365)
// ═══════════════════════════════════════════════════════════════════════════
// Bet365 publica diariamente "Apostas Aumentadas" — combos pré-montados
// com odd melhorada (ex: 11.00 → 12.00). A maioria são iscas: o boost cobre
// parte do vig mas a combinação ainda é EV negativo. Algumas valem a pena.
//
// Pipeline:
//   1. parseBoostText(rawText) → [{ match, legs[], originalOdd, boostedOdd }]
//   2. estimateLegProb(leg) → 0..1 (heurística calibrada por tipo)
//   3. combineProbs(legs) → joint prob com correção de correlação
//   4. computeBoostEV(joint, boost, original) → { ev, gap, verdict }
//
// Uso típico:
//   • Cole o texto do app/site Bet365 na textarea
//   • Sistema parseia, estima, ranqueia por EV
//   • Verde → vale a pena. Vermelho → trap clássica.
// ═══════════════════════════════════════════════════════════════════════════

// ── Taxonomia de tipos de leg ─────────────────────────────────────────────
export const LEG_TYPES = {
  // ─── Futebol: 1X2 ───────────────────────────────────────────────────────
  RESULT_HOME:  { code: 'RH',  base: 0.42, label: 'Resultado: Casa' },
  RESULT_AWAY:  { code: 'RA',  base: 0.32, label: 'Resultado: Fora' },
  RESULT_DRAW:  { code: 'RD',  base: 0.26, label: 'Resultado: Empate' },
  // ─── Futebol: BTTS / Over goals ─────────────────────────────────────────
  BTTS_YES:     { code: 'BY',  base: 0.55, label: 'Ambas Marcam: SIM' },
  BTTS_NO:      { code: 'BN',  base: 0.45, label: 'Ambas Marcam: NÃO' },
  OVER_15:      { code: 'O15', base: 0.78, label: 'Mais de 1.5 gols' },
  OVER_25:      { code: 'O25', base: 0.55, label: 'Mais de 2.5 gols' },
  OVER_35:      { code: 'O35', base: 0.32, label: 'Mais de 3.5 gols' },
  TEAM_OVER_15: { code: 'TO15',base: 0.58, label: 'Time: Mais de 1.5 gols' },
  TEAM_OVER_25: { code: 'TO25',base: 0.32, label: 'Time: Mais de 2.5 gols' },
  // ─── Futebol: Player shots (chutes) ─────────────────────────────────────
  P_SCORE:      { code: 'PS',  base: 0.30, label: 'Jogador: Para Marcar' },
  P_HEADER:     { code: 'PH',  base: 0.08, label: 'Jogador: Marcar de Cabeça' },
  P_2GOALS:     { code: 'P2G', base: 0.06, label: 'Jogador: Mais de 1 Gols' },
  P_ASSIST:     { code: 'PA',  base: 0.22, label: 'Jogador: Para Dar Assistência' },
  P_SHOTS_2:    { code: 'PSH2',base: 0.55, label: 'Jogador: 2+ Chutes ao Gol' },
  P_SHOTS_1:    { code: 'PSH1',base: 0.78, label: 'Jogador: 1+ Chutes ao Gol' },
  P_SHOTS_3:    { code: 'PSH3',base: 0.32, label: 'Jogador: 3+ Chutes ao Gol' },
  P_SHOTS_15:   { code: 'PSH15',base: 0.62,label: 'Jogador: Mais de 1.5 Chutes' },
  P_SHOTS_05:   { code: 'PSH05',base: 0.78,label: 'Jogador: Mais de 0.5 Chutes' },
  P_SHOTS_OUT:  { code: 'PSO', base: 0.50, label: 'Jogador: Chutes Fora da Área (0.5+)' },
  // ─── Futebol: Team shots / corners by team ──────────────────────────────
  TEAM_SHOTS_15:    { code: 'TS15', base: 0.55, label: 'Time: Mais de 1.5 Chutes ao Gol' },
  TEAM_SHOTS_25:    { code: 'TS25', base: 0.42, label: 'Time: Mais de 2.5 Chutes ao Gol' },
  TEAM_SHOTS_HT15:  { code: 'TSHT15', base: 0.50, label: 'Time: 1.5+ Chutes 1º/2º Tempo' },
  TEAM_CORNERS_HT1: { code: 'TCHT1', base: 0.62, label: 'Time: 1+ Escanteios 1º/2º Tempo' },
  CORNER_HT_1:      { code: 'CHT1', base: 0.68, label: 'Mais de 1 Escanteios 1º Tempo' },
  CORNER_TEAM:      { code: 'CT',   base: 0.45, label: 'Maior Nº Escanteios: Time' },
  SHOTS_TEAM:       { code: 'ST',   base: 0.45, label: 'Maior Nº Chutes ao Gol: Time' },
  SHOTS_TOTAL_TEAM: { code: 'STT',  base: 0.45, label: 'Maior Nº Chutes: Time' },
  CARDS_TEAM:       { code: 'KT',   base: 0.45, label: 'Maior Nº Cartões: Time' },
  // ─── NBA / NBB (basquete) ───────────────────────────────────────────────
  // Player points — base calibrada ~MA L10. Linhas comuns: 10/15/20/25/30+
  NBA_P_PTS_10: { code: 'PTS10', base: 0.85, label: 'Jogador: 10+ Pontos' },
  NBA_P_PTS_15: { code: 'PTS15', base: 0.72, label: 'Jogador: 15+ Pontos' },
  NBA_P_PTS_20: { code: 'PTS20', base: 0.55, label: 'Jogador: 20+ Pontos' },
  NBA_P_PTS_25: { code: 'PTS25', base: 0.38, label: 'Jogador: 25+ Pontos' },
  NBA_P_PTS_30: { code: 'PTS30', base: 0.22, label: 'Jogador: 30+ Pontos' },
  NBA_P_PTS_35: { code: 'PTS35', base: 0.12, label: 'Jogador: 35+ Pontos' },
  // Player rebounds (5/8/10+)
  NBA_P_REB_5:  { code: 'REB5',  base: 0.65, label: 'Jogador: 5+ Rebotes' },
  NBA_P_REB_8:  { code: 'REB8',  base: 0.42, label: 'Jogador: 8+ Rebotes' },
  NBA_P_REB_10: { code: 'REB10', base: 0.25, label: 'Jogador: 10+ Rebotes' },
  // Player assists (4/6/8+)
  NBA_P_AST_4:  { code: 'AST4',  base: 0.55, label: 'Jogador: 4+ Assistências' },
  NBA_P_AST_6:  { code: 'AST6',  base: 0.35, label: 'Jogador: 6+ Assistências' },
  NBA_P_AST_8:  { code: 'AST8',  base: 0.20, label: 'Jogador: 8+ Assistências' },
  // Player threes (1/2/3/4+)
  NBA_P_3PT_1:  { code: 'TPM1',  base: 0.78, label: 'Jogador: 1+ Cesta de 3' },
  NBA_P_3PT_2:  { code: 'TPM2',  base: 0.55, label: 'Jogador: 2+ Cestas de 3' },
  NBA_P_3PT_3:  { code: 'TPM3',  base: 0.32, label: 'Jogador: 3+ Cestas de 3' },
  NBA_P_3PT_4:  { code: 'TPM4',  base: 0.18, label: 'Jogador: 4+ Cestas de 3' },
  // Combos jogador (PRA, PR, PA, RA)
  NBA_P_PRA:    { code: 'PRA',   base: 0.50, label: 'Jogador: Pontos+Reb+Ast (linha)' },
  // NBA team & match
  NBA_RESULT_HOME: { code: 'NRH',  base: 0.55, label: 'NBA: Vencedor Casa' },
  NBA_RESULT_AWAY: { code: 'NRA',  base: 0.45, label: 'NBA: Vencedor Fora' },
  NBA_TEAM_PTS:    { code: 'NTPTS',base: 0.50, label: 'Time NBA: Mais de X.5 Pontos' },
  NBA_TOTAL_PTS:   { code: 'NTPT',base: 0.50, label: 'NBA: Total Pontos Over' },
  NBA_FIRST_BASKET:{ code: 'NFB', base: 0.10, label: 'NBA: Primeira Cesta — Jogador' },
  // ─── Genérico ───────────────────────────────────────────────────────────
  GENERIC:      { code: 'GN',  base: 0.40, label: 'Outro' },
}

// ── Correlações comuns dentro do mesmo jogo (pp adicional na multiplicação) ─
// Se ambas legs são "casa marca + casa vence" → correlação positiva → soma uns 6pp
const CORR_PAIRS = [
  // Futebol — resultado + gols
  { match: ['RH', 'BY'],     boost: 0.04 },   // Casa vence + BTTS
  { match: ['RA', 'BY'],     boost: 0.04 },
  { match: ['RH', 'O25'],    boost: 0.06 },   // Casa + Over
  { match: ['RA', 'O25'],    boost: 0.06 },
  { match: ['BY', 'O25'],    boost: 0.10 },   // BTTS já pressupõe Over 2.5 alto
  { match: ['PS', 'RH'],     boost: 0.05 },   // Jogador casa marca + casa vence
  { match: ['PS', 'RA'],     boost: 0.05 },
  { match: ['PA', 'PS'],     boost: 0.04 },   // Mesmo time marca + assiste
  { match: ['PSH2', 'PS'],   boost: 0.08 },   // Quem marca chuta muito
  { match: ['PSH15', 'PS'],  boost: 0.06 },
  { match: ['TO15', 'BY'],   boost: 0.10 },   // Time marca 1.5 + BTTS = inevitável
  { match: ['TO15', 'RH'],   boost: 0.06 },
  { match: ['CHT1', 'O25'],  boost: 0.03 },
  // Futebol — chutes/escanteios time-tempo (alta correlação intra-jogo)
  { match: ['TSHT15', 'TS25'],  boost: 0.15 },  // se time tem 1.5+ chutes 1T, prob 2.5+ no jogo é altíssima
  { match: ['TCHT1', 'CT'],     boost: 0.10 },  // 1+ escanteio 1T + maior nº escanteios
  { match: ['TS15', 'ST'],      boost: 0.08 },  // time 1.5+ chutes + maior nº chutes
  { match: ['ST', 'RH'],        boost: 0.08 },  // dominância chutes correlaciona com vitória
  { match: ['ST', 'RA'],        boost: 0.08 },
  { match: ['CT', 'RH'],        boost: 0.05 },  // dominância escanteios correlaciona com vitória
  { match: ['CT', 'RA'],        boost: 0.05 },
  // NBA — vitória + alto desempenho do astro do time
  { match: ['NRH', 'PTS25'],    boost: 0.05 },
  { match: ['NRA', 'PTS25'],    boost: 0.05 },
  { match: ['NRH', 'PTS30'],    boost: 0.04 },
  { match: ['NRA', 'PTS30'],    boost: 0.04 },
  // NBA — pontos + cestas de 3 (parte dos pontos vem dos triplos)
  { match: ['PTS25', 'TPM3'],   boost: 0.08 },
  { match: ['PTS30', 'TPM3'],   boost: 0.06 },
  { match: ['PTS20', 'TPM2'],   boost: 0.06 },
  // NBA — pontos + assistências (point guards combo)
  { match: ['PTS20', 'AST6'],   boost: 0.05 },
  { match: ['PTS25', 'AST6'],   boost: 0.04 },
  // NBA — Total alto + pontos do astro
  { match: ['NTPT', 'PTS30'],   boost: 0.06 },
  { match: ['NTPT', 'PTS25'],   boost: 0.04 },
]

// ── Parser best-effort do texto colado ────────────────────────────────────
const RX = {
  // Separador exige espaços (\s+) em volta pra não pegar "x" dentro de "Galaxy"
  // ou "v" dentro de "Avaí". Aceita: "v", "vs", "×" (multiply), "@" e literal "x"
  // só se rodeado de espaços. Não usa "x"/"v" sem boundary.
  match:       /^([A-ZÀ-Ú][\w\sáéíóúâêôãõç.'-]+?)\s+(?:v|vs|×|@|x)\s+([A-ZÀ-Ú][\w\sáéíóúâêôãõç.'-]+?)\s*$/im,
  oddBoost:    /(\d+[.,]\d+)\s*(?:>>|→|»|>>)\s*(\d+[.,]\d+)/,
  oddSingle:   /(\d+[.,]\d+)/,
  // ─── Futebol: 1X2 ───────────────────────────────────────────────────────
  resultHome:  /resultado.*final.*[:\-]\s*(?:casa|home|primeiro|mandante)/i,
  resultAway:  /resultado.*final.*[:\-]\s*(?:fora|away|visitante|segundo)/i,
  resultByName:/resultado(?:\s+final)?[:\-]\s*([\wáéíóúâêôãõç ]+)$/im,
  // ─── Futebol: BTTS / Over goals ─────────────────────────────────────────
  bttsYes:     /(?:ambas?\s*os?\s*times?\s*marca|ambos\s*marcam|para\s*ambos.*marca|btts.*sim)/i,
  bttsNo:      /(?:ambos.*n[aã]o.*marca|btts.*n[aã]o)/i,
  over25:      /(?:mais\s*de\s*2[.,]5\s*gols?|over\s*2[.,]5)(?!\s*(?:chutes|escanteio|cart))/i,
  over15:      /(?:mais\s*de\s*1[.,]5\s*gols?|over\s*1[.,]5)(?!\s*(?:chutes|escanteio|cart))/i,
  over35:      /(?:mais\s*de\s*3[.,]5\s*gols?|over\s*3[.,]5)/i,
  teamOver15:  /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*mais\s*de\s*1[.,]5\s*gol(?!\s*chutes)/i,
  teamOver25Goals: /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*mais\s*de\s*2[.,]5\s*gol(?!\s*chutes)/i,
  // ─── Futebol: Player shots/score ────────────────────────────────────────
  pShotsOut:   /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*(?:mais\s*de\s*)?0[.,]5(?:\s*chutes)?\s*(?:ao\s*gol\s*)?(?:de\s*)?fora\s*da\s*[áa]rea/i,
  pShots3:     /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*3\+\s*chutes\s*ao\s*gol/i,
  pShots2:     /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*2\+\s*chutes\s*ao\s*gol/i,
  pShots1:     /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*1\+\s*chutes\s*ao\s*gol/i,
  pShots15:    /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*mais\s*de\s*1[.,]5\s*chutes/i,
  pAssist:     /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*(?:para\s*dar\s*assist[eê]ncia|assist[eê]ncia)/i,
  pHeader:     /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*(?:marcar?\s*de\s*cabe[çc]a|gol\s*de\s*cabe[çc]a)/i,
  p2goals:     /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*(?:mais\s*de\s*1\s*gols?|2\+\s*gols?)/i,
  pScore:      /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*(?:para\s*marcar|marcar\s*a\s*qualquer)/i,
  // ─── Futebol: Team shots HT (X - Mais de 2.5 Chutes ao Gol) ─────────────
  teamShotsTotal25: /([\wáéíóúâêôãõç ]+?)\s*[-–]\s*mais\s*de\s*2[.,]5\s*chutes\s*ao\s*gol\b(?!\s*no)/i,
  teamShotsTotal15: /([\wáéíóúâêôãõç ]+?)\s*[-–]\s*mais\s*de\s*1[.,]5\s*chutes\s*ao\s*gol\b(?!\s*no)/i,
  // "Mais de 1.5 Chutes ao Gol no 1º/2º Tempo para X"
  teamShotsHT:      /mais\s*de\s*[12][.,]?5?\s*chutes\s*(?:ao\s*gol\s*)?no\s*[12][ºo°]\s*tempo\s*para\s*([\wáéíóúâêôãõç ]+)/i,
  // "Mais de N Escanteios no 1º/2º Tempo para X"
  teamCornersHT:    /mais\s*de\s*\d+\s*escanteios?\s*no\s*[12][ºo°]\s*tempo\s*para\s*([\wáéíóúâêôãõç ]+)/i,
  cornerHt1:        /mais\s*de\s*1\s*escanteios?\s*(?:no\s*)?1[ºo°]?\s*tempo(?!\s*para)/i,
  cornerTeam:       /maior\s*n[uú]mero\s*de\s*escanteios?[:\-]\s*([\wáéíóúâêôãõç ]+)/i,
  // "Maior Número de Chutes ao Gol: TIME" e "Maior Número de Chutes: TIME"
  shotsTeam:        /maior\s*n[uú]mero\s*de\s*chutes\s*ao\s*gol[:\-]\s*([\wáéíóúâêôãõç ]+)/i,
  shotsTotalTeam:   /maior\s*n[uú]mero\s*de\s*chutes\b(?!\s*ao\s*gol)[:\-]?\s*([\wáéíóúâêôãõç ]+)/i,
  cardsTeam:        /maior\s*n[uú]mero\s*de\s*cart[oõ]es?[:\-]\s*([\wáéíóúâêôãõç ]+)/i,
  // ─── NBA / NBB ──────────────────────────────────────────────────────────
  // "Cade Cunningham - 30+ Pontos" ou "Cade Cunningham: 30+ Pontos"
  nbaPlayerPoints:   /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*(\d{1,2})\+\s*pontos\b/i,
  // "Tatum: Mais de 25.5 Pontos"
  nbaPlayerPointsOver: /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*mais\s*de\s*(\d{1,2})[.,]5\s*pontos/i,
  // "Player - 8+ Rebotes"
  nbaPlayerReb:      /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*(\d{1,2})\+\s*rebotes\b/i,
  nbaPlayerRebOver:  /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*mais\s*de\s*(\d{1,2})[.,]5\s*rebotes/i,
  // "Player - 6+ Assistências"
  nbaPlayerAst:      /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*(\d{1,2})\+\s*assist[eêi]ncias?\b/i,
  nbaPlayerAstOver:  /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*mais\s*de\s*(\d{1,2})[.,]5\s*assist/i,
  // "Player - 3+ Cestas de 3 Pontos" (3pt makes)
  nbaPlayer3PT:      /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*(\d{1,2})\+\s*cestas?\s*de\s*3/i,
  // "Player - Pontos+Reb+Ast Mais de X.5"
  nbaPlayerPRA:      /([\wáéíóúâêôãõç.'\- ]+?)\s*[-–:]\s*(?:pontos\s*\+\s*rebotes\s*\+\s*assist|p\+r\+a|pra)\b/i,
  // NBA "Para Ganhar - Time" ou "Para Vencer - Time"
  nbaWinner:         /(?:para\s*(?:ganhar|vencer))\s*[-–:]\s*([\wáéíóúâêôãõç ]+)/i,
  // "Time NBA - Mais de 110.5 Pontos"
  nbaTeamPts:        /([\wáéíóúâêôãõç ]+?)\s*[-–:]\s*mais\s*de\s*(\d{2,3})[.,]5\s*pontos/i,
  // "Total de Pontos - Mais de 220.5"
  nbaTotalPts:       /total\s*(?:de\s*)?pontos?\s*[-–:]\s*mais\s*de\s*(\d{2,3})[.,]5/i,
  // ─── Genérico ───────────────────────────────────────────────────────────
}

// Tipo NBA: pontos por linha do mercado (10/15/20/25/30/35+)
function nbaPointsType(line) {
  if (line >= 35) return 'NBA_P_PTS_35'
  if (line >= 30) return 'NBA_P_PTS_30'
  if (line >= 25) return 'NBA_P_PTS_25'
  if (line >= 20) return 'NBA_P_PTS_20'
  if (line >= 15) return 'NBA_P_PTS_15'
  return 'NBA_P_PTS_10'
}
function nbaRebType(line) {
  if (line >= 10) return 'NBA_P_REB_10'
  if (line >= 8)  return 'NBA_P_REB_8'
  return 'NBA_P_REB_5'
}
function nbaAstType(line) {
  if (line >= 8) return 'NBA_P_AST_8'
  if (line >= 6) return 'NBA_P_AST_6'
  return 'NBA_P_AST_4'
}
function nba3ptType(line) {
  if (line >= 4) return 'NBA_P_3PT_4'
  if (line >= 3) return 'NBA_P_3PT_3'
  if (line >= 2) return 'NBA_P_3PT_2'
  return 'NBA_P_3PT_1'
}

function classifyLeg(line, matchCtx) {
  const txt = line.trim().replace(/^[•\-\*◦○]+\s*/, '')
  if (!txt) return null

  const sport = matchCtx?.sport || null
  let m

  // ── NBA / NBB primeiro (se sport conhecido for basquete) ────────────────
  // Mesmo se sport não conhecido, alguns padrões só ocorrem no basquete (Pontos como métrica do jogador)
  if (sport === 'NBA' || sport === 'NBB' || /pontos|rebotes|assist[eêi]ncia|cestas?\s*de\s*3/i.test(txt)) {
    if ((m = txt.match(RX.nbaPlayerPRA)))     return { type: 'NBA_P_PRA',  text: txt, player: m[1].trim() }
    if ((m = txt.match(RX.nbaPlayerPoints)))  return { type: nbaPointsType(+m[2]), text: txt, player: m[1].trim(), line: +m[2] }
    if ((m = txt.match(RX.nbaPlayerPointsOver))) return { type: nbaPointsType(+m[2]+0.5), text: txt, player: m[1].trim(), line: +m[2]+0.5 }
    if ((m = txt.match(RX.nbaPlayerReb)))     return { type: nbaRebType(+m[2]),    text: txt, player: m[1].trim(), line: +m[2] }
    if ((m = txt.match(RX.nbaPlayerRebOver))) return { type: nbaRebType(+m[2]+0.5),text: txt, player: m[1].trim(), line: +m[2]+0.5 }
    if ((m = txt.match(RX.nbaPlayerAst)))     return { type: nbaAstType(+m[2]),    text: txt, player: m[1].trim(), line: +m[2] }
    if ((m = txt.match(RX.nbaPlayerAstOver))) return { type: nbaAstType(+m[2]+0.5),text: txt, player: m[1].trim(), line: +m[2]+0.5 }
    if ((m = txt.match(RX.nbaPlayer3PT)))     return { type: nba3ptType(+m[2]),    text: txt, player: m[1].trim(), line: +m[2] }
    if ((m = txt.match(RX.nbaTotalPts)))      return { type: 'NBA_TOTAL_PTS',      text: txt, line: +m[1]+0.5 }
    if ((m = txt.match(RX.nbaTeamPts)))       return { type: 'NBA_TEAM_PTS',       text: txt, team: m[1].trim(), line: +m[2]+0.5 }
    if ((m = txt.match(RX.nbaWinner))) {
      const teamMentioned = m[1].trim().toLowerCase()
      const isHome = matchCtx?.home && teamMentioned.includes(matchCtx.home.toLowerCase().slice(0, 4))
      return { type: isHome ? 'NBA_RESULT_HOME' : 'NBA_RESULT_AWAY', text: txt, team: m[1].trim() }
    }
  }

  // ── Resultado por nome do time (Futebol "Resultado Final: X") ───────────
  if (matchCtx) {
    m = txt.match(RX.resultByName)
    if (m) {
      const teamMentioned = m[1].trim().toLowerCase()
      if (matchCtx.home && teamMentioned.includes(matchCtx.home.toLowerCase().slice(0, 5))) {
        return { type: 'RESULT_HOME', text: txt, team: matchCtx.home }
      }
      if (matchCtx.away && teamMentioned.includes(matchCtx.away.toLowerCase().slice(0, 5))) {
        return { type: 'RESULT_AWAY', text: txt, team: matchCtx.away }
      }
      return { type: 'RESULT_HOME', text: txt, team: m[1].trim() }
    }
  }
  if (RX.resultHome.test(txt))  return { type: 'RESULT_HOME', text: txt }
  if (RX.resultAway.test(txt))  return { type: 'RESULT_AWAY', text: txt }
  if (RX.bttsYes.test(txt))     return { type: 'BTTS_YES', text: txt }
  if (RX.bttsNo.test(txt))      return { type: 'BTTS_NO', text: txt }
  if (RX.over35.test(txt))      return { type: 'OVER_35', text: txt }
  if (RX.over25.test(txt))      return { type: 'OVER_25', text: txt }
  if (RX.over15.test(txt))      return { type: 'OVER_15', text: txt }

  // ── Time-window (mais específico, antes do CORNER_HT_1 genérico) ────────
  if ((m = txt.match(RX.teamShotsHT)))    return { type: 'TEAM_SHOTS_HT15',  text: txt, team: m[1].trim() }
  if ((m = txt.match(RX.teamCornersHT)))  return { type: 'TEAM_CORNERS_HT1', text: txt, team: m[1].trim() }
  if (RX.cornerHt1.test(txt))             return { type: 'CORNER_HT_1', text: txt }
  if ((m = txt.match(RX.cornerTeam)))     return { type: 'CORNER_TEAM',     text: txt, team: m[1].trim() }
  if ((m = txt.match(RX.shotsTeam)))      return { type: 'SHOTS_TEAM',      text: txt, team: m[1].trim() }
  if ((m = txt.match(RX.shotsTotalTeam))) return { type: 'SHOTS_TOTAL_TEAM',text: txt, team: m[1].trim() }
  if ((m = txt.match(RX.cardsTeam)))      return { type: 'CARDS_TEAM',      text: txt, team: m[1].trim() }

  // ── Team total shots ("Bahia - Mais de 2.5 Chutes ao Gol") ──────────────
  if ((m = txt.match(RX.teamShotsTotal25))) return { type: 'TEAM_SHOTS_25', text: txt, team: m[1].trim() }
  if ((m = txt.match(RX.teamShotsTotal15))) return { type: 'TEAM_SHOTS_15', text: txt, team: m[1].trim() }

  // ── Team goals ("X - Mais de 1.5 gols") ─────────────────────────────────
  if ((m = txt.match(RX.teamOver25Goals))) return { type: 'TEAM_OVER_25', text: txt, team: m[1].trim() }
  if ((m = txt.match(RX.teamOver15)))      return { type: 'TEAM_OVER_15', text: txt, team: m[1].trim() }

  // ── Player shots/score ──────────────────────────────────────────────────
  if ((m = txt.match(RX.pShotsOut)))  return { type: 'P_SHOTS_OUT', text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.pShots3)))    return { type: 'P_SHOTS_3',   text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.pShots2)))    return { type: 'P_SHOTS_2',   text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.pShots1)))    return { type: 'P_SHOTS_1',   text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.pShots15)))   return { type: 'P_SHOTS_15',  text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.pAssist)))    return { type: 'P_ASSIST',    text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.pHeader)))    return { type: 'P_HEADER',    text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.p2goals)))    return { type: 'P_2GOALS',    text: txt, player: m[1].trim() }
  if ((m = txt.match(RX.pScore)))     return { type: 'P_SCORE',     text: txt, player: m[1].trim() }
  return { type: 'GENERIC', text: txt }
}

// ── Parser principal ──────────────────────────────────────────────────────
/**
 * Parseia texto colado da Bet365 em boosts estruturados.
 * Cada bloco começa com "TIMEA v TIMEB" (ou similar) e termina ao
 * encontrar uma odd no formato "11.00 >> 12.00".
 */
export function parseBoostText(raw) {
  if (!raw) return []
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const boosts = []
  let cur = null

  function flush() {
    if (cur && cur.legs.length) boosts.push(cur)
    cur = null
  }

  // Tag line opcional: "[SPORT:NBA]" ou "[SPORT:Brasileirão]" inserido pelo
  // boostsToText() pra preservar sport/competition que vem do scraper.
  let pendingSport = null
  let pendingCompetition = null

  for (const line of lines) {
    // Tag de esporte/competição (não vai pra legs)
    const sportTag = line.match(/^\[SPORT:([^\]]+)\]$/i)
    if (sportTag) {
      pendingCompetition = sportTag[1].trim()
      pendingSport = inferSportFromCompetition(pendingCompetition)
      continue
    }

    // detecta nome de partida (ou bloco anônimo "? v ?" do scraper)
    const matchM = line.match(RX.match)
    const anon = /^\?\s*(?:v|x|×|vs|@)\s*\?$/i.test(line)
    if ((matchM || anon) && !RX.oddBoost.test(line)) {
      flush()
      cur = anon
        ? { match: { home: null, away: null, raw: line, sport: pendingSport, competition: pendingCompetition }, legs: [], originalOdd: null, boostedOdd: null, sport: pendingSport, competition: pendingCompetition }
        : { match: { home: matchM[1].trim(), away: matchM[2].trim(), raw: line, sport: pendingSport, competition: pendingCompetition }, legs: [], originalOdd: null, boostedOdd: null, sport: pendingSport, competition: pendingCompetition }
      pendingSport = null
      pendingCompetition = null
      continue
    }
    // detecta linha de odd (final do bloco)
    const oddM = line.match(RX.oddBoost)
    if (oddM && cur) {
      cur.originalOdd = parseFloat(oddM[1].replace(',', '.'))
      cur.boostedOdd  = parseFloat(oddM[2].replace(',', '.'))
      flush()
      continue
    }
    if (!cur) continue
    const leg = classifyLeg(line, cur.match)
    if (leg) cur.legs.push(leg)
  }
  flush()

  // Detecta acumuladores cross-match: boosts com 5+ legs onde várias legs
  // referenciam matches diferentes (ex: "BOS Celtics @ PHI 76ers v ?",
  // "LA Lakers @ HOU Rockets v ?"). Esses estavam aparecendo agrupados sob
  // o primeiro match (ex: Atlético Mineiro × Flamengo) por causa do header
  // do scraper. Limpa home/away pra cair no bucket "Acumuladores".
  const matchRefRx = /\b[A-Z][A-Za-zÀ-Ú\.\s]{1,30}\s+(?:v|@)\s+[A-Z][A-Za-zÀ-Ú\.\s]{1,30}/
  for (const b of boosts) {
    if (b.legs.length >= 5 && b.match?.home) {
      const matchRefs = new Set()
      for (const leg of b.legs) {
        const t = leg.text || ''
        const m = t.match(matchRefRx)
        if (m) matchRefs.add(m[0].toLowerCase().replace(/\s+/g, ' ').trim())
      }
      // Se há 2+ matches distintos referenciados nos legs, é acumulador cross-match
      if (matchRefs.size >= 2) {
        b.match.home = null
        b.match.away = null
        b.isAccumulator = true
      }
    }
  }
  return boosts.filter(b => b.legs.length >= 2 || b.boostedOdd)
}

// Mapeia competição (raw da Bet365) pra sport canônico
export function inferSportFromCompetition(comp) {
  if (!comp) return null
  const c = comp.toLowerCase()
  if (/\bnba\b/i.test(c)) return 'NBA'
  if (/\bnbb\b/i.test(c)) return 'NBB'
  if (/basquete|basket/.test(c)) return 'NBB'
  if (/t[êe]nis|tennis|atp|wta/.test(c)) return 'Tênis'
  if (/mma|ufc/.test(c)) return 'MMA/UFC'
  if (/esports?|lol|csgo|valorant|dota/.test(c)) return 'eSports'
  if (/brasileir|s[ée]rie\s*[ab]\s*brasil|copa\s*do\s*brasil/.test(c)) return 'Brasileirão'
  if (/premier|laliga|la\s*liga|serie\s*a\b|bundesliga|ligue\s*1|champions|europa|libertadores|sul[\s-]americana|primeira\s*liga|portugal/.test(c)) return 'Futebol Europa'
  // Fallback: qualquer "Football" / "Futebol" — se não bate em Brasil, vai pra Europa
  if (/football|futebol|soccer/.test(c)) return 'Futebol Europa'
  return null
}

// ── Estima prob de cada leg ───────────────────────────────────────────────
/**
 * Heurística: usa base do tipo + ajustes contextuais (gameProb se disponível).
 * @param {Object} leg
 * @param {Object} ctx { gameModel?, playerStats? } — opcional, refina prob
 */
export function estimateLegProb(leg, ctx = {}) {
  if (!leg) return 0.5
  const t = LEG_TYPES[leg.type]
  if (!t) return 0.4
  let prob = t.base

  // Ajuste se houver modelo do jogo (Palpites)
  const gm = ctx.gameModel
  if (gm) {
    if (leg.type === 'RESULT_HOME')   prob = gm.pHome  ?? prob
    else if (leg.type === 'RESULT_AWAY') prob = gm.pAway ?? prob
    else if (leg.type === 'RESULT_DRAW') prob = gm.pDraw ?? prob
    else if (leg.type === 'BTTS_YES')    prob = gm.pBtts ?? prob
    else if (leg.type === 'BTTS_NO')     prob = gm.pBtts != null ? (1 - gm.pBtts) : prob
    else if (leg.type === 'OVER_25')     prob = gm.pOver25 ?? prob
    else if (leg.type === 'OVER_35')     prob = gm.pOver35 ?? prob
    else if (leg.type === 'OVER_15') {
      // Baseline empírico Over 1.5: ~78% se λ_total ≥ 2.0
      if (gm.expGoals != null) prob = Math.min(0.92, 0.45 + gm.expGoals * 0.13)
    }
    else if (leg.type === 'TEAM_OVER_15') {
      if (gm.lambdaHome != null && leg.team) {
        const isHome = leg.team.toLowerCase().includes((ctx.home || '').toLowerCase().slice(0, 5))
        const lam = isHome ? gm.lambdaHome : gm.lambdaAway
        prob = 1 - Math.exp(-lam) - lam * Math.exp(-lam)   // P(X≥2)
      }
    }
  }
  // Ajuste por player stats se disponível (L10 minutos / chutes)
  const ps = ctx.playerStats?.[leg.player]
  if (ps) {
    if (leg.type === 'P_SHOTS_2')   prob = ps.l10?.shotsHit2plus ?? prob
    else if (leg.type === 'P_SHOTS_15') prob = ps.l10?.shotsHit15plus ?? prob
    else if (leg.type === 'P_SCORE')    prob = ps.l10?.scoreRate ?? prob
    else if (leg.type === 'P_ASSIST')   prob = ps.l10?.assistRate ?? prob
  }

  return Math.max(0.01, Math.min(0.99, prob))
}

// ── Combina probs com correlação leve ─────────────────────────────────────
/**
 * Multiplica probs com bump positivo quando há correlação conhecida.
 * Resultado clamped em [min*0.85, prod*1.25] pra evitar over/underconfidence.
 */
export function combineProbs(probsByCode) {
  // probsByCode: [{ code, prob }]
  if (!probsByCode.length) return 0
  const indep = probsByCode.reduce((acc, p) => acc * p.prob, 1)
  // Soma todos os boosts de pares correlacionados encontrados
  let totalBoost = 0
  for (const pair of CORR_PAIRS) {
    const has = pair.match.every(c => probsByCode.find(p => p.code === c))
    if (has) totalBoost += pair.boost
  }
  // boost aplicado como fração relativa: prob *= (1 + boost), max +25%
  const adjusted = indep * (1 + Math.min(0.25, totalBoost))
  return Math.max(0.001, Math.min(0.99, adjusted))
}

// ── EV vs odd boostada ────────────────────────────────────────────────────
export function computeBoostEV(jointProb, boostedOdd, originalOdd = null) {
  if (!boostedOdd || boostedOdd <= 1 || !jointProb) {
    return { ev: 0, edge: 0, gap: 0, verdict: 'unknown' }
  }
  const ev      = (jointProb * boostedOdd - 1) * 100   // EV%
  const implied = 1 / boostedOdd
  const edge    = (jointProb - implied) * 100          // pp
  const gap     = originalOdd ? +((boostedOdd / originalOdd - 1) * 100).toFixed(2) : null
  let verdict
  if (ev >= 8)        verdict = 'gold'
  else if (ev >= 3)   verdict = 'value'
  else if (ev >= -2)  verdict = 'fair'
  else                verdict = 'trap'
  return {
    ev:      +ev.toFixed(2),
    edge:    +edge.toFixed(2),
    impliedPct: +(implied * 100).toFixed(2),
    boostGap: gap,
    verdict,
  }
}

// ── Análise completa de um boost ──────────────────────────────────────────
export function analyzeBoost(boost, ctx = {}) {
  if (!boost?.legs?.length) return null
  const legAnalyses = boost.legs.map(leg => {
    const prob = estimateLegProb(leg, ctx)
    return {
      ...leg,
      prob,
      probPct: +(prob * 100).toFixed(1),
      label: LEG_TYPES[leg.type]?.label || leg.text,
      code: LEG_TYPES[leg.type]?.code || 'GN',
    }
  })
  const joint = combineProbs(legAnalyses)
  const evInfo = computeBoostEV(joint, boost.boostedOdd, boost.originalOdd)
  const fairOdd = joint > 0 ? +(1 / joint).toFixed(2) : null
  return {
    ...boost,
    legs: legAnalyses,
    jointProb: +joint.toFixed(4),
    jointPct:  +(joint * 100).toFixed(2),
    fairOdd,
    ...evInfo,
  }
}

// ── Sugestão de combos similares ──────────────────────────────────────────
/**
 * Dado um boost analisado, sugere variações que aumentam EV:
 *   • Remove a leg mais fraca (menor prob)
 *   • Substitui a mais fraca por leg "fácil" (Over 1.5, BTTS Sim)
 *   • Converte player props pesadas (cabeça, 2 gols) em mais fáceis (chutes, 2+)
 */
export function suggestSimilarCombos(analyzed, targetOdd = null) {
  if (!analyzed?.legs?.length) return []
  const target = targetOdd ?? analyzed.boostedOdd
  const weakest = [...analyzed.legs].sort((a, b) => a.prob - b.prob)[0]
  const out = []

  // Variação 1: remove a leg mais fraca
  const withoutWeak = analyzed.legs.filter(l => l !== weakest)
  if (withoutWeak.length >= 2) {
    const j = combineProbs(withoutWeak)
    const ev = (j * target - 1) * 100
    out.push({
      label: `Sem "${weakest.label}"`,
      legs: withoutWeak.map(l => l.label),
      jointPct: +(j * 100).toFixed(1),
      ev: +ev.toFixed(2),
      reason: `Leg mais fraca (${weakest.probPct}%) removida`,
    })
  }

  // Variação 2: troca a leg mais fraca por Over 1.5 (mais fácil)
  if (weakest && weakest.type !== 'OVER_15') {
    const swapped = withoutWeak.concat([{
      type: 'OVER_15', code: 'O15',
      label: 'Mais de 1.5 gols (sub.)',
      prob: LEG_TYPES.OVER_15.base,
      probPct: 78,
    }])
    const j = combineProbs(swapped)
    const ev = (j * target - 1) * 100
    out.push({
      label: `Trocar por Over 1.5`,
      legs: swapped.map(l => l.label),
      jointPct: +(j * 100).toFixed(1),
      ev: +ev.toFixed(2),
      reason: `Substitui "${weakest.label}" por Over 1.5 (mais provável)`,
    })
  }

  // Variação 3: converte P_HEADER → P_SCORE (qualquer tipo de gol)
  const header = analyzed.legs.find(l => l.type === 'P_HEADER')
  if (header) {
    const swapped = analyzed.legs.map(l => l === header
      ? { ...l, type: 'P_SCORE', code: 'PS', label: `${l.player} - Para Marcar (qualquer)`, prob: LEG_TYPES.P_SCORE.base }
      : l)
    const j = combineProbs(swapped)
    const ev = (j * target - 1) * 100
    out.push({
      label: `${header.player}: gol qualquer`,
      legs: swapped.map(l => l.label),
      jointPct: +(j * 100).toFixed(1),
      ev: +ev.toFixed(2),
      reason: `"Marcar de cabeça" (~8%) → "Para Marcar" (~30%) é 4× mais fácil`,
    })
  }

  return out.sort((a, b) => b.ev - a.ev)
}

// ═══════════════════════════════════════════════════════════════════════════
// Stub para v2: sincronizar com modelo Palpites do dia
// Hoje: heurística estática. Próximo passo: ler ctx.gameModel via match.
// ═══════════════════════════════════════════════════════════════════════════
